// The pure parts of the keyboard layout switch and the dispatch to the platform (see
// keyboard_layout.h). Compiled in mfbe_shell_logic on every platform.

#include "keyboard_layout.h"

#include <cstdio>
#include <cstdlib>

namespace mfbe::shell {

namespace {

std::string hex8(std::uint32_t value) {
    char buffer[16];
    std::snprintf(buffer, sizeof(buffer), "%08X", static_cast<unsigned>(value));
    return buffer;
}

std::string hex4(std::uint32_t value) {
    char buffer[16];
    std::snprintf(buffer, sizeof(buffer), "%04X", static_cast<unsigned>(value & 0xFFFFu));
    return buffer;
}

#if !defined(_WIN32) && !defined(__APPLE__)
std::string envOrEmpty(const char* name) {
    const char* value = std::getenv(name);
    return value != nullptr ? std::string(value) : std::string();
}
#endif

}  // namespace

std::string klidFromHkl(std::uint32_t hiword, std::uint32_t loword, const LayoutIdLookup& lookup) {
    hiword &= 0xFFFFu;
    loword &= 0xFFFFu;
    const std::uint32_t whole = (hiword << 16) | loword;
    const std::uint32_t kind = hiword & 0xF000u;
    if (kind == 0xF000u) {
        // A special layout: the low 12 bits are the registry's `Layout Id`.
        if (lookup) {
            if (const std::optional<std::string> klid = lookup(hex4(hiword & 0x0FFFu))) {
                return *klid;
            }
        }
        return "hkl:" + hex8(whole);
    }
    if (kind == 0xE000u) {
        return hex8(whole);  // an IME: the whole HKL is its KLID
    }
    return hex8(hiword != 0 ? hiword : loword);
}

LinuxSessionKind linuxSessionKind(const std::string& xdgSessionType,
                                  const std::string& waylandDisplay, const std::string& display) {
    if (xdgSessionType == "wayland" || !waylandDisplay.empty()) {
        return LinuxSessionKind::wayland;
    }
    if (display.empty()) {
        return LinuxSessionKind::noDisplay;
    }
    return LinuxSessionKind::x11;
}

std::string windowsLayoutName(const std::string& languageName, const std::string& klid,
                              std::uint32_t languageId, const std::string& layoutText) {
    const bool plain = klid == hex8(languageId & 0xFFFFu);
    if (plain) {
        if (!languageName.empty()) {
            return languageName;
        }
        return layoutText.empty() ? klid : layoutText;
    }
    const std::string& detail = layoutText.empty() ? klid : layoutText;
    if (languageName.empty()) {
        return detail;
    }
    return languageName + " (" + detail + ")";
}

#if defined(_WIN32) || defined(__APPLE__)

KeyboardLayoutListing listKeyboardLayouts() {
    return detail::platformListKeyboardLayouts();
}

KeyboardLayoutOutcome activateKeyboardLayout(const std::string& id, std::uintptr_t windowHandle) {
    return detail::platformActivateKeyboardLayout(id, windowHandle);
}

#else  // Linux: the session decides whether X11 is asked at all (spec FR-092)

namespace {

LinuxSessionKind currentSessionKind() {
    return linuxSessionKind(envOrEmpty("XDG_SESSION_TYPE"), envOrEmpty("WAYLAND_DISPLAY"),
                            envOrEmpty("DISPLAY"));
}

}  // namespace

KeyboardLayoutListing listKeyboardLayouts() {
    switch (currentSessionKind()) {
        case LinuxSessionKind::wayland: {
            KeyboardLayoutListing none;
            none.reason = "wayland";
            return none;
        }
        case LinuxSessionKind::noDisplay: {
            KeyboardLayoutListing none;
            none.reason = "noDisplay";
            return none;
        }
        case LinuxSessionKind::x11:
            break;
    }
    return detail::platformListKeyboardLayouts();
}

KeyboardLayoutOutcome activateKeyboardLayout(const std::string& id, std::uintptr_t windowHandle) {
    if (currentSessionKind() != LinuxSessionKind::x11) {
        KeyboardLayoutOutcome none;
        none.reason = "unsupported";
        return none;
    }
    return detail::platformActivateKeyboardLayout(id, windowHandle);
}

#endif

}  // namespace mfbe::shell
