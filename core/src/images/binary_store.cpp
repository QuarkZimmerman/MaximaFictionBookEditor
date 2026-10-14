// Binary store with temp-file spilling and header probing (T042). See mfbe/binary_store.hpp.
#include <mfbe/binary_store.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/log.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/platform.hpp>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <random>
#include <system_error>

namespace mfbe {
namespace {

std::uint64_t fnv1a(std::string_view bytes) {
    std::uint64_t h = 1469598103934665603ULL;
    for (const char c : bytes) {
        h ^= static_cast<unsigned char>(c);
        h *= 1099511628211ULL;
    }
    return h;
}

std::string hex64(std::uint64_t v) {
    char buf[20];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
    return buf;
}

}  // namespace

BinaryStore::BinaryStore(std::int64_t spill_threshold) : threshold_(spill_threshold) {}

BinaryStore::~BinaryStore() {
    clear();
    if (!spill_dir_.empty()) {
        std::error_code ec;
        std::filesystem::remove_all(spill_dir_, ec);
    }
}

model::BinaryMeta BinaryStore::put(const std::string& id, const std::string& content_type,
                                   std::string bytes, bool raw_text) {
    std::lock_guard<std::mutex> lock(mutex_);
    Entry entry;
    entry.meta.id = id;
    entry.meta.size = static_cast<std::int64_t>(bytes.size());
    entry.raw_text = raw_text;
    entry.hash = fnv1a(bytes) ^ (static_cast<std::uint64_t>(bytes.size()) << 1);
    if (!raw_text) {
        const images::Probe probe = images::probe(bytes);
        entry.sniffed = probe.contentType;
        entry.meta.width = probe.width;
        entry.meta.height = probe.height;
        entry.meta.decodable = probe.decodable;
        entry.meta.willConvert = probe.decodable && !images::is_jpeg_or_png(probe.contentType);
    }
    entry.meta.contentType = content_type.empty() ? entry.sniffed : content_type;
    auto existing = entries_.find(id);
    if (existing != entries_.end()) {
        entry.meta.referenceCount = existing->second.meta.referenceCount;
        release_entry(existing->second);
        entries_.erase(existing);
    } else {
        order_.push_back(id);
    }
    entry.bytes = std::move(bytes);
    const auto size = static_cast<std::int64_t>(entry.bytes.size());
    if (size >= kMinSpillSize && memory_ + size > threshold_) {
        spill_entry(entry, id);
    }
    if (entry.spill.empty()) {
        memory_ += size;
    }
    const model::BinaryMeta meta = entry.meta;
    entries_[id] = std::move(entry);
    return meta;
}

bool BinaryStore::spill_entry(Entry& entry, const std::string& id) {
    std::error_code ec;
    if (spill_dir_.empty()) {
        std::random_device rd;
        const auto dir =
            std::filesystem::temp_directory_path(ec) /
            platform::path_from_utf8("mfbe-binaries-" + std::to_string(platform::current_pid()) +
                                     "-" + hex64((static_cast<std::uint64_t>(rd()) << 32) ^ rd()));
        if (ec || !std::filesystem::create_directories(dir, ec)) {
            log::warning("core", "binary.spillDirFailed", "cannot create the binary spill folder",
                         log::extras({{"reason", platform::utf8_error_message(ec)}}));
            return false;
        }
        spill_dir_ = dir;
    }
    const auto file = spill_dir_ / platform::path_from_utf8(hex64(++spill_counter_) + ".bin");
    {
        std::ofstream out(file, std::ios::binary | std::ios::trunc);
        if (!out) {
            log::warning("core", "binary.spillFailed", "cannot create a binary spill file",
                         log::extras({{"id", id}}));
            return false;
        }
        out.write(entry.bytes.data(), static_cast<std::streamsize>(entry.bytes.size()));
        if (!out) {
            std::filesystem::remove(file, ec);
            log::warning("core", "binary.spillFailed", "cannot write a binary spill file",
                         log::extras({{"id", id}}));
            return false;
        }
    }
    spilled_ += static_cast<std::int64_t>(entry.bytes.size());
    entry.spill = file;
    entry.bytes.clear();
    entry.bytes.shrink_to_fit();
    return true;
}

void BinaryStore::release_entry(Entry& entry) {
    if (!entry.spill.empty()) {
        std::error_code ec;
        std::filesystem::remove(entry.spill, ec);
        spilled_ -= entry.meta.size;
        entry.spill.clear();
    } else {
        memory_ -= static_cast<std::int64_t>(entry.bytes.size());
    }
    entry.bytes.clear();
}

std::optional<std::string> BinaryStore::read_entry(const Entry& entry) const {
    if (entry.spill.empty()) {
        return entry.bytes;
    }
    std::ifstream in(entry.spill, std::ios::binary);
    if (!in) {
        log::error("core", "binary.spillReadFailed", "cannot open a binary spill file",
                   log::extras({{"id", entry.meta.id}, {"size", std::to_string(entry.meta.size)}}));
        return std::nullopt;
    }
    std::string data(static_cast<std::size_t>(entry.meta.size), '\0');
    in.read(data.data(), static_cast<std::streamsize>(data.size()));
    if (static_cast<std::int64_t>(in.gcount()) != entry.meta.size) {
        log::error("core", "binary.spillReadFailed", "binary spill file is truncated",
                   log::extras({{"id", entry.meta.id},
                                {"size", std::to_string(entry.meta.size)},
                                {"read", std::to_string(in.gcount())}}));
        return std::nullopt;
    }
    return data;
}

bool BinaryStore::remove(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(id);
    if (it == entries_.end()) {
        return false;
    }
    release_entry(it->second);
    entries_.erase(it);
    order_.erase(std::remove(order_.begin(), order_.end(), id), order_.end());
    return true;
}

bool BinaryStore::contains(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return entries_.count(id) > 0;
}

std::optional<model::BinaryMeta> BinaryStore::meta(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(id);
    if (it == entries_.end()) {
        return std::nullopt;
    }
    return it->second.meta;
}

void BinaryStore::update_meta(const model::BinaryMeta& meta) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(meta.id);
    if (it != entries_.end()) {
        const auto size = it->second.meta.size;
        it->second.meta = meta;
        it->second.meta.size = size;  // size always reflects the stored bytes
    }
}

