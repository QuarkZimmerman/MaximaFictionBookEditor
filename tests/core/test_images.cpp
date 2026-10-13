// T090/T091/T092: image codecs - decoding of every fixture format (JPEG/PNG/GIF/BMP/WebP/TIFF),
// JPEG/PNG encoding, the conversion policy (pass-through, alpha -> PNG), size limits,
// undecodable data, previews, the store conversion, convert-on-save through doc.save, the
// binary.add/convert/addFromClipboard RPCs, the /preview endpoint and the CLI.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>
#include <mfbe/roundtrip.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstdlib>

using namespace mfbe;
using nlohmann::json;

namespace {

std::string fixture(const char* name) {
    return test::read_text(test::fixtures_dir() / "images" / name);
}

// The tiny fixtures are 8x6 with a blue-ish background and a red-ish 4x2 rectangle; the
// exact values differ per format (palette, JPEG loss), so only coarse colour checks apply.
void check_tiny(const images::Bitmap& bitmap, const char* type) {
    INFO(type);
    CHECK(bitmap.width == 8);
    CHECK(bitmap.height == 6);
    CHECK(bitmap.rgba.size() == 8 * 6 * 4);
    CHECK(bitmap.source_type == type);
}

long long ms_since(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() -
                                                                 t0)
        .count();
}

// Synthetic RGBA gradient (optionally with a transparent corner).
images::Bitmap gradient(int w, int h, bool transparent_corner) {
    images::Bitmap b;
    b.width = w;
    b.height = h;
    b.rgba.resize(static_cast<std::size_t>(w) * h * 4);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            std::uint8_t* p = b.rgba.data() + (static_cast<std::size_t>(y) * w + x) * 4;
            p[0] = static_cast<std::uint8_t>(x * 255 / std::max(1, w - 1));
            p[1] = static_cast<std::uint8_t>(y * 255 / std::max(1, h - 1));
            p[2] = 128;
            p[3] = (transparent_corner && x < w / 4 && y < h / 4) ? 0 : 255;
        }
    }
    b.update_alpha_flag();
    return b;
}

}  // namespace

TEST_CASE("images: every fixture format decodes to an 8x6 RGBA bitmap", "[images]") {
    check_tiny(images::decode(fixture("tiny.jpg")), "image/jpeg");
    check_tiny(images::decode(fixture("tiny.png")), "image/png");
    check_tiny(images::decode(fixture("tiny.gif")), "image/gif");
    check_tiny(images::decode(fixture("tiny.bmp")), "image/bmp");
    check_tiny(images::decode(fixture("tiny.webp")), "image/webp");
    check_tiny(images::decode(fixture("tiny.tif")), "image/tiff");
    // Opaque fixtures report no alpha; pixel (0,0) of the PNG/TIFF/GIF/BMP is the same colour
    // (lossless formats of the same source image).
    const images::Bitmap png = images::decode(fixture("tiny.png"));
    CHECK_FALSE(png.has_alpha);
    for (const char* name : {"tiny.gif", "tiny.bmp", "tiny.tif"}) {
        const images::Bitmap other = images::decode(fixture(name));
        INFO(name);
        CHECK_FALSE(other.has_alpha);
        CHECK(other.rgba[0] == png.rgba[0]);
        CHECK(other.rgba[1] == png.rgba[1]);
        CHECK(other.rgba[2] == png.rgba[2]);
        CHECK(other.rgba[3] == 255);
    }
    const images::Bitmap jpg = images::decode(fixture("tiny.jpg"));
    CHECK_FALSE(jpg.has_alpha);
    CHECK(jpg.rgba[3] == 255);
    // Transparency is detected in PNG and WebP.
    const images::Bitmap alpha_png = images::decode(fixture("alpha.png"));
    CHECK(alpha_png.has_alpha);
    CHECK(alpha_png.rgba[3] == 255);  // (0,0) opaque red
    CHECK(alpha_png.rgba[0] == 255);
    CHECK(alpha_png.rgba[(5 * 8 + 7) * 4 + 3] == 0);   // bottom-right fully transparent
    CHECK(alpha_png.rgba[(0 * 8 + 5) * 4 + 3] < 255);  // half-transparent blue
    const images::Bitmap alpha_webp = images::decode(fixture("alpha.webp"));
    CHECK(alpha_webp.has_alpha);
    CHECK(alpha_webp.rgba[(5 * 8 + 7) * 4 + 3] == 0);
    CHECK_FALSE(images::decode(fixture("opaque-rgb.png")).has_alpha);
}

