// Feature 023 (T015, T022, T033, T037; SC-004): core DOCX container sniffing, macro stripping,
// writer pre-write XML self-check, atomic .docx & ZIP(store+deflate) output, doc.open refusals vs
// FBD ZIP Package mode, docx.* settings validation, and batch.scan/settings integration.
#include "batch/scanner.hpp"
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/docx.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/settings.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

using namespace mfbe;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {

void put_u16_le(std::string& buf, std::size_t off, std::uint16_t v) {
    buf[off] = static_cast<char>(v & 0xFFu);
    buf[off + 1] = static_cast<char>((v >> 8) & 0xFFu);
}

void put_u32_le(std::string& buf, std::size_t off, std::uint32_t v) {
    buf[off] = static_cast<char>(v & 0xFFu);
    buf[off + 1] = static_cast<char>((v >> 8) & 0xFFu);
    buf[off + 2] = static_cast<char>((v >> 16) & 0xFFu);
    buf[off + 3] = static_cast<char>((v >> 24) & 0xFFu);
}

// Builds a minimal valid 1536-byte OLE2 Compound File Binary (header + FAT + 1 directory sector)
// containing the specified UTF-16LE directory stream names.
std::string build_synthetic_ole2(const std::vector<std::string>& stream_names) {
    std::string out(1536, '\0');
    static constexpr std::uint8_t kMagic[8] = {0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1};
    for (std::size_t i = 0; i < 8; ++i) {
        out[i] = static_cast<char>(kMagic[i]);
    }
    put_u16_le(out, 24, 0x003Eu);      // minor version
    put_u16_le(out, 26, 0x0003u);      // v3 (512-byte sectors)
    put_u16_le(out, 28, 0xFFFEu);      // little-endian
    put_u16_le(out, 30, 9u);           // 2^9 = 512 bytes
    put_u32_le(out, 44, 1u);           // 1 FAT sector
    put_u32_le(out, 48, 1u);           // first directory sector = sector 1
    put_u32_le(out, 60, 0xFFFFFFFEu);  // no mini FAT
    put_u32_le(out, 68, 0xFFFFFFFEu);  // no DIFAT chain
    put_u32_le(out, 76, 0u);           // FAT is sector 0
    for (std::size_t i = 1; i < 109; ++i) {
        put_u32_le(out, 76 + i * 4, 0xFFFFFFFFu);
    }
    // Sector 0 (offset 512): FAT marking sector 0 = FATSECT, sector 1 = ENDOFCHAIN.
    put_u32_le(out, 512 + 0, 0xFFFFFFFDu);
    put_u32_le(out, 512 + 4, 0xFFFFFFFEu);
    // Sector 1 (offset 1024): Directory entries (128 bytes each, up to 4 entries).
    for (std::size_t idx = 0; idx < stream_names.size() && idx < 4; ++idx) {
        const std::size_t base = 1024 + idx * 128;
        const std::string& name = stream_names[idx];
        for (std::size_t k = 0; k < name.size() && k < 31; ++k) {
            put_u16_le(out, base + k * 2, static_cast<std::uint8_t>(name[k]));
        }
        put_u16_le(out, base + 64, static_cast<std::uint16_t>((name.size() + 1) * 2));
        out[base + 66] = static_cast<char>(idx == 0 ? 5 : 2);  // Root Entry / Stream
    }
    return out;
}

std::string minimal_docx_bytes(bool macro_enabled = false, bool add_stray_macro = false) {
    const std::string main_ct =
        macro_enabled
            ? "application/vnd.ms-word.document.macroEnabled.main+xml"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
    const std::string content_types =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        "<Default Extension=\"rels\" "
        "ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        "<Override PartName=\"/word/document.xml\" ContentType=\"" +
        main_ct +
        "\"/>"
        "<Override PartName=\"/word/styles.xml\" "
        "ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/"
        ">"
        "<Override PartName=\"/docProps/core.xml\" "
        "ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>"
        "</Types>";
    const std::string root_rels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"rId1\" "
        "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
        "officeDocument\" Target=\"word/document.xml\"/>"
        "<Relationship Id=\"rId2\" "
        "Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/"
        "core-properties\" Target=\"docProps/core.xml\"/>"
        "</Relationships>";
    const std::string doc_rels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"rId1\" "
        "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" "
        "Target=\"styles.xml\"/>"
        "</Relationships>";
    const std::string document_xml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
        "<w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>";
    const std::string styles_xml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>";
    const std::string core_xml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<cp:coreProperties "
        "xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" "
        "xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>Sample "
        "DOCX</dc:title></cp:coreProperties>";
    const std::string vba_stub = "FAKE_VBA_PAYLOAD";

    std::vector<archive::ZipEntry> entries = {
        {"[Content_Types].xml", content_types, false, false},
        {"_rels/.rels", root_rels, false, false},
        {"word/document.xml", document_xml, false, false},
        {"word/_rels/document.xml.rels", doc_rels, false, false},
        {"word/styles.xml", styles_xml, false, false},
        {"docProps/core.xml", core_xml, false, false},
    };
    if (add_stray_macro) {
        entries.push_back({"word/vbaProject.bin", vba_stub, false, false});
    }
    return archive::zip_entries(entries);
}

std::string minimal_fbd_bytes() {
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
           "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\">\n"
           "<description><title-info><genre>prose_classic</genre>"
           "<author><first-name>Jane</first-name><last-name>Doe</last-name></author>"
           "<book-title>Sample Package Book</book-title><lang>en</lang></title-info>"
           "<document-info><author><nickname>tester</nickname></author>"
           "<date value=\"2026-11-28\">2026</date><id>sample-fbd-1</id><version>1.0</version>"
           "</document-info></description></FictionBook>\n";
}

// Valid 1x1 PNG bytes for binary media testing.
std::string tiny_png_bytes() {
    static constexpr std::uint8_t kPng[] = {
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
        0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
        0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
        0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
        0xB0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82};
    return std::string(reinterpret_cast<const char*>(kPng), sizeof(kPng));
}

struct ServerFixture {
    test::TempDir data{"mfbe-docx-server"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    ServerFixture() {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
};

}  // namespace

TEST_CASE("DOCX sniffer distinguishes docx, docm, legacy .doc, encrypted .docx, and FB2",
          "[docx][sniff]") {
    test::TempDir tmp{"mfbe-docx-sniff"};
    const auto t0 = std::chrono::steady_clock::now();

    const fs::path valid_docx = tmp.path() / "book.docx";
    atomic_file::write_atomic(valid_docx, minimal_docx_bytes());
    CHECK(docx::sniff_docx_file(valid_docx).kind == docx::DocxSniffKind::docx);
    CHECK(docx::is_bare_docx_file(valid_docx));

    const fs::path macro_docm = tmp.path() / "book.docm";
    atomic_file::write_atomic(macro_docm, minimal_docx_bytes(/*macro_enabled=*/true));
    CHECK(docx::sniff_docx_file(macro_docm).kind == docx::DocxSniffKind::macro_enabled_docm);
    CHECK_FALSE(docx::is_bare_docx_file(macro_docm));

    const fs::path legacy_doc = tmp.path() / "legacy.doc";
    atomic_file::write_atomic(legacy_doc, build_synthetic_ole2({"Root Entry", "WordDocument"}));
    CHECK(docx::sniff_docx_file(legacy_doc).kind == docx::DocxSniffKind::legacy_doc);

    const fs::path encrypted_docx = tmp.path() / "secret.docx";
    atomic_file::write_atomic(
        encrypted_docx, build_synthetic_ole2({"Root Entry", "EncryptionInfo", "EncryptedPackage"}));
    CHECK(docx::sniff_docx_file(encrypted_docx).kind == docx::DocxSniffKind::encrypted_office);

    const fs::path fb2 = tmp.path() / "novel.fb2";
    atomic_file::write_atomic(fb2, minimal_fbd_bytes());
    CHECK(docx::sniff_docx_file(fb2).kind == docx::DocxSniffKind::fiction_book);

    const fs::path outer_zip = tmp.path() / "bundle.zip";
    const std::string inner_docx = minimal_docx_bytes();
    const std::string fbd = minimal_fbd_bytes();
    atomic_file::write_atomic(
        outer_zip, archive::zip_entries(
                       {{"book.docx", inner_docx, true, false}, {"book.fbd", fbd, false, false}}));
    CHECK(docx::sniff_docx_file(outer_zip).kind == docx::DocxSniffKind::outer_zip_with_docx);
    CHECK_FALSE(docx::is_bare_docx_file(outer_zip));

    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t0);
    // SC-004: hostile/encrypted/.doc/.docm classification completes well under 2 seconds.
    CHECK(elapsed.count() < 2000);
}

TEST_CASE("DocxArchiveReader strips stray macros, enforces zip-bomb limits, and finds sibling FBD",
          "[docx][reader]") {
    test::TempDir tmp{"mfbe-docx-reader"};

    const fs::path with_macro = tmp.path() / "Book.docx";
    atomic_file::write_atomic(with_macro, minimal_docx_bytes(false, /*add_stray_macro=*/true));
    const fs::path sibling_fbd = tmp.path() / "book.fbd";
    atomic_file::write_atomic(sibling_fbd, minimal_fbd_bytes());

    const auto opened = docx::open_docx_archive(with_macro);
    REQUIRE(opened.stray_macro_entries.size() == 1);
    CHECK(opened.stray_macro_entries[0] == "word/vbaProject.bin");
    CHECK_THROWS_AS(docx::read_docx_entry(opened, "word/vbaProject.bin"), std::out_of_range);
    CHECK(docx::read_docx_entry(opened, "word/document.xml").find("Hello DOCX") !=
          std::string::npos);

    const auto found_fbd = docx::find_sibling_fbd(with_macro);
    REQUIRE(found_fbd.has_value());
    // Compare by filesystem equivalence: macOS APFS and Windows NTFS resolve `Book.fbd` to
    // `book.fbd` directly without falling back to a case-folding directory scan.
    CHECK(fs::equivalent(*found_fbd, sibling_fbd));

    // Zip bomb (> 100x compression ratio above 1 MiB floor): 2 MiB of zeroes compresses to ~2 KB.
    const std::string zeros(2 * 1024 * 1024, 'A');
    const std::string ct =
        "<?xml version=\"1.0\"?><Types "
        "xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>";
    const std::string doc =
        "<?xml version=\"1.0\"?><w:document "
        "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>";
    const fs::path bomb = tmp.path() / "bomb.docx";
    atomic_file::write_atomic(bomb, archive::zip_entries({{"[Content_Types].xml", ct, false, false},
                                                          {"word/document.xml", doc, false, false},
                                                          {"word/huge.xml", zeros, false, false}}));
    const auto t0 = std::chrono::steady_clock::now();
    try {
        (void)docx::open_docx_archive(bomb);
        FAIL("expected zip_bomb refusal");
    } catch (const docx::DocxRefused& e) {
        CHECK(e.reason == docx::DocxRefusal::zip_bomb);
    }
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    CHECK(ms < 2000);
}

TEST_CASE(
    "DocxPackageWriter self-checks XML & media and writes atomic .docx and ZIP(store+deflate)",
    "[docx][writer]") {
    test::TempDir tmp{"mfbe-docx-writer"};

    // Malformed XML must fail self-check and never create target file.
    {
        const fs::path bad_target = tmp.path() / "bad.docx";
        docx::DocxPackageWriter writer(bad_target, false);
        writer.add_xml_part("[Content_Types].xml", "<Types/>");
        writer.add_xml_part("_rels/.rels", "<Relationships/>");
        writer.add_xml_part("word/document.xml", "<w:document><unclosed></w:document>");
        writer.add_xml_part("word/_rels/document.xml.rels", "<Relationships/>");
        writer.add_xml_part("word/styles.xml", "<w:styles/>");
        writer.add_xml_part("docProps/core.xml", "<cp:coreProperties/>");
        CHECK_THROWS(writer.commit());
        CHECK_FALSE(fs::exists(bad_target));
    }

    // Valid `.docx` with media stored uncompressed and XML deflated.
    const std::string png = tiny_png_bytes();
    const std::string ct =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        "<Default Extension=\"rels\" "
        "ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        "<Default Extension=\"png\" ContentType=\"image/png\"/>"
        "<Override PartName=\"/word/document.xml\" "
        "ContentType=\"application/"
        "vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
        "</Types>";
    const std::string doc_rels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"rIdImg1\" "
        "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" "
        "Target=\"media/image1.png\"/>"
        "</Relationships>";

    const fs::path bare_target = tmp.path() / "out.docx";
    {
        docx::DocxPackageWriter writer(bare_target, false);
        writer.add_xml_part("[Content_Types].xml", ct);
        writer.add_xml_part("_rels/.rels", "<Relationships/>");
        writer.add_xml_part("word/document.xml", "<document/>");
        writer.add_xml_part("word/_rels/document.xml.rels", doc_rels);
        writer.add_xml_part("word/styles.xml", "<styles/>");
        writer.add_xml_part("docProps/core.xml", "<coreProperties/>");
        writer.add_media_part("word/media/image1.png", png);
        CHECK(writer.commit() > 0);
    }
    const auto bare_listing = archive::list(bare_target);
    bool saw_media_stored = false;
    bool saw_xml_deflated = false;
    for (const auto& e : bare_listing.entries) {
        if (e.name == "word/media/image1.png") {
            CHECK(e.method == 0);
            saw_media_stored = true;
        }
        if (e.name == "word/document.xml") {
            CHECK(e.method == 8);
            saw_xml_deflated = true;
        }
    }
    CHECK(saw_media_stored);
    CHECK(saw_xml_deflated);

    // Valid `.zip` with `<stem>.docx` stored (method 0) and `<stem>.fbd` deflated (method 8).
    const fs::path zip_target = tmp.path() / "novel.zip";
    {
        docx::DocxPackageWriter writer(zip_target, true);
        writer.add_xml_part("[Content_Types].xml", ct);
        writer.add_xml_part("_rels/.rels", "<Relationships/>");
        writer.add_xml_part("word/document.xml", "<document/>");
        writer.add_xml_part("word/_rels/document.xml.rels", doc_rels);
        writer.add_xml_part("word/styles.xml", "<styles/>");
        writer.add_xml_part("docProps/core.xml", "<coreProperties/>");
        writer.add_media_part("word/media/image1.png", png);
        CHECK(writer.commit(minimal_fbd_bytes()) > 0);
    }
    const auto zip_listing = archive::list(zip_target);
    REQUIRE(zip_listing.entries.size() == 2);
    CHECK(zip_listing.entries[0].name == "novel.docx");
    CHECK(zip_listing.entries[0].method == 0);
    CHECK(zip_listing.entries[1].name == "novel.fbd");
    CHECK(zip_listing.entries[1].method == 8);
}

TEST_CASE("doc.open refuses bare DOCX and DOCX-only ZIP while preserving FBD ZIP Package mode",
          "[docx][open][rpc]") {
    ServerFixture f;
    test::TempDir files{"mfbe-docx-open"};

    const fs::path bare_docx = files.path() / "book.docx";
    atomic_file::write_atomic(bare_docx, minimal_docx_bytes());
    {
        const json res = f.ws.call("doc.open", {{"path", platform::utf8_from_path(bare_docx)}});
        REQUIRE(res.contains("error"));
        CHECK(res["error"]["code"] == rpc::codes::kDocNotFictionBook);
        CHECK(res["error"]["data"]["reason"] == "docx");
    }

    const fs::path docx_only_zip = files.path() / "only-docx.zip";
    const std::string inner = minimal_docx_bytes();
    atomic_file::write_atomic(docx_only_zip,
                              archive::zip_entries({{"book.docx", inner, true, false}}));
    {
        const json res = f.ws.call("doc.open", {{"path", platform::utf8_from_path(docx_only_zip)}});
        REQUIRE(res.contains("error"));
        CHECK(res["error"]["code"] == rpc::codes::kArchiveNoBook);
        CHECK(res["error"]["data"]["reason"] == "docxInArchive");
    }

    // ZIP pairing `.docx` + `.fbd` continues opening as an FBD ZIP Package (Feature 022).
    const fs::path pkg_zip = files.path() / "pkg.zip";
    const std::string fbd = minimal_fbd_bytes();
    atomic_file::write_atomic(pkg_zip, archive::zip_entries({{"book.docx", inner, true, false},
                                                             {"book.fbd", fbd, false, false}}));
    {
        const json res = f.ws.call("doc.open", {{"path", platform::utf8_from_path(pkg_zip)}});
        REQUIRE(res.contains("result"));
        CHECK(res["result"].value("packageDetected", false) == true);
    }
}

TEST_CASE("docx.* settings validation, defaults, and Batch Converter DOCX scan/settings",
          "[docx][settings][batch]") {
    ServerFixture f;
    const json cur = f.ws.call("settings.get", json::object());
    REQUIRE(cur.contains("result"));
    const json& docx_sec = cur["result"]["docx"];
    CHECK(docx_sec["defaultPageSize"] == "a4");
    CHECK(docx_sec["margins"] == "standard");
    CHECK(docx_sec["customMargin"] == 22);
    CHECK(docx_sec["fontFamily"] == "Georgia");
    CHECK(docx_sec["customFontFamily"] == "");
    CHECK(docx_sec["textSizePt"] == 12);
    CHECK(docx_sec["tocPlacement"] == "afterTitle");
    CHECK(docx_sec["notesPlacement"] == "footnotes");
    CHECK(docx_sec["zip"] == false);

    // Valid custom settings pass.
    const json ok_set = f.ws.call("settings.set", {{"patch",
                                                    {{"docx",
                                                      {{"defaultPageSize", "a5"},
                                                       {"margins", "custom"},
                                                       {"customMargin", 18},
                                                       {"fontFamily", "custom"},
                                                       {"customFontFamily", "Palatino"},
                                                       {"textSizePt", 11},
                                                       {"tocPlacement", "end"},
                                                       {"notesPlacement", "endnotes"},
                                                       {"zip", true}}}}}});
    REQUIRE(ok_set.contains("result"));
    const json after_set = f.ws.call("settings.get", json::object());
    REQUIRE(after_set.contains("result"));
    CHECK(after_set["result"]["docx"]["customFontFamily"] == "Palatino");

    // Out-of-range textSizePt (15) and control character in customFontFamily fail validation.
    const json bad_size = f.ws.call("settings.set", {{"patch", {{"docx", {{"textSizePt", 15}}}}}});
    CHECK(bad_size.contains("error"));
    const json bad_font =
        f.ws.call("settings.set", {{"patch", {{"docx", {{"customFontFamily", "Bad\x01Font"}}}}}});
    CHECK(bad_font.contains("error"));

    // Batch scan discovers bare `.docx` and `.docx` inside `.zip` with FBD pairing.
    test::TempDir src{"mfbe-docx-batch-src"};
    const std::string inner = minimal_docx_bytes();
    const std::string fbd = minimal_fbd_bytes();
    atomic_file::write_atomic(src.path() / "bare.docx", inner);
    atomic_file::write_atomic(src.path() / "packed.zip",
                              archive::zip_entries({{"story.docx", inner, true, false},
                                                    {"story.fbd", fbd, false, false}}));

    batch::ScanRequest req;
    req.source_dir = src.path();
    req.direction = batch::Direction::import_to_fb2;
    req.formats = {"docx"};
    req.include_subfolders = true;
    const batch::ScanResult scanned = batch::scan_directory(req);
    REQUIRE(scanned.items.size() == 2);
    CHECK(scanned.items[0].format == "docx");
    CHECK(scanned.items[1].format == "docx");
    bool saw_archive_fbd = false;
    for (const auto& item : scanned.items) {
        if (item.archive_entry.has_value() && item.archive_fbd_entry == "story.fbd") {
            saw_archive_fbd = true;
        }
    }
    CHECK(saw_archive_fbd);

    // Batch settings persist `docx` forward-compatibly without altering global settings.
    const json bs = f.ws.call("batch.settings.get", json::object());
    REQUIRE(bs.contains("result"));
    const json& bset = bs["result"].contains("settings") ? bs["result"]["settings"] : bs["result"];
    CHECK(bset["importFormats"]["docx"] == true);
    CHECK(bset["exportSettings"]["docx"]["defaultPageSize"] == "a5");
}
