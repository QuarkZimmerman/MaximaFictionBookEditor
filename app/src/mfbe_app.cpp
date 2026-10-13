#include "mfbe_app.h"

#include "core_host.h"
#include "dialog_provider.h"
#include "include/base/cef_logging.h"
#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"
#include "mfbe_client.h"
#include "shell_runner.h"
#include "single_instance.h"
#include "window.h"

#include <filesystem>
#include <sstream>
#include <utility>

namespace mfbe::shell {

namespace {

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

void MfbeApp::OnContextInitialized() {
    CEF_REQUIRE_UI_THREAD();

    MfbeClient::Config client_config;
    client_config.app_origin = config_.app_origin;
    client_config.devtools_enabled = config_.devtools_enabled;
    // Documents dropped on the window are opened by the editor (app.openPaths).
    client_config.open_paths = [](const std::vector<std::string>& paths) {
        forwardOpenPaths(paths);
    };
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

    // Create the Window. It will show itself after creation (OnWindowCreated).
    CefWindow::CreateTopLevelWindow(
        new MainWindowDelegate(browser_view, MainWindowDelegate::Kind::kMain, MFBE_PRODUCT_NAME,
                               icons, CEF_SHOW_STATE_NORMAL));
}

CefRefPtr<CefClient> MfbeApp::GetDefaultClient() {
    // Called when a new browser window is created via Chrome style UI.
    return client_;
}

bool MfbeApp::OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                          const CefString& current_directory) {
    CEF_REQUIRE_UI_THREAD();

    // Re-parse the second instance's command line with the shell grammar and forward FILEs
    // (relative to the second instance's working directory). Its other options are ignored:
    // the running instance keeps its language, sandbox and display settings.
    std::vector<CefString> argv;
    command_line->GetArgv(argv);
    std::vector<std::string> args;
    for (size_t i = 1; i < argv.size(); ++i) {
        args.push_back(argv[i].ToString());
    }
    const std::vector<std::string> paths =
        relaunchFilePaths(args, std::filesystem::path(current_directory.ToString()));
    if (!paths.empty() && core_host_ != nullptr) {
        core_host_->notifyOpenPaths(paths);
    }
    if (MfbeClient* client = MfbeClient::GetInstance()) {
        client->ShowMainWindow();  // plain relaunch without FILEs: just raise the window
    }
    return true;  // handled; do not open a default Chrome window
}

}  // namespace mfbe::shell
