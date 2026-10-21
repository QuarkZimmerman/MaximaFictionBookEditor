// CefApp + CefBrowserProcessHandler of the shell (Chrome bootstrap, Views framework).
//
//  * OnBeforeCommandLineProcessing: the shell owns its command line (contracts/cli.md), so
//    CefSettings.command_line_args_disabled is set and the few Chromium switches we need are
//    appended here: --no-sandbox, --ozone-platform=<x11|wayland> or the default
//    --ozone-platform-hint=auto on Linux (Wayland native when available), --lang, plus any
//    developer flags from the MFBE_CHROMIUM_FLAGS environment variable.
//  * OnContextInitialized: switches the browser engine's own spell checking off through the
//    preference browser.enable_spellchecking (feature 004 US9; CEF 150 has no switch for it),
//    then creates the Views window with the browser view loading the core's URL
//    (http://127.0.0.1:<port>/?token=<token>) or the --url override.
//  * OnAlreadyRunningAppRelaunch: a second instance (OS "Open with", file association)
//    forwards its FILE arguments to the running core (app.openPaths) and activates the window
//    (single_instance.h describes the mechanism and the exit codes).
#pragma once

#include "include/cef_app.h"
#include "window_placement.h"

#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::shell {

class CoreHost;
class NativeDialogs;

struct AppConfig {
    std::string url;                      // initial URL of the main window
    std::string app_origin;               // loopback origin that may be navigated
    std::filesystem::path resources_dir;  // for window icons
    bool devtools_enabled = false;        // F12 -> DevTools
    bool no_sandbox = false;              // --no-sandbox
    std::string ozone_platform;           // "" (auto), "x11" or "wayland" (Linux)
    std::string lang;                     // "" (system), "en", "ru" or "uk": Chromium's locale
    std::string extra_chromium_flags;     // MFBE_CHROMIUM_FLAGS (space separated --switches)
    // Where the main window opens (feature 003 US3): --window-geometry, else the stored
    // settings.session.windowGeometry; nullopt = centred 1200x800.
    std::optional<WindowPlacement> window_placement;
};

class MfbeApp : public CefApp, public CefBrowserProcessHandler {
public:
    MfbeApp(AppConfig config, CoreHost* core_host, std::shared_ptr<NativeDialogs> dialogs);

    MfbeApp(const MfbeApp&) = delete;
    MfbeApp& operator=(const MfbeApp&) = delete;

    // CefApp methods:
    void OnBeforeCommandLineProcessing(const CefString& process_type,
                                       CefRefPtr<CefCommandLine> command_line) override;
    CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }

    // CefBrowserProcessHandler methods:
    void OnContextInitialized() override;
    CefRefPtr<CefClient> GetDefaultClient() override;
    bool OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                     const CefString& current_directory) override;

private:
    const AppConfig config_;
    CoreHost* const core_host_;  // owned by main(); outlives CEF
    std::shared_ptr<NativeDialogs> dialogs_;
    CefRefPtr<CefClient> client_;

    IMPLEMENT_REFCOUNTING(MfbeApp);
};

}  // namespace mfbe::shell
