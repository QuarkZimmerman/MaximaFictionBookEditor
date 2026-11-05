// Feature 009, User Story 2 (T021, T030 to T032): books in ZIP archives over the real loopback
// server - doc.open with one book, with several (needsChoice) and with an entry, the refusals,
// doc.openSource, the ZIP save through doc.save (never without a path for a book from an
// archive), and files.inspect.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
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
    test::TempDir data{"mfbe-archive"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
    // The path as the core reports it: native separators, lexically normal, UTF-8.
    static std::string archive(const char* name) {
        return platform::utf8_from_path(
            (test::fixtures_dir() / "archives" / name).lexically_normal());
    }
    json call(const std::string& method, const json& params = json::object()) {
        return ws.call(method, params, 20000);
    }
};

int error_code(const json& response) {
    return response.contains("error") ? response["error"]["code"].get<int>() : 0;
}

}  // namespace

TEST_CASE("doc archive: a single-book archive opens at once, with its source", "[archive]") {
    Fixture f;
    const json opened = f.call("doc.open", json{{"path", Fixture::archive("single.fb2.zip")}});
    REQUIRE(opened.contains("result"));
    const json& doc = opened["result"]["document"];
    CHECK(doc["source"] ==
          json{{"archive", Fixture::archive("single.fb2.zip")}, {"entry", "book.fb2"}});
    CHECK(doc["path"] == Fixture::archive("single.fb2.zip"));
    CHECK(doc["fileKind"] == "fb2");
}

TEST_CASE("doc archive: several books ask for a choice, then the chosen entry opens", "[archive]") {
    Fixture f;
    const json choice = f.call("doc.open", json{{"path", Fixture::archive("many-200.zip")}});
    REQUIRE(choice.contains("result"));
    const json& needs = choice["result"]["needsChoice"];
    CHECK(needs["archive"] == Fixture::archive("many-200.zip"));
    CHECK(needs["books"].size() == 200);
    CHECK(needs["booksTotal"] == 200);
    CHECK(needs["otherFiles"] == 2);
    CHECK(needs["books"][0] == json{{"entry", "folder-01/book-001.fb2"},
                                    {"name", "book-001.fb2"},
                                    {"folder", "folder-01"},
                                    {"size", needs["books"][0]["size"]},
                                    {"kind", "fb2"}});
    CHECK_FALSE(choice["result"].contains("document"));

    const json opened = f.call("doc.open", json{{"path", Fixture::archive("many-200.zip")},
                                                {"entry", "folder-02/book-021.fb2"}});
    REQUIRE(opened.contains("result"));
    CHECK(opened["result"]["document"]["source"]["entry"] == "folder-02/book-021.fb2");
}

TEST_CASE("doc archive: the refusals", "[archive]") {
    Fixture f;
    const json rar = f.call("doc.open", json{{"path", Fixture::archive("sample.rar")}});
    CHECK(error_code(rar) == 1080);
    CHECK(rar["error"]["data"]["kind"] == "rar");
    CHECK(error_code(f.call("doc.open", json{{"path", Fixture::archive("sample.gz")}})) == 1080);
    CHECK(error_code(f.call("doc.open", json{{"path", Fixture::archive("no-book.zip")}})) == 1081);
    const json encrypted = f.call("doc.open", json{{"path", Fixture::archive("encrypted.zip")}});
    CHECK(error_code(encrypted) == 1082);
    CHECK(encrypted["error"]["data"] == json{{"entry", "book.fb2"}, {"reason", "encrypted"}});
    const json method = f.call("doc.open", json{{"path", Fixture::archive("method-unknown.zip")}});
    CHECK(method["error"]["data"]["reason"] == "method");
    const json missing = f.call(
        "doc.open", json{{"path", Fixture::archive("single.fb2.zip")}, {"entry", "gone.fb2"}});
    CHECK(error_code(missing) == 1083);
    CHECK(missing["error"]["data"] == json{{"entry", "gone.fb2"}, {"books", 1}});
}

TEST_CASE("doc archive: Source-only opening takes the entry too", "[archive]") {
    Fixture f;
    const json source =
        f.call("doc.openSource", json{{"path", Fixture::archive("single.fb2.zip")}});
    REQUIRE(source.contains("result"));
    CHECK(source["result"]["source"]["entry"] == "book.fb2");
    CHECK(source["result"]["text"].get<std::string>().find("<FictionBook") != std::string::npos);
}

