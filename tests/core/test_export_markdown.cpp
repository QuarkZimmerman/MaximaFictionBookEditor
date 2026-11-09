// Feature 011 (US5, US6; D21-D27; contracts/rpc-api.md `export.markdown`): writing a Markdown export.
#include "test_support.hpp"

#include "export/markdown_writer.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/base64.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/images.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <random>
#include <stdexcept>
#include <string>

using namespace mfbe;
namespace fs = std::filesystem;

namespace {

std::string fixture(const char* name) {
    return test::read_text(test::fixtures_dir() / "images" / name);
}

const exporting::Progress kNoProgress = [](const std::string&, std::size_t, std::size_t) {};

/** A noisy RGB picture whose JPEG is large. */
std::string noisy_png(int width, int height) {
    images::Bitmap bitmap;
    bitmap.width = width;
    bitmap.height = height;
    bitmap.rgba.resize(bitmap.pixel_count() * 4);
    std::mt19937 random(7);
    for (std::size_t i = 0; i < bitmap.rgba.size(); ++i) {
        bitmap.rgba[i] = (i % 4 == 3) ? 255 : static_cast<std::uint8_t>(random() & 0xFF);
    }
    return images::encode_png(bitmap);
}

}  // namespace

TEST_CASE("markdown export: embedded pictures are JPEGs within 734,003 bytes (D21)",
          "[export][markdown]") {
    SECTION("a JPEG within the limit is embedded byte for byte") {
        const std::string jpeg = fixture("tiny.jpg");
        CHECK(exporting::embeddable_jpeg(jpeg, "image/jpeg", 90) == jpeg);
    }
    SECTION("a picture with transparency becomes a JPEG on white") {
        const std::string out = exporting::embeddable_jpeg(fixture("alpha.png"), "image/png", 90);
        REQUIRE(out.size() > 2);
        CHECK(static_cast<unsigned char>(out[0]) == 0xFF);
        CHECK(static_cast<unsigned char>(out[1]) == 0xD8);
        const images::Bitmap back = images::decode(out);
        CHECK_FALSE(back.has_alpha);
    }
    SECTION("a large picture is reduced by steps until it fits") {
        const std::string big = noisy_png(1600, 1600);
        const std::string out = exporting::embeddable_jpeg(big, "image/png", 95);
        CHECK(out.size() <= exporting::kMaxEmbeddedPicture);
        const images::Bitmap back = images::decode(out);
        CHECK(back.width < 1600);
        CHECK(back.width > 0);
    }
}

TEST_CASE("markdown export: the one file and the ZIP (D21-D23)", "[export][markdown]") {
    test::TempDir dir;
    MemoryBinaryStore store;
    store.put("cover.jpg", "image/jpeg", fixture("tiny.jpg"));
    store.put("pic.png", "image/png", fixture("tiny.png"));
    exporting::MarkdownExport job;
    job.text = "# Book\n\n![cover][cover.jpg]\n";
    job.pictures = {{"cover.jpg", "cover.jpg"}, {"pic.png", "pic.jpg"}};

    SECTION("one file: the text, then one base64 definition per picture") {
        job.path = dir.path() / "book.md";
        exporting::write_markdown_export(job, store, kNoProgress);
        const std::string written = test::read_text(job.path);
        REQUIRE(written.rfind(job.text, 0) == 0);
        const std::string definition = "[cover.jpg]: data:image/jpeg;base64," +
                                       base64::encode(fixture("tiny.jpg")) + "\n";
        CHECK(written.find(definition) != std::string::npos);
        CHECK(written.find("[pic.jpg]: data:image/jpeg;base64,") != std::string::npos);
    }
    SECTION("ZIP: <name>.md and the pictures byte for byte in images/") {
        job.zip = true;
        job.pictures = {{"cover.jpg", "cover.jpg"}, {"pic.png", "pic.png"}};
        job.path = dir.path() / "Книга.md.zip";
        exporting::write_markdown_export(job, store, kNoProgress);
        CHECK(archive::read_entry(job.path, "Книга.md") == job.text);
        CHECK(archive::read_entry(job.path, "images/cover.jpg") == fixture("tiny.jpg"));
        CHECK(archive::read_entry(job.path, "images/pic.png") == fixture("tiny.png"));
    }
    SECTION("a cancelled export leaves no file") {
        job.path = dir.path() / "cancelled.md";
        const exporting::Progress cancel = [](const std::string& phase, std::size_t, std::size_t) {
            if (phase == "pictures") {
                throw std::runtime_error("cancelled");
            }
        };
        CHECK_THROWS(exporting::write_markdown_export(job, store, cancel));
        CHECK_FALSE(fs::exists(job.path));
    }
}
