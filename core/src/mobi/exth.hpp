// EXTH TLV codec, Windows LCID mapping, and MFBE EXTH 59901 round-trip record (T008).
#pragma once

#include <mfbe/mobi.hpp>

#include <nlohmann/json.hpp>

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::mobi {

struct ExthEntry {
    std::uint32_t type = 0;
    std::string data;
};

enum class MfbeStatus {
    none,
    valid,
    externally_modified,
    corrupt,
};

struct MfbeDecodeResult {
    MfbeStatus status = MfbeStatus::none;
    bool html_matches = false;
    bool meta_matches = false;
    nlohmann::json json;
};

// Parses an EXTH block starting at `bytes[0] == "EXTH"`. Optionally reports 4-byte padded length.
std::vector<ExthEntry> parse_exth(std::string_view bytes, std::size_t* consumed_bytes = nullptr);

// Serializes EXTH entries with 4-byte zero alignment padding.
std::string serialize_exth(const std::vector<ExthEntry>& entries);

// Windows LCID mapping for MOBI header offset 92 (returns 0 unset when missing/invalid).
std::uint32_t lcid_from_bcp47(std::string_view lang);
std::string bcp47_from_lcid(std::uint32_t lcid);

// Builds standard export EXTH entries (strictly omitting store-only EXTH 113 and 501,
// and omitting EXTH 524 when language is empty/invalid).
std::vector<ExthEntry> build_export_exth(const MobiMetadata& meta,
                                         std::optional<std::uint32_t> cover_offset,
                                         std::optional<std::uint32_t> thumb_offset,
                                         std::optional<std::uint32_t> open_at_offset,
                                         std::optional<std::uint32_t> kf8_boundary_rec,
                                         std::optional<std::uint32_t> resource_count, bool is_kf8,
                                         std::optional<std::string_view> mfbe_payload);

// Populates MobiMetadata from parsed EXTH entries and fallback header title/locale.
MobiMetadata metadata_from_exth(const std::vector<ExthEntry>& entries,
                                std::string_view header_title, std::uint32_t header_locale);

// Canonical SHA-256 digests for MFBE external-edit detection (contracts/mobi-file.md §5).
std::string compute_html_sha256(std::string_view canonical_html);
std::string compute_meta_sha256(const MobiMetadata& meta);

// Stamps v=1 + digests, zlib-compresses, wraps in "MFBE\x01\x00". Returns nullopt if > 48,128 B.
std::optional<std::string> encode_mfbe_record(nlohmann::json mfbe_json,
                                              std::string_view canonical_html,
                                              const MobiMetadata& exported_meta);

// Unwraps, inflates, parses, and independently verifies HTML and metadata SHA-256 digests.
MfbeDecodeResult decode_and_verify_mfbe(std::string_view raw_exth_payload,
                                        std::string_view actual_html,
                                        const MobiMetadata& actual_meta);

}  // namespace mfbe::mobi
