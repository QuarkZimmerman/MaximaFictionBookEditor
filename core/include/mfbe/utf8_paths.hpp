// UTF-8 text <-> filesystem path, independent of the process code page (feature 002, research
// R1). On Windows std::filesystem::path(std::string) and path::string() convert through the
// process code page, which is the legacy ANSI code page unless the executable's manifest selects
// UTF-8; every conversion between paths and text (JSON, logs, CEF strings, command lines) goes
// through these helpers instead. Invalid UTF-8 input or an unpaired UTF-16 surrogate never
// throws: the offending character becomes U+FFFD. On POSIX the bytes pass through unchanged.
//
// Built as the small library mfbe_paths (no other dependency), linked by the core and by the
// CEF shell, whose sources are compiled without exceptions.
#pragma once

#include <filesystem>
#include <string>
#include <string_view>
#include <system_error>

namespace mfbe::platform {

std::filesystem::path path_from_utf8(std::string_view utf8);
std::string utf8_from_path(const std::filesystem::path& path);
// As utf8_from_path, with '/' as the separator on every platform.
std::string utf8_from_path_generic(const std::filesystem::path& path);

// The message of `ec` as UTF-8 (for logs and error answers). On Windows std::error_code::message()
// of a system error is in the legacy code page; it is formatted with FormatMessageW instead.
std::string utf8_error_message(const std::error_code& ec);

}  // namespace mfbe::platform
