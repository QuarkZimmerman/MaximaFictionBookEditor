// T019: recent files, Words exclusions, hotkeys persistence.
#include "test_support.hpp"

#include <mfbe/exclusions.hpp>
#include <mfbe/hotkeys.hpp>
#include <mfbe/recent_files.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;
using nlohmann::json;

TEST_CASE("recent: newest first, deduplicated, capped at 10, no caret written", "[recent]") {
    test::TempDir tmp;
    settings::RecentFiles recent(tmp / "cfg" / "recent.json");
    recent.load();
    CHECK(recent.items().empty());

    for (int i = 1; i <= 12; ++i) {
        recent.touch("/books/b" + std::to_string(i) + ".fb2");
    }
    REQUIRE(recent.items().size() == settings::kMaxRecentFiles);
    CHECK(recent.items().front().path == "/books/b12.fb2");
    CHECK(recent.items().back().path == "/books/b3.fb2");

    recent.touch("/books/b5.fb2");
    CHECK(recent.items().size() == settings::kMaxRecentFiles);
    CHECK(recent.items().front().path == "/books/b5.fb2");
    CHECK_FALSE(recent.items().front().lastOpened.empty());
    CHECK(recent.items().front().lastOpened.back() == 'Z');
    // Entries are matched as exact strings (the platform comparison of feature 004 is the
    // positions record's alone): two spellings make two entries, as before.
    recent.touch("/books/B5.fb2");
    CHECK(recent.items().size() == settings::kMaxRecentFiles);
    CHECK(recent.items()[0].path == "/books/B5.fb2");
    CHECK(recent.items()[1].path == "/books/b5.fb2");

    // Persisted shape per resource-formats.md section 8: path and lastOpened, never a caret
    // (feature 004 US8 - remembered positions live in positions.json).
    const json file = json::parse(test::read_text(tmp / "cfg" / "recent.json"));
    CHECK(file["schemaVersion"] == 1);
    REQUIRE(file["items"].size() == settings::kMaxRecentFiles);
    CHECK(file["items"][0]["path"] == "/books/B5.fb2");
    for (const json& item : file["items"]) {
        CHECK(item == json{{"path", item["path"]}, {"lastOpened", item["lastOpened"]}});
    }

    settings::RecentFiles reloaded(tmp / "cfg" / "recent.json");
    reloaded.load();
    CHECK(reloaded.items() == recent.items());

    CHECK(recent.remove("/books/b5.fb2"));
    CHECK_FALSE(recent.remove("/books/b5.fb2"));
    CHECK(recent.items().size() == 9);
    recent.clear();
    CHECK(recent.items().empty());
    CHECK(json::parse(test::read_text(tmp / "cfg" / "recent.json"))["items"].empty());
}

TEST_CASE("recent: malformed entries are skipped on load, a legacy caret is read but never written",
          "[recent]") {
    test::TempDir tmp;
    test::write_text(tmp / "recent.json", R"({"schemaVersion":1,"items":[
        {"path":"/a.fb2","lastOpened":"2026-01-01T00:00:00Z","caret":{"view":"body","nodeId":"n1","offset":"x"}},
        {"nopath":true}, 5, {"path":"/a.fb2"}, {"path":""}, {"path":"/b.fb2","caret":"bad"},
        {"path":"/c.fb2","caret":{"view":"body","nodeId":"n7","offset":3}},
        {"path":"/d.fb2","caret":{"view":"source","line":7,"column":2}}]})");
    settings::RecentFiles recent(tmp / "recent.json");
    recent.load();
    REQUIRE(recent.items().size() == 4);
    CHECK(recent.items()[0].path == "/a.fb2");
    CHECK(recent.items()[1].path == "/b.fb2");
    // A release 0.0.3 body caret is kept in memory for the one-time conversion into the
    // positions record (contracts/resource-formats.md §8); other carets are ignored.
    REQUIRE(recent.items()[0].legacyCaret.has_value());
    CHECK(recent.items()[0].legacyCaret->nodeId == "n1");
    CHECK(recent.items()[0].legacyCaret->offset == 0);  // bad offset -> 0, view kept
    CHECK_FALSE(recent.items()[1].legacyCaret.has_value());
    REQUIRE(recent.legacy_caret("/c.fb2").has_value());
    CHECK(recent.legacy_caret("/c.fb2")->nodeId == "n7");
    CHECK(recent.legacy_caret("/c.fb2")->offset == 3);
    CHECK_FALSE(recent.legacy_caret("/d.fb2").has_value());  // another view: no Body position
    CHECK_FALSE(recent.legacy_caret("/zzz.fb2").has_value());
    // Touching keeps the legacy caret in memory; the next write drops the member from the file.
    recent.touch("/c.fb2");
    CHECK(recent.legacy_caret("/c.fb2")->nodeId == "n7");
    const json file = json::parse(test::read_text(tmp / "recent.json"));
    REQUIRE(file["items"].size() == 4);
    for (const json& item : file["items"]) {
        CHECK_FALSE(item.contains("caret"));
    }
    settings::RecentFiles reloaded(tmp / "recent.json");
    reloaded.load();
    CHECK_FALSE(reloaded.legacy_caret("/c.fb2").has_value());

    test::write_text(tmp / "bad.json", "nonsense");
    settings::RecentFiles bad(tmp / "bad.json");
    bad.load();
    CHECK(bad.items().empty());
}