std::vector<model::BinaryMeta> BinaryStore::list() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<model::BinaryMeta> out;
    out.reserve(order_.size());
    for (const auto& id : order_) {
        auto it = entries_.find(id);
        if (it != entries_.end()) {
            out.push_back(it->second.meta);
        }
    }
    return out;
}

std::vector<std::string> BinaryStore::ids() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return order_;
}

std::size_t BinaryStore::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return entries_.size();
}

std::optional<std::string> BinaryStore::bytes(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(id);
    if (it == entries_.end()) {
        return std::nullopt;
    }
    return read_entry(it->second);
}

bool BinaryStore::is_raw_text(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(id);
    return it != entries_.end() && it->second.raw_text;
}

std::string BinaryStore::sniffed_type(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(id);
    return it == entries_.end() ? "" : it->second.sniffed;
}

std::string BinaryStore::effective_content_type(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(id);
    if (it == entries_.end()) {
        return "application/octet-stream";
    }
    return images::effective_content_type(it->second.meta.contentType, it->second.sniffed);
}

std::string BinaryStore::etag(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(id);
    if (it == entries_.end()) {
        return "";
    }
    return "\"" + hex64(it->second.hash) + "\"";
}

std::int64_t BinaryStore::total_bytes() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return memory_ + spilled_;
}

std::int64_t BinaryStore::memory_bytes() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return memory_;
}

std::int64_t BinaryStore::spilled_bytes() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return spilled_;
}

std::string BinaryStore::unique_id(const std::string& suggested) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const std::string base = suggested.empty() ? "binary" : suggested;
    if (!entries_.count(base)) {
        return base;
    }
    // Insert the counter before the extension when there is one: img.png -> img_2.png.
    const auto dot = base.rfind('.');
    const std::string stem = dot == std::string::npos ? base : base.substr(0, dot);
    const std::string ext = dot == std::string::npos ? "" : base.substr(dot);
    for (int n = 2;; ++n) {
        const std::string candidate = stem + "_" + std::to_string(n) + ext;
        if (!entries_.count(candidate)) {
            return candidate;
        }
    }
}

std::string BinaryStore::next_image_id(const std::string& content_type) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const std::string ext = images::extension_for(content_type);
    for (std::size_t n = entries_.size() + 1;; ++n) {
        const std::string candidate = "img_" + std::to_string(n) + "." + ext;
        if (!entries_.count(candidate)) {
            return candidate;
        }
    }
}

void BinaryStore::set_reference_counts(const std::map<std::string, int>& counts) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto& [id, entry] : entries_) {
        auto it = counts.find(id);
        entry.meta.referenceCount = it == counts.end() ? 0 : it->second;
    }
}

void BinaryStore::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto& [id, entry] : entries_) {
        release_entry(entry);
    }
    entries_.clear();
    order_.clear();
    memory_ = 0;
    spilled_ = 0;
}

/* ----------------------------------------------------------------------------------------- */
/* Document helpers                                                                           */
/* ----------------------------------------------------------------------------------------- */

namespace {

void count_href(const std::string& href, std::map<std::string, int>& counts) {
    if (href.size() > 1 && href[0] == '#') {
        ++counts[href.substr(1)];
    }
}

void count_coverpage(const model::TitleInfo& info, std::map<std::string, int>& counts) {
    for (const auto& image : info.coverpage) {
        count_href(image.href, counts);
    }
}

}  // namespace

void update_reference_counts(const model::Document& document, BinaryStore& store) {
    std::map<std::string, int> counts;
    count_coverpage(document.description.titleInfo, counts);
    if (document.description.srcTitleInfo) {
        count_coverpage(*document.description.srcTitleInfo, counts);
    }
    model::visit_nodes(document, [&](const model::Node& node, const std::string&) {
        if (node.type == "image" || node.type == "inline-image") {
            if (auto href = node.attr_string("href")) {
                count_href(*href, counts);
            }
        }
        return true;
    });
    store.set_reference_counts(counts);
}

void sync_binaries(model::Document& document, const BinaryStore& store) {
    document.binaries = store.list();
}

}  // namespace mfbe
