// Compiled in mfbe_app_bridge (exceptions and RTTI enabled); see dialog_provider.h.

#include "dialog_provider.h"

#include "file_dialog_platform.h"
#include "include/base/cef_callback.h"
#include "include/base/cef_logging.h"
#include "include/cef_parser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_browser_view_delegate.h"
#include "include/views/cef_window.h"
#include "include/views/cef_window_delegate.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "native_actions.h"

#include <mfbe/utf8_paths.hpp>

#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string_view>
#include <type_traits>
#include <utility>

// The core's dialog provider interface is optional at build time (see dialog_provider.h).
#if __has_include(<mfbe/dialog_provider.hpp>)
#include <mfbe/dialog_provider.hpp>
#include <mfbe/log.hpp>
#define MFBE_SHELL_HAS_CORE_DIALOGS 1
#endif

namespace mfbe::shell {

namespace {

// Invokes the completion callback exactly once (several CEF callbacks may race to report the
// end of a dialog: button press, window destroyed, browser closed).
template <typename Result>
class Completion {
public:
    explicit Completion(std::function<void(Result)> done) : done_(std::move(done)) {}

    void finish(Result result) {
        std::function<void(Result)> done;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (!done_) {
                return;
            }
            done = std::move(done_);
            done_ = nullptr;
        }
        done(std::move(result));
    }

private:
    std::mutex mutex_;
    std::function<void(Result)> done_;
};

using FileDialogCompletion = Completion<FileDialogResult>;
using MessageCompletion = Completion<MessageResult>;

// Blocking adapter used by the *AndWait helpers.
template <typename Result>
class Waiter {
public:
    std::function<void(Result)> callback() {
        return [this](Result result) {
            {
                std::lock_guard<std::mutex> lock(mutex_);
                result_ = std::move(result);
                done_ = true;
            }
            cv_.notify_all();
        };
    }

    Result wait() {
        std::unique_lock<std::mutex> lock(mutex_);
        cv_.wait(lock, [this] { return done_; });
        return result_;
    }

private:
    std::mutex mutex_;
    std::condition_variable cv_;
    bool done_ = false;
    Result result_;
};

// --- file dialogs -------------------------------------------------------------------------

class FileDialogCallbackImpl : public CefRunFileDialogCallback {
public:
    explicit FileDialogCallbackImpl(std::shared_ptr<FileDialogCompletion> completion)
        : completion_(std::move(completion)) {}

    FileDialogCallbackImpl(const FileDialogCallbackImpl&) = delete;
    FileDialogCallbackImpl& operator=(const FileDialogCallbackImpl&) = delete;

    void OnFileDialogDismissed(const std::vector<CefString>& file_paths) override {
        CEF_REQUIRE_UI_THREAD();
        FileDialogResult result;
        for (const auto& path : file_paths) {
            if (!path.empty()) {
                result.paths.push_back(path.ToString());
            }
        }
        result.cancelled = result.paths.empty();
        completion_->finish(std::move(result));
    }

private:
    std::shared_ptr<FileDialogCompletion> completion_;

