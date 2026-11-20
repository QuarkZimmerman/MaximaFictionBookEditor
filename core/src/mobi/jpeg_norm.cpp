// Lossless JPEG EXIF->JFIF normalisation, >10 MB downscale, and cover thumbnail (T009).
#include "mobi/jpeg_norm.hpp"

#include "mobi/palmdb.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace mfbe::mobi {
namespace {

// Standard 18-byte JFIF 1.01 APP0 marker segment (contracts/mobi-file.md §8).
constexpr unsigned char kJfifApp0[18] = {
    0xFF, 0xE0, 0x00, 0x10, 'J',  'F',  'I',  'F',  0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
};

bool is_sof_marker(unsigned char marker) {
    return (marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
           (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF);
}

bool has_jpeg_soi(std::string_view bytes) {
    return bytes.size() >= 2 && static_cast<unsigned char>(bytes[0]) == 0xFFU &&
           static_cast<unsigned char>(bytes[1]) == 0xD8U;
}

}  // namespace

std::optional<std::string> strip_exif_and_normalize_jfif_lossless(std::string_view jpeg_bytes,
                                                                  bool* needs_reencode) {
    if (needs_reencode != nullptr) {
        *needs_reencode = false;
    }
    if (!has_jpeg_soi(jpeg_bytes)) {
        return std::nullopt;
    }

    std::string out;
    out.reserve(jpeg_bytes.size() + sizeof(kJfifApp0));
    out.push_back(static_cast<char>(0xFFU));
    out.push_back(static_cast<char>(0xD8U));
    out.append(reinterpret_cast<const char*>(kJfifApp0), sizeof(kJfifApp0));

    std::size_t pos = 2;
    bool saw_sof = false;
    while (pos < jpeg_bytes.size()) {
        // Skip fill 0xFF bytes before marker code.
        if (static_cast<unsigned char>(jpeg_bytes[pos]) != 0xFFU) {
            return std::nullopt;
        }
        while (pos < jpeg_bytes.size() && static_cast<unsigned char>(jpeg_bytes[pos]) == 0xFFU) {
            ++pos;
        }
        if (pos >= jpeg_bytes.size()) {
            return std::nullopt;
        }
        const unsigned char marker = static_cast<unsigned char>(jpeg_bytes[pos++]);

        // Start of Scan (FF DA): copy rest of stream byte-for-byte untouched!
        if (marker == 0xDA) {
            if (!saw_sof) {
                return std::nullopt;
            }
            out.push_back(static_cast<char>(0xFFU));
            out.push_back(static_cast<char>(0xDAU));
            out.append(jpeg_bytes.substr(pos));
            return out;
        }
        // Standalone markers without length payload (RST0..7, TEM, SOI, EOI).
        if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
            out.push_back(static_cast<char>(0xFFU));
            out.push_back(static_cast<char>(marker));
            if (marker == 0xD9) {
                return saw_sof ? std::optional<std::string>(std::move(out)) : std::nullopt;
            }
            continue;
        }

        if (pos + 2 > jpeg_bytes.size()) {
            return std::nullopt;
        }
        const std::uint16_t seg_len = read_u16_be(jpeg_bytes, pos);
        if (seg_len < 2 || pos + seg_len > jpeg_bytes.size()) {
            return std::nullopt;
        }
        const std::string_view seg = jpeg_bytes.substr(pos, seg_len);
        pos += seg_len;

        // Drop all APP0..APP15 (FF E0..FF EF) and COM (FF FE).
        if ((marker >= 0xE0 && marker <= 0xEF) || marker == 0xFE) {
            continue;
        }

        if (is_sof_marker(marker)) {
            saw_sof = true;
            // Progressive (SOF2 = 0xC2) or non-baseline arithmetic/lossless or 4-component CMYK ->
            // fall back to baseline RGB re-encode for universal Kindle compatibility.
            const bool is_baseline = (marker == 0xC0 || marker == 0xC1);
            const unsigned char components =
                (seg.size() >= 8) ? static_cast<unsigned char>(seg[7]) : 0;
            if (!is_baseline || (components != 1 && components != 3)) {
                if (needs_reencode != nullptr) {
                    *needs_reencode = true;
                }
                return std::nullopt;
            }
        }

        out.push_back(static_cast<char>(0xFFU));
        out.push_back(static_cast<char>(marker));
        out.append(seg);
    }

    return std::nullopt;
}

