// Feature 020 (T019): global imports.* and ocr.* settings defaults, validation, upgrade
// compatibility, and live refresh without restartRequired.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/settings.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;
using namespace mfbe::settings;
using json = nlohmann::json;

TEST_CASE("ocr & imports settings: defaults and schemaVersion 1 compatibility",
          "[settings][ocr][020]") {
    const json def = defaults();
    CHECK(def["schemaVersion"] == 1);
    REQUIRE(def.contains("imports"));
    CHECK(def["imports"]["pdf"]["useOcr"] == true);

    REQUIRE(def.contains("ocr"));
    CHECK(def["ocr"]["folder"] == "");
    CHECK(def["ocr"]["autoDetect"] == true);
    CHECK(def["ocr"]["enabledLanguages"] == json::array({"eng", "rus"}));

    // Legacy settings.json without imports or ocr upgrades seamlessly to defaults
    json legacy = {{"schemaVersion", 1}, {"view", {{"fastMode", true}}}};
    const auto invalid = sanitize(legacy);
    CHECK(invalid.empty());
    CHECK(legacy["imports"]["pdf"]["useOcr"] == true);
    CHECK(legacy["ocr"]["folder"] == "");
    CHECK(legacy["ocr"]["autoDetect"] == true);
    CHECK(legacy["ocr"]["enabledLanguages"] == json::array({"eng", "rus"}));
}

TEST_CASE("ocr & imports settings: validation rejects empty, duplicate, or invalid pack codes",
          "[settings][ocr][020]") {
    REQUIRE_NOTHROW(validate_patch(json{{"imports", {{"pdf", {{"useOcr", false}}}}}}));
    REQUIRE_NOTHROW(validate_patch(
        json{{"ocr",
              {{"folder", "/tmp/my-ocr"},
               {"autoDetect", false},
               {"enabledLanguages", {"eng", "rus", "deu", "ukr"}}}}}));

    // Empty enabledLanguages must be rejected with field "ocr.enabledLanguages"
    try {
        validate_patch(json{{"ocr", {{"enabledLanguages", json::array()}}}});
        FAIL("expected SettingsError for empty enabledLanguages");
    } catch (const SettingsError& e) {
        CHECK(e.field == "ocr.enabledLanguages");
    }

    CHECK_THROWS_AS(validate_patch(json{{"ocr", {{"enabledLanguages", {"eng", "ENG"}}}}}),
                    SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"ocr", {{"enabledLanguages", {"osd"}}}}}), SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"ocr", {{"enabledLanguages", {"../bad"}}}}}),
                    SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"imports", {{"pdf", {{"useOcr", "yes"}}}}}}),
                    SettingsError);
    CHECK_THROWS_AS(validate_patch(json{{"ocr", {{"autoDetect", 1}}}}), SettingsError);
}

TEST_CASE("ocr & imports settings: settings.set applies live without restartRequired",
          "[settings][ocr][rpc][020]") {
    test::TempDir tmp;
    CoreServerOptions opts;
    opts.port = 0;
    opts.data_dir = (tmp / "data").string();
    auto server = CoreServer::start(opts);
    REQUIRE(server != nullptr);

    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    const json res = ws.call(
        "settings.set",
        json{{"patch",
              {{"imports", {{"pdf", {{"useOcr", false}}}}},
               {"ocr",
                {{"folder", (tmp / "custom-ocr").string()},
                 {"autoDetect", false},
                 {"enabledLanguages", {"eng", "deu"}}}}}}});
    REQUIRE(res.contains("result"));
    CHECK(res["result"]["restartRequired"] == false);
    CHECK(res["result"]["settings"]["imports"]["pdf"]["useOcr"] == false);
    CHECK(res["result"]["settings"]["ocr"]["autoDetect"] == false);
    CHECK(res["result"]["settings"]["ocr"]["enabledLanguages"] == json::array({"eng", "deu"}));

    // Empty enabledLanguages fails via RPC with settingsInvalid (1040)
    const json bad = ws.call(
        "settings.set", json{{"patch", {{"ocr", {{"enabledLanguages", json::array()}}}}}});
    REQUIRE(bad.contains("error"));
    CHECK(bad["error"]["code"] == 1040);
    CHECK(bad["error"]["data"]["field"] == "ocr.enabledLanguages");

    // ocr.report reflects updated customFolder immediately (missing because not created yet)
    const json rep = ws.call("ocr.report")["result"];
    CHECK(rep["customFolder"] == (tmp / "custom-ocr").string());
    CHECK(rep["customFolderIssue"] == "missing");
}
