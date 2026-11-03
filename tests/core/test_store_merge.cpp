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

#include <mfbe/spell.hpp>

TEST_CASE("store merge: words added in two copies are both kept, a removed one stays removed",
          "[store-merge]") {
    mfbe::test::TempDir tmp;
    const auto file = tmp / "custom.dic";
    mfbe::spell::CustomDictionary a(file);
    a.load();
    mfbe::spell::CustomDictionary b(file);
    b.load();
    CHECK(a.add("Арагорн").empty());
    CHECK(a.add("Боромир").empty());
    CHECK(b.add("Гэндальф").empty());
    CHECK(b.contains("Арагорн"));  // b's save merged the file as it was
    CHECK(a.remove("Боромир"));
    mfbe::spell::CustomDictionary fresh(file);
    fresh.load();
    CHECK(fresh.contains("Арагорн"));
    CHECK(fresh.contains("Гэндальф"));
    CHECK_FALSE(fresh.contains("Боромир"));
}

#include <mfbe/positions.hpp>
#include <mfbe/recent_files.hpp>
#include <mfbe/utf8_paths.hpp>

#include <thread>

TEST_CASE("store merge: books opened in two copies are all recent, the last opened first",
          "[store-merge]") {
    mfbe::test::TempDir tmp;
    const auto file = tmp / "recent.json";
    settings::RecentFiles a(file);
    a.load();
    settings::RecentFiles b(file);
    b.load();
    a.touch("/books/a.fb2");
    std::this_thread::sleep_for(std::chrono::milliseconds(1100));
    b.touch("/books/b.fb2");
    settings::RecentFiles fresh(file);
    fresh.load();
    REQUIRE(fresh.items().size() == 2);
    CHECK(fresh.items()[0].path == "/books/b.fb2");
    CHECK(fresh.items()[1].path == "/books/a.fb2");
}

TEST_CASE("store merge: positions remembered in two copies are both kept", "[store-merge]") {
    mfbe::test::TempDir tmp;
    const auto file = tmp / "positions.json";
    settings::Positions a(file);
    a.load();
    settings::Positions b(file);
    b.load();
    const std::string pa = mfbe::platform::utf8_from_path(tmp / "a.fb2");
    const std::string pb = mfbe::platform::utf8_from_path(tmp / "b.fb2");
    a.set(pa, settings::Position{"body[1]/section[1]/p[1]", 3});
    b.set(pb, settings::Position{"body[1]/section[2]/p[1]", 5});
    settings::Positions fresh(file);
    fresh.load();
    REQUIRE(fresh.get(pa).has_value());
    CHECK(fresh.get(pa)->offset == 3);
    REQUIRE(fresh.get(pb).has_value());
    CHECK(fresh.get(pb)->offset == 5);
}
