// Feature 014 (contracts/rpc-api.md, contracts/print-service.md, tasks T014): the PDF export's
// methods and routes end to end in the core, the test acting as the journeys' print seam.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <string>
#include <thread>

using nlohmann::json;
using namespace mfbe;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-pdf-rpc"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        CoreServerOptions options;
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    std::map<std::string, std::string> auth() const { return {{"x-mfbe-token", server->token()}}; }

    // Waits for the job's job.done or job.failed and returns its params.
    json wait_job(const std::string& job_id) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
        while (std::chrono::steady_clock::now() < deadline) {
            auto msg = ws.receive_json(30000);
            if (!msg)
                break;
            const std::string name = msg->value("method", "");
            if ((name == "job.done" || name == "job.failed") &&
                (*msg)["params"]["jobId"] == job_id) {
                json out = (*msg)["params"];
                out["event"] = name;
                return out;
            }
        }
        FAIL("job " << job_id << " did not end");
        return {};
    }
};

std::string sample_pdf() {
    return atomic_file::read_file(test::fixtures_dir() / "pdf" / "chromium-sample.pdf");
}

}  // namespace

TEST_CASE("pdf export rpc: a part is uploaded, printed through the seam and written",
          "[pdf][rpc]") {
    Fixture f;
    const auto target = f.data.path() / "out" / "книга.pdf";
    std::filesystem::create_directories(target.parent_path());

    const json bad =
        f.ws.call("pdf.export.begin", json{{"path", target.string()}, {"pageSize", "a3"}});
    REQUIRE(bad.contains("error"));
    CHECK(bad["error"]["code"] == 1112);
    CHECK(bad["error"]["data"]["reason"] == "pdf.badPageSize");

    const json begun =
        f.ws.call("pdf.export.begin", json{{"path", target.string()}, {"pageSize", "a5"}});
    REQUIRE(begun.contains("result"));
    const std::string token = begun["result"]["token"];
    CHECK(begun["result"]["pageSize"] == "a5");
    REQUIRE(
        f.ws.call("pdf.export.document", json{{"token", token}, {"parts", 1}}).contains("result"));

    const std::string html = "<!doctype html><html><body><p>Страница</p></body></html>";
    const auto uploaded =
        test::http_request(f.server->port(), "PUT", "/pdf/" + token + "/part/0", f.auth(), html);
    CHECK(uploaded.status == 201);
    CHECK(
        test::http_request(f.server->port(), "PUT", "/pdf/" + token + "/part/0", {}, html).status ==
        401);
    CHECK(test::http_request(f.server->port(), "PUT", "/pdf/" + token + "/part/5", f.auth(), html)
              .status == 404);

    // The print browser's page: the part, with the ready signal before </body>.
    const auto served =
        test::http_get(f.server->port(), "/pdf/" + token + "/print/0?token=" + f.server->token());
    REQUIRE(served.status == 200);
    CHECK(served.body.find("<p>Страница</p>") != std::string::npos);
    CHECK(served.body.find("document.title='mfbe-print-ready'") < served.body.find("</body>"));

    const json printing = f.ws.call("pdf.export.print", json{{"token", token}, {"part", 0}});
    REQUIRE(printing.contains("result"));
    const std::string print_job = printing["result"]["jobId"];
    json requests;
    for (int i = 0; i < 50 && (requests.empty() || requests.size() == 0); ++i) {
        requests = f.ws.call("test.printRequests")["result"];
        if (requests.empty())
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    REQUIRE(requests.size() == 1);
    CHECK(requests[0]["paperWidthIn"].get<double>() == 148.0 / 25.4);
    CHECK(requests[0]["paperHeightIn"].get<double>() == 210.0 / 25.4);
    const std::string url = requests[0]["url"];
    CHECK(url.find("/pdf/" + token + "/print/0?token=") != std::string::npos);
    const std::string printed = sample_pdf();
    CHECK(test::http_request(f.server->port(), "PUT",
                             "/test/print/" + requests[0]["jobId"].get<std::string>(), f.auth(),
                             printed)
              .status == 201);
    const json print_done = f.wait_job(print_job);
    CHECK(print_done["event"] == "job.done");

    const json finishing =
        f.ws.call("pdf.export.finish", json{{"token", token}, {"pageMap", json::object()}});
    REQUIRE(finishing.contains("result"));
    const json finish_done = f.wait_job(finishing["result"]["jobId"]);
    REQUIRE(finish_done["event"] == "job.done");
    // The printed file was finished (finish.cpp): a PDF with the PDF/A-2 level U declaration.
    const std::string written = atomic_file::read_file(target);
    CHECK(written.rfind("%PDF-", 0) == 0);
    CHECK(written.find("<pdfaid:part>2</pdfaid:part>") != std::string::npos);
    CHECK(written.find("/OutputIntents") != std::string::npos);
    // The export's folder is gone, and its token with it.
    CHECK_FALSE(std::filesystem::exists(f.data.path() / "pdf-export" / token));
    const json again = f.ws.call("pdf.export.print", json{{"token", token}, {"part", 0}});
    CHECK(again["error"]["data"]["reason"] == "pdf.unknownToken");
}

TEST_CASE("pdf export rpc: a failed print and an abort leave nothing behind", "[pdf][rpc]") {
    Fixture f;
    const auto target = f.data.path() / "never.pdf";
    const std::string token =
        f.ws.call("pdf.export.begin",
                  json{{"path", target.string()}, {"pageSize", "letter"}})["result"]["token"];
    const json printing = f.ws.call("pdf.export.print", json{{"token", token}, {"part", 0}});
    const std::string print_job = printing["result"]["jobId"];
    json requests;
    for (int i = 0; i < 50 && requests.empty(); ++i) {
        requests = f.ws.call("test.printRequests")["result"];
        if (requests.empty())
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    REQUIRE(requests.size() == 1);
    CHECK(requests[0]["paperWidthIn"] == 8.5);
    CHECK(f.ws.call("test.completePrint", json{{"jobId", requests[0]["jobId"]},
                                               {"message", "no fonts"}})["result"]["known"] ==
          true);
    const json failed = f.wait_job(print_job);
    REQUIRE(failed["event"] == "job.failed");
    CHECK(failed["error"]["data"]["reason"] == "pdf.printFailed");
    CHECK(failed["error"]["data"]["message"] == "no fonts");

    CHECK(f.ws.call("pdf.export.abort", json{{"token", token}})["result"]["known"] == true);
    CHECK(f.ws.call("pdf.export.abort", json{{"token", token}})["result"]["known"] == false);
    CHECK_FALSE(std::filesystem::exists(target));
    CHECK_FALSE(std::filesystem::exists(f.data.path() / "pdf-export" / token));
}

TEST_CASE("pdf export rpc: the shipped fonts are served to the paged document", "[pdf][rpc]") {
    Fixture f;
    const std::string query = "?token=" + f.server->token();
    const auto regular =
        test::http_get(f.server->port(), "/pdf/fonts/shipped/noto-serif/Regular" + query);
    REQUIRE(regular.status == 200);
    CHECK(regular.headers.at("content-type") == "font/ttf");
    REQUIRE(regular.body.size() > 100000);
    CHECK(regular.body.compare(0, 4, std::string("\x00\x01\x00\x00", 4)) == 0);  // TrueType
    CHECK(test::http_get(f.server->port(), "/pdf/fonts/shipped/dejavu-sans-mono/BoldItalic" + query)
              .status == 200);
    CHECK(test::http_get(f.server->port(), "/pdf/fonts/shipped/noto-serif/Light" + query).status ==
          404);
    CHECK(test::http_get(f.server->port(), "/pdf/fonts/shipped/nothing/Regular" + query).status ==
          404);
    CHECK(test::http_get(f.server->port(), "/pdf/fonts/shipped/noto-serif/Regular").status == 401);
}
