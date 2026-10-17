// Regional long date on macOS (feature 003 US6, data-model §6): CFDateFormatter with the long
// date style and no time style for the user's current locale (CFLocaleCopyCurrent) - the long
// style carries no weekday: "17 октября 2026 г.", "October 17, 2026". CoreFoundation is a C
// API, so this is a plain C++ translation unit; the test hook names a CFLocale identifier
// ("ru_RU") among CFLocaleCopyAvailableLocaleIdentifiers.
#include "platform/date_format.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <cstring>
#include <string>

namespace mfbe::platform::date_format {
namespace {

// Releases a CoreFoundation object when it goes out of scope.
template <typename T>
class Ref {
public:
    explicit Ref(T ref) : ref_(ref) {}
    ~Ref() {
        if (ref_ != nullptr) {
            CFRelease(ref_);
        }
    }
    Ref(const Ref&) = delete;
    Ref& operator=(const Ref&) = delete;
    T get() const { return ref_; }
    explicit operator bool() const { return ref_ != nullptr; }

private:
    T ref_;
};

CFStringRef cf_string(const char* utf8) {
    return CFStringCreateWithCString(kCFAllocatorDefault, utf8, kCFStringEncodingUTF8);
}

std::optional<std::string> utf8_from_cf(CFStringRef text) {
    const CFIndex length = CFStringGetLength(text);
    const CFIndex capacity = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    std::string out(static_cast<std::size_t>(capacity), '\0');
    if (!CFStringGetCString(text, out.data(), capacity, kCFStringEncodingUTF8)) {
        return std::nullopt;
    }
    out.resize(std::strlen(out.c_str()));
    return out;
}

}  // namespace

std::optional<std::string> regional_long_date(int year, int month, int day,
                                              const char* locale_name) {
    CFLocaleRef chosen = nullptr;
    if (locale_name != nullptr) {
        const Ref<CFStringRef> identifier(cf_string(locale_name));
        if (!identifier) {
            return std::nullopt;
        }
        chosen = CFLocaleCreate(kCFAllocatorDefault, identifier.get());
    } else {
        chosen = CFLocaleCopyCurrent();
    }
    const Ref<CFLocaleRef> locale(chosen);
    if (!locale) {
        return std::nullopt;
    }
    const Ref<CFDateFormatterRef> formatter(CFDateFormatterCreate(
        kCFAllocatorDefault, locale.get(), kCFDateFormatterLongStyle, kCFDateFormatterNoStyle));
    if (!formatter) {
        return std::nullopt;
    }
    // Noon of the date in the system time zone of the Gregorian calendar.
    const Ref<CFCalendarRef> calendar(
        CFCalendarCreateWithIdentifier(kCFAllocatorDefault, kCFGregorianCalendar));
    if (!calendar) {
        return std::nullopt;
    }
    const Ref<CFTimeZoneRef> zone(CFTimeZoneCopySystem());
    if (zone) {
        CFCalendarSetTimeZone(calendar.get(), zone.get());
    }
    CFAbsoluteTime when = 0;
    if (!CFCalendarComposeAbsoluteTime(calendar.get(), &when, "yMdH", year, month, day, 12)) {
        return std::nullopt;
    }
    const Ref<CFStringRef> text(
        CFDateFormatterCreateStringWithAbsoluteTime(kCFAllocatorDefault, formatter.get(), when));
    if (!text) {
        return std::nullopt;
    }
    return utf8_from_cf(text.get());
}

bool locale_available(const char* locale_name) {
    const Ref<CFStringRef> wanted(cf_string(locale_name));
    const Ref<CFArrayRef> identifiers(CFLocaleCopyAvailableLocaleIdentifiers());
    if (!wanted || !identifiers) {
        return false;
    }
    return CFArrayContainsValue(identifiers.get(),
                                CFRangeMake(0, CFArrayGetCount(identifiers.get())),
                                wanted.get()) != 0;
}

}  // namespace mfbe::platform::date_format
