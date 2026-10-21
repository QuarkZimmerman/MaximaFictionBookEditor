// Adapter between the core's `mfbe::KeyboardLayoutProvider` (system.keyboardLayouts,
// system.activateKeyboardLayout; feature 004 US11, rpc-api.md §3.11) and the shell's platform
// code (keyboard_layout.h). Compiled in mfbe_app_bridge (exceptions on, core headers available
// through __has_include like dialog_provider.cpp).
//
// The core calls list() / activate() on its transport thread; each call is posted to the CEF UI
// thread - the Windows and macOS input APIs belong there, and the main window's native handle
// is read from its browser host - and the core's callback is invoked exactly once from there
// (the core marshals the answer to its own thread). When the message loop is not running the
// callback answers at once with the "unsupported" results; nothing hangs and nothing throws.
#pragma once

#include <memory>

namespace mfbe {
class KeyboardLayoutProvider;  // core/include/mfbe/keyboard_layout_provider.hpp
}  // namespace mfbe

namespace mfbe::shell {

class NativeDialogs;  // dialog_provider.h: knows the main window's browser

// Returns nullptr when the shell was built without the core headers.
std::shared_ptr<mfbe::KeyboardLayoutProvider> makeCoreKeyboardLayoutProvider(
    std::shared_ptr<NativeDialogs> dialogs);

}  // namespace mfbe::shell
