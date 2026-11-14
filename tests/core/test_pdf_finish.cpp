// Feature 014 (research R3, tasks T018): the finishing step on the browser engine's own print
// (tests/fixtures/pdf/chromium-sample.pdf), and the ligature maps.

#include "pdf/check.hpp"
#include "pdf/coverage.hpp"
#include "pdf/document.hpp"
#include "pdf/finish.hpp"
#include "pdf/fonts.hpp"
#include "pdf/join.hpp"
#include "pdf/tounicode.hpp"
#include "pdf_test_support.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/images.hpp>
#include <mfbe/pdf.hpp>

#include <Catalog.h>
#include <Object.h>
#include <PDFDoc.h>
#include <Page.h>
#include <SplashOutputDev.h>
#include <Stream.h>
#include <XRef.h>
#include <algorithm>
#include <array>
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cstdlib>
#include <filesystem>
#include <splash/SplashBitmap.h>
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
    const std::string xmp = test::pdf_xmp(finished);        // compressed in the file (DP-10)
    CHECK(xmp.find("<pdfaid:part>2</pdfaid:part>") != std::string::npos);
    CHECK(xmp.find("<pdfaid:conformance>U</pdfaid:conformance>") != std::string::npos);
    CHECK(xmp.find("<rdf:li xml:lang=\"ru\">Проба</rdf:li>") != std::string::npos);
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
            // The name, or the one-element array a PNG copied row by row is written with (DP-19).
            REQUIRE((filter.isName("FlateDecode") ||
                     (filter.isArray() && filter.arrayGetLength() == 1 &&
                      filter.arrayGet(0).isName("FlateDecode"))));
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

TEST_CASE("pdf finish: a PDF 1.7 file whose links all lead somewhere", "[pdf]") {
    const std::vector<char> finished = pdf::finish(sample(), a5("Ссылки"));
    CHECK(std::string(finished.data(), 8) == "%PDF-1.7");
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    std::vector<std::string> texts = {doc->page_text(0), doc->page_text(1)};
    CHECK(pdf::check_finished(finished, texts).empty());

    // A named destination taken away: the link to it is a fault.
    PDFDoc& d = *doc->impl().doc;
    Object catalog = d.getXRef()->getCatalog();
    const Object& dests_ref = catalog.dictLookupNF("Dests");
    Object dests = dests_ref.isRef() ? d.getXRef()->fetch(dests_ref.getRef()) : dests_ref.copy();
    REQUIRE(dests.isDict());
    dests.dictRemove("n1");
    if (dests_ref.isRef()) {
        d.getXRef()->setModifiedObject(&dests, dests_ref.getRef());
    } else {
        catalog.dictSet("Dests", std::move(dests));
        d.getXRef()->setModifiedObject(&catalog, d.getXRef()->getRoot());
    }
    const std::vector<char> broken = doc->save();
    const auto faults = pdf::check_finished(broken, texts);
    REQUIRE(faults.size() == 1);
    CHECK(faults[0] == "page 1: a link leads nowhere (n1)");
}

TEST_CASE("pdf check: the bidirectional marks Poppler adds to right-to-left text are not text",
          "[pdf]") {
    CHECK(pdf::comparable("\xE2\x80\xAB\xD7\xA9\xD7\x9C\xD7\x95\xD7\x9D\xE2\x80\xAC \xE2\x80\xAA"
                          "4\xE2\x80\xAC") ==
          "\xD7\xA9\xD7\x9C\xD7\x95\xD7\x9D"
          "4");
    CHECK(pdf::comparable("a\xE2\x81\xA6"
                          "b\xE2\x81\xA9\xE2\x80\x8F"
                          "c\xD8\x9C") == "abc");
}

TEST_CASE("pdf finish: the engine's link annotations carry the Print flag (PDF/A)", "[pdf]") {
    const std::vector<char> finished = pdf::finish(sample(), a5("Ссылки"));
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    PDFDoc& d = *doc->impl().doc;
    int links = 0;
    for (int n = 1; n <= d.getNumPages(); ++n) {
        const Object page = d.getXRef()->fetch(*d.getCatalog()->getPageRef(n));
        const Object annots = page.dictLookup("Annots");
        if (!annots.isArray())
            continue;
        for (int i = 0; i < annots.arrayGetLength(); ++i) {
            const Object annot = annots.arrayGet(i);
            CHECK(annot.dictLookup("F").isInt());
            CHECK(annot.dictLookup("F").getInt() == 4);
            ++links;
        }
    }
    CHECK(links == 3);
}

