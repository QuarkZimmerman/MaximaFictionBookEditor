// Feature 004 US8 (T062): the remembered positions record `positions.json`
// (contracts/resource-formats.md §13; research R5.4) - a least-recently-used list of at most
// 100 files, newest first, written atomically on every change, malformed items skipped, an
// unreadable file or another schema version treated as empty and never deleted, unknown item
// members preserved - and the platform's file-name comparison `platform::same_file_path`
// (exact on Linux, case-insensitive after lexical normalisation on Windows and macOS).
#include "test_support.hpp"

#include <mfbe/positions.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <string>

using namespace mfbe;
using nlohmann::json;

namespace {

settings::Position at(const std::string& path, int offset) {
    return settings::Position{path, offset};
}

}  // namespace

TEST_CASE("positions: the structural-path grammar of a remembered position", "[positions]") {
    using settings::is_position_path;
    CHECK(is_position_path("body[1]"));
    CHECK(is_position_path("body[1]/section[3]/p[12]"));
    CHECK(is_position_path("body[2]/section[1]/poem[1]/stanza[1]/v[3]"));
    CHECK(is_position_path("body[12]/section[1]/table[1]/tr[2]/td[1]"));
    CHECK(is_position_path("body[1]/section[1]/text-author[1]"));
    CHECK(is_position_path("title-info/annotation[1]"));
    CHECK(is_position_path("title-info/annotation[1]/p[2]"));
    CHECK(is_position_path("document-info/history[1]/p[1]"));
    // Only the three roots the Body view shows; 1-based indices; lower-case element names.
    CHECK_FALSE(is_position_path(""));
    CHECK_FALSE(is_position_path("section[1]/p[1]"));
    CHECK_FALSE(is_position_path("src-title-info/annotation[1]/p[1]"));
    CHECK_FALSE(is_position_path("output[1]/part[1]"));
    CHECK_FALSE(is_position_path("extra[1]"));
    CHECK_FALSE(is_position_path("body[0]/section[1]"));
    CHECK_FALSE(is_position_path("body[01]"));
    CHECK_FALSE(is_position_path("body[1]/"));
    CHECK_FALSE(is_position_path("body[1]/p"));
    CHECK_FALSE(is_position_path("body[1]/P[1]"));
    CHECK_FALSE(is_position_path("body[1]/section[2]x"));
    CHECK_FALSE(is_position_path("title-info/annotation[2]"));
    CHECK_FALSE(is_position_path("document-info/history[1]/"));
    CHECK_FALSE(is_position_path("body[1]//p[1]"));

    CHECK(settings::position_from_json(json{{"path", "body[1]/section[1]/p[1]"}, {"offset", 4}}) ==
          at("body[1]/section[1]/p[1]", 4));
    CHECK(settings::position_from_json(json{{"path", "body[1]"}, {"offset", 0}}) ==
          at("body[1]", 0));
    CHECK_FALSE(settings::position_from_json(json{{"path", "section[1]/p[1]"}, {"offset", 0}}));
    CHECK_FALSE(settings::position_from_json(json{{"path", "body[1]/p[1]"}, {"offset", -1}}));
    CHECK_FALSE(settings::position_from_json(json{{"path", "body[1]/p[1]"}, {"offset", "4"}}));
    CHECK_FALSE(settings::position_from_json(json{{"path", "body[1]/p[1]"}, {"offset", 1.5}}));
    CHECK_FALSE(settings::position_from_json(json{{"path", "body[1]/p[1]"}}));
    CHECK_FALSE(settings::position_from_json(json{{"offset", 1}}));
    CHECK_FALSE(settings::position_from_json("body[1]/p[1]"));
    CHECK_FALSE(settings::position_from_json(nullptr));
    CHECK(settings::to_json(at("body[1]/section[2]/p[3]", 7)) ==
          json{{"path", "body[1]/section[2]/p[3]"}, {"offset", 7}});
}

