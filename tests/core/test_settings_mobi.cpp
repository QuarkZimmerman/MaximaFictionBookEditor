// Tests for mobi.* settings keys and schemaVersion 1 compatibility (T010, contracts/settings.md).
#include <mfbe/settings.hpp>

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe::settings;
using json = nlohmann::json;

TEST_CASE("mobi.* settings defaults match contract and keep schemaVersion 1", "[settings][mobi]") {
    const json def = defaults();
    CHECK(def["schemaVersion"] == 1);
    REQUIRE(def.contains("mobi"));
    const json& m = def["mobi"];
    CHECK(m["format"] == "joint");
    CHECK(m["tocPlacement"] == "afterTitle");
    CHECK(m["seriesInTitle"] == "seriesAndNumber");
    CHECK(m["openAt"] == "titlePage");
    CHECK(m["kf8PopupFootnotes"] == true);
    CHECK(m["zip"] == false);
}

TEST_CASE("mobi.* settings accept all valid enum/boolean values and reject invalid ones",
          "[settings][mobi]") {
    json valid_patch = {
        {"mobi",
         {{"format", "joint"},
          {"tocPlacement", "end"},
          {"seriesInTitle", "seriesAndNumber"},
          {"openAt", "mainText"},
          {"kf8PopupFootnotes", false},
          {"zip", true}}},
    };
    REQUIRE_NOTHROW(validate_patch(valid_patch));

    json valid_patch2 = {
        {"mobi",
         {{"format", "kf8"},
          {"tocPlacement", "none"},
          {"seriesInTitle", "numberBefore"},
          {"openAt", "titlePage"}}},
    };
    REQUIRE_NOTHROW(validate_patch(valid_patch2));

    // Invalid enum / type values must throw SettingsError with dotted field path
    CHECK_THROWS_AS(validate_patch(json{{"mobi", {{"format", "kfx"}}}}), SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"mobi", {{"tocPlacement", "middle"}}}}), SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"mobi", {{"seriesInTitle", "suffix"}}}}), SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"mobi", {{"openAt", "cover"}}}}), SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"mobi", {{"kf8PopupFootnotes", "yes"}}}}), SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"mobi", {{"zip", 1}}}}), SettingsError);

    // sanitize restores absent or corrupted mobi.* values to contract defaults
    json broken = {{"schemaVersion", 1}, {"mobi", {{"format", "bogus"}, {"zip", "nope"}}}};
    const auto invalid = sanitize(broken);
    CHECK(invalid.size() >= 2);
    CHECK(broken["mobi"]["format"] == "joint");
    CHECK(broken["mobi"]["tocPlacement"] == "afterTitle");
    CHECK(broken["mobi"]["seriesInTitle"] == "seriesAndNumber");
    CHECK(broken["mobi"]["openAt"] == "titlePage");
    CHECK(broken["mobi"]["kf8PopupFootnotes"] == true);
    CHECK(broken["mobi"]["zip"] == false);
}
