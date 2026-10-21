// The keyboard layout switch when a document is opened (feature 004, User Story 11; spec FR-092,
// FR-093; contracts/shell.md §2; research R4). The pure parts hold everywhere: the KLID a Windows
// HKL maps to, the Linux session kind from the environment, the Windows name composition. Then
// one real switch per platform, the same functions the shell's provider calls: Windows activates
// the Russian layout 00000419 for a hidden window of the test process and reads it back with
// GetKeyboardLayout; Linux, under Xvfb with two XKB groups (`MFBE_TEST_XKB_GROUPS`, the CI
// wrapper), locks group 1 and back and reports a Wayland session as unsupported; macOS lists the
// enabled input sources and completes a request - the system's refusal counts as a pass (best
// effort, as the constitution sets for macOS).
#include "keyboard_layout.h"

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <cstdlib>
#include <optional>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#elif defined(__linux__)
#include <X11/XKBlib.h>
#include <X11/Xlib.h>
#endif

using mfbe::shell::activateKeyboardLayout;
using mfbe::shell::KeyboardLayoutListing;
using mfbe::shell::KeyboardLayoutOutcome;
using mfbe::shell::klidFromHkl;
using mfbe::shell::LinuxSessionKind;
using mfbe::shell::linuxSessionKind;
using mfbe::shell::listKeyboardLayouts;
using mfbe::shell::windowsLayoutName;

namespace {

std::optional<std::string> noLayoutId(const std::string& /*layoutId*/) {
    return std::nullopt;
}

// The registry of a machine where `Layout Id` 0002 belongs to the United States-Dvorak layout.
std::optional<std::string> dvorakLayoutId(const std::string& layoutId) {
    if (layoutId == "0002") {
        return std::string("00010409");
    }
    return std::nullopt;
}

[[maybe_unused]] std::vector<std::string> namesOf(const KeyboardLayoutListing& listing) {
    std::vector<std::string> names;
    for (const auto& layout : listing.layouts) {
        names.push_back(layout.name);
    }
    return names;
}

std::vector<std::string> idsOf(const KeyboardLayoutListing& listing) {
    std::vector<std::string> ids;
    for (const auto& layout : listing.layouts) {
        ids.push_back(layout.id);
    }
    return ids;
}

}  // namespace

TEST_CASE(
    "keyboard layout: the KLID of an HKL - plain, foreign-under-language, special, IME, "
    "unmappable",
    "[shell][keyboard]") {
    // A plain layout: the device word names the layout of its own language.
    CHECK(klidFromHkl(0x0419, 0x0419, noLayoutId) == "00000419");
    // The US layout used under the Russian input language: the device word, not the language.
    CHECK(klidFromHkl(0x0409, 0x0419, noLayoutId) == "00000409");
    // A special layout (0xF000): the low 12 bits are the registry's `Layout Id`.
    CHECK(klidFromHkl(0xF002, 0x0409, dvorakLayoutId) == "00010409");
    // An IME (0xE000): the whole HKL is the KLID.
    CHECK(klidFromHkl(0xE020, 0x0411, noLayoutId) == "E0200411");
    // A special layout the registry does not resolve: a stable fallback that still names the
    // HKL on that machine.
    CHECK(klidFromHkl(0xF0C0, 0x0409, noLayoutId) == "hkl:F0C00409");
    CHECK(klidFromHkl(0xF002, 0x0409, noLayoutId) == "hkl:F0020409");
    // A zero device word (an HKL made of the language alone) is the language's plain layout.
    CHECK(klidFromHkl(0x0000, 0x0409, noLayoutId) == "00000409");
    // The lookup receives the `Layout Id` as four upper-case hex digits.
    std::string asked;
    const auto recording = [&asked](const std::string& layoutId) -> std::optional<std::string> {
        asked = layoutId;
        return std::nullopt;
    };
    klidFromHkl(0xF0A1, 0x0407, recording);
    CHECK(asked == "00A1");
}

