// Feature 014, User Story 6 (SC-012; tasks T055): a PDF the editor wrote, read back with Poppler
// alone - the same library a later import would use: the text layer, the editor's record equal to
// the book's description, the hints sound, the bookmarks, the JPEG's own bytes and the PNG's
// pixels.

#include "pdf/document.hpp"
#include "pdf/finish.hpp"
#include "pdf/xmp.hpp"
#include "pdf_test_support.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/images.hpp>
#include <mfbe/node_ids.hpp>

#include <nlohmann/json.hpp>

#include <Catalog.h>
#include <Dict.h>
#include <Object.h>
#include <PDFDoc.h>
#include <Page.h>
#include <Stream.h>
#include <XRef.h>
#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

std::string unescape(std::string text) {
    const std::pair<const char*, const char*> entities[] = {
        {"&lt;", "<"}, {"&gt;", ">"}, {"&quot;", "\""}, {"&amp;", "&"}};
    for (const auto& [from, to] : entities) {
        for (auto at = text.find(from); at != std::string::npos; at = text.find(from, at + 1)) {
            text.replace(at, std::char_traits<char>::length(from), to);
        }
    }
    return text;
}

std::string element(const std::string& xmp, const std::string& name) {
    const std::string open = "<" + name + ">";
    const auto from = xmp.find(open);
    const auto to = xmp.find("</" + name + ">");
    if (from == std::string::npos || to == std::string::npos)
        return {};
    return unescape(xmp.substr(from + open.size(), to - from - open.size()));
}

// A PDF text string (UTF-16BE with its mark, BMP only here) as UTF-8.
std::string utf8_of(const std::string& raw) {
    if (raw.size() < 2 || raw[0] != '\xFE' || raw[1] != '\xFF')
        return raw;
    std::string out;
    for (std::size_t i = 2; i + 1 < raw.size(); i += 2) {
        const unsigned cp =
            (static_cast<unsigned char>(raw[i]) << 8) | static_cast<unsigned char>(raw[i + 1]);
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    return out;
}

std::vector<unsigned char> decoded(Object& stream) {
    REQUIRE(stream.getStream()->rewind());
    std::vector<unsigned char> out = stream.getStream()->toUnsignedChars();
    stream.getStream()->close();
    return out;
}

}  // namespace