TEST_CASE("positions: an LRU list of 100 files, newest first, atomic writes per change",
          "[positions]") {
    test::TempDir tmp;
    const std::filesystem::path file = tmp / "cfg" / "positions.json";
    settings::Positions positions(file);
    positions.load();
    CHECK(positions.items().empty());
    CHECK_FALSE(positions.get("/books/b1.fb2").has_value());
    CHECK_FALSE(std::filesystem::exists(file));  // loading creates nothing

    for (int i = 1; i <= 100; ++i) {
        positions.set("/books/b" + std::to_string(i) + ".fb2", at("body[1]/section[1]/p[1]", i));
    }
    REQUIRE(positions.items().size() == settings::kMaxPositions);
    CHECK(positions.items().front().path == "/books/b100.fb2");
    CHECK(positions.items().back().path == "/books/b1.fb2");
    CHECK(positions.get("/books/b1.fb2") == at("body[1]/section[1]/p[1]", 1));
    CHECK(positions.get("/books/b100.fb2") == at("body[1]/section[1]/p[1]", 100));
    // Every change is written at once (atomically, like recent.json).
    REQUIRE(std::filesystem::exists(file));
    json stored = json::parse(test::read_text(file));
    CHECK(stored["schemaVersion"] == 1);
    REQUIRE(stored["items"].size() == 100);
    CHECK(stored["items"][0]["path"] == "/books/b100.fb2");
    CHECK(stored["items"][0]["position"] ==
          json{{"path", "body[1]/section[1]/p[1]"}, {"offset", 100}});
    CHECK(stored["items"][0]["at"].is_string());
    CHECK(stored["items"][0]["at"].get<std::string>().back() == 'Z');
    CHECK(stored["items"][99]["path"] == "/books/b1.fb2");
    for (const auto& entry : std::filesystem::directory_iterator(file.parent_path())) {
        CHECK(entry.path().filename() == "positions.json");  // no temporary file left behind
    }

    // Remembering an item again moves it to the front with its new position; the list keeps
    // its size.
    positions.set("/books/b1.fb2", at("body[1]/section[7]/p[2]", 3));
    REQUIRE(positions.items().size() == settings::kMaxPositions);
    CHECK(positions.items().front().path == "/books/b1.fb2");
    CHECK(positions.items().front().position == at("body[1]/section[7]/p[2]", 3));
    CHECK(positions.items()[1].path == "/books/b100.fb2");
    CHECK(positions.items().back().path == "/books/b2.fb2");
    CHECK(positions.get("/books/b1.fb2") == at("body[1]/section[7]/p[2]", 3));

    // The 101st file drops the oldest (b2 now), never one remembered more recently.
    positions.set("/books/b101.fb2", at("body[1]", 0));
    REQUIRE(positions.items().size() == settings::kMaxPositions);
    CHECK(positions.items().front().path == "/books/b101.fb2");
    CHECK_FALSE(positions.get("/books/b2.fb2").has_value());
    CHECK(positions.get("/books/b3.fb2").has_value());
    CHECK(positions.get("/books/b1.fb2").has_value());

    // The file reloads to the same list.
    settings::Positions reloaded(file);
    reloaded.load();
    CHECK(reloaded.items() == positions.items());

    positions.clear();
    CHECK(positions.items().empty());
    CHECK(json::parse(test::read_text(file))["items"].empty());
    CHECK(json::parse(test::read_text(file))["schemaVersion"] == 1);
}

