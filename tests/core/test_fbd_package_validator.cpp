// Feature 022 (T014): candidate payload file validation tests (FR-011).
#include "test_support.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/fbd_package.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>
#include <map>
#include <string>

using namespace mfbe;
using namespace mfbe::package;
namespace fs = std::filesystem;

namespace {

fs::path write_bytes(const fs::path& p, const std::string& data) {
    fs::create_directories(p.parent_path());
    std::ofstream out(p, std::ios::binary | std::ios::trunc);
    REQUIRE(out.good());
    out.write(data.data(), static_cast<std::streamsize>(data.size()));
    out.close();
    return p;
}

fs::path write_zip(const fs::path& p, const std::vector<std::pair<std::string, std::string>>& items) {
    PackageZipWritePlan plan;
    plan.targetZipPath = p;
    for (const auto& [name, content] : items) {
        PackageZipWriteEntry e;
        e.entryName = name;
        e.isMemory = true;
        e.memoryBytes = content;
        e.compressDeflate = false;
        plan.managedEntries.push_back(std::move(e));
    }
    write_package_zip_atomic(plan);
    return p;
}

}  // namespace

TEST_CASE("fbd package validator: accepts standard non-FB2 book formats and lower-cases extension",
          "[package][validator]") {
    test::TempDir dir("mfbe-pkg-val-ok");
    const std::map<std::string, std::string> none;

    const fs::path pdf = write_bytes(dir.path() / "Sample Book.PDF", "%PDF-1.7\nhello\n");
    const CandidateFileCheck pdf_check = validate_candidate_payload(pdf, none);
    REQUIRE(pdf_check.accepted);
    CHECK(pdf_check.fileName == "Sample Book.pdf");
    CHECK(pdf_check.stem == "Sample Book");
    CHECK(pdf_check.extension == "pdf");
    CHECK(pdf_check.size == 15);

    const fs::path djvu = write_bytes(dir.path() / "Scan.DJVU", "AT&TFORM0000DJVU");
    const CandidateFileCheck djvu_check = validate_candidate_payload(djvu, none);
    REQUIRE(djvu_check.accepted);
    CHECK(djvu_check.fileName == "Scan.djvu");
    CHECK(djvu_check.extension == "djvu");

    const fs::path txt = write_bytes(dir.path() / "Notes.TXT", "Plain text book content.");
    CHECK(validate_candidate_payload(txt, none).accepted);

    // Verified ZIP-based book containers: EPUB, DOCX, ODT.
    const fs::path epub =
        write_zip(dir.path() / "Novel.EPUB",
                  {{"mimetype", "application/epub+zip"}, {"META-INF/container.xml", "<c/>"}});
    const CandidateFileCheck epub_check = validate_candidate_payload(epub, none);
    REQUIRE(epub_check.accepted);
    CHECK(epub_check.fileName == "Novel.epub");

    const fs::path docx =
        write_zip(dir.path() / "Report.DOCX",
                  {{"[Content_Types].xml", "<Types/>"}, {"word/document.xml", "<w:document/>"}});
    const CandidateFileCheck docx_check = validate_candidate_payload(docx, none);
    REQUIRE(docx_check.accepted);
    CHECK(docx_check.fileName == "Report.docx");

    const fs::path odt =
        write_zip(dir.path() / "Essay.ODT",
                  {{"mimetype", "application/vnd.oasis.opendocument.text"},
                   {"content.xml", "<office:document-content/>"}});
    const CandidateFileCheck odt_check = validate_candidate_payload(odt, none);
    REQUIRE(odt_check.accepted);
    CHECK(odt_check.fileName == "Essay.odt");
}

TEST_CASE("fbd package validator: rejects forbidden formats, renamed archives, renamed FB2, and duplicates",
          "[package][validator]") {
    test::TempDir dir("mfbe-pkg-val-rej");
    const std::map<std::string, std::string> none;

    // Missing and directory.
    CHECK(validate_candidate_payload(dir.path() / "missing.pdf", none).reason ==
          FileRejectReason::not_found);
    fs::create_directories(dir.path() / "subdir");
    CHECK(validate_candidate_payload(dir.path() / "subdir", none).reason ==
          FileRejectReason::not_file);

    // Direct .fb2 and .fbd extensions.
    const fs::path fb2 = write_bytes(dir.path() / "book.fb2", "<FictionBook/>");
    CHECK(validate_candidate_payload(fb2, none).reason == FileRejectReason::forbidden_fb2);

    const fs::path fbd = write_bytes(dir.path() / "book.FBD", "<FictionBook/>");
    CHECK(validate_candidate_payload(fbd, none).reason == FileRejectReason::forbidden_fbd);

    // Forbidden archive extensions.
    for (const char* name : {"pack.zip", "pack.rar", "pack.7z", "pack.tar", "pack.gz", "pack.bz2",
                             "pack.xz", "pack.zst", "pack.tgz", "pack.tbz2", "pack.txz"}) {
        const fs::path p = write_bytes(dir.path() / name, "dummy");
        CHECK(validate_candidate_payload(p, none).reason == FileRejectReason::forbidden_archive);
    }

    // Renamed non-ZIP archives (RAR / 7z / GZIP magic under .pdf name).
    const fs::path fake_rar =
        write_bytes(dir.path() / "disguised_rar.pdf", std::string("Rar!\x1A\x07\x00xxxx", 11));
    CHECK(validate_candidate_payload(fake_rar, none).reason == FileRejectReason::forbidden_archive);

    const fs::path fake_7z =
        write_bytes(dir.path() / "disguised_7z.pdf", std::string("7z\xBC\xAF\x27\x1Cxxxx", 10));
    CHECK(validate_candidate_payload(fake_7z, none).reason == FileRejectReason::forbidden_archive);

    // Generic ZIP renamed to .pdf or fake .epub (without valid EPUB structure).
    const fs::path renamed_zip =
        write_zip(dir.path() / "actually_zip.pdf", {{"hello.txt", "hello"}});
    CHECK(validate_candidate_payload(renamed_zip, none).reason ==
          FileRejectReason::forbidden_archive);

    const fs::path fake_epub =
        write_zip(dir.path() / "fake.epub", {{"not_epub.txt", "plain zip pretending to be epub"}});
    CHECK(validate_candidate_payload(fake_epub, none).reason ==
          FileRejectReason::forbidden_archive);

    // Renamed FB2 XML file disguised with .txt or .xml extension.
    const fs::path renamed_fb2 = write_bytes(
        dir.path() / "disguised.txt",
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\"><description/></FictionBook>");
    CHECK(validate_candidate_payload(renamed_fb2, none).reason == FileRejectReason::forbidden_fb2);

    // Case-insensitive stem collision (ASCII + Cyrillic).
    const fs::path existing_pdf = write_bytes(dir.path() / "MyBook.pdf", "%PDF-1.7\n");
    const CandidateFileCheck first = validate_candidate_payload(existing_pdf, none);
    REQUIRE(first.accepted);
    std::map<std::string, std::string> existing{{first.stemKey, first.fileName}};

    const fs::path dup_epub =
        write_zip(dir.path() / "mybook.epub", {{"mimetype", "application/epub+zip"}});
    const CandidateFileCheck dup_check = validate_candidate_payload(dup_epub, existing);
    CHECK_FALSE(dup_check.accepted);
    CHECK(dup_check.reason == FileRejectReason::duplicate_stem);
    CHECK(dup_check.conflictWith == "MyBook.pdf");
}
