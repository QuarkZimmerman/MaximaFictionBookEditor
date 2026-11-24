// Feature 020 (T047; data-model.md §5.1, contracts/resource-formats.md §5):
// Catch2 contract tests verifying forward-compatible persistence of Batch Converter PDF OCR
// settings (`pdfUseOcr`, `ocrAutoDetect`, `ocrLanguages`) in `batch-converter.json`, initialized
// from global Settings when absent, completely independent of `settings.json`, and following
// last-to-close-wins across concurrent dialogs.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using nlohmann::json;
using namespace mfbe;

namespace {

struct BatchOcrFixture {
    test::TempDir data{"mfbe-batch-ocr-settings"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    BatchOcrFixture() {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
};

}  // namespace

TEST_CASE(
    "batch.settings.get and batch.settings.save persist PDF OCR settings independently with "
    "forward compatibility and last-to-close-wins",
    "[batch][ocr][rpc]") {
    BatchOcrFixture f;
    const fs::path batch_file = f.data.path() / "batch-converter.json";
    REQUIRE_FALSE(fs::exists(batch_file));

    // 1. Customize global Settings -> Imports & OCR first; first batch.settings.get initializes
    // from global Settings without creating batch-converter.json.
    REQUIRE(
        f.ws.call("settings.set",
                  json{{"patch",
                        {{"imports", {{"pdf", {{"useOcr", false}}}}},
                         {"ocr",
                          {{"autoDetect", false}, {"enabledLanguages", {"eng", "deu", "ukr"}}}}}}})
            .contains("result"));

    const json first = f.ws.call("batch.settings.get", json::object());
    REQUIRE(first.contains("result"));
    CHECK(first["result"]["hasStored"] == false);
    CHECK_FALSE(fs::exists(batch_file));
    const json& s0 = first["result"]["settings"];
    CHECK(s0["pdfUseOcr"] == false);
    CHECK(s0["ocrAutoDetect"] == false);
    CHECK(s0["ocrLanguages"] == json::array({"eng", "deu", "ukr"}));

    // 2. Save independent Batch OCR selections; global settings.json MUST stay completely untouched.
    json modified = s0;
    modified["direction"] = "importToFb2";
    modified["pdfUseOcr"] = true;
    modified["ocrAutoDetect"] = true;
    modified["ocrLanguages"] = json::array({"rus", "pol", "rus", "../bad", "osd", "eng"});

    const json saved = f.ws.call("batch.settings.save", json{{"settings", modified}});
    REQUIRE(saved.contains("result"));
    REQUIRE(fs::exists(batch_file));
    const json& saved_settings = saved["result"]["settings"];
    CHECK(saved_settings["pdfUseOcr"] == true);
    CHECK(saved_settings["ocrAutoDetect"] == true);
    // Duplicates, invalid stems, and internal "osd" are sanitized out; order is preserved.
    CHECK(saved_settings["ocrLanguages"] == json::array({"rus", "pol", "eng"}));

    const json reloaded = f.ws.call("batch.settings.get", json::object());
    REQUIRE(reloaded.contains("result"));
    CHECK(reloaded["result"]["hasStored"] == true);
    CHECK(reloaded["result"]["settings"]["pdfUseOcr"] == true);
    CHECK(reloaded["result"]["settings"]["ocrAutoDetect"] == true);
    CHECK(reloaded["result"]["settings"]["ocrLanguages"] == json::array({"rus", "pol", "eng"}));

    // Changing global Settings afterwards must NOT overwrite stored batch OCR settings.
    REQUIRE(f.ws.call("settings.set",
                      json{{"patch",
                            {{"imports", {{"pdf", {{"useOcr", true}}}}},
                             {"ocr", {{"autoDetect", true}, {"enabledLanguages", {"fra"}}}}}}})
                .contains("result"));

    const json after_global_edit = f.ws.call("batch.settings.get", json::object());
    REQUIRE(after_global_edit.contains("result"));
    CHECK(after_global_edit["result"]["settings"]["pdfUseOcr"] == true);
    CHECK(after_global_edit["result"]["settings"]["ocrAutoDetect"] == true);
    CHECK(after_global_edit["result"]["settings"]["ocrLanguages"] ==
          json::array({"rus", "pol", "eng"}));

    // Verify global Settings was never mutated by batch saves.
    const json global_after = f.ws.call("settings.get", json::object());
    REQUIRE(global_after.contains("result"));
    CHECK(global_after["result"]["imports"]["pdf"]["useOcr"] == true);
    CHECK(global_after["result"]["ocr"]["autoDetect"] == true);
    CHECK(global_after["result"]["ocr"]["enabledLanguages"] == json::array({"fra"}));

    // 3. Forward compatibility: an older Feature 019 batch-converter.json missing pdfUseOcr,
    // ocrAutoDetect, and ocrLanguages initializes those missing keys from current global Settings
    // while keeping all existing batch fields and unknown future keys intact.
    const json older_file{{"schemaVersion", 1},
                          {"direction", "importToFb2"},
                          {"exportFormat", "epub"},
                          {"sourceDir", "/books/legacy"},
                          {"futureBatchKey", "preserve-me"}};
    atomic_file::write_atomic(batch_file, older_file.dump(2));

    const json upgraded = f.ws.call("batch.settings.get", json::object());
    REQUIRE(upgraded.contains("result"));
    CHECK(upgraded["result"]["hasStored"] == true);
    const json& u = upgraded["result"]["settings"];
    CHECK(u["sourceDir"] == "/books/legacy");
    CHECK(u["futureBatchKey"] == "preserve-me");
    CHECK(u["pdfUseOcr"] == true);
    CHECK(u["ocrAutoDetect"] == true);
    CHECK(u["ocrLanguages"] == json::array({"fra"}));

    // Explicit empty ocrLanguages array is preserved (never silently replaced with defaults).
    json empty_langs = u;
    empty_langs["pdfUseOcr"] = false;
    empty_langs["ocrLanguages"] = json::array();
    REQUIRE(f.ws.call("batch.settings.save", json{{"settings", empty_langs}}).contains("result"));
    const json reloaded_empty = f.ws.call("batch.settings.get", json::object());
    CHECK(reloaded_empty["result"]["settings"]["pdfUseOcr"] == false);
    CHECK(reloaded_empty["result"]["settings"]["ocrLanguages"] == json::array());

    // 4. Last-to-close-wins across concurrent dialogs for batch OCR fields.
    json dialog_a = f.ws.call("batch.settings.get", json::object())["result"]["settings"];
    json dialog_b = f.ws.call("batch.settings.get", json::object())["result"]["settings"];
    dialog_a["pdfUseOcr"] = true;
    dialog_a["ocrAutoDetect"] = false;
    dialog_a["ocrLanguages"] = json::array({"eng"});
    dialog_b["pdfUseOcr"] = true;
    dialog_b["ocrAutoDetect"] = true;
    dialog_b["ocrLanguages"] = json::array({"deu", "ukr"});

    REQUIRE(f.ws.call("batch.settings.save", json{{"settings", dialog_a}}).contains("result"));
    REQUIRE(f.ws.call("batch.settings.save", json{{"settings", dialog_b}}).contains("result"));

    const json winner = f.ws.call("batch.settings.get", json::object())["result"]["settings"];
    CHECK(winner["pdfUseOcr"] == true);
    CHECK(winner["ocrAutoDetect"] == true);
    CHECK(winner["ocrLanguages"] == json::array({"deu", "ukr"}));
}
