// Public types, constants, and sniffing API for the MOBI / KF8 container codec (feature 018).
#pragma once

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::mobi {

// Hard safety and format limits (contracts/mobi-file.md, contracts/rpc-api.md).
inline constexpr std::size_t kMaxFileBytes = 150ULL * 1024 * 1024;          // 150 MB
inline constexpr std::size_t kMaxRecords = 65535;                           // uint16 max
inline constexpr std::size_t kMaxDecompressedBytes = 256ULL * 1024 * 1024;  // 256 MB
inline constexpr std::size_t kMinBombBaselineBytes = 1ULL * 1024 * 1024;    // 1 MB floor
inline constexpr std::size_t kMaxExpansionRatio = 100;                      // 100x cap
inline constexpr int kMaxHuffDepth = 32;                                    // CDIC recursion limit
inline constexpr std::size_t kMaxMfbeCompressedBytes = 48128;               // 47 KB cap
inline constexpr std::size_t kMaxPictureBytes = 10ULL * 1024 * 1024;        // 10 MB per picture
inline constexpr int kThumbMaxWidth = 180;                                  // spec D7
inline constexpr int kThumbMaxHeight = 240;                                 // spec D7
inline constexpr std::size_t kThumbMaxBytes = 16384;                        // 16 KB (spec D7)
inline constexpr std::uint32_t kExthMfbeType = 59901;                       // private EXTH record

enum class ContainerKind {
    unknown,
    mobi7,
    joint,
    kf8,
    palmdoc,
    kfx,
    fictionBook,
};

struct SniffResult {
    ContainerKind kind = ContainerKind::unknown;
    std::string type_code;
    std::string creator_code;
};

struct MobiError : std::runtime_error {
    MobiError(std::string reason_, std::string detail_ = "")
        : std::runtime_error(detail_.empty() ? reason_ : (reason_ + ": " + detail_)),
          reason(std::move(reason_)),
          detail(std::move(detail_)) {}
    std::string reason;  // contract reason code (e.g. "encrypted", "kfx", "damaged", ...)
    std::string detail;
};

struct MobiMetadata {
    std::string title;
    std::vector<std::string> authors;
    std::vector<std::string> contributors;
    std::string publisher;
    std::string description;
    std::string isbn;
    std::vector<std::string> subjects;
    std::string date;
    std::string language;
    std::string identifier;
    std::string rights;
    std::string open_at_anchor_id;
    std::string updated_title;  // EXTH 503 if distinct from full_name
};

struct MobiNavEntry {
    std::string label;
    std::string anchor_id;
    int depth = 0;
    std::uint32_t offset = 0;
    std::uint32_t length = 0;
    int parent = -1;
    int first_child = -1;
    int last_child = -1;
    std::uint32_t fid = 0;
    std::uint32_t fid_offset = 0;
};

struct MobiGuideEntry {
    std::string type;  // "cover" | "title-page" | "toc" | "text"
    std::string title;
    std::string anchor_id;
    std::uint32_t offset = 0;
    std::uint32_t fid = 0;
    std::uint32_t fid_offset = 0;
};

struct MobiKf8Fragment {
    std::string id;
    std::uint32_t skeleton_index = 0;
    std::uint32_t start_byte = 0;
    std::uint32_t end_byte = 0;
};

// Sniff the container kind from the leading bytes of a file (at least 78 bytes recommended).
SniffResult sniff_bytes(std::string_view prefix);

// True if `path_or_name` has a MOBI/KF8/PalmDOC extension (.mobi, .azw3, .azw, .prc).
bool is_mobi_extension(std::string_view path_or_name);

}  // namespace mfbe::mobi
