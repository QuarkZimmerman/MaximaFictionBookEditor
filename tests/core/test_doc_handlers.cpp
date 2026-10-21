// T042/T045: doc.* and binary.* over the real loopback server - new, toXml, fromXml, save
// (needsConfirmation and force), recent, open (direct and as a job), openSource for malformed
// files, validate, caret, watch + doc.changedOnDisk, keepEncoding, HTTP /binary GET/POST,
// formatDate (feature 003); doc.readDescription, the import session and binary.copy (feature
// 004 US4, T036); doc.exportDescription, the FBD export (feature 004 US5, T044).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/base64.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/document_details.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <functional>
#include <set>
#include <thread>

using namespace mfbe;
using Catch::Matchers::ContainsSubstring;
using nlohmann::json;

namespace {

struct ServerFixture {
    test::TempDir data{"mfbe-doc"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    // `seed` fills the data folder (recent.json, positions.json...) before the core starts.
    explicit ServerFixture(
        const std::function<void(const std::filesystem::path& data_dir)>& seed = {}) {
        if (seed) {
            seed(data.path());
        }
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
    int port() const { return server->port(); }
    std::string tok() const { return "token=" + server->token(); }
    std::filesystem::path book(const char* name) const {
        return test::fixtures_dir() / "books" / name;
    }

    // Calls a MaybeJob method: returns the direct result or waits for job.done.
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
                json out{{"jsonrpc", "2.0"}, {"id", response["id"]}, {"job", true}};
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

std::string read_all(const std::filesystem::path& p) {
    return test::read_text(p);
}

// A text-only FictionBook of `sections` sections with 500 paragraphs each (40 sections make
// a little over 2 MB, the job threshold of doc.open / doc.readDescription).
void write_big_book(const std::filesystem::path& path, int sections) {
    std::ofstream big(path, std::ios::binary);
    big << "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<FictionBook "
           "xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
           "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
           "<description><title-info><genre>sf</genre><author><nickname>big</nickname></"
           "author><book-title>Big</book-title><lang>en</lang></title-info>"
           "<document-info><author><nickname>big</nickname></author><date>2026</date><id>big</"
           "id><version>1.0</version></document-info></description>\n<body>\n";
    for (int s = 0; s < sections; ++s) {
        big << "<section><title><p>Section " << s << "</p></title>\n";
        for (int p = 0; p < 500; ++p) {
            big << "<p>Paragraph " << p << " of section " << s
                << ": the quick brown fox jumps over the lazy dog; съешь же ещё этих мягких "
                   "французских булок.</p>\n";
        }
        big << "</section>\n";
    }
    big << "</body>\n</FictionBook>\n";
}

// Every `attrs.nodeId` below `value`, in document order.
void collect_node_ids(const json& value, std::vector<std::string>& out) {
    if (value.is_object()) {
        if (value.contains("attrs") && value["attrs"].is_object() &&
            value["attrs"].contains("nodeId") && value["attrs"]["nodeId"].is_string()) {
            out.push_back(value["attrs"]["nodeId"].get<std::string>());
        }
        for (const auto& [key, child] : value.items()) {
            collect_node_ids(child, out);
        }
    } else if (value.is_array()) {
        for (const auto& child : value) {
            collect_node_ids(child, out);
        }
    }
}

// The number of an `n<N>` id (-1 for any other id).
long long id_number(const std::string& id) {
    if (id.size() < 2 || id[0] != 'n') {
        return -1;
    }
    try {
        return std::stoll(id.substr(1));
    } catch (const std::exception&) {
        return -1;
    }
}

long long max_id_number(const std::vector<std::string>& ids) {
    long long max = -1;
    for (const auto& id : ids) {
        max = std::max(max, id_number(id));
    }
    return max;
}

// The job notifications of `job_id` until it ends: the phases of its job.progress messages in
// order and the final job.done / job.failed message (messages received meanwhile are kept).
struct JobOutcome {
    std::vector<std::string> phases;
    json final;  // the job.done or job.failed notification
};

JobOutcome collect_job(test::WsClient& ws, const std::string& job_id, int timeout_ms = 60000) {
    JobOutcome outcome;
    const auto consider = [&](const json& msg) {
        const std::string name = msg.value("method", "");
        if (!msg.contains("params") || msg["params"].value("jobId", "") != job_id) {
            return false;
        }
        if (name == "job.progress") {
            outcome.phases.push_back(msg["params"]["phase"].get<std::string>());
            return true;
        }
        if (name == "job.done" || name == "job.failed") {
            outcome.final = msg;
            return true;
        }
        return false;
    };
    // Notifications that arrived while the start call waited for its response.
    std::vector<json> kept;
    for (const auto& msg : ws.inbox) {
        if (!consider(msg)) {
            kept.push_back(msg);
        }
    }
    ws.inbox = kept;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    while (outcome.final.is_null() && std::chrono::steady_clock::now() < deadline) {
        auto msg = ws.receive_json(timeout_ms);
        if (!msg) {
            break;
        }
        if (!consider(*msg)) {
            ws.inbox.push_back(*msg);
        }
    }
    return outcome;
}

// The 10 MB text-only book of the performance journeys, generated into the build tree by
// tests/fixtures/gen-large-book.py when missing; an empty path when python3 or the generator
// are not available.
std::filesystem::path large_book_10mb() {
    const std::filesystem::path book = test::build_dir() / "tests" / "large-book-10mb.fb2";
    std::error_code ec;
    if (std::filesystem::exists(book, ec) && std::filesystem::file_size(book, ec) > 9u << 20) {
        return book;
    }
    const std::filesystem::path generator = test::fixtures_dir() / "gen-large-book.py";
    if (!std::filesystem::exists(generator, ec)) {
        return {};
    }
    std::filesystem::create_directories(book.parent_path(), ec);
    const std::string command = "python3 \"" + generator.string() + "\" --out \"" + book.string() +
                                "\" --size-mb 10 >/dev/null 2>&1";
    if (std::system(command.c_str()) != 0) {
        std::filesystem::remove(book, ec);
        return {};
    }
    return std::filesystem::exists(book, ec) ? book : std::filesystem::path{};
}

}  // namespace

TEST_CASE(
    "doc handlers: new -> toXml -> fromXml -> save (needsConfirmation) -> save(force) -> recent",
    "[server][doc]") {
    ServerFixture f;
    const json created = f.ws.call("doc.new");
    REQUIRE(created.contains("result"));
    const json& doc = created["result"];
    const std::string doc_id = doc["docId"];
    CHECK(doc_id == "d1");
    CHECK(doc["modelVersion"] == 1);
    CHECK(doc["fileKind"] == "fb2");
    CHECK(doc["sourceEncoding"] == "utf-8");
    CHECK_FALSE(doc.contains("path"));
    CHECK(doc["schemaHint"] == "legacy");  // the blank template has an empty genre
    // The original's template, with the document details filled in on load (feature 002).
    const json& info = doc["description"]["documentInfo"];
    const std::string id = info["id"];
    CHECK(uuid::is_valid(id));
    CHECK(id.find_first_of("abcdef") == std::string::npos);  // upper case, as the original
    CHECK(info["version"] == "1.0");
    const std::string program = std::string(version::kProductName) + " " + version::kVersion;
    CHECK(info["programUsed"] == program);
    const std::string date = info["date"]["value"];
    CHECK(date.size() == 10);
    // The date text is the regional long date of today (feature 003 FR-051), by the formatter
    // the Today button uses; the uiLanguage setting is "system" here, as in the formatter call.
    const model::DetailsContext today = model::details_context_now(true);
    CHECK(info["date"]["text"] ==
          platform::format_long_date(today.year, today.month, today.day, today.ui_language));
    CHECK(doc["filledIn"] == json{"documentInfo.id", "documentInfo.version",
                                  "documentInfo.programUsed", "documentInfo.date.text",
                                  "documentInfo.date.value"});
    CHECK_FALSE(doc.contains("templateIssue"));
    CHECK(doc["description"]["titleInfo"]["lang"] == "ru");
    CHECK(doc["description"]["titleInfo"]["genres"][0]["code"] == "");
    REQUIRE(doc["bodies"].size() == 1);
    CHECK(doc["bodies"][0]["content"][0]["type"] == "section");
    CHECK(doc["binaries"].is_array());

    // Source view text with elided binaries.
    const json xml =
        f.ws.call("doc.toXml", json{{"docId", doc_id}, {"document", doc}, {"elideBinaries", true}});
    REQUIRE(xml.contains("result"));
    const std::string text = xml["result"]["text"];
    CHECK(text.rfind("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<FictionBook "
                     "xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
                     "xmlns:l=\"http://www.w3.org/1999/xlink\">",
                     0) == 0);
    CHECK_THAT(text, ContainsSubstring("<program-used>" + program + "</program-used>"));
    CHECK_THAT(text, ContainsSubstring("\t\t<section>\n\t\t\t<p>"));

    // Back from Source: same document (fresh nodeIds, remap provided).
    const json back = f.ws.call("doc.fromXml", json{{"docId", doc_id}, {"text", text}});
    REQUIRE(back.contains("result"));
    CHECK(back["result"]["document"]["docId"] == doc_id);
    CHECK(back["result"]["document"]["description"]["titleInfo"]["lang"] == "ru");
    CHECK(back["result"]["document"]["bodies"][0]["content"][0]["type"] == "section");
    CHECK(back["result"]["document"]["filledIn"] == json::array());  // nothing left empty
    CHECK(back["result"]["remap"]["map"].is_object());
    CHECK_FALSE(back["result"]["remap"]["map"].empty());
    CHECK(back["result"]["warnings"] == json::array());
    // Malformed Source text -> doc.parseError with location, document untouched.
    const json bad = f.ws.call(
        "doc.fromXml", json{{"docId", doc_id}, {"text", "<FictionBook><body></FictionBook>"}});
    REQUIRE(bad.contains("error"));
    CHECK(bad["error"]["code"] == 1001);
    CHECK(bad["error"]["data"]["line"] == 1);
    CHECK(bad["error"]["data"]["column"].get<int>() > 0);
    CHECK_THAT(bad["error"]["data"]["message"].get<std::string>(), ContainsSubstring("mismatch"));

    // Save: a new document needs a path; validation errors ask for confirmation first.
    CHECK(f.ws.call("doc.save", json{{"docId", doc_id}, {"document", doc}})["error"]["code"] ==
          -32602);
    const std::string target = (f.data / "new-book.fb2").string();
    const json first =
        f.run_job("doc.save", json{{"docId", doc_id}, {"document", doc}, {"path", target}});
    REQUIRE(first.contains("result"));
    CHECK(first["result"]["needsConfirmation"] == true);
    CHECK(first["result"]["validation"]["errorCount"].get<int>() >= 1);
    CHECK_FALSE(std::filesystem::exists(target));
    bool genre_error = false;
    for (const auto& issue : first["result"]["validation"]["issues"]) {
        if (issue["code"] == "genre.unknown") {
            genre_error = true;
        }
    }
    CHECK(genre_error);

    const json forced = f.run_job(
        "doc.save", json{{"docId", doc_id}, {"document", doc}, {"path", target}, {"force", true}});
    REQUIRE(forced.contains("result"));
    CHECK(forced["result"]["path"] == target);
    CHECK(forced["result"]["encoding"] == "utf-8");
    CHECK(forced["result"]["converted"] == json::array());
    CHECK(forced["result"]["validation"]["errorCount"].get<int>() >= 1);
    CHECK_FALSE(forced["result"].contains("needsConfirmation"));
    REQUIRE(std::filesystem::exists(target));
    const std::string saved = read_all(target);
    CHECK(saved.rfind("<?xml version=\"1.0\" encoding=\"utf-8\"?>", 0) == 0);
    CHECK_THAT(saved,
               ContainsSubstring(
                   "<id>" + doc["description"]["documentInfo"]["id"].get<std::string>() + "</id>"));
    CHECK_FALSE(fb2::check_well_formed(saved).has_value());

    // Recent files know the saved path and carry no caret (feature 004 US8: the remembered
    // position lives in positions.json, a record of its own); the position round-trips.
    const json recent = f.ws.call("doc.recent");
    REQUIRE(recent["result"].size() == 1);
    CHECK(recent["result"][0]["path"] == target);
    CHECK(recent["result"][0]["exists"] == true);
    CHECK(recent["result"][0]["lastOpened"].is_string());
    CHECK_FALSE(recent["result"][0].contains("caret"));
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"] == json::object());
    const json position{{"path", "body[1]/section[1]/p[1]"}, {"offset", 4}};
    CHECK(f.ws.call("doc.position",
                    json{{"docId", doc_id}, {"position", position}})["result"]["position"] ==
          position);
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == position);
    CHECK(f.ws.call("doc.position",
                    json{{"docId", doc_id}, {"position", "nope"}})["error"]["code"] == -32602);
    const json positions_file = json::parse(read_all(f.data / "positions.json"));
    REQUIRE(positions_file["items"].size() == 1);
    CHECK(positions_file["items"][0]["path"] == target);
    CHECK(positions_file["items"][0]["position"] == position);
    CHECK_FALSE(json::parse(read_all(f.data / "recent.json"))["items"][0].contains("caret"));
    // Clear Recent Files empties recent.json alone; the positions record is independent of
    // the menu list (requester decision D4, 2026-10-20).
    CHECK(f.ws.call("doc.clearRecent")["result"] == json::object());
    CHECK(f.ws.call("doc.recent")["result"] == json::array());
    CHECK(json::parse(read_all(f.data / "recent.json"))["items"] == json::array());
    CHECK(json::parse(read_all(f.data / "positions.json")) == positions_file);
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == position);

