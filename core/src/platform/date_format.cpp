// The long date of the system's regional settings (feature 003 US6, FR-050 to FR-052,
// data-model §6): the platform part lives in date_format_{posix,win,mac}.cpp; this file holds
// the public function, the interface-language fallback the spec requires when the regional
// settings cannot be determined, and the test hook that pins the regional settings.
#include "platform/date_format.hpp"

#include <mfbe/platform.hpp>

#include <algorithm>
#include <array>
#include <mutex>
#include <optional>
#include <string>

namespace mfbe::platform {
namespace {

std::mutex g_test_locale_mutex;
std::optional<std::string> g_test_locale;  // the hook's locale name; nullopt = the user's

// The core's own month tables - the only ones that are not the system's, used solely for the
// fallback (research R7): English, and the genitive forms Russian and Ukrainian put after a day.
constexpr std::array<const char*, 12> kEnglishMonths = {
    "January", "February", "March",     "April",   "May",      "June",
    "July",    "August",   "September", "October", "November", "December"};
constexpr std::array<const char*, 12> kRussianMonthsGenitive = {
    "января", "февраля", "марта",    "апреля",  "мая",    "июня",
    "июля",   "августа", "сентября", "октября", "ноября", "декабря"};
constexpr std::array<const char*, 12> kUkrainianMonthsGenitive = {
    "січня", "лютого", "березня", "квітня", "травня",    "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"};

int days_in_month(int year, int month) {
    constexpr std::array<int, 12> kDays = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    const bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    return month == 2 && leap ? 29 : kDays[static_cast<std::size_t>(month - 1)];
}

// The interface language's long form: "October 17, 2026", "17 октября 2026", "17 жовтня 2026".
std::string fallback_long_date(int year, int month, int day, std::string_view ui_language) {
    const auto index = static_cast<std::size_t>(month - 1);
    const std::string d = std::to_string(day);
    const std::string y = std::to_string(year);
    if (ui_language == "ru") {
        return d + " " + kRussianMonthsGenitive[index] + " " + y;
    }
    if (ui_language == "uk") {
        return d + " " + kUkrainianMonthsGenitive[index] + " " + y;
    }
    return std::string(kEnglishMonths[index]) + " " + d + ", " + y;
}

std::optional<std::string> test_locale() {
    std::lock_guard<std::mutex> lock(g_test_locale_mutex);
    return g_test_locale;
}

}  // namespace

namespace date_format {

bool is_plain_locale(std::string_view locale_name) {
    const std::string_view language = locale_name.substr(0, locale_name.find_first_of("_.@"));
    return language.empty() || language == "C" || language == "POSIX";
}

}  // namespace date_format

// The system's text with its narrow and ordinary no-break spaces (CLDR writes U+202F before
// the Russian "г.") as plain spaces: the date goes into a book file as ordinary text.
std::string plain_spaces(std::string text) {
    for (const char* nbsp : {"\xE2\x80\xAF", "\xC2\xA0"}) {
        const std::string needle(nbsp);
        for (std::size_t at = text.find(needle); at != std::string::npos;
             at = text.find(needle, at + 1)) {
            text.replace(at, needle.size(), " ");
        }
    }
    return text;
}

std::string format_long_date(int year, int month, int day, std::string_view ui_language) {
    month = std::clamp(month, 1, 12);
    day = std::clamp(day, 1, days_in_month(year, month));
    const std::optional<std::string> pinned = test_locale();
    if (!pinned || !date_format::is_plain_locale(*pinned)) {
        if (auto text = date_format::regional_long_date(year, month, day,
                                                        pinned ? pinned->c_str() : nullptr)) {
            return plain_spaces(std::move(*text));
        }
    }
    return fallback_long_date(year, month, day, ui_language);
}

bool set_date_locale_for_tests(const char* locale_name) {
    if (locale_name != nullptr && !date_format::is_plain_locale(locale_name) &&
        !date_format::locale_available(locale_name)) {
        return false;
    }
    std::lock_guard<std::mutex> lock(g_test_locale_mutex);
    if (locale_name == nullptr) {
        g_test_locale.reset();
    } else {
        g_test_locale = locale_name;
    }
    return true;
}

}  // namespace mfbe::platform
