// Native dialogs for the CEF shell (T036) and the adapter that plugs them into the core's
// `mfbe::DialogProvider` so the `dialog.*` RPCs (contracts/rpc-api.md §3.9) work in the
// packaged application.
//
// Two layers:
//
//   NativeDialogs           plain C++ (no core types), usable without the core. Runs
//                           CefBrowserHost::RunFileDialog (OPEN / OPEN_MULTIPLE / SAVE /
//                           OPEN_FOLDER) and a message box on the CEF UI thread. The primary
//                           API is asynchronous (the completion callback runs once on the UI
//                           thread, matching the core's callback-based DialogProvider); the
//                           *AndWait helpers block a non-UI caller with a mutex + condition
//                           variable until the dialog is dismissed.
//
//   makeCoreDialogProvider  returns an implementation of the core's `mfbe::DialogProvider`
//                           (open_file / save_file / pick_folder / message) backed by
//                           NativeDialogs. Compiled only when <mfbe/dialog_provider.hpp> is
//                           available (`__has_include`); otherwise returns nullptr.
//
// Limitations (documented, by design of CEF's file dialog API):
//
//   * "Encoding:" choice of the original Save As dialog. CEF's RunFileDialog has no extra
//     controls, so the encoding cannot be chosen inside the native dialog. `dialog.saveFile`
//     therefore returns `{path}` without `encoding`; the UI shows its own encoding selector
//     (the `encodingChoices` list from the request) after `dialog.saveFile` returns, and
//     passes the choice to `doc.save({encoding})`.
//   * Message boxes (`dialog.message`, fatal cases only; normal message boxes are HTML in
//     the UI) are implemented as a window-modal Views `CefWindow` hosting a tiny generated
//     HTML page (CEF Views has no static text or dialog primitives). Buttons report their id
//     through the page title, which the shell intercepts. Closing the window without a
//     choice yields an empty button id. Without a window manager (Xvfb) the dialog is shown
//     non-modally (CEF logs "Window modal dialogs are not supported").
//   * Filter mapping: `{name, extensions[]}` becomes CEF's "Name|.fb2;.fbd" accept filter;
//     entries without a name become individual ".ext" filters; MIME patterns such as
//     "image/*" pass through unchanged.
#pragma once

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

struct FileFilter {
    std::string name;                     // e.g. "FictionBook"; may be empty
    std::vector<std::string> extensions;  // "fb2", ".fbd", "image/*" ...
};

enum class FileDialogMode { kOpen, kOpenMultiple, kSave, kFolder };

struct FileDialogRequest {
    FileDialogMode mode = FileDialogMode::kOpen;
    std::string title;         // empty = CEF default ("Open" / "Save")
    std::string default_path;  // directory and/or file name initially selected
    std::vector<FileFilter> filters;
};

struct FileDialogResult {
    bool cancelled = true;           // true when dismissed without a selection
    std::vector<std::string> paths;  // one entry except for kOpenMultiple
};

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

using FileDialogCallback = std::function<void(FileDialogResult)>;
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

    // Maps shell filters to CEF accept_filters (see header comment); exposed for tests.
    static std::vector<std::string> toAcceptFilters(const std::vector<FileFilter>& filters);

private:
    CefRefPtr<CefBrowser> ownerBrowser();

    std::mutex mutex_;
    CefRefPtr<CefBrowser> owner_;
};

// Core adapter (see header comment). Returns nullptr when the shell was built without the
// core headers; `CoreHost::attachDialogs` then logs and continues without native dialogs.
std::shared_ptr<mfbe::DialogProvider> makeCoreDialogProvider(
    std::shared_ptr<NativeDialogs> dialogs);

}  // namespace mfbe::shell