TEST_CASE("images: undecodable or oversized data is refused with a clear error", "[images]") {
    std::string error;
    CHECK_FALSE(images::try_decode("not an image at all", &error));
    CHECK(error.find("unsupported") == 0);
    CHECK_FALSE(images::try_decode(fixture("tiny.png").substr(0, 30), &error));
    CHECK(error.find("corrupt") == 0);
    CHECK_FALSE(images::try_decode(fixture("tiny.jpg").substr(0, 100) + "garbage", &error));
    CHECK_FALSE(images::try_decode("GIF89a\x08\x00\x06\x00", &error));
    CHECK(error.find("corrupt") == 0);
    CHECK_FALSE(images::try_decode("", &error));
    // A PNG header claiming 20000 x 20000 (400 MP) is refused before pixel memory is touched
    // (IHDR CRC recomputed so libpng accepts the chunk).
    std::string huge = fixture("tiny.png");
    const char dims[8] = {0, 0, 0x4E, 0x20, 0, 0, 0x4E, 0x20};
    huge.replace(16, 8, dims, 8);
    std::uint32_t crc = 0xFFFFFFFFu;
    for (std::size_t i = 12; i < 29; ++i) {  // "IHDR" + 13 data bytes
        crc ^= static_cast<unsigned char>(huge[i]);
        for (int k = 0; k < 8; ++k) {
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
        }
    }
    crc ^= 0xFFFFFFFFu;
    for (int i = 0; i < 4; ++i) {
        huge[29 + i] = static_cast<char>((crc >> (24 - 8 * i)) & 0xFF);
    }
    CHECK_THROWS_AS(images::decode(huge), images::DecodeError);
    try {
        images::decode(huge);
    } catch (const images::DecodeError& e) {
        CHECK(e.code == "tooLarge");
        CHECK(e.detail.find("100 megapixels") != std::string::npos);
    }
    // (convert() passes PNG bytes through untouched, so the size limit only matters for
    // formats that get decoded.)
    CHECK(images::convert(huge, images::ConversionPolicy{}, &error)->changed == false);
    // A BMP header (no checksum) claiming 70000 x 2 pixels (dimension limit).
    std::string wide = fixture("tiny.bmp");
    const char bmp_dims[8] = {0x70, 0x11, 0x01, 0, 0x02, 0, 0, 0};
    wide.replace(18, 8, bmp_dims, 8);
    CHECK_FALSE(images::try_decode(wide, &error));
    CHECK(error.find("tooLarge") == 0);
    CHECK_FALSE(images::convert(wide, images::ConversionPolicy{}, &error));
    CHECK(error.find("tooLarge") == 0);
    // SVG is recognised but not decodable: preserved, reported.
    const images::Probe svg = images::probe("<svg xmlns='http://www.w3.org/2000/svg'/>");
    CHECK(svg.contentType == "image/svg+xml");
    CHECK_FALSE(svg.decodable);
}

TEST_CASE("images: JPEG (quality) and PNG encoders round-trip through the decoders", "[images]") {
    const images::Bitmap src = gradient(64, 48, false);
    const std::string q90 = images::encode_jpeg(src, 90);
    const std::string q30 = images::encode_jpeg(src, 30);
    CHECK(images::sniff_content_type(q90) == "image/jpeg");
    CHECK(q30.size() < q90.size());
    const images::Bitmap back = images::decode(q90);
    CHECK(back.width == 64);
    CHECK(back.height == 48);
    CHECK_FALSE(back.has_alpha);
    // Lossy but close: centre pixel within a tolerance.
    const std::size_t centre = (24 * 64 + 32) * 4;
    CHECK(std::abs(int(back.rgba[centre]) - int(src.rgba[centre])) < 12);
    CHECK(std::abs(int(back.rgba[centre + 1]) - int(src.rgba[centre + 1])) < 12);
    CHECK(std::abs(int(back.rgba[centre + 2]) - int(src.rgba[centre + 2])) < 12);
    const std::string png = images::encode_png(src);
    CHECK(images::sniff_content_type(png) == "image/png");
    CHECK(images::decode(png).rgba == src.rgba);  // lossless, RGB (alpha 255 everywhere)
    const images::Bitmap with_alpha = gradient(16, 16, true);
    const std::string png_alpha = images::encode_png(with_alpha);
    const images::Bitmap alpha_back = images::decode(png_alpha);
    CHECK(alpha_back.has_alpha);
    CHECK(alpha_back.rgba == with_alpha.rgba);
    // JPEG has no alpha: transparent pixels are composited over white.
    const images::Bitmap flattened = images::decode(images::encode_jpeg(with_alpha, 95));
    CHECK_FALSE(flattened.has_alpha);
    CHECK(flattened.rgba[0] > 200);
    CHECK(flattened.rgba[1] > 200);
    CHECK(flattened.rgba[2] > 200);
    CHECK_THROWS_AS(images::encode_png(images::Bitmap{}), images::DecodeError);
}

