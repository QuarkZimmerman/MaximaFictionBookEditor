// Feature 017 (T023; D10 to D13, DP-4): txt.export writes the laid-out text in the chosen encoding
// with CR LF, the byte-order mark only for UTF-8 when asked, atomically, never over the book's file.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <filesystem>

using nlohmann::json;
using namespace mfbe;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-txt-export"};
    test::TempDir out{"mfbe-txt-export-out"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;
    std::string doc_id;
    json document;

    Fixture() {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
        const json opened = ws.call(
            "doc.open",
            json{{"path", platform::utf8_from_path(test::fixtures_dir() / "books" / "modern-utf8.fb2")}});
        doc_id = opened["result"]["document"]["docId"];
        document = opened["result"]["document"];
    }

    json wait_job(const std::string& job_id) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
        while (std::chrono::steady_clock::now() < deadline) {
            auto msg = ws.receive_json(10000);
            if (!msg) break;
            const std::string name = msg->value("method", "");
            if ((name == "job.done" || name == "job.failed") && (*msg)["params"]["jobId"] == job_id) {
                json result = (*msg)["params"];
                result["event"] = name;
                return result;
            }
        }
        return json{{"event", "timeout"}};
    }

    json export_txt(const std::string& name, const std::string& text, const std::string& encoding,
                    bool bom = false) {
        const json started = ws.call("txt.export", json{{"docId", doc_id},
                                                        {"path", platform::utf8_from_path(out.path() / name)},
                                                        {"text", text},
                                                        {"encoding", encoding},
                                                        {"bom", bom}});
        REQUIRE(started.contains("result"));
        return wait_job(started["result"]["jobId"]);
    }
};

}  // namespace

TEST_CASE("txt.export writes UTF-8 with CR LF, and the BOM only when asked", "[txt][export][rpc]") {
    Fixture f;
    const json done = f.export_txt("a.txt", "Line one\nЛиния\xC2\xAD два\n", "utf-8");
    REQUIRE(done["event"] == "job.done");
    CHECK(atomic_file::read_file(f.out.path() / "a.txt") == "Line one\r\nЛиния два\r\n");
    CHECK(done["result"]["replaced"].empty());
    f.export_txt("b.txt", "x\n", "utf-8", true);
    CHECK(atomic_file::read_file(f.out.path() / "b.txt") == "\xEF\xBB\xBFx\r\n");
    // No BOM in a single-byte encoding, whatever the box says.
    f.export_txt("c.txt", "x\n", "windows-1251", true);
    CHECK(atomic_file::read_file(f.out.path() / "c.txt") == "x\r\n");
}

TEST_CASE("txt.export writes a single-byte encoding and reports what it replaced", "[txt][export][rpc]") {
    Fixture f;
    const json done = f.export_txt("koi.txt", "\xC2\xAB\xD0\x94\xC2\xBB \xE2\x80\x94 \xE4\xB8\xAD\n", "koi8-r");
    REQUIRE(done["event"] == "job.done");
    CHECK(atomic_file::read_file(f.out.path() / "koi.txt") == "\"\xE4\" - ?\r\n");
    const json replaced = done["result"]["replaced"];
    REQUIRE(replaced.size() == 4);
    CHECK(replaced[0]["char"] == "\xC2\xAB");
    CHECK(replaced[0]["as"] == "\"");
    CHECK(replaced[3]["as"] == "?");
    CHECK(done["result"]["leftOut"] == 0);
}

TEST_CASE("txt.export refuses an unknown encoding and the book's own file", "[txt][export][rpc]") {
    Fixture f;
    const json unknown = f.ws.call("txt.export", json{{"docId", f.doc_id},
                                                      {"path", platform::utf8_from_path(f.out.path() / "x.txt")},
                                                      {"text", "x"},
                                                      {"encoding", "shift_jis"}});
    CHECK(unknown.contains("error"));
    const json own = f.ws.call(
        "txt.export",
        json{{"docId", f.doc_id},
             {"path", platform::utf8_from_path(test::fixtures_dir() / "books" / "modern-utf8.fb2")},
             {"text", "x"},
             {"encoding", "utf-8"}});
    REQUIRE(own.contains("error"));
    CHECK(own["error"]["code"] == 1006);
}

TEST_CASE("txt.export writes a ZIP archive with the TXT and the book's FBD (D13)", "[txt][export][rpc]") {
    Fixture f;
    const auto target = f.out.path() / "book.zip";
    const json started = f.ws.call("txt.export", json{{"docId", f.doc_id},
                                                      {"path", platform::utf8_from_path(target)},
                                                      {"text", "Text\n"},
                                                      {"encoding", "windows-1251"},
                                                      {"bom", false},
                                                      {"zip", true},
                                                      {"document", f.document}});
    REQUIRE(started.contains("result"));
    REQUIRE(f.wait_job(started["result"]["jobId"])["event"] == "job.done");
    const archive::Listing listing = archive::list(target);
    std::vector<std::string> names;
    for (const auto& e : listing.entries) names.push_back(e.name);
    CHECK(names == std::vector<std::string>{"book.txt", "book.fbd"});
    CHECK(archive::read_entry(target, "book.txt") == "Text\r\n");
    // The FBD is the one Export as FBD writes.
    const auto fbd = f.out.path() / "same.fbd";
    const json exported = f.ws.call("doc.exportDescription", json{{"docId", f.doc_id},
                                                                  {"path", platform::utf8_from_path(fbd)},
                                                                  {"document", f.document},
                                                                  {"force", true}});
    REQUIRE(exported.contains("result"));
    CHECK(archive::read_entry(target, "book.fbd") == atomic_file::read_file(fbd));
    // Without the description a ZIP is refused before anything is written.
    const json missing = f.ws.call("txt.export", json{{"docId", f.doc_id},
                                                      {"path", platform::utf8_from_path(f.out.path() / "x.zip")},
                                                      {"text", "x"},
                                                      {"encoding", "utf-8"},
                                                      {"zip", true}});
    CHECK(missing.contains("error"));
    CHECK_FALSE(std::filesystem::exists(f.out.path() / "x.zip"));
}
