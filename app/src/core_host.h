// In-process core host: starts the mfbe core server (loopback HTTP + WebSocket JSON-RPC) inside
// the shell process and hands its URL to the browser window.
//
// This header is CEF-free and exception-free so that it can be included from the shell
// sources compiled with CEF's -fno-exceptions. The implementation (core_host.cpp) is compiled
// in the `mfbe_app_bridge` library with exceptions enabled; it includes
// <mfbe/core_server.hpp> only `#if __has_include(...)` finds it, and otherwise degrades to the
// `--url` developer override so the shell can be built and smoke-tested before the core lands.
#pragma once

#include "window_placement.h"

#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::shell {

class NativeDialogs;

// The shell's answer to app.restart (feature 003 US3): whether the new instance was started,
// the reason when not (reported to the UI as error 1071) and the arguments it was started with
// (recorded by the core's test provider for the journeys).
struct RelaunchOutcome {
    bool started = false;
    std::string reason;
    std::vector<std::string> argv;
};

struct CoreHostOptions {
    // Development override: when non-empty no core is started and this URL is loaded as is.
    std::string url_override;

    // Invoked (from a background thread) when the core stops on its own - `app.quit` RPC -
    // so the shell can close its windows. Not invoked for CoreHost::stop().
    std::function<void()> on_core_stopped;

    // app.restart({reopen?}) (feature 003 US3, rpc-api.md §3.1): starts the same program again
    // with the shell's own options, the window placement and `reopen` as FILE, and reports the
    // outcome; when it was started the core performs the normal quit (as after app.quit).
    // Called on a core thread. Unset = the call is unavailable (1070).
    std::function<RelaunchOutcome(const std::optional<std::string>& reopen)> on_restart;

    // Override root for all per-user folders (CoreServerOptions.data_dir; tests/portable
    // runs). Empty = the platform locations of contracts/resource-formats.md §1.
    std::filesystem::path data_dir_override;
    std::filesystem::path resources_dir;  // bundled resources ("" = core auto-detects)
    std::filesystem::path scripts_dir;    // bundled scripts ("" = core auto-detects)
    std::filesystem::path ui_dir;         // built UI bundle (index.html); may be empty in dev
    std::string ui_language;              // "" (system), "en", "ru" or "uk" (--lang) -> URL ?lang=
    std::vector<std::string> open_paths;  // FILE arguments to open after start-up
    bool new_document = false;            // --new -> URL ?new=1
    bool test_hooks = false;              // enable test.* RPC methods (dev/test builds only)
};

class CoreHost {
public:
    virtual ~CoreHost() = default;

    // Starts the core (or records the --url override). Returns nullptr and sets `error` when
    // the shell cannot proceed (core failed to bind, or no core compiled in and no --url).
    static std::unique_ptr<CoreHost> start(const CoreHostOptions& options, std::string* error);

    // True when the shell was compiled with the in-process core (<mfbe/core_server.hpp> was
    // available at build time).
    static bool coreCompiledIn();

    // The URL the main window must load: http://127.0.0.1:<port>/?token=<token> (core) or the
    // --url override.
    virtual const std::string& url() const = 0;

    // Loopback origin (scheme://host:port) of `url()`; navigation outside it is blocked.
    virtual const std::string& origin() const = 0;

    // True when a core server is running in this process.
    virtual bool hasCore() const = 0;

    // Registers the shell's native dialogs as the core's DialogProvider (dialog.* RPCs,
    // app.openFolder & co. through DialogProvider::open_path) and the OS clipboard reader as
    // its ClipboardProvider (binary.addFromClipboard). No-op without a running core.
    virtual void attachDialogs(std::shared_ptr<NativeDialogs> dialogs) = 0;

    // Forwards paths from a second instance / OS "Open with" / drag-and-drop / macOS
    // open-file events (app.openPaths notification).
    virtual void notifyOpenPaths(const std::vector<std::string>& paths) = 0;

    // Close handshake of the main window (feature 003 FR-013): asks the UI to close through the
    // core (app.closeRequested); the UI runs its quit flow - cancel-script prompt, save prompt -
    // and ends it with app.quit. `on_delivered` receives whether any UI client was connected to
    // receive the request; it may be called from a core thread, or at once (false) without a
    // running core.
    virtual void requestClose(std::function<void(bool delivered)> on_delivered) = 0;

    // Reports whether a UI client is connected to the core (`on_result`, possibly from a core
    // thread; at once with false without a running core). The close handshake asks it when the
    // UI did not answer in time: a connected UI declined, a vanished one cannot answer.
    virtual void queryUiConnected(std::function<void(bool connected)> on_result) = 0;

    // Records a shell-side warning in the core's errors-only log (source "shell"); also
    // printed to stderr when no core is running. Never includes book text.
    virtual void logWarning(const std::string& code, const std::string& message) = 0;

    // The window placement of settings.session.windowGeometry (feature 003 US3, data-model §4),
    // read through the core's in-process accessor before the window is created; nullopt when
    // none is stored (or no core runs). Any thread; blocks until the core answers.
    virtual std::optional<WindowPlacement> windowPlacement() = 0;

    // Writes the placement back to settings.session.windowGeometry (at quit and before a
    // restart); false when it could not be stored. Works after the core stopped on app.quit,
    // as long as stop() was not called.
    virtual bool saveWindowPlacement(const WindowPlacement& placement) = 0;

    // The stored interface language (settings view.uiLanguage): "en", "ru" or "uk", or "" for
    // "system" / unknown / no core. The shell's own texts (native dialogs, the right-click menu)
    // and Chromium's locale follow it when no --lang override was given.
    virtual std::string uiLanguageSetting() = 0;

    // Stops the server (idempotent). Must be called before CefShutdown() so that the dialog
    // provider releases its CEF references first.
    virtual void stop() = 0;
};

}  // namespace mfbe::shell
