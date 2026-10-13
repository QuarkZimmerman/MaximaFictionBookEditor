#include "window.h"

#include "include/base/cef_logging.h"
#include "include/cef_browser.h"
#include "include/wrapper/cef_helpers.h"

#include <fstream>
#include <iterator>
#include <utility>
#include <vector>

namespace mfbe::shell {

namespace {

constexpr int kDefaultWidth = 1200;
constexpr int kDefaultHeight = 800;
constexpr int kMinWidth = 640;
constexpr int kMinHeight = 400;
constexpr int kDevToolsWidth = 1000;
constexpr int kDevToolsHeight = 700;

// X11 WM_CLASS / Wayland app_id; must match app/linux/mfbe.desktop so that window managers
// associate the window with the launcher and its icon.
constexpr const char* kAppId = "mfbe";

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
    const std::vector<char> data = readFile(dir / ("mfbe-" + std::to_string(pixels) + ".png"));
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
        LOG(WARNING) << "mfbe: window icons not found in " << dir.string();
    }
    return icons;
}

// --- MainWindowDelegate -------------------------------------------------------------------

MainWindowDelegate::MainWindowDelegate(CefRefPtr<CefBrowserView> browser_view, Kind kind,
                                       std::string title, WindowIcons icons,
                                       cef_show_state_t initial_show_state)
    : browser_view_(std::move(browser_view)),
      kind_(kind),
      title_(std::move(title)),
      icons_(std::move(icons)),
      initial_show_state_(initial_show_state) {}

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
        // Size to the preferred size and centre on the current display.
        window->CenterWindow(CefSize(kDefaultWidth, kDefaultHeight));
    }
    if (initial_show_state_ != CEF_SHOW_STATE_HIDDEN) {
        window->Show();
    }
    if (browser_view_) {
        browser_view_->RequestFocus();
    }
}

void MainWindowDelegate::OnWindowDestroyed(CefRefPtr<CefWindow> window) {
    CEF_REQUIRE_UI_THREAD();
    browser_view_ = nullptr;
    icons_ = WindowIcons();
}

bool MainWindowDelegate::CanClose(CefRefPtr<CefWindow> window) {
    CEF_REQUIRE_UI_THREAD();
    // Hook for the unsaved-changes prompt: the UI owns the document state, so later the shell
    // will ask the page (app.quit flow) before allowing the close. For now the window closes
    // when the browser agrees (TryCloseBrowser -> DoClose -> OnBeforeClose).
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
    return initial_show_state_;
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
        icons_, CEF_SHOW_STATE_NORMAL));
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
