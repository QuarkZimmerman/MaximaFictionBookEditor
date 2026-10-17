// Internal: the platform part of platform::format_long_date (feature 003 US6, data-model §6).
// date_format.cpp owns the public function, the interface-language fallback and the test hook;
// one of date_format_posix.cpp, date_format_win.cpp and date_format_mac.cpp (chosen in
// core/CMakeLists.txt) implements the two functions below.
#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace mfbe::platform::date_format {

// True for the names that mean "no regional settings": `C`, `POSIX` and their codeset variants
// (`C.UTF-8`), and an empty name.
bool is_plain_locale(std::string_view locale_name);

// The regional long date without the day of the week for the locale `locale_name` - nullptr:
// the user's regional settings (POSIX: the LC_TIME locale of the environment; Windows: the
// user default locale; macOS: the current CFLocale). `month` is 1-12 and `day` a day of that
// month. nullopt when the system cannot say: no regional settings (a plain locale), a locale
// the machine does not have, an API failure.
std::optional<std::string> regional_long_date(int year, int month, int day,
                                              const char* locale_name);

// True when the machine has the named locale (the test hook's check; plain names are checked
// by the caller).
bool locale_available(const char* locale_name);

}  // namespace mfbe::platform::date_format