TEST_CASE("doc archive: a book from an archive is saved with a path, as a ZIP or a plain file",
          "[archive][backup]") {
    Fixture f;
    const json opened = f.call("doc.open", json{{"path", Fixture::archive("single.fb2.zip")}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];

    // Never back into the archive it came from: a save without a path is refused.
    CHECK(error_code(f.call("doc.save", json{{"docId", doc_id}, {"document", doc}})) == -32602);

    // A ZIP save writes a new one-book archive; replacing it keeps the old one as .bak.
    const std::string out = (f.data.path() / "copy.fb2.zip").string();
    const json saved = f.call("doc.save", json{{"docId", doc_id},
                                               {"document", doc},
                                               {"path", out},
                                               {"archive", {{"entryName", "book.fb2"}}},
                                               {"backup", true}});
    REQUIRE(saved.contains("result"));
    CHECK(saved["result"]["source"] == json{{"archive", out}, {"entry", "book.fb2"}});
    CHECK(saved["result"]["backup"]["kept"] == false);  // nothing was replaced
    CHECK(archive::detect_kind(platform::path_from_utf8(out)) == archive::Kind::zip);
    const auto listing = archive::list(platform::path_from_utf8(out));
    REQUIRE(listing.entries.size() == 1);
    CHECK(listing.entries[0].name == "book.fb2");
    const std::string first = test::read_text(platform::path_from_utf8(out));
    const json again = f.call("doc.save", json{{"docId", doc_id},
                                               {"document", doc},
                                               {"path", out},
                                               {"archive", {{"entryName", "book.fb2"}}},
                                               {"backup", true}});
    REQUIRE(again.contains("result"));
    CHECK(again["result"]["backup"]["kept"] == true);
    CHECK(test::read_text(platform::path_from_utf8(out + ".bak")) == first);
    // Still a book from an archive: no save without a path.
    CHECK(error_code(f.call("doc.save", json{{"docId", doc_id}, {"document", doc}})) == -32602);

    // A plain save ties the book to the plain file; then Save saves it directly.
    const std::string plain = (f.data.path() / "copy.fb2").string();
    const json as_plain =
        f.call("doc.save", json{{"docId", doc_id}, {"document", doc}, {"path", plain}});
    REQUIRE(as_plain.contains("result"));
    CHECK_FALSE(as_plain["result"].contains("source"));
    CHECK(archive::detect_kind(platform::path_from_utf8(plain)) == archive::Kind::file);
    CHECK(f.call("doc.save", json{{"docId", doc_id}, {"document", doc}}).contains("result"));

    // The source archive was never written.
    CHECK(test::read_text(test::fixtures_dir() / "archives" / "single.fb2.zip").size() == 2543);
}

TEST_CASE("doc archive: parsed-back text keeps the archive; never a plain file over it",
          "[archive]") {
    Fixture f;
    // A copy of the fixture: the refused save must leave it byte for byte.
    const std::string zip = (f.data.path() / "book.fb2.zip").string();
    std::filesystem::copy_file(test::fixtures_dir() / "archives" / "single.fb2.zip",
                               platform::path_from_utf8(zip));
    const json opened = f.call("doc.open", json{{"path", zip}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];
    const json origin = doc["source"];
    REQUIRE(origin.is_object());

    // The Source view's text parsed back is still the book of the archive.
    const json xml = f.call("doc.toXml", json{{"docId", doc_id}, {"document", doc}});
    REQUIRE(xml.contains("result"));
    const json parsed =
        f.call("doc.fromXml", json{{"docId", doc_id}, {"text", xml["result"]["text"]}});
    REQUIRE(parsed.contains("result"));
    CHECK(parsed["result"]["document"]["source"] == origin);

    // A plain save named at the archive itself is refused, and the archive is untouched.
    const std::string archive_path = origin["archive"];
    const std::string before = test::read_text(platform::path_from_utf8(archive_path));
    CHECK(error_code(f.call("doc.save",
                            json{{"docId", doc_id}, {"document", doc}, {"path", archive_path}})) ==
          -32602);
    CHECK(test::read_text(platform::path_from_utf8(archive_path)) == before);
    // A ZIP save may replace it (the UI proposes it for an archive of this book alone).
    CHECK(f.call("doc.save", json{{"docId", doc_id},
                                  {"document", doc},
                                  {"path", archive_path},
                                  {"archive", {{"entryName", "book.fb2"}}}})
              .contains("result"));
}

TEST_CASE("doc archive: files.inspect", "[archive]") {
    Fixture f;
    auto inspect = [&](const std::string& path, const json& extra = json::object()) {
        json params{{"path", path}};
        params.update(extra);
        return f.call("files.inspect", params)["result"];
    };
    CHECK(inspect((f.data.path() / "none.zip").string()) ==
          json{{"exists", false}, {"kind", "missing"}});
    CHECK(inspect(f.data.path().string())["kind"] == "folder");
    CHECK(inspect((test::fixtures_dir() / "books" / "modern-utf8.fb2").string())["kind"] == "file");
    CHECK(inspect(Fixture::archive("sample.rar"))["kind"] == "otherArchive");
    const json many = inspect(Fixture::archive("many-200.zip"), json{{"entryName", "x.fb2"}});
    CHECK(many["kind"] == "zip");
    CHECK(many["otherEntries"] == 202);
    CHECK(many["books"] == 200);
    const json single =
        inspect(Fixture::archive("single.fb2.zip"), json{{"entryName", "book.fb2"}});
    CHECK(single["otherEntries"] == 0);
    CHECK(single["onlyBook"] == "book.fb2");
    CHECK_FALSE(many.contains("onlyBook"));
    CHECK(error_code(f.call("files.inspect", json{{"path", "relative.zip"}})) == -32602);
}
