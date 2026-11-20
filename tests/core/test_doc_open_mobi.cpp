// Feature 018 (T024, T040, FR-020): File > Open refuses MOBI/KF8/PalmDOC files and MOBI-only ZIPs
// (while allowing ZIPs containing FBD + MOBI), plus end-to-end mobiImport.* RPC tests.
#include "mobi/mobi_writer.hpp"
#include "mobi/palmdb.hpp"
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>
#include <string>

using namespace mfbe;
using nlohmann::json;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-open-mobi"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
};

std::string minimal_valid_mobi_bytes() {
    test::TempDir tmp{"mfbe-make-mobi"};
    const auto target = tmp.path() / "sample.mobi";
    mobi::MobiWriter writer(target, mobi::MobiExportFormat::mobi7, false);
    writer.set_mobi7_html("<html><body><p>Hello world</p></body></html>");
    writer.set_mfbe_json(json{
        {"v", 1},
        {"description",
         {{"titleInfo",
           {{"genres", json::array({{{"code", "prose_classic"}}})},
            {"authors", json::array({{{"firstName", "A"},
                                      {"lastName", "B"},
                                      {"homePages", json::array()},
                                      {"emails", json::array()}}})},
            {"bookTitle", "Sample MOBI"},
            {"coverpage", json::array()},
            {"lang", "en"},
            {"translators", json::array()},
            {"sequences", json::array()}}},
          {"documentInfo",
           {{"authors", json::array()},
            {"date", {{"text", "2026"}}},
            {"srcUrls", json::array()},
            {"id", "sample-id"},
            {"version", "1.0"},
            {"publishers", json::array()}}},
          {"customInfo", json::array()},
          {"outputs", json::array()}}},
        {"stylesheets", json::array()},
        {"binaries", json::object()},
        {"attrs", json::object()},
    });
    mobi::MobiCommitInput in;
    in.metadata.title = "Sample MOBI";
    in.metadata.authors = {"A B"};
    in.metadata.language = "en";
    in.metadata.identifier = "sample-id";
    writer.commit(in);
    return atomic_file::read_file(target);
}

std::string minimal_fbd_bytes() {
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
           "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
           "xmlns:l=\"http://www.w3.org/1999/xlink\">"
           "<description><title-info><genre>prose_classic</genre>"
           "<author><first-name>A</first-name><last-name>B</last-name></author>"
           "<book-title>Companion FBD</book-title><lang>en</lang></title-info>"
           "<document-info><author><nickname>test</nickname></author>"
           "<date value=\"2026-01-01\">2026</date><id>fbd-1</id><version>1.0</version>"
           "</document-info></description><body><section><p/></section></body></FictionBook>";
}

}  // namespace

TEST_CASE("open mobi: bare MOBI/AZW3/AZW/PRC and renamed PalmDB files are refused (1004 mobi)",
          "[mobi][archive]") {
    Fixture f;
    const std::string mobi_bytes = minimal_valid_mobi_bytes();

    for (const char* name : {"book.mobi", "book.azw3", "book.azw", "book.prc", "renamed.bin"}) {
        const auto p = f.data.path() / name;
        atomic_file::write_atomic(p, mobi_bytes);
        const json opened = f.ws.call("doc.open", json{{"path", platform::utf8_from_path(p)}}, 20000);
        INFO("name=" << name << " resp=" << opened.dump());
        REQUIRE(opened.contains("error"));
        CHECK(opened["error"]["code"] == 1004);
        CHECK(opened["error"]["data"]["reason"] == "mobi");
    }

    // Plain PalmDOC header (TEXt/REAd) renamed to .dat is also refused as "mobi".
    mobi::PalmDb pd;
    pd.name = "PlainDoc";
    pd.type = "TEXt";
    pd.creator = "REAd";
    std::string r0(16, '\0');
    mobi::write_u16_be(r0, 0, 1);
    mobi::write_u32_be(r0, 4, 5);
    mobi::write_u16_be(r0, 8, 1);
    mobi::write_u16_be(r0, 10, 4096);
    pd.records = {r0, "Hello"};
    const auto prc_dat = f.data.path() / "palmdoc.dat";
    atomic_file::write_atomic(prc_dat, mobi::write_palmdb(pd));
    const json opened = f.ws.call("doc.open", json{{"path", platform::utf8_from_path(prc_dat)}}, 20000);
    REQUIRE(opened.contains("error"));
    CHECK(opened["error"]["code"] == 1004);
    CHECK(opened["error"]["data"]["reason"] == "mobi");
}

