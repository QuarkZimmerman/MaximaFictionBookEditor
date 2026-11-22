// Feature 019 (T011; data-model.md §7, contracts/rpc-api.md §3.2–§3.6): thread-safe per-run
// target locking, temp extraction directory lifecycle, and shutdown cleanup.
#pragma once

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace mfbe::batch {

struct BatchStateError : std::runtime_error {
    BatchStateError(std::string reason_, std::string path_ = "", std::string detail_ = "")
        : std::runtime_error(detail_.empty() ? reason_ : (reason_ + ": " + detail_)),
          reason(std::move(reason_)),
          path(std::move(path_)),
          detail(std::move(detail_)) {}
    std::string reason;  // unknownRun | invalidPath | ioError
    std::string path;
    std::string detail;
};

struct ClaimOutcome {
    enum class Status { claimed, skipped, failed };
    Status status = Status::failed;
    std::string claim_id;     // set when claimed
    std::string target_path;  // normalized UTF-8 target path
    std::string reason;  // targetExists | targetBusy | targetIsSource | targetIsOpenBook | ioError
    std::string detail;
};

struct RunState {
    std::string run_id;
    std::filesystem::path temp_root;
    std::uint64_t next_claim_id = 0;
    std::unordered_map<std::string, std::string> active_claims;  // canonicalKey -> claimId
    std::unordered_map<std::string, std::string> claim_to_key;   // claimId -> canonicalKey
    std::unordered_set<std::string> completed_targets;           // canonicalKeys finished
    std::unordered_map<std::string, std::filesystem::path> item_dirs;
};

class BatchState {
public:
    BatchState() = default;
    ~BatchState();

    BatchState(const BatchState&) = delete;
    BatchState& operator=(const BatchState&) = delete;

    // Removes any leftover state/batch/* folders from an earlier crash once per core lifetime.
    void sweep_stale_once(const std::filesystem::path& batch_root);

    // Allocates a new RunState and returns its random 32-hex runId.
    std::string create_run(const std::filesystem::path& batch_root);

    // Validates and atomically claims target_path within run_id; creates missing parent folders.
    ClaimOutcome claim_target(const std::string& run_id, const std::string& source_path,
                              const std::string& target_path,
                              const std::optional<std::string>& open_doc_path, bool overwrite);

    // Releases a claim; when succeeded == true, records the target in completed_targets.
    void release_target(const std::string& run_id, const std::string& claim_id, bool succeeded);

    // Allocates and registers state/batch/<runId>/<itemId> for batch.extractEntry.
    std::filesystem::path allocate_item_dir(const std::string& run_id, const std::string& item_id);

    // Best-effort cleanup of one item's temp extraction directory.
    void cleanup_item(const std::string& run_id, const std::string& item_id);

    // Ends a run, releases all locks, and removes state/batch/<runId>/.
    void end_run(const std::string& run_id);

    // Removes every remaining active run's temp directory (called on server shutdown / destructor).
    void cleanup_all();

private:
    std::mutex mutex_;
    bool swept_ = false;
    std::unordered_map<std::string, RunState> runs_;
};

}  // namespace mfbe::batch
