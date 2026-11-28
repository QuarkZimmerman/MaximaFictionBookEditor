// Feature 023 (T007; research.md §R3): deterministic DOCX format sniffer.
// Classifies `.docx`, outer `.zip` containing `.docx`, encrypted Office `.docx` (OLE2
// `EncryptedPackage`/`EncryptionInfo`), legacy Word 97-2003 `.doc` (OLE2 `WordDocument`),
// macro-enabled `.docm`, FictionBook XML, other archives, and unrelated files.
#include <mfbe/archive.hpp>
#include <mfbe/docx.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <limits>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::docx {
namespace {

namespace fs = std::filesystem;

constexpr std::uint8_t kOle2Magic[8] = {0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1};
constexpr std::uint32_t kEndOfChain = 0xFFFFFFFEu;
constexpr std::uint32_t kFreeSector = 0xFFFFFFFFu;
constexpr std::size_t kMaxOle2DirectorySectors = 256;
constexpr std::uint64_t kMaxContentTypesBytes = 4ull << 20;

std::string lower_ascii(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return out;
}

std::uint16_t read_u16_le(const std::uint8_t* p) {
    return static_cast<std::uint16_t>(static_cast<unsigned>(p[0]) |
                                      (static_cast<unsigned>(p[1]) << 8));
}

std::uint32_t read_u32_le(const std::uint8_t* p) {
    return static_cast<std::uint32_t>(p[0]) | (static_cast<std::uint32_t>(p[1]) << 8) |
           (static_cast<std::uint32_t>(p[2]) << 16) | (static_cast<std::uint32_t>(p[3]) << 24);
}

bool looks_like_fictionbook(std::string_view head) {
    // Skip optional UTF-8 BOM and leading whitespace.
    if (head.size() >= 3 && static_cast<unsigned char>(head[0]) == 0xEF &&
        static_cast<unsigned char>(head[1]) == 0xBB &&
        static_cast<unsigned char>(head[2]) == 0xBF) {
        head.remove_prefix(3);
    }
    while (!head.empty() && std::isspace(static_cast<unsigned char>(head.front())) != 0) {
        head.remove_prefix(1);
    }
    if (head.empty() || head.front() != '<') {
        return false;
    }
    return head.find("<FictionBook") != std::string_view::npos;
}

// Inspects the OLE2 directory stream names (minimal FAT walk, capped at 256 sectors) to tell
// encrypted Office OOXML (`EncryptedPackage` / `EncryptionInfo`) apart from legacy Word `.doc`
// (`WordDocument`). Never loads full file contents.
DocxSniffResult sniff_ole2_compound(std::ifstream& in, std::uint64_t file_size) {
    if (file_size < 512) {
        return {DocxSniffKind::not_docx, "truncated OLE2 header"};
    }
    std::array<std::uint8_t, 512> hdr{};
    in.seekg(0);
    in.read(reinterpret_cast<char*>(hdr.data()), static_cast<std::streamsize>(hdr.size()));
    if (in.gcount() < 512) {
        return {DocxSniffKind::not_docx, "unreadable OLE2 header"};
    }

    const std::uint16_t sector_shift = read_u16_le(hdr.data() + 30);
    if (sector_shift != 9 && sector_shift != 12) {
        return {DocxSniffKind::not_docx, "invalid OLE2 sector size"};
    }
    const std::uint64_t sector_size = 1ull << sector_shift;
    const std::uint32_t first_dir_sector = read_u32_le(hdr.data() + 48);

    // Collect up to 109 FAT sector indices from header DIFAT table so we can follow directory
    // chains.
    std::vector<std::uint32_t> fat_sectors;
    for (std::size_t i = 0; i < 109; ++i) {
        const std::uint32_t s = read_u32_le(hdr.data() + 76 + i * 4);
        if (s == kFreeSector || s == kEndOfChain) {
            break;
        }
        fat_sectors.push_back(s);
    }

    auto sector_offset = [&](std::uint32_t sector) -> std::optional<std::uint64_t> {
        const std::uint64_t off = (static_cast<std::uint64_t>(sector) + 1ull) * sector_size;
        if (off + sector_size > file_size) {
            return std::nullopt;
        }
        return off;
    };

    auto next_fat_sector = [&](std::uint32_t current) -> std::uint32_t {
        const std::uint64_t entries_per_sector = sector_size / 4;
        const std::uint64_t fat_idx = current / entries_per_sector;
        const std::uint64_t entry_idx = current % entries_per_sector;
        if (fat_idx >= fat_sectors.size()) {
            return kEndOfChain;
        }
        const auto off = sector_offset(fat_sectors[static_cast<std::size_t>(fat_idx)]);
        if (!off) {
            return kEndOfChain;
        }
        std::array<std::uint8_t, 4> raw{};
        in.clear();
        in.seekg(static_cast<std::streamoff>(*off + entry_idx * 4));
        in.read(reinterpret_cast<char*>(raw.data()), 4);
        if (in.gcount() != 4) {
            return kEndOfChain;
        }
        return read_u32_le(raw.data());
    };

    bool has_encrypted_package = false;
    bool has_encryption_info = false;
    bool has_word_document = false;

    std::vector<std::uint8_t> buf(static_cast<std::size_t>(sector_size));
    std::uint32_t sector = first_dir_sector;
    for (std::size_t step = 0; step < kMaxOle2DirectorySectors && sector < 0xFFFFFFFAu; ++step) {
        const auto off = sector_offset(sector);
        if (!off) {
            break;
        }
        in.clear();
        in.seekg(static_cast<std::streamoff>(*off));
        in.read(reinterpret_cast<char*>(buf.data()), static_cast<std::streamsize>(sector_size));
        if (static_cast<std::uint64_t>(in.gcount()) < sector_size) {
            break;
        }
        for (std::size_t pos = 0; pos + 128 <= sector_size; pos += 128) {
            const std::uint8_t* entry = buf.data() + pos;
            const std::uint8_t obj_type = entry[66];
            if (obj_type == 0) {
                continue;
            }
            const std::uint16_t name_bytes = read_u16_le(entry + 64);
            if (name_bytes < 2 || name_bytes > 64 || (name_bytes % 2) != 0) {
                continue;
            }
            std::string ascii_name;
            ascii_name.reserve(name_bytes / 2);
            for (std::size_t k = 0; k + 2 <= name_bytes; k += 2) {
                const std::uint16_t ch = read_u16_le(entry + k);
                if (ch == 0) {
                    break;
                }
                ascii_name.push_back(ch < 128 ? static_cast<char>(ch) : '?');
            }
            if (ascii_name == "EncryptedPackage") {
                has_encrypted_package = true;
            } else if (ascii_name == "EncryptionInfo") {
                has_encryption_info = true;
            } else if (ascii_name == "WordDocument") {
                has_word_document = true;
            }
        }
        if (has_encrypted_package || has_encryption_info) {
            return {DocxSniffKind::encrypted_office, "OLE2 encrypted Office container"};
        }
        const std::uint32_t next = next_fat_sector(sector);
        if (next == sector) {
            break;
        }
        sector = next;
    }

    if (has_encrypted_package || has_encryption_info) {
        return {DocxSniffKind::encrypted_office, "OLE2 encrypted Office container"};
    }
    if (has_word_document) {
        return {DocxSniffKind::legacy_doc, "legacy Word 97-2003 binary document"};
    }
    return {DocxSniffKind::not_docx, "non-Word OLE2 container"};
}

}  // namespace

