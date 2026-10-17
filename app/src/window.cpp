#include "window.h"

#include "include/base/cef_logging.h"
#include "include/cef_browser.h"
#include "include/views/cef_display.h"
#include "include/wrapper/cef_helpers.h"

#include <mfbe/utf8_paths.hpp>

#include <fstream>
#include <iterator>
#include <mutex>
#include <utility>
#include <vector>

namespace mfbe::shell {

namespace {

constexpr int kDefaultWidth = kDefaultWindowWidth;
constexpr int kDefaultHeight = kDefaultWindowHeight;
constexpr int kMinWidth = kMinWindowWidth;
constexpr int kMinHeight = kMinWindowHeight;
constexpr int kDevToolsWidth = 1000;
constexpr int kDevToolsHeight = 700;

// X11 WM_CLASS / Wayland app_id; must match app/linux/mfbe.desktop so that window managers
// associate the window with the launcher and its icon.
constexpr const char* kAppId = "mfbe";

// The main window's placement as last reported (window.h: mainWindowPlacement()). Written on
// the CEF UI thread, read by the shell's relaunch (a core thread) and at quit (main thread).
std::mutex g_placement_mutex;
std::optional<WindowPlacement> g_main_window_placement;

ScreenRect toScreenRect(const CefRect& rect) {
    return ScreenRect{rect.x, rect.y, rect.width, rect.height};
}

// The work area of the display `bounds` belongs to (the display nearest to it when it lies on
// none); empty when CEF reports no display, in which case nothing is clamped.
ScreenRect workAreaFor(const CefRect& bounds) {
    CefRefPtr<CefDisplay> display = CefDisplay::GetDisplayMatchingBounds(bounds, false);
    if (!display) {
        return ScreenRect{};
    }
    return toScreenRect(display->GetWorkArea());
}

std::vector<char> readFile(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return {};
    }
    return std::vector<char>((std::istreambuf_iterator<char>(in)),
                             std::istreambuf_iterator<char>());
}

// Adds <dir>/mfbe-<pixels>.png to `image` at `scale`; returns false when missing/invalid.
bool addPng(const CefRefPtr<CefImage>& image, const std::filesystem::path& dir, int pixels,
            float scale) {
    const std::vector<char> data =
        readFile(dir / mfbe::platform::path_from_utf8("mfbe-" + std::to_string(pixels) + ".png"));
    if (data.empty()) {
        return false;
    }
    return image->AddPNG(scale, data.data(), data.size());
}

}  // namespace

WindowIcons loadWindowIcons(const std::filesystem::path& resources_dir) {
    WindowIcons icons;
    if (resources_dir.empty()) {
        return icons;
    }
    const std::filesystem::path dir = resources_dir / "icons" / "app";

    CefRefPtr<CefImage> window_icon = CefImage::CreateImage();
    const bool have_32 = addPng(window_icon, dir, 32, 1.0f);
    addPng(window_icon, dir, 64, 2.0f);
    if (have_32 && !window_icon->IsEmpty()) {
        icons.window_icon = window_icon;
    }

    CefRefPtr<CefImage> app_icon = CefImage::CreateImage();
    const bool have_128 = addPng(app_icon, dir, 128, 1.0f);
    addPng(app_icon, dir, 256, 2.0f);
    if (have_128 && !app_icon->IsEmpty()) {
        icons.app_icon = app_icon;
    }
    if (!icons.window_icon) {
        LOG(WARNING) << "mfbe: window icons not found in " << mfbe::platform::utf8_from_path(dir);
    }
    return icons;
}

std::optional<WindowPlacement> mainWindowPlacement() {
    std::lock_guard<std::mutex> lock(g_placement_mutex);
    return g_main_window_placement;
}

// --- MainWindowDelegate -------------------------------------------------------------------

