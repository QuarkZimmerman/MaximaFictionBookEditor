// The main window's placement (feature 003 US3, data-model §4): the `x,y,w,h[,max]` text of
// `--window-geometry` is parsed and written back, and a placement is clamped to the visible
// work area of its display (size limited to the area, never below the minimum; position moved
// inside the area) while the maximised state is kept.
#include "window_placement.h"

#include <catch2/catch_test_macros.hpp>
#include <optional>
#include <string>

using mfbe::shell::clampToArea;
using mfbe::shell::coversArea;
using mfbe::shell::formatWindowGeometry;
using mfbe::shell::parseWindowGeometry;
using mfbe::shell::ScreenRect;
using mfbe::shell::WindowPlacement;

namespace {

bool same(const WindowPlacement& a, const WindowPlacement& b) {
    return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height &&
           a.maximized == b.maximized;
}

}  // namespace

TEST_CASE("window geometry: x,y,w,h and x,y,w,h,max are parsed", "[placement]") {
    const auto normal = parseWindowGeometry("10,20,1200,800");
    REQUIRE(normal);
    CHECK(same(*normal, WindowPlacement{10, 20, 1200, 800, false}));

    const auto maximized = parseWindowGeometry("10,20,1200,800,max");
    REQUIRE(maximized);
    CHECK(same(*maximized, WindowPlacement{10, 20, 1200, 800, true}));

    // A window partly off the top-left corner has negative coordinates.
    const auto negative = parseWindowGeometry("-5,-10,640,400");
    REQUIRE(negative);
    CHECK(negative->x == -5);
    CHECK(negative->y == -10);
}

TEST_CASE("window geometry: anything else is rejected", "[placement]") {
    for (const char* text : {"", "a,b,c,d", "1,2,3", "1,2,0,4", "1,2,3,0", "1,2,-3,4",
                             "1,2,3,4,foo", "1,2,3,4,max,extra", " 1,2,3,4", "1,2,3,4,", "1;2;3;4",
                             "1,2,3,4,MAX", "99999999999,2,3,4"}) {
        CHECK_FALSE(parseWindowGeometry(text));
    }
}

TEST_CASE("window geometry: the text form round-trips", "[placement]") {
    CHECK(formatWindowGeometry(WindowPlacement{10, 20, 1200, 800, false}) == "10,20,1200,800");
    CHECK(formatWindowGeometry(WindowPlacement{-5, 0, 640, 400, true}) == "-5,0,640,400,max");
    for (const char* text : {"10,20,1200,800", "0,0,1920,1080,max", "-5,-10,640,400"}) {
        const auto parsed = parseWindowGeometry(text);
        REQUIRE(parsed);
        CHECK(formatWindowGeometry(*parsed) == text);
    }
}

TEST_CASE("window placement: a placement inside the work area is unchanged", "[placement]") {
    const ScreenRect area{0, 0, 1920, 1040};
    const WindowPlacement placement{100, 50, 1200, 800, false};
    CHECK(same(clampToArea(placement, area, 640, 400), placement));
    const WindowPlacement maximized{100, 50, 1200, 800, true};
    CHECK(same(clampToArea(maximized, area, 640, 400), maximized));
}

TEST_CASE("window placement: a window larger than the work area is shrunk to it", "[placement]") {
    const ScreenRect area{0, 0, 1280, 760};
    const auto clamped = clampToArea(WindowPlacement{10, 10, 1920, 1080, false}, area, 640, 400);
    CHECK(same(clamped, WindowPlacement{0, 0, 1280, 760, false}));
}

TEST_CASE("window placement: a window off the screen is moved back onto it", "[placement]") {
    const ScreenRect area{0, 0, 1920, 1040};
    // Off the right and bottom edges (a display that got smaller).
    CHECK(same(clampToArea(WindowPlacement{1500, 900, 1200, 800, false}, area, 640, 400),
               WindowPlacement{720, 240, 1200, 800, false}));
    // Off the top-left corner.
    CHECK(same(clampToArea(WindowPlacement{-300, -200, 1200, 800, false}, area, 640, 400),
               WindowPlacement{0, 0, 1200, 800, false}));
    // A second display whose work area does not start at the origin.
    const ScreenRect right{1920, 0, 1920, 1040};
    CHECK(same(clampToArea(WindowPlacement{3500, 100, 1200, 800, true}, right, 640, 400),
               WindowPlacement{2640, 100, 1200, 800, true}));
}

TEST_CASE("window placement: the minimum size wins over a tiny or oversized request",
          "[placement]") {
    const ScreenRect area{0, 0, 1920, 1040};
    CHECK(same(clampToArea(WindowPlacement{10, 10, 100, 50, false}, area, 640, 400),
               WindowPlacement{10, 10, 640, 400, false}));
    // A work area smaller than the minimum: the minimum size, placed at the area's origin.
    const ScreenRect tiny{0, 0, 500, 300};
    CHECK(same(clampToArea(WindowPlacement{10, 10, 1200, 800, false}, tiny, 640, 400),
               WindowPlacement{0, 0, 640, 400, false}));
}

TEST_CASE("window placement: bounds covering the work area belong to a maximised window",
          "[placement]") {
    const ScreenRect area{0, 0, 1920, 1040};
    CHECK(coversArea(ScreenRect{0, 0, 1920, 1040}, area));
    CHECK(coversArea(ScreenRect{-8, -8, 1936, 1056}, area));  // Windows: the frame hangs over
    CHECK_FALSE(coversArea(ScreenRect{0, 0, 1920, 1039}, area));
    CHECK_FALSE(coversArea(ScreenRect{100, 50, 1200, 800}, area));
}

TEST_CASE("window placement: the default window is 1200x800 with a 640x400 minimum",
          "[placement]") {
    CHECK(mfbe::shell::kDefaultWindowWidth == 1200);
    CHECK(mfbe::shell::kDefaultWindowHeight == 800);
    CHECK(mfbe::shell::kMinWindowWidth == 640);
    CHECK(mfbe::shell::kMinWindowHeight == 400);
}
