// Candidate payload file validation for FBD ZIP package mode (feature 022, FR-011).
#include <mfbe/archive.hpp>
#include <mfbe/epub.hpp>
#include <mfbe/fbd_package.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <string>
#include <string_view>

namespace mfbe::package {
namespace {

namespace fs = std::filesystem;

std::string ascii_lower(std::string_view text) {
    std::string out(text);
    for (char& ch : out) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return out;
}

char32_t fold_codepoint(char32_t cp) {
    if (cp >= U'A' && cp <= U'Z') {
        return cp + (U'a' - U'A');
    }
    // Cyrillic capital A..YA -> small a..ya, plus IO and Ukrainian IE/I/YI/GHE.
    if (cp >= 0x0410 && cp <= 0x042F) {
        return cp + 0x20;
    }
    if (cp >= 0x0400 && cp <= 0x040F) {
        return cp + 0x50;
    }
    if (cp == 0x0490) {  // Ukrainian GHE WITH UPTURN
        return 0x0491;
    }
    if (cp >= 0x00C0 && cp <= 0x00DE && cp != 0x00D7) {
        return cp + 0x20;
    }
    return cp;
}

bool is_docx_zip(const fs::path& path) {
    try {
        const archive::Listing listing = archive::list(path);
        bool has_content_types = false;
        bool has_word_dir = false;
        for (const archive::Entry& e : listing.entries) {
            const std::string lower = ascii_lower(e.name);
            if (lower == "[content_types].xml") {
                has_content_types = true;
            } else if (lower.rfind("word/", 0) == 0) {
                has_word_dir = true;
            }
            if (has_content_types && has_word_dir) {
                return true;
            }
        }
    } catch (...) {
        return false;
    }
    return false;
}

bool is_odt_zip(const fs::path& path) {
    try {
        const archive::Listing listing = archive::list(path);
        for (const archive::Entry& e : listing.entries) {
            const std::string lower = ascii_lower(e.name);
            if (lower == "mimetype") {
                const std::string mime = archive::read_entry_at(path, e);
                if (mime.rfind("application/vnd.oasis.opendocument.", 0) == 0) {
                    return true;
                }
            }
        }
        bool has_content = false;
        bool has_manifest = false;
        for (const archive::Entry& e : listing.entries) {
            const std::string lower = ascii_lower(e.name);
            if (lower == "content.xml") {
                has_content = true;
            } else if (lower == "meta-inf/manifest.xml") {
                has_manifest = true;
            }
            if (has_content && has_manifest) {
                return true;
            }
        }
    } catch (...) {
        return false;
    }
    return false;
}

bool looks_like_fictionbook_xml(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return false;
    }
    std::string head(4096, '\0');
    in.read(head.data(), static_cast<std::streamsize>(head.size()));
    head.resize(static_cast<std::size_t>(in.gcount()));
    if (head.size() >= 3 && static_cast<unsigned char>(head[0]) == 0xEF &&
        static_cast<unsigned char>(head[1]) == 0xBB &&
        static_cast<unsigned char>(head[2]) == 0xBF) {
        head.erase(0, 3);
    }
    // Check UTF-16 LE/BE `<FictionBook` signature as well as UTF-8 / single-byte XML.
    if (head.size() >= 2 &&
        ((static_cast<unsigned char>(head[0]) == 0xFF &&
          static_cast<unsigned char>(head[1]) == 0xFE) ||
         (static_cast<unsigned char>(head[0]) == 0xFE &&
          static_cast<unsigned char>(head[1]) == 0xFF))) {
        std::string ascii_only;
        ascii_only.reserve(head.size() / 2);
        for (char c : head) {
            if (static_cast<unsigned char>(c) >= 0x20 && static_cast<unsigned char>(c) < 0x7F) {
                ascii_only.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
            }
        }
        return ascii_only.find("<fictionbook") != std::string::npos;
    }
    const std::string lower = ascii_lower(head);
    const std::size_t pos = lower.find("<fictionbook");
    if (pos == std::string::npos) {
        return false;
    }
    const std::size_t after = pos + 12;
    if (after >= lower.size()) {
        return true;
    }
    const char next = lower[after];
    return next == '>' || next == ' ' || next == '\t' || next == '\r' || next == '\n' ||
           next == '/';
}

}  // namespace

const char* file_reject_reason_name(FileRejectReason reason) {
    switch (reason) {
        case FileRejectReason::none:
            return "";
        case FileRejectReason::not_found:
            return "notFound";
        case FileRejectReason::not_file:
            return "notFile";
        case FileRejectReason::unreadable:
            return "unreadable";
        case FileRejectReason::forbidden_fb2:
            return "forbiddenFb2";
        case FileRejectReason::forbidden_fbd:
            return "forbiddenFbd";
        case FileRejectReason::forbidden_archive:
            return "forbiddenArchive";
        case FileRejectReason::duplicate_stem:
            return "duplicateStem";
    }
    return "unreadable";
}

