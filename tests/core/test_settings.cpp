// T018: settings store - defaults, persistence, validation, patches.
#include "test_support.hpp"

#include <mfbe/settings.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;
using nlohmann::json;

TEST_CASE("settings: defaults are exactly resource-formats.md section 6", "[settings]") {
    const json d = settings::defaults();
    CHECK(d["schemaVersion"] == 1);
    CHECK(d["view"]["uiLanguage"] == "system");
    CHECK(d["view"]["bodyFont"] == "");
    CHECK(d["view"]["bodyFontSize"] == 14);
    CHECK(d["view"]["bodyTextColor"] == "#000000");
    CHECK(d["view"]["bodyBackground"] == "#ffffff");
    CHECK(d["view"]["sourceFont"] == "");
    CHECK(d["view"]["sourceWrap"] == true);
    CHECK(d["view"]["sourceSyntaxHighlight"] == true);
    CHECK(d["view"]["sourceShowEol"] == false);
    CHECK(d["view"]["sourceShowWhitespace"] == false);
    CHECK(d["view"]["sourceLineNumbers"] == true);
    CHECK(d["view"]["sourceMatchTags"] == true);
    CHECK(d["view"]["sourceTagCompletion"] == true);  // feature 003
    CHECK(d["view"]["spellEnabled"] == true);
    CHECK(d["view"]["spellHighlight"] == true);
    CHECK(d["view"]["customDictionaryPath"] == "");
    CHECK(d["view"]["fastMode"] == false);
    CHECK(d["view"].size() == 18);
    CHECK(d["view"]["theme"] == "system");
    CHECK(d["other"]["defaultEncoding"] == "utf-8");
    CHECK(d["other"]["keepEncoding"] == false);
    CHECK(d["other"]["restorePosition"] == true);
    CHECK(d["other"]["scriptsFolder"] == "");
    CHECK(d["other"]["genresFolder"] == "");
    CHECK(d["other"]["dictionariesFolder"] == "");  // feature 003
    CHECK(d["other"]["templateFolder"] == "");
    CHECK(d["other"]["askOnNonClearImage"] == true);
    CHECK(d["other"]["insertClearImages"] == false);
    CHECK(d["other"]["pasteImageFormat"] == "jpeg");
    CHECK(d["other"]["jpegQuality"] == 90);
    CHECK(d["other"]["nbspDisplayChar"] == "\u00A0");  // no marker, as in the original
    CHECK(d["other"]["versionCheck"] == "monthly");    // feature 003
    CHECK(d["other"]["switchKeyboardLayout"] == false);  // feature 004
    CHECK(d["other"]["keyboardLayoutId"] == "");
    CHECK(d["other"]["keyboardLayoutName"] == "");
    CHECK(d["other"].size() == 16);
    CHECK(d["words"] == json{{"showExclusionsInWordsDialog", false}});
    CHECK(d["session"]["windowGeometry"].is_null());
    CHECK(d["session"]["toolbars"] == json{{"commands", true},
                                           {"scripts", true},
                                           {"links", true},
                                           {"table", true},
                                           {"status", true}});
    CHECK(d["session"]["treeVisible"] == true);
    CHECK(d["session"]["treeWidth"] == 260);  // feature 004: release 0.0.3's fixed pane width
    CHECK(d["session"]["findHistory"] == json::array());
    CHECK(d["session"]["replaceHistory"] == json::array());
    CHECK(d["session"]["toolbarLayouts"] == json::object());
    CHECK(d["session"]["lastFileDialogFolder"] == "");
    CHECK_FALSE(d["session"].contains("lastVersionCheck"));  // feature 003: absent until a check
    CHECK(d["session"].size() == 8);
    CHECK(d.size() == 5);
}

