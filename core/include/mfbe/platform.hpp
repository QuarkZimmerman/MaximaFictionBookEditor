// Per-user directories and process-level platform services (T013, T015).
//
// Locations follow contracts/resource-formats.md §1:
//   Windows: config %APPDATA%\Maxima Fiction Book Editor, data/log %LOCALAPPDATA%\...\logs
//   Linux:   $XDG_CONFIG_HOME/maxfbeditor, $XDG_DATA_HOME/maxfbeditor,
//   $XDG_STATE_HOME/maxfbeditor/logs macOS:   ~/Library/Application Support/Maxima Fiction Book
//   Editor, ~/Library/Logs/...
// A portable folder (`<dir of executable>/user`, `<AppImage>.home/user`, `<AppImage>.d`) is
// detected automatically and participates in the layered resource lookup.
#pragma once

#include <mfbe/utf8_paths.hpp>

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::platform {

// path_from_utf8, utf8_from_path, utf8_from_path_generic: see mfbe/utf8_paths.hpp (included
// below the namespace).

struct Dirs {
    std::filesystem::path config;  // settings.json, hotkeys.json, recent.json, exclusions.txt
    std::filesystem::path data;    // custom.dic, user layers (genres/scripts/dictionaries)
    std::filesystem::path state;   // machine-local state: caches, logs (XDG_STATE_HOME,
                                   // %LOCALAPPDATA%); equals data on macOS
    std::filesystem::path logs;    // errors-only log folder
    std::optional<std::filesystem::path> portable;  // portable user folder when detected
};

// Platform id as reported by app.info: "windows" | "linux" | "macos".
std::string platform_name();

// Two-letter language code of the user's OS interface ("en" when unknown): LANG/LC_* on
// POSIX, the user default UI language on Windows. Used to resolve uiLanguage "system".
std::string system_language();

// Resolves the per-user directories. When `override_root` is non-empty every directory lives
// below it (config = data = state = root, logs = root/logs) - used by tests and `--data-dir`.
// Directories are NOT created here; see ensure_dirs().
Dirs resolve_dirs(const std::string& override_root = "");

// Creates every directory of `dirs` (best effort; errors are logged, not thrown).
void ensure_dirs(const Dirs& dirs);

// Default platform locations without the application sub-folder (exposed for tests).
std::filesystem::path default_config_root();
std::filesystem::path default_data_root();
std::filesystem::path default_state_root();
std::filesystem::path default_log_root();

// Executable location.
std::filesystem::path executable_path();
std::filesystem::path executable_dir();

// Portable folder detection (pure function for tests): returns the first existing candidate
//   - `appimage` set:  <appimage>.home/user, <appimage>.d/user, <appimage>.d
//   - otherwise:       <exe_dir>/user (and <bundle>.app/../user on macOS)
std::optional<std::filesystem::path> detect_portable_dir(
    const std::filesystem::path& exe_dir, const std::optional<std::string>& appimage);
std::optional<std::filesystem::path> detect_portable_dir();

// Process id of the current process.
int current_pid();

// Resident set size of the current process in bytes (0 when unknown).
std::size_t resident_memory_bytes();

}  // namespace mfbe::platform

namespace mfbe::process {

// Opens a folder in the OS file manager / a URL in the default browser (xdg-open, explorer,
// open). Returns false when the path does not exist or the launcher could not be started.
// The process is detached; the call never blocks on the opened application.
bool open_folder(const std::filesystem::path& path);
bool open_url(const std::string& url);

// Test hook: replaces the actual launcher with `runner` (receives argv). nullptr restores it.
using CommandRunner = std::function<bool(const std::vector<std::string>& argv)>;
void set_command_runner_for_tests(CommandRunner runner);

}  // namespace mfbe::process

namespace mfbe::uuid {

// UUID v4 in canonical lower-case form, e.g. "3f0a4b7e-2d31-4b0b-9a1e-6b7f2c9d1e22".
std::string generate_v4();

// True for a canonical 8-4-4-4-12 hexadecimal UUID string (any version).
bool is_valid(std::string_view text);

}  // namespace mfbe::uuid

namespace mfbe::signals {

// Installs SIGINT/SIGTERM (POSIX) or console control (Windows) handling that invokes
// `on_terminate` once from a dedicated thread. Must be called before other threads start on
// POSIX so the signal mask is inherited. Idempotent.
void install_termination_handler(std::function<void()> on_terminate);

}  // namespace mfbe::signals
