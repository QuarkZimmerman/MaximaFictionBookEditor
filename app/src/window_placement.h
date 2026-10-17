// Placement of the main window (feature 003 US3, data-model §4): the normal bounds plus the
// maximised state, as the original editor's saved WINDOWPLACEMENT. Two forms:
//   * `x,y,w,h[,max]` - the text of `--window-geometry` (contracts/cli.md §1), passed by the
//     editor to the instance it starts in its place;
//   * `{x, y, width, height, maximized?}` - settings.session.windowGeometry, written by the shell
//     at quit and before a restart, read before window creation (core_host.h converts).
// `--window-geometry` wins, then the setting, then a centred 1200x800 window; every placement
// is clamped to the visible work area of its display.
//
// Plain C++ without CEF types so that tests/shell/test_window_placement.cpp can drive it;
// window.cpp applies the result to the CefWindow.
#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace mfbe::shell {

inline constexpr int kDefaultWindowWidth = 1200;
inline constexpr int kDefaultWindowHeight = 800;
inline constexpr int kMinWindowWidth = 640;
inline constexpr int kMinWindowHeight = 400;

// A rectangle in DIP screen coordinates (a window's bounds, a display's work area).
struct ScreenRect {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

struct WindowPlacement {
    int x = 0;  // the normal (restored) bounds
    int y = 0;
    int width = kDefaultWindowWidth;
    int height = kDefaultWindowHeight;
    bool maximized = false;  // shown maximised, the bounds above being the restore rectangle
};

// Parses `x,y,w,h` or `x,y,w,h,max` (decimal integers, w and h positive, nothing else around);
// nullopt for anything else.
std::optional<WindowPlacement> parseWindowGeometry(std::string_view text);

// The text form of `placement`: `x,y,w,h` plus `,max` when maximised.
std::string formatWindowGeometry(const WindowPlacement& placement);

// Keeps the window usable on `area` (the work area of the display it belongs to): the size is
// limited to the area and never below `min_width` x `min_height` (the minimum wins over an area
// smaller than it), the position is moved so the whole window lies inside the area (its origin
// when it cannot). The maximised state is kept.
WindowPlacement clampToArea(const WindowPlacement& placement, const ScreenRect& area, int min_width,
                            int min_height);

// True when `bounds` covers the whole of `area`: such bounds belong to a window being maximised
// (on Windows the frame even hangs over the edges), not to a new normal size.
bool coversArea(const ScreenRect& bounds, const ScreenRect& area);

}  // namespace mfbe::shell