TEST_CASE("keyboard layout: the Linux session kind - Wayland even under XWayland, no display, X11",
          "[shell][keyboard]") {
    CHECK(linuxSessionKind("wayland", "", ":0") == LinuxSessionKind::wayland);
    CHECK(linuxSessionKind("wayland", "", "") == LinuxSessionKind::wayland);
    // WAYLAND_DISPLAY set: a Wayland session whatever XDG_SESSION_TYPE says, also with a DISPLAY
    // (XWayland serves the window; spec FR-092).
    CHECK(linuxSessionKind("", "wayland-0", "") == LinuxSessionKind::wayland);
    CHECK(linuxSessionKind("x11", "wayland-0", ":0") == LinuxSessionKind::wayland);
    CHECK(linuxSessionKind("tty", "wayland-1", ":1") == LinuxSessionKind::wayland);
    // No DISPLAY: nothing to ask.
    CHECK(linuxSessionKind("x11", "", "") == LinuxSessionKind::noDisplay);
    CHECK(linuxSessionKind("", "", "") == LinuxSessionKind::noDisplay);
    CHECK(linuxSessionKind("tty", "", "") == LinuxSessionKind::noDisplay);
    // X11.
    CHECK(linuxSessionKind("x11", "", ":0") == LinuxSessionKind::x11);
    CHECK(linuxSessionKind("", "", ":1") == LinuxSessionKind::x11);
    CHECK(linuxSessionKind("tty", "", ":99") == LinuxSessionKind::x11);
}

TEST_CASE(
    "keyboard layout: the Windows name - the language's display name, the layout's own name "
    "when it is not the plain one",
    "[shell][keyboard]") {
    // The plain layout of a language: the localised language name alone.
    CHECK(windowsLayoutName("Russian (Russia)", "00000419", 0x0419, "Russian") ==
          "Russian (Russia)");
    CHECK(windowsLayoutName("English (United States)", "00000409", 0x0409, "US") ==
          "English (United States)");
    // Another layout of the language: its own name in parentheses.
    CHECK(
        windowsLayoutName("English (United States)", "00010409", 0x0409, "United States-Dvorak") ==
        "English (United States) (United States-Dvorak)");
    // The US layout under the Russian language is "the US layout", named by its own language.
    CHECK(windowsLayoutName("English (United States)", "00000409", 0x0409, "US") ==
          "English (United States)");
    // No layout text known: the KLID stands in for it; no language name: the text or the KLID.
    CHECK(windowsLayoutName("English (United States)", "00010409", 0x0409, "") ==
          "English (United States) (00010409)");
    CHECK(windowsLayoutName("", "00010409", 0x0409, "United States-Dvorak") ==
          "United States-Dvorak");
    CHECK(windowsLayoutName("", "hkl:F0C00409", 0x0409, "") == "hkl:F0C00409");
    CHECK(windowsLayoutName("", "00000419", 0x0419, "") == "00000419");
}

#if defined(_WIN32)

namespace {

std::uint32_t hklBits(HKL hkl) {
    return static_cast<std::uint32_t>(reinterpret_cast<ULONG_PTR>(hkl) & 0xFFFFFFFFu);
}

bool listsLayout(const std::string& id) {
    const KeyboardLayoutListing listing = listKeyboardLayouts();
    return std::any_of(listing.layouts.begin(), listing.layouts.end(),
                       [&id](const auto& layout) { return layout.id == id; });
}

}  // namespace

TEST_CASE(
    "keyboard layout: Windows lists the session's layouts and switches a hidden window to "
    "Russian and back",
    "[shell][keyboard]") {
    // The runner's session may lack Russian: the test harness adds 00000419 for this process
    // and unloads it at the end. The editor itself never loads a layout (FR-091).
    HKL loaded = nullptr;
    if (!listsLayout("00000419")) {
        loaded = ::LoadKeyboardLayoutW(L"00000419", 0);
        REQUIRE(loaded != nullptr);
    }
    const HKL original = ::GetKeyboardLayout(0);

    const KeyboardLayoutListing listing = listKeyboardLayouts();
    CHECK(listing.supported);
    CHECK(listing.reason.empty());
    REQUIRE(listing.current.has_value());
    INFO("layouts: " << [&] {
        std::string all;
        for (const auto& layout : listing.layouts) {
            all += layout.id + "=" + layout.name + "; ";
        }
        return all;
    }());
    const auto russian = std::find_if(listing.layouts.begin(), listing.layouts.end(),
                                      [](const auto& layout) { return layout.id == "00000419"; });
    REQUIRE(russian != listing.layouts.end());
    CHECK_FALSE(russian->name.empty());
    const auto ids = idsOf(listing);
    CHECK(std::find(ids.begin(), ids.end(), *listing.current) != ids.end());

    // A hidden window of the test thread stands in for the editor's main window: the request
    // message goes to its root and the thread's layout is read back.
    HWND hwnd = ::CreateWindowExW(0, L"STATIC", L"mfbe keyboard layout test", WS_POPUP, 0, 0, 1, 1,
                                  nullptr, nullptr, ::GetModuleHandleW(nullptr), nullptr);
    REQUIRE(hwnd != nullptr);

    const KeyboardLayoutOutcome toRussian =
        activateKeyboardLayout("00000419", reinterpret_cast<std::uintptr_t>(hwnd));
    INFO("to Russian: reason=" << toRussian.reason
                               << " systemCode=" << toRussian.systemCode.value_or(0));
    CHECK(toRussian.activated);
    CHECK(toRussian.reason.empty());
    if (loaded != nullptr) {
        CHECK(::GetKeyboardLayout(0) == loaded);
    }
    CHECK(hklBits(::GetKeyboardLayout(0)) == 0x04190419u);

    // Back to the original layout of the thread.
    const KeyboardLayoutOutcome back =
        activateKeyboardLayout(*listing.current, reinterpret_cast<std::uintptr_t>(hwnd));
    INFO("back: reason=" << back.reason << " systemCode=" << back.systemCode.value_or(0));
    CHECK(back.activated);
    CHECK(::GetKeyboardLayout(0) == original);

    // A layout the session does not list: not installed, nothing asked of the system.
    const KeyboardLayoutOutcome unknown =
        activateKeyboardLayout("0000ffff", reinterpret_cast<std::uintptr_t>(hwnd));
    CHECK_FALSE(unknown.activated);
    CHECK(unknown.reason == "notInstalled");
    CHECK_FALSE(unknown.systemCode.has_value());

    ::DestroyWindow(hwnd);
    if (loaded != nullptr) {
        ::UnloadKeyboardLayout(loaded);
    }
}

