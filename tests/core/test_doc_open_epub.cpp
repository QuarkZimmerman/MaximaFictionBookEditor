// Feature 012 (T013, D14, guard G18): File > Open takes FB2, FBD and ZIP archives with an FB2
// inside, nothing else. An EPUB - a ZIP archive, but another book format - is refused as a book the
// editor does not open, before it is searched for FB2 books; the files Open took before still open
// exactly as before.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <string>

using namespace mfbe;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-open-epub"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
    static std::string path(const char* folder, const char* name) {
        return platform::utf8_from_path((test::fixtures_dir() / folder / name).lexically_normal());
    }
    json call(const std::string& method, const json& params = json::object()) {
        return ws.call(method, params, 20000);
    }
};

int error_code(const json& response) {
    return response.contains("error") ? response["error"]["code"].get<int>() : 0;
}

}  // namespace

TEST_CASE("open epub: an EPUB is refused before it is read as a ZIP archive", "[epub][archive]") {
    Fixture f;
    for (const char* name : {"epub-3.0.epub", "epub-2.0.epub", "mimetype-late.epub"}) {
        INFO(name);
        const json opened = f.call("doc.open", json{{"path", Fixture::path("epub", name)}});
        CHECK(error_code(opened) == 1004);
        CHECK(opened["error"]["data"]["reason"] == "epub");
        const json source = f.call("doc.openSource", json{{"path", Fixture::path("epub", name)}});
        CHECK(error_code(source) == 1004);
    }
    // A file named .epub that is not an EPUB is not called one.
    const json not_zip = f.call("doc.open", json{{"path", Fixture::path("epub", "not-zip.epub")}});
    CHECK(error_code(not_zip) == 1004);
    CHECK(not_zip["error"]["data"]["reason"] != "epub");
}

TEST_CASE("open epub: FB2, FBD and ZIP-with-FB2 open as before (G18)", "[epub][archive]") {
    Fixture f;
    const json zip =
        f.call("doc.open", json{{"path", Fixture::path("archives", "single.fb2.zip")}});
    REQUIRE(zip.contains("result"));
    CHECK(zip["result"]["document"]["source"]["entry"] == "book.fb2");
    const json fb2 = f.call("doc.open", json{{"path", Fixture::path("books", "modern-utf8.fb2")}});
    CHECK(fb2.contains("result"));
    const json fbd = f.call("doc.open", json{{"path", Fixture::path("books", "descriptor.fbd")}});
    CHECK(fbd.contains("result"));
}