    // A second save without a path reuses the document's path; a failed write leaves the
    // file intact (fault injection) and keeps the document open.
    REQUIRE(f.ws.call("test.injectFault", json{{"point", "before_rename"}})["result"] ==
            json::object());
    const json failed =
        f.run_job("doc.save", json{{"docId", doc_id}, {"document", doc}, {"force", true}});
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1002);
    CHECK(failed["error"]["data"]["path"] == target);
    CHECK(read_all(target) == saved);
    CHECK(f.ws.call("doc.toXml", json{{"docId", doc_id}, {"document", doc}})["result"]["text"]
              .is_string());

    CHECK(f.ws.call("doc.close", json{{"docId", doc_id}})["result"] == json::object());
    CHECK(f.ws.call("doc.close", json{{"docId", doc_id}})["error"]["code"] == 1000);
    CHECK(f.ws.call("doc.toXml", json{{"docId", doc_id}, {"document", doc}})["error"]["code"] ==
          1000);
}

TEST_CASE("doc handlers: open (direct and as a job), warnings, validate, keepEncoding",
          "[server][doc]") {
    ServerFixture f;
    // Direct open of a small legacy windows-1251 file.
    const json opened = f.ws.call("doc.open", json{{"path", f.book("legacy-cp1251.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const json& doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    CHECK(doc["sourceEncoding"] == "windows-1251");
    CHECK(doc["schemaHint"] == "legacy");
    // Compared as paths: the fixture root is spelled with forward slashes on Windows.
    CHECK(std::filesystem::path(doc["path"].get<std::string>()).lexically_normal() ==
          f.book("legacy-cp1251.fb2").lexically_normal());
    CHECK(doc["description"]["titleInfo"]["bookTitle"] == "Старая книга");
    CHECK(doc["binaries"].size() == 1);
    CHECK(opened["result"]["warnings"] == json::array());
    CHECK(f.ws.call("doc.recent")["result"][0]["path"] == doc["path"]);

    // Validation of the model and of Source text.
    const json report = f.run_job("doc.validate", json{{"docId", doc_id}, {"document", doc}});
    REQUIRE(report.contains("result"));
    CHECK(report["result"]["errorCount"] == 0);  // legacy order is normalised on serialisation
    CHECK(report["result"]["warningCount"] == 0);
    // Break the model: a stray paragraph directly under <body> is reported with its nodeId.
    json broken = doc;
    json stray{{"type", "p"},
               {"attrs", {{"nodeId", "n9999"}}},
               {"content", json::array({json{{"type", "text"}, {"text", "stray"}}})}};
    broken["bodies"][0]["content"].insert(broken["bodies"][0]["content"].begin(), stray);
    const json broken_report =
        f.run_job("doc.validate", json{{"docId", doc_id}, {"document", broken}});
    REQUIRE(broken_report.contains("result"));
    CHECK(broken_report["result"]["errorCount"] == 1);
    CHECK(broken_report["result"]["issues"][0]["code"] == "schema.invalid");
    CHECK(broken_report["result"]["issues"][0]["nodeId"] == "n9999");
    CHECK(broken_report["result"]["issues"][0]["path"] == "body[1]/p[1]");
    CHECK(broken_report["result"]["issues"][0]["line"].is_number_integer());
    const json text_report =
        f.run_job("doc.validate", json{{"docId", doc_id}, {"text", "<FictionBook><x"}});
    REQUIRE(text_report.contains("result"));
    CHECK(text_report["result"]["errorCount"] == 1);
    CHECK(text_report["result"]["issues"][0]["code"] == "xml.notWellFormed");
    CHECK(text_report["result"]["issues"][0]["line"] == 1);
    const json snapshot_report = f.run_job("doc.validate", json{{"docId", doc_id}});
    CHECK(snapshot_report["result"]["errorCount"] == 0);

    // Save As UTF-8 by default; windows-1251 when "Keep encoding" is on; explicit wins.
    const std::string out = (f.data / "copy.fb2").string();
    const json saved = f.run_job(
        "doc.save", json{{"docId", doc_id}, {"document", doc}, {"path", out}, {"force", true}});
    REQUIRE(saved.contains("result"));
    CHECK(saved["result"]["encoding"] == "utf-8");
    CHECK(read_all(out).rfind("<?xml version=\"1.0\" encoding=\"utf-8\"?>", 0) == 0);
    REQUIRE(f.ws.call("settings.set", json{{"patch", {{"other", {{"keepEncoding", true}}}}}})
                .contains("result"));
    f.ws.wait_notification("settings.changed");
    // The session remembers the file's original encoding even after the UTF-8 save as (the
    // document is now at `out`, saved in utf-8 - so keepEncoding keeps utf-8).
    const json kept =
        f.run_job("doc.save", json{{"docId", doc_id}, {"document", doc}, {"force", true}});
    CHECK(kept["result"]["encoding"] == "utf-8");
    const json explicit_enc = f.run_job(
        "doc.save",
        json{{"docId", doc_id}, {"document", doc}, {"encoding", "windows-1251"}, {"force", true}});
    REQUIRE(explicit_enc.contains("result"));
    CHECK(explicit_enc["result"]["encoding"] == "windows-1251");
    CHECK(read_all(out).rfind("<?xml version=\"1.0\" encoding=\"windows-1251\"?>", 0) == 0);
    const json again =
        f.run_job("doc.save", json{{"docId", doc_id}, {"document", doc}, {"force", true}});
    CHECK(again["result"]["encoding"] == "windows-1251");  // keepEncoding now keeps windows-1251
    CHECK(f.ws.call("doc.save", json{{"docId", doc_id},
                                     {"document", doc},
                                     {"encoding", "ebcdic"}})["error"]["code"] == -32602);
    // Re-open of the windows-1251 copy: same title, legacy order normalised -> now "2.1".
    const json reopened = f.ws.call("doc.open", json{{"path", out}});
    REQUIRE(reopened.contains("result"));
    CHECK(reopened["result"]["document"]["sourceEncoding"] == "windows-1251");
    CHECK(reopened["result"]["document"]["schemaHint"] == "2.1");
    CHECK(reopened["result"]["document"]["description"]["titleInfo"]["bookTitle"] ==
          "Старая книга");

    // Missing file -> doc.ioError; malformed -> doc.parseError with line/column.
    const json missing = f.ws.call("doc.open", json{{"path", (f.data / "nope.fb2").string()}});
    CHECK(missing["error"]["code"] == 1002);
    CHECK(missing["error"]["data"]["reason"] == "file not found");
    const json malformed = f.ws.call("doc.open", json{{"path", f.book("malformed.fb2").string()}});
    REQUIRE(malformed.contains("error"));
    CHECK(malformed["error"]["code"] == 1001);
    CHECK(malformed["error"]["data"]["line"] == 20);
    CHECK(malformed["error"]["data"]["column"] == 13);
    CHECK_THAT(malformed["error"]["data"]["message"].get<std::string>(),
               ContainsSubstring("Opening and ending tag mismatch"));

    // Mismatched declaration: opened with a warning.
    const json mismatch =
        f.ws.call("doc.open", json{{"path", f.book("mismatched-declaration.fb2").string()}});
    REQUIRE(mismatch.contains("result"));
    REQUIRE(mismatch["result"]["warnings"].size() == 1);
    CHECK(mismatch["result"]["warnings"][0]["code"] == "encoding.mismatch");
    CHECK(mismatch["result"]["warnings"][0]["params"]["detected"] == "windows-1251");
    CHECK(mismatch["result"]["document"]["sourceEncoding"] == "windows-1251");

    // A big file (> 2 MB) opens as a job with progress and job.done carrying the result.
    const std::filesystem::path big_path = f.data / "big.fb2";
    write_big_book(big_path, 40);
    REQUIRE(std::filesystem::file_size(big_path) > 2 * 1024 * 1024);
    const json start = f.ws.call("doc.open", json{{"path", big_path.string()}});
    REQUIRE(start.contains("result"));
    REQUIRE(start["result"].contains("jobId"));
    const std::string job_id = start["result"]["jobId"];
    bool progress_seen = false;
    json done;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
    while (std::chrono::steady_clock::now() < deadline) {
        auto msg = f.ws.receive_json(60000);
        REQUIRE(msg);
        const std::string name = msg->value("method", "");
        if (name == "job.progress" && (*msg)["params"]["jobId"] == job_id) {
            progress_seen = true;
            CHECK((*msg)["params"]["phase"].is_string());
            CHECK((*msg)["params"]["total"] == 100);
        } else if (name == "job.done" && (*msg)["params"]["jobId"] == job_id) {
            done = *msg;
            break;
        } else if (name == "job.failed" && (*msg)["params"]["jobId"] == job_id) {
            FAIL("job failed: " << msg->dump());
        }
    }
    CHECK(progress_seen);
    REQUIRE(done.is_object());
    const json& big_doc = done["params"]["result"]["document"];
    CHECK(big_doc["docId"].is_string());
    CHECK(big_doc["bodies"][0]["content"].size() == 40);
    CHECK(done["params"]["result"]["warnings"] == json::array());
    // Saving the big document also runs as a job.
    const json big_save = f.run_job("doc.save", json{{"docId", big_doc["docId"]},
                                                     {"document", big_doc},
                                                     {"path", (f.data / "big-copy.fb2").string()},
                                                     {"encoding", "utf-8"}});
    REQUIRE(big_save.contains("result"));
    CHECK(big_save["job"] == true);
    CHECK(big_save["result"]["validation"]["errorCount"] == 0);
    CHECK(std::filesystem::exists(f.data / "big-copy.fb2"));
}

TEST_CASE("doc handlers: files that are not FictionBook documents are refused (1004)",
          "[server][doc]") {
    ServerFixture f;
    const std::string notes = (f.data / "notes.txt").string();
    test::write_text(notes, "Just a text file.\n");
    const std::string html = (f.data / "page.xml").string();
    test::write_text(html, "<?xml version=\"1.0\"?><html><body>FictionBook</body></html>");
    for (const std::string& path : {notes, html}) {
        const json opened = f.ws.call("doc.open", json{{"path", path}});
        REQUIRE(opened.contains("error"));
        CHECK(opened["error"]["code"] == 1004);
        CHECK(opened["error"]["message"] == "doc.notFictionBook");
        CHECK(opened["error"]["data"]["path"] == path);
        const json source = f.ws.call("doc.openSource", json{{"path", path}});
        REQUIRE(source.contains("error"));
        CHECK(source["error"]["code"] == 1004);
    }
    CHECK(f.ws.call("doc.open", json{{"path", notes}})["error"]["data"]["reason"] == "notXml");
    CHECK(f.ws.call("doc.open", json{{"path", html}})["error"]["data"]["reason"] ==
          "rootNotFictionBook");
    // Nothing was opened or remembered.
    CHECK(f.ws.call("doc.recent")["result"] == json::array());
}

TEST_CASE("doc handlers: Source-only mode for malformed files and text saves", "[server][doc]") {
    ServerFixture f;
    const json src = f.ws.call("doc.openSource", json{{"path", f.book("malformed.fb2").string()}});
    REQUIRE(src.contains("result"));
    const json& r = src["result"];
    const std::string doc_id = r["docId"];
    CHECK(r["encoding"] == "utf-8");
    CHECK_THAT(r["text"].get<std::string>(), ContainsSubstring("This paragraph is never closed"));
    REQUIRE(r.contains("error"));
    CHECK(r["error"]["line"] == 20);
    CHECK(r["error"]["column"] == 13);
    // Source-only save: validation reports the parse error, force writes the text anyway.
    const std::string out = (f.data / "still-broken.fb2").string();
    std::string text = r["text"];
    const json ask = f.run_job("doc.save", json{{"docId", doc_id}, {"text", text}, {"path", out}});
    REQUIRE(ask.contains("result"));
    CHECK(ask["result"]["needsConfirmation"] == true);
    CHECK(ask["result"]["validation"]["issues"][0]["code"] == "xml.notWellFormed");
    const json forced = f.run_job("doc.save", json{{"docId", doc_id},
                                                   {"text", text},
                                                   {"path", out},
                                                   {"force", true},
                                                   {"encoding", "windows-1251"}});
    REQUIRE(forced.contains("result"));
    CHECK(forced["result"]["encoding"] == "windows-1251");
    CHECK(read_all(out).rfind("<?xml version=\"1.0\" encoding=\"windows-1251\"?>", 0) == 0);
    // Fixing the text in the Source view and parsing it back leaves Source-only mode.
    const std::size_t pos = text.find("never closed");
    REQUIRE(pos != std::string::npos);
    text.insert(pos + std::string("never closed").size(), "</p>");
    const json fixed = f.ws.call("doc.fromXml", json{{"docId", doc_id}, {"text", text}});
    REQUIRE(fixed.contains("result"));
    CHECK(fixed["result"]["document"]["bodies"][0]["content"][0]["content"][0]["content"][0]
               ["text"] == "This paragraph is never closed");
    CHECK_FALSE(fixed["result"].contains("remap"));  // no previous model
    // A well-formed file through openSource has no error field.
    const json ok = f.ws.call("doc.openSource", json{{"path", f.book("koi8r.fb2").string()}});
    REQUIRE(ok.contains("result"));
    CHECK_FALSE(ok["result"].contains("error"));
    CHECK(ok["result"]["encoding"] == "koi8-r");
    CHECK_THAT(ok["result"]["text"].get<std::string>(), ContainsSubstring("Книга в KOI8-R"));
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 004 US8: doc.position, the positions record and the deprecated doc.caret alias     */
/* ----------------------------------------------------------------------------------------- */

namespace {

json positions_on_disk(const ServerFixture& f) {
    const std::filesystem::path file = f.data / "positions.json";
    return std::filesystem::exists(file) ? json::parse(read_all(file)) : json();
}

json recent_on_disk(const ServerFixture& f) {
    return json::parse(read_all(f.data / "recent.json"));
}

// A fixture book's path as the core records it (absolute, lexically normalised).
std::string fixture_book_path(const char* name) {
    return std::filesystem::absolute(test::fixtures_dir() / "books" / name)
        .lexically_normal()
        .string();
}

}  // namespace

TEST_CASE(
    "doc.position: set/get round trip, the grammar, the setting gate, the Save As name, a "
    "failed open, a Source-only session",
    "[server][doc][position]") {
    ServerFixture f;
    const std::filesystem::path book = f.data / "book.fb2";
    std::filesystem::copy_file(f.book("modern-utf8.fb2"), book);
    const json opened = f.ws.call("doc.open", json{{"path", book.string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"] == json::object());
    CHECK(positions_on_disk(f).is_null());

    // Set and get: the position is kept in the session and recorded under the file's path.
    const json position{{"path", "body[1]/section[1]/p[2]"}, {"offset", 5}};
    CHECK(f.ws.call("doc.position",
                    json{{"docId", doc_id}, {"position", position}})["result"]["position"] ==
          position);
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == position);
    json stored = positions_on_disk(f);
    CHECK(stored["schemaVersion"] == 1);
    REQUIRE(stored["items"].size() == 1);
    CHECK(stored["items"][0]["path"] == book.string());
    CHECK(stored["items"][0]["position"] == position);
    CHECK(stored["items"][0]["at"].is_string());
    // The annotation and history roots are the Body view's too.
    const json annotation{{"path", "title-info/annotation[1]/p[1]"}, {"offset", 2}};
    CHECK(f.ws.call("doc.position",
                    json{{"docId", doc_id}, {"position", annotation}})["result"]["position"] ==
          annotation);
    CHECK(positions_on_disk(f)["items"][0]["position"] == annotation);

    // The grammar: the three Body roots, 1-based indices, an offset >= 0; the shape only (the
    // core never resolves a path against the document).
    const std::vector<json> refused_shapes{
        json{{"path", "src-title-info/annotation[1]/p[1]"}, {"offset", 0}},
        json{{"path", "section[1]/p[1]"}, {"offset", 0}},
        json{{"path", "body[1]/section[1]/p[1]"}, {"offset", -1}},
        json{{"path", "body[0]/p[1]"}, {"offset", 0}},
        json{{"path", "body[1]/section[1]/p[1]"}, {"offset", "3"}},
        json{{"path", "body[1]/section[1]/p[1]"}},
        json{{"offset", 3}},
        json("body[1]"),
        json(7)};
    for (const json& bad : refused_shapes) {
        INFO(bad.dump());
        const json refused = f.ws.call("doc.position", json{{"docId", doc_id}, {"position", bad}});
        REQUIRE(refused.contains("error"));
        CHECK(refused["error"]["code"] == -32602);
        CHECK(refused["error"]["data"]["field"].get<std::string>().rfind("position", 0) == 0);
    }
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == annotation);
    CHECK(f.ws.call("doc.position", json{{"docId", "d99"}})["error"]["code"] == 1000);
    // (`beyond`, not `far`: <windows.h> defines `far` away as an empty legacy macro.)
    const json beyond{{"path", "body[1]/section[1]/p[99]"}, {"offset", 100000}};
    CHECK(f.ws.call("doc.position",
                    json{{"docId", doc_id}, {"position", beyond}})["result"]["position"] == beyond);

    // The setting off: nothing is written, get answers {} - the core gates, whatever the UI
    // believes about the setting (research R5.1 H6).
    const std::string before = read_all(f.data / "positions.json");
    REQUIRE(f.ws.call("settings.set",
                      json{{"patch", json{{"other", json{{"restorePosition", false}}}}}})
                .contains("result"));
    const json other{{"path", "body[1]/section[1]/p[3]"}, {"offset", 1}};
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}, {"position", other}})["result"] ==
          json::object());
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"] == json::object());
    CHECK(read_all(f.data / "positions.json") == before);
    // Switched on again: the session kept the value; the next set records it.
    REQUIRE(
        f.ws.call("settings.set", json{{"patch", json{{"other", json{{"restorePosition", true}}}}}})
            .contains("result"));
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == other);
    CHECK(positions_on_disk(f)["items"][0]["position"] == beyond);
    CHECK(f.ws.call("doc.position",
                    json{{"docId", doc_id}, {"position", position}})["result"]["position"] ==
          position);
    CHECK(positions_on_disk(f)["items"][0]["position"] == position);

    // Save As: the position is recorded under the new name as well; the old name's record
    // stays; recent.json carries no caret.
    const std::filesystem::path copy = f.data / "copy.fb2";
    const json saved = f.run_job(
        "doc.save",
        json{{"docId", doc_id}, {"document", doc}, {"path", copy.string()}, {"force", true}});
    REQUIRE(saved.contains("result"));
    stored = positions_on_disk(f);
    REQUIRE(stored["items"].size() == 2);
    CHECK(stored["items"][0]["path"] == copy.string());
    CHECK(stored["items"][0]["position"] == position);
    CHECK(stored["items"][1]["path"] == book.string());
    CHECK(stored["items"][1]["position"] == position);
    for (const json& item : recent_on_disk(f)["items"]) {
        CHECK_FALSE(item.contains("caret"));
    }
    for (const json& item : f.ws.call("doc.recent")["result"]) {
        CHECK_FALSE(item.contains("caret"));
    }
    // A later remember goes to the new name only.
    const json later{{"path", "body[1]/section[1]/p[1]"}, {"offset", 0}};
    REQUIRE(
        f.ws.call("doc.position", json{{"docId", doc_id}, {"position", later}}).contains("result"));
    stored = positions_on_disk(f);
    CHECK(stored["items"][0]["path"] == copy.string());
    CHECK(stored["items"][0]["position"] == later);
    CHECK(stored["items"][1]["path"] == book.string());
    CHECK(stored["items"][1]["position"] == position);
    CHECK(f.ws.call("doc.close", json{{"docId", doc_id}})["result"] == json::object());

    // Reopened: the record is the session's position; the MRU and the record are independent.
    const json reopened = f.ws.call("doc.open", json{{"path", book.string()}});
    REQUIRE(reopened.contains("result"));
    const std::string second_id = reopened["result"]["document"]["docId"];
    CHECK(f.ws.call("doc.position", json{{"docId", second_id}})["result"]["position"] == position);
    CHECK(f.ws.call("doc.close", json{{"docId", second_id}})["result"] == json::object());

    // A failed open prunes the Recent Files entry but leaves the position alone.
    std::filesystem::remove(copy);
    const json failed = f.ws.call("doc.open", json{{"path", copy.string()}});
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1002);
    for (const json& item : f.ws.call("doc.recent")["result"]) {
        CHECK(item["path"] != copy.string());
    }
    stored = positions_on_disk(f);
    REQUIRE(stored["items"].size() == 2);
    CHECK(stored["items"][0]["path"] == copy.string());
    CHECK(stored["items"][0]["position"] == later);

    // A never-saved document keeps its position in the session only.
    const json created = f.ws.call("doc.new");
    REQUIRE(created.contains("result"));
    const std::string new_id = created["result"]["docId"];
    const std::string unchanged = read_all(f.data / "positions.json");
    CHECK(f.ws.call("doc.position",
                    json{{"docId", new_id}, {"position", position}})["result"]["position"] ==
          position);
    CHECK(f.ws.call("doc.position", json{{"docId", new_id}})["result"]["position"] == position);
    CHECK(read_all(f.data / "positions.json") == unchanged);

    // A Source-only session loads no position and records none.
    const json source =
        f.ws.call("doc.openSource", json{{"path", f.book("malformed.fb2").string()}});
    REQUIRE(source.contains("result"));
    const std::string source_id = source["result"]["docId"];
    CHECK(f.ws.call("doc.position", json{{"docId", source_id}})["result"] == json::object());
    CHECK(f.ws.call("doc.position",
                    json{{"docId", source_id}, {"position", position}})["result"]["position"] ==
          position);
    CHECK(read_all(f.data / "positions.json") == unchanged);
    // doc.openSource of a file with a record: none either (a Source-only session takes no Body
    // caret).
    const json source_book = f.ws.call("doc.openSource", json{{"path", book.string()}});
    REQUIRE(source_book.contains("result"));
    CHECK(f.ws.call("doc.position", json{{"docId", source_book["result"]["docId"]}})["result"] ==
          json::object());
}