TEST_CASE("open mobi: MOBI-only ZIP is refused (1081 mobiInArchive); FBD+MOBI ZIP opens the FBD",
          "[mobi][archive]") {
    Fixture f;
    const std::string mobi_bytes = minimal_valid_mobi_bytes();

    const auto mobi_only_zip = f.data.path() / "mobi-only.zip";
    atomic_file::write_atomic(mobi_only_zip, archive::zip_one("book.mobi", mobi_bytes));
    const json refused =
        f.ws.call("doc.open", json{{"path", platform::utf8_from_path(mobi_only_zip)}}, 20000);
    REQUIRE(refused.contains("error"));
    CHECK(refused["error"]["code"] == 1081);
    CHECK(refused["error"]["data"]["reason"] == "mobiInArchive");

    // ZIP with both .fbd and .mobi still opens the .fbd normally!
    const auto with_fbd_zip = f.data.path() / "with-fbd.zip";
    atomic_file::write_atomic(
        with_fbd_zip,
        archive::zip_entries({archive::ZipEntry{"book.mobi", mobi_bytes, true, false},
                              archive::ZipEntry{"book.fbd", minimal_fbd_bytes(), false, false}}));
    const json opened =
        f.ws.call("doc.open", json{{"path", platform::utf8_from_path(with_fbd_zip)}}, 20000);
    REQUIRE(opened.contains("result"));
    CHECK(opened["result"]["document"]["description"]["titleInfo"]["bookTitle"] == "Companion FBD");
}

TEST_CASE("mobiImport.* RPC lists ZIP archives, reads MOBI, extracts FBD, and writes recordFbd",
          "[mobi][archive]") {
    Fixture f;
    const std::string mobi_bytes = minimal_valid_mobi_bytes();
    const auto zip_path = f.data.path() / "bundle.zip";
    atomic_file::write_atomic(
        zip_path,
        archive::zip_entries({archive::ZipEntry{"book.mobi", mobi_bytes, true, false},
                              archive::ZipEntry{"book.fbd", minimal_fbd_bytes(), false, false}}));

    // 1. Archive listing
    const json list_res =
        f.ws.call("mobiImport.begin", json{{"path", platform::utf8_from_path(zip_path)}}, 20000);
    REQUIRE(list_res.contains("result"));
    REQUIRE(list_res["result"].contains("archive"));
    CHECK(list_res["result"]["archive"]["mobis"].size() == 1);
    CHECK(list_res["result"]["archive"]["mobis"][0]["entry"] == "book.mobi");
    CHECK(list_res["result"]["archive"]["fbds"].size() == 1);
    CHECK(list_res["result"]["archive"]["fbds"][0]["entry"] == "book.fbd");

    // 2. Open entry inside ZIP
    const json begin_res = f.ws.call(
        "mobiImport.begin",
        json{{"path", platform::utf8_from_path(zip_path)}, {"entry", "book.mobi"}}, 20000);
    REQUIRE(begin_res.contains("result"));
    const std::string token = begin_res["result"]["token"].get<std::string>();

    // 3. Read job
    const json read_start = f.ws.call("mobiImport.read", json{{"token", token}}, 20000);
    REQUIRE(read_start.contains("result"));
    const std::string job_id = read_start["result"]["jobId"].get<std::string>();
    json read_done;
    for (int i = 0; i < 100; ++i) {
        const auto frame = f.ws.receive(5000);
        REQUIRE(frame.has_value());
        const json msg = json::parse(frame->payload);
        if (msg.value("method", "") == "job.done" && msg["params"]["jobId"] == job_id) {
            read_done = msg["params"]["result"];
            break;
        }
        if (msg.value("method", "") == "job.failed" && msg["params"]["jobId"] == job_id) {
            FAIL("mobiImport.read failed: " << msg.dump());
        }
    }
    REQUIRE(read_done.is_object());
    CHECK(read_done["containerKind"] == "mobi7");
    CHECK(read_done["mfbeStatus"] == "valid");
    CHECK(read_done["mfbeHtmlMatches"] == true);
    CHECK(read_done["mfbeMetaMatches"] == true);

    // 4. extractFbd & recordFbd both produce readable .fbd files
    const json ext_res =
        f.ws.call("mobiImport.extractFbd", json{{"token", token}, {"entry", "book.fbd"}}, 20000);
    REQUIRE(ext_res.contains("result"));
    CHECK(std::filesystem::exists(
        platform::path_from_utf8(ext_res["result"]["path"].get<std::string>())));

    const json rec_res = f.ws.call("mobiImport.recordFbd", json{{"token", token}}, 20000);
    REQUIRE(rec_res.contains("result"));
    CHECK(std::filesystem::exists(
        platform::path_from_utf8(rec_res["result"]["path"].get<std::string>())));

    // 5. End cleans up cleanly
    const json end_res = f.ws.call("mobiImport.end", json{{"token", token}}, 20000);
    REQUIRE(end_res.contains("result"));
}

