// Feature 009, User Story 7 (T067): binary.rename over the real loopback server - the store
// entry moves to the new id with its bytes and place in document order unchanged; a name that is
// not an XML NCName is refused (binaryIdInvalid), so is another binary's id (binaryIdTaken) and
// an unknown binary (binaryNotFound).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>

#include <catch2/catch_test_macros.hpp>

#include <string>

using namespace mfbe;
using nlohmann::json;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-rename"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
    json call(const std::string& method, const json& params = json::object()) {
        return ws.call(method, params, 20000);
    }
};

int error_code(const json& response) {
    return response.contains("error") ? response["error"]["code"].get<int>() : 0;
}

json ids_of(const json& list) {
    json ids = json::array();
    for (const auto& meta : list) {
        ids.push_back(meta["id"]);
    }
    return ids;
}

}  // namespace

TEST_CASE("binary rename: the entry moves to the new id, its bytes and place kept", "[binary]") {
    Fixture f;
    const json opened = f.call(
        "doc.open", json{{"path", (test::fixtures_dir() / "books" / "fbe-pictures.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const std::string doc_id = opened["result"]["document"]["docId"];
    const json before = f.call("binary.list", json{{"docId", doc_id}})["result"];
    REQUIRE(ids_of(before) == json::array({"cover.jpg", "inline.png", "block.png"}));

    const json renamed = f.call("binary.rename", json{{"docId", doc_id},
                                                     {"id", "inline.png"},
                                                     {"newId", "\xD1\x80\xD0\xB8\xD1\x81-1.png"}});
    REQUIRE(renamed.contains("result"));
    CHECK(renamed["result"]["id"] == "\xD1\x80\xD0\xB8\xD1\x81-1.png");  // рис-1.png
    CHECK(renamed["result"]["size"] == before[1]["size"]);
    const json after = f.call("binary.list", json{{"docId", doc_id}})["result"];
    CHECK(ids_of(after) ==
          json::array({"cover.jpg", "\xD1\x80\xD0\xB8\xD1\x81-1.png", "block.png"}));

    // And back, as an Undo does.
    CHECK(f.call("binary.rename", json{{"docId", doc_id},
                                       {"id", "\xD1\x80\xD0\xB8\xD1\x81-1.png"},
                                       {"newId", "inline.png"}})
              .contains("result"));
    CHECK(ids_of(f.call("binary.list", json{{"docId", doc_id}})["result"]) == ids_of(before));
}

TEST_CASE("binary rename: invalid, taken and unknown ids are refused", "[binary]") {
    Fixture f;
    const json opened = f.call(
        "doc.open", json{{"path", (test::fixtures_dir() / "books" / "fbe-pictures.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const std::string doc_id = opened["result"]["document"]["docId"];
    auto rename = [&](const std::string& id, const std::string& new_id) {
        return f.call("binary.rename", json{{"docId", doc_id}, {"id", id}, {"newId", new_id}});
    };
    for (const char* invalid : {"1.jpg", "", "a b", "x:y", "-dash", ".dot"}) {
        INFO(invalid);
        const json answer = rename("cover.jpg", invalid);
        CHECK(error_code(answer) == 1011);
        CHECK(answer["error"]["data"]["newId"] == invalid);
    }
    const json taken = rename("cover.jpg", "block.png");
    CHECK(error_code(taken) == 1012);
    CHECK(taken["error"]["data"]["newId"] == "block.png");
    CHECK(error_code(rename("missing.png", "fine.png")) == 1010);
    // Valid names: a letter or "_" first, then letters, digits, ".", "-", "_".
    CHECK(rename("cover.jpg", "_cover-2.v1").contains("result"));
}
