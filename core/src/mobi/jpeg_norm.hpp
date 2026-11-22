// Lossless JPEG EXIF->JFIF normalisation, >10 MB downscale, and cover thumbnail (T009).
#pragma once

#include <mfbe/images.hpp>
#include <mfbe/mobi.hpp>

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace mfbe::mobi {

struct NormalizedPicture {
    std::string bytes;
    std::string media_type;  // "image/jpeg" | "image/png"
    int width = 0;
    int height = 0;
    bool converted = false;
    bool downscaled = false;
};

// Strips APP0..APP15 and COM segments and prepends a standard 18-byte JFIF 1.01 APP0 segment
// without touching quantization/Huffman tables or the entropy scan (zero lossy re-encode).
// Returns nullopt (setting *needs_reencode = true) for progressive (SOF2) or CMYK (4-component)
// JPEGs or malformed marker streams.
std::optional<std::string> strip_exif_and_normalize_jfif_lossless(std::string_view jpeg_bytes,
                                                                  bool* needs_reencode = nullptr);

// Prepares a picture for MOBI/KF8 embedding: converts non-JPEG/PNG, normalises JPEG EXIF->JFIF,
// and progressively downscales if larger than `max_bytes` (default 10 MB).
NormalizedPicture prepare_mobi_picture(std::string_view raw_bytes,
                                       const images::ConversionPolicy& policy,
                                       std::size_t max_bytes = kMaxPictureBytes);

// Produces a baseline JFIF JPEG cover thumbnail fitting <= 180x240 px and <= 16 KB (spec D7).
std::string make_cover_thumbnail(std::string_view image_bytes);

}  // namespace mfbe::mobi
