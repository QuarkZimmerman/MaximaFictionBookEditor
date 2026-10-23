// T018: settings store - defaults, persistence, validation, patches.
#include "test_support.hpp"

#include <mfbe/log.hpp>
#include <mfbe/settings.hpp>

#include <catch2/catch_test_macros.hpp>
#include <sstream>
#include <string>
#include <vector>

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
    CHECK(d["other"]["nbspDisplayChar"] == "\u00A0");    // no marker, as in the original
    CHECK(d["other"]["versionCheck"] == "monthly");      // feature 003
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
    CHECK(d["session"]["aiPanelWidth"] == 360);              // feature 005
    CHECK(d["session"].size() == 9);
    // Feature 005 (resource-formats §B): the ai group - mode, freeServiceId, the custom triple,
    // the verification record and the agreements.
    CHECK(d["ai"]["mode"] == "free");
    CHECK(d["ai"]["freeServiceId"] == "ovhcloud");
    CHECK(d["ai"]["custom"] ==
          json{{"address", "https://api.openai.com/v1"}, {"key", ""}, {"model", ""}});
    CHECK(d["ai"]["customVerified"] == json{{"fingerprint", ""}, {"model", ""}, {"at", ""}});
    CHECK(d["ai"]["agreements"] == json::array());
    CHECK(d["ai"].size() == 5);
    CHECK(d.size() == 6);
}

