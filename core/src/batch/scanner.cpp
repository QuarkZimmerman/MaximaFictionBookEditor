// Feature 019 (T009): directory & ZIP archive scanner implementation.
#include "batch/scanner.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/mobi.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <set>
#include <system_error>
#include <unordered_set>

namespace mfbe::batch {
namespace {

namespace fs = std::filesystem;

constexpr std::size_t kMaxArchiveEntriesScan = 50000;
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
    const std::string tail = lower_ascii(s.substr(s.size() - suffix.size()));
    return tail == suffix;
}

// Normalizes an archive entry path to forward slashes for folder/stem matching.
std::string normalize_entry_slashes(std::string_view entry) {
    std::string out(entry);
    std::replace(out.begin(), out.end(), '\\', '/');
    return out;
}

std::pair<std::string, std::string> split_entry_dir_stem_ci(std::string_view entry) {
    const std::string norm = normalize_entry_slashes(entry);
    const std::size_t slash = norm.rfind('/');
    const std::string dir = slash == std::string::npos ? "" : norm.substr(0, slash);
    const std::string base = slash == std::string::npos ? norm : norm.substr(slash + 1);
    const std::size_t dot = base.rfind('.');
    const std::string stem = dot == std::string::npos ? base : base.substr(0, dot);
    return {lower_ascii(dir), lower_ascii(stem)};
}

std::optional<std::string> detect_book_format(std::string_view filename, Direction direction,
                                              const std::unordered_set<std::string>& allowed) {
    if (direction == Direction::fb2_to_export) {
        if (ends_with_ci(filename, ".fb2")) {
            return std::string("fb2");
        }
        return std::nullopt;
    }
    if (ends_with_ci(filename, ".epub") && allowed.count("epub") > 0) {
        return std::string("epub");
    }
    if (mobi::is_mobi_extension(filename) && allowed.count("mobi") > 0) {
        return std::string("mobi");
    }
    if (ends_with_ci(filename, ".pdf") && allowed.count("pdf") > 0) {
        return std::string("pdf");
    }
    if (ends_with_ci(filename, ".txt") && allowed.count("txt") > 0) {
        return std::string("txt");
    }
    if ((ends_with_ci(filename, ".md") || ends_with_ci(filename, ".markdown")) &&
        allowed.count("markdown") > 0) {
        return std::string("markdown");
    }
    return std::nullopt;
}

bool is_zip_bomb_entry(const archive::Entry& e) {
    if (e.size > archive::kMaxBookBytes) {
        return true;
    }
    if (e.size >= kBombSizeThreshold && e.compressed > 0 &&
        (e.size / e.compressed) > kBombMaxRatio) {
        return true;
    }
    return false;
}

std::string map_archive_reason(archive::Reason reason) {
    switch (reason) {
        case archive::Reason::encrypted:
            return "archive.encrypted";
        case archive::Reason::too_large:
            return "archive.tooLarge";
        case archive::Reason::multi_volume:
            return "archive.multiVolume";
        case archive::Reason::damaged:
        case archive::Reason::method:
        case archive::Reason::missing:
        default:
            return "archive.damaged";
    }
}

struct MatchedArchiveBook {
    archive::Entry entry;
    std::string format;
};

bool is_safe_archive_entry_name(std::string_view name) {
    if (name.empty() || name.find('\0') != std::string_view::npos) {
        return false;
    }
    if (name.front() == '/' || name.front() == '\\') {
        return false;
    }
    if (name.size() >= 2 && std::isalpha(static_cast<unsigned char>(name[0])) && name[1] == ':') {
        return false;
    }
    std::size_t pos = 0;
    while (pos < name.size()) {
        const std::size_t next = name.find_first_of("/\\", pos);
        const std::string_view part =
            next == std::string_view::npos ? name.substr(pos) : name.substr(pos, next - pos);
        if (part.empty() || part == "." || part == "..") {
            return false;
        }
        if (next == std::string_view::npos) {
            break;
        }
        pos = next + 1;
    }
    return true;
}

void scan_zip_file(const fs::path& file_path, const std::string& rel_dir,
                   const std::string& rel_file_display, const std::string& filename_utf8,
                   const ScanRequest& req, const std::unordered_set<std::string>& allowed,
                   ScanResult& result) {
    const std::string source_utf8 = platform::utf8_from_path(file_path);
    archive::Listing listing;
    try {
        listing = archive::list(file_path);
    } catch (const archive::ArchiveError& e) {
        result.scan_errors.push_back(
            ScanError{source_utf8, rel_file_display, map_archive_reason(e.reason), e.what()});
        return;
    } catch (const std::exception& e) {
        result.scan_errors.push_back(
            ScanError{source_utf8, rel_file_display, "archive.damaged", e.what()});
        return;
    }

    if (listing.entries.size() > kMaxArchiveEntriesScan) {
        result.scan_errors.push_back(ScanError{source_utf8, rel_file_display, "archive.tooLarge",
                                               "archive contains too many entries"});
        return;
    }

    // Sort central-directory records deterministically by UTF-8 entry name before classifying.
    std::vector<archive::Entry> sorted_entries = std::move(listing.entries);
    std::sort(sorted_entries.begin(), sorted_entries.end(),
              [](const archive::Entry& a, const archive::Entry& b) { return a.name < b.name; });

    std::vector<MatchedArchiveBook> matched;
    std::vector<std::string> fbd_entries;

    for (const archive::Entry& entry : sorted_entries) {
        if (entry.directory) {
            continue;
        }
        // Nested archives are ignored silently per spec.
        if (ends_with_ci(entry.name, ".zip")) {
            continue;
        }
        if (req.direction == Direction::import_to_fb2 && ends_with_ci(entry.name, ".fbd")) {
            if (is_safe_archive_entry_name(entry.name)) {
                fbd_entries.push_back(entry.name);
            }
            continue;
        }
        const auto fmt = detect_book_format(entry.name, req.direction, allowed);
        if (!fmt) {
            continue;
        }
        if (!is_safe_archive_entry_name(entry.name)) {
            result.scan_errors.push_back(ScanError{source_utf8,
                                                   rel_file_display + " :: " + entry.name,
                                                   "archive.damaged", "unsafe archive entry path"});
            continue;
        }
        if ((entry.flags & 0x1u) != 0) {
            result.scan_errors.push_back(ScanError{source_utf8,
                                                   rel_file_display + " :: " + entry.name,
                                                   "archive.encrypted", entry.name});
            continue;
        }
        if (is_zip_bomb_entry(entry)) {
            result.scan_errors.push_back(ScanError{source_utf8,
                                                   rel_file_display + " :: " + entry.name,
                                                   "archive.tooLarge", entry.name});
            continue;
        }
        matched.push_back(MatchedArchiveBook{entry, *fmt});
    }

    if (matched.empty()) {
        return;  // Bookless ZIP archive (or only already-reported entry errors).
    }

    const bool multi_book = matched.size() >= 2;
    const std::string stem = strip_archive_stem(filename_utf8);

    for (const MatchedArchiveBook& book : matched) {
        DiscoveredItem item;
        item.source_path = source_utf8;
        item.relative_dir = rel_dir;
        item.display_path =
            multi_book ? (rel_file_display + " :: " + book.entry.name) : rel_file_display;
        item.format = book.format;
        item.archive_entry = book.entry.name;
        item.archive_multi_book = multi_book;
        item.archive_stem = stem;
        item.size_bytes = book.entry.size;

        if (req.direction == Direction::import_to_fb2 && !fbd_entries.empty()) {
            const auto [book_dir, book_stem] = split_entry_dir_stem_ci(book.entry.name);
            for (const std::string& fbd : fbd_entries) {
                const auto [fbd_dir, fbd_stem] = split_entry_dir_stem_ci(fbd);
                if (fbd_dir == book_dir && fbd_stem == book_stem) {
                    item.archive_fbd_entry = fbd;
                    break;
                }
            }
            if (!item.archive_fbd_entry && !multi_book && fbd_entries.size() == 1) {
                item.archive_fbd_entry = fbd_entries.front();
            }
        }
        result.items.push_back(std::move(item));
    }
}

}  // namespace

