// Regional long date on Linux and the other POSIX systems (feature 003 US6, data-model §6).
//
// The regional settings are the LC_TIME locale of the environment - LC_ALL, then LC_TIME, then
// LANG, the lookup of `setlocale(LC_TIME, "")`. The locale is opened with newlocale() for the
// LC_TIME category alone and used through strftime_l()/nl_langinfo_l(): the same settings
// setlocale(LC_TIME, "") would apply, without touching the process-global locale (nothing else
// in the core starts formatting numbers or reading files through it) and safe from any thread.
//
// glibc's `%B` has been the genitive month name since 2.27 ("октября", "жовтня"), so the text
// is the month name, the day and the year as plain numbers - unpadded, unlike `%d` - with the
// month first where the locale's short date (`nl_langinfo(D_FMT)`) puts `%m` before `%d`
// (en_US: "October 17, 2026"), the day first otherwise ("17 октября 2026", "17 October 2026").
#include "platform/date_format.hpp"

#include <clocale>
#include <cstdlib>
#include <ctime>
#include <langinfo.h>
#include <string>

namespace mfbe::platform::date_format {
namespace {

// The locale name setlocale(LC_TIME, "") would choose: the first set and non-empty of LC_ALL,
// LC_TIME and LANG; "C" when none is.
std::string environment_time_locale() {
    for (const char* name : {"LC_ALL", "LC_TIME", "LANG"}) {
        const char* value = std::getenv(name);
        if (value != nullptr && *value != '\0') {
            return value;
        }
    }
    return "C";
}

// The LC_TIME category of one locale, every other category the C locale; freed on destruction.
class Locale {
public:
    explicit Locale(const char* name) : handle_(::newlocale(LC_TIME_MASK, name, locale_t{})) {}
    ~Locale() {
        if (ok()) {
            ::freelocale(handle_);
        }
    }
    Locale(const Locale&) = delete;
    Locale& operator=(const Locale&) = delete;
    bool ok() const { return handle_ != locale_t{}; }
    locale_t get() const { return handle_; }

private:
    locale_t handle_;
};

// True when the locale's short date puts the month before the day. The conversions of D_FMT
// are scanned in order, flags and the E/O modifiers skipped; `%D` and `%F` stand for
// month-first forms. Without a day or a month in the format the day comes first.
bool month_first(locale_t locale) {
    const char* format = ::nl_langinfo_l(D_FMT, locale);
    if (format == nullptr) {
        return false;
    }
    for (const char* p = format; *p != '\0'; ++p) {
        if (*p != '%') {
            continue;
        }
        ++p;
        while (*p == '_' || *p == '-' || *p == '0' || *p == '^' || *p == '#' || *p == 'E' ||
               *p == 'O' || (*p >= '1' && *p <= '9')) {
            ++p;
        }
        switch (*p) {
            case 'd':
            case 'e':
                return false;
            case 'm':
            case 'b':
            case 'B':
            case 'h':
            case 'D':
            case 'F':
                return true;
            case '\0':
                return false;
            default:
                break;
        }
    }
    return false;
}

}  // namespace

std::optional<std::string> regional_long_date(int year, int month, int day,
                                              const char* locale_name) {
    const std::string name = locale_name != nullptr ? locale_name : environment_time_locale();
    if (is_plain_locale(name)) {
        return std::nullopt;
    }
    const Locale locale(name.c_str());
    if (!locale.ok()) {
        return std::nullopt;  // the machine does not have the locale
    }
    std::tm tm{};
    tm.tm_year = year - 1900;
    tm.tm_mon = month - 1;
    tm.tm_mday = day;
    tm.tm_hour = 12;
    char month_name[128];
    if (::strftime_l(month_name, sizeof(month_name), "%B", &tm, locale.get()) == 0) {
        return std::nullopt;
    }
    const std::string d = std::to_string(day);
    const std::string y = std::to_string(year);
    if (month_first(locale.get())) {
        return std::string(month_name) + " " + d + ", " + y;
    }
    return d + " " + month_name + " " + y;
}

bool locale_available(const char* locale_name) {
    return Locale(locale_name).ok();
}

}  // namespace mfbe::platform::date_format