#elif defined(__linux__)

namespace {

std::string envOrEmpty(const char* name) {
    const char* value = std::getenv(name);
    return value != nullptr ? std::string(value) : std::string();
}

// The names of MFBE_TEST_XKB_GROUPS ("English (US);Russian").
std::vector<std::string> expectedGroups(const std::string& spec) {
    std::vector<std::string> names;
    std::string::size_type start = 0;
    while (start <= spec.size()) {
        const auto end = spec.find(';', start);
        names.push_back(
            spec.substr(start, end == std::string::npos ? std::string::npos : end - start));
        if (end == std::string::npos) {
            break;
        }
        start = end + 1;
    }
    return names;
}

// The core keyboard's effective group, read on a connection of the test's own (-1 without one).
int currentXkbGroup() {
    Display* display = XOpenDisplay(nullptr);
    if (display == nullptr) {
        return -1;
    }
    XkbStateRec state{};
    const Status status = XkbGetState(display, XkbUseCoreKbd, &state);
    XCloseDisplay(display);
    return status == Success ? static_cast<int>(state.group) : -1;
}

// Sets an environment variable for one section and restores it afterwards.
class ScopedEnv {
public:
    ScopedEnv(const char* name, const char* value) : name_(name) {
        const char* previous = std::getenv(name);
        if (previous != nullptr) {
            previous_ = previous;
        }
        setenv(name, value, 1);
    }
    ~ScopedEnv() {
        if (previous_) {
            setenv(name_.c_str(), previous_->c_str(), 1);
        } else {
            unsetenv(name_.c_str());
        }
    }
    ScopedEnv(const ScopedEnv&) = delete;
    ScopedEnv& operator=(const ScopedEnv&) = delete;

private:
    std::string name_;
    std::optional<std::string> previous_;
};

}  // namespace

