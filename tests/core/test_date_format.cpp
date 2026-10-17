// Feature 003 US6 (FR-050 to FR-052, data-model §6): platform::format_long_date writes a date
// in the long date format of the operating system's regional settings without the day of the
// week, and falls back to the interface language's long form when the regional settings cannot
// be determined (`C`/`POSIX` locale, a locale the machine does not have, an API failure).
//
// The regional settings are process-wide, so the tests select them through the formatter's
// test hook (set_date_locale_for_tests) and, on Linux, through the environment variables the
// formatter reads (LC_ALL, then LC_TIME, then LANG - the lookup of setlocale(LC_TIME, "")).
// Locales the machine lacks (en_GB on the development host) skip their test. The Windows and
// macOS expectations run on the CI runners of those platforms.
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <cstdlib>
#include <optional>
#include <string>

using namespace mfbe;

namespace {

// Restores the formatter's regional settings when a test case ends.
struct LocaleGuard {
    LocaleGuard() = default;
    LocaleGuard(const LocaleGuard&) = delete;
    LocaleGuard& operator=(const LocaleGuard&) = delete;
    ~LocaleGuard() { platform::set_date_locale_for_tests(nullptr); }
};

#if !defined(_WIN32) && !defined(__APPLE__)
// Sets or removes an environment variable for one test case and restores it afterwards.
class EnvVar {
public:
    EnvVar(const char* name, const char* value) : name_(name) {
        if (const char* old = std::getenv(name)) {
            saved_ = old;
        }
        if (value != nullptr) {
            ::setenv(name, value, 1);
        } else {
            ::unsetenv(name);
        }
    }
    EnvVar(const EnvVar&) = delete;
    EnvVar& operator=(const EnvVar&) = delete;
    ~EnvVar() {
        if (saved_) {
            ::setenv(name_, saved_->c_str(), 1);
        } else {
            ::unsetenv(name_);
        }
    }

private:
    const char* name_;
    std::optional<std::string> saved_;
};
#endif

std::string date(int year, int month, int day, const char* ui_language = "en") {
    return platform::format_long_date(year, month, day, ui_language);
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Fallback: the interface language's long form (every platform)                             */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("date format: the C locale falls back to the interface language's long form", "[date]") {
    LocaleGuard guard;
    REQUIRE(platform::set_date_locale_for_tests("C"));
    // The interface language decides the form only here, where the system cannot say.
    CHECK(date(2026, 10, 17, "ru") == "17 октября 2026");
    CHECK(date(2026, 10, 17, "uk") == "17 жовтня 2026");
    CHECK(date(2026, 10, 17, "en") == "October 17, 2026");
    // Day without zero padding.
    CHECK(date(2026, 10, 7, "uk") == "7 жовтня 2026");
    CHECK(date(2026, 10, 7, "en") == "October 7, 2026");
    // An unknown interface language is written as English.
    CHECK(date(2026, 10, 17, "de") == "October 17, 2026");
    CHECK(date(2026, 10, 17, "") == "October 17, 2026");
}

TEST_CASE("date format: the fallback month tables are the genitive forms for ru and uk", "[date]") {
    LocaleGuard guard;
    REQUIRE(platform::set_date_locale_for_tests("POSIX"));
    const char* ru[] = {"января", "февраля", "марта",    "апреля",  "мая",    "июня",
                        "июля",   "августа", "сентября", "октября", "ноября", "декабря"};
    const char* uk[] = {"січня", "лютого", "березня", "квітня", "травня",    "червня",
                        "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"};
    const char* en[] = {"January", "February", "March",     "April",   "May",      "June",
                        "July",    "August",   "September", "October", "November", "December"};
    for (int month = 1; month <= 12; ++month) {
        CHECK(date(2026, month, 1, "ru") == std::string("1 ") + ru[month - 1] + " 2026");
        CHECK(date(2026, month, 1, "uk") == std::string("1 ") + uk[month - 1] + " 2026");
        CHECK(date(2026, month, 1, "en") == std::string(en[month - 1]) + " 1, 2026");
    }
}

TEST_CASE("date format: a locale the machine does not have cannot be determined -> fallback",
          "[date]") {
    LocaleGuard guard;
    // The hook refuses the locale and leaves the previous choice in place.
    CHECK_FALSE(platform::set_date_locale_for_tests("xx_XX.UTF-8"));
}

TEST_CASE("date format: out-of-range month and day are clamped, never read past the tables",
          "[date]") {
    LocaleGuard guard;
    REQUIRE(platform::set_date_locale_for_tests("C"));
    CHECK(date(2026, 13, 40, "en") == "December 31, 2026");
    CHECK(date(2026, 0, 0, "ru") == "1 января 2026");
}

/* ----------------------------------------------------------------------------------------- */
/* Linux: the LC_TIME locale (glibc >= 2.27 gives the genitive month through %B)              */
/* ----------------------------------------------------------------------------------------- */

#if !defined(_WIN32) && !defined(__APPLE__)
TEST_CASE("date format: the regional long date of the LC_TIME locale without the weekday",
          "[date]") {
    LocaleGuard guard;
    // The interface language is deliberately another one: the regional settings win.
    REQUIRE(platform::set_date_locale_for_tests("ru_RU.UTF-8"));
    CHECK(date(2026, 10, 17, "en") == "17 октября 2026");
    CHECK(date(2026, 10, 7, "en") == "7 октября 2026");
    REQUIRE(platform::set_date_locale_for_tests("uk_UA.UTF-8"));
    CHECK(date(2026, 10, 17, "en") == "17 жовтня 2026");
    CHECK(date(2026, 10, 7, "ru") == "7 жовтня 2026");
    // en_US puts the month first because its short date (D_FMT "%m/%d/%Y") does.
    REQUIRE(platform::set_date_locale_for_tests("en_US.UTF-8"));
    CHECK(date(2026, 10, 17, "ru") == "October 17, 2026");
    CHECK(date(2026, 1, 7, "uk") == "January 7, 2026");
    // The year is written in full even where the short date abbreviates it (uk_UA "%d.%m.%y").
    REQUIRE(platform::set_date_locale_for_tests("uk_UA.UTF-8"));
    CHECK(date(2031, 12, 31, "en") == "31 грудня 2031");
}

TEST_CASE("date format: en_GB writes the day first (when the machine has the locale)", "[date]") {
    LocaleGuard guard;
    if (!platform::set_date_locale_for_tests("en_GB.UTF-8")) {
        SKIP("en_GB.UTF-8 is not generated on this machine");
    }
    CHECK(date(2026, 10, 17, "en") == "17 October 2026");
    CHECK(date(2026, 10, 7, "ru") == "7 October 2026");
}

TEST_CASE(
    "date format: the environment selects the regional settings as setlocale(LC_TIME) "
    "would",
    "[date]") {
    LocaleGuard guard;
    REQUIRE(platform::set_date_locale_for_tests(nullptr));  // the environment decides
    SECTION("LC_ALL wins") {
        EnvVar all("LC_ALL", "uk_UA.UTF-8");
        EnvVar time("LC_TIME", "ru_RU.UTF-8");
        EnvVar lang("LANG", "en_US.UTF-8");
        CHECK(date(2026, 10, 17, "en") == "17 жовтня 2026");
    }
    SECTION("then LC_TIME") {
        EnvVar all("LC_ALL", nullptr);
        EnvVar time("LC_TIME", "ru_RU.UTF-8");
        EnvVar lang("LANG", "en_US.UTF-8");
        CHECK(date(2026, 10, 17, "en") == "17 октября 2026");
    }
    SECTION("then LANG") {
        EnvVar all("LC_ALL", nullptr);
        EnvVar time("LC_TIME", nullptr);
        EnvVar lang("LANG", "en_US.UTF-8");
        CHECK(date(2026, 10, 17, "ru") == "October 17, 2026");
    }
    SECTION("an empty LC_ALL does not count") {
        EnvVar all("LC_ALL", "");
        EnvVar time("LC_TIME", "uk_UA.UTF-8");
        CHECK(date(2026, 10, 17, "en") == "17 жовтня 2026");
    }
    SECTION("C, POSIX and C.UTF-8 are no regional settings: the interface language decides") {
        EnvVar time("LC_TIME", nullptr);
        EnvVar lang("LANG", nullptr);
        for (const char* name : {"C", "POSIX", "C.UTF-8", "C.utf8"}) {
            EnvVar all("LC_ALL", name);
            CHECK(date(2026, 10, 17, "uk") == "17 жовтня 2026");
            CHECK(date(2026, 10, 17, "ru") == "17 октября 2026");
            CHECK(date(2026, 10, 17, "en") == "October 17, 2026");
        }
    }
    SECTION("nothing set at all") {
        EnvVar all("LC_ALL", nullptr);
        EnvVar time("LC_TIME", nullptr);
        EnvVar lang("LANG", nullptr);
        CHECK(date(2026, 10, 17, "ru") == "17 октября 2026");
    }
    SECTION("a locale the machine does not have") {
        EnvVar all("LC_ALL", "xx_XX.UTF-8");
        CHECK(date(2026, 10, 17, "uk") == "17 жовтня 2026");
    }
}
#endif

/* ----------------------------------------------------------------------------------------- */
/* Windows: the user's long date picture without its weekday part                            */
/* ----------------------------------------------------------------------------------------- */

#ifdef _WIN32
TEST_CASE("date format: the Windows long date without the weekday", "[date]") {
    LocaleGuard guard;
    // ru-RU: "d MMMM yyyy 'г.'" - no weekday in the picture, the genitive month.
    REQUIRE(platform::set_date_locale_for_tests("ru-RU"));
    CHECK(date(2026, 10, 17, "en") == "17 октября 2026 г.");
    CHECK(date(2026, 10, 7, "en") == "7 октября 2026 г.");
    // en-US: "dddd, MMMM d, yyyy" - the weekday and its separator are dropped.
    REQUIRE(platform::set_date_locale_for_tests("en-US"));
    CHECK(date(2026, 10, 17, "ru") == "October 17, 2026");
    // uk-UA: "d MMMM yyyy' р.'".
    REQUIRE(platform::set_date_locale_for_tests("uk-UA"));
    CHECK(date(2026, 10, 17, "en") == "17 жовтня 2026 р.");
    // en-GB: "dddd, d MMMM yyyy"; de-DE: "dddd, d. MMMM yyyy".
    REQUIRE(platform::set_date_locale_for_tests("en-GB"));
    CHECK(date(2026, 10, 17, "en") == "17 October 2026");
    REQUIRE(platform::set_date_locale_for_tests("de-DE"));
    CHECK(date(2026, 10, 17, "en") == "17. Oktober 2026");
    CHECK_FALSE(platform::set_date_locale_for_tests("xx-XX"));
}
#endif

/* ----------------------------------------------------------------------------------------- */
/* macOS: CFDateFormatter's long style (no weekday) for the CFLocale                          */
/* ----------------------------------------------------------------------------------------- */

#ifdef __APPLE__
TEST_CASE("date format: the macOS long date style of the locale", "[date]") {
    LocaleGuard guard;
    // The interface language is deliberately another one: the regional settings win.
    REQUIRE(platform::set_date_locale_for_tests("ru_RU"));
    CHECK(date(2026, 10, 17, "en") == "17 октября 2026 г.");
    CHECK(date(2026, 10, 7, "en") == "7 октября 2026 г.");
    REQUIRE(platform::set_date_locale_for_tests("uk_UA"));
    CHECK(date(2026, 10, 17, "en") == "17 жовтня 2026 р.");
    REQUIRE(platform::set_date_locale_for_tests("en_US"));
    CHECK(date(2026, 10, 17, "ru") == "October 17, 2026");
    REQUIRE(platform::set_date_locale_for_tests("en_GB"));
    CHECK(date(2026, 10, 17, "en") == "17 October 2026");
    CHECK_FALSE(platform::set_date_locale_for_tests("xx_XX"));
}
#endif
