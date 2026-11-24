// Feature 019 (T010; contracts/rpc-api.md §3.4): safe archive entry extraction for EPUB-in-ZIP
// and .md.zip inputs into a jailed per-item temp directory.
#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>

namespace mfbe::batch {

inline constexpr std::uint64_t kMaxExtractSingleBytes = 150ULL * 1024 * 1024;  // 150 MB
inline constexpr std::uint64_t kMaxExtractTotalBytes = 256ULL * 1024 * 1024;   // 256 MiB
inline constexpr std::size_t kMaxExtractEntries = 5000;

struct ExtractedEntry {
    std::filesystem::path temp_dir;
    std::filesystem::path extracted_path;
    std::optional<std::filesystem::path> fbd_path;
};

struct ExtractError : std::runtime_error {
    ExtractError(std::string path_, std::string detail_, bool cancelled_ = false)
        : std::runtime_error(detail_),
          path(std::move(path_)),
          detail(std::move(detail_)),
          cancelled(cancelled_) {}
    std::string path;
    std::string detail;
    bool cancelled = false;
};

using ExtractCancelFn = std::function<bool()>;

// Extracts `entry` (format "epub" or "markdown"), optional `fbd_entry`, and for Markdown any safe
// sibling image/CSS assets into `dest_dir`. Refuses path traversal, encrypted entries, nested
// archives, and decompression bombs; removes `dest_dir` on any error or cancellation.
ExtractedEntry extract_archive_entry(const std::filesystem::path& archive_path,
                                     const std::string& entry, const std::string& format,
                                     const std::optional<std::string>& fbd_entry,
                                     const std::filesystem::path& dest_dir,
                                     const ExtractCancelFn& is_cancelled = {});

}  // namespace mfbe::batch
