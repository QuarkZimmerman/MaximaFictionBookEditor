// The editor's restart of itself (feature 003 US3, research R4; contracts/cli.md §1): the shell
// answers `app.restart({reopen?})` by starting the same program again with its own start-up
// options, then performs the normal quit. The new instance waits for the old one
// (`--wait-for-exit <pid>`) before it initialises CEF, so the single-instance lock is free and
// nothing is handed to the dying instance.
//
// The argument rebuild, the choice of program, the wait loop and the Windows command line are
// plain C++ tested by tests/shell/test_relaunch.cpp; spawnDetached(), processAlive(),
// currentExecutable() and currentProcessId() are the platform pieces (POSIX: posix_spawn in a
// session of its own, kill(pid, 0), /proc/self/exe or _NSGetExecutablePath; Windows:
// CreateProcessW, OpenProcess, GetModuleFileNameW). No CEF types, no exceptions.
#pragma once

#include <chrono>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::shell {

// How long the new instance waits for the old one, and how often it looks (contracts/cli.md §1).
inline constexpr std::chrono::milliseconds kWaitForExitTimeout{30000};
inline constexpr std::chrono::milliseconds kWaitForExitInterval{100};

// The arguments (without the program) of the restarted editor, from the running shell's own
// arguments (argv[1..]): FILE arguments, `--new` and `--lang` go - the language override was for
// one run and the new language setting is the reason for the restart - as do a previous
// `--wait-for-exit` and `--window-geometry`; every other option stays as given, in either
// spelling (`--no-sandbox`, `--ozone-platform`, `--remote-debugging-port`, `--url`). Then
// `--wait-for-exit <pid>`, `--window-geometry <window_geometry>` (when not empty) and `reopen`
// as FILE (after `--` when it starts with '-'). A never-saved document has no `reopen`.
std::vector<std::string> relaunchArguments(const std::vector<std::string>& own_args, long long pid,
                                           const std::string& window_geometry,
                                           const std::optional<std::string>& reopen);

// The program to start again: `appimage` ($APPIMAGE, which the AppImage runtime sets for the
// editor it runs) when not empty, else `executable` (the running executable's path).
std::string relaunchProgram(const std::string& appimage, const std::string& executable);

// The running executable's path as UTF-8 (empty when unknown).
std::string currentExecutable();

// This process's id.
long long currentProcessId();

// True while `pid` names a running process (on POSIX also one we may not signal).
bool processAlive(long long pid);

// Starts `program` with `args` as a process independent of this one (a session of its own on
// POSIX, its own process group on Windows); false with `reason` when it could not be started.
bool spawnDetached(const std::string& program, const std::vector<std::string>& args,
                   std::string* reason);

// The command line CreateProcessW gets on Windows: program and arguments quoted the way
// CommandLineToArgvW reads them back (arguments with spaces, tabs or quotes in quotes, quotes
// escaped, backslashes doubled where they precede a quote).
std::string windowsCommandLine(const std::string& program, const std::vector<std::string>& args);

// The clock of waitForProcessExit(): injected so the wait is testable without real time.
struct WaitClock {
    std::function<std::chrono::steady_clock::time_point()> now;
    std::function<void(std::chrono::milliseconds)> sleep;
};

// The real clock (steady_clock and this_thread::sleep_for).
WaitClock systemWaitClock();

// `--wait-for-exit`: polls `alive()` every `interval` until it reports the process gone or
// `timeout` has passed since the first poll. True when the process ended in time; false when
// the editor starts anyway (a stale lock is then the single-instance relay's business).
bool waitForProcessExit(const std::function<bool()>& alive, std::chrono::milliseconds timeout,
                        std::chrono::milliseconds interval, const WaitClock& clock);

}  // namespace mfbe::shell