TEST_CASE("settings: feature 004 keys - the tree width is defaulted, never clamped; the keyboard "
          "layout keys are free strings",
          "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "settings.json");
    store.load();
    const json before = store.get();

    auto expect_field = [&](const json& patch, const std::string& field) {
        try {
            store.apply_patch(patch);
            FAIL("expected SettingsError for " << field);
        } catch (const settings::SettingsError& e) {
            CHECK(e.field == field);
        }
    };
    // settings.set refuses a wrong type or an out-of-range width with the field name (1040).
    expect_field(json{{"session", {{"treeWidth", "260"}}}}, "session.treeWidth");
    expect_field(json{{"session", {{"treeWidth", 50}}}}, "session.treeWidth");
    expect_field(json{{"session", {{"treeWidth", 10001}}}}, "session.treeWidth");
    expect_field(json{{"session", {{"treeWidth", 260.5}}}}, "session.treeWidth");
    expect_field(json{{"other", {{"switchKeyboardLayout", "yes"}}}}, "other.switchKeyboardLayout");
    expect_field(json{{"other", {{"keyboardLayoutId", 1049}}}}, "other.keyboardLayoutId");
    expect_field(json{{"other", {{"keyboardLayoutName", true}}}}, "other.keyboardLayoutName");
    CHECK(store.get() == before);  // nothing applied

    // The range is 100-10000; both ends are accepted; no restart for any of the four keys.
    for (int width : {100, 160, 260, 500, 10000}) {
        auto r = store.apply_patch(json{{"session", {{"treeWidth", width}}}});
        CHECK(r.settings["session"]["treeWidth"] == width);
        CHECK_FALSE(r.restartRequired);
    }
    auto layout = store.apply_patch(json{{"other",
                                          {{"switchKeyboardLayout", true},
                                           {"keyboardLayoutId", "00000419"},
                                           {"keyboardLayoutName", "Russian"}}}});
    CHECK_FALSE(layout.restartRequired);
    CHECK(layout.settings["other"]["switchKeyboardLayout"] == true);
    CHECK(layout.settings["other"]["keyboardLayoutId"] == "00000419");
    CHECK(layout.settings["other"]["keyboardLayoutName"] == "Russian");
    // Platform ids of every kind are plain strings: a macOS input source id, an X11 group name.
    for (const char* id : {"com.apple.keylayout.Russian", "Russian", "hkl:F0010419", ""}) {
        CHECK(store.apply_patch(json{{"other", {{"keyboardLayoutId", id}}}})
                  .settings["other"]["keyboardLayoutId"] == id);
    }
    settings::SettingsStore reloaded(tmp / "settings.json");
    reloaded.load();
    CHECK(reloaded.get_int("session.treeWidth") == 10000);
    CHECK(reloaded.get_bool("other.switchKeyboardLayout") == true);
    CHECK(reloaded.get_string("other.keyboardLayoutName") == "Russian");

    // A stored value the schema refuses is replaced by the default and reported (settings.invalid
    // in the log) - the store never clamps a width to the range.
    for (const char* stored : {R"({"schemaVersion": 1, "session": {"treeWidth": "wide"}})",
                               R"({"schemaVersion": 1, "session": {"treeWidth": 50}})",
                               R"({"schemaVersion": 1, "session": {"treeWidth": 12000}})",
                               R"({"schemaVersion": 1, "session": {"treeWidth": 260.5}})"}) {
        json loaded = json::parse(stored);
        const auto invalid = settings::sanitize(loaded);
        REQUIRE(invalid.size() == 1);
        CHECK(invalid[0].field == "session.treeWidth");
        CHECK(loaded["session"]["treeWidth"] == 260);
        test::write_text(tmp / "settings.json", stored);
        store.load();
        CHECK(store.get_int("session.treeWidth") == 260);
    }
    test::write_text(tmp / "settings.json",
                     R"({"schemaVersion": 1, "other": {"switchKeyboardLayout": 1,
                         "keyboardLayoutId": ["00000419"], "keyboardLayoutName": 7}})");
    store.load();
    CHECK(store.get_bool("other.switchKeyboardLayout", true) == false);
    CHECK(store.get_string("other.keyboardLayoutId", "x") == "");
    CHECK(store.get_string("other.keyboardLayoutName", "x") == "");
}

TEST_CASE("settings: missing file yields defaults; save writes JSON", "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "cfg" / "settings.json");
    store.load();
    CHECK(store.get() == settings::defaults());
    CHECK(store.save());
    CHECK(std::filesystem::exists(tmp / "cfg" / "settings.json"));
    CHECK(json::parse(test::read_text(tmp / "cfg" / "settings.json")) == settings::defaults());
}

