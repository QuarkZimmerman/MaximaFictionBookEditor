// T042: binary store metadata (sniffing, dimensions, decodable/willConvert), temp-file spilling,
// memory accounting, unique ids, ETags, reference counts.
#include "test_support.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/image_probe.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;

namespace {

std::string image(const char* name) {
    return test::read_text(test::fixtures_dir() / "images" / name);
}

}  // namespace

TEST_CASE("image probe: content types and dimensions from headers only", "[binary]") {
    struct Case {
        const char* file;
        const char* type;
    };
    for (const Case& c : {Case{"tiny.jpg", "image/jpeg"}, Case{"tiny.png", "image/png"},
                          Case{"tiny.gif", "image/gif"}, Case{"tiny.bmp", "image/bmp"},
                          Case{"tiny.webp", "image/webp"}}) {
        INFO(c.file);
        const images::Probe p = images::probe(image(c.file));
        CHECK(p.contentType == c.type);
        CHECK(p.decodable);
        CHECK(p.width == 8);
        CHECK(p.height == 6);
    }
    // Minimal little-endian TIFF header with ImageWidth/ImageLength entries.
    std::string tiff("II*\0\x08\0\0\0", 8);
    tiff += std::string("\x02\0", 2);                                             // 2 entries
    tiff += std::string("\x00\x01\x03\x00\x01\x00\x00\x00\x20\x00\x00\x00", 12);  // 256 = 32
    tiff += std::string("\x01\x01\x03\x00\x01\x00\x00\x00\x10\x00\x00\x00", 12);  // 257 = 16
    tiff += std::string("\0\0\0\0", 4);
    const images::Probe t = images::probe(tiff);
    CHECK(t.contentType == "image/tiff");
    CHECK(t.width == 32);
    CHECK(t.height == 16);
    const images::Probe unknown = images::probe("hello, not an image");
    CHECK(unknown.contentType.empty());
    CHECK_FALSE(unknown.decodable);
    CHECK_FALSE(unknown.width.has_value());
    CHECK(images::probe("").contentType.empty());
    CHECK(images::probe("\xFF\xD8\xFF").contentType == "image/jpeg");  // truncated: no size
    CHECK_FALSE(images::probe("\xFF\xD8\xFF").width.has_value());
    CHECK(images::is_jpeg_or_png("image/JPEG"));
    CHECK(images::is_jpeg_or_png("image/jpg"));
    CHECK_FALSE(images::is_jpeg_or_png("image/gif"));
    CHECK(images::effective_content_type("", "image/png") == "image/png");
    CHECK(images::effective_content_type(" Image/Jpeg ", "") == "image/jpeg");
    CHECK(images::effective_content_type("garbage", "") == "application/octet-stream");
    CHECK(images::extension_for("image/jpeg") == "jpg");
    CHECK(images::extension_for("image/x-foo") == "bin");
}