TEST_CASE("keyboard layout: X11 lists the XKB groups of the virtual display and locks one",
          "[shell][keyboard]") {
    const std::string spec = envOrEmpty("MFBE_TEST_XKB_GROUPS");
    if (spec.empty()) {
        SKIP(
            "MFBE_TEST_XKB_GROUPS is not set: needs Xvfb with `setxkbmap -layout us,ru` (the CI "
            "wrapper)");
    }
    const std::vector<std::string> expected = expectedGroups(spec);
    REQUIRE(expected.size() >= 2);

    CHECK(linuxSessionKind(envOrEmpty("XDG_SESSION_TYPE"), envOrEmpty("WAYLAND_DISPLAY"),
                           envOrEmpty("DISPLAY")) == LinuxSessionKind::x11);

    const KeyboardLayoutListing listing = listKeyboardLayouts();
    INFO("reason: " << listing.reason);
    REQUIRE(listing.supported);
    CHECK(listing.reason.empty());
    CHECK(namesOf(listing) == expected);
    CHECK(idsOf(listing) == expected);  // the id is the group name, never the index
    REQUIRE(listing.current.has_value());
    CHECK(std::find(expected.begin(), expected.end(), *listing.current) != expected.end());

    const KeyboardLayoutOutcome toSecond = activateKeyboardLayout(expected[1], 0);
    INFO("to " << expected[1] << ": reason=" << toSecond.reason
               << " systemCode=" << toSecond.systemCode.value_or(0));
    CHECK(toSecond.activated);
    CHECK(toSecond.reason.empty());
    CHECK(currentXkbGroup() == 1);
    REQUIRE(listKeyboardLayouts().current.has_value());
    CHECK(*listKeyboardLayouts().current == expected[1]);

    const KeyboardLayoutOutcome toFirst = activateKeyboardLayout(expected[0], 0);
    INFO("to " << expected[0] << ": reason=" << toFirst.reason
               << " systemCode=" << toFirst.systemCode.value_or(0));
    CHECK(toFirst.activated);
    CHECK(currentXkbGroup() == 0);

    // A group the display does not have: not installed, nothing locked.
    const KeyboardLayoutOutcome unknown = activateKeyboardLayout("Greek", 0);
    CHECK_FALSE(unknown.activated);
    CHECK(unknown.reason == "notInstalled");
    CHECK_FALSE(unknown.systemCode.has_value());
    CHECK(currentXkbGroup() == 0);
}

TEST_CASE("keyboard layout: a Wayland session offers no switch, whatever the display backend",
          "[shell][keyboard]") {
    const ScopedEnv wayland("WAYLAND_DISPLAY", "wayland-0");
    const KeyboardLayoutListing listing = listKeyboardLayouts();
    CHECK_FALSE(listing.supported);
    CHECK(listing.reason == "wayland");
    CHECK(listing.layouts.empty());
    CHECK_FALSE(listing.current.has_value());

    const KeyboardLayoutOutcome outcome = activateKeyboardLayout("Russian", 0);
    CHECK_FALSE(outcome.activated);
    CHECK(outcome.reason == "unsupported");
    CHECK_FALSE(outcome.systemCode.has_value());
}

TEST_CASE("keyboard layout: without a DISPLAY nothing can be asked", "[shell][keyboard]") {
    const ScopedEnv noWayland("WAYLAND_DISPLAY", "");
    const ScopedEnv noSession("XDG_SESSION_TYPE", "");
    const ScopedEnv noDisplay("DISPLAY", "");
    const KeyboardLayoutListing listing = listKeyboardLayouts();
    CHECK_FALSE(listing.supported);
    CHECK(listing.reason == "noDisplay");
    CHECK(listing.layouts.empty());
    const KeyboardLayoutOutcome outcome = activateKeyboardLayout("Russian", 0);
    CHECK_FALSE(outcome.activated);
    CHECK(outcome.reason == "unsupported");
}

#elif defined(__APPLE__)

TEST_CASE("keyboard layout: macOS lists the enabled input sources and completes a request",
          "[shell][keyboard]") {
    const KeyboardLayoutListing listing = listKeyboardLayouts();
    INFO("reason: " << listing.reason);
    CHECK(listing.supported);
    REQUIRE_FALSE(listing.layouts.empty());
    REQUIRE(listing.current.has_value());
    for (const auto& layout : listing.layouts) {
        CHECK_FALSE(layout.id.empty());
        CHECK_FALSE(layout.name.empty());
    }
    const auto ids = idsOf(listing);
    CHECK(std::find(ids.begin(), ids.end(), *listing.current) != ids.end());

    // The request completes with one of the three answers - activated, completed but withheld
    // (no reason), or refused with the system's code; the system's refusal counts as a pass
    // (FR-093, best effort).
    const KeyboardLayoutOutcome outcome = activateKeyboardLayout(*listing.current, 0);
    INFO("activate(current): activated=" << outcome.activated << " reason=" << outcome.reason
                                         << " systemCode=" << outcome.systemCode.value_or(0));
    if (outcome.reason == "refused") {
        CHECK_FALSE(outcome.activated);
        CHECK(outcome.systemCode.has_value());
    } else {
        CHECK(outcome.reason.empty());
        if (!outcome.activated) {
            CHECK_FALSE(outcome.systemCode.has_value());
        }
    }

    // An input source the system does not list: not installed, nothing selected.
    const KeyboardLayoutOutcome unknown =
        activateKeyboardLayout("com.example.keylayout.DoesNotExist", 0);
    CHECK_FALSE(unknown.activated);
    CHECK(unknown.reason == "notInstalled");
    CHECK_FALSE(unknown.systemCode.has_value());
}

#endif
