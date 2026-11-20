// Tests for JPEG EXIF->JFIF lossless normalisation, >10 MB downscale, and cover thumbnail (T009).
#include "mobi/jpeg_norm.hpp"

#include <catch2/catch_test_macros.hpp>
#include <mfbe/images.hpp>
#include <mfbe/mobi.hpp>

#include <cstdint>
#include <string>

using namespace mfbe;
using namespace mfbe::mobi;

namespace {

images::Bitmap make_checker_bitmap(int w, int h) {
    images::Bitmap bmp;
    bmp.width = w;
    bmp.height = h;
    bmp.rgba.resize(static_cast<std::size_t>(w) * static_cast<std::size_t>(h) * 4U);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const std::size_t idx = (static_cast<std::size_t>(y) * w + x) * 4U;
            const bool odd = ((x / 8) + (y / 8)) % 2 == 1;
            bmp.rgba[idx + 0] = odd ? 210 : 35;
            bmp.rgba[idx + 1] = static_cast<std::uint8_t>((x * 255) / std::max(1, w));
            bmp.rgba[idx + 2] = static_cast<std::uint8_t>((y * 255) / std::max(1, h));
            bmp.rgba[idx + 3] = 255;
        }
    }
    return bmp;
}

// Inject an APP1 EXIF segment and COM comment right after SOI (FF D8).
std::string inject_exif_and_com(std::string_view jpeg) {
    REQUIRE(jpeg.size() >= 4);
    REQUIRE(static_cast<unsigned char>(jpeg[0]) == 0xFFU);
    REQUIRE(static_cast<unsigned char>(jpeg[1]) == 0xD8U);
    std::string out;
    out.append(jpeg.substr(0, 2));
    // APP1 EXIF segment: FF E1 <len=14> "Exif\0\0FAKEEXIF"
    out.append("\xFF\xE1\x00\x10" "Exif\0\0FAKEEXIF", 18);
    // COM segment: FF FE <len=8> "secret"
    out.append("\xFF\xFE\x00\x08" "secret", 10);
    out.append(jpeg.substr(2));
    return out;
}

// Extract entropy-coded scan bytes starting at FF DA (SOS).
std::string_view sos_slice(std::string_view jpeg) {
    for (std::size_t i = 2; i + 1 < jpeg.size(); ++i) {
        if (static_cast<unsigned char>(jpeg[i]) == 0xFFU &&
            static_cast<unsigned char>(jpeg[i + 1]) == 0xDAU) {
            return jpeg.substr(i);
        }
    }
    return {};
}

}  // namespace

TEST_CASE("Lossless JPEG EXIF strip & JFIF APP0 preserves SOS DCT scan byte-for-byte",
          "[mobi][jpeg]") {
    const auto bmp = make_checker_bitmap(64, 48);
    const std::string baseline = images::encode_jpeg(bmp, 88);
    const std::string with_exif = inject_exif_and_com(baseline);

    bool needs_reencode = false;
    const auto normalized = strip_exif_and_normalize_jfif_lossless(with_exif, &needs_reencode);
    REQUIRE(normalized.has_value());
    CHECK_FALSE(needs_reencode);
    // Must begin with SOI + JFIF 1.01 APP0
    REQUIRE(normalized->size() > 20);
    CHECK(static_cast<unsigned char>((*normalized)[0]) == 0xFFU);
    CHECK(static_cast<unsigned char>((*normalized)[1]) == 0xD8U);
    CHECK(static_cast<unsigned char>((*normalized)[2]) == 0xFFU);
    CHECK(static_cast<unsigned char>((*normalized)[3]) == 0xE0U);
    CHECK(normalized->substr(6, 5) == std::string("JFIF\0", 5));
    // EXIF and COM strings must be completely gone
    CHECK(normalized->find("FAKEEXIF") == std::string::npos);
    CHECK(normalized->find("secret") == std::string::npos);
    // Compressed DCT entropy scan must be byte-for-byte identical (zero lossy re-encode!)
    CHECK(sos_slice(*normalized) == sos_slice(baseline));
    // Decodes back to exact dimensions
    const auto decoded = images::decode(*normalized);
    CHECK(decoded.width == 64);
    CHECK(decoded.height == 48);
}

TEST_CASE("Cover thumbnail stays <= 180x240 px and <= 16 KB baseline JFIF JPEG", "[mobi][jpeg]") {
    const auto large_cover = make_checker_bitmap(900, 1400);
    const std::string cover_png = images::encode_png(large_cover);

    const std::string thumb = make_cover_thumbnail(cover_png);
    REQUIRE(!thumb.empty());
    CHECK(thumb.size() <= kThumbMaxBytes);
    CHECK(static_cast<unsigned char>(thumb[0]) == 0xFFU);
    CHECK(static_cast<unsigned char>(thumb[1]) == 0xD8U);
    CHECK(thumb.substr(6, 5) == std::string("JFIF\0", 5));

    const auto decoded = images::decode(thumb);
    CHECK(decoded.width <= kThumbMaxWidth);
    CHECK(decoded.height <= kThumbMaxHeight);
    CHECK(decoded.width > 0);
    CHECK(decoded.height > 0);
}

TEST_CASE("prepare_mobi_picture downscales oversized images under configured byte limit",
          "[mobi][jpeg]") {
    // Use an explicit smaller max_bytes parameter overload to test progressive downscale fast
    const auto bmp = make_checker_bitmap(600, 600);
    const std::string jpeg = images::encode_jpeg(bmp, 95);
    REQUIRE(jpeg.size() > 5000);

    images::ConversionPolicy policy;
    policy.jpeg_quality = 90;
    const auto prep = prepare_mobi_picture(jpeg, policy, /*max_bytes=*/4096);
    CHECK(prep.downscaled);
    CHECK(prep.bytes.size() <= 4096);
    CHECK(prep.media_type == "image/jpeg");
    CHECK(prep.width < 600);
    CHECK(prep.height < 600);
}
