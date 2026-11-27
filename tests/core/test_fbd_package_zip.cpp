// Feature 022 (T026): top-level ZIP inspection, FBD normalization, raw-slice pass-through
// preservation (in-place Save vs. clean Save As), and atomic-save fault-injection tests.
#include "test_support.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fbd_package.hpp>
#include <mfbe/images.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace mfbe;
using namespace mfbe::package;
namespace fs = std::filesystem;

namespace {

fs::path create_memory_zip(const fs::path& target,
                           const std::vector<std::pair<std::string, std::string>>& items) {
    PackageZipWritePlan plan;
    plan.targetZipPath = target;
    for (const auto& [name, content] : items) {
        PackageZipWriteEntry e;
        e.entryName = name;
        e.isMemory = true;
        e.memoryBytes = content;
        e.compressDeflate = true;
        plan.managedEntries.push_back(std::move(e));
    }
    write_package_zip_atomic(plan);
    return target;
}

std::string make_fbd_xml(const std::string& title, bool with_body = true,
                         const std::string& extra_xml = "") {
    std::string xml =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
        "  <description>\n"
        "    <title-info>\n"
        "      <genre>sf</genre>\n"
        "      <author><first-name>A</first-name><last-name>B</last-name></author>\n"
        "      <book-title>" +
        title +
        "</book-title>\n"
        "      <lang>en</lang>\n"
        "    </title-info>\n"
        "    <document-info>\n"
        "      <author><first-name>Editor</first-name><last-name>User</last-name></author>\n"
        "      <date value=\"2026-11-27\">2026-11-27</date>\n"
        "      <id>UUID-1</id>\n"
        "      <version>1.0</version>\n"
        "    </document-info>\n"
        "  </description>\n";
    if (with_body) {
        xml += "  <body><section/></body>\n";
    }
    xml += extra_xml;
    xml += "</FictionBook>\n";
    return xml;
}

}  // namespace

TEST_CASE("fbd package inspector: classifies FB2, FBD package, standalone FBD, and non-book ZIPs",
          "[package][zip]") {
    test::TempDir dir("mfbe-pkg-inspect");

    // 1. Multi-book FBD package with unpaired book + subfolder + nested archive + orphan .fbd.
    const fs::path multi = create_memory_zip(
        dir.path() / "multi.zip",
        {
            {"Alpha.PDF", "%PDF-1.7 alpha"},
            {"alpha.fbd", make_fbd_xml("Alpha")},
            {"Beta.txt", "beta text"},
            {"docs/readme.txt", "keep me on in-place save"},
            {"nested.zip", "PK\x03\x04dummy"},
            {"orphan.fbd", make_fbd_xml("Orphan")},
        });
    const FbdPackageInspection multi_res = inspect_zip_listing(archive::list(multi));
    CHECK(multi_res.classification == ZipClassification::fbd_package);
    CHECK_FALSE(multi_res.duplicateRootStem);
    REQUIRE(multi_res.pairs.size() == 2);
    CHECK(multi_res.pairs[0].fileName == "Alpha.pdf");
    CHECK(multi_res.pairs[0].fbdEntryName == std::optional<std::string>("alpha.fbd"));
    CHECK(multi_res.pairs[1].fileName == "Beta.txt");
    CHECK_FALSE(multi_res.pairs[1].fbdEntryName.has_value());
    REQUIRE(multi_res.preservedEntries.size() == 3);

    // 2. Single-book + single-FBD fallback when stems differ (FBDMaker compatibility).
    const fs::path fallback = create_memory_zip(
        dir.path() / "fallback.zip",
        {
            {"novel.pdf", "%PDF-1.7 novel"},
            {"description.fbd", make_fbd_xml("Fallback Novel", false)},
        });
    const FbdPackageInspection fb_res = inspect_zip_listing(archive::list(fallback));
    CHECK(fb_res.classification == ZipClassification::fbd_package);
    REQUIRE(fb_res.pairs.size() == 1);
    CHECK(fb_res.pairs[0].fbdEntryName == std::optional<std::string>("description.fbd"));
    CHECK(fb_res.preservedEntries.empty());

    // 3. ZIP containing .fb2 always stays FB2 archive even if non-FB2 + .fbd exist.
    const fs::path has_fb2 = create_memory_zip(
        dir.path() / "mixed.zip",
        {
            {"story.fb2", make_fbd_xml("FB2")},
            {"scan.pdf", "%PDF-1.7"},
            {"scan.fbd", make_fbd_xml("Scan")},
        });
    CHECK(inspect_zip_listing(archive::list(has_fb2)).classification ==
          ZipClassification::fb2_archive);

    // 4. Standalone .fbd ZIP with zero payloads stays standalone_fbd (FB2 mode).
    const fs::path alone_fbd =
        create_memory_zip(dir.path() / "alone.zip", {{"meta.fbd", make_fbd_xml("Meta")}});
    CHECK(inspect_zip_listing(archive::list(alone_fbd)).classification ==
          ZipClassification::standalone_fbd);

    // 5. Plain non-book ZIP with zero .fb2 and zero .fbd -> no_book.
    const fs::path no_fbd =
        create_memory_zip(dir.path() / "plain.zip", {{"scan.pdf", "%PDF-1.7"}});
    CHECK(inspect_zip_listing(archive::list(no_fbd)).classification == ZipClassification::no_book);

    // 6. Duplicate root payload stems detected cleanly.
    const fs::path dup_stems = create_memory_zip(
        dir.path() / "dup.zip",
        {
            {"Same.pdf", "%PDF-1.7"},
            {"same.txt", "text"},
            {"Same.fbd", make_fbd_xml("Same")},
        });
    const FbdPackageInspection dup_res = inspect_zip_listing(archive::list(dup_stems));
    CHECK(dup_res.classification == ZipClassification::fbd_package);
    CHECK(dup_res.duplicateRootStem);
}