TEST_CASE("exclusions: word validation = letters plus one internal hyphen", "[exclusions]") {
    using settings::exclusion_word_error;
    CHECK(exclusion_word_error("word").empty());
    CHECK(exclusion_word_error("\xD1\x81\xD0\xBB\xD0\xBE\xD0\xB2\xD0\xBE").empty());  // слово
    CHECK(exclusion_word_error("well-known").empty());
    CHECK(exclusion_word_error("\xD0\xBA\xD1\x82\xD0\xBE-\xD1\x82\xD0\xBE").empty());  // кто-то
    CHECK(exclusion_word_error("") == "empty");
    CHECK(exclusion_word_error("-lead") == "hyphenPosition");
    CHECK(exclusion_word_error("trail-") == "hyphenPosition");
    CHECK(exclusion_word_error("a-b-c") == "multipleHyphens");
    CHECK(exclusion_word_error("a--b") == "multipleHyphens");
    CHECK(exclusion_word_error("word1") == "invalidCharacter");
    CHECK(exclusion_word_error("two words") == "invalidCharacter");
    CHECK(exclusion_word_error("it's") == "invalidCharacter");
    CHECK(exclusion_word_error("\xFF\xFE") == "invalidUtf8");
}

TEST_CASE("exclusions: load/save with BOM, CRLF, comments-free lines; add/remove/apply",
          "[exclusions]") {
    test::TempDir tmp;
    const auto file = tmp / "exclusions.txt";
    test::write_text(file, "\xEF\xBB\xBFzeta\r\nalpha\r\n\r\n  beta  \nbad word\nalpha\n");
    settings::ExclusionList list(file);
    list.load();
    CHECK(list.words() == std::vector<std::string>{"alpha", "beta", "zeta"});  // sorted, unique
    CHECK(list.contains("beta"));
    CHECK_FALSE(list.contains("bad word"));

    CHECK(list.add("gamma").empty());
    CHECK(list.add("gamma").empty());  // duplicate is fine
    CHECK(list.add("no!") == "invalidCharacter");
    CHECK(list.remove("zeta"));
    CHECK_FALSE(list.remove("zeta"));
    CHECK(list.words() == std::vector<std::string>{"alpha", "beta", "gamma"});
    CHECK(test::read_text(file) == "alpha\nbeta\ngamma\n");

    // Batch apply is all-or-nothing on validation.
    CHECK(list.apply({"delta", "x-y"}, {"alpha"}).empty());
    CHECK(list.words() == std::vector<std::string>{"beta", "delta", "gamma", "x-y"});
    CHECK(list.apply({"ok", "not ok"}, {"beta"}) == "invalidCharacter");
    CHECK(list.words() == std::vector<std::string>{"beta", "delta", "gamma", "x-y"});

    settings::ExclusionList reloaded(file);
    reloaded.load();
    CHECK(reloaded.words() == list.words());
}

TEST_CASE("hotkeys: load/save bindings, duplicates collapse", "[hotkeys]") {
    test::TempDir tmp;
    const auto file = tmp / "hotkeys.json";
    settings::HotkeysStore store(file);
    store.load();
    CHECK(store.bindings().empty());
    store.set_bindings(
        {{"edit.bold", "Mod+B"}, {"file.new", "Ctrl+N"}, {"edit.bold", "Ctrl+Shift+B"}});
    REQUIRE(store.bindings().size() == 2);
    CHECK(store.bindings()[0] == settings::HotkeyBinding{"edit.bold", "Ctrl+Shift+B"});
    const json file_json = json::parse(test::read_text(file));
    CHECK(file_json["schemaVersion"] == 1);
    CHECK(file_json["bindings"][1] == json{{"command", "file.new"}, {"keys", "Ctrl+N"}});

    test::write_text(
        file, R"({"schemaVersion":1,"bindings":[{"command":"a","keys":"F1"},{"bad":1},"x"]})");
    settings::HotkeysStore reloaded(file);
    reloaded.load();
    REQUIRE(reloaded.bindings().size() == 1);
    CHECK(reloaded.bindings()[0].keys == "F1");
}
