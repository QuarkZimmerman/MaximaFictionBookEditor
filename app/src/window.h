// Views-framework window of the shell: a top-level CefWindow titled "Maxima Fiction Book
// Editor" (icon from resources/icons/app/mfbe-*.png) hosting one CefBrowserView. The main
// window opens at the placement it is given (--window-geometry, else the stored
// settings.session.windowGeometry - window_placement.h, feature 003 US3) clamped to the work
// area of its display, maximised when the placement says so, and centred at 1200x800 without
// one; it keeps track of its normal bounds and maximised state so the shell can record them
// at quit and hand them to the instance it starts in its place. The same delegate also hosts
// DevTools popups.
#pragma once

#include "include/cef_image.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_browser_view_delegate.h"
#include "include/views/cef_window.h"
#include "include/views/cef_window_delegate.h"
#include "window_placement.h"

#include <filesystem>
#include <optional>
#include <string>

namespace mfbe::shell {

struct WindowIcons {
    CefRefPtr<CefImage> window_icon;  // 32 DIP (32px @1x, 64px @2x) - title bar / task bar
    CefRefPtr<CefImage> app_icon;     // 128 DIP (128px @1x, 256px @2x) - app switcher
};

// Loads the PNG icons from `<resources>/icons/app/`; members stay null when files are
// missing (the window then shows the default icon).
WindowIcons loadWindowIcons(const std::filesystem::path& resources_dir);

// The main window's current placement - its normal bounds and whether it is maximised - as
// last reported by the window (any thread; nullopt before the window exists). Updated on every
// bounds change and when the window closes, so it is valid after the message loop ended.
std::optional<WindowPlacement> mainWindowPlacement();

class MainWindowDelegate : public CefWindowDelegate {
public:
    enum class Kind { kMain, kDevTools };

    // `placement`: where the main window opens (ignored for DevTools); nullopt = centred.
    MainWindowDelegate(CefRefPtr<CefBrowserView> browser_view, Kind kind, std::string title,
                       WindowIcons icons, std::optional<WindowPlacement> placement);

    MainWindowDelegate(const MainWindowDelegate&) = delete;
    MainWindowDelegate& operator=(const MainWindowDelegate&) = delete;

    // CefWindowDelegate methods:
    void OnWindowCreated(CefRefPtr<CefWindow> window) override;
    void OnWindowClosing(CefRefPtr<CefWindow> window) override;
    void OnWindowDestroyed(CefRefPtr<CefWindow> window) override;
    void OnWindowBoundsChanged(CefRefPtr<CefWindow> window, const CefRect& new_bounds) override;
    bool CanClose(CefRefPtr<CefWindow> window) override;
    CefRect GetInitialBounds(CefRefPtr<CefWindow> window) override;
    CefSize GetPreferredSize(CefRefPtr<CefView> view) override;
    CefSize GetMinimumSize(CefRefPtr<CefView> view) override;
    cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override;
    cef_runtime_style_t GetWindowRuntimeStyle() override;
    bool GetLinuxWindowProperties(CefRefPtr<CefWindow> window,
                                  CefLinuxWindowProperties& properties) override;

private:
    // Records the window's normal bounds and maximised state for mainWindowPlacement().
    void RecordPlacement(const CefRefPtr<CefWindow>& window);

    CefRefPtr<CefBrowserView> browser_view_;
    const Kind kind_;
    const std::string title_;
    WindowIcons icons_;
    // The main window's placement, clamped to its display's work area at creation.
    std::optional<WindowPlacement> placement_;
    // The last bounds seen while the window was neither maximised, minimised nor fullscreen:
    // the restore rectangle recorded with the maximised state.
    std::optional<ScreenRect> normal_bounds_;

    IMPLEMENT_REFCOUNTING(MainWindowDelegate);
};

class MainBrowserViewDelegate : public CefBrowserViewDelegate {
public:
    explicit MainBrowserViewDelegate(WindowIcons icons);

    MainBrowserViewDelegate(const MainBrowserViewDelegate&) = delete;
    MainBrowserViewDelegate& operator=(const MainBrowserViewDelegate&) = delete;

    // CefBrowserViewDelegate methods:
    bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> browser_view,
                                   CefRefPtr<CefBrowserView> popup_browser_view,
                                   bool is_devtools) override;
    ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView> browser_view) override;
    cef_runtime_style_t GetBrowserRuntimeStyle() override;

private:
    WindowIcons icons_;

    IMPLEMENT_REFCOUNTING(MainBrowserViewDelegate);
};

}  // namespace mfbe::shell
