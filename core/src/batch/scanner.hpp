// Feature 019 (T009; contracts/rpc-api.md §3.1, data-model.md §4): deterministic directory and
// ZIP archive scanner for the Batch Converter.
#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::batch {

enum class Direction {
    fb2_to_export,
    import_to_fb2,
};

struct ScanRequest {
    Direction direction = Direction::fb2_to_export;
    std::filesystem::path source_dir;
    bool include_subfolders = true;
    // Selected source formats when direction == import_to_fb2:
    // subset of {"epub", "mobi", "pdf", "txt", "markdown"}.
    std::vector<std::string> formats;
};

struct DiscoveredItem {
    std::string item_id;
    std::string source_path;
    std::string relative_dir;
    std::string display_path;
    std::string format;
    std::optional<std::string> archive_entry;
    bool archive_multi_book = false;
    std::optional<std::string> archive_stem;
    std::optional<std::string> archive_fbd_entry;
    std::uint64_t size_bytes = 0;
};

struct ScanError {
    std::string source_path;
    std::string display_path;
    std::string reason_code;
    std::string detail;
};

struct ScanResult {
    std::string source_dir;
    std::vector<DiscoveredItem> items;
    std::vector<ScanError> scan_errors;
};

struct ScanCallbacks {
    std::function<bool()> is_cancelled;
    std::function<void(std::int64_t inspected)> on_progress;
};

struct ScanException : std::runtime_error {
    ScanException(std::string reason_, std::string path_, std::string detail_ = "")
        : std::runtime_error(detail_.empty() ? reason_ : (reason_ + ": " + detail_)),
          reason(std::move(reason_)),
          path(std::move(path_)),
          detail(std::move(detail_)) {}
    std::string reason;  // sourceNotFound | sourceNotDirectory | sourceUnreadable | cancelled
    std::string path;
    std::string detail;
};

// Strips compound archive extensions (.fb2.zip, .md.zip, .markdown.zip) or a trailing .zip
// (case-insensitive) to compute the output base name of an archive.
std::string strip_archive_stem(std::string_view filename);

// Walks req.source_dir deterministically and returns a frozen snapshot of convertible items plus
// non-fatal scan errors (damaged/encrypted/bomb archives, unreadable subfolders).
ScanResult scan_directory(const ScanRequest& req, const ScanCallbacks& callbacks = {});

}  // namespace mfbe::batch
