// Browser-process start-up shared by the platform entry points (main.cpp, main_mac.mm):
// command-line handling, directories, in-process core, CefInitialize / message loop /
// CefShutdown. Called after CefExecuteProcess has established that this is the browser
// process.
#pragma once

#include "include/cef_app.h"

#include <string>
#include <vector>

namespace mfbe::shell {

struct RunHooks {
    // Called on the main thread right after CefInitialize succeeded (macOS installs the
    // NSApplication delegate here).
    void (*after_cef_initialized)() = nullptr;
    // Called on the main thread after the message loop ended and CEF was shut down.
    void (*after_shutdown)() = nullptr;
};

// Returns the process exit code (0 normal, 1 fatal start-up error, 2 command-line error, or
// CefGetExitCode() when CefInitialize asked for an early exit).
int runBrowserProcess(const CefMainArgs& main_args, int argc, const char* const* argv,
                      void* sandbox_info, const RunHooks& hooks);

// Opens documents in the running instance (app.openPaths) and raises the main window. Used
// by the platform entry points for OS open-file events (macOS Finder/Dock) and by the
// drag-and-drop and relaunch paths. Safe to call from the main thread at any time while the
// message loop runs; a no-op before the core started or after it stopped.
void forwardOpenPaths(const std::vector<std::string>& paths);

}  // namespace mfbe::shell
