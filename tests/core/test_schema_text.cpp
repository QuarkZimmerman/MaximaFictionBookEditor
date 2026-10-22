// Feature 005 (T023): schema.text - the five XSD files of the FB2 2.1 schema byte-identical to
// resources/schema/*.xsd, in the contract's order, with the licence notice; 1002 for a file
// missing under a temporary --resources folder; schema.element is not registered in 0.0.5.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/validator.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <filesystem>
#include <string>

using namespace mfbe;
using Catch::Matchers::EndsWith;
using nlohmann::json;

namespace {

std::filesystem::path resources_root() {
    return test::fixtures_dir().parent_path().parent_path() / "resources";
}

const char* const kFiles[] = {"FictionBook.xsd", "FictionBookGenres.xsd", "FictionBookLang.xsd",
                              "FictionBookLinks.xsd", "FictionNotes.xsd"};

}  // namespace

TEST_CASE("schema.text: the five XSD files byte-exact in order with the notice",
          "[server][schema]") {
    test::TempDir data{"mfbe-schema-text"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    const json response = ws.call("schema.text");
    REQUIRE(response.contains("result"));
    const json& result = response["result"];
    REQUIRE(result["files"].is_array());
    REQUIRE(result["files"].size() == 5);
    std::size_t total = 0;
    for (std::size_t i = 0; i < 5; ++i) {
        const json& file = result["files"][i];
        INFO(kFiles[i]);
        CHECK(file["name"] == kFiles[i]);
        const std::string on_disk = test::read_text(resources_root() / "schema" / kFiles[i]);
        REQUIRE_FALSE(on_disk.empty());
        CHECK(file["text"].get<std::string>() == on_disk);  // byte-exact, line endings included
        total += on_disk.size();
    }
    CHECK(total > 50 * 1024);
    CHECK(result["notice"].get<std::string>() ==
          test::read_text(resources_root() / "schema" / "LICENSE.md"));
    CHECK_THAT(result["notice"].get<std::string>(),
               Catch::Matchers::ContainsSubstring("Copyright (c) 2004, Dmitry Gribov"));
    CHECK(result.size() == 2);
    // The second call reads the files again (no cache to go stale) and answers the same.
    CHECK(ws.call("schema.text")["result"] == result);
    // Parameters are ignored; a document is not needed.
    CHECK(ws.call("schema.text", json{{"anything", 1}})["result"] == result);
    // schema.element is reserved for a later minor: not registered in 0.0.5.
    CHECK(ws.call("schema.element", json{{"name", "section"}})["error"]["code"] == -32601);
}

TEST_CASE("schema.text: a file missing under a temporary --resources is 1002 doc.ioError",
          "[server][schema]") {
    const std::filesystem::path original_schema_dir = validation::schema_dir();
    test::TempDir tmp{"mfbe-schema-missing"};
    const std::filesystem::path resources = tmp / "resources";
    // A resources folder like the shipped one, its schema without FictionNotes.xsd.
    std::filesystem::create_directories(resources);
    for (const char* name : {"genres", "schema"}) {
        std::filesystem::copy(resources_root() / name, resources / name,
                              std::filesystem::copy_options::recursive);
    }
    for (const char* name : {"languages.json", "symbols.ini", "blank.fb2"}) {
        std::filesystem::copy_file(resources_root() / name, resources / name);
    }
    std::filesystem::remove(resources / "schema" / "FictionNotes.xsd");
    {
        test::TempDir data{"mfbe-schema-text-data"};
        CoreServerOptions options;
        options.data_dir = data.path().string();
        options.resources_dir = resources.string();
        auto server = CoreServer::start(options);
        test::WsClient ws;
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
        const json response = ws.call("schema.text");
        REQUIRE(response.contains("error"));
        CHECK(response["error"]["code"] == 1002);
        CHECK(response["error"]["message"] == "doc.ioError");
        CHECK_THAT(response["error"]["data"]["path"].get<std::string>(),
                   EndsWith("FictionNotes.xsd"));
        CHECK(response["error"]["data"]["reason"] == "file not found");
        // The other files are still read from that folder.
        std::filesystem::copy_file(resources_root() / "schema" / "FictionNotes.xsd",
                                   resources / "schema" / "FictionNotes.xsd");
        const json fixed = ws.call("schema.text");
        REQUIRE(fixed.contains("result"));
        CHECK(fixed["result"]["files"][4]["name"] == "FictionNotes.xsd");
    }
    // The schema folder is process-wide: the later tests get the shipped one back.
    validation::set_schema_dir(original_schema_dir);
}
