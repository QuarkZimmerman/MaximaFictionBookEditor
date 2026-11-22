// Feature 019 (T006; contracts/rpc-api.md §3.1, data-model.md §4): unit tests for
// core/src/batch/scanner.{hpp,cpp} - deterministic sorting, subfolder toggle, symlink cycles,
// bare + ZIP discovery across all formats, archive FBD pairing, compound stems, and corrupt ZIPs.

#include "batch/scanner.hpp"
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

void write_bytes(const fs::path& p, std::string_view data) {
    fs::create_directories(p.parent_path());
    atomic_file::write_atomic(p, data);
}

void write_zip(const fs::path& p, const std::vector<std::pair<std::string, std::string>>& entries) {
    std::vector<archive::ZipEntry> z;
    z.reserve(entries.size());
    for (const auto& [name, body] : entries) {
        z.push_back(archive::ZipEntry{name, body, false, false});
    }
    write_bytes(p, archive::zip_entries(z));
}

}  // namespace

TEST_CASE("batch scanner discovers FB2 bare files and single/multi-book ZIPs deterministically",
          "[batch][scanner]") {
    test::TempDir root("mfbe-batch-scan-fb2");
    write_bytes(root.path() / "b_root.fb2", "<FictionBook/>");
    write_bytes(root.path() / "a_ignore.fbd", "<FictionBook/>");
    write_bytes(root.path() / "notes.txt", "ignored in fb2 export");
    write_zip(root.path() / "single.fb2.zip", {{"internal_name.fb2", "<FictionBook/>"}});
    write_zip(root.path() / "sub" / "pack.zip",
              {{"dir1/ch1.fb2", "<FictionBook/>"},
               {"dir2/ch2.FB2", "<FictionBook/>"},
               {"meta.fbd", "<FictionBook/>"},
               {"nested.zip", "ignored"}});
    write_zip(root.path() / "sub" / "bookless.zip", {{"readme.txt", "no fb2 here"}});
    write_bytes(root.path() / "sub" / "broken.zip", "PK\x03\x04truncated garbage");
    write_bytes(root.path() / platform::path_from_utf8("Книги/Тест.fb2"), "<FictionBook/>");

    batch::ScanRequest req;
    req.direction = batch::Direction::fb2_to_export;
    req.source_dir = root.path();
    req.include_subfolders = true;

    const batch::ScanResult res = batch::scan_directory(req);
    REQUIRE(res.items.size() == 5);
    REQUIRE(res.scan_errors.size() == 1);
    CHECK(res.scan_errors[0].display_path == "sub/broken.zip");
    CHECK(res.scan_errors[0].reason_code == "archive.damaged");

    // Verify deterministic sorted order and single- vs multi-book ZIP metadata.
    CHECK(res.items[0].display_path == "b_root.fb2");
    CHECK(!res.items[0].archive_entry.has_value());
    CHECK(res.items[0].format == "fb2");

    CHECK(res.items[1].display_path == "single.fb2.zip");
    REQUIRE(res.items[1].archive_entry.has_value());
    CHECK(*res.items[1].archive_entry == "internal_name.fb2");
    CHECK_FALSE(res.items[1].archive_multi_book);
    REQUIRE(res.items[1].archive_stem.has_value());
    CHECK(*res.items[1].archive_stem == "single");

    CHECK(res.items[2].display_path == "sub/pack.zip :: dir1/ch1.fb2");
    CHECK(res.items[2].archive_multi_book);
    REQUIRE(res.items[2].archive_stem.has_value());
    CHECK(*res.items[2].archive_stem == "pack");
    CHECK(res.items[2].relative_dir == "sub");

    CHECK(res.items[3].display_path == "sub/pack.zip :: dir2/ch2.FB2");
    CHECK(res.items[3].archive_multi_book);

    CHECK(res.items[4].display_path == "Книги/Тест.fb2");
    CHECK(res.items[4].relative_dir == "Книги");

    // Shallow scan skips nested subfolders.
    req.include_subfolders = false;
    const batch::ScanResult shallow = batch::scan_directory(req);
    REQUIRE(shallow.items.size() == 2);
    CHECK(shallow.scan_errors.empty());
}

