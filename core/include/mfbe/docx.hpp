// Feature 023 (PD1, PD2; contracts/docx-file.md, contracts/rpc-api.md): standalone offline DOCX
// container sniffing, hostile-safe OOXML/ZIP reading, macro stripping, and pre-write checked
// atomic `.docx` / ZIP+FBD writing.
#pragma once

#include <mfbe/archive.hpp>

#include <cstdint>
#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace mfbe::docx {

struct DocxArchiveLimits {
    std::uint64_t max_file_bytes = 512ull << 20;
    std::uint64_t max_unpacked_bytes = 2ull << 30;
    std::uint64_t max_ratio = 100;
    std::uint64_t ratio_floor_bytes = 1ull << 20;
    std::size_t max_entries = 20000;
    std::uint64_t max_roundtrip_unpacked_bytes = 4ull << 20;
};

enum class DocxSniffKind {
    docx,
    outer_zip_with_docx,
    encrypted_office,
    legacy_doc,
    macro_enabled_docm,
    fiction_book,
    other_archive,
    not_docx,
};

struct DocxSniffResult {
    DocxSniffKind kind = DocxSniffKind::not_docx;
    std::string detail;
};

enum class DocxRefusal {
    not_docx,
    encrypted,
    legacy_doc,
    macro_enabled,
    too_large,
    too_many_entries,
    zip_bomb,
    damaged,
    empty,
    fiction_book,
    no_docx_in_archive,
    other_archive,
    archive_encrypted,
    archive_too_large,
    archive_damaged,
};

const char* docx_refusal_name(DocxRefusal reason);

struct DocxRefused : std::runtime_error {
    DocxRefused(DocxRefusal reason_, const std::string& detail)
        : std::runtime_error(detail), reason(reason_) {}
    DocxRefusal reason;
};

struct DocxEntryInfo {
    std::string name;
    std::uint64_t size = 0;
    std::uint64_t compressed = 0;
};

struct DocxOpenedArchive {
    std::filesystem::path path;
    std::vector<DocxEntryInfo> entries;
    std::vector<std::string> stray_macro_entries;
    std::vector<std::string> outside_entries;
    std::vector<archive::Entry> records;
    std::unordered_map<std::string, std::size_t> index;
};

// Sniffs leading bytes and (for ZIP/OLE2) minimal container headers to classify `.docx`,
// outer `.zip` holding `.docx`, encrypted Office `.docx`, legacy `.doc`, `.docm`, FB2 XML,
// unsupported archives, or unrelated files.
DocxSniffResult sniff_docx_file(const std::filesystem::path& path,
                                const DocxArchiveLimits& limits = {});

// True for bare `.docx` containers (for `doc.open` refusal prior to ZIP-of-books handling).
// Returns false for outer `.zip` archives (even those containing `.docx`) and non-DOCX files.
bool is_bare_docx_file(const std::filesystem::path& path);

// True if filename has a `.docx` extension (case-insensitive).
bool is_docx_extension(std::string_view name);

// True if filename has a `.docm` extension (case-insensitive).
bool is_docm_extension(std::string_view name);

// Validates one internal OOXML ZIP path (no traversal, leading slash, backslash, or NUL).
bool valid_docx_entry_name(std::string_view name);

// Case-folds an OOXML entry name for duplicate detection.
std::string fold_docx_entry_name(std::string_view name);

// Opens a bare `.docx` file for hostile-safe reading; strips stray macro entries and records
// traversal entries without exposing them. Throws DocxRefused.
DocxOpenedArchive open_docx_archive(const std::filesystem::path& path,
                                    const DocxArchiveLimits& limits = {});

// Reads one safe entry listed in `opened.entries`, enforcing size and compression-ratio limits.
std::string read_docx_entry(const DocxOpenedArchive& opened, const std::string& entry,
                            const DocxArchiveLimits& limits = {});

// Finds an automatic sibling `.fbd` beside `docx_path` (exact stem match first, else unique
// case-insensitive match in the same directory).
std::optional<std::filesystem::path> find_sibling_fbd(const std::filesystem::path& docx_path);

// Staged OOXML `.docx` (and optional `<stem>.zip` with `.docx` stored + `.fbd` deflated) writer.
// Nothing touches the target path on disk until `commit()` passes the XML/relationship self-check.
class DocxPackageWriter {
public:
    DocxPackageWriter(std::filesystem::path target, bool zip_with_fbd);

    void add_xml_part(const std::string& name, std::string bytes);
    void add_media_part(const std::string& name, std::string bytes);

    // Validates every staged `.xml`/`.rels` part with hardened libxml2, verifies required OOXML
    // parts and media relationships, and writes the target atomically. When `zip_with_fbd` is
    // true, `fbd_bytes` must contain the companion UTF-8 `.fbd` document bytes.
    std::uint64_t commit(std::string_view fbd_bytes = {});

    const std::filesystem::path& target() const { return target_; }
    bool zip_with_fbd() const { return zip_with_fbd_; }

private:
    std::filesystem::path target_;
    bool zip_with_fbd_ = false;
    std::vector<std::pair<std::string, std::string>> xml_parts_;
    std::vector<std::pair<std::string, std::string>> media_parts_;
    std::unordered_map<std::string, bool> seen_folded_;
};

}  // namespace mfbe::docx
