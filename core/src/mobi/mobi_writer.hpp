// MOBI 7, joint MOBI 7 + KF8, and KF8 (.azw3) container writer (T018, contracts/mobi-file.md).
#pragma once

#include <mfbe/images.hpp>
#include <mfbe/mobi.hpp>
#include <nlohmann/json.hpp>

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::mobi {

enum class MobiExportFormat { mobi7, joint, kf8 };

std::string format_to_string(MobiExportFormat fmt);
std::optional<MobiExportFormat> format_from_string(std::string_view s);

struct MobiAddedPicture {
    std::uint32_t recindex = 0;  // 1-based record index inside picture pool
    std::string media_type;
    int width = 0;
    int height = 0;
    bool converted = false;
    bool downscaled = false;
};

struct MobiCommitInput {
    MobiMetadata metadata;
    std::vector<MobiNavEntry> nav;
    std::vector<MobiGuideEntry> guide;
    std::vector<MobiKf8Fragment> kf8_fragments;
};

struct MobiWriteResult {
    std::string path;
    std::size_t bytes = 0;
    std::string format;
    bool zip = false;
    bool mfbe_skipped = false;
};

class MobiWriter {
public:
    MobiWriter(std::filesystem::path target, MobiExportFormat format, bool zip = false);

    const std::filesystem::path& target() const { return target_; }
    MobiExportFormat format() const { return format_; }
    bool zip() const { return zip_; }

    MobiAddedPicture add_picture(std::string_view raw_bytes, const images::ConversionPolicy& policy,
                                 bool is_cover = false);

    void set_mobi7_html(std::string html);
    void set_kf8_html(std::string html);
    void set_kf8_css(std::string css);
    void set_mfbe_json(nlohmann::json mfbe);

    std::optional<std::uint32_t> cover_rec_index() const { return cover_rec_index_; }
    std::optional<std::uint32_t> thumbnail_rec_index() const { return thumbnail_rec_index_; }

    using ProgressFn = std::function<void(const std::string& phase, std::int64_t done, std::int64_t total)>;
    using CancelFn = std::function<void()>;

    // Assembles the MOBI/KF8 binary, runs the pre-write self-check, optionally packs into ZIP
    // (MOBI stored uncompressed + FBD deflated), and writes atomically to `target_`.
    MobiWriteResult commit(const MobiCommitInput& input, const ProgressFn& progress = {},
                           const CancelFn& check_cancelled = {},
                           const std::optional<std::string>& fbd_bytes = std::nullopt);

private:
    std::filesystem::path target_;
    MobiExportFormat format_;
    bool zip_ = false;
    std::vector<std::string> pictures_;
    std::optional<std::uint32_t> cover_rec_index_;      // 0-based offset into pictures_
    std::optional<std::uint32_t> thumbnail_rec_index_;  // 0-based offset into pictures_
    std::optional<std::string> mobi7_html_;
    std::optional<std::string> kf8_html_;
    std::string kf8_css_;
    std::optional<nlohmann::json> mfbe_json_;
};

}  // namespace mfbe::mobi
