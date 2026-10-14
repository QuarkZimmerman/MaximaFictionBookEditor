#include "single_instance.h"

#include "command_line.h"

#include <mfbe/utf8_paths.hpp>

#include <system_error>

#if defined(__linux__)
#include <climits>

#include <cerrno>
#include <cstdlib>
#include <signal.h>
#include <unistd.h>
#endif

namespace mfbe::shell {

namespace {

// CEF result codes (include/internal/cef_types.h, cef_resultcode_t); duplicated here so this
// translation unit stays CEF-free.
constexpr int kCefResultProfileInUse = 21;
constexpr int kCefResultNormalExitProcessNotified = 24;

}  // namespace

std::vector<std::string> relaunchFilePaths(const std::vector<std::string>& args,
                                           const std::filesystem::path& current_directory) {
    std::vector<std::string> paths;
    const ParseResult parsed = parseArguments(args);
    if (parsed.status != ParseStatus::kRun) {
        return paths;  // --help/--version or an invalid option: nothing to open
    }
    for (const auto& file : parsed.options.files) {
        std::filesystem::path path = mfbe::platform::path_from_utf8(file);
        if (path.is_relative() && !current_directory.empty()) {
            path = current_directory / path;
        }
        std::error_code ec;
        const std::filesystem::path absolute = std::filesystem::absolute(path, ec);
        paths.push_back(mfbe::platform::utf8_from_path(ec ? path : absolute.lexically_normal()));
    }
    return paths;
}

int mapEarlyExitCode(int cef_result_code, std::string* message) {
    if (cef_result_code == kCefResultNormalExitProcessNotified) {
        if (message != nullptr) {
            message->clear();
        }
        return 0;
    }
    if (message != nullptr) {
        if (cef_result_code == kCefResultProfileInUse) {
            *message =
                "the profile directory is locked by an instance running on another computer "
                "(shared home directory); close it or remove the SingletonLock file";
        } else {
            *message = "the browser engine could not be initialised (CEF result code " +
                       std::to_string(cef_result_code) + ")";
        }
    }
    return 1;
}

#if defined(__linux__)

bool removeStaleSingletonLock(const std::filesystem::path& profile_dir, std::string* note) {
    if (profile_dir.empty()) {
        return false;
    }
    const std::filesystem::path lock = profile_dir / "SingletonLock";
    std::error_code ec;
    if (!std::filesystem::is_symlink(lock, ec)) {
        return false;  // no lock: nothing to do
    }
    const std::filesystem::path target = std::filesystem::read_symlink(lock, ec);
    if (ec) {
        return false;
    }
    // Chromium writes "<hostname>-<pid>"; hostnames may contain '-', so split at the last one.
    const std::string value = mfbe::platform::utf8_from_path(target);
    const auto dash = value.rfind('-');
    if (dash == std::string::npos || dash + 1 >= value.size()) {
        return false;
    }
    const std::string host = value.substr(0, dash);
    char* end = nullptr;
    const long pid = std::strtol(value.c_str() + dash + 1, &end, 10);
    if (end == nullptr || *end != '\0' || pid <= 0) {
        return false;
    }
    char hostname[HOST_NAME_MAX + 1] = {};
    if (::gethostname(hostname, sizeof(hostname) - 1) != 0 || host != hostname) {
        return false;  // another host: leave it to Chromium (CEF_RESULT_CODE_PROFILE_IN_USE)
    }
    if (::kill(static_cast<pid_t>(pid), 0) == 0 || errno != ESRCH) {
        return false;  // alive (or not ours to inspect): the running instance will be notified
    }
    bool removed = false;
    for (const char* name : {"SingletonLock", "SingletonSocket", "SingletonCookie"}) {
        if (std::filesystem::remove(profile_dir / name, ec)) {
            removed = true;
        }
    }
    if (removed && note != nullptr) {
        *note = "removed stale single-instance lock " + value + " (process no longer exists)";
    }
    return removed;
}

#else  // !__linux__

bool removeStaleSingletonLock(const std::filesystem::path& /*profile_dir*/, std::string* /*note*/) {
    return false;  // Windows (message window) and macOS (Launch Services) leave no stale lock
}

#endif  // __linux__

}  // namespace mfbe::shell
