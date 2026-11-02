#include "mfbe_app.h"

#include "copy_bridge.h"
#include "core_host.h"
#include "dialog_provider.h"
#include "include/base/cef_callback.h"
#include "include/base/cef_logging.h"
#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/cef_preference.h"
#include "include/cef_request_context.h"
#include "include/cef_task.h"
#include "include/cef_values.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "mfbe_client.h"
#include "shell_runner.h"
#include "single_instance.h"
#include "window.h"

#include <mfbe/utf8_paths.hpp>

#include <cstdio>
#include <filesystem>
#include <functional>
#include <sstream>
#include <utility>

namespace mfbe::shell {

namespace {

// The Chromium preference that switches the browser engine's own spell checking off - the
// engine's Hunspell and the Windows system checker alike (spellcheck::prefs::kSpellCheckEnable).
constexpr const char* kSpellcheckPreference = "browser.enable_spellchecking";

// Switches the browser engine's own spell checking off (feature 004 US9, FR-081; contracts/
// shell.md §1): the editor's own checker is the only source of marks, so no field of the
// Description view, no dialog and no bar is ever marked, whatever dictionaries the system has.
// CEF 150 has no command-line switch for it any more; the preference is set through CEF's
// preference manager API on the UI thread, before any window, and persists in the profile -
// set at every start regardless, so a profile upgraded from release 0.0.3 follows. It is a
// profile preference: registered with the global request context (the profile the main window
// is created in; CefRequestContext is a CefPreferenceManager), not with Chromium's local state
// behind CefPreferenceManager::GetGlobalPreferenceManager(), which answers "unregistered
// preference" for it. Returns the error text of a refused preference (empty on success).
std::string disableEngineSpellchecking() {
    CEF_REQUIRE_UI_THREAD();
    CefRefPtr<CefPreferenceManager> preferences = CefRequestContext::GetGlobalContext();
    if (!preferences) {
        return "no global request context";
    }
    CefRefPtr<CefValue> off = CefValue::Create();
    off->SetBool(false);
    CefString error;
    if (!preferences->SetPreference(kSpellcheckPreference, off, error)) {
        const std::string text = error.ToString();
        return text.empty() ? "SetPreference refused" : text;
    }
    return {};
}

// Appends "--name" / "--name=value" items of a whitespace separated developer flag list.
void appendExtraFlags(const std::string& flags, const CefRefPtr<CefCommandLine>& command_line) {
    std::istringstream in(flags);
    std::string item;
    while (in >> item) {
        if (item.rfind("--", 0) != 0 || item.size() <= 2) {
            continue;
        }
        const std::string body = item.substr(2);
        const auto eq = body.find('=');
        if (eq == std::string::npos) {
            command_line->AppendSwitch(body);
        } else {
            command_line->AppendSwitchWithValue(body.substr(0, eq), body.substr(eq + 1));
        }
    }
}

std::string chromiumLocale(const std::string& lang) {
    if (lang == "ru") {
        return "ru";
    }
    if (lang == "uk") {
        return "uk";
    }
    if (lang == "en") {
        return "en-US";
    }
    return {};
}

}  // namespace

MfbeApp::MfbeApp(AppConfig config, CoreHost* core_host, std::shared_ptr<NativeDialogs> dialogs)
    : config_(std::move(config)), core_host_(core_host), dialogs_(std::move(dialogs)) {}

void MfbeApp::OnBeforeCommandLineProcessing(const CefString& process_type,
                                            CefRefPtr<CefCommandLine> command_line) {
    if (!process_type.empty()) {
        return;  // browser process only; sub-processes inherit what Chromium gives them
    }
    if (!config_.relay_payload.empty()) {
        command_line->AppendSwitchWithValue("mfbe-request", config_.relay_payload);
    }
    if (config_.no_sandbox && !command_line->HasSwitch("no-sandbox")) {
        command_line->AppendSwitch("no-sandbox");
    }
#if defined(OS_LINUX)
    if (!config_.ozone_platform.empty()) {
        command_line->AppendSwitchWithValue("ozone-platform", config_.ozone_platform);
    } else if (!command_line->HasSwitch("ozone-platform") &&
               !command_line->HasSwitch("ozone-platform-hint")) {
        // Native Wayland when the session offers it, X11 (or XWayland) otherwise; works with
        // the Views framework (research.md D2). Overridden by --ozone-platform.
        command_line->AppendSwitchWithValue("ozone-platform-hint", "auto");
    }
#endif
    const std::string locale = chromiumLocale(config_.lang);
    if (!locale.empty() && !command_line->HasSwitch("lang")) {
        command_line->AppendSwitchWithValue("lang", locale);
    }
    if (!config_.extra_chromium_flags.empty()) {
        appendExtraFlags(config_.extra_chromium_flags, command_line);
    }
}

namespace {
// Feature 008 (contracts/shell.md §3): the record's heartbeat, every 2 s on the browser UI
// thread, so a frozen browser process stops it and other starts pass this copy over.
void heartbeatTick() {
    copyHeartbeat();
    CefPostDelayedTask(TID_UI, base::BindOnce(&heartbeatTick), 2000);
}

// A relayed request the page did not acknowledge within 5 s goes to a new copy (FR-011).
void ackDeadline(std::string request_id, std::vector<std::string> paths) {
    if (takeAcked(request_id) || paths.empty()) {
        return;
    }
    std::string reason;
    if (!spawnCopy(paths, &reason)) {
        LOG(ERROR) << "mfbe: could not start a new copy for an unanswered request: " << reason;
    }
}
}  // namespace

void MfbeApp::OnContextInitialized() {
    if (copyRegistry() != nullptr) {
        CefPostDelayedTask(TID_UI, base::BindOnce(&heartbeatTick), 2000);
    }
    CEF_REQUIRE_UI_THREAD();

    // The engine's own spell checking off before any window exists (feature 004 US9). A refused
    // preference is a warning in the errors-only log (no book text); test-hook builds report the
    // outcome on stdout for tools/shell-smoke.sh ("shelltest: spellcheck engine=off|error ...").
    const std::string spellcheck_error = disableEngineSpellchecking();
    if (!spellcheck_error.empty()) {
        std::string note = "the browser engine's spell checking could not be switched off (";
        note += kSpellcheckPreference;
        note += "): " + spellcheck_error;
        if (core_host_ != nullptr) {
            core_host_->logWarning("shell.spellcheckPreference", note);
        } else {
            std::fprintf(stderr, "mfbe: warning %s\n", note.c_str());
        }
    }
#if defined(MFBE_SHELL_TEST_HOOKS)
    if (spellcheck_error.empty()) {
        std::printf("shelltest: spellcheck engine=off\n");
    } else {
        std::printf("shelltest: spellcheck engine=error %s\n", spellcheck_error.c_str());
    }
    std::fflush(stdout);
#endif

    MfbeClient::Config client_config;
    client_config.app_origin = config_.app_origin;
    client_config.devtools_enabled = config_.devtools_enabled;
    // Documents dropped on the window are opened by the editor (app.openPaths).
    client_config.open_paths = [](const std::vector<std::string>& paths) {
        forwardOpenPaths(paths);
    };
    // The main window's close is offered to the UI first (app.closeRequested, feature 003
    // FR-013); the core host outlives the message loop, so the client may call it at any time.
    if (CoreHost* core_host = core_host_) {
        client_config.request_close = [core_host](std::function<void(bool)> on_delivered) {
            core_host->requestClose(std::move(on_delivered));
        };
        client_config.query_ui_connected = [core_host](std::function<void(bool)> on_result) {
            core_host->queryUiConnected(std::move(on_result));
        };
    }
    CefRefPtr<MfbeClient> client(new MfbeClient(client_config, dialogs_));
    client_ = client;

    const WindowIcons icons = loadWindowIcons(config_.resources_dir);

    CefBrowserSettings browser_settings;
    CefRefPtr<CefBrowserView> browser_view =
        CefBrowserView::CreateBrowserView(client, config_.url, browser_settings, nullptr, nullptr,
                                          new MainBrowserViewDelegate(icons));
    if (!browser_view) {
        LOG(ERROR) << "mfbe: CefBrowserView::CreateBrowserView failed";
        CefQuitMessageLoop();
        return;
    }

    // Create the Window at the remembered or requested placement (feature 003 US3). It will
    // show itself after creation (OnWindowCreated).
    CefWindow::CreateTopLevelWindow(
        new MainWindowDelegate(browser_view, MainWindowDelegate::Kind::kMain, MFBE_PRODUCT_NAME,
                               icons, config_.window_placement));
}

CefRefPtr<CefClient> MfbeApp::GetDefaultClient() {
    // Called when a new browser window is created via Chrome style UI.
    return client_;
}

void deliverOpenRequest(CoreHost* host, const RelayedRequest& request) {
    CEF_REQUIRE_UI_THREAD();
    if (host == nullptr) {
        return;
    }
    expectAck(request.request_id);
    host->notifyOpenRequest(request);
    if (request.kind == "open") {
        CefPostDelayedTask(TID_UI, base::BindOnce(&ackDeadline, request.request_id, request.paths),
                           5000);
    }
}

bool MfbeApp::OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                          const CefString& current_directory) {
    CEF_REQUIRE_UI_THREAD();
    (void)current_directory;

    // Feature 008 (contracts/cli.md §3): only the editor's own --mfbe-request switch is read;
    // every other switch and argument of the relayed line is ignored. A start without books never
    // relays (it opens a new copy), so a line without the switch only raises the window.
    std::vector<CefString> argv;
    command_line->GetArgv(argv);
    std::vector<std::string> args;
    for (size_t i = 1; i < argv.size(); ++i) {
        args.push_back(argv[i].ToString());
    }
    if (const auto request = parseRelayedRequest(args)) {
        deliverOpenRequest(core_host_, *request);
    }
    if (MfbeClient* client = MfbeClient::GetInstance()) {
        client->ShowMainWindow();
    }
    return true;  // handled; do not open a default Chrome window
}

}  // namespace mfbe::shell