const char* docx_refusal_name(DocxRefusal reason) {
    switch (reason) {
        case DocxRefusal::not_docx:
            return "notDocx";
        case DocxRefusal::encrypted:
            return "encrypted";
        case DocxRefusal::legacy_doc:
            return "legacyDoc";
        case DocxRefusal::macro_enabled:
            return "macroEnabled";
        case DocxRefusal::too_large:
            return "tooLarge";
        case DocxRefusal::too_many_entries:
            return "tooManyEntries";
        case DocxRefusal::zip_bomb:
            return "zipBomb";
        case DocxRefusal::damaged:
            return "damaged";
        case DocxRefusal::empty:
            return "empty";
        case DocxRefusal::fiction_book:
            return "fictionBook";
        case DocxRefusal::no_docx_in_archive:
            return "noDocxInArchive";
        case DocxRefusal::other_archive:
            return "otherArchive";
        case DocxRefusal::archive_encrypted:
            return "archiveEncrypted";
        case DocxRefusal::archive_too_large:
            return "archiveTooLarge";
        case DocxRefusal::archive_damaged:
            return "archiveDamaged";
    }
    return "damaged";
}

bool is_docx_extension(std::string_view name) {
    return name.size() > 5 && lower_ascii(name.substr(name.size() - 5)) == ".docx";
}

bool is_docm_extension(std::string_view name) {
    return name.size() > 5 && lower_ascii(name.substr(name.size() - 5)) == ".docm";
}