TEST_CASE(
    "settings: feature 004 keys - the tree width is defaulted, never clamped; the keyboard "
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
    for (const json& malformed :
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
    CHECK(s["session"]["aiPanelWidth"] == 360);  // feature 005
    CHECK(s["ai"] == settings::defaults()["ai"]);
    CHECK(s["view"].size() == 18);
    CHECK(s["other"].size() == 16);
    CHECK(s["session"].size() == 9);

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

TEST_CASE(
    "settings: a 0.0.3 settings file keeps every value; the feature 004 keys take their "
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
    // The eight of 0.0.3 (lastVersionCheck set) + treeWidth + aiPanelWidth (feature 005).
    CHECK(s["session"].size() == 10);
    CHECK(s["session"]["aiPanelWidth"] == 360);
    CHECK(s["ai"] == settings::defaults()["ai"]);

    // The migrated file saves and reloads unchanged.
    CHECK(store.save());
    settings::SettingsStore reloaded(file);
    reloaded.load();
    CHECK(reloaded.get() == s);
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 005: the ai group and session.aiPanelWidth (rpc-api §3.7, resource-formats §B)    */
/* ----------------------------------------------------------------------------------------- */

namespace {

// Node:
// createHash('sha256').update('http://127.0.0.1:11434/v1\0sk-test\0standin-chat').digest('hex')
constexpr const char* kStandinAddress = "http://127.0.0.1:11434/v1";
constexpr const char* kStandinKey = "sk-test";
constexpr const char* kStandinModel = "standin-chat";
constexpr const char* kStandinFingerprint =
    "02751bd2ea5ad77cd042f0ce910ec7e3976c39e9aca03c436e0c88adab401046";

json record(const char* fingerprint, const char* model = "standin-chat",
            const char* at = "2026-10-22T10:00:00Z") {
    return json{{"fingerprint", fingerprint}, {"model", model}, {"at", at}};
}

json triple(const char* address, const char* key, const char* model) {
    return json{{"address", address}, {"key", key}, {"model", model}};
}

}  // namespace

TEST_CASE(
    "settings: the ai group and session.aiPanelWidth are validated with the field name; "
    "counts of section 6 updated",
    "[settings][ai]") {
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
    // 1040 settings.invalid {field} for every broken rule - the field name, never the value.
    expect_field(json{{"ai", {{"mode", "on"}}}}, "ai.mode");
    expect_field(json{{"ai", {{"mode", 1}}}}, "ai.mode");
    expect_field(json{{"ai", {{"freeServiceId", ""}}}}, "ai.freeServiceId");
    expect_field(json{{"ai", {{"freeServiceId", 7}}}}, "ai.freeServiceId");
    expect_field(
        json{{"ai", {{"custom", {{"address", "https://" + std::string(3000, 'a') + "/v1"}}}}}},
        "ai.custom.address");
    for (const char* bad :
         {"api.openai.com/v1", "ftp://files.example/v1", "https:///v1",
          "https://user:pw@api.example/v1", "https://api.example/v1?x=1",
          "https://api.example/v1#frag", "https://api.example/v 1", "https://api.example/v1\n",
          "javascript:alert(1)", "https://api.example:99999/v1", "file:///etc/passwd"}) {
        INFO(bad);
        expect_field(json{{"ai", {{"custom", {{"address", bad}}}}}}, "ai.custom.address");
    }
    expect_field(json{{"ai", {{"custom", {{"key", "sk-\nabc"}}}}}}, "ai.custom.key");
    expect_field(json{{"ai", {{"custom", {{"key", std::string(4097, 'k')}}}}}}, "ai.custom.key");
    expect_field(json{{"ai", {{"custom", {{"key", 42}}}}}}, "ai.custom.key");
    expect_field(json{{"ai", {{"custom", {{"model", std::string(257, 'm')}}}}}}, "ai.custom.model");
    expect_field(json{{"ai", {{"custom", {{"model", "gpt\t4"}}}}}}, "ai.custom.model");
    expect_field(json{{"ai", {{"custom", "not an object"}}}}, "ai.custom");
    expect_field(json{{"ai", "not an object"}}, "ai");
    // A malformed record or agreement list breaks a rule like any other key.
    expect_field(json{{"ai", {{"customVerified", "x"}}}}, "ai.customVerified");
    expect_field(
        json{{"ai", {{"customVerified", json{{"fingerprint", "zz"}, {"model", ""}, {"at", ""}}}}}},
        "ai.customVerified");
    expect_field(json{{"ai", {{"customVerified", json{{"fingerprint", ""}, {"model", ""}}}}}},
                 "ai.customVerified");
    expect_field(
        json{{"ai",
              {{"customVerified", json{{"fingerprint", ""}, {"model", ""}, {"at", "yesterday"}}}}}},
        "ai.customVerified");
    expect_field(json{{"ai", {{"agreements", "ovhcloud"}}}}, "ai.agreements");
    expect_field(json{{"ai", {{"agreements", {json{{"service", "ovhcloud"}}}}}}}, "ai.agreements");
    expect_field(json{{"ai",
                       {{"agreements",
                         {json{{"service", ""}, {"host", "h"}, {"at", "2026-10-22T10:00:00Z"}}}}}}},
                 "ai.agreements");
    expect_field(
        json{{"ai",
              {{"agreements",
                {json{{"service", "x"}, {"host", "a b"}, {"at", "2026-10-22T10:00:00Z"}}}}}}},
        "ai.agreements");
    expect_field(
        json{{"ai",
              {{"agreements", {json{{"service", "x"}, {"host", "h"}, {"at", "2026-10-22"}}}}}}},
        "ai.agreements");
    expect_field(json{{"session", {{"aiPanelWidth", 50}}}}, "session.aiPanelWidth");
    expect_field(json{{"session", {{"aiPanelWidth", 10001}}}}, "session.aiPanelWidth");
    expect_field(json{{"session", {{"aiPanelWidth", "wide"}}}}, "session.aiPanelWidth");
    expect_field(json{{"session", {{"aiPanelWidth", 360.5}}}}, "session.aiPanelWidth");
    CHECK(store.get() == before);  // nothing applied

    // Every valid value is stored as given; no change asks for a restart.
    for (const char* mode : {"free", "custom", "disabled"}) {
        auto r = store.apply_patch(json{{"ai", {{"mode", mode}}}});
        CHECK(r.settings["ai"]["mode"] == mode);
        CHECK_FALSE(r.restartRequired);
    }
    for (const char* address :
         {"", "http://127.0.0.1:11434/v1", "https://api.openai.com/v1/", "http://[::1]:8080/v1",
          "http://ai.standin.test:8080/v1", "HTTPS://API.EXAMPLE/", "http://192.168.1.20:11434",
          "https://api.example/путь/v1"}) {
        INFO(address);
        CHECK(store.apply_patch(json{{"ai", {{"custom", {{"address", address}}}}}})
                  .settings["ai"]["custom"]["address"] == address);
    }
    const std::string long_key(4096, 'k');
    CHECK(store.apply_patch(json{{"ai", {{"custom", {{"key", long_key}}}}}})
              .settings["ai"]["custom"]["key"] == long_key);
    CHECK(store.apply_patch(json{{"ai", {{"custom", {{"key", " sk-with spaces "}}}}}})
              .settings["ai"]["custom"]["key"] == " sk-with spaces ");  // stored as given
    CHECK(
        store
            .apply_patch(json{{"ai", {{"custom", {{"model", "minimax/minimax-m3.1-flash:free"}}}}}})
            .settings["ai"]["custom"]["model"] == "minimax/minimax-m3.1-flash:free");
    CHECK(store.apply_patch(json{{"ai", {{"freeServiceId", "my-local"}}}})
              .settings["ai"]["freeServiceId"] == "my-local");
    for (int width : {100, 280, 360, 9000, 10000}) {
        CHECK(store.apply_patch(json{{"session", {{"aiPanelWidth", width}}}})
                  .settings["session"]["aiPanelWidth"] == width);
    }
    // Agreements carry service, host and at and are replaced whole by a patch.
    const json agreement{{"service", "ovhcloud"},
                         {"host", "oai.endpoints.kepler.ai.cloud.ovh.net"},
                         {"at", "2026-10-22T10:00:00Z"}};
    const json custom_agreement{{"service", "custom:http://ai.standin.test:8080/v1"},
                                {"host", "ai.standin.test:8080"},
                                {"at", "2026-10-22T10:00:01.500Z"}};
    CHECK(store.apply_patch(json{{"ai", {{"agreements", {agreement, custom_agreement}}}}})
              .settings["ai"]["agreements"] == json::array({agreement, custom_agreement}));
    CHECK(store.apply_patch(json{{"ai", {{"agreements", {custom_agreement}}}}})
              .settings["ai"]["agreements"] == json::array({custom_agreement}));
    CHECK(store.apply_patch(json{{"ai", {{"agreements", json::array()}}}})
              .settings["ai"]["agreements"] == json::array());
    // null resets a key to its default; unknown keys under ai are preserved.
    auto reset = store.apply_patch(json{{"ai", {{"mode", nullptr}, {"future", {{"x", 1}}}}}});
    CHECK(reset.settings["ai"]["mode"] == "free");
    CHECK(reset.settings["ai"]["future"]["x"] == 1);

    // Persisted and read back as written.
    settings::SettingsStore reloaded(tmp / "settings.json");
    reloaded.load();
    CHECK(reloaded.get() == store.get());
    CHECK(reloaded.get_int("session.aiPanelWidth") == 10000);
    CHECK(reloaded.get_string("ai.custom.key") == " sk-with spaces ");

    // Stored values the schema refuses are replaced by the default and reported by field name;
    // a width is never clamped; malformed agreement elements are dropped and the rest kept.
    for (const char* stored : {R"({"schemaVersion": 1, "session": {"aiPanelWidth": "wide"}})",
                               R"({"schemaVersion": 1, "session": {"aiPanelWidth": 50}})",
                               R"({"schemaVersion": 1, "session": {"aiPanelWidth": 12000}})"}) {
        json loaded = json::parse(stored);
        const auto invalid = settings::sanitize(loaded);
        REQUIRE(invalid.size() == 1);
        CHECK(invalid[0].field == "session.aiPanelWidth");
        CHECK(loaded["session"]["aiPanelWidth"] == 360);
    }
    for (const char* stored : {R"({"schemaVersion": 1, "session": {"aiPanelWidth": 280}})",
                               R"({"schemaVersion": 1, "session": {"aiPanelWidth": 9000}})"}) {
        json loaded = json::parse(stored);
        CHECK(settings::sanitize(loaded).empty());
        CHECK(loaded["session"]["aiPanelWidth"] == json::parse(stored)["session"]["aiPanelWidth"]);
    }
    json broken = json::parse(R"({"schemaVersion": 1, "ai": {
        "mode": "always", "freeServiceId": "", "custom": {"address": "ftp://x", "key": 5, "model": "a\u0007b"},
        "customVerified": {"fingerprint": "nope", "model": "", "at": ""},
        "agreements": [{"service": "ovhcloud", "host": "h", "at": "2026-10-22T10:00:00Z"},
                       {"service": "", "host": "h", "at": "2026-10-22T10:00:00Z"}, "x", 7]}})");
    const auto invalid = settings::sanitize(broken);
    std::vector<std::string> fields;
    for (const auto& item : invalid) {
        fields.push_back(item.field);
    }
    CHECK(fields == std::vector<std::string>{"ai.mode", "ai.freeServiceId", "ai.custom.address",
                                             "ai.custom.key", "ai.custom.model",
                                             "ai.customVerified", "ai.agreements"});
    CHECK(broken["ai"]["mode"] == "free");
    CHECK(broken["ai"]["freeServiceId"] == "ovhcloud");
    CHECK(broken["ai"]["custom"] == settings::defaults()["ai"]["custom"]);
    CHECK(broken["ai"]["customVerified"] == settings::defaults()["ai"]["customVerified"]);
    CHECK(broken["ai"]["agreements"] ==
          json::array(
              {json{{"service", "ovhcloud"}, {"host", "h"}, {"at", "2026-10-22T10:00:00Z"}}}));
}

TEST_CASE(
    "settings: ai.customVerified is kept only with the fingerprint of the patch's (or the "
    "stored) triple, else the empty record without an error; reset when the stored triple "
    "changes or a hand edit breaks the fingerprint",
    "[settings][ai]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    const auto logs = tmp / "logs";
    log::init(logs);
    settings::SettingsStore store(file);
    store.load();
    const json empty_record = settings::defaults()["ai"]["customVerified"];

    // A forged record (64 zeros, well-formed) written alone against the default triple: the
    // empty record is stored - no error, nothing logged.
    auto forged =
        store.apply_patch(json{{"ai", {{"customVerified", record(std::string(64, '0').c_str())}}}});
    CHECK(forged.settings["ai"]["customVerified"] == empty_record);
    CHECK_FALSE(forged.restartRequired);

    // The record written together with its triple in one patch is kept ...
    auto verified =
        store.apply_patch(json{{"ai",
                                {{"custom", triple(kStandinAddress, kStandinKey, kStandinModel)},
                                 {"customVerified", record(kStandinFingerprint)}}}});
    CHECK(verified.settings["ai"]["customVerified"] == record(kStandinFingerprint));
    // ... a record written alone against the matching stored triple too ...
    auto again =
        store.apply_patch(json{{"ai",
                                {{"customVerified", record(kStandinFingerprint, "standin-chat",
                                                           "2026-10-22T11:00:00Z")}}}});
    CHECK(again.settings["ai"]["customVerified"]["at"] == "2026-10-22T11:00:00Z");
    // ... and the record must match the triple of the same patch, not the stored one.
    auto mismatch =
        store.apply_patch(json{{"ai",
                                {{"custom", triple(kStandinAddress, kStandinKey, "other-model")},
                                 {"customVerified", record(kStandinFingerprint)}}}});
    CHECK(mismatch.settings["ai"]["customVerified"] == empty_record);
    CHECK(mismatch.settings["ai"]["custom"]["model"] == "other-model");
    auto rematch =
        store.apply_patch(json{{"ai",
                                {{"custom", triple(kStandinAddress, kStandinKey, kStandinModel)},
                                 {"customVerified", record(kStandinFingerprint)}}}});
    REQUIRE(rematch.settings["ai"]["customVerified"] == record(kStandinFingerprint));

    // A later patch changing one member of the triple resets the record (red the moment the
    // user edits); the other members are untouched.
    auto edited = store.apply_patch(json{{"ai", {{"custom", {{"model", "other-model"}}}}}});
    CHECK(edited.settings["ai"]["customVerified"] == empty_record);
    CHECK(edited.settings["ai"]["custom"]["address"] == kStandinAddress);
    CHECK(edited.settings["ai"]["custom"]["key"] == kStandinKey);
    // The old record no longer belongs to the stored triple (the model is other-model now).
    const json other =
        store.apply_patch(json{{"ai", {{"customVerified", record(kStandinFingerprint)}}}}).settings;
    CHECK(other["ai"]["customVerified"] == empty_record);
    auto key_change =
        store.apply_patch(json{{"ai",
                                {{"custom", triple(kStandinAddress, kStandinKey, kStandinModel)},
                                 {"customVerified", record(kStandinFingerprint)}}}});
    REQUIRE(key_change.settings["ai"]["customVerified"] == record(kStandinFingerprint));
    CHECK(store.apply_patch(json{{"ai", {{"custom", {{"key", "sk-other"}}}}}})
              .settings["ai"]["customVerified"] == empty_record);
    CHECK(store
              .apply_patch(json{{"ai",
                                 {{"custom", triple(kStandinAddress, kStandinKey, kStandinModel)},
                                  {"customVerified", record(kStandinFingerprint)}}}})
              .settings["ai"]["customVerified"] == record(kStandinFingerprint));
    CHECK(store.apply_patch(json{{"ai", {{"custom", {{"address", "http://127.0.0.1:11435/v1"}}}}}})
              .settings["ai"]["customVerified"] == empty_record);

    // A hand edit of settings.json breaking the equality resets the record on load - of the
    // triple or of the record alike; the file's other values stay.
    store.apply_patch(json{{"ai",
                            {{"custom", triple(kStandinAddress, kStandinKey, kStandinModel)},
                             {"customVerified", record(kStandinFingerprint)}}}});
    json on_disk = json::parse(test::read_text(file));
    REQUIRE(on_disk["ai"]["customVerified"]["fingerprint"] == kStandinFingerprint);
    on_disk["ai"]["custom"]["key"] = "sk-edited-by-hand";
    test::write_text(file, on_disk.dump(2));
    store.load();
    CHECK(store.get()["ai"]["customVerified"] == empty_record);
    CHECK(store.get()["ai"]["custom"]["key"] == "sk-edited-by-hand");
    on_disk["ai"]["custom"]["key"] = kStandinKey;
    on_disk["ai"]["customVerified"]["fingerprint"] = std::string(64, 'f');
    test::write_text(file, on_disk.dump(2));
    store.load();
    CHECK(store.get()["ai"]["customVerified"] == empty_record);
    on_disk["ai"]["customVerified"]["fingerprint"] = kStandinFingerprint;
    test::write_text(file, on_disk.dump(2));
    store.load();
    CHECK(store.get()["ai"]["customVerified"] == record(kStandinFingerprint));
    // sanitize() alone applies the invariant (the loader's path), silently.
    json hand = on_disk;
    hand["ai"]["custom"]["model"] = "renamed";
    CHECK(settings::sanitize(hand).empty());
    CHECK(hand["ai"]["customVerified"] == empty_record);

    // None of the resets wrote a log line; the key never reached the log either.
    log::shutdown();
    const auto log_file = logs / "mfbe-errors.log";
    const std::string log_text =
        std::filesystem::exists(log_file) ? test::read_text(log_file) : std::string();
    CHECK(log_text.find("customVerified") == std::string::npos);
    CHECK(log_text.find("sk-test") == std::string::npos);
    CHECK(log_text.find("sk-edited-by-hand") == std::string::npos);
}

TEST_CASE(
    "settings: settings.unreadable logs the exception class and position, never the file's "
    "content",
    "[settings][ai][log]") {
    test::TempDir tmp;
    const auto file = tmp / "settings.json";
    const auto logs = tmp / "logs";
    log::init(logs);
    // A hand-edited file holding the key, broken after it.
    test::write_text(file, R"({"ai": {"custom": {"key": "sk-secret-key-value-1234"}}, "view": {)");
    settings::SettingsStore store(file);
    store.load();
    CHECK(store.get() == settings::defaults());
    log::shutdown();
    std::istringstream lines(test::read_text(logs / "mfbe-errors.log"));
    std::vector<json> entries;
    for (std::string line; std::getline(lines, line);) {
        if (!line.empty()) {
            entries.push_back(json::parse(line));
        }
    }
    REQUIRE(entries.size() == 1);
    CHECK(entries[0]["code"] == "settings.unreadable");
    CHECK(entries[0]["context"]["exception"] == "parse_error");
    CHECK(entries[0]["context"]["position"].is_string());
    CHECK_FALSE(entries[0]["context"].contains("reason"));
    const std::string text = test::read_text(logs / "mfbe-errors.log");
    CHECK(text.find("sk-secret") == std::string::npos);
    CHECK(text.find("last read") == std::string::npos);
}
