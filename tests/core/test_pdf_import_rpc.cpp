// Feature 016 (contracts/rpc-api.md; tasks T009): the PDF import's methods and routes end to end in
// the core, with the real reader process.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>

using nlohmann::json;
using namespace mfbe;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-pdf-import-rpc"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
    std::map<std::string, std::string> auth() const { return {{"x-mfbe-token", server->token()}}; }
    json wait_job(const std::string& job_id) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
        while (std::chrono::steady_clock::now() < deadline) {
            auto msg = ws.receive_json(30000);
            if (!msg) {
                break;
            }
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
    std::string begin(const std::filesystem::path& pdf) {
        const json r = ws.call("pdfImport.begin", json{{"path", platform::utf8_from_path(pdf)}});
        REQUIRE(r.contains("result"));
        return r["result"]["token"];
    }
};

std::filesystem::path fixture(const std::string& name) {
    return test::fixtures_dir() / "pdf" / "import" / name;
}

}  // namespace

TEST_CASE("pdfImport reads a PDF and serves its document and pages", "[pdf][import][rpc]") {
    Fixture f;
    const std::string token = f.begin(fixture("text-untagged.pdf"));
    const json opened = f.ws.call("pdfImport.inspect", json{{"token", token}}, 30000);
    REQUIRE(opened["result"]["opened"] == true);
    CHECK(opened["result"]["pages"] == 2);
    const json job = f.ws.call("pdfImport.read", json{{"token", token}});
    const json done = f.wait_job(job["result"]["jobId"]);
    REQUIRE(done["event"] == "job.done");
    CHECK(done["result"]["pages"] == 2);
    const auto doc =
        test::http_get(f.server->port(), "/pdf-import/" + token + "/document", f.auth());
    REQUIRE(doc.status == 200);
    CHECK(json::parse(doc.body)["pages"] == 2);
    const auto page =
        test::http_get(f.server->port(), "/pdf-import/" + token + "/page/1", f.auth());
    REQUIRE(page.status == 200);
    CHECK(page.body.find("harbour") != std::string::npos);
    CHECK(test::http_get(f.server->port(), "/pdf-import/" + token + "/page/1").status == 401);
    CHECK(test::http_get(f.server->port(), "/pdf-import/" + token + "/../x", f.auth()).status ==
          404);
    f.ws.call("pdfImport.end", json{{"token", token}});
    CHECK(test::http_get(f.server->port(), "/pdf-import/" + token + "/document", f.auth()).status ==
          404);
}

TEST_CASE("pdfImport lists an archive's PDFs and FBDs and reads the one chosen",
          "[pdf][import][rpc]") {
    Fixture f;
    const std::string pdf = atomic_file::read_file(fixture("text-untagged.pdf"));
    const std::string zip = archive::zip_entries(
        {{"books/a.pdf", pdf}, {"books/A.fbd", "<FictionBook/>"}, {"b.PDF", pdf}});
    const auto path = f.data.path() / "two.zip";
    std::ofstream(path, std::ios::binary) << zip;
    const json listed =
        f.ws.call("pdfImport.begin", json{{"path", platform::utf8_from_path(path)}});
    REQUIRE(listed["result"]["archive"]["pdfs"].size() == 2);
    CHECK(listed["result"]["archive"]["fbds"][0]["entry"] == "books/A.fbd");
    CHECK(listed["result"]["archive"]["pdfs"][0]["size"] == pdf.size());
    const json begun = f.ws.call(
        "pdfImport.begin", json{{"path", platform::utf8_from_path(path)}, {"entry", "b.PDF"}});
    const std::string token = begun["result"]["token"];
    CHECK(f.ws.call("pdfImport.inspect", json{{"token", token}}, 30000)["result"]["opened"] ==
          true);
    f.ws.call("pdfImport.end", json{{"token", token}});
}

TEST_CASE("pdfImport refuses what is not a PDF, and unknown tokens", "[pdf][import][rpc]") {
    Fixture f;
    const auto path = f.data.path() / "not.pdf";
    std::ofstream(path) << "hello";
    const json r = f.ws.call("pdfImport.begin", json{{"path", platform::utf8_from_path(path)}});
    REQUIRE(r.contains("error"));
    CHECK(r["error"]["code"] == 1113);
    CHECK(r["error"]["data"]["reason"] == "notPdf");
    CHECK(f.ws.call("pdfImport.inspect", json{{"token", "nope"}})["error"]["code"] == 1114);
}