TEST_CASE(
    "doc.position: a legacy recent.json caret is converted once and dropped at the next write",
    "[server][doc][position]") {
    // Release 0.0.3 kept {view, nodeId, offset} in recent.json. Node ids are deterministic
    // in document order: in modern-utf8.fb2 "n21" is body[1]/section[1]/p[1] (the parity
    // fixture modern-utf8.paths.json).
    const std::string book = fixture_book_path("modern-utf8.fb2");
    const std::string nested = fixture_book_path("nested-sections.fb2");
    const std::string koi = fixture_book_path("koi8r.fb2");
    ServerFixture f([&](const std::filesystem::path& data_dir) {
        test::write_text(
            data_dir / "recent.json",
            json{{"schemaVersion", 1},
                 {"items",
                  json::array(
                      {json{{"path", book},
                            {"lastOpened", "2026-10-01T00:00:00Z"},
                            {"caret", json{{"view", "body"}, {"nodeId", "n21"}, {"offset", 3}}}},
                       json{{"path", nested},
                            {"lastOpened", "2026-10-01T00:00:00Z"},
                            {"caret", json{{"view", "body"}, {"nodeId", "n9999"}, {"offset", 3}}}},
                       json{{"path", koi},
                            {"lastOpened", "2026-10-01T00:00:00Z"},
                            {"caret", json{{"view", "source"}, {"line", 7}, {"column", 2}}}}})}}
                .dump(2));
    });
    // The MRU is read with its paths; the legacy carets are not answered.
    const json recent = f.ws.call("doc.recent")["result"];
    REQUIRE(recent.size() == 3);
    for (const json& item : recent) {
        CHECK_FALSE(item.contains("caret"));
    }
    CHECK(positions_on_disk(f).is_null());

    // A body caret whose node id exists in the freshly loaded document is converted through
    // node_path, recorded and used.
    const json opened = f.ws.call("doc.open", json{{"path", book}});
    REQUIRE(opened.contains("result"));
    const std::string doc_id = opened["result"]["document"]["docId"];
    const json converted{{"path", "body[1]/section[1]/p[1]"}, {"offset", 3}};
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == converted);
    json stored = positions_on_disk(f);
    REQUIRE(stored["items"].size() == 1);
    CHECK(stored["items"][0]["path"] == book);
    CHECK(stored["items"][0]["position"] == converted);
    // The MRU was written (the open touched it): no caret member is left in the file.
    for (const json& item : recent_on_disk(f)["items"]) {
        CHECK_FALSE(item.contains("caret"));
    }
    // Converted once: the record now rules. A new position, then a reopen: the record's value,
    // not the legacy caret's.
    const json moved{{"path", "body[1]/section[1]/p[2]"}, {"offset", 1}};
    REQUIRE(
        f.ws.call("doc.position", json{{"docId", doc_id}, {"position", moved}}).contains("result"));
    CHECK(f.ws.call("doc.close", json{{"docId", doc_id}})["result"] == json::object());
    const json reopened = f.ws.call("doc.open", json{{"path", book}});
    REQUIRE(reopened.contains("result"));
    CHECK(
        f.ws.call("doc.position",
                  json{{"docId", reopened["result"]["document"]["docId"]}})["result"]["position"] ==
        moved);

    // A node id the document does not have is ignored: nothing recorded, nothing restored.
    const json nested_open = f.ws.call("doc.open", json{{"path", nested}});
    REQUIRE(nested_open.contains("result"));
    CHECK(f.ws.call("doc.position",
                    json{{"docId", nested_open["result"]["document"]["docId"]}})["result"] ==
          json::object());
    CHECK(positions_on_disk(f)["items"].size() == 1);

    // A caret of another view is ignored as well.
    const json koi_open = f.ws.call("doc.open", json{{"path", koi}});
    REQUIRE(koi_open.contains("result"));
    CHECK(f.ws.call("doc.position",
                    json{{"docId", koi_open["result"]["document"]["docId"]}})["result"] ==
          json::object());
    CHECK(positions_on_disk(f)["items"].size() == 1);
}

