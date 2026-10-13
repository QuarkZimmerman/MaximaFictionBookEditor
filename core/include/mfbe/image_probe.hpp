// Cheap image inspection for binary objects (T042): content-type sniffing by magic bytes and
// width/height from the headers of JPEG, PNG, GIF, BMP, WebP and TIFF - no full decode.
#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace mfbe::images {

struct Probe {
    std::string contentType;  // sniffed MIME type ("" when the format is not recognised)
    std::optional<int> width;
    std::optional<int> height;
    bool decodable =
        false;  // one of the formats the editor can decode (JPEG/PNG/GIF/BMP/WebP/TIFF)
};

Probe probe(std::string_view bytes);

// MIME type by magic bytes ("" when unknown).
std::string sniff_content_type(std::string_view bytes);

// True for "image/jpeg" / "image/png" (also accepts the common "image/jpg" spelling).
bool is_jpeg_or_png(std::string_view content_type);

// The type to serve/display: the sniffed type when known, otherwise the declared one
// (lower-cased, trimmed), otherwise "application/octet-stream".
std::string effective_content_type(std::string_view declared, std::string_view sniffed);

// File extension (without dot) for a MIME type: "jpg", "png", "gif", ... ("bin" when unknown).
std::string extension_for(std::string_view content_type);

}  // namespace mfbe::images
