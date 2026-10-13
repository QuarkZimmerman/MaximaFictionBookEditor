// Start-up sequence of the browser process (see shell_runner.h):
//   1. Parse the shell command line (contracts/cli.md) - --version/--help exit 0, invalid
//      options exit 2.
//   2. Resolve per-user directories (CEF profile under <data>/cef, CEF log under <logs>) or a
//      throw-away profile for --url developer runs; drop a stale single-instance lock.
//   3. Probe the Linux sandbox prerequisites (sandbox_check.h): without --no-sandbox the
//      sandbox stays on whenever user namespaces or the SUID helper work, and is switched off
//      with a logged warning only when neither does (AppImage on Ubuntu 24.04+, containers).
//   4. Start the in-process core (CoreHost) -> URL, or use the --url override.
//   5. CefInitialize with the Chrome bootstrap + Views; CefRunMessageLoop; CefShutdown.
//      A second instance returns here with CefInitialize() == false after handing its command
//      line to the running one (exit code 0, see single_instance.h).

#include "shell_runner.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <system_error>

#if defined(MFBE_SHELL_TEST_HOOKS)
#include <chrono>
#include <thread>
#endif

#include "clipboard_bridge.h"
#include "command_line.h"
#include "core_host.h"
#include "dialog_provider.h"
#include "include/base/cef_logging.h"
#include "include/cef_version.h"
#include "include/cef_version_info.h"
#include "mfbe_app.h"
#include "mfbe_client.h"
#include "native_actions.h"

#if defined(OS_WIN)
#include <windows.h>
#endif
#include "sandbox_check.h"
#include "single_instance.h"
#include "user_dirs.h"

#include <cctype>

namespace {

// Two-letter OS language code ("ru", "en", ...) from the user's locale; empty when unknown.
std::string systemLanguageCode() {
#if defined(OS_WIN)
    wchar_t name[LOCALE_NAME_MAX_LENGTH] = {};
    if (GetUserDefaultLocaleName(name, LOCALE_NAME_MAX_LENGTH) > 0 && name[0] != L'\0') {
        std::string code;
        for (int i = 0; i < 2 && name[i] != L'\0' && name[i] != L'-'; ++i) {
            code.push_back(static_cast<char>(std::tolower(static_cast<int>(name[i]))));
        }
        return code.size() == 2 ? code : std::string();
    }
    return std::string();
#else
    for (const char* var : {"LC_ALL", "LC_MESSAGES", "LANG"}) {
        const char* value = std::getenv(var);
        if (value == nullptr || *value == '\0' || std::string(value) == "C" ||
            std::string(value) == "POSIX") {
            continue;
        }
        std::string code;
        for (const char* c = value; *c != '\0' && *c != '_' && *c != '.' && *c != '@' && *c != '-';
             ++c) {
            code.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(*c))));
        }
        if (code.size() == 2) {
            return code;
        }
    }
    return std::string();
#endif
}

}  // namespace

