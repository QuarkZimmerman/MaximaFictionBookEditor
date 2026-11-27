// FBD ZIP package mode core subsystem (feature 022, specs/022-fbd-package-mode/).
//
// Manages multi-file FBD ZIP packages pairing non-FB2 book files 1-to-1 with UTF-8 FB2 2.1
// `<stem>.fbd` descriptors at the archive root, while preserving ignored/non-managed entries
// (subfolders, extra files) on in-place Save and writing clean packages on Save As to a new path.
#pragma once

#include <mfbe/archive.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/document.hpp>
#include <mfbe/document_session.hpp>
#include <mfbe/images.hpp>

#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::package {

enum class PayloadSourceKind { disk_file, zip_entry };

enum class FileRejectReason {
    none,
    not_found,
    not_file,
    unreadable,
    forbidden_fb2,
    forbidden_fbd,
    forbidden_archive,
    duplicate_stem,
};

const char* file_reject_reason_name(FileRejectReason reason);

enum class ArchiveErrorReason {
    none,
    not_zip,
    damaged,
    encrypted,
    multi_volume,
    no_fbd,
    no_payload,
    duplicate_stem,
    fbd_parse_error,
    fbd_not_fictionbook,
};

const char* archive_error_reason_name(ArchiveErrorReason reason);

struct FbdPackagePayloadEntry {
    std::string entryId;
    std::string docId;
    std::string fileName;      // UTF-8 "<stem>.<ext>" with lower-cased extension
    std::string stem;          // file name without extension
    std::string stemKey;       // case-folded collision key
    std::string extension;     // lower-cased extension without leading dot (may be empty)
    std::string fbdEntryName;  // stem + ".fbd"
    std::uint64_t size = 0;
    PayloadSourceKind sourceKind = PayloadSourceKind::disk_file;
    std::optional<std::filesystem::path> sourceDiskPath;
    std::optional<std::string> sourceZipEntryName;
    std::optional<std::string> sourceFbdEntryName;
    bool originatedFromZip = false;
    bool hadFbd = false;
    std::uint32_t droppedExtraImages = 0;
};

struct FbdPackagePreservedZipEntry {
    std::string entryName;
    std::string rawName;
    std::uint64_t localHeaderOffset = 0;
    std::uint64_t compressedSize = 0;
};

struct FbdPackageSession {
    std::string packageId;
    std::optional<std::filesystem::path> zipPath;
    std::vector<FbdPackagePayloadEntry> entries;
    std::vector<FbdPackagePreservedZipEntry> preservedEntries;
    std::set<std::string> removedSourceEntries;
};

struct CandidateFileCheck {
    bool accepted = false;
    FileRejectReason reason = FileRejectReason::none;
    std::string fileName;
    std::string stem;
    std::string stemKey;
    std::string extension;
    std::uint64_t size = 0;
    std::string conflictWith;
};

// Lower-case stem key for case-insensitive matching consistent with Maxima Library.
std::string make_stem_key(std::string_view stem);

// Splits a UTF-8 file name into (stem, lower-cased extension without dot).
std::pair<std::string, std::string> split_name_and_lower_ext(std::string_view utf8_name);

// True when `extension` (without dot, any case) is a forbidden archive extension.
bool is_forbidden_archive_extension(std::string_view extension);

// Validates a candidate payload file on disk against forbidden types (.fb2, .fbd, archives,
// renamed archives/FB2 while permitting verified .epub/.docx/.odt) and duplicate stems.
CandidateFileCheck validate_candidate_payload(const std::filesystem::path& path,
                                              const std::map<std::string, std::string>& existing_stems);

enum class ZipClassification {
    fb2_archive,      // contains at least one .fb2 entry -> FB2 mode unchanged
    fbd_package,      // zero .fb2, >=1 top-level .fbd AND >=1 valid top-level non-FB2 payload
    standalone_fbd,   // zero .fb2, >=1 .fbd, zero valid top-level non-FB2 payload -> FB2 mode
    no_book,          // zero .fb2 and zero .fbd -> archive.noBook
};

