// Start-up sequence of the browser process (see shell_runner.h):
//   1. Parse the shell command line (contracts/cli.md) - --version/--help exit 0, invalid
//      options exit 2. Started by the editor's own restart (--wait-for-exit <pid>, feature 003
//      US3): wait up to 30 s for that process to end, so its single-instance lock is free and
//      the settings it wrote at quit are read.
//   2. Resolve per-user directories (CEF profile under <data>/cef, CEF log under <logs>) or a
//      throw-away profile for --url developer runs; drop a stale single-instance lock.
//   3. Probe the Linux sandbox prerequisites (sandbox_check.h): without --no-sandbox the
//      sandbox stays on whenever user namespaces or the SUID helper work, and is switched off
//      with a logged warning only when neither does (AppImage on Ubuntu 24.04+, containers).
//   4. Start the in-process core (CoreHost) -> URL, or use the --url override; read the stored
//      window placement and interface language; wire app.restart to relaunch.h.
//   5. CefInitialize with the Chrome bootstrap + Views; CefRunMessageLoop; CefShutdown. The
//      window's last placement is written back to the settings before the core stops.
//      A second instance returns here with CefInitialize() == false after handing its command
//      line to the running one (exit code 0, see single_instance.h).

#include "shell_runner.h"

#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

#if defined(MFBE_SHELL_TEST_HOOKS)
#include "include/base/cef_callback.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"

#include <chrono>
#include <thread>
#include <vector>
#endif

#include "clipboard_bridge.h"
#include "command_line.h"
#include "copy_bridge.h"
#include "core_host.h"
#include "dialog_provider.h"
#include "file_dialog_platform.h"
#include "foreground.h"
#include "include/cef_version.h"
#include "include/cef_version_info.h"
#include "mfbe/copy_launch.hpp"
#include "mfbe_app.h"
#include "mfbe_client.h"
#include "native_actions.h"
#include "relaunch.h"
#include "window.h"
#include "window_placement.h"

#if defined(OS_WIN)
#include <windows.h>
#endif
#include "sandbox_check.h"
#include "single_instance.h"
#include "user_dirs.h"

#include <cctype>

