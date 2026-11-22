// Feature 019 (T008; contracts/rpc-api.md): RPC contract tests for batch.*, app.info.cpuCores,
// test.setCpuCores, doc.open/doc.save ephemeral isolation, dialog.pickFolder.folder,
// pdf.export.abort cancelPrint flag, BatchState shutdown teardown, and concurrent txt.export ZIPs.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

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

TEST_CASE("app.info reports apiMinor 17 and cpuCores, overridable via test.setCpuCores",
          "[batch][rpc]") {
    BatchFixture f;
    const json info = f.ws.call("app.info");
    REQUIRE(info.contains("result"));
    CHECK(info["result"]["apiMinor"] == 17);
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
