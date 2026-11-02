// Feature 008, T007: several copies share the stored data (FR-003, data-model §6).
#include "test_support.hpp"

#include <mfbe/settings.hpp>

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>

using nlohmann::json;
namespace settings = mfbe::settings;

TEST_CASE("store merge: a copy saves only the settings it changed", "[store-merge]") {
    mfbe::test::TempDir tmp;
    const auto file = tmp / "settings.json";
    settings::SettingsStore a(file);
    a.load();
    settings::SettingsStore b(file);
    b.load();  // b was started before a's change, as a copy open since the morning

    a.apply_patch(json{{"view", {{"spellExtraDictionaries", json::array({"en_US"})}}}});
    b.apply_patch(json{{"view", {{"theme", "dark"}}}});

    settings::SettingsStore fresh(file);
    fresh.load();
    CHECK(fresh.get()["view"]["spellExtraDictionaries"] == json::array({"en_US"}));  // a's change
    CHECK(fresh.get()["view"]["theme"] == "dark");                                    // b's change
    // b's own settings never take a's value while b runs.
    CHECK(b.get()["view"]["spellExtraDictionaries"] == json::array({"en_US", "ru_RU"}));
}

TEST_CASE("store merge: for a setting changed in two copies the last save wins",
          "[store-merge]") {
    mfbe::test::TempDir tmp;
    const auto file = tmp / "settings.json";
    settings::SettingsStore a(file);
    a.load();
    settings::SettingsStore b(file);
    b.load();
    a.apply_patch(json{{"other", {{"openFromOutside", "thisWindow"}}}});
    b.apply_patch(json{{"other", {{"openFromOutside", "newWindow"}}}});
    settings::SettingsStore fresh(file);
    fresh.load();
    CHECK(fresh.get()["other"]["openFromOutside"] == "newWindow");
}

TEST_CASE("store merge: a save without changes keeps every value of the file", "[store-merge]") {
    mfbe::test::TempDir tmp;
    const auto file = tmp / "settings.json";
    settings::SettingsStore a(file);
    a.load();
    settings::SettingsStore b(file);
    b.load();
    a.apply_patch(json{{"view", {{"bodyFontSize", 18}}}});
    b.save();  // a copy closing without a change of its own
    settings::SettingsStore fresh(file);
    fresh.load();
    CHECK(fresh.get()["view"]["bodyFontSize"] == 18);
}