TEST_CASE("pdf outline: the bookmarks, nested, each to its page and height (D17)", "[pdf]") {
    pdf::FinishInput input = a5("Закладки");
    pdf::Bookmark cover{"Обложка", 0, 0, {}};
    pdf::Bookmark chapter{"Глава первая", 0, 100, {pdf::Bookmark{"Раздел", 1, 50, {}}}};
    input.bookmarks = {cover, chapter};
    const std::vector<char> finished = pdf::finish(sample(), input);
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    PDFDoc& d = *doc->impl().doc;
    const Object catalog = d.getXRef()->getCatalog();
    CHECK(catalog.dictLookup("PageMode").isName("UseOutlines"));
    const Object outlines = catalog.dictLookup("Outlines");
    REQUIRE(outlines.isDict());
    CHECK(outlines.dictLookup("Count").getInt() == 3);
    const Object first = outlines.dictLookup("First");
    REQUIRE(first.isDict());
    const Object second = first.dictLookup("Next");
    REQUIRE(second.isDict());
    const Object child = second.dictLookup("First");
    REQUIRE(child.isDict());
    const Object dest = child.dictLookup("Dest");
    REQUIRE(dest.isArray());
    CHECK(dest.arrayGet(1).isName("XYZ"));
    CHECK(dest.arrayGet(3).getNum() == Catch::Approx(210.0 * 72.0 / 25.4 - 50).margin(0.01));
    CHECK(d.getCatalog()->findPage(dest.arrayGetNF(0).getRef()) == 2);
    // The check of the finished file still passes with the outline in.
    CHECK(pdf::check_finished(finished, {doc->page_text(0), doc->page_text(1)}).empty());
}

TEST_CASE("pdf finish: a font that may not be subset is embedded whole (R6, T053)", "[pdf]") {
    const auto repo = test::fixtures_dir().parent_path().parent_path();
    const std::string regular =
        atomic_file::read_file(repo / "resources" / "fonts" / "NotoSerif-Regular.ttf");
    pdf::FinishInput input = a5("Целиком");
    input.whole_fonts = {{"NotoSerif-Regular", pdf::font_program(regular, 0)}};
    const std::vector<char> finished = pdf::finish(sample(), input);
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    PDFDoc& d = *doc->impl().doc;
    int whole = 0;
    int subsets = 0;
    for (int n = 1; n <= d.getNumPages(); ++n) {
        const Object fonts = d.getPage(n)->getResourceDict()->lookup("Font");
        for (int i = 0; fonts.isDict() && i < fonts.dictGetLength(); ++i) {
            const Object font = fonts.dictGetVal(i);
            const std::string base = font.dictLookup("BaseFont").getName();
            const Object descriptor =
                font.dictLookup("DescendantFonts").arrayGet(0).dictLookup("FontDescriptor");
            if (base == "NotoSerif-Regular") {
                Object program = descriptor.dictLookup("FontFile2");
                REQUIRE(program.isStream());
                CHECK(program.streamGetDict()->lookup("Length1").getInt() ==
                      static_cast<int>(regular.size()));
                REQUIRE(program.getStream()->rewind());
                const auto bytes = program.getStream()->toUnsignedChars();
                CHECK(std::string(bytes.begin(), bytes.end()) == regular);
                CHECK(descriptor.dictLookup("FontName").isName("NotoSerif-Regular"));
                CHECK(descriptor.dictLookup("CIDSet").isNull());
                ++whole;
            } else {
                CHECK(base.find('+') == 6);  // the other fonts stay subsets
                ++subsets;
            }
        }
    }
    CHECK(whole >= 1);
    CHECK(subsets >= 1);
    // Its text reads as before, and the check of the finished file passes.
    CHECK(pdf::check_finished(finished, {doc->page_text(0), doc->page_text(1)}).empty());
}

