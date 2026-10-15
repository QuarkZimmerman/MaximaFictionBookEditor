// Command-line parsing for the `mfbe` desktop shell (contracts/cli.md §1).
//
// Plain C++ (no CEF, no exceptions) so it can be unit-tested and reused by the
// single-instance relaunch path (CefBrowserProcessHandler::OnAlreadyRunningAppRelaunch).
//
//   mfbe [options] [FILE...]
//     FILE                           .fb2 / .fbd / .xml to open
//     --lang <en|ru>                 override interface language for this run
//     --new                          start with a new document from the blank template (the
//                                    same as starting without FILE)
//     --remote-debugging-port <n>    enable Chromium DevTools/CDP on 127.0.0.1:<n> (dev/test)
//     --no-sandbox                   skip the Chromium sandbox (logged)
//     --ozone-platform <wayland|x11> Linux: force a display backend (default: auto)
//     --url <http url>               DEVELOPMENT ONLY: load this URL instead of starting the
//                                    in-process core (e.g. a Vite dev server or a smoke page)
//     --version | --help
//
// Options accept both `--name value` and `--name=value`. `--` ends option parsing. Unknown
// options produce "Invalid command line option: '<opt>'" and exit code 2.
#pragma once

#include <string>
#include <vector>

namespace mfbe::shell {

struct ShellOptions {
    std::vector<std::string> files;  // positional FILE arguments (as given, not resolved)
    std::string lang;                // "" (system), "en" or "ru"
    bool new_document = false;
    int remote_debugging_port = 0;  // 0 = disabled
    bool no_sandbox = false;
    std::string ozone_platform;  // "" (auto), "wayland" or "x11"
    std::string url_override;    // development only, see header comment
    bool show_version = false;
    bool show_help = false;
};

enum class ParseStatus {
    kRun,       // start the application with `options`
    kExitOk,    // --version / --help: `message` was prepared for stdout, exit code 0
    kExitError  // command-line error: `message` goes to stderr, exit code 2
};

struct ParseResult {
    ParseStatus status = ParseStatus::kRun;
    ShellOptions options;
    std::string message;
};

// Parses argv[1..argc-1] (argv[0] is the program name; may be nullptr-free UTF-8 strings).
ParseResult parseCommandLine(int argc, const char* const* argv);

// Same as above for an already split argument list without the program name.
ParseResult parseArguments(const std::vector<std::string>& args);

// `--help` text.
std::string usageText();

// CEF facts for `--version`, filled in by main (this file does not include CEF headers).
struct CefVersionInfo {
    std::string compiled_cef_version;  // CEF_VERSION from cef_version.h
    int api_version = 0;               // CEF_API_VERSION the shell was compiled with
    std::string runtime_cef_version;   // from cef_version_info() of the loaded libcef
    std::string runtime_chromium_version;
};

// `--version` text: product, version/build id, build date, CEF/Chromium versions compiled
// against and (when available) the versions of the libcef actually loaded.
std::string versionText(const CefVersionInfo& cef);

}  // namespace mfbe::shell
