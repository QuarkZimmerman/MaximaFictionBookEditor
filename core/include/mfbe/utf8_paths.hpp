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

// True when the two UTF-8 paths name the same file "as the platform compares file names"
// (feature 004 US8, the remembered positions record - contracts/resource-formats.md §13):
// Windows and macOS compare the lexically normalised paths ignoring letter case (Windows with
// the system's own case-insensitive ordinal comparison, macOS with a Unicode simple case fold
// of the Latin, Greek and Cyrillic letters), Linux compares the bytes exactly. No symbolic
// links are resolved and no Unicode normalisation is applied: two paths to one file are two
// names, as the original editor kept one position per file name.
bool same_file_path(std::string_view a, std::string_view b);

}  // namespace mfbe::platform