TEST_CASE("settings: unknown keys preserved, missing keys defaulted, invalid values reset",
          "[settings]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    test::write_text(file, R"({
        "schemaVersion": 1,
        "view": { "bodyFontSize": "huge", "spellEnabled": false, "experimental": { "x": 1 } },
        "other": { "jpegQuality": 150, "defaultEncoding": "cp866" },
        "plugins": [1, 2, 3]
    })");
    settings::SettingsStore store(file);
    store.load();
    const json& s = store.get();
    CHECK(s["view"]["bodyFontSize"] == 14);      // invalid type -> default
    CHECK(s["view"]["spellEnabled"] == false);   // valid override kept
    CHECK(s["view"]["experimental"]["x"] == 1);  // unknown nested key preserved
    CHECK(s["other"]["jpegQuality"] == 90);      // out of range -> default
    CHECK(s["other"]["defaultEncoding"] == "utf-8");
    CHECK(s["other"]["keepEncoding"] == false);     // missing -> default
    CHECK(s["plugins"] == json::array({1, 2, 3}));  // unknown top-level key preserved
    CHECK(s["words"]["showExclusionsInWordsDialog"] == false);
    CHECK(s["session"]["toolbars"]["links"] == true);
}

TEST_CASE("settings: unreadable JSON falls back to defaults", "[settings]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    test::write_text(file, "{ this is not json");
    settings::SettingsStore store(file);
    store.load();
    CHECK(store.get() == settings::defaults());
}

TEST_CASE("settings: apply_patch merges deeply, persists and reports restartRequired",
          "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "settings.json");
    store.load();

    auto r1 = store.apply_patch(json{{"other", {{"jpegQuality", 75}}},
                                     {"session", {{"toolbars", {{"links", false}}}}},
                                     {"custom", {{"a", 1}}}});
    CHECK_FALSE(r1.restartRequired);
    CHECK(r1.settings["other"]["jpegQuality"] == 75);
    CHECK(r1.settings["other"]["keepEncoding"] == false);  // siblings untouched
    CHECK(r1.settings["session"]["toolbars"]["links"] == false);
    CHECK(r1.settings["session"]["toolbars"]["table"] == true);  // deep merge
    CHECK(r1.settings["custom"]["a"] == 1);                      // unknown keys accepted

    auto r2 = store.apply_patch(json{{"view", {{"uiLanguage", "ru"}}}});
    CHECK(r2.restartRequired);
    auto r3 = store.apply_patch(json{{"view", {{"uiLanguage", "ru"}}}});
    CHECK_FALSE(r3.restartRequired);  // unchanged

    // null resets a known key to its default and removes an unknown one.
    auto r4 = store.apply_patch(json{{"other", {{"jpegQuality", nullptr}}}, {"custom", nullptr}});
    CHECK(r4.settings["other"]["jpegQuality"] == 90);
    CHECK_FALSE(r4.settings.contains("custom"));

    // windowGeometry is replaced as a whole, arrays too.
    const json bounds1{{"x", 1}, {"y", 2}, {"width", 300}, {"height", 200}, {"maximized", true}};
    const json bounds2{{"x", 5}, {"y", 6}, {"width", 700}, {"height", 500}};
    store.apply_patch(json{{"session", {{"windowGeometry", bounds1}}}});
    auto r5 = store.apply_patch(json{{"session", {{"windowGeometry", bounds2}}}});
    CHECK(r5.settings["session"]["windowGeometry"] == bounds2);
    auto r6 = store.apply_patch(json{{"session", {{"findHistory", {"a", "b"}}}}});
    CHECK(r6.settings["session"]["findHistory"] == json::array({"a", "b"}));

    // Persisted.
    settings::SettingsStore reloaded(tmp / "settings.json");
    reloaded.load();
    CHECK(reloaded.get() == store.get());
    CHECK(reloaded.get_string("view.uiLanguage") == "ru");
    CHECK(reloaded.get_int("other.jpegQuality") == 90);
    CHECK(reloaded.get_bool("session.toolbars.links") == false);
    CHECK(reloaded.get_bool("missing.key", true) == true);
}

TEST_CASE("settings: invalid patch values are rejected with the field name", "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "settings.json");
    store.load();
    const json before = store.get();

    auto expect_field = [&](const json& patch, const std::string& field) {
        try {
            store.apply_patch(patch);
            FAIL("expected SettingsError for " << field);
        } catch (const settings::SettingsError& e) {
            CHECK(e.field == field);
        }
    };
    expect_field(json{{"other", {{"jpegQuality", 101}}}}, "other.jpegQuality");
    expect_field(json{{"other", {{"jpegQuality", "90"}}}}, "other.jpegQuality");
    expect_field(json{{"other", {{"pasteImageFormat", "gif"}}}}, "other.pasteImageFormat");
    expect_field(json{{"other", {{"defaultEncoding", "cp866"}}}}, "other.defaultEncoding");
    expect_field(json{{"view", {{"uiLanguage", "de"}}}}, "view.uiLanguage");
    expect_field(json{{"view", {{"bodyTextColor", "red"}}}}, "view.bodyTextColor");
    expect_field(json{{"view", {{"spellEnabled", "yes"}}}}, "view.spellEnabled");
    expect_field(json{{"session", {{"findHistory", "x"}}}}, "session.findHistory");
    expect_field(json{{"session", {{"toolbars", {{"links", 1}}}}}}, "session.toolbars");
    expect_field(json{{"view", "not an object"}}, "view");
    CHECK_THROWS_AS(store.apply_patch(json::array()), settings::SettingsError);
    CHECK(store.get() == before);  // nothing applied
}

TEST_CASE("settings: supported encodings list", "[settings]") {
    const auto& enc = settings::supported_encodings();
    CHECK(enc.front() == "utf-8");
    CHECK(enc.size() == 9);
    CHECK(std::find(enc.begin(), enc.end(), "koi8-r") != enc.end());
}

TEST_CASE("settings: the non-breaking-space marker offers only the original's choices",
          "[settings]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    // 0.0.1 stored the degree sign by default; it reads as the default (no marker).
    test::write_text(file, R"({"schemaVersion": 1, "other": {"nbspDisplayChar": "\u00b0"}})");
    settings::SettingsStore store(file);
    store.load();
    CHECK(store.get_string("other.nbspDisplayChar") == "\u00A0");
    for (const char* choice : {"\u00A0", "\u25A1", "\u25AB", "\u25E6"}) {
        auto result = store.apply_patch(json{{"other", {{"nbspDisplayChar", choice}}}});
        CHECK(result.settings["other"]["nbspDisplayChar"] == choice);
    }
    try {
        store.apply_patch(json{{"other", {{"nbspDisplayChar", "\u00B0"}}}});
        FAIL("the degree sign is not one of the original's choices");
    } catch (const settings::SettingsError& e) {
        CHECK(e.field == "other.nbspDisplayChar");
    }
}

TEST_CASE("settings: toolbar layouts are kept per toolbar with unknown items as stored",
          "[settings]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    test::write_text(file, R"({"schemaVersion": 1, "session": {"toolbarLayouts": {
        "commands": ["file.new", "no.such.command", "-"],
        "scripts": ["scripts.last", "script.gone/away"],
        "future": ["x"]}}})");
    settings::SettingsStore store(file);
    store.load();
    const json stored = store.get()["session"]["toolbarLayouts"];
    CHECK(stored["commands"] == json::array({"file.new", "no.such.command", "-"}));
    CHECK(stored["scripts"] == json::array({"scripts.last", "script.gone/away"}));
    CHECK(stored["future"] == json::array({"x"}));

    // One toolbar is patched at a time; null resets a toolbar to the original layout.
    auto r1 = store.apply_patch(
        json{{"session", {{"toolbarLayouts", {{"scripts", {"scripts.last", "-"}}}}}}});
    CHECK(r1.settings["session"]["toolbarLayouts"]["scripts"] ==
          json::array({"scripts.last", "-"}));
    CHECK(r1.settings["session"]["toolbarLayouts"]["commands"].size() == 3);
    auto r2 = store.apply_patch(json{{"session", {{"toolbarLayouts", {{"commands", nullptr}}}}}});
    CHECK_FALSE(r2.settings["session"]["toolbarLayouts"].contains("commands"));
    CHECK(r2.settings["session"]["toolbarLayouts"]["scripts"] ==
          json::array({"scripts.last", "-"}));

    try {
        store.apply_patch(json{{"session", {{"toolbarLayouts", {{"commands", {1, 2}}}}}}});
        FAIL("toolbar items must be strings");
    } catch (const settings::SettingsError& e) {
        CHECK(e.field == "session.toolbarLayouts");
    }

    test::write_text(file, R"({"schemaVersion": 1, "session": {"toolbarLayouts": "broken"}})");
    store.load();
    CHECK(store.get()["session"]["toolbarLayouts"] == json::object());
}

TEST_CASE("settings: template and last file-dialog folders keep non-English names exactly",
          "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "settings.json");
    store.load();
    store.apply_patch(json{{"other", {{"templateFolder", "C:\\Users\\Тест\\Шаблоны"}}},
                           {"session", {{"lastFileDialogFolder", "/home/тест/书"}}}});
    settings::SettingsStore reloaded(tmp / "settings.json");
    reloaded.load();
    CHECK(reloaded.get_string("other.templateFolder") == "C:\\Users\\Тест\\Шаблоны");
    CHECK(reloaded.get_string("session.lastFileDialogFolder") == "/home/тест/书");
}

TEST_CASE("settings: feature 003 keys are validated with the field name", "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "settings.json");
    store.load();
    const json before = store.get();

    auto expect_field = [&](const json& patch, const std::string& field) {
        try {
            store.apply_patch(patch);
            FAIL("expected SettingsError for " << field);
        } catch (const settings::SettingsError& e) {
            CHECK(e.field == field);
        }
    };
    expect_field(json{{"other", {{"versionCheck", "yearly"}}}}, "other.versionCheck");
    expect_field(json{{"other", {{"versionCheck", 7}}}}, "other.versionCheck");
    expect_field(json{{"view", {{"sourceTagCompletion", "yes"}}}}, "view.sourceTagCompletion");
    expect_field(json{{"other", {{"dictionariesFolder", 1}}}}, "other.dictionariesFolder");
    for (const char* malformed :
         {"2026-10-17 12:34:56", "2026-10-17T12:34:56", "2026-10-17T12:34:56+02:00",
          "2026-10-17T12:34:56.7Z", "2026-13-17T12:34:56Z", "2026-10-17T25:34:56Z", "yesterday"}) {
        expect_field(json{{"session", {{"lastVersionCheck", malformed}}}},
                     "session.lastVersionCheck");
    }
    expect_field(json{{"session", {{"lastVersionCheck", 1760704496}}}}, "session.lastVersionCheck");
    // Calendar-aware: February 30th and a 31st of a 30-day month are no dates.
    expect_field(json{{"session", {{"lastVersionCheck", "2026-02-30T12:00:00Z"}}}},
                 "session.lastVersionCheck");
    expect_field(json{{"session", {{"lastVersionCheck", "2026-04-31T12:00:00Z"}}}},
                 "session.lastVersionCheck");
    CHECK(store.apply_patch(json{{"session", {{"lastVersionCheck", "2028-02-29T00:00:00Z"}}}})
              .settings["session"]["lastVersionCheck"] == "2028-02-29T00:00:00Z");
    store.apply_patch(json{{"session", {{"lastVersionCheck", nullptr}}}});
    // The window placement is {x, y, width, height, maximized?} or null, nothing else.
    for (const json malformed :
         {json::object(), json{{"x", "10"}, {"y", 20}, {"width", 800}, {"height", 600}},
          json{{"x", 10}, {"y", 20}, {"width", 800}},
          json{{"x", 10}, {"y", 20}, {"width", 800}, {"height", 600}, {"maximized", "yes"}},
          json(7)}) {
        expect_field(json{{"session", {{"windowGeometry", malformed}}}}, "session.windowGeometry");
    }
    CHECK(store.get() == before);  // nothing applied

    for (const char* choice : {"everyStart", "daily", "weekly", "monthly", "never"}) {
        CHECK(store.apply_patch(json{{"other", {{"versionCheck", choice}}}})
                  .settings["other"]["versionCheck"] == choice);
    }
    auto r1 = store.apply_patch(json{{"view", {{"sourceTagCompletion", false}}},
                                     {"other", {{"dictionariesFolder", "/home/тест/словники"}}}});
    CHECK(r1.settings["view"]["sourceTagCompletion"] == false);
    CHECK(r1.settings["other"]["dictionariesFolder"] == "/home/тест/словники");
    CHECK_FALSE(r1.restartRequired);

    // Ukrainian joins the interface languages; changing the language still asks for a restart.
    auto r2 = store.apply_patch(json{{"view", {{"uiLanguage", "uk"}}}});
    CHECK(r2.settings["view"]["uiLanguage"] == "uk");
    CHECK(r2.restartRequired);
    CHECK_FALSE(store.apply_patch(json{{"view", {{"uiLanguage", "uk"}}}}).restartRequired);
}

TEST_CASE("settings: session.lastVersionCheck is absent until set and null removes it",
          "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "settings.json");
    store.load();
    CHECK_FALSE(store.get()["session"].contains("lastVersionCheck"));

    // A valid timestamp round-trips through the file, with and without fractional seconds.
    for (const char* stamp : {"2026-10-17T12:34:56Z", "2026-10-17T12:34:56.789Z"}) {
        auto r = store.apply_patch(json{{"session", {{"lastVersionCheck", stamp}}}});
        CHECK(r.settings["session"]["lastVersionCheck"] == stamp);
        CHECK_FALSE(r.restartRequired);
        settings::SettingsStore reloaded(tmp / "settings.json");
        reloaded.load();
        CHECK(reloaded.get_string("session.lastVersionCheck") == stamp);
    }

    // null removes the key (there is no default to reset to); the file follows.
    auto removed = store.apply_patch(json{{"session", {{"lastVersionCheck", nullptr}}}});
    CHECK_FALSE(removed.settings["session"].contains("lastVersionCheck"));
    CHECK(removed.settings["session"]["lastFileDialogFolder"] == "");  // siblings untouched
    settings::SettingsStore reloaded(tmp / "settings.json");
    reloaded.load();
    CHECK_FALSE(reloaded.get()["session"].contains("lastVersionCheck"));
    CHECK_FALSE(json::parse(test::read_text(tmp / "settings.json"))["session"].contains(
        "lastVersionCheck"));

    // A stored value that is not a UTC timestamp is reported and dropped, not kept as null.
    test::write_text(tmp / "settings.json",
                     R"({"schemaVersion": 1, "session": {"lastVersionCheck": "2026-10-17"}})");
    json loaded = json::parse(test::read_text(tmp / "settings.json"));
    const auto invalid = settings::sanitize(loaded);
    REQUIRE(invalid.size() == 1);
    CHECK(invalid[0].field == "session.lastVersionCheck");
    CHECK_FALSE(loaded["session"].contains("lastVersionCheck"));
    store.load();
    CHECK_FALSE(store.get()["session"].contains("lastVersionCheck"));
    CHECK(store.get() == settings::defaults());
}

TEST_CASE("settings: a 0.0.2 settings file keeps every value; the new keys take their defaults",
          "[settings]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    // Every key of release 0.0.2 at a value other than its default, none of feature 003's keys.
    const char* old_file = R"({
        "schemaVersion": 1,
        "view": {
            "uiLanguage": "ru", "theme": "dark", "bodyFont": "Georgia", "bodyFontSize": 16,
            "bodyTextColor": "#112233", "bodyBackground": "#fffff0", "sourceFont": "Consolas",
            "sourceWrap": false, "sourceSyntaxHighlight": false, "sourceShowEol": true,
            "sourceShowWhitespace": true, "sourceLineNumbers": false, "sourceMatchTags": false,
            "spellEnabled": false, "spellHighlight": false,
            "customDictionaryPath": "/home/тест/custom.dic", "fastMode": true
        },
        "other": {
            "defaultEncoding": "windows-1251", "keepEncoding": true, "restorePosition": false,
            "scriptsFolder": "/scripts", "genresFolder": "/genres",
            "templateFolder": "/templates", "askOnNonClearImage": false,
            "insertClearImages": true, "pasteImageFormat": "png", "jpegQuality": 75,
            "nbspDisplayChar": "\u25A1"
        },
        "words": {"showExclusionsInWordsDialog": true},
        "session": {
            "windowGeometry": {"x": 10, "y": 20, "width": 800, "height": 600},
            "toolbars": {"commands": false, "scripts": false, "links": false, "table": false,
                         "status": false},
            "treeVisible": false, "findHistory": ["needle"], "replaceHistory": ["thread"],
            "toolbarLayouts": {"commands": ["file.new", "-"]},
            "lastFileDialogFolder": "/books"
        }
    })";
    test::write_text(file, old_file);
    const json expected = json::parse(old_file);
    CHECK(expected["view"].size() == 17);
    CHECK(expected["other"].size() == 11);
    CHECK(expected["session"].size() == 7);

    json sanitized = expected;
    CHECK(settings::sanitize(sanitized).empty());  // nothing in the old file is invalid

    settings::SettingsStore store(file);
    store.load();
    const json& s = store.get();
    for (const char* section : {"view", "other", "words", "session"}) {
        for (auto it = expected[section].begin(); it != expected[section].end(); ++it) {
            INFO(section << "." << it.key());
            CHECK(s[section][it.key()] == it.value());
        }
    }
    CHECK(s["view"]["sourceTagCompletion"] == true);
    CHECK(s["other"]["dictionariesFolder"] == "");
    CHECK(s["other"]["versionCheck"] == "monthly");
    CHECK_FALSE(s["session"].contains("lastVersionCheck"));
    CHECK(s["other"]["switchKeyboardLayout"] == false);  // feature 004
    CHECK(s["other"]["keyboardLayoutId"] == "");
    CHECK(s["other"]["keyboardLayoutName"] == "");
    CHECK(s["session"]["treeWidth"] == 260);
    CHECK(s["view"].size() == 18);
    CHECK(s["other"].size() == 16);
    CHECK(s["session"].size() == 8);

    // Saving the migrated file keeps the key absent; the shell's maximised flag is accepted.
    CHECK(store.save());
    settings::SettingsStore reloaded(file);
    reloaded.load();
    CHECK(reloaded.get() == s);
    CHECK_FALSE(reloaded.get()["session"].contains("lastVersionCheck"));
    const json placement{
        {"x", 10}, {"y", 20}, {"width", 800}, {"height", 600}, {"maximized", true}};
    auto r = reloaded.apply_patch(json{{"session", {{"windowGeometry", placement}}}});
    CHECK(r.settings["session"]["windowGeometry"] == placement);
}