TEST_CASE(
    "images: conversion policy - JPEG/PNG pass through byte-for-byte, others follow the "
    "setting, transparency forces PNG",
    "[images]") {
    images::ConversionPolicy policy;  // jpeg, 90
    std::string error;
    // Pass-through: identical bytes, not marked as changed, even with a PNG preference.
    for (const char* name : {"tiny.jpg", "tiny.png", "alpha.png"}) {
        INFO(name);
        const std::string bytes = fixture(name);
        auto c = images::convert(bytes, policy, &error);
        REQUIRE(c);
        CHECK_FALSE(c->changed);
        CHECK(c->bytes == bytes);
        CHECK(c->content_type == images::sniff_content_type(bytes));
        CHECK(c->width == 8);
        policy.preferred = images::Format::png;
        c = images::convert(bytes, policy, &error);
        REQUIRE(c);
        CHECK_FALSE(c->changed);
        CHECK(c->bytes == bytes);
        policy.preferred = images::Format::jpeg;
    }
    // Opaque GIF/BMP/WebP/TIFF -> JPEG (default) or PNG per the setting.
    for (const char* name : {"tiny.gif", "tiny.bmp", "tiny.webp", "tiny.tif"}) {
        INFO(name);
        const std::string bytes = fixture(name);
        auto c = images::convert(bytes, policy, &error);
        REQUIRE(c);
        CHECK(c->changed);
        CHECK(c->content_type == "image/jpeg");
        CHECK(c->from_type == images::sniff_content_type(bytes));
        CHECK(images::sniff_content_type(c->bytes) == "image/jpeg");
        CHECK(images::decode(c->bytes).width == 8);
        policy.preferred = images::Format::png;
        c = images::convert(bytes, policy, &error);
        REQUIRE(c);
        CHECK(c->content_type == "image/png");
        CHECK(images::sniff_content_type(c->bytes) == "image/png");
        policy.preferred = images::Format::jpeg;
    }
    // Transparent WebP -> PNG even though JPEG is preferred (alpha preserved).
    auto webp = images::convert(fixture("alpha.webp"), policy, &error);
    REQUIRE(webp);
    CHECK(webp->changed);
    CHECK(webp->content_type == "image/png");
    CHECK(images::decode(webp->bytes).has_alpha);
    // ... unless the alpha rule is switched off (explicit binary.convert to JPEG).
    policy.png_when_alpha = false;
    webp = images::convert(fixture("alpha.webp"), policy, &error);
    REQUIRE(webp);
    CHECK(webp->content_type == "image/jpeg");
    policy.png_when_alpha = true;
    // force: re-encodes JPEG/PNG inputs to the other format, keeps the same format untouched.
    auto forced = images::convert(fixture("opaque-rgb.png"), policy, &error, true);
    REQUIRE(forced);
    CHECK(forced->changed);
    CHECK(forced->content_type == "image/jpeg");
    forced = images::convert(fixture("tiny.jpg"), policy, &error, true);
    REQUIRE(forced);
    CHECK_FALSE(forced->changed);
    CHECK(forced->bytes == fixture("tiny.jpg"));
    // Quality is honoured.
    const images::Bitmap big = gradient(256, 256, false);
    const std::string bmp_like = images::encode_png(big);  // a PNG forced to JPEG at two qualities
    images::ConversionPolicy low;
    low.jpeg_quality = 20;
    images::ConversionPolicy high;
    high.jpeg_quality = 95;
    CHECK(images::convert(bmp_like, low, &error, true)->bytes.size() <
          images::convert(bmp_like, high, &error, true)->bytes.size());
    CHECK_FALSE(images::convert("junk", policy, &error));
    CHECK(error.find("unsupported") == 0);
}