DocxSniffResult sniff_docx_file(const fs::path& path, const DocxArchiveLimits& limits) {
    std::error_code ec;
    if (!fs::is_regular_file(path, ec)) {
        return {DocxSniffKind::not_docx, "missing or not a regular file"};
    }
    const std::uint64_t file_size = fs::file_size(path, ec);
    if (ec || file_size == 0) {
        return {DocxSniffKind::not_docx, "empty file"};
    }

    const std::string ext = lower_ascii(platform::utf8_from_path(path.extension()));

    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return {DocxSniffKind::not_docx, "cannot open file"};
    }
    char head[1024] = {};
    in.read(head, sizeof head);
    const std::size_t got = static_cast<std::size_t>(in.gcount());
    const std::string_view head_view(head, got);

    if (looks_like_fictionbook(head_view)) {
        return {DocxSniffKind::fiction_book, "FictionBook XML"};
    }

    if (got >= 8 && std::equal(std::begin(kOle2Magic), std::end(kOle2Magic),
                               reinterpret_cast<const std::uint8_t*>(head))) {
        return sniff_ole2_compound(in, file_size);
    }

    const archive::Kind kind = archive::detect_kind(path);
    if (archive::is_other_archive(kind)) {
        return {DocxSniffKind::other_archive, archive::kind_name(kind)};
    }
    if (kind != archive::Kind::zip) {
        if (ext == ".docm") {
            return {DocxSniffKind::macro_enabled_docm, "macro-enabled .docm extension"};
        }
        return {DocxSniffKind::not_docx, "not a ZIP or OLE2 file"};
    }

    if (file_size > limits.max_file_bytes) {
        // Still classify .docm by extension if oversized, else let open_docx_archive raise
        // too_large.
        if (ext == ".docm") {
            return {DocxSniffKind::macro_enabled_docm, "macro-enabled .docm"};
        }
        return {is_docx_extension(platform::utf8_from_path(path.filename()))
                    ? DocxSniffKind::docx
                    : DocxSniffKind::outer_zip_with_docx,
                "oversized archive"};
    }

    archive::Listing listing;
    try {
        listing = archive::list(path);
    } catch (const archive::ArchiveError&) {
        if (ext == ".docm") {
            return {DocxSniffKind::macro_enabled_docm, "macro-enabled .docm"};
        }
        return {DocxSniffKind::not_docx, "damaged ZIP"};
    }

    const archive::Entry* content_types = nullptr;
    bool has_word_document = false;
    bool has_nested_docx = false;
    for (const archive::Entry& e : listing.entries) {
        if (e.directory) {
            continue;
        }
        const std::string folded = fold_docx_entry_name(e.name);
        if (folded == "[content_types].xml") {
            content_types = &e;
        } else if (folded == "word/document.xml") {
            has_word_document = true;
        }
        if (is_docx_extension(e.name)) {
            has_nested_docx = true;
        }
    }

    if (content_types != nullptr) {
        if ((content_types->flags & 1u) != 0) {
            return {DocxSniffKind::encrypted_office, "encrypted ZIP entry"};
        }
        if (content_types->size <= kMaxContentTypesBytes) {
            try {
                const std::string ct = archive::read_entry_at(path, *content_types);
                if (ct.find("word.document.macroEnabled.main+xml") != std::string::npos ||
                    ct.find("word.template.macroEnabledTemplate.main+xml") != std::string::npos) {
                    return {DocxSniffKind::macro_enabled_docm, "macro-enabled WordprocessingML"};
                }
                if (ext == ".docm") {
                    return {DocxSniffKind::macro_enabled_docm, "macro-enabled .docm extension"};
                }
                if (ct.find("wordprocessingml.document.main+xml") != std::string::npos ||
                    has_word_document) {
                    return {DocxSniffKind::docx, "OOXML WordprocessingML document"};
                }
            } catch (const archive::ArchiveError&) {
                return {DocxSniffKind::not_docx, "unreadable [Content_Types].xml"};
            }
        }
    }

    if (ext == ".docm") {
        return {DocxSniffKind::macro_enabled_docm, "macro-enabled .docm extension"};
    }
    if (has_word_document) {
        return {DocxSniffKind::docx, "OOXML document without standard content types"};
    }
    if (has_nested_docx) {
        return {DocxSniffKind::outer_zip_with_docx, "ZIP archive containing DOCX"};
    }
    return {DocxSniffKind::not_docx, "ZIP archive without DOCX content"};
}

bool is_bare_docx_file(const fs::path& path) {
    const DocxSniffResult res = sniff_docx_file(path);
    return res.kind == DocxSniffKind::docx;
}

}  // namespace mfbe::docx
