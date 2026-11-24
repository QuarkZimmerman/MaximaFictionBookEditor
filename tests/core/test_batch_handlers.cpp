// Feature 019 (T008; contracts/rpc-api.md): RPC contract tests for batch.*, app.info.cpuCores,
// test.setCpuCores, doc.open/doc.save ephemeral isolation, dialog.pickFolder.folder,
// pdf.export.abort cancelPrint flag, BatchState shutdown teardown, and concurrent txt.export ZIPs.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>
#include <mfbe/version.hpp>

#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <filesystem>
#include <map>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;
using nlohmann::json;
using namespace mfbe;

namespace {

struct BatchFixture {
    test::TempDir data{"mfbe-batch-rpc-data"};
    test::TempDir work{"mfbe-batch-rpc-work"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    BatchFixture() {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
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

    json call_maybe_job(const std::string& method, const json& params) {
        const json reply = ws.call(method, params);
        REQUIRE(reply.contains("result"));
        if (reply["result"].is_object() && reply["result"].contains("jobId")) {
            const json done = wait_job(reply["result"]["jobId"].get<std::string>());
            REQUIRE(done["event"] == "job.done");
            return done["result"];
        }
        return reply["result"];
    }
};

}  // namespace

TEST_CASE("app.info reports current apiMinor and cpuCores, overridable via test.setCpuCores",
          "[batch][rpc]") {
    BatchFixture f;
    const json info = f.ws.call("app.info");
    REQUIRE(info.contains("result"));
    CHECK(info["result"]["apiMinor"] == version::kApiMinor);
    REQUIRE(info["result"].contains("cpuCores"));
    CHECK(info["result"]["cpuCores"].get<int>() >= 1);

    const json set1 = f.ws.call("test.setCpuCores", json{{"cores", 1}});
    CHECK(set1["result"]["cpuCores"] == 1);
    CHECK(f.ws.call("app.info")["result"]["cpuCores"] == 1);

    const json set8 = f.ws.call("test.setCpuCores", json{{"cores", 8}});
    CHECK(set8["result"]["cpuCores"] == 8);
    CHECK(f.ws.call("app.info")["result"]["cpuCores"] == 8);

    const json cleared = f.ws.call("test.setCpuCores", json{{"cores", nullptr}});
    CHECK(cleared["result"]["cpuCores"].get<int>() >= 1);
}

TEST_CASE("doc.open and doc.save with ephemeral: true leave Recent files and positions untouched",
          "[batch][ephemeral][rpc]") {
    BatchFixture f;
    const fs::path src = test::fixtures_dir() / "books" / "modern-utf8.fb2";
    const json opened = f.call_maybe_job(
        "doc.open", json{{"path", platform::utf8_from_path(src)}, {"ephemeral", true}});
    const std::string doc_id = opened["document"]["docId"];
    const json document = opened["document"];

    const fs::path bare_out = f.work.path() / "saved.fb2";
    const json saved = f.call_maybe_job("doc.save", json{{"docId", doc_id},
                                                         {"document", document},
                                                         {"path", platform::utf8_from_path(bare_out)},
                                                         {"encoding", "utf-8"},
                                                         {"force", true},
                                                         {"ephemeral", true}});
    REQUIRE(saved.contains("path"));
    CHECK(fs::exists(bare_out));

    const fs::path zip_out = f.work.path() / "saved.fb2.zip";
    const json saved_zip =
        f.call_maybe_job("doc.save", json{{"docId", doc_id},
                                          {"document", document},
                                          {"path", platform::utf8_from_path(zip_out)},
                                          {"encoding", "utf-8"},
                                          {"archive", {{"entryName", "saved.fb2"}}},
                                          {"force", true},
                                          {"ephemeral", true}});
    REQUIRE(saved_zip.contains("path"));
    CHECK(fs::exists(zip_out));
    const archive::Listing listing = archive::list(zip_out);
    REQUIRE(listing.books.size() == 1);
    CHECK(listing.books[0].entry == "saved.fb2");

    // Recent files list must remain completely empty after ephemeral open/save.
    const json recents = f.ws.call("doc.recent");
    REQUIRE(recents.contains("result"));
    CHECK(recents["result"].empty());
    CHECK_FALSE(fs::exists(f.data.path() / "positions.json"));
}

TEST_CASE("batch.scan, batch.claimTarget, batch.releaseTarget, batch.writeReport, and endRun",
          "[batch][rpc]") {
    BatchFixture f;
    const fs::path src_dir = f.work.path() / "src";
    const fs::path dst_dir = f.work.path() / "dst";
    fs::create_directories(src_dir / "nested");
    const fs::path book_a = src_dir / "a.fb2";
    const fs::path book_b = src_dir / "nested" / "b.fb2";
    const std::string fb2 =
        atomic_file::read_file(test::fixtures_dir() / "books" / "modern-utf8.fb2");
    atomic_file::write_atomic(book_a, fb2);
    atomic_file::write_atomic(book_b, fb2);

    // Open book_a as the editor's active book to verify open-book overwrite refusal.
    const json active = f.ws.call("doc.open", json{{"path", platform::utf8_from_path(book_a)}});
    const std::string open_doc_id = active["result"]["document"]["docId"];

    const json scan_start = f.ws.call("batch.scan", json{{"direction", "fb2ToExport"},
                                                         {"sourceDir", platform::utf8_from_path(src_dir)},
                                                         {"includeSubfolders", true}});
    REQUIRE(scan_start.contains("result"));
    const json scan_done = f.wait_job(scan_start["result"]["jobId"]);
    REQUIRE(scan_done["event"] == "job.done");
    const std::string run_id = scan_done["result"]["runId"];
    REQUIRE(scan_done["result"]["items"].size() == 2);

    // Self-overwrite refusal.
    const json self_claim = f.ws.call(
        "batch.claimTarget", json{{"runId", run_id},
                                  {"sourcePath", platform::utf8_from_path(book_b)},
                                  {"targetPath", platform::utf8_from_path(book_b)},
                                  {"overwrite", true}});
    CHECK(self_claim["result"]["status"] == "failed");
    CHECK(self_claim["result"]["reason"] == "targetIsSource");

    // Open-book overwrite refusal.
    const json open_claim = f.ws.call(
        "batch.claimTarget", json{{"runId", run_id},
                                  {"sourcePath", platform::utf8_from_path(book_b)},
                                  {"targetPath", platform::utf8_from_path(book_a)},
                                  {"openDocId", open_doc_id},
                                  {"overwrite", true}});
    CHECK(open_claim["result"]["status"] == "failed");
    CHECK(open_claim["result"]["reason"] == "targetIsOpenBook");

    // Claim creates missing parent folders; second concurrent claim gets targetBusy even with overwrite=true.
    const fs::path out_file = dst_dir / "nested" / "b.epub";
    const json c1 = f.ws.call("batch.claimTarget",
                              json{{"runId", run_id},
                                   {"sourcePath", platform::utf8_from_path(book_b)},
                                   {"targetPath", platform::utf8_from_path(out_file)},
                                   {"overwrite", false}});
    REQUIRE(c1["result"]["status"] == "claimed");
    CHECK(fs::is_directory(dst_dir / "nested"));
    const std::string claim_id = c1["result"]["claimId"];

    const json c_busy = f.ws.call("batch.claimTarget",
                                  json{{"runId", run_id},
                                       {"sourcePath", platform::utf8_from_path(book_a)},
                                       {"targetPath", platform::utf8_from_path(out_file)},
                                       {"overwrite", true}});
    CHECK(c_busy["result"]["status"] == "skipped");
    CHECK(c_busy["result"]["reason"] == "targetBusy");

    atomic_file::write_atomic(out_file, "written");
    f.ws.call("batch.releaseTarget",
              json{{"runId", run_id}, {"claimId", claim_id}, {"succeeded", true}});

    // After release, overwrite=false skips with targetExists; overwrite=true claims again.
    const json c_exists = f.ws.call("batch.claimTarget",
                                    json{{"runId", run_id},
                                         {"sourcePath", platform::utf8_from_path(book_a)},
                                         {"targetPath", platform::utf8_from_path(out_file)},
                                         {"overwrite", false}});
    CHECK(c_exists["result"]["status"] == "skipped");
    CHECK(c_exists["result"]["reason"] == "targetExists");

    const json c_overwrite = f.ws.call("batch.claimTarget",
                                       json{{"runId", run_id},
                                            {"sourcePath", platform::utf8_from_path(book_a)},
                                            {"targetPath", platform::utf8_from_path(out_file)},
                                            {"overwrite", true}});
    CHECK(c_overwrite["result"]["status"] == "claimed");
    f.ws.call("batch.releaseTarget",
              json{{"runId", run_id}, {"claimId", c_overwrite["result"]["claimId"]}});

    // Atomic report write.
    const fs::path report_path = f.work.path() / "report.txt";
    const json written = f.ws.call("batch.writeReport",
                                   json{{"path", platform::utf8_from_path(report_path)},
                                        {"content", "Batch Report\nLine 2\n"}});
    REQUIRE(written.contains("result"));
    CHECK(atomic_file::read_file(report_path) == "Batch Report\nLine 2\n");

    f.ws.call("batch.endRun", json{{"runId", run_id}});
}

TEST_CASE("dialog.pickFolder forwards optional folder hint through QueuedDialogProvider",
          "[batch][dialog][rpc]") {
    BatchFixture f;
    f.ws.call("test.enqueueDialog",
              json{{"method", "dialog.pickFolder"},
                   {"result", {{"path", platform::utf8_from_path(f.work.path())}}}});
    const json ans = f.ws.call("dialog.pickFolder",
                               json{{"title", "Select folder"},
                                    {"folder", platform::utf8_from_path(f.work.path())}});
    REQUIRE(ans.contains("result"));
    CHECK(ans["result"]["path"] == platform::utf8_from_path(f.work.path()));

    const json reqs = f.ws.call("test.dialogRequests");
    REQUIRE(reqs["result"].size() == 1);
    CHECK(reqs["result"][0]["folder"] == platform::utf8_from_path(f.work.path()));
}

TEST_CASE("pdf.export.abort with cancelPrint: false preserves another active print request",
          "[batch][pdf][rpc]") {
    BatchFixture f;
    const fs::path src = test::fixtures_dir() / "books" / "modern-utf8.fb2";
    const json opened = f.call_maybe_job(
        "doc.open", json{{"path", platform::utf8_from_path(src)}, {"ephemeral", true}});
    const std::string doc_id = opened["document"]["docId"];

    const json b1 = f.ws.call("pdf.export.begin",
                              json{{"docId", doc_id},
                                   {"path", platform::utf8_from_path(f.work.path() / "a.pdf")},
                                   {"pageSize", "a4"}});
    const json b2 = f.ws.call("pdf.export.begin",
                              json{{"docId", doc_id},
                                   {"path", platform::utf8_from_path(f.work.path() / "b.pdf")},
                                   {"pageSize", "a4"}});
    const std::string t1 = b1["result"]["token"];
    const std::string t2 = b2["result"]["token"];

    f.ws.call("pdf.export.document", json{{"token", t1}, {"parts", 1}});
    const json p1 = f.ws.call("pdf.export.print", json{{"token", t1}, {"part", 0}});
    REQUIRE(p1.contains("result"));

    // Wait briefly until the print request is queued in QueuedPrintService.
    bool queued = false;
    for (int i = 0; i < 40; ++i) {
        if (!f.ws.call("test.printRequests")["result"].empty()) {
            queued = true;
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
    }
    REQUIRE(queued);

    // Aborting t2 with cancelPrint: false must NOT cancel t1's queued print request.
    f.ws.call("pdf.export.abort", json{{"token", t2}, {"cancelPrint", false}});
    CHECK(f.ws.call("test.printRequests")["result"].size() == 1);

    // Default cancelPrint: true cancels it cleanly.
    f.ws.call("pdf.export.abort", json{{"token", t1}});
    CHECK(f.ws.call("test.printRequests")["result"].empty());
}

TEST_CASE("concurrent txt.export ZIP jobs succeed safely without DocumentRegistry race",
          "[batch][txt][rpc]") {
    BatchFixture f;
    const fs::path src = test::fixtures_dir() / "books" / "modern-utf8.fb2";
    std::vector<std::pair<std::string, json>> docs;
    for (int i = 0; i < 4; ++i) {
        const json opened = f.call_maybe_job(
            "doc.open", json{{"path", platform::utf8_from_path(src)}, {"ephemeral", true}});
        docs.emplace_back(opened["document"]["docId"].get<std::string>(), opened["document"]);
    }

    // Separate observer receives every broadcast txt.export job.done without call() dropping it.
    test::WsClient observer;
    REQUIRE(observer.open(f.server->port(), "/rpc?token=" + f.server->token()) == 101);

    std::vector<std::string> job_ids;
    std::vector<fs::path> outputs;
    for (int i = 0; i < 4; ++i) {
        const fs::path out = f.work.path() / ("txt_" + std::to_string(i) + ".zip");
        outputs.push_back(out);
        const json started = f.ws.call("txt.export", json{{"docId", docs[i].first},
                                                          {"path", platform::utf8_from_path(out)},
                                                          {"text", "Hello batch\n"},
                                                          {"encoding", "utf-8"},
                                                          {"zip", true},
                                                          {"document", docs[i].second}});
        REQUIRE(started.contains("result"));
        job_ids.push_back(started["result"]["jobId"].get<std::string>());
        // Immediately close the session while the worker thread is running to confirm worker never
        // dereferences DocumentRegistry.
        f.ws.call("doc.close", json{{"docId", docs[i].first}});
    }

    std::map<std::string, json> outcomes;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    while (outcomes.size() < job_ids.size() && std::chrono::steady_clock::now() < deadline) {
        auto msg = observer.receive_json(10000);
        REQUIRE(msg.has_value());
        const std::string name = msg->value("method", "");
        if (name == "job.done" || name == "job.failed") {
            const std::string jid = (*msg)["params"]["jobId"].get<std::string>();
            json res = (*msg)["params"];
            res["event"] = name;
            outcomes[jid] = std::move(res);
        }
    }
    REQUIRE(outcomes.size() == job_ids.size());
    for (const auto& id : job_ids) {
        REQUIRE(outcomes[id]["event"] == "job.done");
    }
    for (const auto& out : outputs) {
        REQUIRE(fs::exists(out));
        const archive::Listing listing = archive::list(out);
        CHECK(listing.entries.size() == 2);
    }
}

TEST_CASE("CoreServer shutdown removes remaining active batch temp directories", "[batch][rpc]") {
    test::TempDir data("mfbe-batch-shutdown-data");
    test::TempDir src("mfbe-batch-shutdown-src");
    const fs::path zip = src.path() / "wrapped.zip";
    atomic_file::write_atomic(
        zip, archive::zip_entries({archive::ZipEntry{"a.epub", "DATA", false, false}}));

    fs::path extracted_dir;
    {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        auto server = CoreServer::start(options);
        test::WsClient ws;
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
        const json scan_start = ws.call("batch.scan", json{{"direction", "importToFb2"},
                                                           {"sourceDir", platform::utf8_from_path(src.path())},
                                                           {"includeSubfolders", true},
                                                           {"formats", json::array({"epub"})}});
        std::string run_id;
        std::string item_id;
        for (;;) {
            auto msg = ws.receive_json(10000);
            REQUIRE(msg.has_value());
            if (msg->value("method", "") == "job.done" &&
                (*msg)["params"]["jobId"] == scan_start["result"]["jobId"]) {
                run_id = (*msg)["params"]["result"]["runId"];
                item_id = (*msg)["params"]["result"]["items"][0]["itemId"];
                break;
            }
        }
        const json ext_start = ws.call("batch.extractEntry",
                                       json{{"runId", run_id},
                                            {"itemId", item_id},
                                            {"archivePath", platform::utf8_from_path(zip)},
                                            {"entry", "a.epub"},
                                            {"format", "epub"}});
        for (;;) {
            auto msg = ws.receive_json(10000);
            REQUIRE(msg.has_value());
            if (msg->value("method", "") == "job.done" &&
                (*msg)["params"]["jobId"] == ext_start["result"]["jobId"]) {
                extracted_dir = platform::path_from_utf8(
                    (*msg)["params"]["result"]["tempDir"].get<std::string>());
                break;
            }
        }
        REQUIRE(fs::exists(extracted_dir));
        // Server closes without calling batch.endRun: destructor must clean up state/batch/<runId>.
    }
    CHECK_FALSE(fs::exists(extracted_dir));
}

TEST_CASE("batch.openDoc serves one-shot Document JSON via GET /batch/doc/:docId and cleans up",
          "[batch][rpc]") {
    BatchFixture f;
    const fs::path src = test::fixtures_dir() / "books" / "modern-utf8.fb2";

    const json opened = f.call_maybe_job(
        "batch.openDoc",
        json{{"path", platform::utf8_from_path(src)}, {"cleanInvalidChars", true}});
    REQUIRE(opened.contains("docId"));
    REQUIRE(opened.contains("description"));
    REQUIRE(opened.contains("binaryCount"));
    const std::string doc_id = opened["docId"].get<std::string>();

    // Auth check: missing token is rejected with 401.
    const auto unauth = test::http_get(f.server->port(), "/batch/doc/" + doc_id);
    CHECK(unauth.status == 401);

    // First authenticated GET returns the full Document JSON and consumes the entry.
    const auto ok =
        test::http_get(f.server->port(), "/batch/doc/" + doc_id + "?token=" + f.server->token());
    REQUIRE(ok.status == 200);
    const json doc_json = json::parse(ok.body);
    CHECK(doc_json["docId"] == doc_id);
    CHECK(doc_json.contains("bodies"));

    // Second GET returns 404 (one-shot take).
    const auto second =
        test::http_get(f.server->port(), "/batch/doc/" + doc_id + "?token=" + f.server->token());
    CHECK(second.status == 404);

    f.ws.call("doc.close", json{{"docId", doc_id}});

    // Closing an unfetched batch.openDoc session releases its buffered JSON cleanly.
    const json opened2 = f.call_maybe_job(
        "batch.openDoc",
        json{{"path", platform::utf8_from_path(src)}, {"cleanInvalidChars", true}});
    const std::string doc_id2 = opened2["docId"].get<std::string>();
    f.ws.call("doc.close", json{{"docId", doc_id2}});
    const auto after_close =
        test::http_get(f.server->port(), "/batch/doc/" + doc_id2 + "?token=" + f.server->token());
    CHECK(after_close.status == 404);

    // Recent files must remain untouched.
    CHECK(f.ws.call("doc.recent")["result"].empty());
}

TEST_CASE("PUT /mobi-write/:token/bundle uploads all slots in one request and commits with zip",
          "[batch][mobi][rpc]") {
    BatchFixture f;
    const fs::path src = test::fixtures_dir() / "books" / "modern-utf8.fb2";
    const json opened = f.call_maybe_job(
        "batch.openDoc",
        json{{"path", platform::utf8_from_path(src)}, {"cleanInvalidChars", true}});
    const std::string doc_id = opened["docId"].get<std::string>();

    const fs::path out_zip = f.work.path() / "bundled.mobi.zip";
    const json begun = f.ws.call("mobi.write.begin",
                                 json{{"docId", doc_id},
                                      {"path", platform::utf8_from_path(out_zip)},
                                      {"format", "joint"},
                                      {"zip", true}});
    REQUIRE(begun.contains("result"));
    const std::string token = begun["result"]["token"].get<std::string>();

    auto append_u32 = [](std::string& dst, std::uint32_t v) {
        dst.push_back(static_cast<char>(v & 0xFFU));
        dst.push_back(static_cast<char>((v >> 8U) & 0xFFU));
        dst.push_back(static_cast<char>((v >> 16U) & 0xFFU));
        dst.push_back(static_cast<char>((v >> 24U) & 0xFFU));
    };
    auto append_slot = [&](std::string& dst, const std::string& name, const std::string& payload) {
        append_u32(dst, static_cast<std::uint32_t>(name.size()));
        dst.append(name);
        append_u32(dst, static_cast<std::uint32_t>(payload.size()));
        dst.append(payload);
    };

    std::string bundle;
    append_slot(bundle, "mobi7-html", "<html><body><p>Hello MOBI 7</p></body></html>");
    append_slot(bundle, "kf8-html", "<html><body><p>Hello KF8</p></body></html>");
    append_slot(bundle, "kf8-css", "p { margin: 0; }");
    append_slot(bundle, "mfbe", R"({"v":1})");

    const auto put = test::http_request(
        f.server->port(), "PUT", "/mobi-write/" + token + "/bundle?token=" + f.server->token(),
        {{"Content-Type", "application/octet-stream"}}, bundle);
    REQUIRE(put.status == 201);

    // Commit without passing `document` — core falls back to the session snapshot for FBD export.
    const json committed =
        f.call_maybe_job("mobi.write.commit", json{{"token", token},
                                                   {"metadata", {{"title", "Bundled"}}},
                                                   {"nav", json::array()},
                                                   {"guide", json::array()}});
    REQUIRE(committed.contains("path"));
    REQUIRE(fs::exists(out_zip));
    const archive::Listing listing = archive::list(out_zip);
    CHECK(listing.entries.size() == 2);

    f.ws.call("doc.close", json{{"docId", doc_id}});
}

TEST_CASE("concurrent batch.openDoc calls validate and serialize in parallel safely",
          "[batch][rpc]") {
    BatchFixture f;
    test::WsClient observer;
    REQUIRE(observer.open(f.server->port(), "/rpc?token=" + f.server->token()) == 101);

    const fs::path valid_src = test::fixtures_dir() / "books" / "modern-utf8.fb2";
    const fs::path large_src = test::fixtures_dir() / "books" / "notes-400.fb2";
    std::vector<std::pair<std::string, std::string>> jobs;  // (jobId, expectedSchemaHint)
    for (int i = 0; i < 6; ++i) {
        const bool use_valid = (i % 2) == 0;
        const fs::path& src = use_valid ? valid_src : large_src;
        const json reply = f.ws.call(
            "batch.openDoc",
            json{{"path", platform::utf8_from_path(src)}, {"cleanInvalidChars", true}});
        REQUIRE(reply.contains("result"));
        jobs.emplace_back(reply["result"]["jobId"].get<std::string>(),
                          use_valid ? "2.1" : "legacy");
    }

    std::map<std::string, json> outcomes;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    while (outcomes.size() < jobs.size() && std::chrono::steady_clock::now() < deadline) {
        auto msg = observer.receive_json(10000);
        REQUIRE(msg.has_value());
        const std::string name = msg->value("method", "");
        if (name == "job.done" || name == "job.failed") {
            const std::string jid = (*msg)["params"]["jobId"].get<std::string>();
            json res = (*msg)["params"];
            res["event"] = name;
            outcomes[jid] = std::move(res);
        }
    }
    REQUIRE(outcomes.size() == jobs.size());
    for (const auto& [jid, expected_hint] : jobs) {
        REQUIRE(outcomes[jid]["event"] == "job.done");
        const std::string doc_id = outcomes[jid]["result"]["docId"].get<std::string>();
        const auto get = test::http_get(f.server->port(),
                                        "/batch/doc/" + doc_id + "?token=" + f.server->token());
        REQUIRE(get.status == 200);
        const json doc_json = json::parse(get.body);
        CHECK(doc_json["schemaHint"] == expected_hint);
        f.ws.call("doc.close", json{{"docId", doc_id}});
    }
}

TEST_CASE("batch.openDoc respects recover flag on malformed FB2", "[batch][rpc]") {
    BatchFixture f;
    const fs::path broken_src = test::fixtures_dir() / "books" / "malformed.fb2";
    const std::string broken_utf8 = platform::utf8_from_path(broken_src);

    // Without recover (Fix broken unchecked): fails with 1001 doc.parseError.
    {
        const json reply = f.ws.call("batch.openDoc", json{{"path", broken_utf8}, {"recover", false}});
        REQUIRE(reply.contains("result"));
        const std::string jid = reply["result"]["jobId"].get<std::string>();
        bool saw_failed = false;
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(15);
        while (!saw_failed && std::chrono::steady_clock::now() < deadline) {
            auto msg = f.ws.receive_json(5000);
            REQUIRE(msg.has_value());
            if (msg->value("method", "") == "job.failed" &&
                (*msg)["params"]["jobId"].get<std::string>() == jid) {
                CHECK((*msg)["params"]["error"]["code"] == 1001);
                saw_failed = true;
            }
        }
        REQUIRE(saw_failed);
    }

    // With recover=true (Fix broken checked): succeeds in memory with xml.repaired warning.
    {
        const json res =
            f.call_maybe_job("batch.openDoc", json{{"path", broken_utf8}, {"recover", true}});
        REQUIRE(res.contains("docId"));
        const std::string doc_id = res["docId"].get<std::string>();
        bool saw_repaired = false;
        for (const auto& w : res["warnings"]) {
            if (w.value("code", "") == "xml.repaired") {
                saw_repaired = true;
                CHECK(w["params"]["line"] == 20);
            }
        }
        CHECK(saw_repaired);
        const auto get = test::http_get(f.server->port(),
                                        "/batch/doc/" + doc_id + "?token=" + f.server->token());
        REQUIRE(get.status == 200);
        const json doc_json = json::parse(get.body);
        CHECK(doc_json["description"]["titleInfo"]["bookTitle"] == "Malformed");
        f.ws.call("doc.close", json{{"docId", doc_id}});
    }
}

TEST_CASE("batch.settings.get and batch.settings.save persist copy of global exports with forward compatibility and last-to-close wins",
          "[batch][rpc]") {
    BatchFixture f;
    const fs::path batch_file = f.data.path() / "batch-converter.json";
    REQUIRE_FALSE(fs::exists(batch_file));

    // 1. Customise global Settings -> Exports first; first batch.settings.get copies them
    // without creating batch-converter.json.
    REQUIRE(f.ws
                .call("settings.set",
                      json{{"patch",
                            {{"pdf", {{"defaultPageSize", "a5"}, {"customMargin", 30}}},
                             {"mobi", {{"format", "kf8"}, {"tocPlacement", "end"}}},
                             {"txt", {{"encodingMode", "language"}, {"bom", true}}},
                             {"markdown", {{"includePictures", false}}}}}})
                .contains("result"));

    const json first = f.ws.call("batch.settings.get", json::object());
    REQUIRE(first.contains("result"));
    CHECK(first["result"]["hasStored"] == false);
    CHECK_FALSE(fs::exists(batch_file));
    const json& s0 = first["result"]["settings"];
    CHECK(s0["direction"] == "fb2ToExport");
    CHECK(s0["inPlace"] == true);
    CHECK(s0["fixBroken"] == true);
    CHECK(s0["overwrite"] == false);
    CHECK(s0["exportSettings"]["pdf"]["defaultPageSize"] == "a5");
    CHECK(s0["exportSettings"]["pdf"]["customMargin"] == 30);
    CHECK(s0["exportSettings"]["mobi"]["format"] == "kf8");
    CHECK(s0["exportSettings"]["mobi"]["tocPlacement"] == "end");
    CHECK(s0["exportSettings"]["txt"]["encodingMode"] == "language");
    CHECK(s0["exportSettings"]["txt"]["bom"] == true);
    CHECK(s0["exportSettings"]["markdown"]["includePictures"] == false);

    // 2. Save modified batch settings; global settings.json MUST remain untouched!
    json modified = s0;
    modified["direction"] = "importToFb2";
    modified["exportFormat"] = "mobi";
    modified["inPlace"] = false;
    modified["fixBroken"] = false;
    modified["overwrite"] = true;
    modified["sourceDir"] = "/tmp/src";
    modified["destinationDir"] = "/tmp/dst";
    modified["parallel"] = true;
    modified["workerCount"] = 5;
    modified["zipOverrides"] = json{{"fb2ToExport:mobi", true}, {"importToFb2", true}};
    modified["exportSettings"]["mobi"]["format"] = "mobi7";
    modified["exportSettings"]["pdf"]["defaultPageSize"] = "letter";

    const json saved = f.ws.call("batch.settings.save", json{{"settings", modified}});
    REQUIRE(saved.contains("result"));
    REQUIRE(fs::exists(batch_file));

    const json reloaded = f.ws.call("batch.settings.get", json::object());
    REQUIRE(reloaded.contains("result"));
    CHECK(reloaded["result"]["hasStored"] == true);
    CHECK(reloaded["result"]["settings"]["direction"] == "importToFb2");
    CHECK(reloaded["result"]["settings"]["inPlace"] == false);
    CHECK(reloaded["result"]["settings"]["fixBroken"] == false);
    CHECK(reloaded["result"]["settings"]["overwrite"] == true);
    CHECK(reloaded["result"]["settings"]["parallel"] == true);
    CHECK(reloaded["result"]["settings"]["workerCount"] == 5);
    CHECK(reloaded["result"]["settings"]["zipOverrides"]["fb2ToExport:mobi"] == true);
    CHECK(reloaded["result"]["settings"]["exportSettings"]["mobi"]["format"] == "mobi7");
    CHECK(reloaded["result"]["settings"]["exportSettings"]["pdf"]["defaultPageSize"] == "letter");

    const json global_after = f.ws.call("settings.get", json::object());
    REQUIRE(global_after.contains("result"));
    CHECK(global_after["result"]["mobi"]["format"] == "kf8");
    CHECK(global_after["result"]["pdf"]["defaultPageSize"] == "a5");

    // 3. Forward compatibility: older batch-converter.json missing newly-added format parameters
    // (e.g. pdf.customMargin, mobi.kf8PopupFootnotes, txt.encodings.uk, fixBroken) plus unknown
    // future keys -> old values preserved, newly-added keys take schema defaults (NOT global
    // overrides), unknown keys survive, and saving persists the full updated schema.
    const json older_file{
        {"schemaVersion", 1},
        {"direction", "fb2ToExport"},
        {"exportFormat", "pdf"},
        {"futureTopLevel", "keep-me"},
        {"exportSettings",
         {{"pdf", {{"defaultPageSize", "b5"}, {"textFont", "noto-sans"}, {"futurePdfOpt", 42}}},
          {"mobi", {{"format", "mobi7"}}},
          {"txt", {{"encodingMode", "language"}, {"encodings", {{"ru", "koi8-r"}}}}},
          {"futureFormat", {{"enabled", true}}}}}};
    atomic_file::write_atomic(batch_file, older_file.dump(2));

    const json upgraded = f.ws.call("batch.settings.get", json::object());
    REQUIRE(upgraded.contains("result"));
    CHECK(upgraded["result"]["hasStored"] == true);
    const json& u = upgraded["result"]["settings"];
    CHECK(u["fixBroken"] == true);
    CHECK(u["inPlace"] == true);
    CHECK(u["futureTopLevel"] == "keep-me");
    // Old values loaded fully:
    CHECK(u["exportSettings"]["pdf"]["defaultPageSize"] == "b5");
    CHECK(u["exportSettings"]["pdf"]["textFont"] == "noto-sans");
    CHECK(u["exportSettings"]["pdf"]["futurePdfOpt"] == 42);
    CHECK(u["exportSettings"]["mobi"]["format"] == "mobi7");
    CHECK(u["exportSettings"]["txt"]["encodingMode"] == "language");
    CHECK(u["exportSettings"]["txt"]["encodings"]["ru"] == "koi8-r");
    CHECK(u["exportSettings"]["futureFormat"]["enabled"] == true);
    // Missing/new parameters inside existing sections take schema defaults (not global overrides!):
    CHECK(u["exportSettings"]["pdf"]["customMargin"] == 22);
    CHECK(u["exportSettings"]["pdf"]["customTextSize"] == 115);
    CHECK(u["exportSettings"]["mobi"]["tocPlacement"] == "afterTitle");
    CHECK(u["exportSettings"]["mobi"]["kf8PopupFootnotes"] == true);
    CHECK(u["exportSettings"]["txt"]["encodings"]["en"] == "windows-1252");
    CHECK(u["exportSettings"]["txt"]["encodings"]["uk"] == "windows-1251");
    CHECK(u["exportSettings"]["txt"]["bom"] == false);
    // Missing whole section (`markdown`) inherits from global copy (`includePictures: false`):
    CHECK(u["exportSettings"]["markdown"]["includePictures"] == false);

    // Save upgraded settings (e.g. after OK/Apply) -> full updated structure persisted to disk.
    const json save_upgraded = f.ws.call("batch.settings.save", json{{"settings", u}});
    REQUIRE(save_upgraded.contains("result"));
    const json on_disk = json::parse(atomic_file::read_file(batch_file));
    CHECK(on_disk["exportSettings"]["pdf"]["defaultPageSize"] == "b5");
    CHECK(on_disk["exportSettings"]["pdf"]["customMargin"] == 22);
    CHECK(on_disk["exportSettings"]["pdf"]["futurePdfOpt"] == 42);
    CHECK(on_disk["exportSettings"]["txt"]["encodings"]["ru"] == "koi8-r");
    CHECK(on_disk["exportSettings"]["txt"]["encodings"]["uk"] == "windows-1251");
    CHECK(on_disk["futureTopLevel"] == "keep-me");

    // 4. Last-to-close wins across concurrent dialogs + 1-2 core omission preserves parallel:
    json dialog_a = f.ws.call("batch.settings.get", json::object())["result"]["settings"];
    json dialog_b = f.ws.call("batch.settings.get", json::object())["result"]["settings"];
    dialog_a["sourceDir"] = "/dialog-a";
    dialog_a["parallel"] = true;
    dialog_a["workerCount"] = 6;
    dialog_b["sourceDir"] = "/dialog-b";
    dialog_b.erase("parallel");
    dialog_b.erase("workerCount");
    REQUIRE(f.ws.call("batch.settings.save", json{{"settings", dialog_a}}).contains("result"));
    REQUIRE(f.ws.call("batch.settings.save", json{{"settings", dialog_b}}).contains("result"));

    const json winner = f.ws.call("batch.settings.get", json::object())["result"]["settings"];
    CHECK(winner["sourceDir"] == "/dialog-b");
    CHECK(winner["parallel"] == true);
    CHECK(winner["workerCount"] == 6);
}
