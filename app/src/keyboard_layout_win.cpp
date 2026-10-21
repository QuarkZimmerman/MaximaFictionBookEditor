// Windows keyboard layouts (see keyboard_layout.h; research R4.2): the session's input locales
// from GetKeyboardLayoutList, each named by its KLID - derived from the HKL without activating
// anything - and shown under the language's localised display name plus the layout's own name
// when it is not the language's plain layout. The switch is the message Windows itself posts to
// the focused window when the user picks a layout, WM_INPUTLANGCHANGEREQUEST to the editor's
// top-level window, verified with GetKeyboardLayout; ActivateKeyboardLayout is the fallback for
// a window procedure that would not pass it on. Never LoadKeyboardLayout: the editor activates
// only a layout the session lists and installs nothing (spec FR-091).

#include "keyboard_layout.h"

#include <optional>
#include <string>
#include <vector>

// clang-format off: windows.h first, the shell headers depend on it
#include <windows.h>

#include <shlwapi.h>
// clang-format on

namespace mfbe::shell::detail {

namespace {

constexpr wchar_t kLayoutsKey[] = L"SYSTEM\\CurrentControlSet\\Control\\Keyboard Layouts";

std::string utf8FromWide(const std::wstring& wide) {
    if (wide.empty()) {
        return {};
    }
    const int length = ::WideCharToMultiByte(
        CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
    if (length <= 0) {
        return {};
    }
    std::string utf8(static_cast<size_t>(length), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()), utf8.data(),
                          length, nullptr, nullptr);
    return utf8;
}

std::wstring wideFromUtf8(const std::string& utf8) {
    if (utf8.empty()) {
        return {};
    }
    const int length =
        ::MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), nullptr, 0);
    if (length <= 0) {
        return {};
    }
    std::wstring wide(static_cast<size_t>(length), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), wide.data(),
                          length);
    return wide;
}

std::uint32_t hklBits(HKL hkl) {
    return static_cast<std::uint32_t>(reinterpret_cast<ULONG_PTR>(hkl) & 0xFFFFFFFFu);
}

// A REG_SZ value of HKLM\...\Keyboard Layouts\<subkey> (empty when absent).
std::wstring layoutsValue(const std::wstring& subkey, const wchar_t* valueName) {
    const std::wstring path = std::wstring(kLayoutsKey) + L"\\" + subkey;
    wchar_t buffer[512];
    DWORD size = sizeof(buffer);
    if (::RegGetValueW(HKEY_LOCAL_MACHINE, path.c_str(), valueName, RRF_RT_REG_SZ, nullptr, buffer,
                       &size) != ERROR_SUCCESS) {
        return {};
    }
    return std::wstring(buffer);
}

bool equalsIgnoreCase(const std::wstring& a, const std::wstring& b) {
    return a.size() == b.size() &&
           ::CompareStringOrdinal(a.c_str(), static_cast<int>(a.size()), b.c_str(),
                                  static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}

// The KLID whose registry key carries `Layout Id` == layoutId (four hex digits), scanning the
// `Keyboard Layouts` keys once per lookup; nothing when none does.
std::optional<std::string> registryLayoutId(const std::string& layoutId) {
    HKEY key = nullptr;
    if (::RegOpenKeyExW(HKEY_LOCAL_MACHINE, kLayoutsKey, 0, KEY_READ, &key) != ERROR_SUCCESS) {
        return std::nullopt;
    }
    const std::wstring wanted = wideFromUtf8(layoutId);
    std::optional<std::string> found;
    for (DWORD index = 0;; ++index) {
        wchar_t name[64];
        DWORD size = static_cast<DWORD>(sizeof(name) / sizeof(name[0]));
        const LSTATUS status =
            ::RegEnumKeyExW(key, index, name, &size, nullptr, nullptr, nullptr, nullptr);
        if (status != ERROR_SUCCESS) {
            break;
        }
        if (equalsIgnoreCase(layoutsValue(name, L"Layout Id"), wanted)) {
            found = utf8FromWide(name);
            break;
        }
    }
    ::RegCloseKey(key);
    return found;
}

// The layout's own name from its registry key: the indirect `Layout Display Name` (resolved
// with SHLoadIndirectString, which gives the localised text) or the English `Layout Text`.
std::string layoutText(const std::string& klid) {
    const std::wstring subkey = wideFromUtf8(klid);
    const std::wstring indirect = layoutsValue(subkey, L"Layout Display Name");
    if (!indirect.empty()) {
        wchar_t resolved[512];
        if (SUCCEEDED(::SHLoadIndirectString(
                indirect.c_str(), resolved,
                static_cast<UINT>(sizeof(resolved) / sizeof(resolved[0])), nullptr)) &&
            resolved[0] != L'\0') {
            return utf8FromWide(resolved);
        }
    }
    return utf8FromWide(layoutsValue(subkey, L"Layout Text"));
}

// The localised display name of the input language ("Russian (Russia)"), empty when unknown.
std::string languageName(std::uint32_t languageId) {
    wchar_t locale[LOCALE_NAME_MAX_LENGTH];
    if (::LCIDToLocaleName(MAKELCID(languageId, SORT_DEFAULT), locale, LOCALE_NAME_MAX_LENGTH, 0) ==
        0) {
        return {};
    }
    wchar_t display[256];
    const int length = ::GetLocaleInfoEx(locale, LOCALE_SLOCALIZEDDISPLAYNAME, display,
                                         static_cast<int>(sizeof(display) / sizeof(display[0])));
    if (length <= 1) {
        return {};
    }
    return utf8FromWide(display);
}

struct SessionLayout {
    HKL hkl = nullptr;
    std::string klid;
};

// The session's input locales with their KLIDs, in GetKeyboardLayoutList order.
std::vector<SessionLayout> sessionLayouts() {
    std::vector<SessionLayout> out;
    const int count = ::GetKeyboardLayoutList(0, nullptr);
    if (count <= 0) {
        return out;
    }
    std::vector<HKL> handles(static_cast<size_t>(count));
    const int filled = ::GetKeyboardLayoutList(count, handles.data());
    for (int i = 0; i < filled && i < count; ++i) {
        const std::uint32_t bits = hklBits(handles[static_cast<size_t>(i)]);
        out.push_back(SessionLayout{handles[static_cast<size_t>(i)],
                                    klidFromHkl(bits >> 16, bits & 0xFFFFu, registryLayoutId)});
    }
    return out;
}

std::string klidOf(HKL hkl) {
    const std::uint32_t bits = hklBits(hkl);
    return klidFromHkl(bits >> 16, bits & 0xFFFFu, registryLayoutId);
}

}  // namespace