const char* archive_error_reason_name(ArchiveErrorReason reason) {
    switch (reason) {
        case ArchiveErrorReason::none:
            return "";
        case ArchiveErrorReason::not_zip:
            return "notZip";
        case ArchiveErrorReason::damaged:
            return "damaged";
        case ArchiveErrorReason::encrypted:
            return "encrypted";
        case ArchiveErrorReason::multi_volume:
            return "multiVolume";
        case ArchiveErrorReason::no_fbd:
            return "noFbd";
        case ArchiveErrorReason::no_payload:
            return "noPayload";
        case ArchiveErrorReason::duplicate_stem:
            return "duplicateStem";
        case ArchiveErrorReason::fbd_parse_error:
            return "fbdParseError";
        case ArchiveErrorReason::fbd_not_fictionbook:
            return "fbdNotFictionBook";
    }
    return "damaged";
}

std::string make_stem_key(std::string_view stem) {
    const std::vector<char32_t> cps = unicode::decode_utf8(stem);
    std::string out;
    out.reserve(stem.size());
    for (char32_t cp : cps) {
        unicode::append_utf8(out, fold_codepoint(cp));
    }
    return out;
}

std::pair<std::string, std::string> split_name_and_lower_ext(std::string_view utf8_name) {
    const std::size_t dot = utf8_name.rfind('.');
    if (dot == std::string_view::npos || dot == 0 || dot + 1 >= utf8_name.size()) {
        return {std::string(utf8_name), ""};
    }
    return {std::string(utf8_name.substr(0, dot)), ascii_lower(utf8_name.substr(dot + 1))};
}

bool is_forbidden_archive_extension(std::string_view extension) {
    static const std::set<std::string> kForbidden = {
        "zip",  "rar", "7z",  "tar", "gz",  "tgz", "bz2",
        "tbz2", "xz",  "txz", "zst", "cab", "cbz", "cbr",
    };
    return kForbidden.contains(ascii_lower(extension));
}

CandidateFileCheck validate_candidate_payload(
    const fs::path& path, const std::map<std::string, std::string>& existing_stems) {
    CandidateFileCheck out;
    const std::string raw_name = platform::utf8_from_path(path.filename());
    auto [stem, ext] = split_name_and_lower_ext(raw_name);
    out.stem = stem;
    out.extension = ext;
    out.stemKey = make_stem_key(stem);
    out.fileName = ext.empty() ? stem : (stem + "." + ext);

    std::error_code ec;
    const fs::file_status st = fs::status(path, ec);
    if (ec || !fs::exists(st)) {
        out.reason = FileRejectReason::not_found;
        return out;
    }
    if (fs::is_directory(st)) {
        out.reason = FileRejectReason::not_file;
        return out;
    }
    if (!fs::is_regular_file(st)) {
        out.reason = FileRejectReason::unreadable;
        return out;
    }
    const std::uintmax_t file_size = fs::file_size(path, ec);
    if (ec) {
        out.reason = FileRejectReason::unreadable;
        return out;
    }
    out.size = static_cast<std::uint64_t>(file_size);

    // Verify file is actually readable before inspecting content.
    {
        std::ifstream probe(path, std::ios::binary);
        if (!probe) {
            out.reason = FileRejectReason::unreadable;
            return out;
        }
    }

    if (ext == "fb2") {
        out.reason = FileRejectReason::forbidden_fb2;
        return out;
    }
    if (ext == "fbd") {
        out.reason = FileRejectReason::forbidden_fbd;
        return out;
    }
    if (is_forbidden_archive_extension(ext)) {
        out.reason = FileRejectReason::forbidden_archive;
        return out;
    }

    const archive::Kind kind = archive::detect_kind(path);
    if (archive::is_other_archive(kind)) {
        out.reason = FileRejectReason::forbidden_archive;
        return out;
    }
    if (kind == archive::Kind::zip) {
        // ZIP-packaged book formats (.epub, .docx, .odt) are valid non-FB2 books; generic or
        // renamed ZIP archives are refused.
        bool valid_zip_book = false;
        if (ext == "epub") {
            valid_zip_book = epub::is_epub(path);
        } else if (ext == "docx") {
            valid_zip_book = is_docx_zip(path);
        } else if (ext == "odt") {
            valid_zip_book = is_odt_zip(path);
        }
        if (!valid_zip_book) {
            out.reason = FileRejectReason::forbidden_archive;
            return out;
        }
    } else if (looks_like_fictionbook_xml(path)) {
        out.reason = FileRejectReason::forbidden_fb2;
        return out;
    }

    const auto conflict = existing_stems.find(out.stemKey);
    if (conflict != existing_stems.end()) {
        out.reason = FileRejectReason::duplicate_stem;
        out.conflictWith = conflict->second;
        return out;
    }

    out.accepted = true;
    return out;
}

}  // namespace mfbe::package