TEST_CASE("settings: a 0.0.3 settings file keeps every value; the feature 004 keys take their "
          "defaults",
          "[settings]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    // Every key of release 0.0.3 at a value other than its default, none of feature 004's keys.
    const char* old_file = R"({
        "schemaVersion": 1,
        "view": {
            "uiLanguage": "uk", "theme": "dark", "bodyFont": "Georgia", "bodyFontSize": 16,
            "bodyTextColor": "#112233", "bodyBackground": "#fffff0", "sourceFont": "Consolas",
            "sourceWrap": false, "sourceSyntaxHighlight": false, "sourceShowEol": true,
            "sourceShowWhitespace": true, "sourceLineNumbers": false, "sourceMatchTags": false,
            "sourceTagCompletion": false, "spellEnabled": false, "spellHighlight": false,
            "customDictionaryPath": "/home/тест/custom.dic", "fastMode": true
        },
        "other": {
            "defaultEncoding": "windows-1251", "keepEncoding": true, "restorePosition": false,
            "scriptsFolder": "/scripts", "genresFolder": "/genres",
            "dictionariesFolder": "/home/тест/словники", "templateFolder": "/templates",
            "askOnNonClearImage": false, "insertClearImages": true, "pasteImageFormat": "png",
            "jpegQuality": 75, "nbspDisplayChar": "\u25A1", "versionCheck": "never"
        },
        "words": {"showExclusionsInWordsDialog": true},
        "session": {
            "windowGeometry": {"x": 10, "y": 20, "width": 800, "height": 600, "maximized": true},
            "toolbars": {"commands": false, "scripts": false, "links": false, "table": false,
                         "status": false},
            "treeVisible": false, "findHistory": ["needle"], "replaceHistory": ["thread"],
            "toolbarLayouts": {"commands": ["file.new", "-"]},
            "lastFileDialogFolder": "/books", "lastVersionCheck": "2026-10-17T12:34:56Z"
        }
    })";
    test::write_text(file, old_file);
    const json expected = json::parse(old_file);
    CHECK(expected["view"].size() == 18);
    CHECK(expected["other"].size() == 13);
    CHECK(expected["session"].size() == 8);
    json sanitized = expected;
    CHECK(settings::sanitize(sanitized).empty());  // nothing in the old file is invalid

    settings::SettingsStore store(file);
    store.load();
    const json& s = store.get();
    for (const char* section : {"view", "other", "words", "session"}) {
        for (auto it = expected[section].begin(); it != expected[section].end(); ++it) {
            INFO(section << "." << it.key());
            CHECK(s[section][it.key()] == it.value());
        }
    }
    CHECK(s["other"]["switchKeyboardLayout"] == false);
    CHECK(s["other"]["keyboardLayoutId"] == "");
    CHECK(s["other"]["keyboardLayoutName"] == "");
    CHECK(s["session"]["treeWidth"] == 260);
    CHECK(s["other"].size() == 16);
    CHECK(s["session"].size() == 9);  // the eight of 0.0.3 (lastVersionCheck set) + treeWidth

    // The migrated file saves and reloads unchanged.
    CHECK(store.save());
    settings::SettingsStore reloaded(file);
    reloaded.load();
    CHECK(reloaded.get() == s);
}
