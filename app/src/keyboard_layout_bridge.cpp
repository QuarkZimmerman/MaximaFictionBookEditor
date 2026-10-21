// Compiled in mfbe_app_bridge (exceptions enabled); see keyboard_layout_bridge.h.

#include "keyboard_layout_bridge.h"

#include "dialog_provider.h"
#include "include/base/cef_callback.h"
#include "include/cef_browser.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "keyboard_layout.h"

#include <cstdint>
#include <string>
#include <type_traits>
#include <utility>

#if __has_include(<mfbe/keyboard_layout_provider.hpp>)
#include <mfbe/keyboard_layout_provider.hpp>
#define MFBE_SHELL_HAS_CORE_KEYBOARD 1
#endif

namespace mfbe::shell {

#if defined(MFBE_SHELL_HAS_CORE_KEYBOARD)

namespace {

using ListDone = mfbe::KeyboardLayoutProvider::Callback<mfbe::KeyboardLayoutList>;
using ActivateDone = mfbe::KeyboardLayoutProvider::Callback<mfbe::KeyboardLayoutSwitch>;

mfbe::KeyboardLayoutList toCore(const KeyboardLayoutListing& listing) {
    mfbe::KeyboardLayoutList out;
    out.supported = listing.supported;
    out.reason = listing.reason;
    for (const auto& layout : listing.layouts) {
        out.layouts.push_back(mfbe::KeyboardLayout{layout.id, layout.name});
    }
    out.current = listing.current;
    return out;
}

mfbe::KeyboardLayoutSwitch toCore(const KeyboardLayoutOutcome& outcome) {
    mfbe::KeyboardLayoutSwitch out;
    out.activated = outcome.activated;
    out.reason = outcome.reason;
    out.systemCode = outcome.systemCode;
    return out;
}

// The owner window's native handle as a number: HWND / NSView* (pointers) or the X11 window id.
template <typename Handle>
std::uintptr_t nativeHandle(Handle handle) {
    if constexpr (std::is_pointer_v<Handle>) {
        return reinterpret_cast<std::uintptr_t>(handle);
    } else {
        return static_cast<std::uintptr_t>(handle);
    }
}

void listOnUiThread(ListDone done) {
    CEF_REQUIRE_UI_THREAD();
    mfbe::KeyboardLayoutList result;
    try {
        result = toCore(listKeyboardLayouts());
    } catch (...) {
        result = mfbe::KeyboardLayoutList{};
        result.reason = "unsupported";
    }
    done(std::move(result));
}

void activateOnUiThread(CefRefPtr<CefBrowser> browser, std::string id, ActivateDone done) {
    CEF_REQUIRE_UI_THREAD();
    std::uintptr_t window = 0;
    if (browser) {
        if (CefRefPtr<CefBrowserHost> host = browser->GetHost()) {
            window = nativeHandle(host->GetWindowHandle());
        }
    }
    mfbe::KeyboardLayoutSwitch result;
    try {
        result = toCore(activateKeyboardLayout(id, window));
    } catch (...) {
        result = mfbe::KeyboardLayoutSwitch{};
        result.reason = "unsupported";
    }
    done(std::move(result));
}

class ShellKeyboardLayoutProvider final : public mfbe::KeyboardLayoutProvider {
public:
    explicit ShellKeyboardLayoutProvider(std::shared_ptr<NativeDialogs> dialogs)
        : dialogs_(std::move(dialogs)) {}

    void list(Callback<mfbe::KeyboardLayoutList> done) override {
        if (!done) {
            return;
        }
        if (!CefPostTask(TID_UI, base::BindOnce(&listOnUiThread, done))) {
            mfbe::KeyboardLayoutList none;  // message loop not running
            none.reason = "unsupported";
            done(std::move(none));
        }
    }

    void activate(const std::string& id, Callback<mfbe::KeyboardLayoutSwitch> done) override {
        if (!done) {
            return;
        }
        CefRefPtr<CefBrowser> owner = dialogs_ ? dialogs_->ownerBrowser() : nullptr;
        if (!CefPostTask(TID_UI, base::BindOnce(&activateOnUiThread, owner, id, done))) {
            mfbe::KeyboardLayoutSwitch none;  // message loop not running
            none.reason = "unsupported";
            done(std::move(none));
        }
    }

private:
    std::shared_ptr<NativeDialogs> dialogs_;
};

}  // namespace

std::shared_ptr<mfbe::KeyboardLayoutProvider> makeCoreKeyboardLayoutProvider(
    std::shared_ptr<NativeDialogs> dialogs) {
    return std::make_shared<ShellKeyboardLayoutProvider>(std::move(dialogs));
}

#else  // !MFBE_SHELL_HAS_CORE_KEYBOARD

std::shared_ptr<mfbe::KeyboardLayoutProvider> makeCoreKeyboardLayoutProvider(
    std::shared_ptr<NativeDialogs> /*dialogs*/) {
    return nullptr;
}

#endif  // MFBE_SHELL_HAS_CORE_KEYBOARD

}  // namespace mfbe::shell