NormalizedPicture prepare_mobi_picture(std::string_view raw_bytes,
                                       const images::ConversionPolicy& policy,
                                       std::size_t max_bytes) {
    images::ConversionPolicy mobi_policy = policy;
    mobi_policy.png_when_alpha = true;
    mobi_policy.png_when_few_colours = true;

    std::string err;
    auto conv = images::convert(raw_bytes, mobi_policy, &err, /*force=*/false);
    if (!conv) {
        throw MobiError("damaged", err.empty() ? "undecodable image" : err);
    }

    NormalizedPicture out;
    out.bytes = std::move(conv->bytes);
    out.media_type = std::move(conv->content_type);
    out.width = conv->width;
    out.height = conv->height;
    out.converted = conv->changed;

    // Lossless JPEG EXIF->JFIF normalisation (re-encoding baseline RGB only if CMYK/progressive).
    if (out.media_type == "image/jpeg") {
        bool needs_reencode = false;
        auto normalized = strip_exif_and_normalize_jfif_lossless(out.bytes, &needs_reencode);
        if (normalized) {
            out.bytes = std::move(*normalized);
        } else if (needs_reencode) {
            const images::Bitmap bmp = images::decode(out.bytes);
            std::string reencoded = images::encode_jpeg(bmp, mobi_policy.jpeg_quality);
            if (auto norm2 = strip_exif_and_normalize_jfif_lossless(reencoded)) {
                reencoded = std::move(*norm2);
            }
            out.bytes = std::move(reencoded);
            out.width = bmp.width;
            out.height = bmp.height;
        }
    }

    // Progressive downscale when record exceeds max_bytes (10 MB default).
    if (out.bytes.size() > max_bytes) {
        images::Bitmap bmp = images::decode(out.bytes);
        int cur_w = bmp.width;
        int cur_h = bmp.height;
        int quality = std::clamp(mobi_policy.jpeg_quality, 60, 90);
        for (int attempt = 0; attempt < 24 && out.bytes.size() > max_bytes; ++attempt) {
            cur_w = std::max(1, static_cast<int>(std::floor(cur_w * 0.85)));
            cur_h = std::max(1, static_cast<int>(std::floor(cur_h * 0.85)));
            images::Bitmap scaled = images::scale_to_fit(bmp, cur_w, cur_h);
            if (out.media_type == "image/png" && scaled.has_alpha) {
                out.bytes = images::encode_png(scaled);
            } else {
                std::string jpg = images::encode_jpeg(scaled, quality);
                if (auto norm = strip_exif_and_normalize_jfif_lossless(jpg)) {
                    jpg = std::move(*norm);
                }
                out.bytes = std::move(jpg);
                out.media_type = "image/jpeg";
            }
            out.width = scaled.width;
            out.height = scaled.height;
            out.downscaled = true;
            if (attempt >= 8 && quality > 65) {
                quality -= 5;
            }
        }
    }

    return out;
}

std::string make_cover_thumbnail(std::string_view image_bytes) {
    const images::Bitmap decoded = images::decode(image_bytes);
    images::Bitmap thumb = images::scale_to_fit(decoded, kThumbMaxWidth, kThumbMaxHeight);

    auto encode_norm = [](const images::Bitmap& bmp, int quality) -> std::string {
        std::string jpg = images::encode_jpeg(bmp, quality);
        if (auto norm = strip_exif_and_normalize_jfif_lossless(jpg)) {
            return *norm;
        }
        return jpg;
    };

    // Step down quality first (80 -> 30) to fit <= 16 KB (spec D7).
    for (int quality : {80, 70, 60, 50, 40, 30}) {
        std::string candidate = encode_norm(thumb, quality);
        if (candidate.size() <= kThumbMaxBytes) {
            return candidate;
        }
    }

    // If still > 16 KB (extremely noisy cover), scale dimensions down until <= 16 KB.
    int cur_w = thumb.width;
    int cur_h = thumb.height;
    std::string candidate;
    for (int attempt = 0; attempt < 8; ++attempt) {
        cur_w = std::max(16, (cur_w * 3) / 4);
        cur_h = std::max(16, (cur_h * 3) / 4);
        const images::Bitmap smaller = images::scale_to_fit(thumb, cur_w, cur_h);
        candidate = encode_norm(smaller, 40);
        if (candidate.size() <= kThumbMaxBytes) {
            return candidate;
        }
    }
    return candidate;
}

}  // namespace mfbe::mobi
