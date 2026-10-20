#include "mfbe_client.h"

#include "context_menu.h"
#include "dialog_provider.h"
#include "include/base/cef_callback.h"
#include "include/base/cef_logging.h"
#include "include/cef_app.h"
#include "include/cef_drag_data.h"
#include "include/cef_parser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "native_actions.h"
#include "permission_policy.h"

#include <string>
#include <utility>

namespace mfbe::shell {

namespace {

MfbeClient* g_instance = nullptr;

constexpr int kVkF12 = 0x7B;

// Command ids of the edit menu (context_menu.h): one per EditCommand, in the user range.
constexpr int kEditCommandFirstId = MENU_ID_USER_FIRST;

bool startsWith(const std::string& text, const char* prefix) {
    return text.rfind(prefix, 0) == 0;
}

std::string htmlEscape(const std::string& text) {
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
            default:
                out += c;
        }
    }
    return out;
}

// Returns a data: URI with the specified contents.
std::string dataUri(const std::string& data, const std::string& mime_type) {
    return "data:" + mime_type + ";base64," +
           CefURIEncode(CefBase64Encode(data.data(), data.size()), false).ToString();
}

}  // namespace

MfbeClient::MfbeClient(Config config, std::shared_ptr<NativeDialogs> dialogs)
    : config_(std::move(config)), dialogs_(std::move(dialogs)) {
    DCHECK(!g_instance);
    g_instance = this;
}

MfbeClient::~MfbeClient() {
    g_instance = nullptr;
}

// static
MfbeClient* MfbeClient::GetInstance() {
    return g_instance;
}

void MfbeClient::OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) {
    CEF_REQUIRE_UI_THREAD();
    const std::string value = title.ToString();
    if (value.empty() || startsWith(value, "data:") ||
        startsWith(value, config_.app_origin.c_str())) {
        return;  // keep the product name while the page has no real title
    }
    if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
        if (CefRefPtr<CefWindow> window = browser_view->GetWindow()) {
            window->SetTitle(title);
        }
    }
}

bool MfbeClient::OnDragEnter(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDragData> dragData,
                             DragOperationsMask mask) {
    CEF_REQUIRE_UI_THREAD();
    if (!dragData || !dragData->IsFile()) {
        return false;  // text/links: default handling by the page
    }
    std::vector<CefString> entries;
    if (!dragData->GetFilePaths(entries) || entries.empty()) {
        dragData->GetFileNames(entries);
    }
    std::vector<std::string> documents;
    for (const auto& entry : entries) {
        const std::string path = entry.ToString();
        if (!path.empty() && isDocumentPath(path)) {
            documents.push_back(path);
        }
    }
    if (documents.empty() || documents.size() != entries.size()) {
        // Images (and mixed selections) are left to the page's HTML5 drop handling.
        return false;
    }
    // CEF reports external drags when they enter the browser view and has no drop callback
    // for windowed browsers, so documents are opened at this point (the editor asks about
    // unsaved changes first) and the drag itself is cancelled.
    if (config_.open_paths) {
        config_.open_paths(documents);
    }
    return true;
}

bool MfbeClient::OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                               int popup_id, const CefString& target_url,
                               const CefString& target_frame_name,
                               cef_window_open_disposition_t target_disposition, bool user_gesture,
                               const CefPopupFeatures& popup_features, CefWindowInfo& window_info,
                               CefRefPtr<CefClient>& client, CefBrowserSettings& settings,
                               CefRefPtr<CefDictionaryValue>& extra_info,
                               bool* no_javascript_access) {
    CEF_REQUIRE_UI_THREAD();
    // The editor has exactly one document window per process; window.open / target=_blank
    // links go to the OS browser instead of a popup.
    OpenExternal(target_url.ToString());
    return true;
}

void MfbeClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
    CEF_REQUIRE_UI_THREAD();
    browser_list_.push_back(browser);
    if (dialogs_) {
        dialogs_->setOwnerBrowser(browser);  // first browser = main window
    }
}

