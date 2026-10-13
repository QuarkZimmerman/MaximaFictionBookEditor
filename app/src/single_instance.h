// Single-instance behaviour of the shell (T138; contracts/cli.md §1).
//
// The Chrome bootstrap of CEF already provides a process singleton per profile directory
// (CefSettings.root_cache_path): a second `mfbe` started while an instance owns that profile
// hands its command line to the running process - which receives it in
// CefBrowserProcessHandler::OnAlreadyRunningAppRelaunch (see MfbeApp) - and CefInitialize()
// returns false with CefGetExitCode() == CEF_RESULT_CODE_NORMAL_EXIT_PROCESS_NOTIFIED.
// Transport: a Unix socket + lock symlink in the profile (Linux), a hidden message window
// (Windows), Launch Services / open-file events (macOS, see main_mac.mm).
//
// This file adds the pieces around that mechanism:
//   * resolution of the FILE arguments of the relaunch command line against the second
//     instance's working directory (plain C++, testable),
//   * the mapping of CEF's early-exit result codes to the contract's exit codes
//     (0 normal - the running instance was notified -, 1 fatal with a message),
//   * stale lock recovery on Linux: when the profile's SingletonLock points at a process on
//     this host that no longer exists (crash, power loss) the lock files are removed before
//     CefInitialize so a fresh instance starts instead of waiting for a dead one. Chromium
//     performs the same check itself; doing it up front keeps the start-up path short and
//     makes the behaviour explicit and logged.
//
// No CEF headers: usable from code compiled with and without CEF.
#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace mfbe::shell {

// Resolves the positional FILE arguments of an argv (without argv[0]) parsed with the shell
// grammar; relative paths are resolved against `current_directory`. Options other than FILEs
// are ignored (the running instance keeps its own --lang/--no-sandbox ...). An invalid
// command line yields an empty list.
std::vector<std::string> relaunchFilePaths(const std::vector<std::string>& args,
                                           const std::filesystem::path& current_directory);

// Maps CefGetExitCode() after a failed CefInitialize() to a process exit code and message:
//   CEF_RESULT_CODE_NORMAL_EXIT_PROCESS_NOTIFIED (24) -> 0 ("" message)
//   CEF_RESULT_CODE_PROFILE_IN_USE (21)               -> 1 (profile locked by another host)
//   anything else                                     -> 1 (generic message with the code)
int mapEarlyExitCode(int cef_result_code, std::string* message);

// Linux: removes `SingletonLock` / `SingletonSocket` / `SingletonCookie` from `profile_dir`
// when the lock names a dead process of this host. Returns true when a stale lock was
// removed; `note` receives a short description for the log. No-op elsewhere.
bool removeStaleSingletonLock(const std::filesystem::path& profile_dir, std::string* note);

}  // namespace mfbe::shell