TEST_CASE("pdf readback: Poppler alone gives the book back (SC-012)", "[pdf]") {
    // The reference book's description, as the editor's model holds it.
    BinaryStore store;
    model::NodeIdAllocator ids;
    const auto book =
        fb2::read_file(test::fixtures_dir() / "books" / "reference-all-elements.fb2", store, ids);
    const model::Description& description = book.document.description;

    pdf::FinishInput input;
    input.width_pt = 419.53;
    input.height_pt = 595.28;
    input.title = description.titleInfo.bookTitle;
    input.lang = description.titleInfo.lang;
    input.creator_tool = "Maxima Fiction Book Editor test";
    input.description = description;
    input.description_xml = pdf::description_record(description);
    input.hints = R"({"v":1,"blocks":2,"sections":[[0,1]],"anchors":{"0":"Глава первая"}})";
    input.bookmarks = {pdf::Bookmark{"Обложка", 0, 0, {}},
                       pdf::Bookmark{"Глава первая", 0, 120, {pdf::Bookmark{"Раздел", 1, 40, {}}}}};
    const std::string jpeg = atomic_file::read_file(test::fixtures_dir() / "images" / "tiny.jpg");
    const std::string png = atomic_file::read_file(test::fixtures_dir() / "images" / "alpha.png");
    input.binaries = {{"cover.jpg", jpeg}, {"alpha.png", png}};
    input.pictures = {{0, 40, 60, 120, 90, "cover.jpg"}, {1, 40, 60, 80, 60, "alpha.png"}};
    const std::string printed =
        atomic_file::read_file(test::fixtures_dir() / "pdf" / "chromium-sample.pdf");
    const std::vector<char> file =
        pdf::finish(std::vector<char>(printed.begin(), printed.end()), input);

    std::string error;
    auto doc = pdf::Document::open_bytes(file, &error);
    REQUIRE(doc);
    PDFDoc& d = *doc->impl().doc;

    // The text layer.
    const std::vector<std::string> texts = {doc->page_text(0), doc->page_text(1)};
    CHECK(texts[0].find("Глава первая") != std::string::npos);

    // The editor's record: the book's description, and hints the core accepts.
    const std::string xmp = test::pdf_xmp(file);
    REQUIRE_FALSE(xmp.empty());
    CHECK(element(xmp, "mfbe:recordVersion") == "1");
    const std::string record = element(xmp, "mfbe:fb2Description");
    CHECK(record == pdf::description_record(description));
    CHECK(record.find("<book-title>" + description.titleInfo.bookTitle + "</book-title>") !=
          std::string::npos);
    // The annotation is printed on a page of its own, so the record leaves it out (requester,
    // rc.4); the standard field other programs read keeps it.
    REQUIRE(description.titleInfo.annotation.has_value());
    CHECK(record.find("<annotation") == std::string::npos);
    CHECK(element(xmp, "dc:description").find("The annotation of the reference book") !=
          std::string::npos);
    const std::string hints = element(xmp, "mfbe:fb2Hints");
    CHECK(nlohmann::json::parse(hints)["v"] == 1);
    CHECK(pdf::validate_hints(hints, texts).empty());

    // The bookmarks, nested.
    const Object outlines = d.getXRef()->getCatalog().dictLookup("Outlines");
    REQUIRE(outlines.isDict());
    const Object first = outlines.dictLookup("First");
    REQUIRE(first.isDict());
    CHECK(utf8_of(first.dictLookup("Title").getString()) == "Обложка");
    const Object chapter = first.dictLookup("Next");
    REQUIRE(chapter.isDict());
    CHECK(utf8_of(chapter.dictLookup("Title").getString()) == "Глава первая");
    CHECK(utf8_of(chapter.dictLookup("First").dictLookup("Title").getString()) == "Раздел");

    // The pictures: the JPEG's own bytes, the PNG's pixels and its alpha.
    const images::Bitmap bitmap = images::decode(png);
    bool jpeg_found = false;
    bool png_found = false;
    for (int n = 1; n <= d.getNumPages(); ++n) {
        const Object xobjects = d.getPage(n)->getResourceDictObject()->dictLookup("XObject");
        for (int i = 0; xobjects.isDict() && i < xobjects.dictGetLength(); ++i) {
            if (std::string(xobjects.dictGetKey(i)).rfind("MfbeIm", 0) != 0)
                continue;
            Object image = xobjects.dictGetVal(i);
            REQUIRE(image.isStream());
            if (image.streamGetDict()->lookup("Filter").isName("DCTDecode")) {
                Stream* raw = image.getStream()->getUndecodedStream();
                REQUIRE(raw->rewind());
                const auto bytes = raw->toUnsignedChars();
                raw->close();
                CHECK(std::string(bytes.begin(), bytes.end()) == jpeg);
                jpeg_found = true;
                continue;
            }
            const std::vector<unsigned char> rgb = decoded(image);
            Object mask = image.streamGetDict()->lookup("SMask");
            REQUIRE(mask.isStream());
            const std::vector<unsigned char> alpha = decoded(mask);
            REQUIRE(rgb.size() == bitmap.pixel_count() * 3);
            REQUIRE(alpha.size() == bitmap.pixel_count());
            bool same = true;
            for (std::size_t p = 0; p < bitmap.pixel_count(); ++p) {
                for (int c = 0; c < 3; ++c)
                    same = same && rgb[p * 3 + c] == bitmap.rgba[p * 4 + c];
                same = same && alpha[p] == bitmap.rgba[p * 4 + 3];
            }
            CHECK(same);
            png_found = true;
        }
    }
    CHECK(jpeg_found);
    CHECK(png_found);
}

TEST_CASE("pdf readback: the record leaves out the annotation and the history (requester, rc.4)",
          "[pdf]") {
    // Both are printed on pages of their own (the hints' annotationPage and historyPage); a later
    // import takes them from there. The rest of the description stays in the record.
    BinaryStore store;
    model::NodeIdAllocator ids;
    const auto book =
        fb2::read_file(test::fixtures_dir() / "books" / "modern-utf8.fb2", store, ids);
    const model::Description& description = book.document.description;
    REQUIRE(description.titleInfo.annotation.has_value());
    REQUIRE(description.documentInfo.history.has_value());
    const std::string record = pdf::description_record(description);
    CHECK(record.find("<annotation") == std::string::npos);
    CHECK(record.find("<history") == std::string::npos);
    CHECK(record.find("<book-title>" + description.titleInfo.bookTitle + "</book-title>") !=
          std::string::npos);
    CHECK(record.find("<document-info>") != std::string::npos);
}