TEST_CASE("doc.caret: the deprecated alias converts both ways through the session snapshot",
          "[server][doc][position]") {
    ServerFixture f;
    const std::filesystem::path book = f.data / "alias.fb2";
    std::filesystem::copy_file(f.book("modern-utf8.fb2"), book);
    const json opened = f.ws.call("doc.open", json{{"path", book.string()}});
    REQUIRE(opened.contains("result"));
    const std::string doc_id = opened["result"]["document"]["docId"];
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}})["result"] == json::object());

    // A body caret with a known node id is recorded as doc.position would record its path.
    const json caret{
        {"view", "body"}, {"nodeId", "n22"}, {"offset", 4}};  // body[1]/section[1]/p[2]
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}, {"caret", caret}})["result"]["caret"] ==
          caret);
    const json position{{"path", "body[1]/section[1]/p[2]"}, {"offset", 4}};
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == position);
    CHECK(positions_on_disk(f)["items"][0]["position"] == position);
    CHECK_FALSE(recent_on_disk(f)["items"][0].contains("caret"));

    // A position set through doc.position is answered by doc.caret as {view, nodeId, offset}.
    const json other{{"path", "body[1]/section[1]/p[1]"}, {"offset", 2}};
    REQUIRE(
        f.ws.call("doc.position", json{{"docId", doc_id}, {"position", other}}).contains("result"));
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}})["result"]["caret"] ==
          json{{"view", "body"}, {"nodeId", "n21"}, {"offset", 2}});

    // A caret of another view, or of an unknown node, stays in the session only: the record
    // keeps the last position, doc.caret answers the caret, doc.position the record.
    const std::string before = read_all(f.data / "positions.json");
    const json source_caret{
        {"view", "source"}, {"nodeId", ""}, {"offset", 0}, {"line", 7}, {"column", 3}};
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id},
                                      {"caret", source_caret}})["result"]["caret"] == source_caret);
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}})["result"]["caret"] == source_caret);
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == other);
    CHECK(read_all(f.data / "positions.json") == before);
    const json unknown{{"view", "body"}, {"nodeId", "ui_7"}, {"offset", 0}};
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}, {"caret", unknown}})["result"]["caret"] ==
          unknown);
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == other);
    CHECK(read_all(f.data / "positions.json") == before);
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}, {"caret", "nope"}})["error"]["code"] ==
          -32602);

    // A path the snapshot cannot resolve answers {} through the alias (the record is kept).
    const json beyond{{"path", "body[1]/section[1]/p[999]"}, {"offset", 0}};
    REQUIRE(f.ws.call("doc.position", json{{"docId", doc_id}, {"position", beyond}})
                .contains("result"));
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}})["result"] == json::object());
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == beyond);

    // The setting gates the alias too.
    REQUIRE(f.ws.call("settings.set",
                      json{{"patch", json{{"other", json{{"restorePosition", false}}}}}})
                .contains("result"));
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}, {"caret", caret}})["result"] ==
          json::object());
    CHECK(positions_on_disk(f)["items"][0]["position"] == beyond);
}