    IMPLEMENT_REFCOUNTING(FileDialogCallbackImpl);
};

cef_file_dialog_mode_t toCefMode(FileDialogMode mode) {
    switch (mode) {
        case FileDialogMode::kOpenMultiple:
            return FILE_DIALOG_OPEN_MULTIPLE;
        case FileDialogMode::kSave:
            return FILE_DIALOG_SAVE;
        case FileDialogMode::kFolder:
            return FILE_DIALOG_OPEN_FOLDER;
        case FileDialogMode::kOpen:
        default:
            return FILE_DIALOG_OPEN;
    }
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

// The platform dialog could not be used: said once per run, in the errors-only log.
void reportFallback(const std::string& why) {
    static bool reported = false;  // UI thread only
    if (reported) {
        return;
    }
    reported = true;
    const std::string message = "the platform file dialog cannot be used (" + why +
                                "); CEF's file dialog is shown, without named file types";
#if defined(MFBE_SHELL_HAS_CORE_DIALOGS)
    try {
        mfbe::log::warning("shell", "shell.fileDialogFallback", message);
    } catch (...) {
    }
#endif
    LOG(WARNING) << "mfbe: " << message;
}

void runFileDialogOnUiThread(CefRefPtr<CefBrowser> browser, FileDialogRequest request,
                             std::shared_ptr<FileDialogCompletion> completion) {
    CEF_REQUIRE_UI_THREAD();
    CefRefPtr<CefBrowserHost> host = browser ? browser->GetHost() : nullptr;
    if (!host) {
        completion->finish(FileDialogResult{});
        return;
    }
    std::string why;
    if (runPlatformFileDialog(
            nativeHandle(host->GetWindowHandle()), request,
            [completion](FileDialogResult result) { completion->finish(std::move(result)); },
            &why)) {
        return;
    }
    reportFallback(why);
    std::vector<CefString> accept_filters;
    for (const auto& filter : cefAcceptFilters(request)) {
        accept_filters.emplace_back(filter);
    }
    std::string start = request.folder;
    if (request.mode == FileDialogMode::kSave) {
        const SavePlace target = savePlace(request);
        start = mfbe::platform::utf8_from_path(mfbe::platform::path_from_utf8(target.folder) /
                                               mfbe::platform::path_from_utf8(target.name));
    }
    host->RunFileDialog(toCefMode(request.mode), request.title, start, accept_filters,
                        new FileDialogCallbackImpl(completion));
}

// --- message box --------------------------------------------------------------------------

constexpr std::string_view kResultTitlePrefix = "mfbe-result:";

std::string htmlEscape(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    for (const char c : text) {
        switch (c) {
            case '&':
                out += "&amp;";
                break;
            case '<':
                out += "&lt;";
                break;
            case '>':
                out += "&gt;";
                break;
            case '"':
                out += "&quot;";
                break;
            case '\'':
                out += "&#39;";
                break;
            default:
                out += c;
        }
    }
    return out;
}

// English fallback labels; the core/UI normally supplies localised labels ("id|label").
std::string defaultButtonLabel(std::string_view id) {
    if (id == "ok") {
        return "OK";
    }
    if (id == "cancel") {
        return "Cancel";
    }
    if (id == "yes") {
        return "Yes";
    }
    if (id == "no") {
        return "No";
    }
    if (id == "abort") {
        return "Abort";
    }
    if (id == "retry") {
        return "Retry";
    }
    if (id == "ignore") {
        return "Ignore";
    }
    if (id == "close") {
        return "Close";
    }
    return std::string(id);
}

std::string messageBoxHtml(const MessageRequest& request) {
    std::string html;
    html += "<!doctype html><html><head><meta charset=\"utf-8\"><title>";
    html += htmlEscape(request.caption);
    html +=
        "</title><style>"
        "html,body{height:100%;margin:0}"
        "body{box-sizing:border-box;display:flex;flex-direction:column;padding:18px 20px;"
        "font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;"
        "background:#f5f5f5;color:#1e1e1e}"
        "p{flex:1;margin:0 0 16px;white-space:pre-wrap;word-wrap:break-word;overflow:auto}"
        ".buttons{display:flex;justify-content:flex-end;gap:8px}"
        "button{min-width:88px;padding:6px 14px;font:inherit}"
        "</style></head><body>";
    html += "<p id=\"message\">" + htmlEscape(request.text) + "</p><div class=\"buttons\">";
    bool first = true;
    for (const auto& button : request.buttons) {
        // "id" or "id|Localised label".
        std::string id = button;
        std::string label;
        if (const auto bar = button.find('|'); bar != std::string::npos) {
            id = button.substr(0, bar);
            label = button.substr(bar + 1);
        }
        if (label.empty()) {
            label = defaultButtonLabel(id);
        }
        html += "<button data-testid=\"msgbox-" + htmlEscape(id) + "\"";
        if (first) {
            html += " autofocus";
            first = false;
        }
        html += " onclick=\"document.title='" + std::string(kResultTitlePrefix) + htmlEscape(id) +
                "'\">" + htmlEscape(label) + "</button>";
    }
    html += "</div></body></html>";
    return html;
}

std::string dataUri(const std::string& data, const std::string& mime_type) {
    return "data:" + mime_type + ";base64," +
           CefURIEncode(CefBase64Encode(data.data(), data.size()), false).ToString();
}

// Browser client of the message box page: reports button presses (title changes) and keeps
// the page from navigating anywhere.
class MessageBoxClient : public CefClient,
                         public CefDisplayHandler,
                         public CefLifeSpanHandler,
                         public CefRequestHandler {
public:
    explicit MessageBoxClient(std::shared_ptr<MessageCompletion> completion)
        : completion_(std::move(completion)) {}

    MessageBoxClient(const MessageBoxClient&) = delete;
    MessageBoxClient& operator=(const MessageBoxClient&) = delete;

    CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
    CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
    CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }

    void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override {
        CEF_REQUIRE_UI_THREAD();
        const std::string value = title.ToString();
        if (value.size() < kResultTitlePrefix.size() ||
            value.compare(0, kResultTitlePrefix.size(), kResultTitlePrefix) != 0) {
            return;
        }
        completion_->finish(MessageResult{value.substr(kResultTitlePrefix.size())});
        if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
            if (auto window = browser_view->GetWindow()) {
                window->Close();
                return;
            }
        }
        browser->GetHost()->CloseBrowser(true);
    }

    bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefRequest> request, bool user_gesture,
                        bool is_redirect) override {
        const std::string url = request->GetURL().ToString();
        return url.rfind("data:", 0) != 0;  // cancel everything but the generated page
    }

    bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id,
                       const CefString& target_url, const CefString& target_frame_name,
                       cef_window_open_disposition_t target_disposition, bool user_gesture,
                       const CefPopupFeatures& popup_features, CefWindowInfo& window_info,
                       CefRefPtr<CefClient>& client, CefBrowserSettings& settings,
                       CefRefPtr<CefDictionaryValue>& extra_info,
                       bool* no_javascript_access) override {
        return true;  // no popups from a message box
    }

    void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
        CEF_REQUIRE_UI_THREAD();
        completion_->finish(MessageResult{});  // no-op when a button already answered
    }

private:
    std::shared_ptr<MessageCompletion> completion_;

    IMPLEMENT_REFCOUNTING(MessageBoxClient);
};

class MessageBoxBrowserViewDelegate : public CefBrowserViewDelegate {
public:
    MessageBoxBrowserViewDelegate() = default;
    MessageBoxBrowserViewDelegate(const MessageBoxBrowserViewDelegate&) = delete;
    MessageBoxBrowserViewDelegate& operator=(const MessageBoxBrowserViewDelegate&) = delete;

    ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView> browser_view) override {
        return CEF_CTT_NONE;
    }

private:
    IMPLEMENT_REFCOUNTING(MessageBoxBrowserViewDelegate);
};

class MessageBoxWindowDelegate : public CefWindowDelegate {
public:
    MessageBoxWindowDelegate(CefRefPtr<CefBrowserView> browser_view,
                             CefRefPtr<CefWindow> parent_window, std::string caption,
                             std::shared_ptr<MessageCompletion> completion)
        : browser_view_(std::move(browser_view)),
          parent_window_(std::move(parent_window)),
          caption_(std::move(caption)),
          completion_(std::move(completion)) {}

    MessageBoxWindowDelegate(const MessageBoxWindowDelegate&) = delete;
    MessageBoxWindowDelegate& operator=(const MessageBoxWindowDelegate&) = delete;

    void OnWindowCreated(CefRefPtr<CefWindow> window) override {
        window->AddChildView(browser_view_);
        window->SetTitle(caption_);
        window->CenterWindow(CefSize(460, 200));
        window->Show();
        if (browser_view_) {
            browser_view_->RequestFocus();
        }
    }

    void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
        browser_view_ = nullptr;
        parent_window_ = nullptr;
        completion_->finish(MessageResult{});  // closed without a choice (no-op if answered)
    }

    CefRefPtr<CefWindow> GetParentWindow(CefRefPtr<CefWindow> window, bool* is_menu,
                                         bool* can_activate_menu) override {
        return parent_window_;
    }

    bool IsWindowModalDialog(CefRefPtr<CefWindow> window) override {
        return parent_window_ != nullptr;
    }

    CefSize GetPreferredSize(CefRefPtr<CefView> view) override { return CefSize(460, 200); }
    bool CanResize(CefRefPtr<CefWindow> window) override { return false; }
    bool CanMaximize(CefRefPtr<CefWindow> window) override { return false; }
    bool CanMinimize(CefRefPtr<CefWindow> window) override { return false; }

    bool CanClose(CefRefPtr<CefWindow> window) override {
        if (browser_view_) {
            if (CefRefPtr<CefBrowser> browser = browser_view_->GetBrowser()) {
                return browser->GetHost()->TryCloseBrowser();
            }
        }
        return true;
    }

private:
    CefRefPtr<CefBrowserView> browser_view_;
    CefRefPtr<CefWindow> parent_window_;
    const std::string caption_;
    std::shared_ptr<MessageCompletion> completion_;

    IMPLEMENT_REFCOUNTING(MessageBoxWindowDelegate);
};

