// The keyboard layout switch when a document is opened (feature 004, User Story 11; spec FR-090
// to FR-093; contracts/shell.md §2; research R4): the shell's half of `system.keyboardLayouts`
// and `system.activateKeyboardLayout`. The core's `KeyboardLayoutProvider` is implemented by
// keyboard_layout_bridge.cpp, which posts to the CEF UI thread and calls the two entry points
// below; the platform work is plain C++ here, in `mfbe_shell_logic`, so tests/shell runs it on
// every CI job (FR-093).
//
// Ids are the platform's own stable identifiers, stored as the setting `other.keyboardLayoutId`:
//   Windows  the KLID - eight hex digits ("00000419") derived from the HKL without activating
//            anything (a special layout through the registry's `Layout Id`, an IME through the
//            whole HKL); an HKL the rules cannot map gets "hkl:<8 hex digits>", which still
//            works on that machine;
//   macOS    the input source id ("com.apple.keylayout.Russian");
//   Linux    the XKB group name ("Russian"), never the group index.
// Names are what the system shows. Lists are read afresh on every call; an id is matched against
// a fresh list at every request - an index or handle is never trusted from the setting - and
// nothing is ever loaded or installed (never `LoadKeyboardLayout`). No system setting changes;
// whether other windows follow is the system's own rule.
//
// Linux: `XDG_SESSION_TYPE` equal to `wayland` or a non-empty `WAYLAND_DISPLAY` is a Wayland
// session - also when `DISPLAY` is set (XWayland serves the window) and whatever
// `--ozone-platform` says - and the system offers the editor no way to switch there (spec FR-092,
// requester decision D2 of 2026-10-20): `supported: false, reason: "wayland"`. No `DISPLAY`, a
// failed `XOpenDisplay` or no XKB extension -> "noDisplay". Otherwise the groups of the core
// keyboard are listed and switched with `XkbLockGroup` on a connection of the shell's own
// (Chromium's connection is never touched), verified with `XkbGetState`.
//
// No CEF types, no exceptions escape (every entry point answers a result).
#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::shell {

struct KeyboardLayoutEntry {
    std::string id;    // the platform's stable identifier (see above)
    std::string name;  // what the system shows for it
};

// What `system.keyboardLayouts` reports (rpc-api.md §3.11).
struct KeyboardLayoutListing {
    bool supported = false;
    std::string reason;  // "" | "wayland" | "noDisplay" | "unsupported"
    std::vector<KeyboardLayoutEntry> layouts;
    std::optional<std::string> current;  // the active layout's id when the platform can tell
};

// What `system.activateKeyboardLayout` reports (rpc-api.md §3.11).
struct KeyboardLayoutOutcome {
    bool activated = false;
    std::string reason;  // "" | "notInstalled" | "refused" | "unsupported"
    // The system's code when the switch was refused: GetLastError() on Windows, the OSStatus on
    // macOS, on X11 0 for a refused XkbLockGroup or the group the server kept.
    std::optional<long long> systemCode;
};

/* ---------------------------------------------------------------------------------------- */
/* Pure parts, tested on every platform                                                     */
/* ---------------------------------------------------------------------------------------- */

// The registry's answer for a special layout: the KLID whose `Layout Id` value equals the four
// upper-case hex digits given ("0002" -> "00010409"), or nothing.
using LayoutIdLookup = std::function<std::optional<std::string>(const std::string& layoutId)>;

// The KLID of an HKL from its two words, without activating anything: HIWORD & 0xF000 == 0xF000
// -> a special layout whose low 12 bits are the registry `Layout Id` (resolved by `lookup`;
// unresolved -> "hkl:%08X" of the whole HKL); 0xE000 -> an IME, "%08X" of the whole HKL;
// otherwise the plain layout "%08X" of HIWORD ("00000419" for 0x04190419, "00000409" for the US
// layout under the Russian language 0x04090419; a zero HIWORD names the language's own layout).
std::string klidFromHkl(std::uint32_t hiword, std::uint32_t loword, const LayoutIdLookup& lookup);

enum class LinuxSessionKind { x11, wayland, noDisplay };

// The session kind from the environment (the values of XDG_SESSION_TYPE, WAYLAND_DISPLAY and
// DISPLAY; empty = unset): `wayland` or a non-empty WAYLAND_DISPLAY -> wayland, even with a
// DISPLAY; no DISPLAY -> noDisplay; else x11.
LinuxSessionKind linuxSessionKind(const std::string& xdgSessionType,
                                  const std::string& waylandDisplay, const std::string& display);

// The Windows display name of a layout: the language's localised display name
// ("English (United States)") when `klid` is the plain layout of `languageId` ("%08X" of it),
// else that name with the layout's own text in parentheses ("English (United States) (United
// States-Dvorak)"), the KLID standing in for a missing text; without a language name the text,
// else the KLID.
std::string windowsLayoutName(const std::string& languageName, const std::string& klid,
                              std::uint32_t languageId, const std::string& layoutText);

/* ---------------------------------------------------------------------------------------- */
/* Platform entry points (the bridge calls them on the CEF UI thread)                       */
/* ---------------------------------------------------------------------------------------- */

// The layouts the system currently offers for switching, read afresh.
KeyboardLayoutListing listKeyboardLayouts();

// Activates `id` for the editor's window when the system currently lists it (else
// `notInstalled`, nothing asked of the system). `windowHandle` is the main browser window's
// native handle (HWND on Windows; unused on macOS and X11, where the selection is process- or
// server-wide), 0 when there is none yet.
KeyboardLayoutOutcome activateKeyboardLayout(const std::string& id, std::uintptr_t windowHandle);

namespace detail {

// The per-platform implementations behind the two entry points (keyboard_layout_win.cpp,
// keyboard_layout_mac.mm, keyboard_layout_x11.cpp); on Linux called only in an X11 session.
KeyboardLayoutListing platformListKeyboardLayouts();
KeyboardLayoutOutcome platformActivateKeyboardLayout(const std::string& id,
                                                     std::uintptr_t windowHandle);

}  // namespace detail

}  // namespace mfbe::shell