TEST_CASE("binary store: metadata, order, replacement and reference counts", "[binary]") {
    MemoryBinaryStore store;
    const auto jpg = store.put("cover.jpg", "image/jpeg", image("tiny.jpg"));
    CHECK(jpg.id == "cover.jpg");
    CHECK(jpg.contentType == "image/jpeg");
    CHECK(jpg.size == static_cast<std::int64_t>(image("tiny.jpg").size()));
    CHECK(jpg.width == 8);
    CHECK(jpg.height == 6);
    CHECK(jpg.decodable);
    CHECK_FALSE(jpg.willConvert);
    CHECK(jpg.referenceCount == 0);

    const auto gif = store.put("anim.gif", "image/gif", image("tiny.gif"));
    CHECK(gif.decodable);
    CHECK(gif.willConvert);
    const auto webp = store.put("photo.webp", "", image("tiny.webp"));  // type sniffed
    CHECK(webp.contentType == "image/webp");
    CHECK(webp.willConvert);
    const auto blob = store.put("data.bin", "application/pdf", "%PDF-1.4 ...");
    CHECK_FALSE(blob.decodable);
    CHECK_FALSE(blob.willConvert);
    CHECK(blob.contentType == "application/pdf");
    // Declared type wins for display; the sniffed type is kept separately.
    const auto mislabelled = store.put("really.png", "image/jpeg", image("tiny.png"));
    CHECK(mislabelled.contentType == "image/jpeg");
    CHECK(store.sniffed_type("really.png") == "image/png");
    CHECK(store.effective_content_type("really.png") == "image/png");
    CHECK(store.effective_content_type("data.bin") == "application/pdf");
    CHECK(store.effective_content_type("missing") == "application/octet-stream");

    CHECK(store.ids() == std::vector<std::string>{"cover.jpg", "anim.gif", "photo.webp", "data.bin",
                                                  "really.png"});
    CHECK(store.list().size() == 5);
    CHECK(store.size() == 5);

    // Replacing keeps position and reference count.
    store.set_reference_counts({{"anim.gif", 2}});
    CHECK(store.meta("anim.gif")->referenceCount == 2);
    CHECK(store.meta("cover.jpg")->referenceCount == 0);
    store.put("anim.gif", "image/png", image("tiny.png"));
    CHECK(store.meta("anim.gif")->referenceCount == 2);
    CHECK(store.meta("anim.gif")->contentType == "image/png");
    CHECK_FALSE(store.meta("anim.gif")->willConvert);
    CHECK(store.ids()[1] == "anim.gif");

    // ETags are strong, quoted, content-based.
    const std::string etag = store.etag("cover.jpg");
    CHECK(etag.size() == 18);
    CHECK(etag.front() == '"');
    CHECK(etag != store.etag("anim.gif"));
    store.put("twin.jpg", "image/jpeg", image("tiny.jpg"));
    CHECK(store.etag("twin.jpg") == etag);
    CHECK(store.etag("nope").empty());

    CHECK(store.unique_id("cover.jpg") == "cover_2.jpg");
    CHECK(store.unique_id("fresh.png") == "fresh.png");
    CHECK(store.unique_id("") == "binary");
    CHECK(store.next_image_id("image/jpeg") == "img_7.jpg");
    store.put("img_7.jpg", "image/jpeg", "x");
    CHECK(store.next_image_id("image/png") == "img_8.png");

    CHECK(store.remove("data.bin"));
    CHECK_FALSE(store.remove("data.bin"));
    CHECK_FALSE(store.contains("data.bin"));
    CHECK(store.total_bytes() == store.memory_bytes());
    store.clear();
    CHECK(store.size() == 0);
    CHECK(store.total_bytes() == 0);
}

TEST_CASE("binary store: payloads above the threshold spill to temp files and read back",
          "[binary]") {
    BinaryStore store(200 * 1024);  // 200 KB in memory, then spill
    std::string big(150 * 1024, 'a');
    for (std::size_t i = 0; i < big.size(); ++i) {
        big[i] = static_cast<char>((i * 31) & 0xFF);
    }
    std::string small(1024, 'b');
    store.put("small", "application/octet-stream", small);
    store.put("one", "application/octet-stream", big);  // fits (151 KB)
    CHECK(store.spilled_bytes() == 0);
    store.put("two", "application/octet-stream", big);  // would exceed 200 KB -> spilled
    CHECK(store.spilled_bytes() == static_cast<std::int64_t>(big.size()));
    CHECK(store.memory_bytes() == static_cast<std::int64_t>(big.size() + small.size()));
    CHECK(store.total_bytes() == static_cast<std::int64_t>(2 * big.size() + small.size()));
    CHECK(store.bytes("two") == big);
    CHECK(store.bytes("one") == big);
    CHECK(store.meta("two")->size == static_cast<std::int64_t>(big.size()));
    CHECK(store.etag("one") == store.etag("two"));
    // Removing a spilled entry releases its accounting (and its file).
    CHECK(store.remove("two"));
    CHECK(store.spilled_bytes() == 0);
    store.put("three", "application/octet-stream", big);  // spills again
    CHECK(store.spilled_bytes() == static_cast<std::int64_t>(big.size()));
    store.put("three", "application/octet-stream", small);  // replaced by a small in-memory one
    CHECK(store.spilled_bytes() == 0);
    CHECK(store.bytes("three") == small);
}

TEST_CASE("binary store: reference counts come from the document's hrefs", "[binary]") {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const auto result =
        fb2::read_file(test::fixtures_dir() / "books" / "modern-utf8.fb2", store, ids);
    model::Document doc = result.document;
    CHECK(store.meta("cover.png")->referenceCount == 3);
    CHECK(store.meta("dot.gif")->referenceCount == 2);
    // Drop the cover page reference and recompute.
    doc.description.titleInfo.coverpage.clear();
    update_reference_counts(doc, store);
    CHECK(store.meta("cover.png")->referenceCount == 2);
    sync_binaries(doc, store);
    REQUIRE(doc.binaries.size() == 2);
    CHECK(doc.binaries[0].referenceCount == 2);
    store.put("orphan.png", "image/png", image("tiny.png"));
    update_reference_counts(doc, store);
    CHECK(store.meta("orphan.png")->referenceCount == 0);
}