TEST_CASE("images: previews are scaled down (never up), JPEG when opaque, PNG when transparent",
          "[images]") {
    const images::Bitmap big = gradient(640, 400, false);
    const images::Bitmap scaled = images::scale_to_fit(big, 160, 160);
    CHECK(scaled.width == 160);
    CHECK(scaled.height == 100);
    CHECK_FALSE(scaled.has_alpha);
    // Corners keep their colours (gradient endpoints).
    CHECK(scaled.rgba[0] < 8);                                          // left: red ~0
    CHECK(scaled.rgba[(159) * 4] > 247);                                // right: red ~255
    CHECK(scaled.rgba[(99 * 160) * 4 + 1] > 247);                       // bottom: green ~255
    const images::Bitmap same = images::scale_to_fit(big, 1000, 1000);  // never upscaled
    CHECK(same.width == 640);
    CHECK(images::scale_to_fit(big, 0, 200).width == 320);  // one axis unbounded
    const images::Bitmap one = images::scale_to_fit(big, 1, 1);
    CHECK(one.width == 1);
    CHECK(one.height == 1);
    const images::Bitmap alpha = images::scale_to_fit(gradient(64, 64, true), 16, 16);
    CHECK(alpha.has_alpha);
    CHECK(alpha.rgba[3] == 0);  // transparent corner stays transparent

    images::PreviewCache cache(1024 * 1024);
    const std::string png = images::encode_png(big);
    std::string error;
    auto p1 = cache.get("k1", png, 200, 200, &error);
    REQUIRE(p1);
    CHECK(p1->content_type == "image/jpeg");
    CHECK(p1->width == 200);
    CHECK(p1->height == 125);
    CHECK_FALSE(p1->original);
    CHECK(images::decode(p1->bytes).width == 200);
    CHECK(cache.entry_count() == 1);
    auto again = cache.get("k1", png, 200, 200, &error);
    REQUIRE(again);
    CHECK(again->bytes == p1->bytes);  // served from the cache
    CHECK(cache.entry_count() == 1);
    // A JPEG/PNG source that already fits is served unchanged.
    auto small = cache.get("k2", fixture("tiny.png"), 100, 100, &error);
    REQUIRE(small);
    CHECK(small->original);
    CHECK(small->bytes == fixture("tiny.png"));
    CHECK(small->content_type == "image/png");
    // A GIF never is (not JPEG/PNG): it is re-encoded even when it fits.
    auto gif = cache.get("k3", fixture("tiny.gif"), 100, 100, &error);
    REQUIRE(gif);
    CHECK_FALSE(gif->original);
    CHECK(gif->content_type == "image/jpeg");
    CHECK(gif->width == 8);
    // Transparent sources give PNG previews.
    auto alpha_preview =
        cache.get("k4", images::encode_png(gradient(300, 300, true)), 50, 50, &error);
    REQUIRE(alpha_preview);
    CHECK(alpha_preview->content_type == "image/png");
    CHECK(alpha_preview->width == 50);
    // Default size when nothing is requested; invalidation by prefix; undecodable -> nullopt.
    auto defaulted = cache.get("k5", png, 0, 0, &error);
    REQUIRE(defaulted);
    CHECK(defaulted->width == 512);
    cache.invalidate_prefix("k1");
    CHECK(cache.entry_count() == 4);
    CHECK_FALSE(cache.get("k6", "garbage", 10, 10, &error));
    CHECK_FALSE(error.empty());
    cache.clear();
    CHECK(cache.size_bytes() == 0);
    // Memory cap: a tiny cache keeps only the newest entries.
    images::PreviewCache tiny_cache(4096);
    for (int i = 0; i < 20; ++i) {
        tiny_cache.get("k" + std::to_string(i), png, 300, 300, &error);
    }
    CHECK(tiny_cache.size_bytes() <= 4096 + 100000);  // one entry may exceed the cap alone
    CHECK(tiny_cache.entry_count() <= 20);
}

TEST_CASE("images: JPEG previews of a large photo use DCT scaling (fast)", "[images][perf]") {
    const images::Bitmap photo = gradient(4000, 3000, false);  // 12 MP
    const auto t_enc = std::chrono::steady_clock::now();
    const std::string jpeg = images::encode_jpeg(photo, 90);
    const long long encode_ms = ms_since(t_enc);
    const auto t0 = std::chrono::steady_clock::now();
    const images::Bitmap small = images::decode_for_preview(jpeg, 256, 256);
    const long long ms = ms_since(t0);
    CHECK(small.width >= 256);
    CHECK(small.width <= 1000);  // 1/4 or 1/8 of 4000
    images::PreviewCache cache;
    std::string error;
    const auto t1 = std::chrono::steady_clock::now();
    const auto preview = cache.get("photo", jpeg, 256, 256, &error);
    const long long preview_ms = ms_since(t1);
    REQUIRE(preview);
    CHECK(preview->width == 256);
    CHECK(preview->height == 192);
    CHECK(preview_ms < 2000);
    std::printf(
        "[perf] images: 12 MP JPEG encode %lld ms, DCT-scaled decode %lld ms, 256px preview %lld "
        "ms\n",
        encode_ms, ms, preview_ms);
}