TEST_CASE("mobiImport.begin handles 0-MOBI, multi-MOBI, non-ZIP, and damaged archives",
          "[mobi][archive]") {
    Fixture f;
    const std::string mobi_bytes = minimal_valid_mobi_bytes();

    // 1. ZIP with 0 MOBIs -> 1117 noMobiInArchive
    const auto no_mobi_zip = f.data.path() / "no-mobi.zip";
    atomic_file::write_atomic(no_mobi_zip, archive::zip_one("readme.txt", "nothing here"));
    const json empty_res =
        f.ws.call("mobiImport.begin", json{{"path", platform::utf8_from_path(no_mobi_zip)}}, 20000);
    REQUIRE(empty_res.contains("error"));
    CHECK(empty_res["error"]["code"] == 1117);
    CHECK(empty_res["error"]["data"]["reason"] == "noMobiInArchive");

    // 2. Multi-MOBI ZIP -> lists all MOBIs and all FBDs
    const auto multi_zip = f.data.path() / "multi.zip";
    atomic_file::write_atomic(
        multi_zip,
        archive::zip_entries({archive::ZipEntry{"a/first.mobi", mobi_bytes, true, false},
                              archive::ZipEntry{"b/second.azw3", mobi_bytes, true, false},
                              archive::ZipEntry{"a/first.fbd", minimal_fbd_bytes(), false, false},
                              archive::ZipEntry{"c/other.fbd", minimal_fbd_bytes(), false, false}}));
    const json multi_res =
        f.ws.call("mobiImport.begin", json{{"path", platform::utf8_from_path(multi_zip)}}, 20000);
    REQUIRE(multi_res.contains("result"));
    CHECK(multi_res["result"]["archive"]["mobis"].size() == 2);
    CHECK(multi_res["result"]["archive"]["fbds"].size() == 2);

    // 3. Non-ZIP archive (7z magic) -> 1117 otherArchive
    const auto seven_z = f.data.path() / "books.7z";
    atomic_file::write_atomic(seven_z, std::string("\x37\x7A\xBC\xAF\x27\x1C\x00\x04", 8));
    const json sz_res =
        f.ws.call("mobiImport.begin", json{{"path", platform::utf8_from_path(seven_z)}}, 20000);
    REQUIRE(sz_res.contains("error"));
    CHECK(sz_res["error"]["code"] == 1117);
    CHECK(sz_res["error"]["data"]["reason"] == "otherArchive");

    // 4. Damaged ZIP (PK header truncated) -> 1117 damaged
    const auto bad_zip = f.data.path() / "broken.zip";
    atomic_file::write_atomic(bad_zip, std::string("PK\x03\x04truncated-corrupt-zip", 25));
    const json bad_res =
        f.ws.call("mobiImport.begin", json{{"path", platform::utf8_from_path(bad_zip)}}, 20000);
    REQUIRE(bad_res.contains("error"));
    CHECK(bad_res["error"]["code"] == 1117);
    CHECK(bad_res["error"]["data"]["reason"] == "damaged");
}