void showMessageOnUiThread(CefRefPtr<CefBrowser> owner, MessageRequest request,
                           std::shared_ptr<MessageCompletion> completion) {
    CEF_REQUIRE_UI_THREAD();
    CefRefPtr<CefWindow> parent_window;
    if (owner) {
        if (auto owner_view = CefBrowserView::GetForBrowser(owner)) {
            parent_window = owner_view->GetWindow();
        }
    }
    if (request.buttons.empty()) {
        request.buttons.emplace_back("ok");
    }

    CefBrowserSettings settings;
    CefRefPtr<CefBrowserView> browser_view = CefBrowserView::CreateBrowserView(
        new MessageBoxClient(completion), dataUri(messageBoxHtml(request), "text/html"), settings,
        nullptr, nullptr, new MessageBoxBrowserViewDelegate());
    if (!browser_view) {
        completion->finish(MessageResult{});
        return;
    }
    CefWindow::CreateTopLevelWindow(
        new MessageBoxWindowDelegate(browser_view, parent_window, request.caption, completion));
}

}  // namespace

// --- NativeDialogs ------------------------------------------------------------------------

NativeDialogs::NativeDialogs() = default;
NativeDialogs::~NativeDialogs() = default;

void NativeDialogs::setOwnerBrowser(CefRefPtr<CefBrowser> browser) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!owner_) {
        owner_ = std::move(browser);
    }
}

void NativeDialogs::clearOwnerBrowser(CefRefPtr<CefBrowser> browser) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (owner_ && browser && owner_->IsSame(browser)) {
        owner_ = nullptr;
    }
}

bool NativeDialogs::hasOwnerBrowser() {
    return ownerBrowser() != nullptr;
}

CefRefPtr<CefBrowser> NativeDialogs::ownerBrowser() {
    std::lock_guard<std::mutex> lock(mutex_);
    return owner_;
}

bool NativeDialogs::runFileDialog(const FileDialogRequest& request, FileDialogCallback done) {
    CefRefPtr<CefBrowser> owner = ownerBrowser();
    if (!owner || !done) {
        return false;
    }
    auto completion = std::make_shared<FileDialogCompletion>(std::move(done));
    return CefPostTask(TID_UI,
                       base::BindOnce(&runFileDialogOnUiThread, owner, request, completion));
}

bool NativeDialogs::showMessage(const MessageRequest& request, MessageCallback done) {
    if (!done) {
        return false;
    }
    auto completion = std::make_shared<MessageCompletion>(std::move(done));
    return CefPostTask(TID_UI,
                       base::BindOnce(&showMessageOnUiThread, ownerBrowser(), request, completion));
}

FileDialogResult NativeDialogs::runFileDialogAndWait(const FileDialogRequest& request) {
    if (CefCurrentlyOn(TID_UI)) {
        LOG(ERROR) << "NativeDialogs::runFileDialogAndWait on the UI thread; refusing to block";
        return FileDialogResult{};
    }
    Waiter<FileDialogResult> waiter;
    if (!runFileDialog(request, waiter.callback())) {
        return FileDialogResult{};
    }
    return waiter.wait();
}

MessageResult NativeDialogs::showMessageAndWait(const MessageRequest& request) {
    if (CefCurrentlyOn(TID_UI)) {
        LOG(ERROR) << "NativeDialogs::showMessageAndWait on the UI thread; refusing to block";
        return MessageResult{};
    }
    Waiter<MessageResult> waiter;
    if (!showMessage(request, waiter.callback())) {
        return MessageResult{};
    }
    return waiter.wait();
}

void NativeDialogs::setLanguage(std::string language) {
    std::lock_guard<std::mutex> lock(mutex_);
    language_ = std::move(language);
}

std::string NativeDialogs::language() {
    std::lock_guard<std::mutex> lock(mutex_);
    return language_;
}

// --- core adapter -------------------------------------------------------------------------

#if defined(MFBE_SHELL_HAS_CORE_DIALOGS)

namespace {

// Implements the core's asynchronous DialogProvider (core/include/mfbe/dialog_provider.hpp)
// on top of NativeDialogs: each call posts the dialog to the CEF UI thread and invokes the
// core's callback exactly once from there (the core marshals the result to its own thread).
// When no shell window exists the call throws mfbe::DialogUnavailable so the RPC fails with
// 1050 `dialog.unavailable` instead of hanging.
class ShellDialogProvider final : public mfbe::DialogProvider {
public:
    explicit ShellDialogProvider(std::shared_ptr<NativeDialogs> dialogs)
        : dialogs_(std::move(dialogs)) {}

