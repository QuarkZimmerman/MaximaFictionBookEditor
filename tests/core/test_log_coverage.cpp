// T152 (FR-131): every failure the core reports reaches the errors-only log exactly once, with
// a stable code and context (method, docId, path, line/column, reason) and never with book
// text. Covered here: a parse error on open, a failed save (synchronous and as a job) and an
// unreadable per-user resource file (hotkeys.json), plus the outcomes that must *not* be logged
// (malformed Source text, cancellations) and the shape of the UI's `log.error` entries.
//
// Audit summary (where each failure class is logged):
//   RPC errors returned to the client ... rpc_router.cpp: `rpc.<error name>` with method,
//                                         docId, path, jobId and the scalar identifiers of the
//                                         error data (words/text/documents never copied);
//                                         doc.fromXml/doc.validate/doc.toXml parse feedback and
//                                         cancellations are normal operation and skipped
//   handler / job crashes (std::exception) rpc.handlerCrashed, job.crashed
//   failed start-up, static asset reads .. server.startFailed, http.staticReadFailed
//   rejected HTTP/WS requests ............ http.unauthorized, http.forbidden (path only)
//   per-user files (settings, hotkeys,
//     recent, exclusions, custom.dic) .... <area>.unreadable / .writeFailed / .invalid*
//   resources (genres, scripts, symbols,
//     languages, dictionaries, schema) ... genres.parseError, scripts.invalidManifest,
//                                         resources.*Unavailable, spell.dictionaryEncoding,
//                                         validation.schemaMissing / schemaInvalid
//   binaries ............................. binary.spill*Failed, image.convertFailed,
//                                         image.previewFailed
//   UI (through log.error) ............... command.<id>, script errors, file.*Failed,
//                                         images.upload, ui.unhandledError/Rejection
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <chrono>
#include <sstream>

using namespace mfbe;
using Catch::Matchers::ContainsSubstring;
using Catch::Matchers::EndsWith;
using nlohmann::json;

