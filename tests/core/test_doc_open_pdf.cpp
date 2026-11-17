// Feature 016 (D4, DP-19; tasks T033): File > Open does not take a PDF - it is refused as a book
// the editor does not open, pointing to File > Import > PDF File; a ZIP archive holding a PDF but
// no book says so too.
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
    test::TempDir data{"mfbe-open-pdf"};
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

}  // namespace

TEST_CASE("open pdf: a PDF is refused, pointing to the PDF import", "[pdf][import][archive]") {
    Fixture f;
    const auto pdf = test::fixtures_dir() / "pdf" / "import" / "text-untagged.pdf";
    const json opened = f.ws.call("doc.open", json{{"path", platform::utf8_from_path(pdf)}}, 20000);
    REQUIRE(opened.contains("error"));
    CHECK(opened["error"]["code"] == 1004);
    CHECK(opened["error"]["data"]["reason"] == "pdf");
}

TEST_CASE("open pdf: an archive with a PDF but no book points to the PDF import",
          "[pdf][import][archive]") {
    Fixture f;
    const std::string bytes =
        atomic_file::read_file(test::fixtures_dir() / "pdf" / "import" / "text-untagged.pdf");
    const auto zip = f.data.path() / "book.zip";
    std::ofstream(zip, std::ios::binary) << archive::zip_one("book.pdf", bytes);
    const json opened = f.ws.call("doc.open", json{{"path", platform::utf8_from_path(zip)}}, 20000);
    REQUIRE(opened.contains("error"));
    CHECK(opened["error"]["code"] == 1081);
    CHECK(opened["error"]["data"]["reason"] == "pdfInArchive");
}
