// Adapter between the core's `mfbe::ClipboardProvider` (binary.addFromClipboard) and the
// shell's clipboard reader (native_actions.h). Compiled in mfbe_app_bridge (exceptions on,
// core headers available through __has_include like dialog_provider.cpp).
//
// The core calls read_image() on its transport thread and expects a prompt answer. On Linux
// the GTK clipboard must be read on the main (CEF UI) thread, so the adapter posts the read
// there and waits for at most a few seconds; Windows and macOS read directly.
#pragma once

#include <cstddef>
#include <memory>
#include <string>

namespace mfbe {
class ClipboardProvider;  // core/include/mfbe/clipboard_provider.hpp
}  // namespace mfbe

namespace mfbe::shell {

// Returns nullptr when the shell was built without the core headers.
std::shared_ptr<mfbe::ClipboardProvider> makeCoreClipboardProvider();

// Reads the clipboard through the same path the core uses (any thread; blocks like
// read_image). Returns true and fills `content_type`/`size` when an image was found. Used by
// the MFBE_SHELL_SELFTEST=clipboard hook of dev/test builds (tools/shell-smoke.sh).
bool readClipboardImageForTest(std::string* content_type, std::size_t* size);

}  // namespace mfbe::shell
