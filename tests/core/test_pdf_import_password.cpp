// Feature 016 (User Story 5; D26, DP-16; tasks T054): PDFs protected by passwords. The reader takes
// the user's password - and, for a PDF that forbids copying its text, the owner's - through its
// standard input, asks again after a wrong one and ends on an empty one; the core passes the
// password on and keeps it nowhere: neither its errors-only log nor any other file of the data
// folder holds it.
#include "pdf/import/reader_process.hpp"
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

using namespace std::chrono_literals;
using nlohmann::json;
using namespace mfbe;

namespace {

const std::filesystem::path kImport = test::fixtures_dir() / "pdf" / "import";

struct Reader {
    std::filesystem::path folder;
    std::unique_ptr<pdf_import::ReaderProcess> process;
    explicit Reader(const char* name) {
        folder = std::filesystem::temp_directory_path() / (std::string("mfbe-password-") + name);
        std::filesystem::remove_all(folder);
        std::filesystem::create_directories(folder);
        pdf_import::ReaderOptions o;
        o.reader = pdf_import::find_reader();
        o.pdf = kImport / (std::string(name) + ".pdf");
        o.folder = folder;
        std::string error;
        process = pdf_import::ReaderProcess::start(o, error);
        REQUIRE(process);
    }
    ~Reader() {
        process.reset();
        std::filesystem::remove_all(folder);
    }
    std::string next() {
        std::string line;
        REQUIRE(process->next_event(line, 60s));
        return json::parse(line).value("event", "");
    }
    json until_end() {
        std::string line;
        while (process->next_event(line, 60s)) {
            const json e = json::parse(line);
            if (e.value("event", "") == "done" || e.value("event", "") == "failed") {
                return e;
            }
        }
        return {};
    }
};

}  // namespace

TEST_CASE("the reader takes a user's password, asking again after a wrong one (D26)",
          "[pdf][import]") {
    Reader r("password-user");
    CHECK(r.next() == "needs-password");
    REQUIRE(r.process->send_line("not the password"));
    CHECK(r.next() == "wrong-password");
    REQUIRE(r.process->send_line("secret"));
    CHECK(r.next() == "opened");
    CHECK(r.until_end().value("event", "") == "done");
}

TEST_CASE("an empty line ends the import: no password, no owner's password (D26)",
          "[pdf][import]") {
    {
        Reader r("password-user");
        CHECK(r.next() == "needs-password");
        REQUIRE(r.process->send_line(""));
        CHECK(r.until_end().value("reason", "") == "passwordCancelled");
    }
    {
        Reader r("copy-restricted");
        CHECK(r.next() == "owner-password");
        REQUIRE(r.process->send_line(""));
        CHECK(r.until_end().value("reason", "") == "copyForbidden");
    }
}

TEST_CASE("a PDF that forbids copying its text is read with its owner's password (D26)",
          "[pdf][import]") {
    Reader r("copy-restricted");
    CHECK(r.next() == "owner-password");
    REQUIRE(r.process->send_line("owner"));
    CHECK(r.next() == "opened");
    CHECK(r.until_end().value("event", "") == "done");
}

TEST_CASE("the core keeps no password, in its log or any file (DP-16)", "[pdf][import][rpc]") {
    test::TempDir data{"mfbe-pdf-password"};
    CoreServerOptions options;
    options.data_dir = platform::utf8_from_path(data.path());
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const json begun = ws.call(
        "pdfImport.begin", json{{"path", platform::utf8_from_path(kImport / "password-user.pdf")}});
    const std::string token = begun["result"]["token"];
    CHECK(ws.call("pdfImport.inspect", json{{"token", token}}, 30000)["result"]["needsPassword"] ==
          true);
    CHECK(ws.call("pdfImport.password", json{{"token", token}, {"password", "Zq7-wrong"}},
                  30000)["result"]["wrongPassword"] == true);
    CHECK(ws.call("pdfImport.password", json{{"token", token}, {"password", "secret"}},
                  30000)["result"]["opened"] == true);
    // A failing call is logged - its method and code, never its parameters.
    CHECK(ws.call("pdfImport.password",
                  json{{"token", "unknown"}, {"password", "Zq7-unknown"}})["error"]["code"] ==
          1114);
    ws.call("pdfImport.end", json{{"token", token}});
    server.reset();
    for (const auto& entry : std::filesystem::recursive_directory_iterator(data.path())) {
        if (!entry.is_regular_file()) {
            continue;
        }
        std::ifstream in(entry.path(), std::ios::binary);
        std::stringstream bytes;
        bytes << in.rdbuf();
        INFO(entry.path().string());
        CHECK(bytes.str().find("Zq7") == std::string::npos);
        CHECK(bytes.str().find("secret") == std::string::npos);
    }
}
