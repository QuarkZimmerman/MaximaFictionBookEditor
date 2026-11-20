// Clean-room MOBI 7, joint MOBI 7 + KF8, KF8 (.azw3), and PalmDOC container reader (T027).
#pragma once

#include "mobi/exth.hpp"

#include <mfbe/mobi.hpp>
#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::mobi {

struct MobiReadPicture {
    std::uint32_t index = 0;  // 1-based record offset from first_image_index
    std::string bytes;
    std::string content_type;
    std::optional<int> width;
    std::optional<int> height;
    std::size_t size = 0;
    bool too_large = false;
};

struct MobiReadResult {
    ContainerKind container_kind = ContainerKind::unknown;
    std::string active_part;  // "mobi7" | "kf8" | "palmdoc"
    bool fell_back_to_mobi7 = false;
    std::string encoding;  // "utf-8" | "windows-1252"
    std::string html_bytes;
    std::vector<std::string> css_flows;
    std::vector<MobiReadPicture> pictures;
    std::optional<std::uint32_t> cover_index;      // 1-based
    std::optional<std::uint32_t> thumbnail_index;  // 1-based
    MobiMetadata metadata;
    std::vector<MobiNavEntry> navigation;
    std::vector<MobiGuideEntry> guide;
    MfbeStatus mfbe_status = MfbeStatus::none;
    bool mfbe_html_matches = false;
    bool mfbe_meta_matches = false;
    nlohmann::json mfbe_json;
};

using ReadProgressFn = std::function<void(const std::string& phase, std::int64_t done, std::int64_t total)>;
using ReadCancelFn = std::function<void()>;

std::string container_kind_to_string(ContainerKind kind);
std::string mfbe_status_to_string(MfbeStatus status);

// Parses a MOBI/KF8/joint/PalmDOC byte stream, enforcing all hostile bounds and refusals.
MobiReadResult read_mobi_bytes(std::string_view bytes, const ReadProgressFn& progress = {},
                               const ReadCancelFn& check_cancelled = {});

// Reads a file from disk (enforcing kMaxFileBytes before full load) and parses it.
MobiReadResult read_mobi_file(const std::filesystem::path& path, const ReadProgressFn& progress = {},
                              const ReadCancelFn& check_cancelled = {});

}  // namespace mfbe::mobi