bool MfbeClient::DoClose(CefRefPtr<CefBrowser> browser) {
    CEF_REQUIRE_UI_THREAD();
    // Alloy style only: CEF does not call DoClose for the Chrome style browsers of this shell
    // (include/cef_life_span_handler.h), so the main window's close is offered to the UI from
    // MainWindowDelegate::CanClose through OfferCloseToUi() instead. Here the cefclient default:
    // closing the last browser ends the application.
    if (browser_list_.size() == 1) {
        is_closing_ = true;
    }
    // Allow the close. For windowed browsers this will result in the OS close event being sent.
    return false;
}

bool MfbeClient::OfferCloseToUi() {
    CEF_REQUIRE_UI_THREAD();
    if (!config_.request_close) {
        return true;  // no core, nobody to ask: the window closes as it always did
    }
    // The main window closes only with the UI's agreement (feature 003 FR-013 / FR-017): the
    // request is handed to the UI, whose quit flow - the cancel-script prompt while a script
    // runs, then the save prompt - ends in app.quit; the core stops, CloseAllBrowsers(true)
    // follows and the handshake lets that close through.
    switch (close_handshake_.onCloseRequested()) {
        case CloseHandshake::Action::kAsk:
            AskUiToClose(close_handshake_.ticket());
            return false;  // the UI (or the timeout) decides
        case CloseHandshake::Action::kAllow:
            break;
    }
    return true;
}

void MfbeClient::AskUiToClose(unsigned ticket) {
    CEF_REQUIRE_UI_THREAD();
    CefPostDelayedTask(TID_UI, base::BindOnce(&MfbeClient::OnCloseAnswerTimeout, this, ticket),
                       CloseHandshake::kAnswerTimeout.count());
    // The callback may arrive on a core thread, or synchronously when the core is not running;
    // either way the answer is handled in a task of its own, never inside DoClose.
    config_.request_close([this, ticket](bool delivered) {
        CefPostTask(TID_UI,
                    base::BindOnce(&MfbeClient::OnCloseRequestDelivered, this, ticket, delivered));
    });
}

void MfbeClient::OnCloseRequestDelivered(unsigned ticket, bool delivered) {
    CEF_REQUIRE_UI_THREAD();
    if (delivered) {
        return;  // the UI runs its quit flow; app.quit or the timeout ends the handshake
    }
    if (close_handshake_.onUndelivered(ticket)) {
        ForceCloseMainBrowser();
    }
}

void MfbeClient::OnCloseAnswerTimeout(unsigned ticket) {
    CEF_REQUIRE_UI_THREAD();
    if (!close_handshake_.isAsking(ticket)) {
        return;  // answered (app.quit) or superseded meanwhile
    }
    // No app.quit within the timeout: a UI that is still connected declined (or still shows
    // its prompt) and keeps the window; a UI that is gone cannot answer and the window closes.
    if (!config_.query_ui_connected) {
        OnCloseUiQueried(ticket, false);
        return;
    }
    config_.query_ui_connected([this, ticket](bool connected) {
        CefPostTask(TID_UI, base::BindOnce(&MfbeClient::OnCloseUiQueried, this, ticket, connected));
    });
}

void MfbeClient::OnCloseUiQueried(unsigned ticket, bool connected) {
    CEF_REQUIRE_UI_THREAD();
    if (close_handshake_.onTimeout(ticket, connected)) {
        LOG(WARNING) << "mfbe: the UI did not answer the close request; closing the window";
        ForceCloseMainBrowser();
    }
}

void MfbeClient::ForceCloseMainBrowser() {
    CEF_REQUIRE_UI_THREAD();
    if (browser_list_.empty()) {
        return;
    }
    browser_list_.front()->GetHost()->CloseBrowser(true);
}

void MfbeClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
    CEF_REQUIRE_UI_THREAD();
    if (dialogs_) {
        dialogs_->clearOwnerBrowser(browser);
    }
    // The main window (the first browser) is going: the application is closing.
    if (!browser_list_.empty() && browser->IsSame(browser_list_.front())) {
        is_closing_ = true;
    }
    for (auto it = browser_list_.begin(); it != browser_list_.end(); ++it) {
        if ((*it)->IsSame(browser)) {
            browser_list_.erase(it);
            break;
        }
    }
    if (browser_list_.empty()) {
        // All browser windows have closed. Quit the application message loop.
        CefQuitMessageLoop();
    }
}

