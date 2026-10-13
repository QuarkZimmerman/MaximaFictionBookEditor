// Per-user and installation directories used by the shell (contracts/resource-formats.md §1).
//
// Plain C++ without exceptions: every std::filesystem call uses the error_code overloads.
// The core has its own implementation of the same rules (core/src/platform/dirs.cpp); the
// shell only needs the Chromium profile location, the CEF debug log location and where to
// find the bundled UI/resources, and must be able to compute them before the core starts.
#pragma once

#include <filesystem>
#include <string>

namespace mfbe::shell {

struct UserDirs {
    std::filesystem::path config;  // settings, hotkeys, recent, exclusions (core-owned)
    std::filesystem::path data;    // machine-local state used by the shell: CEF profile/cache,
                                   // first-start markers (Windows %LOCALAPPDATA%, XDG data dir)
    std::filesystem::path logs;    // errors-only log, CEF debug log
};

// Resolves the per-user locations for the current platform (environment variables
// XDG_*/APPDATA/LOCALAPPDATA/HOME). Nothing is created.
UserDirs userDirs();

// Directory containing the running executable (empty on failure).
std::filesystem::path executableDir();

// Bundled resources (schema, genres, icons ...): first existing of
//   <exe>/../../share/mfbe/resources (installed, Linux FHS: the shell lives in lib/mfbe/)
//   <exe>/../share/mfbe/resources    (installed, bin/: Windows layout)
//   <exe>/resources                  (portable / flat layout)
//   <bundle>/Contents/Resources/resources (macOS)
//   MFBE_RESOURCES_SOURCE_DIR        (build tree fallback)
// The result is passed to the core explicitly (CoreServerOptions.resources_dir), so the
// core's own lookup only matters for `mfbe-core`.
std::filesystem::path resourcesDir();

// Built UI bundle (index.html); same search order with "ui" instead of "resources" and
// MFBE_UI_SOURCE_DIR/dist as the build-tree fallback. Empty when nothing exists.
std::filesystem::path uiDistDir();

// Bundled scripts (share/mfbe/scripts, <exe>/scripts, <bundle>/Contents/Resources/scripts,
// MFBE_SCRIPTS_SOURCE_DIR). Empty when nothing exists (the core then has no bundled layer).
std::filesystem::path scriptsDir();

// Creates `dir` (and parents); returns false on failure.
bool ensureDirectory(const std::filesystem::path& dir);

// A fresh throw-away directory under the system temp dir (used for --url development runs
// so that they never touch the user's profile); empty on failure.
std::filesystem::path makeTempProfileDir();

// Best-effort recursive removal.
void removeDirectory(const std::filesystem::path& dir);

}  // namespace mfbe::shell
