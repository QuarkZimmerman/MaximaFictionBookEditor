// Feature 014 (research R3, tasks T018): the finishing step on the browser engine's own print
// (tests/fixtures/pdf/chromium-sample.pdf), and the ligature maps.

#include "pdf/finish.hpp"
#include "pdf/tounicode.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/pdf.hpp>

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <string>

using namespace mfbe;

namespace {

std::vector<char> sample() {
    const std::string bytes =
        atomic_file::read_file(test::fixtures_dir() / "pdf" / "chromium-sample.pdf");
    return std::vector<char>(bytes.begin(), bytes.end());
}

pdf::FinishInput a5(const std::string& title) {
    pdf::FinishInput input;
    input.width_pt = 148.0 * 72.0 / 25.4;
    input.height_pt = 210.0 * 72.0 / 25.4;
    input.title = title;
    input.lang = "ru";
    input.creator_tool = "Maxima Fiction Book Editor test";
    return input;
}

}  // namespace

TEST_CASE("pdf finish: ligature characters in a ToUnicode map become their letters", "[pdf]") {
    const std::string chars =
        "/CIDInit /ProcSet findresource begin\n2 beginbfchar\n<0003> <0041>\n<0004> <FB01>\n"
        "endbfchar\nendcmap\n";
    const std::string mended = pdf::decompose_ligatures(chars);
    CHECK(mended.find("<0004> <00660069>") != std::string::npos);
    CHECK(mended.find("<0003> <0041>") != std::string::npos);
    CHECK(mended.find("2 beginbfchar") != std::string::npos);
    CHECK(mended.find("FB01") == std::string::npos);

    // A range reaching the ligatures is written out glyph by glyph; the others stay ranges.
    const std::string ranges =
        "2 beginbfrange\n<0010> <0012> <FB00>\n<0020> <0021> <0030>\nendbfrange\nendcmap\n";
    const std::string split = pdf::decompose_ligatures(ranges);
    CHECK(split.find("1 beginbfrange") != std::string::npos);
    CHECK(split.find("<0020> <0021> <0030>") != std::string::npos);
    CHECK(split.find("3 beginbfchar") != std::string::npos);
    CHECK(split.find("<0010> <00660066>") != std::string::npos);
    CHECK(split.find("<0011> <00660069>") != std::string::npos);
    CHECK(split.find("<0012> <0066006C>") != std::string::npos);
    CHECK(split.find("endcmap") > split.find("endbfchar"));

    const std::string plain = "1 beginbfchar\n<0001> <0061>\nendbfchar\n";
    CHECK(pdf::decompose_ligatures(plain) == plain);
}

TEST_CASE("pdf finish: exact page sizes, letters for ligatures, the PDF/A-2U essentials", "[pdf]") {
    const std::vector<char> finished = pdf::finish(sample(), a5("Проба"));
    const std::string bytes(finished.begin(), finished.end());
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    REQUIRE(doc->page_count() == 2);
    for (int i = 0; i < 2; ++i) {
        const auto page = doc->page_info(i);
        CHECK(page.width_pt == Catch::Approx(148.0 * 72.0 / 25.4).margin(0.001));
        CHECK(page.height_pt == Catch::Approx(210.0 * 72.0 / 25.4).margin(0.001));
        for (const auto& font : page.fonts) {
            CHECK(font.embedded);
            CHECK(font.to_unicode);
        }
    }
    CHECK_FALSE(doc->encrypted());
    const std::string text = doc->page_text(0);
    CHECK(text.find("Ligature fi fl ffi") != std::string::npos);
    CHECK(text.find("\xEF\xAC\x81") == std::string::npos);  // U+FB01 is gone
    CHECK(bytes.find("<pdfaid:part>2</pdfaid:part>") != std::string::npos);
    CHECK(bytes.find("<pdfaid:conformance>U</pdfaid:conformance>") != std::string::npos);
    CHECK(bytes.find("<rdf:li xml:lang=\"ru\">Проба</rdf:li>") != std::string::npos);
    CHECK(bytes.find("/GTS_PDFA1") != std::string::npos);
    CHECK(bytes.find("/OutputIntents") != std::string::npos);
    CHECK(bytes.find("/DisplayDocTitle true") != std::string::npos);
    CHECK(bytes.find("Skia/PDF") == std::string::npos);  // Producer is the editor's
}

TEST_CASE("pdf finish: what is not a printed PDF is refused with the fault", "[pdf]") {
    const std::string junk = "not a pdf";
    CHECK_THROWS_AS(pdf::finish(std::vector<char>(junk.begin(), junk.end()), a5("x")),
                    std::runtime_error);
}

TEST_CASE("pdf finish: pictures are drawn from the book's own bytes into their boxes", "[pdf]") {
    pdf::FinishInput input = a5("Проба");
    const std::string jpeg = atomic_file::read_file(test::fixtures_dir() / "images" / "tiny.jpg");
    const std::string png = atomic_file::read_file(test::fixtures_dir() / "images" / "alpha.png");
    input.binaries = {{"cover.jpg", jpeg}, {"alpha.png", png}};
    input.pictures = {{0, 40, 60, 120, 90, "cover.jpg"},
                      {1, 40, 60, 80, 60, "alpha.png"},
                      {1, 40, 200, 120, 90, "cover.jpg"},
                      {1, 40, 320, 50, 50, "missing"}};
    const std::vector<char> finished = pdf::finish(sample(), input);
    const std::string bytes(finished.begin(), finished.end());
    // The JPEG goes in as its own bytes, once for its two places (D12); the PNG with a soft mask.
    // The sample print holds the same JPEG already (Chromium kept it), so it is counted against it.
    const auto count = [&jpeg](const std::string& in) {
        int n = 0;
        for (auto at = in.find(jpeg); at != std::string::npos; at = in.find(jpeg, at + 1))
            ++n;
        return n;
    };
    const std::vector<char> printed = sample();
    CHECK(count(bytes) == count(std::string(printed.begin(), printed.end())) + 1);
    CHECK(bytes.find("/SMask") != std::string::npos);
    CHECK(bytes.find("/MfbeIm") != std::string::npos);
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    CHECK(doc->page_count() == 2);
    CHECK(doc->page_text(0).find("Глава первая") != std::string::npos);
}
