// Feature 017 (T020; D33, DP-11): files.fbdBeside - the FBD in a file's folder with its name, the
// exact name first, else the only one equal apart from letter case, else none.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/case_fold.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <fstream>

using nlohmann::json;
using namespace mfbe;

namespace {

void touch(const std::filesystem::path& file) { std::ofstream(file) << "x"; }

}  // namespace

TEST_CASE("case folding sets letter case aside in Latin, Cyrillic and Greek names", "[txt][fbd]") {
    CHECK(text::fold_case("Book.TXT") == "book.txt");
    CHECK(text::fold_case("\xD0\x9A\xD0\x9D\xD0\x98\xD0\x93\xD0\x90") ==
          "\xD0\xBA\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB0");  // КНИГА -> книга
    CHECK(text::fold_case("\xD0\x84\xD0\x86\xD0\x87\xD2\x90") ==
          "\xD1\x94\xD1\x96\xD1\x97\xD2\x91");  // ЄІЇҐ -> єіїґ
    CHECK(text::fold_case("\xC3\x89t\xC3\xA9") == "\xC3\xA9t\xC3\xA9");  // Été -> été
}

TEST_CASE("files.fbdBeside finds the FBD with the file's name", "[txt][fbd][rpc]") {
    test::TempDir data{"mfbe-fbd-beside"};
    test::TempDir folder{"mfbe-fbd-beside-books"};
    CoreServerOptions options;
    options.data_dir = platform::utf8_from_path(data.path());
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const auto beside = [&](const std::string& name) {
        return ws.call("files.fbdBeside",
                       json{{"path", platform::utf8_from_path(folder.path() / platform::path_from_utf8(name))}});
    };
    touch(folder.path() / "Book.txt");
    touch(folder.path() / "Book.fbd");
    CHECK(beside("Book.txt")["result"]["path"] ==
          platform::utf8_from_path(folder.path() / "Book.fbd"));
    // Letter case set aside when only one name fits.
    touch(folder.path() / platform::path_from_utf8("\xD0\x9A\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB0.txt"));
    touch(folder.path() / platform::path_from_utf8("\xD0\x9A\xD0\x9D\xD0\x98\xD0\x93\xD0\x90.FBD"));
    CHECK(beside("\xD0\x9A\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB0.txt")["result"]["path"] ==
          platform::utf8_from_path(folder.path() /
                                   platform::path_from_utf8("\xD0\x9A\xD0\x9D\xD0\x98\xD0\x93\xD0\x90.FBD")));
    // Two that differ only in case, neither exact: none. They can exist side by side only where the file
    // system tells letter case apart (Linux); on macOS and Windows the second is the first, found by its name.
    touch(folder.path() / "two.txt");
    touch(folder.path() / "TWO.fbd");
    if (std::filesystem::exists(folder.path() / "TWO.TXT")) {
        CHECK(beside("two.txt")["result"]["path"] == platform::utf8_from_path(folder.path() / "TWO.fbd"));
    } else {
        touch(folder.path() / "Two.fbd");
        CHECK_FALSE(beside("two.txt")["result"].contains("path"));
    }
    touch(folder.path() / "alone.txt");
    CHECK_FALSE(beside("alone.txt")["result"].contains("path"));
    CHECK(ws.call("files.fbdBeside", json{{"path", "relative.txt"}}).contains("error"));
}
