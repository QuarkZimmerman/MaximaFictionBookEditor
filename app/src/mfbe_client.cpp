#include "mfbe_client.h"

#include "context_menu.h"
#include "dialog_provider.h"
#include "include/base/cef_callback.h"
#include "include/base/cef_logging.h"
#include "include/cef_app.h"
#include "include/cef_drag_data.h"
#include "include/cef_id_mappers.h"
#include "include/cef_parser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "native_actions.h"
#include "permission_policy.h"

#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>

namespace mfbe::shell {

namespace {

MfbeClient* g_instance = nullptr;

// engine_commands.h mirrors cef_transition_type_t without CEF types.
static_assert(kTransitionLink == static_cast<std::uint32_t>(TT_LINK));
static_assert(kTransitionExplicit == static_cast<std::uint32_t>(TT_EXPLICIT));
static_assert(kTransitionAutoSubframe == static_cast<std::uint32_t>(TT_AUTO_SUBFRAME));
static_assert(kTransitionManualSubframe == static_cast<std::uint32_t>(TT_MANUAL_SUBFRAME));
static_assert(kTransitionAutoToplevel == static_cast<std::uint32_t>(TT_AUTO_TOPLEVEL));
static_assert(kTransitionFormSubmit == static_cast<std::uint32_t>(TT_FORM_SUBMIT));
static_assert(kTransitionReload == static_cast<std::uint32_t>(TT_RELOAD));
static_assert(kTransitionSourceMask == static_cast<std::uint32_t>(TT_SOURCE_MASK));
static_assert(kTransitionForwardBackFlag == static_cast<std::uint32_t>(TT_FORWARD_BACK_FLAG));
static_assert(kTransitionFromApiFlag == static_cast<std::uint32_t>(TT_FROM_API_FLAG));

// Test-hook builds report the gate's and the guard's decisions on stderr for
// tools/shell-smoke.mjs (contracts/shell.md §3-§4 of feature 007); release builds say nothing,
// since a blocked command is not an error.
void testHookLine([[maybe_unused]] const std::string& line) {
#if defined(MFBE_SHELL_TEST_HOOKS)
    std::fprintf(stderr, "%s\n", line.c_str());
    std::fflush(stderr);
#endif
}

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
    : config_(std::move(config)),
      dialogs_(std::move(dialogs)),
      command_names_(cef_id_for_command_id_name),
      navigation_guard_(config_.app_origin) {
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
    testHookLine("before-popup " + target_url.ToString() +
                 " disposition=" + std::to_string(static_cast<int>(target_disposition)) +
                 " gesture=" + (user_gesture ? "1" : "0"));
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
    navigation_guard_.browserClosed(browser->GetIdentifier());
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

bool MfbeClient::OnChromeCommand(CefRefPtr<CefBrowser> /*browser*/, int command_id,
                                 cef_window_open_disposition_t /*disposition*/) {
    CEF_REQUIRE_UI_THREAD();
    // Every Chrome command - a key, a mouse button, a native or a context menu - passes the
    // gate: the editor's own commands live in its page, the engine's act on the page (Save
    // page, Print, Reload, Find, new windows, Close) and break the editor's paradigm.
    const EngineDecision decision = command_names_.decide(command_id, config_.devtools_enabled);
    testHookLine(command_names_.logLine(command_id, decision));
    return decision == EngineDecision::Block;  // true: handled, nothing happens
}

void MfbeClient::OnLoadStart(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                             TransitionType /*transition_type*/) {
    CEF_REQUIRE_UI_THREAD();
    // A committed main-frame load: the editor's address makes the page "loaded once".
    if (frame->IsMain()) {
        navigation_guard_.mainFrameCommitted(browser->GetIdentifier(), frame->GetURL().ToString());
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
    return navigation_guard_.isAllowedUrl(url);
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
    // The navigation guard (engine_commands.h): today's rule until the editor's page has
    // loaded, then no reload, back, forward or new address of the main frame.
    const NavigationRequest navigation{frame->IsMain(), request->GetURL().ToString(),
                                       static_cast<std::uint32_t>(request->GetTransitionType()),
                                       user_gesture};
    const NavigationVerdict verdict =
        navigation_guard_.decide(browser->GetIdentifier(), navigation);
    if (verdict == NavigationVerdict::Allow) {
        return false;
    }
    LOG(WARNING) << "mfbe: blocked navigation to " << navigation.url;
    testHookLine(NavigationGuard::logLine(navigation));
    if (verdict == NavigationVerdict::OpenExternally) {
        OpenExternal(navigation.url);  // an address outside the application, asked for
    }
    return true;
}

bool MfbeClient::OnOpenURLFromTab(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                  const CefString& target_url,
                                  cef_window_open_disposition_t target_disposition,
                                  bool user_gesture) {
    CEF_REQUIRE_UI_THREAD();
    // A link asked for in a new tab or window (middle-click, Ctrl+click, Shift+click): the
    // editor has one window, so nothing opens in the engine (FR-002); an address outside the
    // application goes to the system browser, as a plain click on it does.
    const std::string url = target_url.ToString();
    testHookLine("open-url-from-tab " + url +
                 " disposition=" + std::to_string(static_cast<int>(target_disposition)) +
                 " gesture=" + (user_gesture ? "1" : "0"));
    if (!IsAllowedUrl(url) && user_gesture) {
        OpenExternal(url);
    }
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
        // The page takes the keyboard, so the question that brought the window forward answers
        // Enter and Escape at once (feature 008).
        browser_list_.front()->GetHost()->SetFocus(true);
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
#ifdef MFBE_SHELL_TEST_HOOKS
    // A test-hook build reports the hand-over instead of starting the system browser (feature
    // 007, US5): the smoke checks that a link asked for in a new tab or window goes there, and
    // no browser opens on the test machine.
    testHookLine("open-external " + url);
#else
    if (!openExternalUrl(url)) {
        LOG(WARNING) << "mfbe: refusing to open external URL " << url;
    }
#endif
}

}  // namespace mfbe::shell