namespace {

// Ends the process at once: no exit handlers, and on Windows no DLL detach notifications either,
// which a library stuck in its own shutdown could block.
[[noreturn]] void endProcessNow(int code) {
#if defined(OS_WIN)
    TerminateProcess(GetCurrentProcess(), static_cast<UINT>(code));
#endif
    std::_Exit(code);
}

// The editor ends once its windows have gone (requester: an exit is complete, nothing stays
// behind). Should the core's stop or CefShutdown not return within the limit, the process ends
// all the same, as Chrome's own shutdown watchdog does, with a warning in the errors log.
class ShutdownWatchdog {
public:
    ShutdownWatchdog(std::chrono::seconds limit, int exit_code)
        : thread_([this, limit, exit_code] {
              std::unique_lock lock(mutex_);
              if (stopped_.wait_for(lock, limit, [this] { return done_; }))
                  return;
              mfbe::log::warning("shell", "shell.shutdownTimeout",
                                 "the editor had not shut down " + std::to_string(limit.count()) +
                                     " s after its last window closed; the process ends now");
              mfbe::log::shutdown();
              endProcessNow(exit_code);
          }) {}
    ShutdownWatchdog(const ShutdownWatchdog&) = delete;
    ShutdownWatchdog& operator=(const ShutdownWatchdog&) = delete;
    ~ShutdownWatchdog() {
        {
            std::lock_guard lock(mutex_);
            done_ = true;
        }
        stopped_.notify_one();
        thread_.join();
    }

private:
    std::mutex mutex_;
    std::condition_variable stopped_;
    bool done_ = false;
    std::thread thread_;  // last: it starts once the members above exist
};

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

// A note made before CefInitialize, written to stderr: until then Chromium logs on Windows into
// a debug.log next to the program, outside the user's folders.
void earlyNote(const std::string& note) {
    std::fprintf(stderr, "mfbe: %s\n", note.c_str());
}

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
#if defined(OS_LINUX)
// UI thread: the types of the open GTK dialog, as GTK reports them.
void printOpenGtkFileDialog() {
    std::vector<std::string> types;
    std::string active;
    bool shown = false;
    if (describeOpenGtkFileDialog(&types, &active, &shown)) {
        std::string names;
        for (const auto& type : types) {
            names += (names.empty() ? "" : "|") + type;
        }
        std::printf("selftest: openfile types=%s active=%s shown=%s\n", names.c_str(),
                    active.c_str(), shown ? "yes" : "no");
    } else {
        std::printf("selftest: openfile no GTK dialog\n");
    }
    std::fflush(stdout);
}

void cancelGtkFileDialogForSelfTest() {
    cancelOpenGtkFileDialog();
}
#endif  // OS_LINUX

// MFBE_SHELL_SELFTEST=openfile: the Open dialog with the editor's Open types, "FictionBook files"
// selected. On Linux the GTK dialog's types and active type are printed after one second and the
// dialog is cancelled from code after two.
void runOpenFileSelfTest(const std::shared_ptr<NativeDialogs>& dialogs) {
    FileDialogRequest request;
    request.mode = FileDialogMode::kOpen;
    request.title = "mfbe self-test: open";
    request.filters = {{"FictionBook files (*.fb2)", {"fb2"}},
                       {"FictionBook descriptors (*.fbd)", {"fbd"}},
                       {"All files (*.*)", {"*"}}};
    request.document_dialog = true;
#if defined(OS_LINUX)
    std::thread([] {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        CefPostTask(TID_UI, base::BindOnce(&printOpenGtkFileDialog));
        std::this_thread::sleep_for(std::chrono::seconds(1));
        CefPostTask(TID_UI, base::BindOnce(&cancelGtkFileDialogForSelfTest));
    }).detach();
#endif
    const FileDialogResult result = dialogs->runFileDialogAndWait(request);
    std::string paths;
    for (const auto& path : result.paths) {
        paths += (paths.empty() ? "" : ";") + path;
    }
    std::printf("selftest: openfile %s\n", result.cancelled ? "cancelled" : paths.c_str());
}

// Test hook (dev/test builds only): MFBE_SHELL_SELFTEST=messagebox shows a native message box
// from a background thread two seconds after start-up, exactly as the core would, and prints
// `selftest: messagebox button=<id>` once it is answered. tools/shell-smoke.sh clicks the
// button through CDP. MFBE_SHELL_SELFTEST=openfile does the same with the Open dialog
// (runOpenFileSelfTest; prints the selected paths, cancel = "cancelled").
// MFBE_SHELL_SELFTEST=clipboard reads an image from the OS clipboard through the core's
// provider path and prints `selftest: clipboard <bytes> <content type>` or
// `selftest: clipboard none`.
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
            runOpenFileSelfTest(dialogs);
        }
        std::fflush(stdout);
    }).detach();
}
#endif  // MFBE_SHELL_TEST_HOOKS

// Feature 008 (contracts/cli.md §3): hands the books to the copy of `copy.slot` through the
// engine's relay - the engine started with that copy's profile finds it running and forwards
// this start's command line, with --mfbe-request appended by MfbeApp - and starts no core. If
// that copy ended between the choice and the relay, this process would own its profile: it then
// shuts the engine down again and starts a new copy with the books instead.
int relayToCopy(const CefMainArgs& main_args, void* sandbox_info, const CopyStart& copy,
                const ShellOptions& options, const std::vector<std::string>& books) {
    CefSettings settings;
    settings.no_sandbox = 1;  // a relaying start creates no renderer
    settings.command_line_args_disabled = 1;
    CefString(&settings.root_cache_path) = mfbe::platform::utf8_from_path(copy.profile_dir);
    CefString(&settings.cache_path) = mfbe::platform::utf8_from_path(copy.profile_dir);
    settings.log_severity = LOGSEVERITY_DISABLE;
    AppConfig app_config;
    app_config.no_sandbox = true;
    app_config.ozone_platform = options.ozone_platform;
    app_config.relay_payload = copy.payload;
    CefRefPtr<MfbeApp> app(new MfbeApp(app_config, nullptr, nullptr));
    // Windows: a start from the file manager may take the foreground, the receiving copy in the
    // background may not - hand the right on, and raise its window once the request is delivered
    // (the question then shows over it; feature 008, smoke test of 0.0.7-rc.1).
    allowForeground(copy.target_pid);
    if (!CefInitialize(main_args, settings, app.get(), sandbox_info)) {
        std::string message;
        const int code = mapEarlyExitCode(CefGetExitCode(), &message);
        if (code == 0) {
            bringProcessWindowToFront(copy.target_pid);
        }
        return code;
    }
    CefShutdown();
    std::vector<std::string> args = {"--mfbe-new-copy"};
    args.insert(args.end(), books.begin(), books.end());
    std::string reason;
    const std::string program = relaunchProgram(envString("APPIMAGE"), currentExecutable());
    if (!spawnDetached(program, args, &reason)) {
        std::fprintf(stderr, "mfbe: could not start a new copy: %s\n", reason.c_str());
        return 1;
    }
    return 0;
}

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
    std::vector<std::string> own_args;  // argv[1..]: what a restart builds on (relaunch.h)
    for (int i = 1; i < argc; ++i) {
        if (argv[i] != nullptr) {
            own_args.emplace_back(argv[i]);
        }
    }