TEST_CASE("batch scanner filters import formats across bare and ZIP files and pairs archive FBDs",
          "[batch][scanner]") {
    test::TempDir root("mfbe-batch-scan-import");
    write_bytes(root.path() / "a.epub", "epub");
    write_bytes(root.path() / "b.mobi", "mobi");
    write_bytes(root.path() / "c.azw3", "azw3");
    write_bytes(root.path() / "d.pdf", "%PDF-1.4");
    write_bytes(root.path() / "e.md", "# Title");
    write_bytes(root.path() / "f.txt", "hello");
    write_bytes(root.path() / "ignore.png", "png");
    write_zip(root.path() / "one_mobi.zip",
              {{"book.mobi", "mobi"}, {"different_name.fbd", "<FictionBook/>"}});
    write_zip(root.path() / "multi.zip", {{"x.pdf", "%PDF"},
                                          {"x.fbd", "<FictionBook/>"},
                                          {"y.mobi", "mobi"},
                                          {"unmatched.fbd", "<FictionBook/>"}});
    write_zip(root.path() / "md_pack.md.zip",
              {{"doc.md", "# Hi"}, {"images/pic.png", "png"}});
    write_zip(root.path() / "epub_wrapped.zip", {{"novel.epub", "epub"}});

    // Filter: only MOBI and PDF.
    batch::ScanRequest subset;
    subset.direction = batch::Direction::import_to_fb2;
    subset.source_dir = root.path();
    subset.include_subfolders = true;
    subset.formats = {"mobi", "pdf"};

    const batch::ScanResult sub_res = batch::scan_directory(subset);
    REQUIRE(sub_res.scan_errors.empty());
    // b.mobi, c.azw3, d.pdf, multi.zip::x.pdf, multi.zip::y.mobi, one_mobi.zip::book.mobi = 6
    REQUIRE(sub_res.items.size() == 6);

    bool saw_one_mobi_fbd = false;
    bool saw_multi_pdf_fbd = false;
    bool saw_multi_mobi_no_fbd = false;
    for (const auto& item : sub_res.items) {
        CHECK((item.format == "mobi" || item.format == "pdf"));
        if (item.archive_stem && *item.archive_stem == "one_mobi") {
            CHECK_FALSE(item.archive_multi_book);
            REQUIRE(item.archive_fbd_entry.has_value());
            CHECK(*item.archive_fbd_entry == "different_name.fbd");
            saw_one_mobi_fbd = true;
        } else if (item.archive_entry && *item.archive_entry == "x.pdf") {
            CHECK(item.archive_multi_book);
            REQUIRE(item.archive_fbd_entry.has_value());
            CHECK(*item.archive_fbd_entry == "x.fbd");
            saw_multi_pdf_fbd = true;
        } else if (item.archive_entry && *item.archive_entry == "y.mobi") {
            CHECK(item.archive_multi_book);
            CHECK_FALSE(item.archive_fbd_entry.has_value());
            saw_multi_mobi_no_fbd = true;
        }
    }
    CHECK(saw_one_mobi_fbd);
    CHECK(saw_multi_pdf_fbd);
    CHECK(saw_multi_mobi_no_fbd);

    // All 5 formats: also picks up a.epub, e.md, f.txt, md_pack.md.zip, epub_wrapped.zip (+5 = 11).
    batch::ScanRequest all = subset;
    all.formats = {"epub", "mobi", "pdf", "markdown", "txt"};
    const batch::ScanResult all_res = batch::scan_directory(all);
    REQUIRE(all_res.items.size() == 11);
    bool saw_md_zip = false;
    bool saw_epub_zip = false;
    for (const auto& item : all_res.items) {
        if (item.format == "markdown" && item.archive_stem && *item.archive_stem == "md_pack") {
            saw_md_zip = true;
        }
        if (item.format == "epub" && item.archive_stem && *item.archive_stem == "epub_wrapped") {
            saw_epub_zip = true;
        }
    }
    CHECK(saw_md_zip);
    CHECK(saw_epub_zip);
}

#ifndef _WIN32
TEST_CASE("batch scanner skips circular directory symlinks without looping", "[batch][scanner]") {
    test::TempDir root("mfbe-batch-scan-symlink");
    write_bytes(root.path() / "sub" / "book.fb2", "<FictionBook/>");
    fs::create_directory_symlink(root.path(), root.path() / "sub" / "loop");

    batch::ScanRequest req;
    req.direction = batch::Direction::fb2_to_export;
    req.source_dir = root.path();
    req.include_subfolders = true;

    const batch::ScanResult res = batch::scan_directory(req);
    REQUIRE(res.items.size() == 1);
    CHECK(res.items[0].display_path == "sub/book.fb2");
}
#endif