TEST_CASE("images: convert_store converts willConvert binaries in place and keeps the rest",
          "[images]") {
    MemoryBinaryStore store;
    store.put("a.gif", "image/gif", fixture("tiny.gif"));
    store.put("b.png", "image/png", fixture("tiny.png"));
    store.put("c.jpg", "image/jpeg", fixture("tiny.jpg"));
    store.put("d.webp", "image/webp", fixture("alpha.webp"));
    store.put("e.bin", "application/pdf", "%PDF-1.4 not an image");
    const std::string truncated_gif = fixture("tiny.gif").substr(0, 20);  // probe says yes
    store.put("f.gif", "image/gif", truncated_gif);
    store.put("g.txt", "image/png", "not really base64", true);  // raw text
    std::vector<std::pair<std::size_t, std::size_t>> progress;
    const auto result = images::convert_store(
        store, images::ConversionPolicy{},
        [&](std::size_t done, std::size_t total) { progress.emplace_back(done, total); });
    REQUIRE(result.converted.size() == 2);
    CHECK(result.converted[0].id == "a.gif");
    CHECK(result.converted[0].from == "image/gif");
    CHECK(result.converted[0].to == "image/jpeg");
    CHECK(result.converted[0].meta.contentType == "image/jpeg");
    CHECK_FALSE(result.converted[0].meta.willConvert);
    CHECK(result.converted[1].id == "d.webp");
    CHECK(result.converted[1].to == "image/png");  // transparent -> PNG
    CHECK(result.failed == std::vector<std::string>{"f.gif"});
    CHECK(progress.size() == 3);
    CHECK(progress.back() == std::make_pair<std::size_t, std::size_t>(3, 3));
    // Same ids and order, JPEG/PNG untouched, undecodable kept verbatim and flagged.
    CHECK(store.ids() ==
          std::vector<std::string>{"a.gif", "b.png", "c.jpg", "d.webp", "e.bin", "f.gif", "g.txt"});
    CHECK(store.bytes("b.png") == fixture("tiny.png"));
    CHECK(store.bytes("c.jpg") == fixture("tiny.jpg"));
    CHECK(store.meta("a.gif")->contentType == "image/jpeg");
    CHECK(images::sniff_content_type(*store.bytes("a.gif")) == "image/jpeg");
    CHECK(store.meta("d.webp")->contentType == "image/png");
    CHECK(store.bytes("e.bin") == "%PDF-1.4 not an image");
    CHECK_FALSE(store.meta("e.bin")->decodable);
    CHECK(store.bytes("f.gif") == truncated_gif);
    CHECK_FALSE(store.meta("f.gif")->decodable);
    CHECK_FALSE(store.meta("f.gif")->willConvert);
    CHECK(store.is_raw_text("g.txt"));
    // Idempotent.
    CHECK(images::convert_store(store, images::ConversionPolicy{}).converted.empty());
}

TEST_CASE("images: a 20 MP BMP converts to JPEG within the budget", "[images][perf]") {
    const images::Bitmap big = gradient(5000, 4000, false);
    // Build a 32-bit BMP by hand (BITMAPINFOHEADER, top-down, BGRA).
    const std::uint32_t row = 5000 * 4;
    const std::uint32_t pixels = row * 4000;
    std::string bmp;
    bmp.reserve(54 + pixels);
    auto le16 = [&](std::uint16_t v) {
        bmp.push_back(static_cast<char>(v & 0xFF));
        bmp.push_back(static_cast<char>(v >> 8));
    };
    auto le32 = [&](std::uint32_t v) {
        for (int i = 0; i < 4; ++i) {
            bmp.push_back(static_cast<char>((v >> (8 * i)) & 0xFF));
        }
    };
    bmp += "BM";
    le32(54 + pixels);
    le32(0);
    le32(54);
    le32(40);
    le32(5000);
    le32(static_cast<std::uint32_t>(-4000));  // top-down
    le16(1);
    le16(32);
    le32(0);
    le32(pixels);
    le32(2835);
    le32(2835);
    le32(0);
    le32(0);
    const std::size_t header = bmp.size();
    bmp.resize(header + pixels);
    for (std::size_t i = 0; i < big.pixel_count(); ++i) {
        bmp[header + i * 4] = static_cast<char>(big.rgba[i * 4 + 2]);
        bmp[header + i * 4 + 1] = static_cast<char>(big.rgba[i * 4 + 1]);
        bmp[header + i * 4 + 2] = static_cast<char>(big.rgba[i * 4]);
        bmp[header + i * 4 + 3] = static_cast<char>(255);
    }
    REQUIRE(images::probe(bmp).width == 5000);
    std::string error;
    const auto t0 = std::chrono::steady_clock::now();
    const auto converted = images::convert(bmp, images::ConversionPolicy{}, &error);
    const long long ms = ms_since(t0);
    INFO(error);
    REQUIRE(converted);
    CHECK(converted->content_type == "image/jpeg");
    CHECK(converted->width == 5000);
    CHECK(converted->bytes.size() < bmp.size() / 10);
    CHECK(ms < 15000);
    std::printf("[perf] images: 20 MP BMP (%zu bytes) -> JPEG q90 (%zu bytes) in %lld ms\n",
                bmp.size(), converted->bytes.size(), ms);
}

