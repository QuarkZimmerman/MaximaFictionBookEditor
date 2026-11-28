// Feature 023 (T008; data-model.md §2): hostile-safe OOXML DOCX archive reader, macro part
// stripping, traversal exclusion, and sibling FBD lookup.
#include <mfbe/archive.hpp>
#include <mfbe/docx.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace mfbe::docx {
namespace {

namespace fs = std::filesystem;

std::string lower_ascii(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return out;
}

bool is_macro_entry(std::string_view folded) {
    return folded == "word/vbaproject.bin" || folded == "word/vbadata.xml" ||
           folded == "word/_rels/vbaproject.bin.rels" ||
           folded.find("vbaproject") != std::string_view::npos;
}

}  // namespace

bool valid_docx_entry_name(std::string_view name) {
    if (name.empty() || name.front() == '/' || name.back() == '/') {
        return false;
    }
    if (name.find('\\') != std::string_view::npos || name.find('\0') != std::string_view::npos) {
        return false;
    }
    std::size_t pos = 0;
    while (pos <= name.size()) {
        const std::size_t next = name.find('/', pos);
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

std::string fold_docx_entry_name(std::string_view name) {
    return lower_ascii(name);
}

DocxOpenedArchive open_docx_archive(const fs::path& path, const DocxArchiveLimits& limits) {
    std::error_code ec;
    if (!fs::is_regular_file(path, ec)) {
        throw DocxRefused(DocxRefusal::not_docx, "file does not exist");
    }
    const std::uint64_t file_size = fs::file_size(path, ec);
    if (ec || file_size == 0) {
        throw DocxRefused(DocxRefusal::damaged, "file is empty or unreadable");
    }
    if (file_size > limits.max_file_bytes) {
        throw DocxRefused(DocxRefusal::too_large, "DOCX exceeds maximum allowed file size");
    }

    const DocxSniffResult sniff = sniff_docx_file(path, limits);
    switch (sniff.kind) {
        case DocxSniffKind::docx:
            break;
        case DocxSniffKind::encrypted_office:
            throw DocxRefused(DocxRefusal::encrypted, sniff.detail);
        case DocxSniffKind::legacy_doc:
            throw DocxRefused(DocxRefusal::legacy_doc, sniff.detail);
        case DocxSniffKind::macro_enabled_docm:
            throw DocxRefused(DocxRefusal::macro_enabled, sniff.detail);
        case DocxSniffKind::fiction_book:
            throw DocxRefused(DocxRefusal::fiction_book, sniff.detail);
        case DocxSniffKind::other_archive:
            throw DocxRefused(DocxRefusal::other_archive, sniff.detail);
        case DocxSniffKind::outer_zip_with_docx:
        case DocxSniffKind::not_docx:
            throw DocxRefused(DocxRefusal::not_docx, sniff.detail);
    }

    archive::Listing listing;
    try {
        listing = archive::list(path);
    } catch (const archive::ArchiveError& e) {
        if (e.reason == archive::Reason::encrypted) {
            throw DocxRefused(DocxRefusal::encrypted, e.what());
        }
        if (e.reason == archive::Reason::too_large) {
            throw DocxRefused(DocxRefusal::too_large, e.what());
        }
        throw DocxRefused(DocxRefusal::damaged, e.what());
    }

    if (listing.entries.size() > limits.max_entries) {
        throw DocxRefused(DocxRefusal::too_many_entries, "DOCX has too many ZIP entries");
    }

    DocxOpenedArchive opened;
    opened.path = path;

    std::uint64_t total_unpacked = 0;
    bool has_main_document = false;

    for (const archive::Entry& rec : listing.entries) {
        if (rec.directory) {
            continue;
        }
        if ((rec.flags & 1u) != 0) {
            throw DocxRefused(DocxRefusal::encrypted, "DOCX contains an encrypted ZIP entry");
        }
        if (!valid_docx_entry_name(rec.name)) {
            opened.outside_entries.push_back(rec.name);
            continue;
        }

        // Check cumulative unpacked cap and compression ratio before exposing any entry.
        if (rec.size > limits.max_unpacked_bytes ||
            total_unpacked > limits.max_unpacked_bytes - rec.size) {
            throw DocxRefused(DocxRefusal::zip_bomb, "DOCX unpacked size exceeds safety limit");
        }
        if (rec.size > limits.ratio_floor_bytes && rec.compressed > 0 &&
            (rec.size / rec.compressed) > limits.max_ratio) {
            throw DocxRefused(DocxRefusal::zip_bomb, "DOCX entry exceeds compression ratio cap");
        }
        total_unpacked += rec.size;

        const std::string folded = fold_docx_entry_name(rec.name);
        if (is_macro_entry(folded)) {
            opened.stray_macro_entries.push_back(rec.name);
            continue;
        }
        if (folded == "word/document.xml") {
            has_main_document = true;
        }

        // Keep first entry on case-folded duplicates, matching ZIP/EPUB defensive convention.
        if (opened.index.count(folded) != 0) {
            continue;
        }
        const std::size_t slot = opened.records.size();
        opened.index.emplace(folded, slot);
        opened.entries.push_back(DocxEntryInfo{rec.name, rec.size, rec.compressed});
        opened.records.push_back(rec);
    }

    if (!has_main_document) {
        throw DocxRefused(DocxRefusal::not_docx, "DOCX is missing word/document.xml");
    }

    return opened;
}

std::string read_docx_entry(const DocxOpenedArchive& opened, const std::string& entry,
                            const DocxArchiveLimits& limits) {
    const std::string folded = fold_docx_entry_name(entry);
    const auto it = opened.index.find(folded);
    if (it == opened.index.end()) {
        throw std::out_of_range("DOCX entry not offered: " + entry);
    }
    const archive::Entry& rec = opened.records[it->second];
    if (rec.size > limits.max_unpacked_bytes) {
        throw DocxRefused(DocxRefusal::zip_bomb, "DOCX entry exceeds unpacked limit");
    }
    if (rec.size > limits.ratio_floor_bytes && rec.compressed > 0 &&
        (rec.size / rec.compressed) > limits.max_ratio) {
        throw DocxRefused(DocxRefusal::zip_bomb, "DOCX entry exceeds compression ratio cap");
    }
    try {
        return archive::read_entry_at(opened.path, rec);
    } catch (const archive::ArchiveError& e) {
        if (e.reason == archive::Reason::too_large) {
            throw DocxRefused(DocxRefusal::zip_bomb, e.what());
        }
        if (e.reason == archive::Reason::encrypted) {
            throw DocxRefused(DocxRefusal::encrypted, e.what());
        }
        throw DocxRefused(DocxRefusal::damaged, e.what());
    }
}

std::optional<fs::path> find_sibling_fbd(const fs::path& docx_path) {
    const fs::path dir = docx_path.parent_path();
    const fs::path stem = docx_path.stem();
    if (stem.empty()) {
        return std::nullopt;
    }

    // Exact stem + `.fbd` match first.
    const fs::path exact = dir / platform::path_from_utf8(platform::utf8_from_path(stem) + ".fbd");
    std::error_code ec;
    if (fs::is_regular_file(exact, ec)) {
        return exact;
    }

    // Fallback: unique case-insensitive match in the same folder (matching 017 D39 / 018 D21).
    const std::string wanted = lower_ascii(platform::utf8_from_path(stem) + ".fbd");
    std::optional<fs::path> found;
    if (dir.empty()) {
        return std::nullopt;
    }
    for (const fs::directory_entry& de : fs::directory_iterator(dir, ec)) {
        if (ec || !de.is_regular_file(ec)) {
            continue;
        }
        const std::string fname = lower_ascii(platform::utf8_from_path(de.path().filename()));
        if (fname == wanted) {
            if (found.has_value()) {
                return std::nullopt;  // ambiguous case-insensitive match
            }
            found = de.path();
        }
    }
    return found;
}

}  // namespace mfbe::docx
