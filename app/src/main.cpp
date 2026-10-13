// Entry point of the `mfbe` desktop shell on Linux and Windows (macOS: main_mac.mm).
//
// CefExecuteProcess runs first: Chromium sub-processes (renderer, GPU, utility ...) share this
// executable and return from it immediately; the browser process continues in
// shell_runner.cpp (command line, directories, in-process core, CefInitialize, message loop).

#include "include/base/cef_logging.h"
#include "include/cef_app.h"
#include "shell_runner.h"

#include <string>
#include <vector>

#if defined(OS_WIN)
#include "include/cef_sandbox_win.h"
#include "include/cef_version_info.h"

#include <cstdio>
// clang-format off: windows.h first, shellapi.h depends on it
#include <windows.h>

#include <shellapi.h>
// clang-format on
#endif

#if defined(OS_LINUX) && defined(CEF_X11)
#include <X11/Xlib.h>
#endif

#if defined(OS_LINUX)

#if defined(CEF_X11)
namespace {

int XErrorHandlerImpl(Display* display, XErrorEvent* event) {
    LOG(WARNING) << "X error received: type " << event->type << ", serial " << event->serial
                 << ", error_code " << static_cast<int>(event->error_code) << ", request_code "
                 << static_cast<int>(event->request_code) << ", minor_code "
                 << static_cast<int>(event->minor_code);
    return 0;
}

int XIOErrorHandlerImpl(Display* display) {
    return 0;
}

}  // namespace
#endif  // defined(CEF_X11)

// Entry point function for all processes.
NO_STACK_PROTECTOR
int main(int argc, char* argv[]) {
    // Provide CEF with command-line arguments.
    CefMainArgs main_args(argc, argv);

    // CEF applications have multiple sub-processes (render, GPU, etc) that share the same
    // executable. This function checks the command-line and, if this is a sub-process,
    // executes the appropriate logic.
    const int exit_code = CefExecuteProcess(main_args, nullptr, nullptr);
    if (exit_code >= 0) {
        // The sub-process has completed so return here.
        return exit_code;
    }

#if defined(CEF_X11)
    // Install xlib error handlers so that the application won't be terminated on non-fatal
    // errors.
    XSetErrorHandler(XErrorHandlerImpl);
    XSetIOErrorHandler(XIOErrorHandlerImpl);
#endif

    return mfbe::shell::runBrowserProcess(main_args, argc, argv, nullptr, mfbe::shell::RunHooks());
}

#elif defined(OS_WIN)

namespace {

// UTF-16 argv -> UTF-8 strings for the shell parser.
std::vector<std::string> utf8Arguments() {
    std::vector<std::string> args;
    int argc = 0;
    LPWSTR* argv = ::CommandLineToArgvW(::GetCommandLineW(), &argc);
    if (argv == nullptr) {
        return args;
    }
    for (int i = 0; i < argc; ++i) {
        const int length =
            ::WideCharToMultiByte(CP_UTF8, 0, argv[i], -1, nullptr, 0, nullptr, nullptr);
        std::string utf8(length > 0 ? static_cast<size_t>(length - 1) : 0, '\0');
        if (length > 1) {
            ::WideCharToMultiByte(CP_UTF8, 0, argv[i], -1, utf8.data(), length, nullptr, nullptr);
        }
        args.push_back(std::move(utf8));
    }
    ::LocalFree(argv);
    return args;
}

// mfbe.exe is a windowed program (no console of its own). When it is started from a
// terminal, attach to that console so --version, --help and command-line errors are visible
// there (contracts/cli.md); started from Explorer there is no parent console and nothing
// changes.
void attachParentConsole() {
    if (!::AttachConsole(ATTACH_PARENT_PROCESS)) {
        return;
    }
    FILE* stream = nullptr;
    freopen_s(&stream, "CONOUT$", "w", stdout);
    freopen_s(&stream, "CONOUT$", "w", stderr);
}

int RunMain(HINSTANCE hInstance, void* sandbox_info) {
    // Provide CEF with command-line arguments.
    CefMainArgs main_args(hInstance);

    // Sub-processes (render, GPU, etc) share this module and return here.
    const int exit_code = CefExecuteProcess(main_args, nullptr, sandbox_info);
    if (exit_code >= 0) {
        return exit_code;
    }

    attachParentConsole();
    const std::vector<std::string> args = utf8Arguments();
    std::vector<const char*> argv;
    for (const auto& arg : args) {
        argv.push_back(arg.c_str());
    }
    return mfbe::shell::runBrowserProcess(main_args, static_cast<int>(argv.size()), argv.data(),
                                          sandbox_info, mfbe::shell::RunHooks());
}

}  // namespace

#if defined(CEF_USE_BOOTSTRAP)

// Entry point called by CEF's bootstrap.exe when the shell is built as a DLL (sandbox on).
CEF_BOOTSTRAP_EXPORT int RunWinMain(HINSTANCE hInstance, LPTSTR lpCmdLine, int nCmdShow,
                                    void* sandbox_info, cef_version_info_t* /*version_info*/) {
    return RunMain(hInstance, sandbox_info);
}

#else  // !defined(CEF_USE_BOOTSTRAP)

// Entry point function for all processes.
int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPTSTR lpCmdLine,
                      int nCmdShow) {
    UNREFERENCED_PARAMETER(hPrevInstance);
    UNREFERENCED_PARAMETER(lpCmdLine);
    UNREFERENCED_PARAMETER(nCmdShow);

    void* sandbox_info = nullptr;
#if defined(CEF_USE_SANDBOX)
    // Manage the life span of the sandbox information object. This is necessary for sandbox
    // support on Windows. See cef_sandbox_win.h for complete details.
    CefScopedSandboxInfo scoped_sandbox;
    sandbox_info = scoped_sandbox.sandbox_info();
#endif
    return RunMain(hInstance, sandbox_info);
}

#endif  // !defined(CEF_USE_BOOTSTRAP)

#endif  // OS_WIN