TEST_CASE("fbd package normalization: body-less FBD, stylesheet strip, and single-cover clamp",
          "[package][zip]") {
    images::Bitmap bmp;
    bmp.width = 2;
    bmp.height = 2;
    bmp.rgba.assign(16, 128);
    const std::string png = images::encode_png(bmp);
    const std::string jpg = images::encode_jpeg(bmp, 90);

    BinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadOptions opts;
    opts.file_kind = model::FileKind::fbd;
    const std::string bodyless_xml =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
        "  <stylesheet type=\"text/css\">p { color: red; }</stylesheet>\n"
        "  <description>\n"
        "    <title-info>\n"
        "      <genre>sf</genre>\n"
        "      <author><first-name>A</first-name><last-name>B</last-name></author>\n"
        "      <book-title>Bodyless Book</book-title>\n"
        "      <coverpage><image l:href=\"#pic1.png\"/><image l:href=\"#pic2.jpg\"/></coverpage>\n"
        "      <lang>en</lang>\n"
        "    </title-info>\n"
        "    <src-title-info>\n"
        "      <genre>sf</genre>\n"
        "      <author><first-name>A</first-name><last-name>B</last-name></author>\n"
        "      <book-title>Src</book-title>\n"
        "      <coverpage><image l:href=\"#pic2.jpg\"/></coverpage>\n"
        "      <lang>en</lang>\n"
        "    </src-title-info>\n"
        "    <document-info>\n"
        "      <author><first-name>A</first-name><last-name>B</last-name></author>\n"
        "      <date value=\"2026-11-27\">2026-11-27</date>\n"
        "      <id>ID-1</id>\n"
        "      <version>1.0</version>\n"
        "    </document-info>\n"
        "  </description>\n"
        "</FictionBook>\n";

    fb2::ReadResult read = fb2::read_bytes(bodyless_xml, store, ids, opts);
    store.put("pic1.png", "image/png", png);
    store.put("pic2.jpg", "image/jpeg", jpg);

    const std::uint32_t dropped = normalize_package_fbd(read.document, store, ids);
    CHECK(dropped == 1);
    REQUIRE(read.document.bodies.size() == 1);
    CHECK(read.document.stylesheets.empty());
    REQUIRE(read.document.description.srcTitleInfo.has_value());
    CHECK(read.document.description.srcTitleInfo->coverpage.empty());
    REQUIRE(read.document.description.titleInfo.coverpage.size() == 1);
    CHECK(read.document.description.titleInfo.coverpage[0].href == "#cover.png");
    CHECK(store.ids() == std::vector<std::string>{"cover.png"});
    CHECK(store.bytes("cover.png") == std::optional<std::string>(png));
}

