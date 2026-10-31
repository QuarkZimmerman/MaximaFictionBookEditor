// Feature 007 (T040, contracts/rpc-api.md §3.x of the feature, FR-024): files.saveText and
// files.saveBinaries, the core side of the script API's mfbe.files. The native dialogs are the
// core's queued test stand-ins (test.enqueueDialog); the writes are atomic; a script never sees
// a folder: saveText answers the file name alone, saveBinaries a folder token kept in the core
// for the document, valid until it closes.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <memory>
#include <string>

using namespace mfbe;
using nlohmann::json;

namespace {

namespace fs = std::filesystem;

std::string utf8(const fs::path& path) {
    return platform::utf8_from_path(path);
}

struct FilesServer {
    test::TempDir tmp{"mfbe-files"};
    fs::path out = tmp / "Отчёты";
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    FilesServer() {
        fs::create_directories(out);
        CoreServerOptions options;
        options.data_dir = utf8(tmp / "data");
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    json call(const std::string& method, const json& params = json::object()) {
        return ws.call(method, params);
    }

    json result(const std::string& method, const json& params = json::object()) {
        const json response = ws.call(method, params);
        INFO(method << " -> " << response.dump());
        REQUIRE(response.contains("result"));
        return response["result"];
    }

    void answer(const std::string& method, const json& result) {
        REQUIRE(call("test.enqueueDialog", json{{"method", method}, {"result", result}})
                    .contains("result"));
    }

    std::string binary_bytes(const std::string& doc_id, const std::string& id) {
        const test::HttpResponse response = test::http_get(
            server->port(), "/binary/" + doc_id + "/" + id + "?token=" + server->token());
        REQUIRE(response.status == 200);
        return response.body;
    }
};

}  // namespace

TEST_CASE("files.saveText writes the text atomically in the chosen encoding", "[files][server]") {
    FilesServer f;
    const std::string text = "Статистика: «книга»\nвторая строка";

    // UTF-8 by default, no BOM; the answer names the file, never the folder.
    f.answer("dialog.saveFile", json{{"path", utf8(f.out / "report.txt")}});
    const json saved = f.result("files.saveText",
                                json{{"suggestedName", "report.txt"}, {"text", text}});
    CHECK(saved == json{{"saved", true}, {"name", "report.txt"}});
    CHECK(test::read_text(f.out / "report.txt") == text);
    // The Save dialog proposed the name and offered the text files.
    const json requests = f.result("test.dialogRequests");
    REQUIRE(requests.size() == 1);
    CHECK(requests[0]["method"] == "dialog.saveFile");
    CHECK(requests[0]["defaultPath"] == "report.txt");
    CHECK(requests[0]["filters"][0]["extensions"] == json::array({"txt"}));

    // UTF-16 with a BOM, little endian.
    f.answer("dialog.saveFile", json{{"path", utf8(f.out / "report16.txt")}});
    CHECK(f.result("files.saveText", json{{"suggestedName", "report16.txt"},
                                          {"text", "Ёж"},
                                          {"encoding", "utf-16"}})["saved"] == true);
    CHECK(test::read_text(f.out / "report16.txt") == std::string("\xFF\xFE\x01\x04\x36\x04", 6));

    // windows-1251.
    f.answer("dialog.saveFile", json{{"path", utf8(f.out / "report1251.html")}});
    CHECK(f.result("files.saveText", json{{"suggestedName", "report1251.html"},
                                          {"text", "Ёж"},
                                          {"encoding", "windows-1251"},
                                          {"title", "Сохранить отчёт"}})["name"] ==
          "report1251.html");
    CHECK(test::read_text(f.out / "report1251.html") == std::string("\xA8\xE6", 2));
    const json html = f.result("test.dialogRequests")[2];
    CHECK(html["title"] == "Сохранить отчёт");
    CHECK(html["filters"][0]["extensions"] == json::array({"html", "htm"}));

    // A cancelled dialog is no error.
    f.answer("dialog.saveFile", json::object());
    CHECK(f.result("files.saveText", json{{"suggestedName", "x.txt"}, {"text", "x"}}) ==
          json{{"saved", false}});

    // Parameters: the name is a file name, the text a string, the encoding one of three.
    const auto field_of = [&](const json& params) {
        const json response = f.call("files.saveText", params);
        REQUIRE(response.contains("error"));
        CHECK(response["error"]["code"] == -32602);
        return response["error"]["data"]["field"].get<std::string>();
    };
    CHECK(field_of(json{{"text", "x"}}) == "suggestedName");
    CHECK(field_of(json{{"suggestedName", "../x.txt"}, {"text", "x"}}) == "suggestedName");
    CHECK(field_of(json{{"suggestedName", "a/b.txt"}, {"text", "x"}}) == "suggestedName");
    CHECK(field_of(json{{"suggestedName", "x.txt"}, {"text", 5}}) == "text");
    CHECK(field_of(json{{"suggestedName", "x.txt"}, {"text", "x"}, {"encoding", "koi8-r"}}) ==
          "encoding");

    // A write that fails: 1002 doc.ioError {path, reason}.
    f.answer("dialog.saveFile", json{{"path", utf8(f.out / "missing folder" / "x.txt")}});
    const json failed = f.call("files.saveText", json{{"suggestedName", "x.txt"}, {"text", "x"}});
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1002);
    CHECK(failed["error"]["data"].contains("reason"));
}