TEST_CASE("positions: malformed items are skipped, unknown members preserved", "[positions]") {
    test::TempDir tmp;
    const std::filesystem::path file = tmp / "positions.json";
    test::write_text(file, R"({"schemaVersion":1,"items":[
        {"path":"/a.fb2","at":"2026-10-20T18:33:33Z","position":{"path":"body[1]/section[3]/p[12]","offset":12},"note":"kept","rank":{"n":1}},
        {"path":"/bad-grammar.fb2","at":"2026-10-20T18:33:33Z","position":{"path":"section[1]/p[1]","offset":0}},
        {"path":"/bad-root.fb2","at":"2026-10-20T18:33:33Z","position":{"path":"src-title-info/annotation[1]/p[1]","offset":0}},
        {"path":"/bad-offset.fb2","at":"2026-10-20T18:33:33Z","position":{"path":"body[1]/p[1]","offset":-1}},
        {"path":"/no-position.fb2","at":"2026-10-20T18:33:33Z"},
        {"path":"","position":{"path":"body[1]","offset":0}},
        {"nopath":true}, 5, "x", null,
        {"path":"/a.fb2","at":"2020-01-01T00:00:00Z","position":{"path":"body[1]","offset":0}},
        {"path":"/b.fb2","position":{"path":"document-info/history[1]/p[1]","offset":2}}
    ]})");
    settings::Positions positions(file);
    positions.load();
    REQUIRE(positions.items().size() == 2);
    CHECK(positions.items()[0].path == "/a.fb2");
    CHECK(positions.items()[0].at == "2026-10-20T18:33:33Z");
    CHECK(positions.items()[0].position == at("body[1]/section[3]/p[12]", 12));
    CHECK(positions.items()[1].path == "/b.fb2");  // a missing `at` is tolerated
    CHECK(positions.items()[1].position == at("document-info/history[1]/p[1]", 2));
    CHECK(positions.get("/a.fb2") == at("body[1]/section[3]/p[12]", 12));  // the first wins
    CHECK_FALSE(positions.get("/bad-grammar.fb2").has_value());
    CHECK_FALSE(positions.get("/no-position.fb2").has_value());

    // Loading rewrites nothing: the file is left exactly as it was.
    CHECK(test::read_text(file).find("\"nopath\"") != std::string::npos);

    // The next write keeps the unknown members of the surviving items.
    positions.set("/c.fb2", at("body[1]/section[1]/p[1]", 0));
    const json stored = json::parse(test::read_text(file));
    REQUIRE(stored["items"].size() == 3);
    CHECK(stored["items"][0]["path"] == "/c.fb2");
    CHECK(stored["items"][1]["path"] == "/a.fb2");
    CHECK(stored["items"][1]["note"] == "kept");
    CHECK(stored["items"][1]["rank"] == json{{"n", 1}});
    CHECK(stored["items"][1]["at"] == "2026-10-20T18:33:33Z");
    CHECK_FALSE(stored["items"][2].contains("note"));
    CHECK_FALSE(stored["items"][2].contains("at"));  // written as it was read: without one
    // Remembering `/a.fb2` again keeps its unknown members and refreshes `at`.
    positions.set("/a.fb2", at("body[1]", 0));
    const json again = json::parse(test::read_text(file));
    CHECK(again["items"][0]["path"] == "/a.fb2");
    CHECK(again["items"][0]["note"] == "kept");
    CHECK(again["items"][0]["at"] != "2026-10-20T18:33:33Z");
}

TEST_CASE("positions: an unreadable file or another schema version is empty and never deleted",
          "[positions]") {
    test::TempDir tmp;

    SECTION("not JSON") {
        test::write_text(tmp / "positions.json", "nonsense {");
        settings::Positions positions(tmp / "positions.json");
        positions.load();
        CHECK(positions.items().empty());
        CHECK(test::read_text(tmp / "positions.json") == "nonsense {");
    }

    SECTION("another schemaVersion") {
        const std::string text =
            R"({"schemaVersion":2,"items":[{"path":"/a.fb2","position":{"path":"body[1]","offset":0}}]})";
        test::write_text(tmp / "positions.json", text);
        settings::Positions positions(tmp / "positions.json");
        positions.load();
        CHECK(positions.items().empty());
        CHECK_FALSE(positions.get("/a.fb2").has_value());
        CHECK(test::read_text(tmp / "positions.json") == text);
    }

    SECTION("no items array") {
        test::write_text(tmp / "positions.json", R"({"schemaVersion":1,"items":{}})");
        settings::Positions positions(tmp / "positions.json");
        positions.load();
        CHECK(positions.items().empty());
    }

    SECTION("a directory where the file should be") {
        std::filesystem::create_directories(tmp / "positions.json");
        settings::Positions positions(tmp / "positions.json");
        positions.load();
        CHECK(positions.items().empty());
        CHECK(std::filesystem::is_directory(tmp / "positions.json"));
    }
}

