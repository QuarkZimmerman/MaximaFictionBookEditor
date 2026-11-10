// EPUB container services (feature 012, PD1 = A, contracts/rpc-api.md §1-§3).
//
// The core reads the ZIP entries of an EPUB for the interface's import and writes the ZIP of the
// interface's export; it converts nothing: the conversions run in the interface's engine
// (constitution III as amended in 3.4.0). Reading applies the limits and recognises DRM before any
// entry is offered (D17, D29, research DP-14, DP-15). Writing puts `mimetype` first, stored and
// without an extra field, deflates the rest and replaces the target atomically (D3, D4, research
// R3).
#pragma once

#include <mfbe/archive.hpp>

#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace mfbe::epub {

// Research DP-15.
struct Limits {
    std::uint64_t max_file_bytes = 512ull << 20;
    std::uint64_t max_unpacked_bytes = 2ull << 30;
    std::uint64_t max_ratio = 100;                 // per entry ...
    std::uint64_t ratio_floor_bytes = 1ull << 20;  // ... of more than this many bytes
    std::size_t max_entries = 20000;
};

// Why an EPUB is refused before anything of it is read (rpc-api §1).
enum class Refusal {
    not_zip,
    no_package,
    drm,
    too_large,
    zip_bomb,
    too_many_entries,
    encrypted_zip
};
// "epub.notZip", "epub.noPackage", "epub.protected", "epub.tooLarge", "epub.zipBomb",
// "epub.tooManyEntries", "epub.encryptedZip".
const char* refusal_name(Refusal reason);

struct Refused : std::runtime_error {
    Refused(Refusal reason_, const std::string& detail)
        : std::runtime_error(detail), reason(reason_) {}
    Refusal reason;
};

// Font obfuscation (the IDPF and Adobe algorithms) is not DRM (D17).
enum class Protection { none, font_obfuscation, drm };
const char* protection_name(Protection protection);  // "none", "fontObfuscation", "drm"

struct Entry {
    std::string name;
    std::uint64_t size = 0;
    std::uint64_t packed = 0;
    std::uint16_t method = 0;
};

struct Source {
    std::filesystem::path path;
    std::string version;  // the package's version attribute ("2.0", "3.0", "3.1"; "" when none)
    std::string package_path;  // the package document of the first rendition
    Protection protection = Protection::none;
    bool mimetype_first = false;
    std::vector<Entry> entries;        // the readable entries, in the archive's order
    std::vector<std::string> outside;  // names leading outside the container: never read
    // The central directory's record of each entry of `entries`, in the same order, and the first
    // entry of each name: an entry is read at its own offset, without walking the archive.
    std::vector<archive::Entry> records;
    std::unordered_map<std::string, std::size_t> index;
};

// Opens an EPUB for reading. Throws Refused.
Source open(const std::filesystem::path& path, const Limits& limits = {});

// The bytes of one entry the source offers. Throws std::out_of_range for a name it does not offer,
// Refused (zip_bomb) when the data exceed the declared size, archive::ArchiveError when unreadable.
std::string read(const Source& source, const std::string& entry, const Limits& limits = {});

// True for an EPUB: a ZIP whose first entry is `mimetype` holding "application/epub+zip", or a ZIP
// named `.epub` that holds META-INF/container.xml (D14: File > Open refuses it before treating it
// as a ZIP archive of FB2 books).
bool is_epub(const std::filesystem::path& path);

// EPUB 3.3 §6.1.5 (file names) for one path inside the container.
bool valid_name(std::string_view name);
// The name in a form that compares without regard to letter case (ASCII, Latin-1, Cyrillic).
std::string folded_name(std::string_view name);

// Writes a new EPUB. Nothing touches the disk before commit(), so an abandoned writer leaves no
// file.
class Writer {
public:
    explicit Writer(std::filesystem::path target);
    // Adds a file. Throws std::invalid_argument for a name against EPUB's rules, `mimetype`, or a
    // name equal to an earlier one without regard to letter case.
    void add(const std::string& name, std::string bytes);
    // Writes `mimetype` first (stored, no extra field), then every file deflated, and replaces the
    // target atomically. Returns the bytes written. Throws on failure, leaving the target
    // untouched.
    std::uint64_t commit();
    const std::filesystem::path& target() const { return target_; }
    std::size_t files() const { return files_.size(); }

private:
    std::filesystem::path target_;
    std::vector<std::pair<std::string, std::string>> files_;
    std::vector<std::string> folded_;
};

}  // namespace mfbe::epub
