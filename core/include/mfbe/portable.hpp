// The portable folder of a copy of the editor (contracts/resource-formats.md §1a, §2): a `user`
// folder next to the program. A portable copy keeps all of its data there, so the copy moves
// with its folder; a portable folder the editor cannot write to only adds resources.
//
// Built into mfbe_paths: the core and the CEF shell, whose sources do not link the core, must
// decide alike. Plain C++ without exceptions (error_code overloads only).
#pragma once

#include <filesystem>
#include <optional>
#include <string>

namespace mfbe::platform {

// The portable folder for an executable in `exe_dir`: the first existing candidate of
//   - `appimage` set:  <appimage>.home/user, <appimage>.d/user, <appimage>.d
//   - otherwise:       <exe_dir>/user (and <bundle>.app/../user on macOS)
std::optional<std::filesystem::path> detect_portable_dir(
    const std::filesystem::path& exe_dir, const std::optional<std::string>& appimage);

// True when a file can be created in `dir`; the probe file is removed again.
bool directory_writable(const std::filesystem::path& dir);

// `portable` when the editor keeps all of its data in it: the folder exists and can be written
// to.
std::optional<std::filesystem::path> portable_data_dir(
    const std::optional<std::filesystem::path>& portable);

}  // namespace mfbe::platform
