// Regional long date on Windows (feature 003 US6, data-model §6): GetDateFormatEx with the
// user's long date picture (LOCALE_SLONGDATE) minus its weekday part. DATE_LONGDATE itself
// gives "Friday, October 17, 2026" for en-US; without the `dddd`/`ddd` run and the separator
// next to it the picture "MMMM d, yyyy" gives "October 17, 2026", and ru-RU's "d MMMM yyyy 'г.'"
// (no weekday) stays "17 октября 2026 г.". The text comes back as UTF-16 and is converted to
// UTF-8 directly: it is not a path, so the path helpers do not apply.
#include "platform/date_format.hpp"

#include <string>

#ifndef WIN32_LEAN_AND_MEAN  // also a compile definition of mfbe::options (MSVC C4005 otherwise)
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace mfbe::platform::date_format {
namespace {

std::wstring wide_from_utf8(const char* utf8) {
    const int length = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, nullptr, 0);
    if (length <= 1) {
        return {};
    }
    std::wstring wide(static_cast<std::size_t>(length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8, -1, wide.data(), length);
    wide.resize(static_cast<std::size_t>(length - 1));  // without the terminator
    return wide;
}

std::optional<std::string> utf8_from_wide(const wchar_t* wide, int characters) {
    if (characters <= 0) {
        return std::string();
    }
    const int length =
        WideCharToMultiByte(CP_UTF8, 0, wide, characters, nullptr, 0, nullptr, nullptr);
    if (length <= 0) {
        return std::nullopt;
    }
    std::string utf8(static_cast<std::size_t>(length), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide, characters, utf8.data(), length, nullptr, nullptr);
    return utf8;
}

bool is_separator(wchar_t c) {
    return c == L',' || c == L' ' || c == L'\u00A0';
}

// The picture without its weekday part: every `dddd`/`ddd` run together with the separator
// (comma, space) that follows it - or, for a weekday at the end, the one before it. Quoted
// literals ('г.', with '' for a quote) are copied as they are.
std::wstring without_weekday(const std::wstring& picture) {
    std::wstring out;
    std::size_t i = 0;
    while (i < picture.size()) {
        const wchar_t c = picture[i];
        if (c == L'\'') {
            std::size_t j = i + 1;
            while (j < picture.size()) {
                if (picture[j] == L'\'') {
                    if (j + 1 < picture.size() && picture[j + 1] == L'\'') {
                        j += 2;
                        continue;
                    }
                    break;
                }
                ++j;
            }
            const std::size_t end = j < picture.size() ? j + 1 : picture.size();
            out.append(picture, i, end - i);
            i = end;
            continue;
        }
        if (c == L'd') {
            std::size_t run = 0;
            while (i + run < picture.size() && picture[i + run] == L'd') {
                ++run;
            }
            if (run < 3) {
                out.append(run, L'd');  // the day of the month
                i += run;
                continue;
            }
            std::size_t j = i + run;
            while (j < picture.size() && is_separator(picture[j])) {
                ++j;
            }
            if (j == i + run) {
                while (!out.empty() && is_separator(out.back())) {
                    out.pop_back();
                }
            }
            i = j;
            continue;
        }
        out.push_back(c);
        ++i;
    }
    return out;
}

}  // namespace

std::optional<std::string> regional_long_date(int year, int month, int day,
                                              const char* locale_name) {
    std::wstring storage;
    const wchar_t* name = LOCALE_NAME_USER_DEFAULT;
    if (locale_name != nullptr) {
        storage = wide_from_utf8(locale_name);
        name = storage.c_str();
    }
    wchar_t picture[256] = {};
    if (GetLocaleInfoEx(name, LOCALE_SLONGDATE, picture, 256) == 0) {
        return std::nullopt;
    }
    const std::wstring format = without_weekday(picture);
    if (format.empty()) {
        return std::nullopt;
    }
    SYSTEMTIME st = {};
    st.wYear = static_cast<WORD>(year);
    st.wMonth = static_cast<WORD>(month);
    st.wDay = static_cast<WORD>(day);
    wchar_t text[256] = {};
    const int length = GetDateFormatEx(name, 0, &st, format.c_str(), text, 256, nullptr);
    if (length <= 1) {
        return std::nullopt;  // the length counts the terminator
    }
    return utf8_from_wide(text, length - 1);
}

bool locale_available(const char* locale_name) {
    return IsValidLocaleName(wide_from_utf8(locale_name).c_str()) != FALSE;
}

}  // namespace mfbe::platform::date_format
