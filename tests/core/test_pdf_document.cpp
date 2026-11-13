// Feature 014 (tasks T010): the editor's PDF interface on Poppler, read on the browser engine's
// own output (tests/fixtures/pdf/chromium-sample.pdf, made by make-chromium-sample.mjs).

#include "mfbe/pdf.hpp"

#include <algorithm>
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <string>

namespace {

std::filesystem::path sample() {
    return std::filesystem::path(MFBE_TEST_FIXTURES_DIR) / "pdf" / "chromium-sample.pdf";
}

}  // namespace

TEST_CASE("pdf: the browser engine's print opens with its pages, fonts, links and text", "[pdf]") {
    std::string error;
    auto doc = mfbe::pdf::Document::open_file(sample(), &error);
    REQUIRE(doc);
    CHECK(error.empty());
    CHECK(doc->page_count() == 2);
    CHECK(doc->header_version() == "1.4");
    CHECK_FALSE(doc->encrypted());

    const auto first = doc->page_info(0);
    // Chromium rounds A5 (419.528 x 595.276 pt) to whole CSS pixels (research R1).
    CHECK(first.width_pt == Catch::Approx(420.0).margin(0.01));
    CHECK(first.height_pt == Catch::Approx(594.96).margin(0.01));
    REQUIRE(first.fonts.size() == 2);
    for (const auto& font : first.fonts) {
        CHECK(font.subtype == "Type0");
        CHECK(font.descendant == "CIDFontType2");
        CHECK(font.embedded);
        CHECK(font.to_unicode);
        CHECK(font.base_font.find("NotoSerif-") != std::string::npos);
    }
    REQUIRE(first.annots.size() == 2);
    CHECK(first.annots[0].subtype == "Link");
    CHECK(first.annots[0].flags == 4);
    CHECK(first.annots[0].dest == "n1");
    CHECK(first.annots[1].uri == "https://example.org/x");

    const std::string text = doc->page_text(0);
    CHECK(text.find("Глава первая") != std::string::npos);
    CHECK(text.find("французских булок") != std::string::npos);
    CHECK(doc->page_text(1).find("Примечание один") != std::string::npos);
    CHECK(doc->page_text(7).empty());
}

TEST_CASE("pdf: a page size set exactly survives a full rewrite", "[pdf]") {
    std::string error;
    auto doc = mfbe::pdf::Document::open_file(sample(), &error);
    REQUIRE(doc);
    const double a5_w = 148.0 * 72.0 / 25.4;
    const double a5_h = 210.0 * 72.0 / 25.4;
    for (int i = 0; i < doc->page_count(); ++i)
        doc->set_page_size(i, a5_w, a5_h);
    const std::vector<char> saved = doc->save();
    REQUIRE_FALSE(saved.empty());
    REQUIRE(std::string(saved.begin(), saved.begin() + 5) == "%PDF-");

    auto again = mfbe::pdf::Document::open_bytes(saved, &error);
    REQUIRE(again);
    REQUIRE(again->page_count() == 2);
    for (int i = 0; i < 2; ++i) {
        const auto page = again->page_info(i);
        CHECK(page.width_pt == Catch::Approx(a5_w).margin(0.001));
        CHECK(page.height_pt == Catch::Approx(a5_h).margin(0.001));
    }
    CHECK(again->page_text(0).find("Глава первая") != std::string::npos);
}

TEST_CASE("pdf: what is not a PDF is refused with a message", "[pdf]") {
    std::string error;
    CHECK_FALSE(mfbe::pdf::Document::open_bytes({}, &error));
    CHECK_FALSE(error.empty());
    error.clear();
    const std::string junk = "not a pdf at all";
    CHECK_FALSE(
        mfbe::pdf::Document::open_bytes(std::vector<char>(junk.begin(), junk.end()), &error));
    CHECK_FALSE(error.empty());
    error.clear();
    CHECK_FALSE(mfbe::pdf::Document::open_file(sample().parent_path() / "missing.pdf", &error));
    CHECK_FALSE(error.empty());
}