TEST_CASE("files.saveBinaries writes what does not conflict and asks before overwriting",
          "[files][server]") {
    FilesServer f;
    const fs::path book = f.tmp / "picture-view.fb2";
    fs::copy_file(test::fixtures_dir() / "books" / "picture-view.fb2", book);
    const std::string doc_id = f.result("doc.open", json{{"path", utf8(book)}})["document"]["docId"];
    test::write_text(f.out / "small.jpg", "an older file");

    // First call: the folder dialog, then every binary named by its id; an existing file is
    // skipped, not overwritten.
    f.answer("dialog.pickFolder", json{{"path", utf8(f.out)}});
    const json first = f.result("files.saveBinaries", json{{"docId", doc_id}});
    CHECK(first["saved"] == 3);
    CHECK(first["skipped"] == json::array({"small.jpg"}));
    const std::string token = first["folderToken"];
    CHECK_FALSE(token.empty());
    CHECK(token.find(utf8(f.out)) == std::string::npos);  // the folder never leaves the core
    for (const char* id : {"big.jpg", "scan.tif", "blob.bin"}) {
        INFO(id);
        CHECK(test::read_text(f.out / id) == f.binary_bytes(doc_id, id));
    }
    CHECK(test::read_text(f.out / "small.jpg") == "an older file");

    // Second call: the ids the user confirmed, with the token and overwrite.
    const json second = f.result("files.saveBinaries", json{{"docId", doc_id},
                                                             {"ids", json::array({"small.jpg"})},
                                                             {"folderToken", token},
                                                             {"overwrite", true}});
    CHECK(second == json{{"saved", 1}, {"skipped", json::array()}, {"folderToken", token}});
    CHECK(test::read_text(f.out / "small.jpg") == f.binary_bytes(doc_id, "small.jpg"));
    // Without overwrite an existing file is skipped again; no dialog is shown with a token.
    const json third = f.result(
        "files.saveBinaries",
        json{{"docId", doc_id}, {"ids", json::array({"scan.tif"})}, {"folderToken", token}});
    CHECK(third["skipped"] == json::array({"scan.tif"}));
    CHECK(f.result("test.dialogRequests").size() == 1);

    // A cancelled folder dialog is no error.
    f.answer("dialog.pickFolder", json::object());
    CHECK(f.result("files.saveBinaries", json{{"docId", doc_id}}) ==
          json{{"saved", 0}, {"skipped", json::array()}, {"folderToken", ""}});

    // An id the book does not have: 1010; a token that is not the document's: invalidParams.
    const json unknown = f.call("files.saveBinaries",
                                json{{"docId", doc_id},
                                     {"ids", json::array({"nope.png"})},
                                     {"folderToken", token}});
    CHECK(unknown["error"]["code"] == 1010);
    const json forged = f.call("files.saveBinaries",
                               json{{"docId", doc_id}, {"folderToken", "forged"}});
    CHECK(forged["error"]["code"] == -32602);
    CHECK(forged["error"]["data"]["field"] == "folderToken");

    // The token ends with the document: 1000 doc.notFound afterwards.
    f.result("doc.close", json{{"docId", doc_id}});
    const json closed =
        f.call("files.saveBinaries", json{{"docId", doc_id}, {"folderToken", token}});
    CHECK(closed["error"]["code"] == 1000);
    const json reopened = f.result("doc.open", json{{"path", utf8(book)}});
    const json stale = f.call("files.saveBinaries",
                              json{{"docId", reopened["document"]["docId"]}, {"folderToken", token}});
    CHECK(stale["error"]["code"] == -32602);
}
