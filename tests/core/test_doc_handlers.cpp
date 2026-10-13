// T042/T045: doc.* and binary.* over the real loopback server - new, toXml, fromXml, save
// (needsConfirmation and force), recent, open (direct and as a job), openSource for malformed
// files, validate, caret, watch + doc.changedOnDisk, keepEncoding, HTTP /binary GET/POST.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
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

    ServerFixture() {
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
    CHECK(uuid::is_valid(doc["description"]["documentInfo"]["id"].get<std::string>()));
    const std::string date = doc["description"]["documentInfo"]["date"]["value"];
    CHECK(date.size() == 10);
    CHECK(date.find("{date}") == std::string::npos);
    CHECK(doc["description"]["titleInfo"]["lang"] == "ru");
    CHECK(doc["description"]["documentInfo"]["programUsed"] == "Maxima Fiction Book Editor");
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
    CHECK_THAT(text, ContainsSubstring("<program-used>Maxima Fiction Book Editor</program-used>"));
    CHECK_THAT(text, ContainsSubstring("\t\t<section>\n\t\t\t<p>"));

    // Back from Source: same document (fresh nodeIds, remap provided).
    const json back = f.ws.call("doc.fromXml", json{{"docId", doc_id}, {"text", text}});
    REQUIRE(back.contains("result"));
    CHECK(back["result"]["document"]["docId"] == doc_id);
    CHECK(back["result"]["document"]["description"]["titleInfo"]["lang"] == "ru");
    CHECK(back["result"]["document"]["bodies"][0]["content"][0]["type"] == "section");
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

    // Recent files know the saved path; caret round-trips.
    const json recent = f.ws.call("doc.recent");
    REQUIRE(recent["result"].size() == 1);
    CHECK(recent["result"][0]["path"] == target);
    CHECK(recent["result"][0]["exists"] == true);
    CHECK(recent["result"][0]["lastOpened"].is_string());
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}})["result"] == json::object());
    const json caret{{"view", "body"}, {"nodeId", "n3"}, {"offset", 4}};
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}, {"caret", caret}})["result"]["caret"] ==
          caret);
    CHECK(f.ws.call("doc.recent")["result"][0]["caret"] == caret);
    CHECK(f.ws.call("doc.caret", json{{"docId", doc_id}, {"caret", "nope"}})["error"]["code"] ==
          -32602);
    CHECK(f.ws.call("doc.clearRecent")["result"] == json::object());
    CHECK(f.ws.call("doc.recent")["result"] == json::array());

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
    {
        std::ofstream big(big_path, std::ios::binary);
        big << "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<FictionBook "
               "xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
               "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
               "<description><title-info><genre>sf</genre><author><nickname>big</nickname></"
               "author><book-title>Big</book-title><lang>en</lang></title-info>"
               "<document-info><author><nickname>big</nickname></author><date>2026</date><id>big</"
               "id><version>1.0</version></document-info></description>\n<body>\n";
        for (int s = 0; s < 40; ++s) {
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
