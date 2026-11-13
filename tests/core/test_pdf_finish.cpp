// Feature 014 (research R3, tasks T018): the finishing step on the browser engine's own print
// (tests/fixtures/pdf/chromium-sample.pdf), and the ligature maps.

#include "pdf/check.hpp"
#include "pdf/coverage.hpp"
#include "pdf/document.hpp"
#include "pdf/finish.hpp"
#include "pdf/join.hpp"
#include "pdf/tounicode.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/pdf.hpp>

#include <Catalog.h>
#include <Object.h>
#include <PDFDoc.h>
#include <Page.h>
#include <Stream.h>
#include <XRef.h>
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

    // The images decode: the JPEG keeps its /DCTDecode, the PNG's pixels and mask are whole.
    PDFDoc& d = *doc->impl().doc;
    int jpegs = 0;
    int pixels = 0;
    for (int n = 1; n <= d.getNumPages(); ++n) {
        const Object xobjects = d.getPage(n)->getResourceDictObject()->dictLookup("XObject");
        if (!xobjects.isDict())
            continue;
        for (int i = 0; i < xobjects.dictGetLength(); ++i) {
            if (std::string(xobjects.dictGetKey(i)).rfind("MfbeIm", 0) != 0)
                continue;
            Object image = xobjects.dictGetVal(i);
            REQUIRE(image.isStream());
            const Object filter = image.streamGetDict()->lookup("Filter");
            const int w = image.streamGetDict()->lookup("Width").getInt();
            const int h = image.streamGetDict()->lookup("Height").getInt();
            if (filter.isName("DCTDecode")) {
                ++jpegs;
                continue;
            }
            REQUIRE(filter.isName("FlateDecode"));
            Stream* stream = image.getStream();
            REQUIRE(stream->rewind());
            CHECK(stream->toUnsignedChars().size() == static_cast<std::size_t>(w) * h * 3);
            stream->close();
            Object mask = image.streamGetDict()->lookup("SMask");
            REQUIRE(mask.isStream());
            REQUIRE(mask.getStream()->rewind());
            CHECK(mask.getStream()->toUnsignedChars().size() == static_cast<std::size_t>(w) * h);
            ++pixels;
        }
    }
    CHECK(jpegs == 2);  // one object, drawn on two pages
    CHECK(pixels == 1);
}

TEST_CASE("pdf fonts: the shipped fonts' coverage, and the characters they lack", "[pdf]") {
    const auto fonts = test::fixtures_dir().parent_path().parent_path() / "resources" / "fonts";
    const auto serif = pdf::font_coverage(fonts / "NotoSerif-Regular.ttf");
    REQUIRE(serif.size() > 1000);
    for (char32_t c : std::u32string(U"AzÄßŁřЖжЁёЇїҐґΩωάὰ€№«»—…")) {
        CHECK(serif.contains(c));
    }
    CHECK(pdf::font_coverage(fonts / "NotoSerifGeorgian-Regular.ttf").contains(U'ა'));
    CHECK(pdf::font_coverage(fonts / "NotoSerifArmenian-Regular.ttf").contains(U'Ա'));
    CHECK(pdf::font_coverage(fonts / "fonts.json").empty());

    // Hebrew and Chinese are not shipped (D7): listed once each, in order of appearance.
    const std::vector<std::string> pages = {"Глава 1. Text ა Ա", "שלום 中文 שלום", "\t \xC2\xA0"};
    CHECK(pdf::utf8(pdf::uncovered_characters(pages, fonts)) == "שלום中文");
    CHECK(pdf::uncovered_characters(pages, fonts, 2).size() == 2);
}

TEST_CASE("pdf join: printed parts become one file, with their tags and destinations", "[pdf]") {
    const std::vector<char> joined = pdf::join_parts({sample(), sample(), sample()});
    std::string error;
    auto doc = pdf::Document::open_bytes(joined, &error);
    REQUIRE(doc);
    REQUIRE(doc->page_count() == 6);
    CHECK(doc->page_text(2) == doc->page_text(0));
    CHECK(doc->page_text(5) == doc->page_text(1));

    // The parent tree keys of the later parts move past the earlier ones' (5 keys a part).
    PDFDoc& d = *doc->impl().doc;
    const auto struct_parents = [&d](int page) {
        const Object o = d.getXRef()->fetch(*d.getCatalog()->getPageRef(page));
        return o.dictLookup("StructParents").getInt();
    };
    CHECK(struct_parents(1) == 0);
    CHECK(struct_parents(3) == 5);
    CHECK(struct_parents(5) == 10);
    const Object catalog = d.getXRef()->getCatalog();
    const Object tree = catalog.dictLookup("StructTreeRoot");
    REQUIRE(tree.isDict());
    CHECK(tree.dictLookup("ParentTreeNextKey").getInt() == 15);
    const Object nums = tree.dictLookup("ParentTree").dictLookup("Nums");
    REQUIRE(nums.isArray());
    CHECK(nums.arrayGetLength() == 30);
    const Object document = tree.dictLookup("K");
    REQUIRE(document.isDict());
    CHECK(document.dictLookup("K").arrayGetLength() % 3 == 0);
    CHECK(catalog.dictLookup("Dests").isDict());

    // Finished and checked like one printed part.
    const std::vector<char> finished = pdf::finish(joined, a5("Части"));
    std::vector<std::string> texts;
    for (int i = 0; i < 6; ++i)
        texts.push_back(doc->page_text(i));
    CHECK(pdf::check_finished(finished, texts).empty());
}