#if defined(MFBE_SHELL_TEST_HOOKS)
    // tools/shell-smoke.sh reads the arguments the restarted editor was started with from the
    // log (Chromium rewrites /proc/<pid>/cmdline, so the process itself is the only source).
    std::string listed = "[";
    for (const std::string& arg : own_args) {
        listed += listed.size() > 1 ? ",\"" : "\"";
        for (const char c : arg) {
            if (c == '"' || c == '\\') {
                listed.push_back('\\');
            }
            listed.push_back(c);
        }
        listed.push_back('"');
    }
    std::printf("shelltest: argv %s]\n", listed.c_str());
    std::fflush(stdout);
#endif

    // Started by the editor's own restart: the instance that started us is quitting. Wait for
    // it to be gone before anything else - its single-instance lock must be free (a start handed
    // to a dying instance is exactly the failure, research R4) and the settings it writes at
    // quit (the window placement) must be on disk before our core reads them. A process that
    // does not end in 30 s is given up on; a stale lock is then the relay's business.
    if (options.wait_for_exit_pid > 0 && options.wait_for_exit_pid != currentProcessId()) {
        const long long pid = options.wait_for_exit_pid;
        if (!waitForProcessExit([pid] { return processAlive(pid); }, kWaitForExitTimeout,
                                kWaitForExitInterval, systemWaitClock())) {
            earlyNote("the previous editor (pid " + std::to_string(pid) +
                      ") did not end within 30 s; starting anyway");
        }
    }

    // Directories.
    const UserDirs dirs = userDirs();
    std::filesystem::path profile_dir;  // CEF root_cache_path
    std::filesystem::path log_dir;
    std::filesystem::path temp_profile;
    std::optional<CopyWindowRect> new_copy_placement;  // feature 008, research R6
    int own_slot = 0;  // this copy's slot (0 for a developer run); the restart keeps it
    if (dev_url_mode) {
        // Developer runs never touch the user's profile.
        temp_profile = makeTempProfileDir();
        profile_dir = temp_profile / "cef";
        log_dir = temp_profile / "logs";
    } else {
        // Feature 008 (contracts/shell.md §1): decide before any engine or core starts. A start
        // with books while a copy responds relays them and exits; otherwise this start is a new
        // copy in the lowest free slot, with that slot's engine profile.
        std::vector<std::string> books;
        for (const auto& file : options.files) {
            std::error_code ec;
            const std::filesystem::path absolute =
                std::filesystem::absolute(mfbe::platform::path_from_utf8(file), ec);
            books.push_back(ec ? file
                               : mfbe::platform::utf8_from_path(absolute.lexically_normal()));
        }
        const CopyStart copy =
            decideCopyStart(dirs.data, books, options.force_new_copy, options.forced_slot);
        if (!copy.ok) {
            std::fprintf(stderr, "mfbe: no free copy slot (too many copies run)\n");
            return 1;
        }
        if (copy.relay) {
            return relayToCopy(main_args, sandbox_info, copy, options, books);
        }
        profile_dir = copy.profile_dir;
        log_dir = dirs.logs;
        new_copy_placement = copy.placement;
        own_slot = copy.slot;
    }
    if (!ensureDirectory(profile_dir) || !ensureDirectory(log_dir)) {
        std::fprintf(stderr, "mfbe: cannot create the profile directory %s\n",
                     mfbe::platform::utf8_from_path(profile_dir).c_str());
        return 1;
    }
    std::string lock_note;
    if (removeStaleSingletonLock(profile_dir, &lock_note)) {
        earlyNote(lock_note);
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
            earlyNote("sandbox available (" + describeSandboxProbe(probe) + ")");
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
    // Start-up files: UTF-8 from the command line (main.cpp converts the wide Windows command
    // line), made absolute without the process code page.
    for (const auto& file : options.files) {
        std::error_code ec;
        const std::filesystem::path absolute =
            std::filesystem::absolute(mfbe::platform::path_from_utf8(file), ec);
        core_options.open_paths.push_back(
            ec ? file : mfbe::platform::utf8_from_path(absolute.lexically_normal()));
    }
    core_options.new_document = options.new_document;
    // Feature 008: New window, a busy copy and FR-017's activation start another process of
    // this program: a new copy, or a start with the book that reaches the copy holding it.
    core_options.open_in_new_copy = [](const std::vector<std::string>& paths, std::string* reason) {
        return spawnCopy(paths, reason);
    };
    core_options.activate_copy = [](int /*slot*/, const std::string& path) {
        const char* appimage = std::getenv("APPIMAGE");
        std::string reason;
        return spawnDetached(
            relaunchProgram(appimage != nullptr ? appimage : "", currentExecutable()), {path},
            &reason);
    };
#if defined(MFBE_SHELL_TEST_HOOKS)
    core_options.test_hooks = true;
#endif
    // app.restart (feature 003 US3, research R4): the same program again - $APPIMAGE when the
    // AppImage runtime set it, else this executable - with our own options except FILE, --new
    // and --lang, plus --wait-for-exit <our pid>, --window-geometry <the window's placement> and
    // the document to reopen; spawned detached. The core then performs the normal quit, during
    // which the placement is recorded (below). Runs on a core thread: the placement comes from
    // the window's own record (window.h), never from CEF objects.
    // Test-hook builds: MFBE_RELAUNCH_PROGRAM replaces the program (the smoke's failure path).
    std::string relaunch_override;
#if defined(MFBE_SHELL_TEST_HOOKS)
    relaunch_override = envString("MFBE_RELAUNCH_PROGRAM");
#endif
    std::atomic<CoreHost*> core_host_for_restart{nullptr};  // set once the core runs
    core_options.on_restart = [own_args, relaunch_override, own_slot,
                               &core_host_for_restart](const std::optional<std::string>& reopen) {
        RelaunchOutcome outcome;
        const std::optional<WindowPlacement> placement = mainWindowPlacement();
        if (CoreHost* host = core_host_for_restart.load(); placement && host != nullptr) {
            host->saveWindowPlacement(*placement);  // before the restart
        }
        outcome.argv = relaunchArguments(
            own_args, currentProcessId(),
            placement ? formatWindowGeometry(*placement) : std::string(), reopen, own_slot);
        const std::string program =
            relaunch_override.empty() ? relaunchProgram(envString("APPIMAGE"), currentExecutable())
                                      : relaunch_override;
        if (program.empty()) {
            outcome.reason = "the editor's own executable path is unknown";
            return outcome;
        }
        outcome.started = spawnDetached(program, outcome.argv, &outcome.reason);
        if (outcome.started) {
            earlyNote("restarting: " + program);
        } else {
            earlyNote("restart failed: " + outcome.reason);
        }
        return outcome;
    };
    std::string core_error;
    std::unique_ptr<CoreHost> core_host = CoreHost::start(core_options, &core_error);
    if (!core_host) {
        std::fprintf(stderr, "mfbe: %s\n", core_error.c_str());
        removeDirectory(temp_profile);
        return 1;
    }
    core_host_for_restart.store(core_host.get());
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
        earlyNote(sandbox_note);
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
    // CefString reads a std::string as UTF-8: the folders are converted without the process code
    // page, so a profile folder with non-English letters reaches CEF exactly.
    CefString(&settings.root_cache_path) = mfbe::platform::utf8_from_path(profile_dir);
    CefString(&settings.cache_path) = mfbe::platform::utf8_from_path(profile_dir);
    CefString(&settings.log_file) = mfbe::platform::utf8_from_path(log_dir / "cef-debug.log");
#if defined(NDEBUG)
    settings.log_severity = LOGSEVERITY_ERROR;
#else
    settings.log_severity = LOGSEVERITY_WARNING;
#endif
    // Interface language: --lang wins; otherwise the stored setting (view.uiLanguage, so the
    // shell's own texts and Chromium's locale match the interface after the language was
    // changed - a restart drops the --lang override on purpose, feature 003 US3); otherwise
    // the OS language so that the page's navigator.languages reflects the real system (CEF
    // defaults to en-US on Windows/macOS).
    std::string lang = options.lang;
    if (lang.empty()) {
        lang = core_host->uiLanguageSetting();
    }
    if (lang.empty()) {
        lang = systemLanguageCode();
    }
    dialogs->setLanguage(lang);
    if (lang == "ru") {
        CefString(&settings.locale) = "ru";  // ignored on Linux (env-based), used elsewhere
        CefString(&settings.accept_language_list) = "ru,en-US,en";
    } else if (lang == "uk") {
        CefString(&settings.locale) = "uk";
        CefString(&settings.accept_language_list) = "uk,en-US,en";
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
    app_config.lang = lang;
    app_config.extra_chromium_flags = envString("MFBE_CHROMIUM_FLAGS");
    // Window placement (feature 003 US3, data-model §4): --window-geometry (the restart passes
    // the old window's) wins, then the stored session.windowGeometry, else centred 1200x800;
    // window.cpp clamps it to the display's work area.
    app_config.window_placement =
        options.window_geometry ? options.window_geometry : core_host->windowPlacement();
    if (!options.window_geometry && new_copy_placement) {
        // Feature 008 (D7): beside the copy used last, or at its normal place when maximized.
        WindowPlacement beside;
        beside.x = new_copy_placement->x;
        beside.y = new_copy_placement->y;
        beside.width = new_copy_placement->w;
        beside.height = new_copy_placement->h;
        beside.maximized = false;
        app_config.window_placement = beside;
    }
#if defined(MFBE_SHELL_DEVTOOLS)
    app_config.devtools_enabled = true;
#else
    app_config.devtools_enabled = options.remote_debugging_port != 0;
#endif
    if (options.no_sandbox) {
        earlyNote("running without the Chromium sandbox (--no-sandbox)");
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
    std::optional<ShutdownWatchdog> watchdog;
    if (cef_initialized) {
        watchdog.emplace(std::chrono::seconds(15), exit_code);
    }

    // The window's last placement goes to settings.session.windowGeometry (feature 003 US3) -
    // the store outlives the core's own stop on app.quit, so this works in every quit path.
    if (const std::optional<WindowPlacement> placement = mainWindowPlacement()) {
        core_host->saveWindowPlacement(*placement);
    }

    // Stop the core first: its dialog provider holds CEF references that must be gone before
    // CefShutdown, and open RPC connections end with the UI anyway.
    g_core_host = nullptr;
    core_host_for_restart.store(nullptr);
    core_host->stop();
    core_host.reset();
    dialogs.reset();
    app = nullptr;

    if (cef_initialized) {
        CefShutdown();
    }
    watchdog.reset();
    if (hooks.after_shutdown != nullptr) {
        hooks.after_shutdown();
    }
    releaseCopy();  // feature 008: this copy's record goes; its slot lock goes with the process
    removeDirectory(temp_profile);
    return exit_code;
}

void forwardOpenPaths(const std::vector<std::string>& paths) {
    if (paths.empty()) {
        return;
    }
#if defined(__APPLE__)
    // Feature 008 (T029, FR-015): the Finder's open events while the editor runs take the path
    // of a relayed book - an untouched copy opens it, otherwise the question; an open book only
    // comes to the front.
    if (g_core_host != nullptr) {
        RelayedRequest request;
        request.kind = "open";
        request.request_id = mfbe::copies::new_request_id();
        request.paths = paths;
        request.origin = "outside";
        request.target = "ask";
        deliverOpenRequest(g_core_host, request);
        if (MfbeClient* client = MfbeClient::GetInstance()) {
            client->ShowMainWindow();
        }
        return;
    }
#endif
    if (g_core_host != nullptr) {
        g_core_host->notifyOpenPaths(paths);
    }
    if (MfbeClient* client = MfbeClient::GetInstance()) {
        client->ShowMainWindow();
    }
}

}  // namespace mfbe::shell