TEST_CASE("doc handlers: external change detection (doc.watch) is suppressed for our own saves",
          "[server][doc]") {
    ServerFixture f;
    const std::filesystem::path path = f.data / "watched.fb2";
    std::filesystem::copy_file(f.book("koi8r.fb2"), path);
    const json opened = f.ws.call("doc.open", json{{"path", path.string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    CHECK(f.ws.call("doc.watch", json{{"docId", doc_id}, {"enabled", true}})["result"] ==
          json::object());

    // Our own save must not trigger a notification.
    REQUIRE(f.run_job("doc.save", json{{"docId", doc_id}, {"document", doc}, {"force", true}})
                .contains("result"));
    CHECK_FALSE(f.ws.wait_notification("doc.changedOnDisk", 2600));

    // Another program rewrites the file: notification within the 2 s polling interval.
    std::this_thread::sleep_for(std::chrono::milliseconds(1100));  // distinct mtime second
    {
        std::ofstream out(path, std::ios::binary | std::ios::app);
        out << "\n<!-- touched by another application -->\n";
    }
    auto changed = f.ws.wait_notification("doc.changedOnDisk", 6000);
    REQUIRE(changed);
    CHECK((*changed)["params"]["docId"] == doc_id);
    CHECK((*changed)["params"]["path"] == path.string());
    CHECK((*changed)["params"]["mtime"].is_number_integer());
    // Reported once per change.
    CHECK_FALSE(f.ws.wait_notification("doc.changedOnDisk", 2600));
    CHECK(f.ws.call("doc.watch", json{{"docId", doc_id}, {"enabled", false}})["result"] ==
          json::object());
    CHECK(f.ws.call("doc.watch", json{{"docId", "d99"}, {"enabled", true}})["error"]["code"] ==
          1000);
}

TEST_CASE("binary handlers: /binary GET with ETag/304, POST upload, binary.list/remove/export",
          "[server][binary]") {
    ServerFixture f;
    const json opened = f.ws.call("doc.open", json{{"path", f.book("modern-utf8.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const std::string doc_id = opened["result"]["document"]["docId"];
    const std::string png = read_all(test::fixtures_dir() / "images" / "tiny.png");
    const std::string gif = read_all(test::fixtures_dir() / "images" / "tiny.gif");

    auto get = test::http_get(f.port(), "/binary/" + doc_id + "/cover.png?" + f.tok());
    REQUIRE(get.status == 200);
    CHECK(get.headers["content-type"] == "image/png");
    CHECK(get.body == png);
    const std::string etag = get.headers["etag"];
    REQUIRE_FALSE(etag.empty());
    CHECK(etag.front() == '"');
    auto cached = test::http_get(f.port(), "/binary/" + doc_id + "/cover.png?" + f.tok(),
                                 {{"If-None-Match", etag}});
    CHECK(cached.status == 304);
    CHECK(cached.body.empty());
    CHECK(test::http_get(f.port(), "/binary/" + doc_id + "/cover.png").status == 401);
    CHECK(test::http_get(f.port(), "/binary/" + doc_id + "/missing.png?" + f.tok()).status == 404);
    CHECK(test::http_get(f.port(), "/binary/d77/cover.png?" + f.tok()).status == 404);
    // Previews are decoded and re-encoded as JPEG/PNG (US7): the GIF becomes a JPEG.
    auto preview =
        test::http_get(f.port(), "/binary/" + doc_id + "/dot.gif/preview?w=100&" + f.tok());
    CHECK(preview.status == 200);
    CHECK(preview.headers["content-type"] == "image/jpeg");
    CHECK(preview.headers["x-mfbe-preview-width"] == "8");
    auto head = test::http_get(f.port(), "/binary/" + doc_id + "/cover.png?" + f.tok(), {}, "HEAD");
    CHECK(head.status == 200);
    CHECK(head.body.empty());
    CHECK(head.headers["content-length"] == std::to_string(png.size()));

    // Upload (paste/drop): default id img_<N>.<ext>, type from the header or sniffed.
    auto posted = test::http_request(f.port(), "POST", "/binary/" + doc_id + "?" + f.tok(),
                                     {{"Content-Type", "image/gif"}}, gif);
    REQUIRE(posted.status == 201);
    const json meta = json::parse(posted.body);
    CHECK(meta["id"] == "img_3.gif");
    CHECK(meta["contentType"] == "image/gif");
    CHECK(meta["size"] == static_cast<int>(gif.size()));
    CHECK(meta["width"] == 8);
    CHECK(meta["decodable"] == true);
    CHECK(meta["willConvert"] == true);
    CHECK(meta["referenceCount"] == 0);
    auto suggested = test::http_request(
        f.port(), "POST", "/binary/" + doc_id + "?" + f.tok(),
        {{"Content-Type", "application/octet-stream"}, {"X-MFBE-Suggested-Id", "cover.png"}}, png);
    REQUIRE(suggested.status == 201);
    CHECK(json::parse(suggested.body)["id"] == "cover_2.png");
    CHECK(json::parse(suggested.body)["contentType"] == "image/png");  // sniffed
    CHECK(test::http_request(f.port(), "POST", "/binary/d77?" + f.tok(),
                             {{"Content-Type", "image/gif"}}, gif)
              .status == 404);
    CHECK(test::http_request(f.port(), "POST", "/binary/" + doc_id, {{"Content-Type", "image/gif"}},
                             gif)
              .status == 401);
    CHECK(test::http_get(f.port(), "/binary/" + doc_id + "/img_3.gif?" + f.tok()).body == gif);

    const json list = f.ws.call("binary.list", json{{"docId", doc_id}});
    REQUIRE(list["result"].size() == 4);
    CHECK(list["result"][0]["id"] == "cover.png");
    CHECK(list["result"][0]["referenceCount"] == 3);
    CHECK(list["result"][2]["id"] == "img_3.gif");
    // Referenced binaries need force to be removed; the upload is unreferenced.
    CHECK(f.ws.call("binary.remove",
                    json{{"docId", doc_id}, {"id", "cover.png"}})["error"]["code"] == -32602);
    CHECK(f.ws.call("binary.remove", json{{"docId", doc_id}, {"id", "img_3.gif"}})["result"] ==
          json::object());
    CHECK(f.ws.call("binary.remove",
                    json{{"docId", doc_id}, {"id", "img_3.gif"}})["error"]["code"] == 1010);
    CHECK(f.ws.call("binary.remove",
                    json{{"docId", doc_id}, {"id", "dot.gif"}, {"force", true}})["result"] ==
          json::object());
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"].size() == 2);
    const std::string exported = (f.data / "exported.png").string();
    CHECK(f.ws.call("binary.export",
                    json{{"docId", doc_id}, {"id", "cover.png"}, {"path", exported}})["result"] ==
          json::object());
    CHECK(read_all(exported) == png);
    // binary.add from a path (US7): id from the file name, made unique.
    const json added = f.ws.call("binary.add", json{{"docId", doc_id}, {"path", exported}});
    REQUIRE(added.contains("result"));
    CHECK(added["result"]["id"] == "exported.png");
    CHECK(added["result"]["contentType"] == "image/png");
    CHECK(added["result"]["willConvert"] == false);
    CHECK(f.ws.call("binary.add", json{{"docId", doc_id}, {"path", exported}})["result"]["id"] ==
          "exported_2.png");
    CHECK(f.ws.call("binary.add",
                    json{{"docId", doc_id},
                         {"path", (f.data / "nope.png").string()}})["error"]["code"] == 1002);
}

TEST_CASE("doc handlers: doc.formatDate writes the regional long date and rejects bad values",
          "[server][doc][date]") {
    ServerFixture f;
    struct Restore {
        ~Restore() { platform::set_date_locale_for_tests(nullptr); }
    } restore;
    const auto format = [&f](const char* value) {
        return f.ws.call("doc.formatDate", json{{"value", value}});
    };

    // Without regional settings (the C locale) the text follows the interface language setting
    // (feature 003 FR-050), "system" resolved through the OS language.
    REQUIRE(platform::set_date_locale_for_tests("C"));
    REQUIRE(f.ws.call("settings.set", json{{"patch", {{"view", {{"uiLanguage", "uk"}}}}}})
                .contains("result"));
    CHECK(format("2026-10-17")["result"] == json{{"text", "17 жовтня 2026"}});
    CHECK(format("2026-10-07")["result"] == json{{"text", "7 жовтня 2026"}});
    CHECK(format("2024-02-29")["result"] == json{{"text", "29 лютого 2024"}});  // leap day
    REQUIRE(f.ws.call("settings.set", json{{"patch", {{"view", {{"uiLanguage", "ru"}}}}}})
                .contains("result"));
    CHECK(format("2026-10-17")["result"] == json{{"text", "17 октября 2026"}});
    REQUIRE(f.ws.call("settings.set", json{{"patch", {{"view", {{"uiLanguage", "en"}}}}}})
                .contains("result"));
    CHECK(format("2026-10-17")["result"] == json{{"text", "October 17, 2026"}});

    // The regional settings win over the interface language (FR-050: the user's date settings,
    // not the interface language).
#if defined(_WIN32)
    REQUIRE(platform::set_date_locale_for_tests("ru-RU"));
    CHECK(format("2026-10-17")["result"] == json{{"text", "17 октября 2026 г."}});
#elif defined(__APPLE__)
    REQUIRE(platform::set_date_locale_for_tests("ru_RU"));
    CHECK(format("2026-10-17")["result"] == json{{"text", "17 октября 2026 г."}});
#else
    if (!platform::set_date_locale_for_tests("ru_RU.UTF-8")) {
        SKIP("ru_RU.UTF-8 is not generated on this machine");
    }
    CHECK(format("2026-10-17")["result"] == json{{"text", "17 октября 2026"}});
#endif
    // The same function fills in the date of a new document (FR-051).
    const json created = f.ws.call("doc.new");
    REQUIRE(created.contains("result"));
    const model::DetailsContext now = model::details_context_now(false, "en");
    CHECK(created["result"]["description"]["documentInfo"]["date"]["text"] ==
          platform::format_long_date(now.year, now.month, now.day, "en"));

    // Anything but a calendar date in the schema's form is invalidParams naming the field.
    for (const char* bad :
         {"2026-02-30", "2026-13-01", "2023-02-29", "2026-00-10", "17.10.2026", "2026-10-7",
          "2026-1-07", "", "today", "20261017", "2026-10-17T00:00:00Z", " 2026-10-17"}) {
        INFO(bad);
        const json response = format(bad);
        REQUIRE(response.contains("error"));
        CHECK(response["error"]["code"] == -32602);
        CHECK(response["error"]["data"]["field"] == "value");
    }
    CHECK(f.ws.call("doc.formatDate", json::object())["error"]["code"] == -32602);
    CHECK(f.ws.call("doc.formatDate", json{{"value", 20261017}})["error"]["code"] == -32602);
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 004 US4: doc.readDescription, the import session and binary.copy (T036)            */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE(
    "doc.readDescription: the description as read, the details filled in, the referenced "
    "cover alone, ids from the target's allocator",
    "[server][doc][import]") {
    ServerFixture f;
    const json created = f.ws.call("doc.new");
    REQUIRE(created.contains("result"));
    const json target = created["result"];
    const std::string doc_id = target["docId"];
    std::vector<std::string> target_ids;
    collect_node_ids(target, target_ids);
    REQUIRE_FALSE(target_ids.empty());
    const long long target_max = max_id_number(target_ids);
    const json recent_before = f.ws.call("doc.recent")["result"];
    const json position{{"path", "body[1]/section[1]/p[1]"}, {"offset", 1}};
    REQUIRE(f.ws.call("doc.position", json{{"docId", doc_id}, {"position", position}})
                .contains("result"));

    // The library's edge-case fixture: a cover, eleven custom-info rows, document details to
    // fill in, no body.
    const json read =
        f.run_job("doc.readDescription",
                  json{{"docId", doc_id}, {"path", f.book("maxlib-roles-edge.fbd").string()}});
    REQUIRE(read.contains("result"));
    const json& result = read["result"];
    REQUIRE(result["importId"].is_string());
    const std::string import_id = result["importId"];
    CHECK(import_id != doc_id);
    CHECK_FALSE(result.contains("bodies"));
    CHECK_FALSE(result.contains("document"));
    CHECK(result["warnings"] == json::array());

    // `description` as read: the reader's normalisation only, nothing filled in.
    const json& description = result["description"];
    CHECK(description["titleInfo"]["bookTitle"] == "Проверочная книга (крайние случаи)");
    CHECK(description["titleInfo"]["coverpage"][0]["href"] == "#cover.jpg");
    CHECK(description["documentInfo"]["id"] == "");
    CHECK(description["documentInfo"]["version"] == "1.0");
    CHECK_FALSE(description["documentInfo"].contains("programUsed"));
    CHECK(description["documentInfo"]["date"]["text"] == "");
    CHECK_FALSE(description["documentInfo"]["date"].contains("value"));
    REQUIRE(description["customInfo"].size() == 11);
    CHECK(description["customInfo"][0]["infoType"] == "mlillustrator");
    CHECK(description["customInfo"][0]["text"] == "Однофамильцев");
    CHECK(description["customInfo"][9]["text"] == "  Пробелов Пётр Петрович ");
    CHECK(description["customInfo"][10]["infoType"] == "MlEditor");

    // `documentDetails`: the document-info after the fill-in of 002 FR-005, as Open would
    // have produced it.
    const json& details = result["documentDetails"];
    const std::string id = details["id"];
    CHECK(uuid::is_valid(id));
    CHECK(id.find_first_of("abcdef") == std::string::npos);
    CHECK(details["version"] == "1.0");
    const std::string program = std::string(version::kProductName) + " " + version::kVersion;
    CHECK(details["programUsed"] == program);
    CHECK(details["date"]["value"].get<std::string>().size() == 10);
    CHECK_FALSE(details["date"]["text"].get<std::string>().empty());

    // `binaries`: the referenced cover only, held by the hidden session.
    REQUIRE(result["binaries"].size() == 1);
    CHECK(result["binaries"][0]["id"] == "cover.jpg");
    CHECK(result["binaries"][0]["contentType"] == "image/jpeg");
    const json listed = f.ws.call("binary.list", json{{"docId", import_id}});
    REQUIRE(listed["result"].size() == 1);
    CHECK(listed["result"][0]["id"] == "cover.jpg");
    // The side channel serves the dialog's cover picture from the import session.
    auto preview =
        test::http_get(f.port(), "/binary/" + import_id + "/cover.jpg/preview?w=64&" + f.tok());
    CHECK(preview.status == 200);
    CHECK(preview.headers["content-type"] == "image/jpeg");
    CHECK_FALSE(preview.body.empty());

    // The open session is untouched: Recent Files, the remembered position, the binary store.
    CHECK(f.ws.call("doc.recent")["result"] == recent_before);
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == position);
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"] == target["binaries"]);
    CHECK(f.ws.call("test.metrics")["result"]["openDocuments"] == 2);

    // Node ids of the imported annotation, history and source annotation come from the
    // target's allocator: above every id of the open document, distinct, and advancing.
    const json full =
        f.run_job("doc.readDescription",
                  json{{"docId", doc_id}, {"path", f.book("import-full.fbd").string()}});
    REQUIRE(full.contains("result"));
    std::vector<std::string> imported_ids;
    collect_node_ids(full["result"]["description"], imported_ids);
    REQUIRE(imported_ids.size() >= 7);  // annotation + 2 p, history + 2 p, src annotation + p
    const std::set<std::string> distinct(imported_ids.begin(), imported_ids.end());
    CHECK(distinct.size() == imported_ids.size());
    for (const auto& node_id : imported_ids) {
        INFO(node_id);
        CHECK(id_number(node_id) > target_max);
    }
    const json again =
        f.run_job("doc.readDescription",
                  json{{"docId", doc_id}, {"path", f.book("import-full.fbd").string()}});
    std::vector<std::string> second_ids;
    collect_node_ids(again["result"]["description"], second_ids);
    CHECK(max_id_number(second_ids) > max_id_number(imported_ids));
    CHECK(full["result"]["description"]["documentInfo"]["programUsed"] == "Maxima FBD Maker");
    CHECK(full["result"]["documentDetails"]["programUsed"] == "Maxima FBD Maker, " + program);
    CHECK(full["result"]["documentDetails"]["id"] == "import-full-0001");
    REQUIRE(full["result"]["binaries"].size() == 1);
    CHECK(full["result"]["binaries"][0]["id"] == "cover.jpg");

    // doc.close frees the import session and its previews; the open document stays.
    CHECK(f.ws.call("doc.close", json{{"docId", import_id}})["result"] == json::object());
    CHECK(f.ws.call("binary.list", json{{"docId", import_id}})["error"]["code"] == 1000);
    CHECK(test::http_get(f.port(), "/binary/" + import_id + "/cover.jpg/preview?w=64&" + f.tok())
              .status == 404);
    CHECK(f.ws.call("doc.close", json{{"docId", import_id}})["error"]["code"] == 1000);
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"] == target["binaries"]);
    for (const json& r : {full, again}) {
        CHECK(f.ws.call("doc.close", json{{"docId", r["result"]["importId"]}})["result"] ==
              json::object());
    }
    CHECK(f.ws.call("test.metrics")["result"]["openDocuments"] == 1);
}

TEST_CASE(
    "doc.readDescription: every encoding Open accepts, a body-less file, and only the "
    "binaries an importable entry refers to",
    "[server][doc][import]") {
    ServerFixture f;
    const std::string doc_id = f.ws.call("doc.new")["result"]["docId"];

    // A windows-1251 book reads correctly; its cover is referenced by the cover page.
    const json legacy =
        f.run_job("doc.readDescription",
                  json{{"docId", doc_id}, {"path", f.book("legacy-cp1251.fb2").string()}});
    REQUIRE(legacy.contains("result"));
    CHECK(legacy["result"]["description"]["titleInfo"]["bookTitle"] == "Старая книга");
    REQUIRE(legacy["result"]["binaries"].size() == 1);
    CHECK(legacy["result"]["binaries"][0]["id"] == "cover.jpg");
    CHECK(f.ws.call("doc.close", json{{"docId", legacy["result"]["importId"]}}).contains("result"));

    // A descriptor without a body imports like any other file.
    const json descriptor =
        f.run_job("doc.readDescription",
                  json{{"docId", doc_id}, {"path", f.book("descriptor.fbd").string()}});
    REQUIRE(descriptor.contains("result"));
    CHECK(descriptor["result"]["description"]["titleInfo"]["bookTitle"] == "Только описание");
    CHECK(descriptor["result"]["description"]["titleInfo"]["annotation"]["type"] == "annotation");
    CHECK(descriptor["result"]["description"]["publishInfo"]["bookName"] == "Бумажное издание");
    CHECK(descriptor["result"]["binaries"] == json::array());
    CHECK(f.ws.call("doc.close", json{{"docId", descriptor["result"]["importId"]}})
              .contains("result"));

    // Binaries: the cover page and the images inside the annotation and the history are kept
    // in file order; a binary referenced only by the body, by nothing, or only by an `output`
    // element (no importable entry) is dropped.
    const std::string png = base64::encode(read_all(test::fixtures_dir() / "images" / "tiny.png"));
    const std::string gif = base64::encode(read_all(test::fixtures_dir() / "images" / "tiny.gif"));
    const std::string jpg = base64::encode(read_all(test::fixtures_dir() / "images" / "tiny.jpg"));
    const std::filesystem::path source = f.data / "binaries.fb2";
    test::write_text(
        source,
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">\n<description><title-info><genre>sf</genre>"
        "<author><nickname>bins</nickname></author><book-title>Binaries</book-title>"
        "<annotation><p>Inline <image l:href=\"#inline.gif\"/> picture.</p></annotation>"
        "<coverpage><image l:href=\"#cover.png\"/></coverpage><lang>en</lang></title-info>"
        "<document-info><author><nickname>bins</nickname></author><date>2026</date>"
        "<id>bins</id><version>1.0</version>"
        "<history><p>History <image l:href=\"#history.jpg\"/> picture.</p></history>"
        "</document-info>"
        "<output mode=\"free\" include-all=\"require\">"
        "<part l:href=\"#output-only.png\" include=\"require\"/></output>"
        "</description>\n<body><section><image l:href=\"#body-only.png\"/><p>Text</p></section>"
        "</body>\n"
        "<binary id=\"body-only.png\" content-type=\"image/png\">" +
            png +
            "</binary>\n"
            "<binary id=\"cover.png\" content-type=\"image/png\">" +
            png +
            "</binary>\n"
            "<binary id=\"unused.png\" content-type=\"image/png\">" +
            png +
            "</binary>\n"
            "<binary id=\"inline.gif\" content-type=\"image/gif\">" +
            gif +
            "</binary>\n"
            "<binary id=\"output-only.png\" content-type=\"image/png\">" +
            png +
            "</binary>\n"
            "<binary id=\"history.jpg\" content-type=\"image/jpeg\">" +
            jpg + "</binary>\n</FictionBook>\n");
    const json read =
        f.run_job("doc.readDescription", json{{"docId", doc_id}, {"path", source.string()}});
    REQUIRE(read.contains("result"));
    std::vector<std::string> kept;
    for (const auto& meta : read["result"]["binaries"]) {
        kept.push_back(meta["id"].get<std::string>());
    }
    CHECK(kept == std::vector<std::string>{"cover.png", "inline.gif", "history.jpg"});
    const std::string import_id = read["result"]["importId"];
    const json list = f.ws.call("binary.list", json{{"docId", import_id}});
    std::vector<std::string> listed;
    for (const auto& meta : list["result"]) {
        listed.push_back(meta["id"].get<std::string>());
    }
    CHECK(listed == kept);
    CHECK(test::http_get(f.port(), "/binary/" + import_id + "/unused.png?" + f.tok()).status ==
          404);
    CHECK(test::http_get(f.port(), "/binary/" + import_id + "/cover.png?" + f.tok()).status == 200);
    // The outputs stay in the description as read; they are no importable entry.
    CHECK(read["result"]["description"]["outputs"].size() == 1);
    CHECK(f.ws.call("doc.close", json{{"docId", import_id}})["result"] == json::object());
}

TEST_CASE(
    "doc.readDescription: errors are Open's, the open document is untouched and no "
    "session is left behind",
    "[server][doc][import]") {
    ServerFixture f;
    const json created = f.ws.call("doc.new");
    const json target = created["result"];
    const std::string doc_id = target["docId"];
    // A saved file remembered by Recent Files, then removed from disk.
    const std::string gone = (f.data / "gone.fb2").string();
    REQUIRE(
        f.run_job("doc.save",
                  json{{"docId", doc_id}, {"document", target}, {"path", gone}, {"force", true}})
            .contains("result"));
    REQUIRE(f.ws.call("doc.recent")["result"].size() == 1);
    std::filesystem::remove(gone);

    const json missing = f.ws.call("doc.readDescription", json{{"docId", doc_id}, {"path", gone}});
    REQUIRE(missing.contains("error"));
    CHECK(missing["error"]["code"] == 1002);
    CHECK(missing["error"]["data"]["path"] == gone);
    CHECK(missing["error"]["data"]["reason"] == "file not found");
    // Unlike doc.open, a missing source does not prune Recent Files.
    REQUIRE(f.ws.call("doc.recent")["result"].size() == 1);
    CHECK(f.ws.call("doc.recent")["result"][0]["path"] == gone);
    CHECK(f.ws.call("doc.recent")["result"][0]["exists"] == false);

    const json malformed = f.ws.call(
        "doc.readDescription", json{{"docId", doc_id}, {"path", f.book("malformed.fb2").string()}});
    REQUIRE(malformed.contains("error"));
    CHECK(malformed["error"]["code"] == 1001);
    CHECK(malformed["error"]["data"]["line"] == 20);
    CHECK(malformed["error"]["data"]["column"] == 13);
    CHECK_THAT(malformed["error"]["data"]["message"].get<std::string>(),
               ContainsSubstring("mismatch"));

    const std::string html = (f.data / "page.xml").string();
    test::write_text(html, "<?xml version=\"1.0\"?><html><body>FictionBook</body></html>");
    const json other = f.ws.call("doc.readDescription", json{{"docId", doc_id}, {"path", html}});
    REQUIRE(other.contains("error"));
    CHECK(other["error"]["code"] == 1004);
    CHECK(other["error"]["data"]["reason"] == "rootNotFictionBook");
    const std::string notes = (f.data / "notes.txt").string();
    test::write_text(notes, "Just a text file.\n");
    CHECK(f.ws.call("doc.readDescription",
                    json{{"docId", doc_id}, {"path", notes}})["error"]["code"] == 1004);

    CHECK(f.ws.call("doc.readDescription",
                    json{{"docId", "d99"},
                         {"path", f.book("descriptor.fbd").string()}})["error"]["code"] == 1000);
    const json no_path = f.ws.call("doc.readDescription", json{{"docId", doc_id}});
    REQUIRE(no_path.contains("error"));
    CHECK(no_path["error"]["code"] == -32602);

    // Nothing was imported into and no import session lingers.
    CHECK(f.ws.call("test.metrics")["result"]["openDocuments"] == 1);
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"] == target["binaries"]);
}

TEST_CASE(
    "doc.readDescription: a big source is read as a job with Open's phases; a cancelled "
    "job leaves no session",
    "[server][doc][import][job]") {
    ServerFixture f;
    const std::string doc_id = f.ws.call("doc.new")["result"]["docId"];
    const std::filesystem::path big_path = f.data / "big-source.fb2";
    write_big_book(big_path, 40);
    REQUIRE(std::filesystem::file_size(big_path) > 2 * 1024 * 1024);

    const json start =
        f.ws.call("doc.readDescription", json{{"docId", doc_id}, {"path", big_path.string()}});
    REQUIRE(start.contains("result"));
    REQUIRE(start["result"].contains("jobId"));
    const JobOutcome done = collect_job(f.ws, start["result"]["jobId"]);
    REQUIRE(done.final.is_object());
    REQUIRE(done.final["method"] == "job.done");
    CHECK(std::find(done.phases.begin(), done.phases.end(), "read") != done.phases.end());
    CHECK(std::find(done.phases.begin(), done.phases.end(), "model") != done.phases.end());
    CHECK(std::find(done.phases.begin(), done.phases.end(), "done") != done.phases.end());
    const json& result = done.final["params"]["result"];
    CHECK(result["description"]["titleInfo"]["bookTitle"] == "Big");
    CHECK(result["binaries"] == json::array());
    CHECK_FALSE(result.contains("bodies"));
    CHECK(f.ws.call("doc.close", json{{"docId", result["importId"]}})["result"] == json::object());

    // Cancelled while the file is being read: job.failed 1090 and no import session.
    const json second =
        f.ws.call("doc.readDescription", json{{"docId", doc_id}, {"path", big_path.string()}});
    REQUIRE(second["result"].contains("jobId"));
    const std::string job_id = second["result"]["jobId"];
    CHECK(f.ws.call("job.cancel", json{{"jobId", job_id}})["result"] == json::object());
    const JobOutcome cancelled = collect_job(f.ws, job_id);
    REQUIRE(cancelled.final.is_object());
    CHECK(cancelled.final["method"] == "job.failed");
    CHECK(cancelled.final["params"]["error"]["code"] == 1090);
    CHECK(f.ws.call("test.metrics")["result"]["openDocuments"] == 1);
    CHECK(f.ws.call("job.cancel", json{{"jobId", job_id}})["result"] == json::object());
}

TEST_CASE(
    "doc.readDescription: the 10 MB book costs no more peak memory than Open and keeps "
    "no binary of it",
    "[server][doc][import][memory]") {
    if (platform::peak_resident_memory_bytes() == 0) {
        SKIP("the peak resident set size is not available on this platform");
    }
    const std::filesystem::path book = large_book_10mb();
    if (book.empty()) {
        SKIP("python3 or tests/fixtures/gen-large-book.py is not available");
    }
    ServerFixture f;
    const std::string doc_id = f.ws.call("doc.new")["result"]["docId"];

    // Open's growth first: the import is measured afterwards, so without a peak reset the
    // comparison is against a mark Open already raised (never against a lower one).
    const bool reset = test::reset_peak_resident_memory();
    const std::size_t before_open = platform::peak_resident_memory_bytes();
    const json opened = f.run_job("doc.open", json{{"path", book.string()}});
    REQUIRE(opened.contains("result"));
    const std::size_t after_open = platform::peak_resident_memory_bytes();
    REQUIRE(after_open >= before_open);
    const std::size_t open_growth = after_open - before_open;
    CHECK(f.ws.call("doc.close", json{{"docId", opened["result"]["document"]["docId"]}})
              .contains("result"));

    if (reset) {
        REQUIRE(test::reset_peak_resident_memory());
    }
    const std::size_t before_read = platform::peak_resident_memory_bytes();
    const json read =
        f.run_job("doc.readDescription", json{{"docId", doc_id}, {"path", book.string()}});
    REQUIRE(read.contains("result"));
    const std::size_t after_read = platform::peak_resident_memory_bytes();
    REQUIRE(after_read >= before_read);
    const std::size_t read_growth = after_read - before_read;
    INFO("open grew the peak by " << open_growth << " bytes, the import by " << read_growth
                                  << (reset ? " (peak reset between them)" : ""));
    CHECK(read_growth <= open_growth);
    const std::string import_id = read["result"]["importId"];
    CHECK(read["result"]["binaries"] == json::array());
    CHECK(f.ws.call("binary.list", json{{"docId", import_id}})["result"] == json::array());
    CHECK(f.ws.call("doc.close", json{{"docId", import_id}})["result"] == json::object());
}

TEST_CASE(
    "binary.copy: bytes cross between sessions inside the core, identical content is not "
    "added twice, a colliding id is renamed",
    "[server][binary][import]") {
    ServerFixture f;
    const json opened = f.ws.call("doc.open", json{{"path", f.book("modern-utf8.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const std::string doc_id = opened["result"]["document"]["docId"];
    const json before = f.ws.call("binary.list", json{{"docId", doc_id}})["result"];
    REQUIRE(before.size() == 2);  // cover.png, dot.gif

    // A source whose cover.png has other bytes than the document's, whose second binary
    // equals the document's cover byte for byte and whose third is new content again.
    const std::string png = read_all(test::fixtures_dir() / "images" / "tiny.png");
    const std::string alpha = read_all(test::fixtures_dir() / "images" / "alpha.png");
    const std::string opaque = read_all(test::fixtures_dir() / "images" / "opaque-rgb.png");
    REQUIRE(png != alpha);
    REQUIRE(opaque != alpha);
    const std::filesystem::path source = f.data / "copy-source.fb2";
    test::write_text(
        source,
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">\n<description><title-info><genre>sf</genre>"
        "<author><nickname>copy</nickname></author><book-title>Copy</book-title>"
        "<annotation><p>Third <image l:href=\"#third.png\"/> picture.</p></annotation>"
        "<coverpage><image l:href=\"#cover.png\"/></coverpage><lang>en</lang></title-info>"
        "<src-title-info><genre>sf</genre><author><nickname>copy</nickname></author>"
        "<book-title>Copy</book-title><coverpage><image l:href=\"#same.png\"/></coverpage>"
        "<lang>en</lang></src-title-info>"
        "<document-info><author><nickname>copy</nickname></author><date>2026</date>"
        "<id>copy</id><version>1.0</version></document-info></description>\n"
        "<binary id=\"cover.png\" content-type=\"image/png\">" +
            base64::encode(alpha) +
            "</binary>\n"
            "<binary id=\"same.png\" content-type=\"image/png\">" +
            base64::encode(png) +
            "</binary>\n"
            "<binary id=\"third.png\" content-type=\"image/png\">" +
            base64::encode(opaque) + "</binary>\n</FictionBook>\n");
    const json read =
        f.run_job("doc.readDescription", json{{"docId", doc_id}, {"path", source.string()}});
    REQUIRE(read.contains("result"));
    const std::string import_id = read["result"]["importId"];
    REQUIRE(read["result"]["binaries"].size() == 3);

    // Identical content: the document's own binary is answered, nothing is added.
    const json same = f.ws.call(
        "binary.copy", json{{"docId", doc_id}, {"fromDocId", import_id}, {"id", "same.png"}});
    REQUIRE(same.contains("result"));
    CHECK(same["result"]["existing"] == true);
    CHECK(same["result"]["id"] == "cover.png");
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"].size() == 2);

    // Other content under a taken id: stored under the next free name, unreferenced.
    const json renamed = f.ws.call(
        "binary.copy", json{{"docId", doc_id}, {"fromDocId", import_id}, {"id", "cover.png"}});
    REQUIRE(renamed.contains("result"));
    CHECK(renamed["result"]["existing"] == false);
    CHECK(renamed["result"]["id"] == "cover_2.png");
    CHECK(renamed["result"]["contentType"] == "image/png");
    CHECK(renamed["result"]["size"] == static_cast<int>(alpha.size()));
    CHECK(renamed["result"]["referenceCount"] == 0);
    const json after = f.ws.call("binary.list", json{{"docId", doc_id}})["result"];
    REQUIRE(after.size() == 3);
    CHECK(after[2]["id"] == "cover_2.png");
    CHECK(test::http_get(f.port(), "/binary/" + doc_id + "/cover_2.png?" + f.tok()).body == alpha);
    // The source session keeps its bytes (the dialog may still show them).
    CHECK(f.ws.call("binary.list", json{{"docId", import_id}})["result"].size() == 3);
    // Copied again, the same content is found in the document now.
    const json twice = f.ws.call(
        "binary.copy", json{{"docId", doc_id}, {"fromDocId", import_id}, {"id", "cover.png"}});
    CHECK(twice["result"]["existing"] == true);
    CHECK(twice["result"]["id"] == "cover_2.png");
    // A suggested id is honoured (made unique the same way).
    const json suggested = f.ws.call("binary.copy", json{{"docId", doc_id},
                                                         {"fromDocId", import_id},
                                                         {"id", "third.png"},
                                                         {"suggestedId", "dot.gif"}});
    REQUIRE(suggested.contains("result"));
    CHECK(suggested["result"]["existing"] == false);
    CHECK(suggested["result"]["id"] == "dot_2.gif");
    CHECK(suggested["result"]["size"] == static_cast<int>(opaque.size()));

    // Errors.
    CHECK(f.ws.call("binary.copy", json{{"docId", doc_id},
                                        {"fromDocId", import_id},
                                        {"id", "nope.png"}})["error"]["code"] == 1010);
    CHECK(f.ws.call("binary.copy", json{{"docId", doc_id},
                                        {"fromDocId", "d77"},
                                        {"id", "cover.png"}})["error"]["code"] == 1000);
    CHECK(f.ws.call("binary.copy", json{{"docId", "d77"},
                                        {"fromDocId", import_id},
                                        {"id", "cover.png"}})["error"]["code"] == 1000);
    CHECK(f.ws.call("binary.copy", json{{"docId", doc_id},
                                        {"fromDocId", import_id},
                                        {"id", ""}})["error"]["code"] == -32602);
    CHECK(f.ws.call("binary.copy",
                    json{{"docId", doc_id}, {"fromDocId", import_id}})["error"]["code"] == -32602);
    CHECK(f.ws.call("doc.close", json{{"docId", import_id}})["result"] == json::object());
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 004 US5: doc.exportDescription, the FBD export (T044)                              */
/* ----------------------------------------------------------------------------------------- */

namespace {

// A book with everything the export must keep or drop (spec FR-041): a stylesheet; a complete
// description whose cover is a GIF (converted in the written copy only), whose annotation and
// history carry inline images and whose `output` element refers to a binary of its own; two
// custom-info rows; a body with text and an image; binaries referenced only by the body or by
// nothing at all.
std::string export_source_text() {
    const std::string png = base64::encode(read_all(test::fixtures_dir() / "images" / "tiny.png"));
    const std::string gif = base64::encode(read_all(test::fixtures_dir() / "images" / "tiny.gif"));
    const std::string jpg = base64::encode(read_all(test::fixtures_dir() / "images" / "tiny.jpg"));
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
           "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
           "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
           "<stylesheet type=\"text/css\">p { text-indent: 1em; }</stylesheet>\n"
           "<description><title-info><genre>sf</genre>"
           "<author><first-name>Анна</first-name><last-name>Иванова</last-name></author>"
           "<book-title>Экспорт описания</book-title>"
           "<annotation><p>Inline <image l:href=\"#inline.png\"/> picture.</p></annotation>"
           "<coverpage><image l:href=\"#cover.gif\"/></coverpage><lang>ru</lang></title-info>"
           "<document-info><author><nickname>maker</nickname></author>"
           "<program-used>Maxima FBD Maker</program-used>"
           "<date value=\"2026-10-20\">2026-10-20</date><id>export-0001</id><version>1.0</version>"
           "<history><p>History <image l:href=\"#history.jpg\"/> picture.</p></history>"
           "</document-info>"
           "<custom-info info-type=\"mleditor\">Редакторов Роман Романович</custom-info>"
           "<custom-info info-type=\"mleditorid\">4712 Редакторов Роман Романович</custom-info>"
           "<output mode=\"free\" include-all=\"require\">"
           "<part l:href=\"#output-only.png\" include=\"require\"/></output>"
           "</description>\n"
           "<body><title><p>Экспорт описания</p></title><section>"
           "<image l:href=\"#body-only.png\"/><p>Текст книги, которому в описании не место.</p>"
           "</section></body>\n"
           "<binary id=\"body-only.png\" content-type=\"image/png\">" +
           png +
           "</binary>\n"
           "<binary id=\"cover.gif\" content-type=\"image/gif\">" +
           gif +
           "</binary>\n"
           "<binary id=\"unused.png\" content-type=\"image/png\">" +
           png +
           "</binary>\n"
           "<binary id=\"inline.png\" content-type=\"image/png\">" +
           png +
           "</binary>\n"
           "<binary id=\"output-only.png\" content-type=\"image/png\">" +
           png +
           "</binary>\n"
           "<binary id=\"history.jpg\" content-type=\"image/jpeg\">" +
           jpg + "</binary>\n</FictionBook>\n";
}

std::size_t count_of(const std::string& text, const std::string& needle) {
    std::size_t count = 0;
    for (std::size_t pos = text.find(needle); pos != std::string::npos;
         pos = text.find(needle, pos + needle.size())) {
        ++count;
    }
    return count;
}

// The ids of a binary.list answer (or of a document's `binaries`), in order.
std::vector<std::string> ids_of(const json& metas) {
    std::vector<std::string> out;
    for (const auto& meta : metas) {
        out.push_back(meta["id"].get<std::string>());
    }
    return out;
}

// A validation report without its timing, for comparisons.
json timeless(json report) {
    report.erase("durationMs");
    return report;
}

}  // namespace

TEST_CASE(
    "doc.exportDescription: the description with the images it refers to and one empty "
    "section, UTF-8 and nothing else; the open document and its session untouched",
    "[server][doc][export]") {
    ServerFixture f;
    const std::filesystem::path source = f.data / "export-source.fb2";
    test::write_text(source, export_source_text());
    const std::string source_bytes = read_all(source);
    const json opened = f.ws.call("doc.open", json{{"path", source.string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    REQUIRE(doc["stylesheets"].size() == 1);
    REQUIRE(doc["description"]["outputs"].size() == 1);

    // An unreferenced JPEG added to the session, as Add Binary Object would.
    const json added = f.ws.call(
        "binary.add",
        json{{"docId", doc_id}, {"path", (test::fixtures_dir() / "images" / "tiny.jpg").string()}});
    REQUIRE(added.contains("result"));
    CHECK(added["result"]["id"] == "tiny.jpg");
    const json store_before = f.ws.call("binary.list", json{{"docId", doc_id}})["result"];
    REQUIRE(ids_of(store_before) ==
            std::vector<std::string>{"body-only.png", "cover.gif", "unused.png", "inline.png",
                                     "output-only.png", "history.jpg", "tiny.jpg"});
    CHECK(store_before[1]["contentType"] == "image/gif");
    CHECK(store_before[1]["willConvert"] == true);
    const json position{{"path", "body[1]/section[1]/p[1]"}, {"offset", 0}};
    REQUIRE(f.ws.call("doc.position", json{{"docId", doc_id}, {"position", position}})
                .contains("result"));
    const json recent_before = f.ws.call("doc.recent")["result"];
    REQUIRE(recent_before.size() == 1);
    const std::string positions_before = read_all(f.data / "positions.json");
    const json snapshot_before = f.run_job("doc.validate", json{{"docId", doc_id}})["result"];
    const int sessions = f.ws.call("test.metrics")["result"]["openDocuments"];

    const std::string out = (f.data / "exported.fbd").string();
    const json exported = f.run_job("doc.exportDescription",
                                    json{{"docId", doc_id}, {"document", doc}, {"path", out}});
    REQUIRE(exported.contains("result"));
    const json& result = exported["result"];
    CHECK_FALSE(result.contains("needsConfirmation"));
    CHECK(result["path"] == out);
    CHECK(result["validation"]["errorCount"] == 0);
    // The GIF cover is converted in the written copy and reported as Save reports it.
    REQUIRE(result["converted"].size() == 1);
    CHECK(result["converted"][0]["id"] == "cover.gif");
    CHECK(result["converted"][0]["from"] == "image/gif");
    const std::string converted_to = result["converted"][0]["to"];
    CHECK((converted_to == "image/jpeg" || converted_to == "image/png"));

    // The written file: UTF-8, the description verbatim, one empty section, the four
    // referenced binaries (the cover converted), no stylesheet, no body text, no other image.
    REQUIRE(std::filesystem::exists(out));
    const std::string written = read_all(out);
    CHECK(written.rfind("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<FictionBook "
                        "xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
                        "xmlns:l=\"http://www.w3.org/1999/xlink\">\n",
                        0) == 0);
    CHECK_FALSE(fb2::check_well_formed(written).has_value());
    CHECK_THAT(written, ContainsSubstring("<book-title>Экспорт описания</book-title>"));
    CHECK_THAT(written,
               ContainsSubstring("<p>Inline <image l:href=\"#inline.png\"/> picture.</p>"));
    CHECK_THAT(written,
               ContainsSubstring("<p>History <image l:href=\"#history.jpg\"/> picture.</p>"));
    // The description as it is in the editor: the details filled in at open (002 FR-005) count.
    CHECK_THAT(written, ContainsSubstring("<program-used>Maxima FBD Maker, " +
                                          std::string(version::kProductName) + " "));
    CHECK_THAT(written, ContainsSubstring("<custom-info info-type=\"mleditor\">Редакторов Роман "
                                          "Романович</custom-info>"));
    CHECK_THAT(written, ContainsSubstring("<custom-info info-type=\"mleditorid\">4712 Редакторов "
                                          "Роман Романович</custom-info>"));
    CHECK_THAT(written, ContainsSubstring("<output mode=\"free\" include-all=\"require\">"));
    CHECK_THAT(written,
               ContainsSubstring("<part l:href=\"#output-only.png\" include=\"require\"/>"));
    CHECK_THAT(written, ContainsSubstring("\t<body>\n\t\t<section/>\n\t</body>\n"));
    CHECK(count_of(written, "<body") == 1);
    CHECK(count_of(written, "<section") == 1);
    CHECK(count_of(written, "<p>") == 2);  // the annotation's and the history's
    CHECK_THAT(written, !ContainsSubstring("<stylesheet"));
    CHECK_THAT(written, !ContainsSubstring("Текст книги"));
    CHECK_THAT(written, !ContainsSubstring("<title>"));
    CHECK_THAT(written, !ContainsSubstring("body-only.png"));
    CHECK_THAT(written, !ContainsSubstring("unused.png"));
    CHECK_THAT(written, !ContainsSubstring("tiny.jpg"));
    CHECK(count_of(written, "<binary ") == 4);
    CHECK_THAT(written, ContainsSubstring("<binary id=\"cover.gif\" content-type=\"" +
                                          converted_to + "\">"));
    CHECK_THAT(written, !ContainsSubstring("content-type=\"image/gif\""));
    CHECK_THAT(written, ContainsSubstring("<binary id=\"inline.png\" content-type=\"image/png\">"));
    CHECK_THAT(written,
               ContainsSubstring("<binary id=\"output-only.png\" content-type=\"image/png\">"));
    CHECK_THAT(written,
               ContainsSubstring("<binary id=\"history.jpg\" content-type=\"image/jpeg\">"));
    // In store order.
    CHECK(written.find("<binary id=\"cover.gif\"") < written.find("<binary id=\"inline.png\""));
    CHECK(written.find("<binary id=\"inline.png\"") <
          written.find("<binary id=\"output-only.png\""));
    CHECK(written.find("<binary id=\"output-only.png\"") <
          written.find("<binary id=\"history.jpg\""));
    // The written text passes the FB2 2.1 validation (SC-005): the schema and the consistency
    // checks on the text itself.
    const json text_report = f.run_job("doc.validate", json{{"docId", doc_id}, {"text", written}});
    REQUIRE(text_report.contains("result"));
    CHECK(text_report["result"]["errorCount"] == 0);

    // The open document and its session are untouched: the file on disk, the binary store
    // (the GIF still a GIF), Recent Files (the exported file is not listed), the remembered
    // position and its record, the snapshot the core holds, the number of sessions.
    CHECK(read_all(source) == source_bytes);
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"] == store_before);
    CHECK(f.ws.call("doc.recent")["result"] == recent_before);
    CHECK(f.ws.call("doc.position", json{{"docId", doc_id}})["result"]["position"] == position);
    CHECK(read_all(f.data / "positions.json") == positions_before);
    CHECK(timeless(f.run_job("doc.validate", json{{"docId", doc_id}})["result"]) ==
          timeless(snapshot_before));
    CHECK(f.ws.call("test.metrics")["result"]["openDocuments"] == sessions);
    // The session's path, kind and encoding (echoed by doc.fromXml) are the opened file's.
    const json xml = f.ws.call("doc.toXml", json{{"docId", doc_id}, {"document", doc}});
    REQUIRE(xml.contains("result"));
    const json back =
        f.ws.call("doc.fromXml", json{{"docId", doc_id}, {"text", xml["result"]["text"]}});
    REQUIRE(back.contains("result"));
    CHECK(std::filesystem::path(back["result"]["document"]["path"].get<std::string>())
              .lexically_normal() == source.lexically_normal());
    CHECK(back["result"]["document"]["fileKind"] == "fb2");
    CHECK(back["result"]["document"]["sourceEncoding"] == "utf-8");

    // The exported file opens as a description with one empty section and the four binaries;
    // its description is the book's (FR-044 at the core level).
    const json reopened = f.ws.call("doc.open", json{{"path", out}});
    REQUIRE(reopened.contains("result"));
    const json& copy = reopened["result"]["document"];
    CHECK(copy["fileKind"] == "fbd");
    CHECK(copy["sourceEncoding"] == "utf-8");
    CHECK(copy["stylesheets"] == json::array());
    CHECK(copy["extras"] == json::array());
    REQUIRE(copy["bodies"].size() == 1);
    REQUIRE(copy["bodies"][0]["content"].size() == 1);
    CHECK(copy["bodies"][0]["content"][0]["type"] == "section");
    CHECK(copy["bodies"][0]["content"][0].value("content", json::array()) == json::array());
    CHECK(ids_of(copy["binaries"]) ==
          std::vector<std::string>{"cover.gif", "inline.png", "output-only.png", "history.jpg"});
    CHECK(copy["binaries"][0]["contentType"] == converted_to);
    CHECK(copy["description"]["titleInfo"]["bookTitle"] ==
          doc["description"]["titleInfo"]["bookTitle"]);
    CHECK(copy["description"]["customInfo"] == doc["description"]["customInfo"]);
    CHECK(copy["description"]["documentInfo"]["id"] == "export-0001");
    CHECK(copy["description"]["outputs"].size() == 1);
    CHECK(f.ws.call("doc.close", json{{"docId", copy["docId"]}})["result"] == json::object());
}

TEST_CASE("doc.exportDescription: always UTF-8, whatever the book's encoding and the Save settings",
          "[server][doc][export]") {
    ServerFixture f;
    const json opened = f.ws.call("doc.open", json{{"path", f.book("legacy-cp1251.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    REQUIRE(doc["sourceEncoding"] == "windows-1251");
    // "Keep encoding" would make Save write windows-1251; the export takes no notice.
    REQUIRE(f.ws.call("settings.set", json{{"patch", {{"other", {{"keepEncoding", true}}}}}})
                .contains("result"));
    f.ws.wait_notification("settings.changed");

    const std::string out = (f.data / "legacy.fbd").string();
    const json exported = f.run_job("doc.exportDescription",
                                    json{{"docId", doc_id}, {"document", doc}, {"path", out}});
    REQUIRE(exported.contains("result"));
    CHECK_FALSE(exported["result"].contains("needsConfirmation"));
    const std::string written = read_all(out);
    CHECK(written.rfind("<?xml version=\"1.0\" encoding=\"utf-8\"?>", 0) == 0);
    CHECK_THAT(written, ContainsSubstring("<book-title>Старая книга</book-title>"));  // UTF-8 bytes
    CHECK_THAT(written, ContainsSubstring("\t<body>\n\t\t<section/>\n\t</body>\n"));
    CHECK_THAT(written, ContainsSubstring("<binary id=\"cover.jpg\" content-type=\"image/jpeg\">"));
    // The session keeps the book's encoding (doc.fromXml echoes it).
    const json xml = f.ws.call("doc.toXml", json{{"docId", doc_id}, {"document", doc}});
    const json back =
        f.ws.call("doc.fromXml", json{{"docId", doc_id}, {"text", xml["result"]["text"]}});
    REQUIRE(back.contains("result"));
    CHECK(back["result"]["document"]["sourceEncoding"] == "windows-1251");
}

TEST_CASE(
    "doc.exportDescription: an incomplete description asks first and force writes it; "
    "description-slot extras stay, top-level extras and the stylesheet go",
    "[server][doc][export]") {
    ServerFixture f;
    // A new document: the blank template's empty genre is an error, so the export asks first
    // and writes nothing; `force` writes the file with the same report.
    const json created = f.ws.call("doc.new");
    REQUIRE(created.contains("result"));
    const json fresh = created["result"];
    const std::string fresh_id = fresh["docId"];
    const std::string out = (f.data / "fresh.fbd").string();
    const json asked = f.run_job("doc.exportDescription",
                                 json{{"docId", fresh_id}, {"document", fresh}, {"path", out}});
    REQUIRE(asked.contains("result"));
    CHECK(asked["result"]["needsConfirmation"] == true);
    CHECK(asked["result"]["validation"]["errorCount"].get<int>() >= 1);
    bool genre_error = false;
    for (const auto& issue : asked["result"]["validation"]["issues"]) {
        if (issue["code"] == "genre.unknown") {
            genre_error = true;
        }
    }
    CHECK(genre_error);
    CHECK_FALSE(asked["result"].contains("path"));
    CHECK_FALSE(std::filesystem::exists(out));
    const json forced =
        f.run_job("doc.exportDescription",
                  json{{"docId", fresh_id}, {"document", fresh}, {"path", out}, {"force", true}});
    REQUIRE(forced.contains("result"));
    CHECK_FALSE(forced["result"].contains("needsConfirmation"));
    CHECK(forced["result"]["path"] == out);
    CHECK(forced["result"]["validation"]["errorCount"] ==
          asked["result"]["validation"]["errorCount"]);
    REQUIRE(std::filesystem::exists(out));
    const std::string fresh_text = read_all(out);
    CHECK_FALSE(fb2::check_well_formed(fresh_text).has_value());
    CHECK_THAT(fresh_text, ContainsSubstring("\t<body>\n\t\t<section/>\n\t</body>\n"));
    CHECK_THAT(fresh_text, !ContainsSubstring("blank.fb2"));  // the template's body text
    CHECK_THAT(fresh_text, ContainsSubstring("<p>Введите сюда краткую аннотацию</p>"));
    // Validated as the exported content, not as the book: the genre error alone remains.
    const json fresh_report =
        f.run_job("doc.validate", json{{"docId", fresh_id}, {"text", fresh_text}});
    REQUIRE(fresh_report.contains("result"));
    CHECK(fresh_report["result"]["errorCount"] == 1);
    CHECK(fresh_report["result"]["issues"][0]["code"] == "genre.unknown");

    // unknown-elements.fb2: a foreign element inside title-info (a description-slot extra,
    // kept - it is description data) and a foreign top-level element (dropped).
    const json opened =
        f.ws.call("doc.open", json{{"path", f.book("unknown-elements.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    REQUIRE(doc["extras"].size() == 2);
    const std::string unknown = (f.data / "unknown.fbd").string();
    const json written =
        f.run_job("doc.exportDescription",
                  json{{"docId", doc_id}, {"document", doc}, {"path", unknown}, {"force", true}});
    REQUIRE(written.contains("result"));
    CHECK(written["result"]["path"] == unknown);
    const std::string text = read_all(unknown);
    CHECK_FALSE(fb2::check_well_formed(text).has_value());
    CHECK_THAT(text, ContainsSubstring(">5</x:rating>"));
    CHECK(text.find("x:rating") < text.find("</title-info>"));
    CHECK_THAT(text, !ContainsSubstring("x:metadata"));
    CHECK_THAT(text, !ContainsSubstring("Known title"));
    CHECK_THAT(text, !ContainsSubstring("unknown inline"));
    CHECK_THAT(text, ContainsSubstring("\t<body>\n\t\t<section/>\n\t</body>\n"));
    CHECK(count_of(text, "<binary ") == 0);
}

TEST_CASE(
    "doc.exportDescription: the open document's own file is refused by identity before "
    "anything is written; a write fault leaves the target intact; parameter errors",
    "[server][doc][export]") {
    ServerFixture f;
    const std::filesystem::path own = f.data / "open.fbd";
    std::filesystem::copy_file(f.book("maxlib-roles-edge.fbd"), own);
    const std::string own_bytes = read_all(own);
    const json opened = f.ws.call("doc.open", json{{"path", own.string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    const json recent_before = f.ws.call("doc.recent")["result"];

    const auto refused = [&](const std::string& path) {
        const json answer =
            f.ws.call("doc.exportDescription",
                      json{{"docId", doc_id}, {"document", doc}, {"path", path}, {"force", true}});
        INFO(path << " -> " << answer.dump());
        REQUIRE(answer.contains("error"));
        CHECK(answer["error"]["code"] == 1006);
        CHECK(answer["error"]["message"] == "doc.sameAsOpenFile");
        CHECK(answer["error"]["data"]["path"].is_string());
        CHECK(read_all(own) == own_bytes);
    };
    // The same spelling, a spelling through a parent folder, and the platform's own identity
    // rules: a symbolic link (POSIX), another letter case (Windows).
    refused(own.string());
    refused((f.data / "sub" / ".." / "open.fbd").string());
#ifdef _WIN32
    refused((f.data / "OPEN.FBD").string());
#else
    const std::filesystem::path link = f.data / "link.fbd";
    std::filesystem::create_symlink(own, link);
    refused(link.string());
#endif
    CHECK(f.ws.call("doc.recent")["result"] == recent_before);

    // Another file in the same folder is written (the fixture's document-info lacks an author,
    // so the export asks without `force`).
    const std::string copy = (f.data / "copy.fbd").string();
    const json asked = f.run_job("doc.exportDescription",
                                 json{{"docId", doc_id}, {"document", doc}, {"path", copy}});
    REQUIRE(asked.contains("result"));
    CHECK(asked["result"]["needsConfirmation"] == true);
    CHECK_FALSE(std::filesystem::exists(copy));
    const json written =
        f.run_job("doc.exportDescription",
                  json{{"docId", doc_id}, {"document", doc}, {"path", copy}, {"force", true}});
    REQUIRE(written.contains("result"));
    CHECK(written["result"]["path"] == copy);
    REQUIRE(std::filesystem::exists(copy));
    const std::string copy_bytes = read_all(copy);
    CHECK_THAT(copy_bytes, ContainsSubstring("<custom-info info-type=\"mleditor\">  Пробелов Пётр "
                                             "Петрович </custom-info>"));
    CHECK_THAT(copy_bytes,
               ContainsSubstring("<binary id=\"cover.jpg\" content-type=\"image/jpeg\">"));
    CHECK_THAT(copy_bytes, ContainsSubstring("\t<body>\n\t\t<section/>\n\t</body>\n"));

    // A write that fails midway (fault injection) reports 1002 and leaves the old file intact.
    REQUIRE(f.ws.call("test.injectFault", json{{"point", "before_rename"}})["result"] ==
            json::object());
    const json failed =
        f.run_job("doc.exportDescription",
                  json{{"docId", doc_id}, {"document", doc}, {"path", copy}, {"force", true}});
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1002);
    CHECK(failed["error"]["data"]["path"] == copy);
    CHECK(read_all(copy) == copy_bytes);
    CHECK(read_all(own) == own_bytes);
    // No session bookkeeping happened: Recent Files still list the open document alone.
    CHECK(f.ws.call("doc.recent")["result"] == recent_before);

    // Parameter errors.
    CHECK(f.ws.call("doc.exportDescription",
                    json{{"docId", "d99"}, {"document", doc}, {"path", copy}})["error"]["code"] ==
          1000);
    const json no_path =
        f.ws.call("doc.exportDescription", json{{"docId", doc_id}, {"document", doc}});
    REQUIRE(no_path.contains("error"));
    CHECK(no_path["error"]["code"] == -32602);
    CHECK(no_path["error"]["data"]["field"] == "path");
    CHECK(f.ws.call("doc.exportDescription",
                    json{{"docId", doc_id}, {"document", doc}, {"path", ""}})["error"]["code"] ==
          -32602);
    const json no_document =
        f.ws.call("doc.exportDescription", json{{"docId", doc_id}, {"path", copy}});
    REQUIRE(no_document.contains("error"));
    CHECK(no_document["error"]["code"] == -32602);
    CHECK(no_document["error"]["data"]["field"] == "document");
}

TEST_CASE("doc.exportDescription: a store at Save's threshold runs as a job with Save's phases",
          "[server][doc][export][job]") {
    ServerFixture f;
    const json opened = f.ws.call("doc.open", json{{"path", f.book("modern-utf8.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    // An unreferenced 2.5 MB object takes the session's store over the threshold.
    std::string blob(2560 * 1024, '\0');
    for (std::size_t i = 0; i < blob.size(); ++i) {
        blob[i] = static_cast<char>((i * 7919) % 251);
    }
    auto posted = test::http_request(
        f.port(), "POST", "/binary/" + doc_id + "?" + f.tok(),
        {{"Content-Type", "application/octet-stream"}, {"X-MFBE-Suggested-Id", "big.bin"}}, blob);
    REQUIRE(posted.status == 201);

    const std::string out = (f.data / "modern.fbd").string();
    const json start = f.ws.call("doc.exportDescription",
                                 json{{"docId", doc_id}, {"document", doc}, {"path", out}});
    REQUIRE(start.contains("result"));
    REQUIRE(start["result"].contains("jobId"));
    const JobOutcome done = collect_job(f.ws, start["result"]["jobId"]);
    REQUIRE(done.final.is_object());
    REQUIRE(done.final["method"] == "job.done");
    for (const char* phase : {"validate", "convert", "serialize", "write", "done"}) {
        INFO(phase);
        CHECK(std::find(done.phases.begin(), done.phases.end(), phase) != done.phases.end());
    }
    const json& result = done.final["params"]["result"];
    CHECK(result["path"] == out);
    CHECK(result["validation"]["errorCount"] == 0);
    CHECK(result["converted"] == json::array());
    const std::string written = read_all(out);
    CHECK(count_of(written, "<binary ") == 1);
    CHECK_THAT(written, ContainsSubstring("<binary id=\"cover.png\" content-type=\"image/png\">"));
    CHECK_THAT(written, !ContainsSubstring("dot.gif"));
    CHECK_THAT(written, !ContainsSubstring("big.bin"));
    CHECK_THAT(written, !ContainsSubstring("<stylesheet"));
    CHECK_THAT(written, ContainsSubstring("\t<body>\n\t\t<section/>\n\t</body>\n"));
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"].size() == 3);
}