struct InspectedPackagePair {
    std::string payloadEntryName;  // UTF-8 decoded entry name in source ZIP
    std::string payloadRawName;    // raw bytes of entry name in source ZIP Central Directory
    std::string fileName;          // normalized lower-cased extension file name
    std::string stem;
    std::string stemKey;
    std::string extension;
    std::uint64_t size = 0;
    std::optional<std::string> fbdEntryName;  // matched top-level .fbd entry name, if any
};

struct FbdPackageInspection {
    ZipClassification classification = ZipClassification::no_book;
    bool duplicateRootStem = false;
    std::string duplicateStemDetail;
    std::vector<InspectedPackagePair> pairs;
    std::vector<FbdPackagePreservedZipEntry> preservedEntries;
};

// Classifies a ZIP listing and builds top-level payload <-> .fbd pairs plus preserved entries.
FbdPackageInspection inspect_zip_listing(const archive::Listing& listing);

// Progress callback: (bytes_done, bytes_total).
using ZipProgressCallback = std::function<void(std::uint64_t, std::uint64_t)>;
// Cancellation predicate: returns true if the save job has been cancelled.
using ZipCancelCheck = std::function<bool()>;

struct PackageZipWriteEntry {
    std::string entryName;  // UTF-8 name at archive root
    PayloadSourceKind sourceKind = PayloadSourceKind::disk_file;
    std::optional<std::filesystem::path> diskPath;
    std::optional<std::string> sourceZipRawName;  // raw_name in sourceZipPath for raw pass-through
    std::string memoryBytes;                      // non-empty for in-memory .fbd XML entries
    bool isMemory = false;
    bool compressDeflate = false;
};

struct PackageZipWritePlan {
    std::filesystem::path targetZipPath;
    std::optional<std::filesystem::path> sourceZipPath;  // opened .zip when retaining entries
    bool preserveNonManaged = false;                     // true on in-place Save, false on Save As
    std::vector<FbdPackagePreservedZipEntry> preservedEntries;
    std::vector<PackageZipWriteEntry> managedEntries;
};

struct ZipWriteError : std::runtime_error {
    ZipWriteError(std::string reason_, std::string entry_, const std::string& detail)
        : std::runtime_error(detail), reason(std::move(reason_)), entry(std::move(entry_)) {}
    std::string reason;  // "sourceMissing" | "sourceUnreadable" | "ioError" | "cancelled"
    std::string entry;
};

// Streams all entries to a sibling temporary ZIP64-capable archive and atomically replaces target.
void write_package_zip_atomic(const PackageZipWritePlan& plan,
                              const ZipProgressCallback& on_progress = {},
                              const ZipCancelCheck& is_cancelled = {});

// Normalizes a parsed or blank FictionBook document for Package editing mode:
// - minimal empty <body><section/></body>
// - empty stylesheets and no top-level FictionBook extras
// - empty srcTitleInfo.coverpage
// - at most 1 cover image in titleInfo.coverpage and BinaryStore, renamed to cover.<ext>
// Returns the number of extra images dropped from the source document/store.
std::uint32_t normalize_package_fbd(model::Document& doc, BinaryStore& store,
                                    model::NodeIdAllocator& ids);

// Returns true if two paths refer to the same file/destination path.
bool same_target_path(const std::filesystem::path& a, const std::filesystem::path& b);

// Thread-safe registry owning active FbdPackageSession objects.
class FbdPackageRegistry {
public:
    FbdPackageSession& create();
    FbdPackageSession* find(const std::string& package_id);
    const FbdPackageSession* find(const std::string& package_id) const;
    std::vector<std::string> close(const std::string& package_id);
    std::vector<std::string> close_all();

private:
    mutable std::mutex mutex_;
    std::map<std::string, std::unique_ptr<FbdPackageSession>> sessions_;
    std::uint64_t next_package_id_ = 1;
    std::uint64_t next_entry_id_ = 1;

public:
    std::string next_entry_id();
};

}  // namespace mfbe::package
