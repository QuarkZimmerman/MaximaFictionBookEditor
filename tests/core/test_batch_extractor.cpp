// Feature 019 (T007; contracts/rpc-api.md §3.4): unit tests for core/src/batch/extractor.{hpp,cpp}
// - safe extraction of EPUB-in-ZIP and .md.zip (with images/, CSS, and archive FBD), path traversal
// rejection, nested archive ignore, and size/entry safety bounds.

#include "batch/extractor.hpp"
#include "test_support.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using namespace mfbe;

namespace {

void write_zip(const fs::path& p, const std::vector<std::pair<std::string, std::string>>& entries) {
    fs::create_directories(p.parent_path());
    std::vector<archive::ZipEntry> z;
    z.reserve(entries.size());
    for (const auto& [name, body] : entries) {
        z.push_back(archive::ZipEntry{name, body, false, false});
    }
    atomic_file::write_atomic(p, archive::zip_entries(z));
}

}  // namespace

TEST_CASE("batch extractor unpacks EPUB entry and optional archive FBD safely",
          "[batch][extractor]") {
    test::TempDir src("mfbe-batch-ext-epub-src");
    test::TempDir dst("mfbe-batch-ext-epub-dst");
    const fs::path zip = src.path() / "wrapped.zip";
    write_zip(zip, {{"books/novel.epub", "PK_FAKE_EPUB_BYTES"},
                    {"books/novel.fbd", "<FictionBook/>"},
                    {"nested.zip", "ignored"}});

    const batch::ExtractedEntry out =
        batch::extract_archive_entry(zip, "books/novel.epub", "epub", "books/novel.fbd",
                                     dst.path());
    CHECK(fs::exists(out.extracted_path));
    CHECK(atomic_file::read_file(out.extracted_path) == "PK_FAKE_EPUB_BYTES");
    REQUIRE(out.fbd_path.has_value());
    CHECK(atomic_file::read_file(*out.fbd_path) == "<FictionBook/>");
    CHECK_FALSE(fs::exists(dst.path() / "nested.zip"));
}

TEST_CASE("batch extractor unpacks Markdown ZIP with images, CSS, and FBD while blocking traversal",
          "[batch][extractor]") {
    test::TempDir src("mfbe-batch-ext-md-src");
    test::TempDir dst("mfbe-batch-ext-md-dst");
    const fs::path zip = src.path() / "story.md.zip";
    write_zip(zip, {{"story.md", "# Story\n![img](images/a.png)\n"},
                    {"images/a.png", "PNGDATA"},
                    {"styles/book.css", "p { color: black; }"},
                    {"story.fbd", "<FictionBook/>"},
                    {"../escape.png", "EVIL"},
                    {"/abs/evil.css", "EVIL"},
                    {"inner.zip", "NESTED"}});

    const batch::ExtractedEntry out =
        batch::extract_archive_entry(zip, "story.md", "markdown", "story.fbd", dst.path());
    CHECK(atomic_file::read_file(out.extracted_path) == "# Story\n![img](images/a.png)\n");
    CHECK(atomic_file::read_file(out.temp_dir / "images" / "a.png") == "PNGDATA");
    CHECK(atomic_file::read_file(out.temp_dir / "styles" / "book.css") == "p { color: black; }");
    REQUIRE(out.fbd_path.has_value());
    CHECK(atomic_file::read_file(*out.fbd_path) == "<FictionBook/>");
    // Malicious traversal entries and nested archives are never written.
    CHECK_FALSE(fs::exists(dst.path().parent_path() / "escape.png"));
    CHECK_FALSE(fs::exists(dst.path() / "inner.zip"));
}

TEST_CASE("batch extractor rejects traversal target entry names and corrupt archives",
          "[batch][extractor]") {
    test::TempDir src("mfbe-batch-ext-bad-src");
    test::TempDir dst("mfbe-batch-ext-bad-dst");
    const fs::path bad_zip = src.path() / "corrupt.zip";
    atomic_file::write_atomic(bad_zip, "not a zip");

    CHECK_THROWS_AS(batch::extract_archive_entry(bad_zip, "book.epub", "epub", std::nullopt,
                                                 dst.path()),
                    batch::ExtractError);

    const fs::path traversal_zip = src.path() / "trav.zip";
    write_zip(traversal_zip, {{"../bad.md", "# Bad"}});
    CHECK_THROWS_AS(batch::extract_archive_entry(traversal_zip, "../bad.md", "markdown",
                                                 std::nullopt, dst.path()),
                    batch::ExtractError);
}
