// Automatic cover image extraction/generation for FBD ZIP Package mode (Feature 022).
//
// When book files are added to a package (`package.addFiles`), extracts embedded covers from
// EPUB and MOBI/AZW3 containers or renders page 1 of a PDF via the isolated `mfbe-pdf-reader`
// process (1024 px wide JPEG over white, matching Maxima Library's PdfFilePictures.php).
#pragma once

#include <mfbe/images.hpp>

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace mfbe::package {

struct FbdPackageCoverAutoOptions {
    bool auto_cover_pdf = true;
    bool auto_cover_epub = true;
    bool auto_cover_mobi = true;
    images::ConversionPolicy conversion_policy;
    std::filesystem::path fonts_dir;
};

struct FbdPackageExtractedCover {
    std::string bytes;
    std::string content_type;  // "image/jpeg" | "image/png"
    std::string binary_id;     // "cover.jpg" | "cover.png"
};

/// Attempts to extract (EPUB/MOBI) or generate (PDF) a normalized cover image for a newly added
/// package payload file. Returns std::nullopt if the format is disabled, unsupported for automatic
/// cover import, has no cover, is encrypted/DRM-protected, or fails to render/decode.
std::optional<FbdPackageExtractedCover> extract_package_entry_cover(
    const std::filesystem::path& path, std::string_view lower_extension,
    const FbdPackageCoverAutoOptions& options);

}  // namespace mfbe::package
