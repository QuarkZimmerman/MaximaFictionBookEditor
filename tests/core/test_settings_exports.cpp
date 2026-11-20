// Feature 017 (T017; DP-7, contracts/settings.md): the export dialogs' defaults - a value outside
// its list is refused with its field, as the other settings are (1040), and the defaults stand.

#include "test_support.hpp"

#include <mfbe/settings.hpp>

#include <catch2/catch_test_macros.hpp>

using nlohmann::json;
using namespace mfbe;

TEST_CASE("settings: the export dialogs' defaults and their checks (feature 017)", "[settings]") {
    test::TempDir tmp;
    settings::SettingsStore store(tmp / "settings.json");
    store.load();
    const json d = store.get();
    CHECK(d["txt"]["encodingMode"] == "utf-8");
    CHECK(d["txt"]["encodings"]["ru"] == "windows-1251");
    CHECK(d["pdf"]["zip"] == false);
    CHECK(d["markdown"]["includePictures"] == true);
    auto refused = [&](const json& patch, const std::string& field) {
        try {
            store.apply_patch(patch);
            FAIL("expected SettingsError for " << field);
        } catch (const settings::SettingsError& e) {
            CHECK(e.field == field);
        }
    };
    refused(json{{"txt", {{"encodings", {{"ru", "windows-1252"}}}}}}, "txt.encodings.ru");
    refused(json{{"txt", {{"encodings", {{"en", "koi8-r"}}}}}}, "txt.encodings.en");
    refused(json{{"txt", {{"encodingMode", "koi8"}}}}, "txt.encodingMode");
    refused(json{{"txt", {{"bom", "yes"}}}}, "txt.bom");
    refused(json{{"pdf", {{"zip", 1}}}}, "pdf.zip");
    store.apply_patch(json{{"txt", {{"encodings", {{"other", "windows-1257"}}}, {"zip", true}}}});
    CHECK(store.get()["txt"]["encodings"]["other"] == "windows-1257");
    CHECK(store.get()["txt"]["zip"] == true);
}
