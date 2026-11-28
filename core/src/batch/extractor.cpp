// Feature 019 (T010): safe archive extraction implementation for EPUB-in-ZIP and .md.zip.
#include "batch/extractor.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <string_view>
#include <system_error>
#include <vector>

namespace mfbe::batch {
namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kBombSizeThreshold = 10ULL * 1024 * 1024;  // 10 MiB
constexpr std::uint64_t kBombMaxRatio = 100;

std::string lower_ascii(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (const char c : s) {
        out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return out;
}

bool ends_with_ci(std::string_view s, std::string_view suffix) {
    if (s.size() < suffix.size()) {
        return false;
    }
    return lower_ascii(s.substr(s.size() - suffix.size())) == suffix;
}

bool is_nested_archive_name(std::string_view name) {
    static constexpr std::string_view kExts[] = {".zip", ".rar", ".7z", ".tar",
                                                 ".gz",  ".bz2", ".xz", ".cab"};
    for (const std::string_view ext : kExts) {
        if (ends_with_ci(name, ext)) {
            return true;
        }
    }
    return false;
}

bool is_markdown_asset(std::string_view name) {
    static constexpr std::string_view kAssetExts[] = {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".avif", ".css"};
    for (const std::string_view ext : kAssetExts) {
        if (ends_with_ci(name, ext)) {
            return true;
        }
    }
    return false;
}

// Validates that an archive entry name is strictly relative with no drive letter, absolute root,
// NUL byte, or parent-traversal segment, and returns the safe relative path.
bool safe_relative_entry_path(std::string_view entry, fs::path& rel_out) {
    if (entry.empty()) {
        return false;
    }
    if (entry.find('\0') != std::string_view::npos) {
        return false;
    }
    if (entry.front() == '/' || entry.front() == '\\') {
        return false;
    }
    if (entry.size() >= 2 && std::isalpha(static_cast<unsigned char>(entry[0])) &&
        entry[1] == ':') {
        return false;
    }
    fs::path rel;
    std::size_t pos = 0;
    while (pos < entry.size()) {
        std::size_t next = entry.find_first_of("/\\", pos);
        const std::string_view part =
            next == std::string_view::npos ? entry.substr(pos) : entry.substr(pos, next - pos);
        if (part.empty() || part == "." || part == "..") {
            return false;
        }
        rel /= platform::path_from_utf8(part);
        if (next == std::string_view::npos) {
            break;
        }
        pos = next + 1;
    }
    if (rel.empty() || rel.is_absolute()) {
        return false;
    }
    rel_out = rel;
    return true;
}

void cleanup_dir(const fs::path& dir) {
    std::error_code ec;
    fs::remove_all(dir, ec);
}

}  // namespace

ExtractedEntry extract_archive_entry(const fs::path& archive_path, const std::string& entry,
                                     const std::string& format,
                                     const std::optional<std::string>& fbd_entry,
                                     const fs::path& dest_dir,
                                     const ExtractCancelFn& is_cancelled) {
    const std::string archive_utf8 = platform::utf8_from_path(archive_path);
    if (format != "epub" && format != "markdown" && format != "docx") {
        throw ExtractError(archive_utf8, "unsupported extraction format: " + format);
    }

    fs::path main_rel;
    if (!safe_relative_entry_path(entry, main_rel)) {
        throw ExtractError(archive_utf8, "unsafe archive entry path refused: " + entry);
    }

    std::optional<fs::path> fbd_rel;
    if (fbd_entry && !fbd_entry->empty()) {
        fs::path rel;
        if (!safe_relative_entry_path(*fbd_entry, rel)) {
            throw ExtractError(archive_utf8, "unsafe companion FBD path refused: " + *fbd_entry);
        }
        fbd_rel = std::move(rel);
    }

    archive::Listing listing;
    try {
        listing = archive::list(archive_path);
    } catch (const archive::ArchiveError& e) {
        throw ExtractError(archive_utf8, e.what());
    } catch (const std::exception& e) {
        throw ExtractError(archive_utf8, e.what());
    }

    const archive::Entry* target_record = nullptr;
    const archive::Entry* fbd_record = nullptr;
    for (const archive::Entry& rec : listing.entries) {
        if (rec.directory) {
            continue;
        }
        if (rec.name == entry) {
            target_record = &rec;
        }
        if (fbd_entry && rec.name == *fbd_entry) {
            fbd_record = &rec;
        }
    }
    if (target_record == nullptr) {
        throw ExtractError(archive_utf8, "archive entry not found: " + entry);
    }

    std::error_code ec;
    fs::create_directories(dest_dir, ec);
    if (ec) {
        throw ExtractError(archive_utf8, platform::utf8_error_message(ec));
    }
    fs::permissions(dest_dir, fs::perms::owner_all, fs::perm_options::replace, ec);

    std::size_t extracted_count = 0;
    std::uint64_t total_bytes = 0;

    auto extract_one = [&](const archive::Entry& rec, const fs::path& rel) -> fs::path {
        if (is_cancelled && is_cancelled()) {
            throw ExtractError(archive_utf8, "extraction cancelled", true);
        }
        if (extracted_count >= kMaxExtractEntries) {
            throw ExtractError(archive_utf8, "archive exceeds maximum extracted entry limit");
        }
        if ((rec.flags & 0x1u) != 0) {
            throw ExtractError(archive_utf8, "archive entry is encrypted: " + rec.name);
        }
        if (rec.size > kMaxExtractSingleBytes) {
            throw ExtractError(archive_utf8, "archive entry exceeds 150 MB size limit");
        }
        if (rec.size >= kBombSizeThreshold && rec.compressed > 0 &&
            (rec.size / rec.compressed) > kBombMaxRatio) {
            throw ExtractError(archive_utf8, "archive entry exceeds safe compression ratio");
        }
        if (total_bytes + rec.size > kMaxExtractTotalBytes) {
            throw ExtractError(archive_utf8, "archive exceeds 256 MiB extracted size limit");
        }

        std::string bytes;
        try {
            if (rec.method == 0 || rec.method == 8) {
                bytes = archive::read_entry_at(archive_path, rec);
            } else {
                bytes = archive::read_entry(archive_path, rec.name);
            }
        } catch (const archive::ArchiveError& e) {
            throw ExtractError(archive_utf8, e.what());
        } catch (const std::exception& e) {
            throw ExtractError(archive_utf8, e.what());
        }

        if (bytes.size() > kMaxExtractSingleBytes ||
            total_bytes + bytes.size() > kMaxExtractTotalBytes) {
            throw ExtractError(archive_utf8, "extracted entry exceeds safety size ceiling");
        }

        const fs::path out_path = dest_dir / rel;
        std::error_code dir_ec;
        fs::create_directories(out_path.parent_path(), dir_ec);
        if (dir_ec) {
            throw ExtractError(archive_utf8, platform::utf8_error_message(dir_ec));
        }
        try {
            atomic_file::write_atomic(out_path, bytes);
        } catch (const atomic_file::WriteError& e) {
            throw ExtractError(e.path, e.reason);
        }
        ++extracted_count;
        total_bytes += bytes.size();
        return out_path;
    };

    try {
        ExtractedEntry result;
        result.temp_dir = dest_dir;
        result.extracted_path = extract_one(*target_record, main_rel);
        if (fbd_record != nullptr && fbd_rel) {
            result.fbd_path = extract_one(*fbd_record, *fbd_rel);
        }
        if (format == "markdown") {
            for (const archive::Entry& rec : listing.entries) {
                if (rec.directory || rec.name == entry || (fbd_entry && rec.name == *fbd_entry)) {
                    continue;
                }
                if (is_nested_archive_name(rec.name) || !is_markdown_asset(rec.name)) {
                    continue;
                }
                fs::path asset_rel;
                if (!safe_relative_entry_path(rec.name, asset_rel)) {
                    continue;  // Silently skip traversal entries among auxiliary archive files.
                }
                extract_one(rec, asset_rel);
            }
        }
        return result;
    } catch (...) {
        cleanup_dir(dest_dir);
        throw;
    }
}

}  // namespace mfbe::batch