void MfbeClient::OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                             ErrorCode error_code, const CefString& error_text,
                             const CefString& failed_url) {
    CEF_REQUIRE_UI_THREAD();
    // Don't display an error for downloaded files or cancelled navigations.
    if (error_code == ERR_ABORTED || !frame->IsMain()) {
        return;
    }
    const std::string url = failed_url.ToString();
    std::string html =
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>" MFBE_PRODUCT_NAME
        "</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:48px 56px;"
        "color:#1e1e1e;background:#fafafa}h1{font-size:20px;margin:0 0 12px}code{font-size:13px}"
        "p{margin:8px 0}</style></head><body data-testid=\"shell-load-error\">"
        "<h1>The editor interface could not be loaded<br>"
        "Не удалось загрузить интерфейс редактора</h1>"
        "<p><code>" +
        htmlEscape(url) + "</code></p><p>" + htmlEscape(error_text.ToString()) + " (" +
        std::to_string(static_cast<int>(error_code)) + ")</p><p><a href=\"" + htmlEscape(url) +
        "\">Retry / Повторить</a></p></body></html>";
    frame->LoadURL(dataUri(html, "text/html"));
}

bool MfbeClient::IsAllowedUrl(const std::string& url) const {
    if (url.empty() || startsWith(url, "about:") || startsWith(url, "data:") ||
        startsWith(url, "devtools:") || startsWith(url, "chrome-devtools:")) {
        return true;
    }
    if (config_.app_origin.empty()) {
        return false;
    }
    if (url == config_.app_origin) {
        return true;
    }
    // origin + "/" or origin + "?" / "#"
    if (startsWith(url, config_.app_origin.c_str()) && url.size() > config_.app_origin.size()) {
        const char next = url[config_.app_origin.size()];
        return next == '/' || next == '?' || next == '#';
    }
    return false;
}

bool MfbeClient::OnShowPermissionPrompt(CefRefPtr<CefBrowser> /*browser*/, uint64_t /*prompt_id*/,
                                        const CefString& requesting_origin,
                                        uint32_t requested_permissions,
                                        CefRefPtr<CefPermissionPromptCallback> callback) {
    const bool clipboard_only = requested_permissions == CEF_PERMISSION_TYPE_CLIPBOARD;
    callback->Continue(
        allowPermission(requesting_origin.ToString(), config_.app_origin, clipboard_only)
            ? CEF_PERMISSION_RESULT_ACCEPT
            : CEF_PERMISSION_RESULT_DENY);
    return true;
}

bool MfbeClient::OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                CefRefPtr<CefRequest> request, bool user_gesture,
                                bool is_redirect) {
    CEF_REQUIRE_UI_THREAD();
    const std::string url = request->GetURL().ToString();
    if (IsAllowedUrl(url)) {
        return false;
    }
    // Anything else leaves the application: hand it to the OS and cancel the navigation.
    LOG(WARNING) << "mfbe: blocked navigation to " << url;
    if (user_gesture) {
        OpenExternal(url);
    }
    return true;
}

bool MfbeClient::OnOpenURLFromTab(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                  const CefString& target_url,
                                  cef_window_open_disposition_t target_disposition,
                                  bool user_gesture) {
    CEF_REQUIRE_UI_THREAD();
    const std::string url = target_url.ToString();
    if (IsAllowedUrl(url)) {
        return false;  // e.g. middle-click on an in-app link: let CEF handle it
    }
    OpenExternal(url);
    return true;
}

