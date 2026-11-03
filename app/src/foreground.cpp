// Feature 008: see foreground.h.
#include "foreground.h"

#if defined(_WIN32)
#include <windows.h>
#endif

namespace mfbe::shell {

#if defined(_WIN32)
namespace {

struct WindowSearch {
    DWORD pid = 0;
    HWND found = nullptr;
};

BOOL CALLBACK findMainWindow(HWND window, LPARAM param) {
    auto* search = reinterpret_cast<WindowSearch*>(param);
    DWORD pid = 0;
    ::GetWindowThreadProcessId(window, &pid);
    if (pid == search->pid && ::IsWindowVisible(window) &&
        ::GetWindow(window, GW_OWNER) == nullptr) {
        search->found = window;
        return FALSE;
    }
    return TRUE;
}

}  // namespace

void allowForeground(long long pid) {
    if (pid > 0) {
        ::AllowSetForegroundWindow(static_cast<DWORD>(pid));
    }
}

void bringProcessWindowToFront(long long pid) {
    if (pid <= 0) {
        return;
    }
    WindowSearch search;
    search.pid = static_cast<DWORD>(pid);
    ::EnumWindows(findMainWindow, reinterpret_cast<LPARAM>(&search));
    if (search.found == nullptr) {
        return;
    }
    if (::IsIconic(search.found)) {
        ::ShowWindow(search.found, SW_RESTORE);
    }
    ::SetForegroundWindow(search.found);
}
#else
void allowForeground(long long) {}
void bringProcessWindowToFront(long long) {}
#endif

}  // namespace mfbe::shell
