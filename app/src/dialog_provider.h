// Native dialogs for the CEF shell (T036) and the adapter that plugs them into the core's
// `mfbe::DialogProvider` so the `dialog.*` RPCs (contracts/rpc-api.md §3.9) work in the
// packaged application.
//
// Two layers:
//
//   NativeDialogs           plain C++ (no core types), usable without the core. Shows file
//                           dialogs (open / open several / save / folder) and a message box on
//                           the CEF UI thread. The primary API is asynchronous (the completion
//                           callback runs once on the UI thread, matching the core's
//                           callback-based DialogProvider); the *AndWait helpers block a non-UI
//                           caller with a mutex + condition variable until the dialog is
//                           dismissed.
//
//   makeCoreDialogProvider  returns an implementation of the core's `mfbe::DialogProvider`
//                           (open_file / save_file / pick_folder / message) backed by
//                           NativeDialogs. Compiled only when <mfbe/dialog_provider.hpp> is
//                           available (`__has_include`); otherwise returns nullptr.
//
// File dialogs (feature 002, decision D14) are the platform's own (file_dialog_platform.h): the
// named types in order with the selected one active, the folder and name of the request, the
// document dialogs' shared folder and the "Encoding:" choice inside Save As, as the original
// editor's dialogs. CEF's RunFileDialog - which drops named types, cannot preselect one and loses
// the Save As folder - is the fallback when the platform dialog cannot be used (Linux without
// GTK 3; logged once): it offers the selected type's extensions only, and Save As then returns
// no encoding, so the interface asks for it in its own window.
//
// Message boxes (`dialog.message`, fatal cases only; normal message boxes are HTML in the UI)
// are a window-modal Views `CefWindow` hosting a tiny generated HTML page (CEF Views has no
// static text or dialog primitives). Buttons report their id through the page title, which the
// shell intercepts. Closing the window without a choice yields an empty button id. Without a
// window manager (Xvfb) the dialog is shown non-modally (CEF logs "Window modal dialogs are not
// supported").
#pragma once

#include "file_dialog_request.h"
#include "include/cef_browser.h"

#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace mfbe {
class DialogProvider;  // core/include/mfbe/dialog_provider.hpp (forward declaration only)
}  // namespace mfbe

namespace mfbe::shell {

struct MessageRequest {
    std::string caption;               // window title
    std::string text;                  // message body (plain text)
    std::vector<std::string> buttons;  // buttons in display order, "id" or "id|Localised label";
                                       // ids: "ok", "cancel", "yes", "no", "abort", "retry",
                                       // "ignore", "close" (English fallback labels built in)
};

struct MessageResult {
    std::string button;  // id of the pressed button; empty when the window was closed
};

using MessageCallback = std::function<void(MessageResult)>;

class NativeDialogs final {
public:
    NativeDialogs();
    ~NativeDialogs();
    NativeDialogs(const NativeDialogs&) = delete;
    NativeDialogs& operator=(const NativeDialogs&) = delete;

    // The browser whose window owns the dialogs (the main window). Called by the client's
    // life-span handler on the UI thread; thread-safe.
    void setOwnerBrowser(CefRefPtr<CefBrowser> browser);
    void clearOwnerBrowser(CefRefPtr<CefBrowser> browser);
    bool hasOwnerBrowser();

    // Asynchronous API (any thread). `done` is invoked exactly once, on the CEF UI thread,
    // after the dialog is dismissed. Returns false - and never calls `done` - when no owner
    // window exists yet (or any more) or the CEF message loop is not running.
    bool runFileDialog(const FileDialogRequest& request, FileDialogCallback done);
    bool showMessage(const MessageRequest& request, MessageCallback done);

    // Blocking helpers for threads other than the CEF UI thread (tests, scripts). Return a
    // cancelled/empty result when the dialog cannot be shown.
    FileDialogResult runFileDialogAndWait(const FileDialogRequest& request);
    MessageResult showMessageAndWait(const MessageRequest& request);

    // Language of the shell ("ru", "en", ...: --lang or the system's): the language of the
    // texts the shell writes into native dialogs itself (the Save As "Encoding:" label).
    // Thread-safe.
    void setLanguage(std::string language);
    std::string language();

private:
    CefRefPtr<CefBrowser> ownerBrowser();

    std::mutex mutex_;
    CefRefPtr<CefBrowser> owner_;
    std::string language_;
};

// Core adapter (see header comment). Returns nullptr when the shell was built without the
// core headers; `CoreHost::attachDialogs` then logs and continues without native dialogs.
std::shared_ptr<mfbe::DialogProvider> makeCoreDialogProvider(
    std::shared_ptr<NativeDialogs> dialogs);

}  // namespace mfbe::shell