TEST_CASE("images: doc.save converts a GIF binary, reports it, writes only JPEG/PNG binaries",
          "[images][server]") {
    test::TempDir data{"mfbe-images-rpc"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const json opened = ws.call(
        "doc.open", json{{"path", (test::fixtures_dir() / "books" / "modern-utf8.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    // binary.add of the GIF and WebP fixtures (ids from the file names) + a non-image file.
    const json gif =
        ws.call("binary.add",
                json{{"docId", doc_id},
                     {"path", (test::fixtures_dir() / "images" / "tiny.gif").string()}})["result"];
    CHECK(gif["id"] == "tiny.gif");
    CHECK(gif["contentType"] == "image/gif");
    CHECK(gif["willConvert"] == true);
    CHECK(gif["decodable"] == true);
    const json webp = ws.call(
        "binary.add", json{{"docId", doc_id},
                           {"path", (test::fixtures_dir() / "images" / "alpha.webp").string()},
                           {"suggestedId", "pic.webp"}})["result"];
    CHECK(webp["id"] == "pic.webp");
    CHECK(webp["willConvert"] == true);
    // convertNow applies the policy immediately (opaque TIFF -> JPEG).
    const json tif = ws.call("binary.add",
                             json{{"docId", doc_id},
                                  {"path", (test::fixtures_dir() / "images" / "tiny.tif").string()},
                                  {"convertNow", true}})["result"];
    CHECK(tif["id"] == "tiny.tif");
    CHECK(tif["contentType"] == "image/jpeg");
    CHECK(tif["willConvert"] == false);
    test::write_text(data / "notes.txt", "plain text attachment");
    const json txt = ws.call(
        "binary.add", json{{"docId", doc_id}, {"path", (data / "notes.txt").string()}})["result"];
    CHECK(txt["id"] == "notes.txt");
    CHECK(txt["contentType"] == "application/octet-stream");
    CHECK(txt["decodable"] == false);
    CHECK(txt["willConvert"] == false);

    const std::string target = (data / "saved.fb2").string();
    json saved = ws.call(
        "doc.save", json{{"docId", doc_id}, {"document", doc}, {"path", target}, {"force", true}},
        20000);
    REQUIRE(saved.contains("result"));
    const json& converted = saved["result"]["converted"];
    REQUIRE(converted.size() == 3);  // dot.gif (from the file), tiny.gif, pic.webp
    std::map<std::string, std::pair<std::string, std::string>> by_id;
    for (const json& c : converted) {
        by_id[c["id"]] = {c["from"], c["to"]};
        CHECK(c["willConvert"] == false);
        CHECK(c["decodable"] == true);
        CHECK(c["contentType"] == c["to"]);
    }
    CHECK(by_id["dot.gif"] == std::make_pair<std::string, std::string>("image/gif", "image/jpeg"));
    CHECK(by_id["tiny.gif"].second == "image/jpeg");
    CHECK(by_id["pic.webp"].second == "image/png");  // transparent
    // The written file holds only JPEG/PNG images (plus the preserved non-image binary),
    // the PNG/JPEG inputs byte-identical, every reference still resolving.
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const fb2::ReadResult reread = fb2::read_file(target, store, ids);
    for (const model::BinaryMeta& meta : store.list()) {
        INFO(meta.id);
        if (meta.decodable) {
            CHECK(images::is_jpeg_or_png(meta.contentType));
            CHECK(images::is_jpeg_or_png(store.sniffed_type(meta.id)));
        } else {
            CHECK(meta.id == "notes.txt");
        }
    }
    CHECK(store.bytes("cover.png") == fixture("tiny.png"));
    CHECK(store.bytes("notes.txt") == "plain text attachment");
    CHECK(store.meta("dot.gif")->contentType == "image/jpeg");
    bool dangling = false;
    for (const auto& issue : saved["result"]["validation"]["issues"]) {
        dangling = dangling || issue["code"] == "image.missingBinary";
    }
    CHECK_FALSE(dangling);
    // The live store was converted too (binary.list), previews follow.
    const json list = ws.call("binary.list", json{{"docId", doc_id}})["result"];
    for (const json& meta : list) {
        if (meta["id"] != "notes.txt") {
            CHECK(images::is_jpeg_or_png(meta["contentType"].get<std::string>()));
        }
        CHECK(meta["willConvert"] == false);
    }
    // A second save converts nothing more.
    saved = ws.call("doc.save",
                    json{{"docId", doc_id}, {"document", doc}, {"path", target}, {"force", true}},
                    20000);
    CHECK(saved["result"]["converted"] == json::array());
}

TEST_CASE("images: binary.convert, binary.addFromClipboard, /preview endpoint",
          "[images][server]") {
    test::TempDir data{"mfbe-images-rpc"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const std::string tok = "token=" + server->token();
    const json doc = ws.call("doc.new")["result"];
    const std::string doc_id = doc["docId"];
    // Upload a transparent PNG and the alpha WebP; convert explicitly.
    auto posted =
        test::http_request(server->port(), "POST", "/binary/" + doc_id + "?" + tok,
                           {{"Content-Type", "image/png"}, {"X-MFBE-Suggested-Id", "alpha.png"}},
                           fixture("alpha.png"));
    REQUIRE(posted.status == 201);
    CHECK(json::parse(posted.body)["id"] == "alpha.png");
    // PNG -> JPEG on explicit request (alpha flattened), same id; quality honoured.
    json converted =
        ws.call("binary.convert",
                json{{"docId", doc_id}, {"id", "alpha.png"}, {"format", "jpeg"}, {"quality", 80}});
    REQUIRE(converted.contains("result"));
    CHECK(converted["result"]["id"] == "alpha.png");
    CHECK(converted["result"]["contentType"] == "image/jpeg");
    CHECK(converted["result"]["willConvert"] == false);
    auto got = test::http_get(server->port(), "/binary/" + doc_id + "/alpha.png?" + tok);
    CHECK(got.headers["content-type"] == "image/jpeg");
    CHECK(images::sniff_content_type(got.body) == "image/jpeg");
    // Same format again: no re-encode (byte-identical).
    const json again =
        ws.call("binary.convert", json{{"docId", doc_id}, {"id", "alpha.png"}, {"format", "jpeg"}});
    CHECK(again["result"]["size"] == converted["result"]["size"]);
    CHECK(test::http_get(server->port(), "/binary/" + doc_id + "/alpha.png?" + tok).body ==
          got.body);
    CHECK(ws.call("binary.convert", json{{"docId", doc_id},
                                         {"id", "alpha.png"},
                                         {"format", "bmp"}})["error"]["code"] == -32602);
    CHECK(ws.call("binary.convert",
                  json{{"docId", doc_id}, {"id", "nope"}, {"format", "png"}})["error"]["code"] ==
          1010);
    CHECK(ws.call("binary.convert", json{{"docId", doc_id},
                                         {"id", "alpha.png"},
                                         {"format", "png"},
                                         {"quality", 0}})["error"]["code"] == -32602);

    // Clipboard: queued provider; the pasted image lands in the settings' paste format.
    CHECK(ws.call("binary.addFromClipboard", json{{"docId", doc_id}})["error"]["code"] ==
          1002);  // empty
    ws.call("test.enqueueClipboardImage",
            json{{"path", (test::fixtures_dir() / "images" / "opaque-rgb.png").string()}});
    json pasted = ws.call("binary.addFromClipboard", json{{"docId", doc_id}});
    REQUIRE(pasted.contains("result"));
    CHECK(pasted["result"]["id"] == "img_2.jpg");  // default format jpeg -> .jpg id
    CHECK(pasted["result"]["contentType"] == "image/jpeg");
    ws.call("settings.set", json{{"patch", {{"other", {{"pasteImageFormat", "png"}}}}}});
    ws.call("test.enqueueClipboardImage",
            json{{"path", (test::fixtures_dir() / "images" / "tiny.bmp").string()},
                 {"contentType", "image/bmp"}});
    pasted =
        ws.call("binary.addFromClipboard", json{{"docId", doc_id}, {"suggestedId", "paste.bmp"}});
    CHECK(pasted["result"]["id"] == "paste.bmp");
    CHECK(pasted["result"]["contentType"] == "image/png");
    // Transparent clipboard image -> PNG even with the JPEG setting.
    ws.call("settings.set", json{{"patch", {{"other", {{"pasteImageFormat", "jpeg"}}}}}});
    ws.call("test.enqueueClipboardImage",
            json{{"path", (test::fixtures_dir() / "images" / "alpha.png").string()}});
    pasted = ws.call("binary.addFromClipboard", json{{"docId", doc_id}});
    CHECK(pasted["result"]["contentType"] == "image/png");
    CHECK(pasted["result"]["id"] == "img_4.png");

    // Previews: scaled, correct type, ETag per size, 304, fallback for undecodable data.
    auto big_posted =
        test::http_request(server->port(), "POST", "/binary/" + doc_id + "?" + tok,
                           {{"Content-Type", "image/png"}, {"X-MFBE-Suggested-Id", "big.png"}},
                           images::encode_png(gradient(800, 600, false)));
    REQUIRE(big_posted.status == 201);
    auto preview =
        test::http_get(server->port(), "/binary/" + doc_id + "/big.png/preview?w=200&h=200&" + tok);
    REQUIRE(preview.status == 200);
    CHECK(preview.headers["content-type"] == "image/jpeg");
    CHECK(preview.headers["x-mfbe-preview-width"] == "200");
    CHECK(preview.headers["x-mfbe-preview-height"] == "150");
    CHECK(images::decode(preview.body).width == 200);
    const std::string etag = preview.headers["etag"];
    REQUIRE_FALSE(etag.empty());
    CHECK(test::http_get(server->port(),
                         "/binary/" + doc_id + "/big.png/preview?w=200&h=200&" + tok,
                         {{"If-None-Match", etag}})
              .status == 304);
    auto other_size =
        test::http_get(server->port(), "/binary/" + doc_id + "/big.png/preview?w=100&" + tok);
    CHECK(other_size.headers["etag"] != etag);
    CHECK(other_size.headers["x-mfbe-preview-width"] == "100");
    auto head = test::http_get(
        server->port(), "/binary/" + doc_id + "/big.png/preview?w=200&h=200&" + tok, {}, "HEAD");
    CHECK(head.status == 200);
    CHECK(head.body.empty());
    CHECK(head.headers["content-length"] == std::to_string(preview.body.size()));
    // Transparent source -> PNG preview; small JPEG/PNG served as is.
    auto alpha_prev =
        test::http_get(server->port(), "/binary/" + doc_id + "/img_4.png/preview?w=4&" + tok);
    CHECK(alpha_prev.headers["content-type"] == "image/png");
    auto small_prev =
        test::http_get(server->port(), "/binary/" + doc_id + "/img_2.jpg/preview?w=500&" + tok);
    CHECK(small_prev.body ==
          test::http_get(server->port(), "/binary/" + doc_id + "/img_2.jpg?" + tok).body);
    // Undecodable binary: original bytes, declared type.
    test::http_request(server->port(), "POST", "/binary/" + doc_id + "?" + tok,
                       {{"Content-Type", "application/pdf"}, {"X-MFBE-Suggested-Id", "doc.pdf"}},
                       "%PDF-1.4 ...");
    auto pdf_prev =
        test::http_get(server->port(), "/binary/" + doc_id + "/doc.pdf/preview?w=100&" + tok);
    CHECK(pdf_prev.status == 200);
    CHECK(pdf_prev.body == "%PDF-1.4 ...");
    CHECK(pdf_prev.headers["content-type"] == "application/pdf");
    CHECK(test::http_get(server->port(), "/binary/" + doc_id + "/big.png/preview").status == 401);
    CHECK(test::http_get(server->port(), "/binary/" + doc_id + "/nope/preview?" + tok).status ==
          404);
}

TEST_CASE("images: roundtrip and the CLI convert images", "[images][cli]") {
    test::TempDir out{"mfbe-images-cli"};
    const roundtrip::Report report =
        roundtrip::run(test::fixtures_dir() / "books" / "modern-utf8.fb2", out.path());
    CHECK(report.identical);
    CHECK(report.valid);
    CHECK(report.converted_ids == std::vector<std::string>{"dot.gif"});
    CHECK(report.non_jpeg_png_ids.empty());
    CHECK(report.to_json()["binaries"]["converted"] == 1);
    images::ConversionPolicy png_policy;
    png_policy.preferred = images::Format::png;
    const roundtrip::Report as_png = roundtrip::run(
        test::fixtures_dir() / "books" / "modern-utf8.fb2", out / "png", "utf-8", png_policy);
    CHECK(as_png.converted_ids == std::vector<std::string>{"dot.gif"});
    CHECK(test::read_text(out / "png" / "modern-utf8.fb2")
              .find("id=\"dot.gif\" content-type=\"image/png\"") != std::string::npos);
}
