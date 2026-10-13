// Views-framework window of the shell: a top-level CefWindow (1200x800, centred, titled
// "Maxima Fiction Book Editor", icon from resources/icons/app/mfbe-*.png) hosting one
// CefBrowserView. The same delegate also hosts DevTools popups.
#pragma once

#include "include/cef_image.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_browser_view_delegate.h"
#include "include/views/cef_window.h"
#include "include/views/cef_window_delegate.h"

#include <filesystem>
#include <string>

namespace mfbe::shell {

struct WindowIcons {
    CefRefPtr<CefImage> window_icon;  // 32 DIP (32px @1x, 64px @2x) - title bar / task bar
    CefRefPtr<CefImage> app_icon;     // 128 DIP (128px @1x, 256px @2x) - app switcher
};

// Loads the PNG icons from `<resources>/icons/app/`; members stay null when files are
// missing (the window then shows the default icon).
WindowIcons loadWindowIcons(const std::filesystem::path& resources_dir);

class MainWindowDelegate : public CefWindowDelegate {
public:
    enum class Kind { kMain, kDevTools };

    MainWindowDelegate(CefRefPtr<CefBrowserView> browser_view, Kind kind, std::string title,
                       WindowIcons icons, cef_show_state_t initial_show_state);

    MainWindowDelegate(const MainWindowDelegate&) = delete;
    MainWindowDelegate& operator=(const MainWindowDelegate&) = delete;

    // CefWindowDelegate methods:
    void OnWindowCreated(CefRefPtr<CefWindow> window) override;
    void OnWindowDestroyed(CefRefPtr<CefWindow> window) override;
    bool CanClose(CefRefPtr<CefWindow> window) override;
    CefSize GetPreferredSize(CefRefPtr<CefView> view) override;
    CefSize GetMinimumSize(CefRefPtr<CefView> view) override;
    cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override;
    cef_runtime_style_t GetWindowRuntimeStyle() override;
    bool GetLinuxWindowProperties(CefRefPtr<CefWindow> window,
                                  CefLinuxWindowProperties& properties) override;

private:
    CefRefPtr<CefBrowserView> browser_view_;
    const Kind kind_;
    const std::string title_;
    WindowIcons icons_;
    const cef_show_state_t initial_show_state_;

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