namespace {

struct LogFixture {
    test::TempDir data{"mfbe-logcov"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;
    std::size_t consumed = 0;  // bytes of the log already examined

    explicit LogFixture(bool unreadable_hotkeys = false) {
        if (unreadable_hotkeys) {
            // A directory where the file is expected: every read fails deterministically
            // (permission bits are unreliable for a root test runner).
            std::filesystem::create_directories(data.path() / "hotkeys.json");
        }
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    std::filesystem::path log_file() const { return data.path() / "logs" / "mfbe-errors.log"; }

    std::string log_text() const {
        return std::filesystem::exists(log_file()) ? test::read_text(log_file()) : std::string();
    }

    // Entries appended since the previous call.
    std::vector<json> new_entries() {
        const std::string text = log_text();
        std::vector<json> entries;
        std::istringstream in(text.substr(std::min(consumed, text.size())));
        std::string line;
        while (std::getline(in, line)) {
            if (!line.empty()) {
                entries.push_back(json::parse(line));
            }
        }
        consumed = text.size();
        return entries;
    }

    std::filesystem::path book(const char* name) const {
        return test::fixtures_dir() / "books" / name;
    }

    // Calls a MaybeJob method: returns the direct response or the job outcome.
    json run_job(const std::string& method, const json& params) {
        json response = ws.call(method, params, 20000);
        if (response.contains("error")) {
            return response;
        }
        const json& result = response["result"];
        if (!result.is_object() || !result.contains("jobId")) {
            return response;
        }
        const std::string job_id = result["jobId"];
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
        while (std::chrono::steady_clock::now() < deadline) {
            auto msg = ws.receive_json(60000);
            if (!msg) {
                break;
            }
            const std::string name = msg->value("method", "");
            if ((name == "job.done" || name == "job.failed") &&
                (*msg)["params"]["jobId"] == job_id) {
                json out{{"jsonrpc", "2.0"}, {"id", response["id"]}, {"jobId", job_id}};
                if (name == "job.done") {
                    out["result"] = (*msg)["params"]["result"];
                } else {
                    out["error"] = (*msg)["params"]["error"];
                }
                return out;
            }
            ws.inbox.push_back(*msg);
        }
        throw std::runtime_error("job did not finish: " + job_id);
    }
};

// Text of the fixtures that must never appear in the log.
constexpr const char* kMalformedText = "This paragraph is never closed";
constexpr const char* kModernText =
    "\xD0\xA1\xD0\xBE\xD0\xB2\xD1\x80\xD0\xB5\xD0\xBC\xD0\xB5"
    "\xD0\xBD\xD0\xBD\xD0\xB0\xD1\x8F";  // "Современная"

}  // namespace

TEST_CASE("log coverage: a parse error on open is logged once with location, never with text",
          "[server][log]") {
    LogFixture f;
    f.new_entries();  // start-up entries, if any, are not part of this scenario
    const std::string path = f.book("malformed.fb2").string();
    const json opened = f.ws.call("doc.open", json{{"path", path}});
    REQUIRE(opened.contains("error"));
    CHECK(opened["error"]["code"] == 1001);

    const auto entries = f.new_entries();
    REQUIRE(entries.size() == 1);
    const json& e = entries[0];
    CHECK(e["level"] == "error");
    CHECK(e["source"] == "core");
    CHECK(e["code"] == "rpc.doc.parseError");
    CHECK(e["context"]["method"] == "doc.open");
    CHECK(e["context"]["path"] == path);
    CHECK(e["context"]["line"] == "20");
    CHECK(e["context"]["column"] == "13");
    CHECK(e["context"]["rpcCode"] == "1001");
    CHECK(e["context"].contains("version"));
    CHECK(e["context"].contains("platform"));
    const std::string text = f.log_text();
    CHECK(text.find(kMalformedText) == std::string::npos);
    CHECK(text.find("fixture-malformed") == std::string::npos);  // nor other document data
}

TEST_CASE("log coverage: a failed save is logged once (synchronous and as a job) with context",
          "[server][log]") {
    LogFixture f;
    const json opened = f.ws.call("doc.open", json{{"path", f.book("modern-utf8.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const std::string doc_id = opened["result"]["document"]["docId"];
    // A regular file where a directory is needed: the atomic writer cannot create its temp file.
    test::write_text(f.data / "notadir", "x");
    const std::string target = (f.data / "notadir" / "book.fb2").string();
    f.new_entries();

    SECTION("synchronous model save") {
        const json saved = f.run_job("doc.save", json{{"docId", doc_id}, {"path", target}});
        REQUIRE(saved.contains("error"));
        CHECK(saved["error"]["code"] == 1002);
        const auto entries = f.new_entries();
        REQUIRE(entries.size() == 1);
        const json& e = entries[0];
        CHECK(e["level"] == "error");
        CHECK(e["code"] == "rpc.doc.ioError");
        CHECK(e["message"] == "doc.ioError");
        CHECK(e["context"]["method"] == "doc.save");
        CHECK(e["context"]["docId"] == doc_id);
        CHECK(e["context"]["path"] == target);
        CHECK_FALSE(e["context"]["reason"].get<std::string>().empty());
        CHECK_FALSE(e["context"].contains("jobId"));
    }

    SECTION("save job (large Source text, forced)") {
        // Above the job threshold (2 MB) the save runs on a worker thread; the failure entry
        // then carries the job id and still the method/docId/path of the request.
        std::string text =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
            "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\">"
            "<description><title-info><genre>prose</genre><author>"
            "<first-name>A</first-name><last-name>B</last-name></author>"
            "<book-title>T</book-title><lang>en</lang></title-info>"
            "<document-info><author><nickname>n</nickname></author>"
            "<date>2026</date><id>i</id><version>1.0</version></document-info>"
            "</description><body><section>";
        const std::string filler = "<p>filler paragraph for the job threshold</p>\n";
        while (text.size() < 2200 * 1024) {
            text += filler;
        }
        text += "</section></body></FictionBook>\n";
        const json saved = f.run_job(
            "doc.save", json{{"docId", doc_id}, {"text", text}, {"path", target}, {"force", true}});
        REQUIRE(saved.contains("jobId"));
        REQUIRE(saved.contains("error"));
        CHECK(saved["error"]["code"] == 1002);
        const auto entries = f.new_entries();
        REQUIRE(entries.size() == 1);
        const json& e = entries[0];
        CHECK(e["code"] == "rpc.doc.ioError");
        CHECK(e["context"]["method"] == "doc.save");
        CHECK(e["context"]["docId"] == doc_id);
        CHECK(e["context"]["path"] == target);
        CHECK(e["context"]["jobId"] == saved["jobId"]);
        CHECK(f.log_text().find("filler paragraph") == std::string::npos);
    }

    CHECK(f.log_text().find(kModernText) == std::string::npos);
}

TEST_CASE("log coverage: an unreadable per-user resource file is logged once at start-up",
          "[server][log]") {
    LogFixture f(/*unreadable_hotkeys=*/true);
    const auto entries = f.new_entries();
    std::vector<json> hotkeys;
    for (const json& e : entries) {
        if (e["code"] == "hotkeys.unreadable") {
            hotkeys.push_back(e);
        }
    }
    REQUIRE(hotkeys.size() == 1);
    CHECK(hotkeys[0]["level"] == "error");
    CHECK_THAT(hotkeys[0]["context"]["path"].get<std::string>(), EndsWith("hotkeys.json"));
    CHECK_FALSE(hotkeys[0]["context"]["reason"].get<std::string>().empty());
    // The server still works with default bindings.
    const json got = f.ws.call("hotkeys.get");
    REQUIRE(got.contains("result"));
}

TEST_CASE("log coverage: normal outcomes are not logged, protocol failures are", "[server][log]") {
    LogFixture f;
    const json created = f.ws.call("doc.new");
    REQUIRE(created.contains("result"));
    const std::string doc_id = created["result"]["docId"];
    f.new_entries();

    // Malformed XML typed in the Source view is editing feedback, not a failure.
    const json malformed =
        f.ws.call("doc.fromXml",
                  json{{"docId", doc_id},
                       {"text",
                        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\">"
                        "<body><section><p>Zq-unique-sentence</section></body></FictionBook>"}});
    REQUIRE(malformed.contains("error"));
    CHECK(malformed["error"]["code"] == 1001);
    CHECK(f.new_entries().empty());

    // Unknown methods and malformed frames are protocol failures (warnings).
    CHECK(f.ws.call("no.such.method")["error"]["code"] == -32601);
    auto entries = f.new_entries();
    REQUIRE(entries.size() == 1);
    CHECK(entries[0]["level"] == "warning");
    CHECK(entries[0]["code"] == "rpc.methodNotFound");
    CHECK(entries[0]["context"]["method"] == "no.such.method");

    // A stale document id (closed meanwhile) is a warning with the id as context.
    CHECK(f.ws.call("doc.close", json{{"docId", doc_id}})["result"] == json::object());
    CHECK(f.ws.call("doc.toXml", json{{"docId", doc_id},
                                      {"document", created["result"]}})["error"]["code"] == 1000);
    entries = f.new_entries();
    REQUIRE(entries.size() == 1);
    CHECK(entries[0]["code"] == "rpc.doc.notFound");
    CHECK(entries[0]["context"]["docId"] == doc_id);
    CHECK(entries[0]["context"]["method"] == "doc.toXml");

    // Words from the book never reach the log even when they travel in error data.
    const json bad = f.ws.call("words.exclusions", json{{"add", json::array({"Zq-bad word"})}});
    REQUIRE(bad.contains("error"));
    entries = f.new_entries();
    REQUIRE(entries.size() == 1);
    CHECK(entries[0]["code"] == "rpc.invalidParams");
    CHECK(f.log_text().find("Zq-") == std::string::npos);
}