KeyboardLayoutListing platformListKeyboardLayouts() {
    KeyboardLayoutListing listing;
    const std::vector<SessionLayout> layouts = sessionLayouts();
    if (layouts.empty()) {
        listing.reason = "unsupported";
        return listing;
    }
    listing.supported = true;
    for (const auto& layout : layouts) {
        const std::uint32_t languageId = hklBits(layout.hkl) & 0xFFFFu;
        const bool plain = layout.klid == klidFromHkl(languageId, languageId, nullptr);
        listing.layouts.push_back(KeyboardLayoutEntry{
            layout.klid, windowsLayoutName(languageName(languageId), layout.klid, languageId,
                                           plain ? std::string() : layoutText(layout.klid))});
    }
    listing.current = klidOf(::GetKeyboardLayout(0));
    return listing;
}

KeyboardLayoutOutcome platformActivateKeyboardLayout(const std::string& id,
                                                     std::uintptr_t windowHandle) {
    KeyboardLayoutOutcome outcome;
    // The HKL comes from a fresh list: an id the session no longer lists is not installed and
    // nothing is asked of the system (never LoadKeyboardLayout).
    HKL target = nullptr;
    for (const auto& layout : sessionLayouts()) {
        if (layout.klid == id) {
            target = layout.hkl;
            break;
        }
    }
    if (target == nullptr) {
        outcome.reason = "notInstalled";
        return outcome;
    }

    HWND root = nullptr;
    if (windowHandle != 0) {
        root = ::GetAncestor(reinterpret_cast<HWND>(windowHandle), GA_ROOT);
        if (root == nullptr) {
            root = reinterpret_cast<HWND>(windowHandle);
        }
    }
    // The layout of the thread that owns the window is what the window types with; without a
    // window, the calling thread's.
    const DWORD thread = root != nullptr ? ::GetWindowThreadProcessId(root, nullptr) : 0;
    const auto active = [thread] { return ::GetKeyboardLayout(thread); };

    if (root != nullptr) {
        // The request Windows makes when the user picks a layout: DefWindowProc activates it for
        // the window's thread and tells the window and its children (WM_INPUTLANGCHANGE).
        ::SendMessageW(root, WM_INPUTLANGCHANGEREQUEST, 0, reinterpret_cast<LPARAM>(target));
        if (active() == target) {
            outcome.activated = true;
            return outcome;
        }
    }
    ::SetLastError(ERROR_SUCCESS);
    ::ActivateKeyboardLayout(target, 0);
    if (active() == target) {
        outcome.activated = true;
        return outcome;
    }
    outcome.reason = "refused";
    outcome.systemCode = static_cast<long long>(::GetLastError());
    return outcome;
}

}  // namespace mfbe::shell::detail
