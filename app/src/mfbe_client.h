// CefClient of the shell: browser life span (quit when the last window closes), window title
// (mirrors document.title, e.g. "book.fb2* - Maxima Fiction Book Editor" with the modified
// marker set by the UI), inline load-error page, navigation policy (stay on the loopback
// origin, external links go to the OS browser), OS drag-and-drop of documents onto the
// window (opened through app.openPaths; images and other files reach the page as HTML5
// drops), the right-click menu (a text box's edit menu, nothing elsewhere: context_menu.h),
// permission requests (the clipboard for the editor's page, nothing else: permission_policy.h)
// and F12 -> DevTools in development builds.
#pragma once

#include "include/cef_client.h"

#include <functional>
#include <list>
#include <memory>
#include <string>
#include <vector>

namespace mfbe::shell {

class CoreHost;
class NativeDialogs;

class MfbeClient : public CefClient,
                   public CefContextMenuHandler,
                   public CefDisplayHandler,
                   public CefDragHandler,
                   public CefLifeSpanHandler,
                   public CefLoadHandler,
                   public CefPermissionHandler,
                   public CefRequestHandler,
                   public CefKeyboardHandler {
public:
    struct Config {
        std::string app_origin;         // "http://127.0.0.1:<port>" - the only navigable origin
        bool devtools_enabled = false;  // F12 opens DevTools
        // Receives the absolute paths of .fb2/.fbd/.xml files dragged onto the window.
        std::function<void(const std::vector<std::string>&)> open_paths;
    };

    MfbeClient(Config config, std::shared_ptr<NativeDialogs> dialogs);
    ~MfbeClient() override;

    MfbeClient(const MfbeClient&) = delete;
    MfbeClient& operator=(const MfbeClient&) = delete;

    // The single client instance (nullptr before creation / after destruction).
    static MfbeClient* GetInstance();

    // CefClient methods:
    CefRefPtr<CefContextMenuHandler> GetContextMenuHandler() override { return this; }
    CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
    CefRefPtr<CefDragHandler> GetDragHandler() override { return this; }
    CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
    CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
    CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }
    CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
    CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }

    // CefContextMenuHandler methods:
    void OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                             CefRefPtr<CefContextMenuParams> params,
                             CefRefPtr<CefMenuModel> model) override;
    bool OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                              CefRefPtr<CefContextMenuParams> params, int command_id,
                              EventFlags event_flags) override;

    // CefDisplayHandler methods:
    void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override;

    // CefDragHandler methods:
    bool OnDragEnter(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDragData> dragData,
                     DragOperationsMask mask) override;

    // CefLifeSpanHandler methods:
    bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id,
                       const CefString& target_url, const CefString& target_frame_name,
                       cef_window_open_disposition_t target_disposition, bool user_gesture,
                       const CefPopupFeatures& popup_features, CefWindowInfo& window_info,
                       CefRefPtr<CefClient>& client, CefBrowserSettings& settings,
                       CefRefPtr<CefDictionaryValue>& extra_info,
                       bool* no_javascript_access) override;
    void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
    bool DoClose(CefRefPtr<CefBrowser> browser) override;
    void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

    // CefLoadHandler methods:
    void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode error_code,
                     const CefString& error_text, const CefString& failed_url) override;

    // CefPermissionHandler methods:
    bool OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id,
                                const CefString& requesting_origin, uint32_t requested_permissions,
                                CefRefPtr<CefPermissionPromptCallback> callback) override;

    // CefRequestHandler methods:
    bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefRequest> request, bool user_gesture,
                        bool is_redirect) override;
    bool OnOpenURLFromTab(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                          const CefString& target_url,
                          cef_window_open_disposition_t target_disposition,
                          bool user_gesture) override;

    // CefKeyboardHandler methods:
    bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent& event,
                       CefEventHandle os_event, bool* is_keyboard_shortcut) override;

    // Brings the main window to the front (any thread).
    void ShowMainWindow();

    // Requests that all existing browser windows close (any thread).
    void CloseAllBrowsers(bool force_close);

    bool IsClosing() const { return is_closing_; }

    // True when `url` may be loaded in the shell window (loopback origin, about:/data:,
    // DevTools). Exposed for tests.
    bool IsAllowedUrl(const std::string& url) const;

private:
    void OpenExternal(const std::string& url);

    const Config config_;
    std::shared_ptr<NativeDialogs> dialogs_;

    // Existing browsers (main window + DevTools); only accessed on the CEF UI thread.
    std::list<CefRefPtr<CefBrowser>> browser_list_;
    bool is_closing_ = false;

    IMPLEMENT_REFCOUNTING(MfbeClient);
};

}  // namespace mfbe::shell
