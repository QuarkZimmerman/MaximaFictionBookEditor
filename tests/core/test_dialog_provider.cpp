// Feature 020 (T019): OpenFileRequest.checks / OpenFileResult.checks JSON serialization and
// QueuedDialogProvider round-trip (both native-checkbox and fallback-omitted paths).
#include <mfbe/dialog_provider.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;
using json = nlohmann::json;

TEST_CASE("dialog provider: OpenFileRequest and OpenFileResult checks JSON round-trip",
          "[dialogs][020]") {
    const json req_json = {
        {"title", "Import PDF"},
        {"filters", json::array({{{"name", "PDF files (*.pdf)"}, {"extensions", {"pdf"}}}})},
        {"checks",
         json::array({{{"id", "useOcr"},
                       {"label", "Use OCR for scanned or image-based text"},
                       {"checked", true}}})},
    };
    const OpenFileRequest parsed = open_file_request_from_json(req_json);
    REQUIRE(parsed.checks.size() == 1);
    CHECK(parsed.checks[0].id == "useOcr");
    CHECK(parsed.checks[0].label == "Use OCR for scanned or image-based text");
    CHECK(parsed.checks[0].checked == true);

    const json serialized = to_json(parsed);
    REQUIRE(serialized.contains("checks"));
    REQUIRE(serialized["checks"].size() == 1);
    CHECK(serialized["checks"][0]["id"] == "useOcr");
    CHECK(serialized["checks"][0]["checked"] == true);

    // Result with checks present (native checkbox shown)
    const OpenFileResult with_checks =
        open_file_result_from_json(json{{"paths", {"/tmp/book.pdf"}}, {"checks", {{"useOcr", false}}}});
    REQUIRE(with_checks.paths == std::vector<std::string>{"/tmp/book.pdf"});
    REQUIRE(with_checks.checks.has_value());
    REQUIRE(with_checks.checks->size() == 1);
    CHECK((*with_checks.checks)[0].first == "useOcr");
    CHECK((*with_checks.checks)[0].second == false);
    CHECK(to_json(with_checks)["checks"]["useOcr"] == false);

    // Result without checks (triggers UI fallback modal)
    const OpenFileResult no_checks = open_file_result_from_json(json{{"paths", {"/tmp/book.pdf"}}});
    CHECK_FALSE(no_checks.checks.has_value());
    CHECK_FALSE(to_json(no_checks).contains("checks"));
}

TEST_CASE("dialog provider: QueuedDialogProvider records and returns OpenFile checks",
          "[dialogs][020]") {
    QueuedDialogProvider provider;
    provider.enqueue("dialog.openFile",
                     json{{"paths", {"/tmp/scan.pdf"}}, {"checks", {{"useOcr", true}}}});
    provider.enqueue("dialog.openFile", json{{"paths", {"/tmp/scan2.pdf"}}});

    OpenFileRequest req;
    req.title = "Import PDF";
    req.checks.push_back({"useOcr", "Use OCR", true});

    OpenFileResult first;
    provider.open_file(req, [&](OpenFileResult r) { first = std::move(r); });
    REQUIRE(first.checks.has_value());
    CHECK((*first.checks)[0].first == "useOcr");
    CHECK((*first.checks)[0].second == true);

    OpenFileResult second;
    provider.open_file(req, [&](OpenFileResult r) { second = std::move(r); });
    CHECK_FALSE(second.checks.has_value());

    const auto recorded = provider.dialog_requests();
    REQUIRE(recorded.size() == 2);
    CHECK(recorded[0]["method"] == "dialog.openFile");
    REQUIRE(recorded[0].contains("checks"));
    CHECK(recorded[0]["checks"][0]["id"] == "useOcr");
}
