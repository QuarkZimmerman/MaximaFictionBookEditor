#include "relaunch.h"

#include <mfbe/utf8_paths.hpp>

#include <cerrno>
#include <cstring>
#include <filesystem>
#include <system_error>
#include <thread>

#if defined(_WIN32)
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <signal.h>
#include <spawn.h>
#include <unistd.h>
#else
#include <signal.h>
#include <spawn.h>
#include <unistd.h>
#endif

#if !defined(_WIN32)
extern char** environ;
#endif

namespace mfbe::shell {

namespace {

// Options of the shell grammar (command_line.cpp) that take a value, so `--name value` in two
// words is dropped or kept as a pair.
bool takesValue(const std::string& name) {
    return name == "--lang" || name == "--remote-debugging-port" || name == "--ozone-platform" ||
           name == "--url" || name == "--wait-for-exit" || name == "--window-geometry";
}

// Options that do not survive a restart: the one-run language override, the request for a new
// document and the previous restart's own additions (replaced by this one's).
bool droppedOnRestart(const std::string& name) {
    return name == "--lang" || name == "--new" || name == "--wait-for-exit" ||
           name == "--window-geometry";
}

}  // namespace

std::vector<std::string> relaunchArguments(const std::vector<std::string>& own_args, long long pid,
                                           const std::string& window_geometry,
                                           const std::optional<std::string>& reopen) {
    std::vector<std::string> args;
    for (size_t i = 0; i < own_args.size(); ++i) {
        const std::string& arg = own_args[i];
        if (arg == "--") {
            break;  // only FILE arguments follow, and FILEs are not carried over
        }
        if (arg.empty() || arg[0] != '-' || arg == "-") {
            continue;  // a FILE argument
        }
        const auto eq = arg.find('=');
        const std::string name = eq == std::string::npos ? arg : arg.substr(0, eq);
        const bool separate_value = eq == std::string::npos && takesValue(name);
        if (droppedOnRestart(name)) {
            if (separate_value) {
                ++i;  // its value goes with it
            }
            continue;
        }
        args.push_back(arg);
        if (separate_value && i + 1 < own_args.size()) {
            args.push_back(own_args[++i]);
        }
    }
    args.push_back("--wait-for-exit");
    args.push_back(std::to_string(pid));
    if (!window_geometry.empty()) {
        args.push_back("--window-geometry");
        args.push_back(window_geometry);
    }
    if (reopen) {
        if (!reopen->empty() && (*reopen)[0] == '-') {
            args.push_back("--");
        }
        args.push_back(*reopen);
    }
    return args;
}

std::string relaunchProgram(const std::string& appimage, const std::string& executable) {
    return appimage.empty() ? executable : appimage;
}

std::string windowsCommandLine(const std::string& program, const std::vector<std::string>& args) {
    // The quoting rules of CommandLineToArgvW / the CRT: an argument with spaces, tabs or quotes
    // (or an empty one) goes in quotes; inside, a quote is escaped with a backslash and the
    // backslashes before it are doubled, as are the backslashes at the end of the argument.
    const auto quoted = [](const std::string& arg) {
        if (!arg.empty() && arg.find_first_of(" \t\"") == std::string::npos) {
            return arg;
        }
        std::string out = "\"";
        size_t backslashes = 0;
        for (const char c : arg) {
            if (c == '\\') {
                ++backslashes;
                continue;
            }
            if (c == '"') {
                out.append(backslashes * 2 + 1, '\\');
            } else {
                out.append(backslashes, '\\');
            }
            backslashes = 0;
            out.push_back(c);
        }
        out.append(backslashes * 2, '\\');
        out.push_back('"');
        return out;
    };
    std::string line = quoted(program);
    for (const std::string& arg : args) {
        line.push_back(' ');
        line += quoted(arg);
    }
    return line;
}

WaitClock systemWaitClock() {
    return WaitClock{
        [] { return std::chrono::steady_clock::now(); },
        [](std::chrono::milliseconds duration) { std::this_thread::sleep_for(duration); }};
}

bool waitForProcessExit(const std::function<bool()>& alive, std::chrono::milliseconds timeout,
                        std::chrono::milliseconds interval, const WaitClock& clock) {
    const auto deadline = clock.now() + timeout;
    while (alive()) {
        if (clock.now() >= deadline) {
            return false;
        }
        clock.sleep(interval);
    }
    return true;
}

#if defined(_WIN32)

namespace {

std::wstring wideFromUtf8(const std::string& text) {
    if (text.empty()) {
        return std::wstring();
    }
    const int length =
        ::MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring wide(length > 0 ? static_cast<size_t>(length) : 0, L'\0');
    if (length > 0) {
        ::MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), wide.data(),
                              length);
    }
    return wide;
}

std::string lastErrorText() {
    return mfbe::platform::utf8_error_message(
        std::error_code(static_cast<int>(::GetLastError()), std::system_category()));
}

}  // namespace