void MfbeClient::OnBeforeContextMenu(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>,
                                     CefRefPtr<CefContextMenuParams> params,
                                     CefRefPtr<CefMenuModel> model) {
    CEF_REQUIRE_UI_THREAD();
    const int flags = params->GetEditStateFlags();
    EditState state;
    state.editable = params->IsEditable();
    state.can_undo = (flags & CM_EDITFLAG_CAN_UNDO) != 0;
    state.can_cut = (flags & CM_EDITFLAG_CAN_CUT) != 0;
    state.can_copy = (flags & CM_EDITFLAG_CAN_COPY) != 0;
    state.can_paste = (flags & CM_EDITFLAG_CAN_PASTE) != 0;
    state.can_delete = (flags & CM_EDITFLAG_CAN_DELETE) != 0;
    state.can_select_all = (flags & CM_EDITFLAG_CAN_SELECT_ALL) != 0;
    // The browser's own menu goes entirely; an empty menu is not shown.
    model->Clear();
    const std::string language = dialogs_ ? dialogs_->language() : std::string();
    for (const ContextMenuItem& item : contextMenuItems(state)) {
        if (item.separator) {
            model->AddSeparator();
            continue;
        }
        const int id = kEditCommandFirstId + static_cast<int>(item.command);
        model->AddItem(id, contextMenuLabel(item.command, language));
        model->SetEnabled(id, item.enabled);
    }
}

bool MfbeClient::OnContextMenuCommand(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame,
                                      CefRefPtr<CefContextMenuParams>, int command_id, EventFlags) {
    CEF_REQUIRE_UI_THREAD();
    const int index = command_id - kEditCommandFirstId;
    if (index < 0 || index > static_cast<int>(EditCommand::SelectAll)) {
        return false;
    }
    switch (static_cast<EditCommand>(index)) {
        case EditCommand::Undo:
            frame->Undo();
            break;
        case EditCommand::Cut:
            frame->Cut();
            break;
        case EditCommand::Copy:
            frame->Copy();
            break;
        case EditCommand::Paste:
            frame->Paste();
            break;
        case EditCommand::Delete:
            frame->Delete();
            break;
        case EditCommand::SelectAll:
            frame->SelectAll();
            break;
    }
    return true;
}

bool MfbeClient::OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent& event,
                               CefEventHandle os_event, bool* is_keyboard_shortcut) {
    CEF_REQUIRE_UI_THREAD();
    if (config_.devtools_enabled && event.type == KEYEVENT_RAWKEYDOWN &&
        event.windows_key_code == kVkF12) {
        CefWindowInfo window_info;  // ignored: the browser is wrapped in a CefBrowserView
        CefBrowserSettings settings;
        browser->GetHost()->ShowDevTools(window_info, nullptr, settings, CefPoint());
        return true;
    }
    return false;
}

void MfbeClient::ShowMainWindow() {
    if (!CefCurrentlyOn(TID_UI)) {
        CefPostTask(TID_UI, base::BindOnce(&MfbeClient::ShowMainWindow, this));
        return;
    }
    if (browser_list_.empty()) {
        return;
    }
    if (auto browser_view = CefBrowserView::GetForBrowser(browser_list_.front())) {
        if (CefRefPtr<CefWindow> window = browser_view->GetWindow()) {
            window->Show();
            window->Activate();
        }
    }
}

void MfbeClient::CloseAllBrowsers(bool force_close) {
    if (!CefCurrentlyOn(TID_UI)) {
        CefPostTask(TID_UI, base::BindOnce(&MfbeClient::CloseAllBrowsers, this, force_close));
        return;
    }
    if (force_close) {
        // The decision was taken elsewhere (app.quit stopped the core, the OS quits the app):
        // the UI's quit flow is not asked for again.
        close_handshake_.allow();
    }
    // Copy: OnBeforeClose mutates browser_list_ while we iterate.
    const std::list<CefRefPtr<CefBrowser>> browsers = browser_list_;
    for (const auto& browser : browsers) {
        browser->GetHost()->CloseBrowser(force_close);
    }
}

void MfbeClient::OpenExternal(const std::string& url) {
    if (!openExternalUrl(url)) {
        LOG(WARNING) << "mfbe: refusing to open external URL " << url;
    }
}

}  // namespace mfbe::shell