MainWindowDelegate::MainWindowDelegate(CefRefPtr<CefBrowserView> browser_view, Kind kind,
                                       std::string title, WindowIcons icons,
                                       std::optional<WindowPlacement> placement)
    : browser_view_(std::move(browser_view)),
      kind_(kind),
      title_(std::move(title)),
      icons_(std::move(icons)),
      placement_(kind == Kind::kMain ? std::move(placement) : std::nullopt) {}

void MainWindowDelegate::OnWindowCreated(CefRefPtr<CefWindow> window) {
    CEF_REQUIRE_UI_THREAD();
    window->AddChildView(browser_view_);
    window->SetTitle(title_);
    if (icons_.window_icon) {
        window->SetWindowIcon(icons_.window_icon);
    }
    if (icons_.app_icon) {
        window->SetWindowAppIcon(icons_.app_icon);
    }
    if (kind_ == Kind::kMain) {
        if (placement_) {
            // GetInitialBounds() placed it (and GetInitialShowState() maximises it); the
            // normal bounds are the placement's until the user moves or resizes the window.
            normal_bounds_ =
                ScreenRect{placement_->x, placement_->y, placement_->width, placement_->height};
        } else {
            // Size to the preferred size and centre on the current display.
            window->CenterWindow(CefSize(kDefaultWidth, kDefaultHeight));
            normal_bounds_ = toScreenRect(window->GetBounds());
        }
    }
    window->Show();
    if (browser_view_) {
        browser_view_->RequestFocus();
    }
    if (kind_ == Kind::kMain) {
        RecordPlacement(window);
    }
}

void MainWindowDelegate::OnWindowClosing(CefRefPtr<CefWindow> window) {
    CEF_REQUIRE_UI_THREAD();
    if (kind_ == Kind::kMain) {
        RecordPlacement(window);  // the last word before the window goes
    }
}

void MainWindowDelegate::OnWindowDestroyed(CefRefPtr<CefWindow> window) {
    CEF_REQUIRE_UI_THREAD();
    browser_view_ = nullptr;
    icons_ = WindowIcons();
}

void MainWindowDelegate::OnWindowBoundsChanged(CefRefPtr<CefWindow> window,
                                               const CefRect& new_bounds) {
    CEF_REQUIRE_UI_THREAD();
    if (kind_ != Kind::kMain) {
        return;
    }
    // Only the normal bounds are the restore rectangle: bounds of a maximised, minimised or
    // fullscreen window are not, and neither are bounds that already cover the whole work area
    // (a maximise in progress whose state the window manager has not reported yet).
    if (!window->IsMaximized() && !window->IsMinimized() && !window->IsFullscreen() &&
        new_bounds.width > 0 && new_bounds.height > 0) {
        const ScreenRect area = workAreaFor(new_bounds);
        if (area.width <= 0 || !coversArea(toScreenRect(new_bounds), area)) {
            normal_bounds_ = toScreenRect(new_bounds);
        }
    }
    RecordPlacement(window);
}

void MainWindowDelegate::RecordPlacement(const CefRefPtr<CefWindow>& window) {
    CEF_REQUIRE_UI_THREAD();
    if (!normal_bounds_) {
        return;
    }
    WindowPlacement placement;
    placement.x = normal_bounds_->x;
    placement.y = normal_bounds_->y;
    placement.width = normal_bounds_->width;
    placement.height = normal_bounds_->height;
    placement.maximized = window->IsMaximized();
    std::lock_guard<std::mutex> lock(g_placement_mutex);
    g_main_window_placement = placement;
}

CefRect MainWindowDelegate::GetInitialBounds(CefRefPtr<CefWindow> window) {
    if (kind_ != Kind::kMain || !placement_) {
        return CefRect();  // the preferred size, placed by OnWindowCreated / the system
    }
    // Clamp to the work area of the display the placement is on (or nearest to), so a window
    // remembered on a display that is gone or got smaller stays reachable.
    const CefRect requested(placement_->x, placement_->y, placement_->width, placement_->height);
    const ScreenRect area = workAreaFor(requested);
    if (area.width > 0 && area.height > 0) {
        placement_ = clampToArea(*placement_, area, kMinWidth, kMinHeight);
    }
    return CefRect(placement_->x, placement_->y, placement_->width, placement_->height);
}