std::string currentExecutable() {
    std::wstring buffer(MAX_PATH, L'\0');
    while (true) {
        const DWORD length =
            ::GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (length == 0) {
            return std::string();
        }
        if (length < buffer.size()) {
            buffer.resize(length);
            break;
        }
        buffer.resize(buffer.size() * 2);  // truncated: a longer path
    }
    return mfbe::platform::utf8_from_path(std::filesystem::path(buffer));  // path-text: wide API
}

long long currentProcessId() {
    return static_cast<long long>(::GetCurrentProcessId());
}

bool processAlive(long long pid) {
    if (pid <= 0 || pid > 0xFFFFFFFFLL) {
        return false;
    }
    HANDLE process = ::OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                                   static_cast<DWORD>(pid));
    if (process == nullptr) {
        return ::GetLastError() == ERROR_ACCESS_DENIED;  // exists, but is not ours to open
    }
    const bool alive = ::WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
    ::CloseHandle(process);
    return alive;
}

bool spawnDetached(const std::string& program, const std::vector<std::string>& args,
                   std::string* reason) {
    const std::filesystem::path program_path = mfbe::platform::path_from_utf8(program);
    std::wstring command_line = wideFromUtf8(windowsCommandLine(program, args));
    STARTUPINFOW startup = {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process = {};
    // Its own process group: a console Ctrl+C aimed at this process never reaches it; it does
    // not inherit our handles.
    const BOOL created =
        ::CreateProcessW(program_path.c_str(), command_line.data(), nullptr, nullptr, FALSE,
                         CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr,
                         &startup, &process);
    if (!created) {
        if (reason != nullptr) {
            *reason = "CreateProcessW: " + lastErrorText();
        }
        return false;
    }
    ::CloseHandle(process.hThread);
    ::CloseHandle(process.hProcess);
    return true;
}

#else  // POSIX

std::string currentExecutable() {
#if defined(__APPLE__)
    uint32_t size = 0;
    _NSGetExecutablePath(nullptr, &size);  // asks for the size
    std::string buffer(size, '\0');
    if (size == 0 || _NSGetExecutablePath(buffer.data(), &size) != 0) {
        return std::string();
    }
    buffer.resize(std::strlen(buffer.c_str()));
    std::error_code ec;
    const std::filesystem::path resolved =
        std::filesystem::weakly_canonical(mfbe::platform::path_from_utf8(buffer), ec);
    return ec ? buffer : mfbe::platform::utf8_from_path(resolved);
#else
    std::error_code ec;
    const std::filesystem::path exe = std::filesystem::read_symlink("/proc/self/exe", ec);
    return ec ? std::string() : mfbe::platform::utf8_from_path(exe);
#endif
}

long long currentProcessId() {
    return static_cast<long long>(::getpid());
}

bool processAlive(long long pid) {
    if (pid <= 0 || pid > 0x7FFFFFFFLL) {
        return false;
    }
    if (::kill(static_cast<pid_t>(pid), 0) == 0) {
        return true;
    }
    return errno == EPERM;  // exists, but is not ours to signal
}

bool spawnDetached(const std::string& program, const std::vector<std::string>& args,
                   std::string* reason) {
    const std::filesystem::path program_path = mfbe::platform::path_from_utf8(program);
    std::vector<std::string> storage;  // argv[0] = the program, then the arguments
    storage.reserve(args.size() + 1);
    storage.push_back(program);
    storage.insert(storage.end(), args.begin(), args.end());
    std::vector<char*> argv;
    argv.reserve(storage.size() + 1);
    for (std::string& item : storage) {
        argv.push_back(item.data());
    }
    argv.push_back(nullptr);

    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
    short flags = POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF;
#if defined(POSIX_SPAWN_SETSID)
    flags |= POSIX_SPAWN_SETSID;  // a session of its own: it outlives our terminal and group
#endif
    // The new editor must not inherit our open files: not every socket Chromium opens is
    // close-on-exec, and an inherited listening socket (the DevTools port) would keep the new
    // instance from binding it. Everything but stdio is closed in the child.
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
#if defined(__APPLE__)
    flags |= POSIX_SPAWN_CLOEXEC_DEFAULT;
    for (int fd = 0; fd <= 2; ++fd) {
        posix_spawn_file_actions_addinherit_np(&actions, fd);
    }
#elif defined(__GLIBC__) && __GLIBC_PREREQ(2, 34)
    posix_spawn_file_actions_addclosefrom_np(&actions, 3);
#endif
    posix_spawnattr_setflags(&attributes, flags);
    sigset_t none;
    sigemptyset(&none);
    posix_spawnattr_setsigmask(&attributes, &none);
    sigset_t all;
    sigfillset(&all);
    posix_spawnattr_setsigdefault(&attributes, &all);
    pid_t child = 0;
    const int rc =
        ::posix_spawn(&child, program_path.c_str(), &actions, &attributes, argv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    if (rc != 0) {
        if (reason != nullptr) {
            *reason = "posix_spawn: " + mfbe::platform::utf8_error_message(
                                            std::error_code(rc, std::generic_category()));
        }
        return false;
    }
    return true;
}

#endif  // POSIX

}  // namespace mfbe::shell