TEST_CASE("fbd package writer: raw pass-through preserves ignored entries on Save, omits on Save As, and survives fault injection",
          "[package][zip]") {
    test::TempDir dir("mfbe-pkg-writer");
    const std::string pdf_bytes = "%PDF-1.7\nOriginal immutable payload bytes 9876543210\n";
    const std::string sub_bytes = "Preserved subfolder file content!\n";
    const fs::path pkg_path = create_memory_zip(
        dir.path() / "archive.zip",
        {
            {"docs/info.txt", sub_bytes},
            {"Book.pdf", pdf_bytes},
            {"Book.fbd", make_fbd_xml("Version 1")},
        });
    const std::string original_zip_bytes = atomic_file::read_file(pkg_path);
    const FbdPackageInspection inspected = inspect_zip_listing(archive::list(pkg_path));
    REQUIRE(inspected.preservedEntries.size() == 1);

    // 1. Fault-injection before rename must preserve original archive byte-for-byte with zero temp leftovers.
    {
        PackageZipWritePlan plan;
        plan.targetZipPath = pkg_path;
        plan.sourceZipPath = pkg_path;
        plan.preserveNonManaged = true;
        plan.preservedEntries = inspected.preservedEntries;
        PackageZipWriteEntry p;
        p.entryName = "Book.pdf";
        p.sourceKind = PayloadSourceKind::zip_entry;
        p.sourceZipRawName = "Book.pdf";
        plan.managedEntries.push_back(p);
        PackageZipWriteEntry f;
        f.entryName = "Book.fbd";
        f.isMemory = true;
        f.memoryBytes = make_fbd_xml("Should Not Land");
        f.compressDeflate = true;
        plan.managedEntries.push_back(f);

        atomic_file::set_fault_injection(atomic_file::FaultPoint::before_rename);
        CHECK_THROWS_AS(write_package_zip_atomic(plan), ZipWriteError);
        atomic_file::set_fault_injection(atomic_file::FaultPoint::none);

        CHECK(atomic_file::read_file(pkg_path) == original_zip_bytes);
        int file_count = 0;
        for (const auto& _ : fs::directory_iterator(dir.path())) {
            (void)_;
            ++file_count;
        }
        CHECK(file_count == 1);
    }

    // 2. In-place Save preserves docs/info.txt and Book.pdf byte-for-byte while updating Book.fbd.
    {
        PackageZipWritePlan plan;
        plan.targetZipPath = pkg_path;
        plan.sourceZipPath = pkg_path;
        plan.preserveNonManaged = true;
        plan.preservedEntries = inspected.preservedEntries;
        PackageZipWriteEntry p;
        p.entryName = "Book.pdf";
        p.sourceKind = PayloadSourceKind::zip_entry;
        p.sourceZipRawName = "Book.pdf";
        plan.managedEntries.push_back(p);
        PackageZipWriteEntry f;
        f.entryName = "Book.fbd";
        f.isMemory = true;
        f.memoryBytes = make_fbd_xml("Version 2");
        f.compressDeflate = true;
        plan.managedEntries.push_back(f);

        write_package_zip_atomic(plan);
        const archive::Listing after = archive::list(pkg_path);
        REQUIRE(after.entries.size() == 3);
        CHECK(archive::read_entry(pkg_path, "docs/info.txt") == sub_bytes);
        CHECK(archive::read_entry(pkg_path, "Book.pdf") == pdf_bytes);
        CHECK(archive::read_entry(pkg_path, "Book.fbd").find("Version 2") != std::string::npos);
    }

    // 3. Clean Save As to a new path omits preserved entries and retains Book.pdf byte-for-byte.
    {
        const fs::path clean_path = dir.path() / "clean-copy.zip";
        PackageZipWritePlan plan;
        plan.targetZipPath = clean_path;
        plan.sourceZipPath = pkg_path;
        plan.preserveNonManaged = false;
        PackageZipWriteEntry p;
        p.entryName = "Book.pdf";
        p.sourceKind = PayloadSourceKind::zip_entry;
        p.sourceZipRawName = "Book.pdf";
        plan.managedEntries.push_back(p);
        PackageZipWriteEntry f;
        f.entryName = "Book.fbd";
        f.isMemory = true;
        f.memoryBytes = make_fbd_xml("Version 3 Clean");
        f.compressDeflate = true;
        plan.managedEntries.push_back(f);

        write_package_zip_atomic(plan);
        const archive::Listing clean = archive::list(clean_path);
        REQUIRE(clean.entries.size() == 2);
        CHECK(archive::read_entry(clean_path, "Book.pdf") == pdf_bytes);
        CHECK(archive::read_entry(clean_path, "Book.fbd").find("Version 3 Clean") !=
              std::string::npos);
    }
}