TEST_CASE("pdfImport hands a password to the reader", "[pdf][import][rpc]") {
    Fixture f;
    const std::string token = f.begin(fixture("password-user.pdf"));
    CHECK(f.ws.call("pdfImport.inspect", json{{"token", token}},
                    30000)["result"]["needsPassword"] == true);
    const json wrong =
        f.ws.call("pdfImport.password", json{{"token", token}, {"password", "nope"}}, 30000);
    CHECK(wrong["result"]["wrongPassword"] == true);
    const json right =
        f.ws.call("pdfImport.password", json{{"token", token}, {"password", "secret"}}, 30000);
    CHECK(right["result"]["opened"] == true);
    f.ws.call("pdfImport.end", json{{"token", token}});
}

TEST_CASE("pdfImport adds the pictures the import takes to the new book", "[pdf][import][rpc]") {
    Fixture f;
    const std::string token = f.begin(fixture("text-untagged.pdf"));
    f.ws.call("pdfImport.inspect", json{{"token", token}}, 30000);
    f.wait_job(f.ws.call("pdfImport.read", json{{"token", token}})["result"]["jobId"]);
    const json created = f.ws.call("doc.new");
    REQUIRE(created.contains("result"));
    const std::string doc_id = created["result"]["docId"];
    const auto page = json::parse(
        test::http_get(f.server->port(), "/pdf-import/" + token + "/page/1", f.auth()).body);
    const std::string id = page["pictures"][0]["id"];
    // A job (D32): the core goes on serving while the reader gives the pictures.
    const json done = f.wait_job(f.ws.call(
        "pdfImport.addPictures",
        json{{"token", token},
             {"docId", doc_id},
             {"pictures", json::array({{{"id", id}, {"page", 1}, {"suggestedId", "fig"}}})}},
        30000)["result"]["jobId"]);
    REQUIRE(done["event"] == "job.done");
    const json& added = done["result"];
    REQUIRE(added["added"].size() == 1);
    CHECK(added["added"][0]["binary"]["contentType"] == "image/jpeg");
    f.ws.call("pdfImport.end", json{{"token", token}});
}

TEST_CASE(
    "pdfImport hands 004's reader an archive's FBD and the editor's record as files (D22, D23)",
    "[pdf][import][rpc]") {
    Fixture f;
    const auto zip = [](const char* name) {
        return platform::utf8_from_path(test::fixtures_dir() / "pdf" / "import" / "zip" / name);
    };
    // A PDF not made by the editor, with an FBD: the FBD comes out; there is no record.
    json begun =
        f.ws.call("pdfImport.begin", json{{"path", zip("one.zip")}, {"entry", "book.pdf"}});
    std::string token = begun["result"]["token"];
    REQUIRE(f.ws.call("pdfImport.inspect", json{{"token", token}}, 30000)["result"]["opened"] ==
            true);
    const json fbd = f.ws.call("pdfImport.extractFbd",
                               json{{"token", token}, {"entry", "book-description.fbd"}});
    REQUIRE(fbd.contains("result"));
    CHECK(atomic_file::read_file(platform::path_from_utf8(fbd["result"]["path"].get<std::string>()))
              .find("The FBD Title") != std::string::npos);
    CHECK(f.ws.call("pdfImport.recordFbd", json{{"token", token}})["error"]["code"] == 1113);
    CHECK(f.ws.call("pdfImport.extractFbd",
                    json{{"token", token}, {"entry", "book.pdf"}})["error"]["code"] == 1113);
    f.ws.call("pdfImport.end", json{{"token", token}});
    // The editor's own PDF: its record as an FBD file.
    begun = f.ws.call("pdfImport.begin",
                      json{{"path", zip("own-same.zip")}, {"entry", "reference.pdf"}});
    token = begun["result"]["token"];
    REQUIRE(f.ws.call("pdfImport.inspect", json{{"token", token}}, 30000)["result"]["opened"] ==
            true);
    const json record = f.ws.call("pdfImport.recordFbd", json{{"token", token}});
    REQUIRE(record.contains("result"));
    CHECK(atomic_file::read_file(
              platform::path_from_utf8(record["result"]["path"].get<std::string>()))
              .find("<book-title>The Reference Book</book-title>") != std::string::npos);
    f.ws.call("pdfImport.end", json{{"token", token}});
}
