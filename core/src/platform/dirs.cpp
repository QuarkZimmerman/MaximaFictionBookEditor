// Per-user directories and portable folder detection (T013).
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>

#include <sago/platform_folders.h>

#include <cctype>
#include <cstdlib>
#include <system_error>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <unistd.h>
#else
#include <unistd.h>
#endif

namespace mfbe::platform {
namespace {

#ifdef _WIN32
constexpr const char* kAppFolder = "Maxima Fiction Book Editor";
#elif defined(__APPLE__)
constexpr const char* kAppFolder = "Maxima Fiction Book Editor";
#else
constexpr const char* kAppFolder = "maxfbeditor";
#endif

// Environment value as UTF-8 (Windows reads the wide environment: the narrow one is converted
// through the legacy code page).
std::optional<std::string> env_value(const char* name) {
#ifdef _WIN32
    const std::wstring wide_name = path_from_utf8(name).wstring();
    const DWORD length = GetEnvironmentVariableW(wide_name.c_str(), nullptr, 0);
    if (length <= 1) {
        return std::nullopt;
    }
    std::wstring value(length, L'\0');
    const DWORD written = GetEnvironmentVariableW(wide_name.c_str(), value.data(), length);
    if (written == 0 || written >= length) {
        return std::nullopt;
    }
    value.resize(written);
    return utf8_from_path(std::filesystem::path(value));  // path-text: wide environment value
#else
    const char* value = std::getenv(name);
    if (value == nullptr || *value == '\0') {
        return std::nullopt;
    }
    return std::string(value);
#endif
}

bool is_dir(const std::filesystem::path& p) {
    std::error_code ec;
    return std::filesystem::is_directory(p, ec);
}

}  // namespace

std::string platform_name() {
#ifdef _WIN32
    return "windows";
#elif defined(__APPLE__)
    return "macos";
#else
    return "linux";
#endif
}

std::string system_language() {
#ifdef _WIN32
    wchar_t name[LOCALE_NAME_MAX_LENGTH] = {};
    if (GetUserDefaultLocaleName(name, LOCALE_NAME_MAX_LENGTH) > 0 && name[0] != L'\0') {
        std::string code;
        for (int i = 0; i < 2 && name[i] != L'\0' && name[i] != L'-'; ++i) {
            code.push_back(static_cast<char>(std::tolower(static_cast<int>(name[i]))));
        }
        if (code.size() == 2) {
            return code;
        }
    }
    return "en";
#else
    for (const char* var : {"LC_ALL", "LC_MESSAGES", "LANG"}) {
        const auto value = env_value(var);
        if (!value || *value == "C" || *value == "POSIX") {
            continue;
        }
        std::string code;
        for (char c : *value) {
            if (c == '_' || c == '.' || c == '@' || c == '-') {
                break;
            }
            code.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
        }
        if (code.size() == 2 || code.size() == 3) {
            return code;
        }
    }
    return "en";
#endif
}

// platform-folders returns UTF-8 on every platform (on Windows converted from the known folder's
// wide path).
std::filesystem::path default_config_root() {
    return path_from_utf8(sago::getConfigHome());
}

std::filesystem::path default_data_root() {
    return path_from_utf8(sago::getDataHome());
}

std::filesystem::path default_state_root() {
#ifdef __APPLE__
    return default_data_root();
#else
    return path_from_utf8(sago::getStateDir());
#endif
}

std::filesystem::path default_log_root() {
#ifdef __APPLE__
    // ~/Library/Logs; platform-folders has no public home accessor on macOS.
    if (const auto home = env_value("HOME"); home && !home->empty()) {
        return path_from_utf8(*home) / "Library" / "Logs";
    }
    return default_data_root();
#else
    return default_state_root();
#endif
}

Dirs resolve_dirs(const std::string& override_root) {
    Dirs dirs;
    if (!override_root.empty()) {
        const std::filesystem::path root = std::filesystem::absolute(path_from_utf8(override_root));
        dirs.config = root;
        dirs.data = root;
        dirs.state = root;
        dirs.logs = root / "logs";
    } else {
#ifdef _WIN32
        // Windows guidelines: user content that may roam with the profile (settings, custom
        // dictionary, genre lists, scripts, dictionaries) under %APPDATA%; machine-local state
        // (caches, logs) under %LOCALAPPDATA%; nothing is ever written below Program Files.
        dirs.config = default_config_root() / kAppFolder;
        dirs.data = default_data_root() / kAppFolder;
        dirs.state = default_state_root() / kAppFolder;
        dirs.logs = dirs.state / "logs";
#elif defined(__APPLE__)
        dirs.config = default_data_root() / kAppFolder;
        dirs.data = dirs.config;
        dirs.state = dirs.config;
        dirs.logs = default_log_root() / kAppFolder;
#else
        dirs.config = default_config_root() / kAppFolder;
        dirs.data = default_data_root() / kAppFolder;
        dirs.state = default_state_root() / kAppFolder;
        dirs.logs = dirs.state / "logs";
#endif
    }
    dirs.portable = detect_portable_dir();
    return dirs;
}

void ensure_dirs(const Dirs& dirs) {
    for (const auto* p : {&dirs.config, &dirs.data, &dirs.state, &dirs.logs}) {
        std::error_code ec;
        std::filesystem::create_directories(*p, ec);
        if (ec) {
            log::warning(
                "core", "io.createDirFailed", "cannot create directory",
                log::extras({{"path", utf8_from_path(*p)}, {"reason", utf8_error_message(ec)}}));
        }
    }
}

std::filesystem::path executable_path() {
#ifdef _WIN32
    wchar_t buffer[MAX_PATH * 4];
    const DWORD n = GetModuleFileNameW(nullptr, buffer, static_cast<DWORD>(std::size(buffer)));
    if (n == 0) {
        return {};
    }
    return std::filesystem::path(std::wstring(buffer, n));  // path-text: wide Windows API path
#elif defined(__APPLE__)
    char small[1024];
    uint32_t size = sizeof(small);
    if (_NSGetExecutablePath(small, &size) == 0) {
        std::error_code ec;
        auto canonical = std::filesystem::weakly_canonical(path_from_utf8(small), ec);
        return ec ? path_from_utf8(small) : canonical;
    }
    std::string big(size, '\0');
    if (_NSGetExecutablePath(big.data(), &size) == 0) {
        return path_from_utf8(big.c_str());
    }
    return {};
#else
    std::error_code ec;
    auto p = std::filesystem::read_symlink("/proc/self/exe", ec);
    if (ec) {
        return {};
    }
    return p;
#endif
}

std::filesystem::path executable_dir() {
    const auto exe = executable_path();
    return exe.empty() ? std::filesystem::current_path() : exe.parent_path();
}

std::optional<std::filesystem::path> detect_portable_dir(
    const std::filesystem::path& exe_dir, const std::optional<std::string>& appimage) {
    std::vector<std::filesystem::path> candidates;
    if (appimage && !appimage->empty()) {
        const std::filesystem::path image = path_from_utf8(*appimage);
        std::filesystem::path home = image;
        home += ".home";
        std::filesystem::path dot_d = image;
        dot_d += ".d";
        candidates.push_back(home / "user");
        candidates.push_back(dot_d / "user");
        candidates.push_back(dot_d);
    } else if (!exe_dir.empty()) {
        candidates.push_back(exe_dir / "user");
#ifdef __APPLE__
        // <App>.app/Contents/MacOS/<exe> -> <App>.app/../user
        candidates.push_back(exe_dir / ".." / ".." / ".." / "user");
#endif
    }
    for (const auto& c : candidates) {
        if (is_dir(c)) {
            std::error_code ec;
            auto canonical = std::filesystem::weakly_canonical(c, ec);
            return ec ? c : canonical;
        }
    }
    return std::nullopt;
}

std::optional<std::filesystem::path> detect_portable_dir() {
    return detect_portable_dir(executable_dir(), env_value("APPIMAGE"));
}

int current_pid() {
#ifdef _WIN32
    return static_cast<int>(GetCurrentProcessId());
#else
    return static_cast<int>(getpid());
#endif
}

}  // namespace mfbe::platform
