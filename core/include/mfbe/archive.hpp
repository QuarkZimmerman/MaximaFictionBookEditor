// Books in ZIP archives (feature 009, User Story 2; research PD1, DP-1 to DP-3, DP-6).
//
// The editor reads books from ZIP archives and writes new one-book archives; it never writes
// into an archive a book came from (D8). Reading: the listing (names, sizes, flags) comes from
// the archive's central directory, read here, because the legacy-name judge (DP-2) needs each
// name's raw bytes and its UTF-8 flag on every platform alike; the entry's data is decompressed
// by libarchive's seekable ZIP reader, which handles every method this build reads. Writing goes
// through libarchive's ZIP writer. No other archive format is ever registered (DP-1).
#pragma once

#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::archive {

// What a file is, by its leading bytes - never by its name (D6, FR-020).
enum class Kind { missing, folder, file, zip, rar, sevenz, gzip, bzip2, xz, zstd, cab, tar };
Kind detect_kind(const std::filesystem::path& path);
// The contract's names: "missing", "folder", "file", "zip", "rar", "7z", "gzip", ... (rpc-api §1).
const char* kind_name(Kind kind);
// A kind the editor recognises but does not read ("only ZIP archives are supported").
bool is_other_archive(Kind kind);

inline constexpr std::uint64_t kMaxBookBytes = 512ull * 1024 * 1024;  // DP-3
inline constexpr std::size_t kMaxListedBooks = 100000;                // DP-3

// One central-directory record.
struct Entry {
    std::string name;        // decoded to UTF-8 (DP-2), the full path inside the archive
    std::string raw_name;    // the bytes as stored
    std::uint64_t size = 0;  // uncompressed
    std::uint64_t compressed = 0;
    std::uint64_t offset = 0;  // of the local header
    std::uint16_t method = 0;
    std::uint16_t flags = 0;  // general-purpose bit flags (bit 0: encrypted)
    bool directory = false;
};

// A book of the archive: a `.fb2` or `.fbd` entry in any letter case (data-model §3).
struct Book {
    std::string entry;   // the full name, the key passed back to doc.open
    std::string name;    // without folders
    std::string folder;  // "/"-separated, "" at the top level
    std::uint64_t size = 0;
    std::string kind;  // "fb2" | "fbd"
};

struct Listing {
    std::vector<Book> books;        // archive order, at most kMaxListedBooks
    std::uint64_t books_total = 0;  // every book entry, listed or not
    std::uint64_t other_files = 0;  // entries that are neither books nor folders
    std::vector<Entry> entries;     // every record, central-directory order
};

// Why a book or an archive cannot be read (rpc-api §1 `archiveEntryUnreadable`).
enum class Reason { encrypted, method, damaged, too_large, multi_volume, missing };
const char* reason_name(Reason reason);  // "encrypted", "method", "damaged", "tooLarge", ...

struct ArchiveError : std::runtime_error {
    ArchiveError(Reason reason_, std::string entry_, const std::string& detail)
        : std::runtime_error(detail), reason(reason_), entry(std::move(entry_)) {}
    Reason reason;
    std::string entry;  // "" for the archive as a whole
};

// Lists the archive (throws ArchiveError: damaged, multi_volume).
Listing list(const std::filesystem::path& archive);

// The bytes of one entry, at most kMaxBookBytes (throws ArchiveError: encrypted, method,
// damaged, too_large, missing). Nothing is ever written to the disk.
std::string read_entry(const std::filesystem::path& archive, const std::string& entry);

// The bytes of a new archive holding `bytes` as its only entry, deflated, at its top level,
// named `entry_name` (UTF-8, flagged as such when not ASCII), stamped with the current time,
// without a comment (DP-6, resource-formats §5).
std::string zip_one(const std::string& entry_name, std::string_view bytes);

// Feature 011 (US6, the Markdown ZIP): the bytes of a new archive holding `entries` in their order,
// each deflated, named as given (UTF-8, flagged as such when not ASCII), stamped with the current
// time. The bytes of each entry are read while the archive is written.
struct ZipEntry {
    std::string name;
    std::string_view bytes;
};
std::string zip_entries(const std::vector<ZipEntry>& entries);

// The legacy-name judge (DP-2), exposed for tests: decodes the raw names of one archive's
// unflagged entries with the most plausible of `candidates` (code page numbers, in tie
// priority order). Valid UTF-8 everywhere is taken as UTF-8. Returns the chosen code page
// (65001 for UTF-8) and the decoded names.
struct Decoded {
    int codepage = 65001;
    std::vector<std::string> names;
};
Decoded decode_names(const std::vector<std::string>& raw, const std::vector<int>& candidates);
// The candidates of this system: its OEM and ANSI code pages first (Windows), then CP866,
// CP1251, CP862, CP1255 and CP437 (DP-2).
std::vector<int> default_candidates();
// One name in one code page, to UTF-8 ("" when the converter refuses it).
std::string convert_codepage(std::string_view raw, int codepage);
// Feature 010 (US8, DP-15): the judge's plausibility of UTF-8 names or words - higher is more
// plausible - for the text judge of the Markdown import (mfbe/text_encoding.hpp).
long plausibility(const std::vector<std::string>& utf8_words);

}  // namespace mfbe::archive