bool MainWindowDelegate::CanClose(CefRefPtr<CefWindow> window) {
    CEF_REQUIRE_UI_THREAD();
    // The window closes when the browser agrees (TryCloseBrowser -> DoClose -> OnBeforeClose).
    // The UI owns the document state: MfbeClient::DoClose defers the main window's first close
    // and asks the page (app.closeRequested -> cancel-script prompt, save prompt -> app.quit),
    // see close_handshake.h.
    if (browser_view_) {
        if (CefRefPtr<CefBrowser> browser = browser_view_->GetBrowser()) {
            return browser->GetHost()->TryCloseBrowser();
        }
    }
    return true;
}

CefSize MainWindowDelegate::GetPreferredSize(CefRefPtr<CefView> view) {
    if (kind_ == Kind::kDevTools) {
        return CefSize(kDevToolsWidth, kDevToolsHeight);
    }
    return CefSize(kDefaultWidth, kDefaultHeight);
}

CefSize MainWindowDelegate::GetMinimumSize(CefRefPtr<CefView> view) {
    return CefSize(kMinWidth, kMinHeight);
}

cef_show_state_t MainWindowDelegate::GetInitialShowState(CefRefPtr<CefWindow> window) {
    // A placement that was maximised comes back maximised, its bounds being the restore
    // rectangle (as the original editor restored its saved window placement).
    if (kind_ == Kind::kMain && placement_ && placement_->maximized) {
        return CEF_SHOW_STATE_MAXIMIZED;
    }
    return CEF_SHOW_STATE_NORMAL;
}

cef_runtime_style_t MainWindowDelegate::GetWindowRuntimeStyle() {
    // Chrome style (the only bootstrap since CEF M128); the Chrome toolbar is disabled by the
    // browser view delegate, so the window shows the web content only.
    return CEF_RUNTIME_STYLE_CHROME;
}

bool MainWindowDelegate::GetLinuxWindowProperties(CefRefPtr<CefWindow> window,
                                                  CefLinuxWindowProperties& properties) {
    CefString(&properties.wayland_app_id) = kAppId;
    CefString(&properties.wm_class_class) = kAppId;
    CefString(&properties.wm_class_name) = kAppId;
    CefString(&properties.wm_role_name) = kind_ == Kind::kMain ? "main" : "devtools";
    return true;
}

// --- MainBrowserViewDelegate --------------------------------------------------------------

MainBrowserViewDelegate::MainBrowserViewDelegate(WindowIcons icons) : icons_(std::move(icons)) {}

bool MainBrowserViewDelegate::OnPopupBrowserViewCreated(
    CefRefPtr<CefBrowserView> browser_view, CefRefPtr<CefBrowserView> popup_browser_view,
    bool is_devtools) {
    CEF_REQUIRE_UI_THREAD();
    // Only DevTools reaches this point (MfbeClient::OnBeforePopup cancels every other popup).
    // Create a top-level window for it; it shows itself after creation.
    CefWindow::CreateTopLevelWindow(new MainWindowDelegate(
        popup_browser_view, MainWindowDelegate::Kind::kDevTools,
        is_devtools ? std::string(MFBE_PRODUCT_NAME " - DevTools") : std::string(MFBE_PRODUCT_NAME),
        icons_, std::nullopt));
    return true;  // we created the window
}

CefBrowserViewDelegate::ChromeToolbarType MainBrowserViewDelegate::GetChromeToolbarType(
    CefRefPtr<CefBrowserView> browser_view) {
    return CEF_CTT_NONE;
}

cef_runtime_style_t MainBrowserViewDelegate::GetBrowserRuntimeStyle() {
    return CEF_RUNTIME_STYLE_CHROME;
}

}  // namespace mfbe::shell