namespace mfbe::shell {

namespace {

// The core host of the running browser process (set for the lifetime of the message loop) so
// platform entry points (macOS open-file events) can forward paths without a CEF handle.
CoreHost* g_core_host = nullptr;

CefVersionInfo cefVersions() {
    CefVersionInfo info;
    info.compiled_cef_version = CEF_VERSION;
    info.api_version = CEF_API_VERSION;
    // Versions of the libcef actually loaded (may differ from the headers with API versioning).
    cef_version_info_t runtime = {};
    runtime.size = sizeof(runtime);
    cef_version_info_all(&runtime);
    info.runtime_cef_version = std::to_string(runtime.cef_version_major) + "." +
                               std::to_string(runtime.cef_version_minor) + "." +
                               std::to_string(runtime.cef_version_patch);
    info.runtime_chromium_version = std::to_string(runtime.chrome_version_major) + "." +
                                    std::to_string(runtime.chrome_version_minor) + "." +
                                    std::to_string(runtime.chrome_version_build) + "." +
                                    std::to_string(runtime.chrome_version_patch);
    return info;
}

std::string envString(const char* name) {
    const char* value = std::getenv(name);
    return value != nullptr ? std::string(value) : std::string();
}

#if defined(OS_WIN)
// First start of an installed build: refresh Explorer's view of the .fb2/.fbd associations the
// installer registered (the MSI writes plain registry values, which Explorer caches). Done once
// per build id, tracked by an empty marker file in the per-user data folder.
void notifyAssociationsOnce(const std::filesystem::path& data_dir) {
    const std::filesystem::path marker = data_dir / ("assoc-notified-" MFBE_BUILD_ID);
    std::error_code ec;
    if (data_dir.empty() || std::filesystem::exists(marker, ec)) {
        return;
    }
    notifyFileAssociationsChanged();
    std::ofstream(marker).put('\n');
}
#endif

#if defined(MFBE_SHELL_TEST_HOOKS)
// Test hook (dev/test builds only): MFBE_SHELL_SELFTEST=messagebox shows a native message box
// from a background thread two seconds after start-up, exactly as the core would, and prints
// `selftest: messagebox button=<id>` once it is answered. tools/shell-smoke.sh clicks the
// button through CDP. MFBE_SHELL_SELFTEST=openfile does the same with the Open dialog
// (prints the selected paths; cancel = "cancelled"). MFBE_SHELL_SELFTEST=clipboard reads
// an image from the OS clipboard through the core's provider path and prints
// `selftest: clipboard <bytes> <content type>` or `selftest: clipboard none`.
void startSelfTest(const std::string& which, std::shared_ptr<NativeDialogs> dialogs) {
    if (which != "messagebox" && which != "openfile" && which != "clipboard") {
        return;
    }
    std::thread([which, dialogs] {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        if (which == "clipboard") {
            std::string content_type;
            std::size_t size = 0;
            if (readClipboardImageForTest(&content_type, &size)) {
                std::printf("selftest: clipboard %zu %s\n", size, content_type.c_str());
            } else {
                std::printf("selftest: clipboard none\n");
            }
            std::fflush(stdout);
            return;
        }
        if (which == "messagebox") {
            MessageRequest request;
            request.caption = "mfbe self-test";
            request.text = "Native message box rendered by the shell.\nПроверка сообщения.";
            request.buttons = {"ok|OK", "cancel|Отмена"};
            const MessageResult result = dialogs->showMessageAndWait(request);
            std::printf("selftest: messagebox button=%s\n", result.button.c_str());
        } else {
            FileDialogRequest request;
            request.mode = FileDialogMode::kOpenMultiple;
            request.title = "mfbe self-test: open";
            request.filters = {{"FictionBook", {"fb2", "fbd"}}, {"", {"image/*"}}};
            const FileDialogResult result = dialogs->runFileDialogAndWait(request);
            std::string paths;
            for (const auto& path : result.paths) {
                paths += (paths.empty() ? "" : ";") + path;
            }
            std::printf("selftest: openfile %s\n", result.cancelled ? "cancelled" : paths.c_str());
        }
        std::fflush(stdout);
    }).detach();
}
#endif  // MFBE_SHELL_TEST_HOOKS

}  // namespace

int runBrowserProcess(const CefMainArgs& main_args, int argc, const char* const* argv,
                      void* sandbox_info, const RunHooks& hooks) {
    const ParseResult parsed = parseCommandLine(argc, argv);
    if (parsed.status == ParseStatus::kExitError) {
        std::fprintf(stderr, "%s\n", parsed.message.c_str());
        std::fprintf(stderr, "Try 'mfbe --help' for more information.\n");
        return 2;
    }
    if (parsed.status == ParseStatus::kExitOk) {
        if (parsed.options.show_version) {
            std::fputs(versionText(cefVersions()).c_str(), stdout);
        } else {
            std::fputs(parsed.message.c_str(), stdout);
        }
        return 0;
    }
    const ShellOptions& options = parsed.options;
    const bool dev_url_mode = !options.url_override.empty();

    // Directories.
    const UserDirs dirs = userDirs();
    std::filesystem::path profile_dir;  // CEF root_cache_path
    std::filesystem::path log_dir;
    std::filesystem::path temp_profile;
    if (dev_url_mode) {
        // Developer runs never touch the user's profile.
        temp_profile = makeTempProfileDir();
        profile_dir = temp_profile / "cef";
        log_dir = temp_profile / "logs";
    } else {
        profile_dir = dirs.data / "cef";
        log_dir = dirs.logs;
    }
    if (!ensureDirectory(profile_dir) || !ensureDirectory(log_dir)) {
        std::fprintf(stderr, "mfbe: cannot create the profile directory %s\n",
                     profile_dir.string().c_str());
        return 1;
    }
    std::string lock_note;
    if (removeStaleSingletonLock(profile_dir, &lock_note)) {
        LOG(WARNING) << "mfbe: " << lock_note;
    }

    // Sandbox prerequisites (Linux). Probed before the core starts its threads.
    bool no_sandbox = options.no_sandbox;
    std::string sandbox_note;
    if (!no_sandbox) {
        const SandboxProbe probe = probeSandbox(executableDir());
        if (!probe.usable()) {
            no_sandbox = true;
            sandbox_note = "Chromium sandbox unavailable (" + describeSandboxProbe(probe) +
                           "); running without the sandbox";
        } else {
            LOG(INFO) << "mfbe: sandbox available (" << describeSandboxProbe(probe) << ")";
        }
    }

    // In-process core (or the --url override).
    CoreHostOptions core_options;
    core_options.url_override = options.url_override;
    // app.quit stops the core; close the window(s) so the message loop ends. CloseAllBrowsers
    // marshals itself to the CEF UI thread.
    core_options.on_core_stopped = [] {
        if (MfbeClient* client = MfbeClient::GetInstance()) {
            client->CloseAllBrowsers(true);
        }
    };
    // data_dir_override stays empty: the core resolves the same platform folders as `dirs`.
    core_options.resources_dir = resourcesDir();
    core_options.scripts_dir = scriptsDir();
    core_options.ui_dir = uiDistDir();
    core_options.ui_language = options.lang;
    for (const auto& file : options.files) {
        std::error_code ec;
        const std::filesystem::path absolute = std::filesystem::absolute(file, ec);
        core_options.open_paths.push_back(ec ? file : absolute.lexically_normal().string());
    }
    core_options.new_document = options.new_document;
#if defined(MFBE_SHELL_TEST_HOOKS)
    core_options.test_hooks = true;
#endif
    std::string core_error;
    std::unique_ptr<CoreHost> core_host = CoreHost::start(core_options, &core_error);
    if (!core_host) {
        std::fprintf(stderr, "mfbe: %s\n", core_error.c_str());
        removeDirectory(temp_profile);
        return 1;
    }
    auto dialogs = std::make_shared<NativeDialogs>();
    core_host->attachDialogs(dialogs);
    g_core_host = core_host.get();
#if defined(OS_WIN)
    if (!dev_url_mode) {
        notifyAssociationsOnce(dirs.data);
    }
#endif
    if (!sandbox_note.empty()) {
        // Errors-only log (FR-131) + stderr; the AppImage/containers hit this path.
        core_host->logWarning("shell.sandboxDisabled", sandbox_note);
        std::fprintf(stderr, "mfbe: %s\n", sandbox_note.c_str());
        LOG(WARNING) << "mfbe: " << sandbox_note;
    }

    // CEF settings.
    CefSettings settings;
    settings.no_sandbox = no_sandbox ? 1 : 0;
#if defined(OS_WIN)
    if (sandbox_info == nullptr) {
        settings.no_sandbox = 1;
    }
#endif
    settings.command_line_args_disabled = 1;  // the shell owns argv; see MfbeApp
    settings.remote_debugging_port = options.remote_debugging_port;
    CefString(&settings.root_cache_path) = profile_dir.string();
    CefString(&settings.cache_path) = profile_dir.string();
    CefString(&settings.log_file) = (log_dir / "cef-debug.log").string();
#if defined(NDEBUG)
    settings.log_severity = LOGSEVERITY_ERROR;
#else
    settings.log_severity = LOGSEVERITY_WARNING;
#endif
    // Interface language: --lang wins; otherwise the OS language so that the page's
    // navigator.languages reflects the real system (CEF defaults to en-US on Windows/macOS).
    std::string lang = options.lang;
    if (lang.empty()) {
        lang = systemLanguageCode();
    }
    if (lang == "ru") {
        CefString(&settings.locale) = "ru";  // ignored on Linux (env-based), used elsewhere
        CefString(&settings.accept_language_list) = "ru,en-US,en";
    } else if (lang == "en") {
        CefString(&settings.locale) = "en-US";
        CefString(&settings.accept_language_list) = "en-US,en";
    }

    AppConfig app_config;
    app_config.url = core_host->url();
    app_config.app_origin = core_host->origin();
    app_config.resources_dir = core_options.resources_dir;
    app_config.no_sandbox = no_sandbox;
    app_config.ozone_platform = options.ozone_platform;
    app_config.lang = options.lang;
    app_config.extra_chromium_flags = envString("MFBE_CHROMIUM_FLAGS");
#if defined(MFBE_SHELL_DEVTOOLS)
    app_config.devtools_enabled = true;
#else
    app_config.devtools_enabled = options.remote_debugging_port != 0;
#endif
    if (options.no_sandbox) {
        LOG(WARNING) << "mfbe: running without the Chromium sandbox (--no-sandbox)";
    }

    CefRefPtr<MfbeApp> app(new MfbeApp(app_config, core_host.get(), dialogs));

    // Initialize the CEF browser process. May return false if initialization fails or if early
    // exit is desired (another instance is running: the process singleton forwarded argv and
    // the running instance opened the files / raised its window).
    int exit_code = 0;
    bool cef_initialized = false;
    if (!CefInitialize(main_args, settings, app.get(), sandbox_info)) {
        std::string message;
        exit_code = mapEarlyExitCode(CefGetExitCode(), &message);
        if (!message.empty()) {
            std::fprintf(stderr, "mfbe: %s\n", message.c_str());
            core_host->logWarning("shell.cefInitFailed", message);
        }
    } else {
        cef_initialized = true;
        if (hooks.after_cef_initialized != nullptr) {
            hooks.after_cef_initialized();
        }
#if defined(MFBE_SHELL_TEST_HOOKS)
        startSelfTest(envString("MFBE_SHELL_SELFTEST"), dialogs);
#endif
        // Run the CEF message loop. Blocks until CefQuitMessageLoop() is called (last window).
        CefRunMessageLoop();
    }

    // Stop the core first: its dialog provider holds CEF references that must be gone before
    // CefShutdown, and open RPC connections end with the UI anyway.
    g_core_host = nullptr;
    core_host->stop();
    core_host.reset();
    dialogs.reset();
    app = nullptr;

    if (cef_initialized) {
        CefShutdown();
    }
    if (hooks.after_shutdown != nullptr) {
        hooks.after_shutdown();
    }
    removeDirectory(temp_profile);
    return exit_code;
}

void forwardOpenPaths(const std::vector<std::string>& paths) {
    if (paths.empty()) {
        return;
    }
    if (g_core_host != nullptr) {
        g_core_host->notifyOpenPaths(paths);
    }
    if (MfbeClient* client = MfbeClient::GetInstance()) {
        client->ShowMainWindow();
    }
}

}  // namespace mfbe::shell
