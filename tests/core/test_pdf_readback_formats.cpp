// Feature 014, User Story 6 (D26; tasks T056): the picture codings a PDF printed elsewhere may use
// - JBIG2, JPEG 2000 and CCITT Group 4 - decoded by the core's Poppler, and a page drawn to pixels.
// The fixtures are synthetic patterns written by tests/fixtures/pdf/make-format-fixtures.py.

#include "pdf/document.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>

#include <Dict.h>
#include <Object.h>
#include <PDFDoc.h>
#include <Page.h>
#include <SplashOutputDev.h>
#include <Stream.h>
#include <algorithm>
#include <array>
#include <catch2/catch_test_macros.hpp>
#include <cstdlib>
#include <splash/SplashBitmap.h>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

std::unique_ptr<pdf::Document> open(const char* name) {
    const std::string bytes = atomic_file::read_file(test::fixtures_dir() / "pdf" / name);
    std::string error;
    auto doc = pdf::Document::open_bytes(std::vector<char>(bytes.begin(), bytes.end()), &error);
    INFO(name << ": " << error);
    REQUIRE(doc);
    return doc;
}

// The decoded samples of page 1's picture.
std::vector<unsigned char> samples(pdf::Document& doc) {
    PDFDoc& d = *doc.impl().doc;
    Object image = d.getPage(1)->getResourceDictObject()->dictLookup("XObject").dictLookup("Im1");
    REQUIRE(image.isStream());
    REQUIRE(image.getStream()->rewind());
    std::vector<unsigned char> out = image.getStream()->toUnsignedChars();
    image.getStream()->close();
    return out;
}

// Page 1 drawn at 72 dpi (one point, one pixel): the RGB of pixel (x, y), from the top left.
struct Drawn {
    std::unique_ptr<SplashOutputDev> out;
    SplashBitmap* bitmap = nullptr;
    std::array<int, 3> at(int x, int y) const {
        const unsigned char* p = bitmap->getDataPtr() + y * bitmap->getRowSize() + x * 3;
        return {p[0], p[1], p[2]};
    }
};

Drawn draw(pdf::Document& doc) {
    PDFDoc& d = *doc.impl().doc;
    SplashColor paper = {255, 255, 255};
    Drawn drawn;
    drawn.out = std::make_unique<SplashOutputDev>(splashModeRGB8, 4, paper);
    drawn.out->startDoc(&d);
    d.displayPage(drawn.out.get(), 1, 72, 72, 0, true, false, false);
    drawn.bitmap = drawn.out->getBitmap();
    REQUIRE(drawn.bitmap != nullptr);
    return drawn;
}

bool black(const std::array<int, 3>& c) {
    return c[0] < 32 && c[1] < 32 && c[2] < 32;
}
bool white(const std::array<int, 3>& c) {
    return c[0] > 223 && c[1] > 223 && c[2] > 223;
}

}  // namespace

TEST_CASE("pdf readback formats: JBIG2 and CCITT Group 4 pictures decode and draw (D26)", "[pdf]") {
    for (const char* name : {"jbig2.pdf", "ccitt.pdf"}) {
        INFO(name);
        auto doc = open(name);
        // 64 x 32, one bit per pixel, 0 black (DeviceGray): the top-left quadrant black.
        const std::vector<unsigned char> bits = samples(*doc);
        REQUIRE(bits.size() == 8 * 32);
        bool pattern = true;
        for (int y = 0; y < 32; ++y) {
            for (int b = 0; b < 8; ++b) {
                const unsigned char want = (y < 16 && b < 4) ? 0x00 : 0xFF;
                pattern = pattern && bits[y * 8 + b] == want;
            }
        }
        CHECK(pattern);
        const Drawn drawn = draw(*doc);
        CHECK(drawn.bitmap->getWidth() == 64);
        CHECK(drawn.bitmap->getHeight() == 32);
        CHECK(black(drawn.at(8, 8)));
        CHECK(black(drawn.at(30, 14)));
        CHECK(white(drawn.at(40, 8)));
        CHECK(white(drawn.at(8, 24)));
    }
}

TEST_CASE("pdf readback formats: a JPEG 2000 picture decodes exactly and draws (D26)", "[pdf]") {
    auto doc = open("jpx.pdf");
    const std::vector<unsigned char> rgb = samples(*doc);
    REQUIRE(rgb.size() == 32 * 24 * 3);
    bool exact = true;
    for (int y = 0; y < 24; ++y) {
        for (int x = 0; x < 32; ++x) {
            const unsigned char* p = &rgb[(y * 32 + x) * 3];
            exact = exact && p[0] == x * 8 && p[1] == y * 10 && p[2] == 128;
        }
    }
    CHECK(exact);  // lossless coding: every sample as written
    // Drawn at one pixel a sample: the engine blends neighbouring samples as it draws, so each
    // pixel lies within the range of the samples around its own.
    const Drawn drawn = draw(*doc);
    CHECK(drawn.bitmap->getWidth() == 32);
    CHECK(drawn.bitmap->getHeight() == 24);
    for (const auto& [x, y] : {std::pair{3, 2}, std::pair{20, 17}, std::pair{31, 23}}) {
        const auto c = drawn.at(x, y);
        CAPTURE(x, y, c[0], c[1], c[2]);
        const int x0 = std::max(x - 1, 0), x1 = std::min(x + 1, 31);
        const int y0 = std::max(y - 1, 0), y1 = std::min(y + 1, 23);
        CHECK(c[0] >= x0 * 8 - 2);
        CHECK(c[0] <= x1 * 8 + 2);
        CHECK(c[1] >= y0 * 10 - 2);
        CHECK(c[1] <= y1 * 10 + 2);
        CHECK(std::abs(c[2] - 128) <= 2);
    }
}