std::string strip_archive_stem(std::string_view filename) {
    static constexpr std::string_view kSuffixes[] = {".fb2.zip", ".md.zip", ".markdown.zip",
                                                     ".zip"};
    for (const std::string_view suffix : kSuffixes) {
        if (ends_with_ci(filename, suffix) && filename.size() > suffix.size()) {
            return std::string(filename.substr(0, filename.size() - suffix.size()));
        }
    }
    const std::size_t dot = filename.rfind('.');
    if (dot != std::string_view::npos && dot > 0) {
        return std::string(filename.substr(0, dot));
    }
    return std::string(filename);
}

ScanResult scan_directory(const ScanRequest& req, const ScanCallbacks& callbacks) {
    const std::string raw_utf8 = platform::utf8_from_path(req.source_dir);
    if (req.source_dir.empty()) {
        throw ScanException("sourceNotFound", raw_utf8, "source directory path is empty");
    }
    std::error_code ec;
    if (!fs::exists(req.source_dir, ec)) {
        throw ScanException("sourceNotFound", raw_utf8,
                            ec ? platform::utf8_error_message(ec) : "folder does not exist");
    }
    if (!fs::is_directory(req.source_dir, ec)) {
        throw ScanException("sourceNotDirectory", raw_utf8, "path is not a directory");
    }

    // Verify top-level directory is readable before committing to the walk.
    {
        fs::directory_iterator probe(req.source_dir, ec);
        if (ec) {
            throw ScanException("sourceUnreadable", raw_utf8, platform::utf8_error_message(ec));
        }
    }

    fs::path normalized_root = fs::weakly_canonical(req.source_dir, ec);
    if (ec || normalized_root.empty()) {
        ec.clear();
        normalized_root = fs::absolute(req.source_dir, ec);
        if (ec || normalized_root.empty()) {
            normalized_root = req.source_dir;
        }
    }

    std::unordered_set<std::string> allowed(req.formats.begin(), req.formats.end());
    ScanResult result;
    result.source_dir = platform::utf8_from_path(normalized_root);

    // Track visited canonical directories so circular symlinks/junctions and symlink DAGs neither
    // loop infinitely nor duplicate books.
    std::set<std::string> visited_dirs;
    {
        std::error_code cec;
        const fs::path canon = fs::canonical(normalized_root, cec);
        visited_dirs.insert(platform::utf8_from_path(cec ? normalized_root : canon));
    }

    std::int64_t inspected = 0;

    std::function<void(const fs::path&, const std::string&)> walk =
        [&](const fs::path& dir, const std::string& rel_dir) {
            if (callbacks.is_cancelled && callbacks.is_cancelled()) {
                throw ScanException("cancelled", result.source_dir, "scan cancelled");
            }
            std::error_code it_ec;
            fs::directory_iterator it(dir, it_ec);
            if (it_ec) {
                result.scan_errors.push_back(ScanError{
                    platform::utf8_from_path(dir), rel_dir.empty() ? result.source_dir : rel_dir,
                    "scan.unreadableDir", platform::utf8_error_message(it_ec)});
                return;
            }

            struct NamedEntry {
                std::string name;
                fs::path path;
            };
            std::vector<NamedEntry> entries;
            for (const fs::directory_entry& de : it) {
                entries.push_back(
                    NamedEntry{platform::utf8_from_path(de.path().filename()), de.path()});
            }
            std::sort(entries.begin(), entries.end(),
                      [](const NamedEntry& a, const NamedEntry& b) { return a.name < b.name; });

            for (const NamedEntry& entry : entries) {
                if (callbacks.is_cancelled && callbacks.is_cancelled()) {
                    throw ScanException("cancelled", result.source_dir, "scan cancelled");
                }
                const std::string rel_path =
                    rel_dir.empty() ? entry.name : (rel_dir + "/" + entry.name);

                std::error_code st_ec;
                const fs::file_status st = fs::status(entry.path, st_ec);
                if (st_ec) {
                    // Broken symlink or vanished entry: skip without halting the scan.
                    continue;
                }

                if (fs::is_directory(st)) {
                    if (!req.include_subfolders) {
                        continue;
                    }
                    std::error_code canon_ec;
                    const fs::path canon = fs::canonical(entry.path, canon_ec);
                    if (canon_ec) {
                        continue;
                    }
                    const std::string canon_key = platform::utf8_from_path(canon);
                    if (!visited_dirs.insert(canon_key).second) {
                        continue;  // Symlink/junction cycle or duplicate directory mount.
                    }
                    walk(entry.path, rel_path);
                    continue;
                }

                if (!fs::is_regular_file(st)) {
                    continue;
                }

                ++inspected;
                if (callbacks.on_progress) {
                    callbacks.on_progress(inspected);
                }

                // Check bare book formats first so .epub (which is a ZIP container by magic bytes)
                // is never misclassified as a generic .zip wrapper.
                if (const auto fmt = detect_book_format(entry.name, req.direction, allowed)) {
                    std::error_code sz_ec;
                    const std::uintmax_t sz = fs::file_size(entry.path, sz_ec);
                    DiscoveredItem item;
                    item.source_path = platform::utf8_from_path(entry.path);
                    item.relative_dir = rel_dir;
                    item.display_path = rel_path;
                    item.format = *fmt;
                    item.size_bytes = sz_ec ? 0ULL : static_cast<std::uint64_t>(sz);
                    result.items.push_back(std::move(item));
                    continue;
                }

                if (ends_with_ci(entry.name, ".zip")) {
                    scan_zip_file(entry.path, rel_dir, rel_path, entry.name, req, allowed, result);
                }
            }
        };

    walk(normalized_root, "");

    for (std::size_t i = 0; i < result.items.size(); ++i) {
        result.items[i].item_id = "i" + std::to_string(i + 1);
    }
    return result;
}

}  // namespace mfbe::batch