TEST_CASE("pdf fonts: a face of a collection becomes a font of its own (R6)", "[pdf][fonts]") {
    const auto repo = test::fixtures_dir().parent_path().parent_path();
    const std::string a =
        atomic_file::read_file(repo / "resources" / "fonts" / "DejaVuSansMono.ttf");
    const std::string b =
        atomic_file::read_file(repo / "resources" / "fonts" / "DejaVuSansMono-Bold.ttf");
    // A collection of the two: its header, then each face's table directory and tables, as they are
    // in their files (offsets moved by where each file starts).
    const auto be32 = [](std::uint32_t v) {
        return std::string{static_cast<char>(v >> 24), static_cast<char>(v >> 16),
                           static_cast<char>(v >> 8), static_cast<char>(v)};
    };
    const auto moved = [&](const std::string& font, std::uint32_t by) {
        std::string out = font;
        const auto u16 = [&](std::size_t at) {
            return static_cast<unsigned>(static_cast<unsigned char>(font[at]) << 8 |
                                         static_cast<unsigned char>(font[at + 1]));
        };
        for (unsigned t = 0, n = u16(4); t < n; ++t) {
            const std::size_t entry = 12 + 16 * t + 8;
            const std::uint32_t at = (u16(entry) << 16) | u16(entry + 2);
            out.replace(entry, 4, be32(at + by));
        }
        return out;
    };
    const std::uint32_t first = 12 + 8;
    std::string ttc = "ttcf" + be32(0x00010000) + be32(2) + be32(first) +
                      be32(first + static_cast<std::uint32_t>(a.size()));
    ttc += moved(a, first) + moved(b, first + static_cast<std::uint32_t>(a.size()));
    const auto faces = pdf::inspect_font(ttc, 1);
    REQUIRE(faces.faces.size() == 2);
    REQUIRE(faces.font);
    CHECK(faces.font->postscript == "DejaVuSansMono-Bold");
    const std::string program = pdf::font_program(ttc, 1);
    const auto alone = pdf::inspect_font(program, 0);
    REQUIRE(alone.font);
    CHECK(alone.faces.size() == 1);
    CHECK(alone.font->postscript == "DejaVuSansMono-Bold");
    CHECK(pdf::font_program(a, 0) == a);
    CHECK(pdf::font_program(ttc, 2).empty());
}

TEST_CASE("pdf check: a hyphen the engine adds at a line's end is not a fault (DP-17)", "[pdf]") {
    // The sample's page 1 checked against a page map text missing one hyphen it shows: still sound
    // when the page shows an extra hyphen, a fault when the page lacks a character.
    const std::vector<char> finished = pdf::finish(sample(), a5("Перенос"));
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    std::string page = doc->page_text(0);
    std::vector<std::string> texts = {page, doc->page_text(1)};
    const auto at = page.find('-');
    if (at != std::string::npos) {
        texts[0] = page.substr(0, at) + page.substr(at + 1);
        CHECK(pdf::check_finished(finished, texts).empty());
    }
    texts[0] = page + "Ж";
    CHECK_FALSE(pdf::check_finished(finished, texts).empty());
}

TEST_CASE("pdf finish: a picture is drawn where its box is, the right way up", "[pdf]") {
    // The engine's content leaves its own transformation in force (a flip and a scale): the
    // picture must still fill its box, measured from the page's top left.
    pdf::FinishInput input = a5("Обложка");
    const std::string png =
        atomic_file::read_file(test::fixtures_dir() / "images" / "opaque-rgb.png");
    input.binaries = {{"cover.png", png}};
    input.pictures = {{0, 40, 60, 120, 90, "cover.png"}};
    const std::vector<char> finished = pdf::finish(sample(), input);
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    PDFDoc& d = *doc->impl().doc;
    SplashColor paper = {255, 255, 255};
    SplashOutputDev out(splashModeRGB8, 4, paper);
    out.startDoc(&d);
    d.displayPage(&out, 1, 72, 72, 0, true, false, false);
    SplashBitmap* bitmap = out.getBitmap();
    REQUIRE(bitmap != nullptr);
    const auto at = [bitmap](int x, int y) {
        const unsigned char* p = bitmap->getDataPtr() + y * bitmap->getRowSize() + x * 3;
        return std::array<int, 3>{p[0], p[1], p[2]};
    };
    // The picture's own colours, at its centre and near two corners of the box.
    const images::Bitmap picture = images::decode(png);
    const auto colour = [&picture](double fx, double fy) {
        const int px = std::clamp(static_cast<int>(fx * picture.width), 0, picture.width - 1);
        const int py = std::clamp(static_cast<int>(fy * picture.height), 0, picture.height - 1);
        const std::uint8_t* c =
            &picture.rgba[(static_cast<std::size_t>(py) * picture.width + px) * 4];
        return std::array<int, 3>{c[0], c[1], c[2]};
    };
    for (const auto& [fx, fy] : {std::pair{0.5, 0.5}, std::pair{0.2, 0.2}, std::pair{0.8, 0.8}}) {
        const auto want = colour(fx, fy);
        const auto got = at(static_cast<int>(40 + fx * 120), static_cast<int>(60 + fy * 90));
        CAPTURE(fx, fy, want[0], want[1], want[2], got[0], got[1], got[2]);
        for (int c = 0; c < 3; ++c)
            CHECK(std::abs(got[c] - want[c]) <= 24);
    }
}