    void open_file(const mfbe::OpenFileRequest& request,
                   Callback<mfbe::OpenFileResult> done) override {
        FileDialogRequest native;
        native.mode = request.multiple ? FileDialogMode::kOpenMultiple : FileDialogMode::kOpen;
        native.title = request.title;
        native.filters = toShellFilters(request.filters);
        native.selected_filter = request.selectedFilter;
        native.folder = request.folder.value_or(std::string());
        native.document_dialog = request.documentDialog;
        const bool posted = dialogs_->runFileDialog(native, [done](FileDialogResult result) {
            mfbe::OpenFileResult out;
            out.paths = std::move(result.paths);
            done(std::move(out));
        });
        if (!posted) {
            throw mfbe::DialogUnavailable("no shell window to own the file dialog");
        }
    }

    void save_file(const mfbe::SaveFileRequest& request,
                   Callback<mfbe::SaveFileResult> done) override {
        FileDialogRequest native;
        native.mode = FileDialogMode::kSave;
        native.title = request.title;
        native.default_path = request.defaultPath.value_or(std::string());
        native.folder = request.folder.value_or(std::string());
        native.filters = toShellFilters(request.filters);
        native.selected_filter = request.selectedFilter;
        native.encodings = request.encodingChoices;
        native.encoding_label = encodingLabel(dialogs_->language());
        native.document_dialog = request.documentDialog;
        const bool posted = dialogs_->runFileDialog(native, [done](FileDialogResult result) {
            mfbe::SaveFileResult out;
            if (!result.cancelled && !result.paths.empty()) {
                out.path = result.paths.front();
                if (!result.encoding.empty()) {
                    out.encoding = std::move(result.encoding);
                }
            }
            done(std::move(out));
        });
        if (!posted) {
            throw mfbe::DialogUnavailable("no shell window to own the save dialog");
        }
    }

    void pick_folder(const mfbe::PickFolderRequest& request,
                     Callback<mfbe::PickFolderResult> done) override {
        FileDialogRequest native;
        native.mode = FileDialogMode::kFolder;
        native.title = request.title;
        const bool posted = dialogs_->runFileDialog(native, [done](FileDialogResult result) {
            mfbe::PickFolderResult out;
            if (!result.cancelled && !result.paths.empty()) {
                out.path = result.paths.front();
            }
            done(std::move(out));
        });
        if (!posted) {
            throw mfbe::DialogUnavailable("no shell window to own the folder dialog");
        }
    }

    void message(const mfbe::MessageRequest& request, Callback<mfbe::MessageResult> done) override {
        MessageRequest native;
        native.caption = request.caption;
        native.text = request.text;
        // The wire format carries button labels ("OK", "Cancel", "Да" ...) and expects the
        // pressed label back: use the label as id and label.
        for (const auto& label : request.buttons) {
            native.buttons.push_back(label + "|" + label);
        }
        const bool posted = dialogs_->showMessage(native, [done](MessageResult result) {
            mfbe::MessageResult out;
            out.button = std::move(result.button);
            done(std::move(out));
        });
        if (!posted) {
            throw mfbe::DialogUnavailable("the shell message loop is not running");
        }
    }

    // app.openLogFolder / app.openFolder / resources.open*Folder: show the folder in the OS
    // file manager. Returning false lets the core try its own opener as a fallback.
    bool open_path(const std::string& path) override { return openFolderInFileManager(path); }

private:
    static std::vector<FileFilter> toShellFilters(const std::vector<mfbe::FileFilter>& filters) {
        std::vector<FileFilter> out;
        out.reserve(filters.size());
        for (const auto& filter : filters) {
            out.push_back(FileFilter{filter.name, filter.extensions});
        }
        return out;
    }

    std::shared_ptr<NativeDialogs> dialogs_;
};

}  // namespace

std::shared_ptr<mfbe::DialogProvider> makeCoreDialogProvider(
    std::shared_ptr<NativeDialogs> dialogs) {
    if (!dialogs) {
        return nullptr;
    }
    return std::make_shared<ShellDialogProvider>(std::move(dialogs));
}

#else  // !MFBE_SHELL_HAS_CORE_DIALOGS

std::shared_ptr<mfbe::DialogProvider> makeCoreDialogProvider(
    std::shared_ptr<NativeDialogs> /*dialogs*/) {
    return nullptr;  // built without the core: dialog.* RPCs answer dialog.unavailable
}

#endif  // MFBE_SHELL_HAS_CORE_DIALOGS

}  // namespace mfbe::shell