TEST_CASE("positions: paths are compared as the platform compares file names", "[positions]") {
    using platform::same_file_path;
    CHECK(same_file_path("/books/book.fb2", "/books/book.fb2"));
    CHECK_FALSE(same_file_path("/books/book.fb2", "/books/other.fb2"));
    CHECK_FALSE(same_file_path("/books/book.fb2", "/other/book.fb2"));
    CHECK_FALSE(same_file_path("", "/books/book.fb2"));
    CHECK(same_file_path("", ""));
    // No Unicode normalisation: a decomposed spelling is another name.
    CHECK_FALSE(same_file_path("/books/\xC3\xA9.fb2", "/books/e\xCC\x81.fb2"));
#if defined(_WIN32) || defined(__APPLE__)
    // Windows and macOS: the lexically normalised paths (redundant separators and `.` / `..`
    // segments folded) ignoring letter case - Latin and Cyrillic alike.
    CHECK(same_file_path("/books//book.fb2", "/books/book.fb2"));
    CHECK(same_file_path("/books/./book.fb2", "/books/book.fb2"));
    CHECK(same_file_path("/books/x/../book.fb2", "/books/book.fb2"));
    CHECK(same_file_path("/books/Book.fb2", "/books/book.FB2"));
    CHECK(same_file_path("/Books/book.fb2", "/books/BOOK.fb2"));
    CHECK(same_file_path(
        "/\xD0\x9A\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB8/\xD0\x9A\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB0.fb2",
        "/\xD0\xBA\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB8/\xD0\xBA\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB0.FB2"));
#else
    // Linux compares the bytes exactly (the record holds absolute, normalised paths anyway).
    CHECK_FALSE(same_file_path("/books/Book.fb2", "/books/book.fb2"));
    CHECK_FALSE(same_file_path("/books/book.fb2", "/books/book.FB2"));
    CHECK_FALSE(same_file_path("/books/./book.fb2", "/books/book.fb2"));
    CHECK_FALSE(same_file_path("/\xD0\x9A\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB0.fb2",
                               "/\xD0\xBA\xD0\xBD\xD0\xB8\xD0\xB3\xD0\xB0.fb2"));
#endif
#ifdef _WIN32
    CHECK(same_file_path("C:\\Books\\Book.fb2", "c:\\books\\book.fb2"));
    CHECK(same_file_path("C:\\Books\\..\\Books\\Book.fb2", "C:\\Books\\Book.fb2"));
    CHECK(same_file_path("C:/Books/Book.fb2", "C:\\Books\\Book.fb2"));
    CHECK_FALSE(same_file_path("C:\\Books\\Book.fb2", "D:\\Books\\Book.fb2"));
#endif
}

TEST_CASE("positions: a match with another spelling replaces the stored spelling", "[positions]") {
    test::TempDir tmp;
    settings::Positions positions(tmp / "positions.json");
    positions.load();
    positions.set("/books/book.fb2", at("body[1]/section[1]/p[1]", 1));
    positions.set("/books/other.fb2", at("body[1]/section[1]/p[1]", 2));
    // The same spelling again: the one record is updated.
    positions.set("/books/book.fb2", at("body[1]/section[2]/p[1]", 3));
    REQUIRE(positions.items().size() == 2);
    CHECK(positions.items().front().path == "/books/book.fb2");
    CHECK(positions.get("/books/book.fb2") == at("body[1]/section[2]/p[1]", 3));
#if defined(_WIN32) || defined(__APPLE__)
    // Another letter case names the same file: one record, the newer spelling kept.
    positions.set("/Books/BOOK.FB2", at("body[1]/section[3]/p[1]", 4));
    REQUIRE(positions.items().size() == 2);
    CHECK(positions.items().front().path == "/Books/BOOK.FB2");
    CHECK(positions.get("/books/book.fb2") == at("body[1]/section[3]/p[1]", 4));
    CHECK(positions.get("/books/./BOOK.fb2") == at("body[1]/section[3]/p[1]", 4));
    settings::Positions reloaded(tmp / "positions.json");
    reloaded.load();
    CHECK(reloaded.items().front().path == "/Books/BOOK.FB2");
    CHECK(reloaded.items().size() == 2);
#else
    // On Linux another letter case is another file: a record of its own.
    positions.set("/Books/BOOK.FB2", at("body[1]/section[3]/p[1]", 4));
    REQUIRE(positions.items().size() == 3);
    CHECK(positions.items().front().path == "/Books/BOOK.FB2");
    CHECK(positions.get("/books/book.fb2") == at("body[1]/section[2]/p[1]", 3));
    CHECK(positions.get("/Books/BOOK.FB2") == at("body[1]/section[3]/p[1]", 4));
#endif
}
