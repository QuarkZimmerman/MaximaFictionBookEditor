// Feature 019 (T011): BatchState target locking and temp directory lifecycle implementation.
#include "batch/run_state.hpp"

#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <random>
#include <system_error>
#include <vector>

namespace mfbe::batch {
namespace {

namespace fs = std::filesystem;

std::string random_run_id() {
    static constexpr char kHex[] = "0123456789abcdef";
    std::random_device rd;
    std::string token;
    token.reserve(32);
    for (int i = 0; i < 32; ++i) {
        token.push_back(kHex[rd() & 0x0F]);
    }
    return token;
}

// Normalizes a target path for deterministic map-key comparison across platforms.
// Resolves existing parent symlinks via weakly_canonical so two paths to the same directory lock
// together, and folds ASCII case on Windows/macOS where filesystems are case-insensitive.
std::string canonical_lock_key(const fs::path& raw_path) {
    std::error_code ec;
    fs::path norm = fs::weakly_canonical(raw_path, ec);
    if (ec || norm.empty()) {
        ec.clear();
        norm = fs::absolute(raw_path, ec).lexically_normal();
    }
    std::string utf8 = platform::utf8_from_path_generic(norm);
#if defined(_WIN32) || defined(__APPLE__)
    for (char& c : utf8) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
#endif
    return utf8;
}

bool paths_refer_to_same_file(const std::string& a_utf8, const std::string& b_utf8) {
    if (platform::same_file_path(a_utf8, b_utf8)) {
        return true;
    }
    const fs::path a = platform::path_from_utf8(a_utf8);
    const fs::path b = platform::path_from_utf8(b_utf8);
    std::error_code ec;
    if (fs::exists(a, ec) && !ec && fs::exists(b, ec) && !ec) {
        if (fs::equivalent(a, b, ec) && !ec) {
            return true;
        }
    }
    return canonical_lock_key(a) == canonical_lock_key(b);
}

bool is_safe_item_id(std::string_view item_id) {
    if (item_id.empty() || item_id.size() > 64) {
        return false;
    }
    for (const char c : item_id) {
        const unsigned char uc = static_cast<unsigned char>(c);
        if (!std::isalnum(uc) && c != '_' && c != '-') {
            return false;
        }
    }
    return true;
}

}  // namespace

BatchState::~BatchState() {
    cleanup_all();
}

void BatchState::sweep_stale_once(const fs::path& batch_root) {
    bool should_sweep = false;
    {
        std::lock_guard lock(mutex_);
        if (!swept_) {
            swept_ = true;
            should_sweep = true;
        }
    }
    if (!should_sweep) {
        return;
    }
    std::error_code ec;
    if (!fs::is_directory(batch_root, ec)) {
        return;
    }
    for (const fs::directory_entry& entry : fs::directory_iterator(batch_root, ec)) {
        std::error_code rm_ec;
        fs::remove_all(entry.path(), rm_ec);
    }
}

std::string BatchState::create_run(const fs::path& batch_root) {
    sweep_stale_once(batch_root);
    const std::string run_id = random_run_id();
    RunState state;
    state.run_id = run_id;
    state.temp_root = batch_root / platform::path_from_utf8(run_id);
    std::lock_guard lock(mutex_);
    runs_.emplace(run_id, std::move(state));
    return run_id;
}

ClaimOutcome BatchState::claim_target(const std::string& run_id, const std::string& source_path,
                                      const std::string& target_path,
                                      const std::optional<std::string>& open_doc_path,
                                      bool overwrite) {
    if (source_path.empty() || target_path.empty()) {
        throw BatchStateError("invalidPath", target_path, "sourcePath and targetPath are required");
    }
    const fs::path src = platform::path_from_utf8(source_path);
    const fs::path dst = platform::path_from_utf8(target_path);
    if (!dst.is_absolute()) {
        throw BatchStateError("invalidPath", target_path, "targetPath must be an absolute path");
    }

    const std::string normalized_target = platform::utf8_from_path(dst.lexically_normal());

    if (paths_refer_to_same_file(source_path, target_path)) {
        return ClaimOutcome{ClaimOutcome::Status::failed, "", normalized_target, "targetIsSource",
                            ""};
    }
    if (open_doc_path && !open_doc_path->empty() &&
        paths_refer_to_same_file(*open_doc_path, target_path)) {
        return ClaimOutcome{ClaimOutcome::Status::failed, "", normalized_target, "targetIsOpenBook",
                            ""};
    }

    const std::string key = canonical_lock_key(dst);

    std::lock_guard lock(mutex_);
    const auto it = runs_.find(run_id);
    if (it == runs_.end()) {
        throw BatchStateError("unknownRun", "", "unknown or ended runId: " + run_id);
    }
    RunState& run = it->second;

    // Never allow two parallel workers to write to the same target file concurrently, even when
    // overwrite is checked (data-model.md §7, Clarify Pass 2 Q1).
    if (run.active_claims.count(key) > 0) {
        return ClaimOutcome{ClaimOutcome::Status::skipped, "", normalized_target, "targetBusy", ""};
    }

    if (!overwrite) {
        std::error_code ex_ec;
        if (run.completed_targets.count(key) > 0 || fs::exists(dst, ex_ec)) {
            return ClaimOutcome{ClaimOutcome::Status::skipped, "", normalized_target,
                                "targetExists", ""};
        }
    }

    const fs::path parent = dst.parent_path();
    if (!parent.empty()) {
        std::error_code dir_ec;
        fs::create_directories(parent, dir_ec);
        if (dir_ec) {
            return ClaimOutcome{ClaimOutcome::Status::failed, "", normalized_target, "ioError",
                                platform::utf8_error_message(dir_ec)};
        }
    }

    const std::string claim_id = "c" + std::to_string(++run.next_claim_id);
    run.active_claims.emplace(key, claim_id);
    run.claim_to_key.emplace(claim_id, key);
    return ClaimOutcome{ClaimOutcome::Status::claimed, claim_id, normalized_target, "", ""};
}

void BatchState::release_target(const std::string& run_id, const std::string& claim_id,
                                bool succeeded) {
    std::lock_guard lock(mutex_);
    const auto it = runs_.find(run_id);
    if (it == runs_.end()) {
        return;
    }
    RunState& run = it->second;
    const auto cit = run.claim_to_key.find(claim_id);
    if (cit == run.claim_to_key.end()) {
        return;
    }
    const std::string key = cit->second;
    run.claim_to_key.erase(cit);
    run.active_claims.erase(key);
    if (succeeded) {
        run.completed_targets.insert(key);
    }
}

fs::path BatchState::allocate_item_dir(const std::string& run_id, const std::string& item_id) {
    if (!is_safe_item_id(item_id)) {
        throw BatchStateError("invalidPath", item_id, "invalid itemId");
    }
    std::lock_guard lock(mutex_);
    const auto it = runs_.find(run_id);
    if (it == runs_.end()) {
        throw BatchStateError("unknownRun", "", "unknown or ended runId: " + run_id);
    }
    const fs::path dir = it->second.temp_root / platform::path_from_utf8(item_id);
    it->second.item_dirs[item_id] = dir;
    return dir;
}

void BatchState::cleanup_item(const std::string& run_id, const std::string& item_id) {
    std::optional<fs::path> dir;
    {
        std::lock_guard lock(mutex_);
        const auto it = runs_.find(run_id);
        if (it != runs_.end()) {
            const auto dit = it->second.item_dirs.find(item_id);
            if (dit != it->second.item_dirs.end()) {
                dir = dit->second;
                it->second.item_dirs.erase(dit);
            }
        }
    }
    if (dir) {
        std::error_code ec;
        fs::remove_all(*dir, ec);
    }
}

void BatchState::end_run(const std::string& run_id) {
    std::optional<fs::path> root;
    {
        std::lock_guard lock(mutex_);
        const auto it = runs_.find(run_id);
        if (it != runs_.end()) {
            root = it->second.temp_root;
            runs_.erase(it);
        }
    }
    if (root) {
        std::error_code ec;
        fs::remove_all(*root, ec);
    }
}

void BatchState::cleanup_all() {
    std::vector<fs::path> roots;
    {
        std::lock_guard lock(mutex_);
        roots.reserve(runs_.size());
        for (const auto& [_, run] : runs_) {
            roots.push_back(run.temp_root);
        }
        runs_.clear();
    }
    for (const fs::path& root : roots) {
        std::error_code ec;
        fs::remove_all(root, ec);
    }
}

}  // namespace mfbe::batch
