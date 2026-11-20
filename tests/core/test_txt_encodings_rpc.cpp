// Feature 017 (T010; D11, DP-2): txt.encodings answers UTF-8 and the 28 single-byte encodings, and
// the lists of Russian, Ukrainian and English books in the contract's order.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

using nlohmann::json;
using namespace mfbe;

TEST_CASE("txt.encodings answers the encodings and the lists of D11", "[txt][rpc]") {
    test::TempDir data{"mfbe-txt-encodings"};
    CoreServerOptions options;
    options.data_dir = platform::utf8_from_path(data.path());
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const json r = ws.call("txt.encodings", json::object())["result"];
    REQUIRE(r["all"].size() == 29);
    CHECK(r["all"][0]["name"] == "utf-8");
    CHECK(r["all"][1]["name"] == "ibm866");
    CHECK(r["all"][28]["name"] == "iso-8859-1");
    CHECK(r["all"][19]["labelKey"] == "txt.encoding.windows-1251");
    CHECK(r["ru"] == json::array({"utf-8", "windows-1251", "koi8-r", "ibm866", "iso-8859-5", "koi8-u",
                                  "x-mac-cyrillic"}));
    CHECK(r["uk"] == json::array({"utf-8", "windows-1251", "koi8-u", "x-mac-cyrillic"}));
    CHECK(r["en"] ==
          json::array({"utf-8", "windows-1252", "iso-8859-1", "iso-8859-15", "macintosh"}));
}
