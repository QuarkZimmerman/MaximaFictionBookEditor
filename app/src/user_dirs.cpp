#include "user_dirs.h"

#include <mfbe/utf8_paths.hpp>

#include <cstdlib>
#include <system_error>

#if defined(_WIN32)
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <unistd.h>
#else
#include <unistd.h>
#endif

namespace mfbe::shell {

namespace fs = std::filesystem;

namespace {

[[maybe_unused]] constexpr const char* kFolderName = "maxfbeditor";       // Linux (XDG)
constexpr const char* kDisplayFolderName = "Maxima Fiction Book Editor";  // Windows / macOS

fs::path envPath(const char* name) {
#if defined(_WIN32)
    wchar_t buffer[MAX_PATH * 4];
    wchar_t wide_name[128];
    size_t converted = 0;
    mbstowcs_s(&converted, wide_name, name, _TRUNCATE);
    const DWORD length = ::GetEnvironmentVariableW(
        wide_name, buffer, static_cast<DWORD>(sizeof(buffer) / sizeof(buffer[0])));
    if (length == 0 || length >= sizeof(buffer) / sizeof(buffer[0])) {
        return {};
    }
    return fs::path(buffer);  // path-text: wide environment value
#else
    const char* value = std::getenv(name);
    if (value == nullptr || value[0] == '\0') {
        return {};
    }
    return mfbe::platform::path_from_utf8(value);
#endif
}

fs::path homeDir() {
#if defined(_WIN32)
    return envPath("USERPROFILE");
#else
    return envPath("HOME");
#endif
}

bool isDir(const fs::path& path) {
    std::error_code ec;
    return !path.empty() && fs::is_directory(path, ec);
}

bool isFile(const fs::path& path) {
    std::error_code ec;
    return !path.empty() && fs::is_regular_file(path, ec);
}

fs::path normalized(const fs::path& path) {
    std::error_code ec;
    fs::path result = fs::weakly_canonical(path, ec);
    return ec ? path.lexically_normal() : result;
}

// Finds a bundled data directory `name` for the installed layouts of cmake/InstallLayout.cmake
// (and the portable/flat one), falling back to the build tree for developer runs.
fs::path findBundledDir(const char* name, const fs::path& build_tree_fallback, const char* probe) {
    const fs::path exe_dir = executableDir();
    if (!exe_dir.empty()) {
        const fs::path candidates[] = {
            exe_dir / ".." / ".." / "share" / "mfbe" / name,  // Linux FHS: lib/mfbe/mfbe
            exe_dir / ".." / "share" / "mfbe" / name,         // bin/: Windows, mfbe-core
            exe_dir / name,                                   // portable / flat layout
            exe_dir / ".." / "Resources" / name,              // macOS bundle
        };
        for (const auto& candidate : candidates) {
            if (isDir(candidate) && (probe == nullptr || isFile(candidate / probe))) {
                return normalized(candidate);
            }
        }
    }
    if (isDir(build_tree_fallback) && (probe == nullptr || isFile(build_tree_fallback / probe))) {
        return normalized(build_tree_fallback);
    }
    return {};
}

}  // namespace

UserDirs userDirs() {
    UserDirs dirs;
#if defined(_WIN32)
    fs::path roaming = envPath("APPDATA");
    fs::path local = envPath("LOCALAPPDATA");
    if (roaming.empty()) {
        roaming = homeDir() / "AppData" / "Roaming";
    }
    if (local.empty()) {
        local = homeDir() / "AppData" / "Local";
    }
    dirs.config = roaming / kDisplayFolderName;
    dirs.data = local / kDisplayFolderName;
    dirs.logs = dirs.data / "logs";
#elif defined(__APPLE__)
    const fs::path home = homeDir();
    dirs.config = home / "Library" / "Application Support" / kDisplayFolderName;
    dirs.data = dirs.config;
    dirs.logs = home / "Library" / "Logs" / kDisplayFolderName;
#else
    const fs::path home = homeDir();
    fs::path config_home = envPath("XDG_CONFIG_HOME");
    fs::path data_home = envPath("XDG_DATA_HOME");
    fs::path state_home = envPath("XDG_STATE_HOME");
    if (config_home.empty()) {
        config_home = home / ".config";
    }
    if (data_home.empty()) {
        data_home = home / ".local" / "share";
    }
    if (state_home.empty()) {
        state_home = home / ".local" / "state";
    }
    dirs.config = config_home / kFolderName;
    dirs.data = data_home / kFolderName;
    dirs.logs = state_home / kFolderName / "logs";
#endif
    return dirs;
}

fs::path executableDir() {
#if defined(_WIN32)
    wchar_t buffer[MAX_PATH * 4];
    const DWORD length = ::GetModuleFileNameW(
        nullptr, buffer, static_cast<DWORD>(sizeof(buffer) / sizeof(buffer[0])));
    if (length == 0) {
        return {};
    }
    return fs::path(buffer).parent_path();  // path-text: wide Windows API path
#elif defined(__APPLE__)
    char buffer[4096];
    uint32_t size = sizeof(buffer);
    if (_NSGetExecutablePath(buffer, &size) != 0) {
        return {};
    }
    return normalized(mfbe::platform::path_from_utf8(buffer)).parent_path();
#else
    std::error_code ec;
    const fs::path exe = fs::read_symlink("/proc/self/exe", ec);
    if (ec) {
        return {};
    }
    return exe.parent_path();
#endif
}

fs::path resourcesDir() {
    return findBundledDir("resources", mfbe::platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR),
                          "blank.fb2");
}

fs::path uiDistDir() {
    return findBundledDir("ui", mfbe::platform::path_from_utf8(MFBE_UI_SOURCE_DIR) / "dist",
                          "index.html");
}

fs::path scriptsDir() {
    return findBundledDir("scripts", mfbe::platform::path_from_utf8(MFBE_SCRIPTS_SOURCE_DIR),
                          nullptr);
}

bool ensureDirectory(const fs::path& dir) {
    if (dir.empty()) {
        return false;
    }
    std::error_code ec;
    fs::create_directories(dir, ec);
    return !ec && fs::is_directory(dir, ec);
}

fs::path makeTempProfileDir() {
    std::error_code ec;
    fs::path base = fs::temp_directory_path(ec);
    if (ec) {
        return {};
    }
#if defined(_WIN32)
    const auto pid = static_cast<unsigned long>(::GetCurrentProcessId());
#else
    const auto pid = static_cast<unsigned long>(::getpid());
#endif
    const fs::path dir = base / mfbe::platform::path_from_utf8("mfbe-shell-" + std::to_string(pid));
    removeDirectory(dir);
    return ensureDirectory(dir) ? dir : fs::path();
}

void removeDirectory(const fs::path& dir) {
    if (dir.empty()) {
        return;
    }
    std::error_code ec;
    fs::remove_all(dir, ec);
}

}  // namespace mfbe::shell
