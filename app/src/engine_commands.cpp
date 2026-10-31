#include "engine_commands.h"

#include <algorithm>
#include <utility>

namespace mfbe::shell {

namespace {

bool contains(const std::vector<std::string_view>& list, std::string_view name) {
    return std::find(list.begin(), list.end(), name) != list.end();
}

bool startsWith(std::string_view text, std::string_view prefix) {
    return text.substr(0, prefix.size()) == prefix;
}

}  // namespace

const std::vector<std::string_view>& EngineCommandPolicy::allowed() {
    static const std::vector<std::string_view> names = {
        // Zoom: the whole window's view (research D3).
        "IDC_ZOOM_PLUS",
        "IDC_ZOOM_MINUS",
        "IDC_ZOOM_NORMAL",
        // Window management.
        "IDC_FULLSCREEN",
        "IDC_MINIMIZE_WINDOW",
        // The dedicated Cut, Copy and Paste keys of some keyboards: the focused field.
        "IDC_CUT",
        "IDC_COPY",
        "IDC_PASTE",
        // The text field's edit menu.
        "IDC_CONTENT_CONTEXT_UNDO",
        "IDC_CONTENT_CONTEXT_REDO",
        "IDC_CONTENT_CONTEXT_CUT",
        "IDC_CONTENT_CONTEXT_COPY",
        "IDC_CONTENT_CONTEXT_PASTE",
        "IDC_CONTENT_CONTEXT_PASTE_AND_MATCH_STYLE",
        "IDC_CONTENT_CONTEXT_DELETE",
        "IDC_CONTENT_CONTEXT_SELECTALL",
    };
    return names;
}

const std::vector<std::string_view>& EngineCommandPolicy::developerOnly() {
    static const std::vector<std::string_view> names = {
        "IDC_DEV_TOOLS",
        "IDC_DEV_TOOLS_CONSOLE",
        "IDC_DEV_TOOLS_INSPECT",
        "IDC_DEV_TOOLS_TOGGLE",
        "IDC_DEV_TOOLS_DEVICES",
        "IDC_CONTENT_CONTEXT_INSPECTELEMENT",
        "IDC_CONTENT_CONTEXT_INSPECTELEMENT_WITH_DEVTOOLS",
    };
    return names;
}

const std::vector<std::string_view>& EngineCommandPolicy::blocked() {
    static const std::vector<std::string_view> names = {
        // Page actions: they act on the editor's page, not the book.
        "IDC_SAVE_PAGE",
        "IDC_PRINT",
        "IDC_BASIC_PRINT",
        "IDC_VIEW_SOURCE",
        "IDC_OPEN_FILE",
        "IDC_STOP",
        "IDC_HELP_PAGE_VIA_KEYBOARD",
        // Find: the editor has its own.
        "IDC_FIND",
        "IDC_FIND_NEXT",
        "IDC_FIND_PREVIOUS",
        "IDC_CLOSE_FIND_OR_STOP",
        // Caret browsing: F7 is the editor's spell check.
        "IDC_CARET_BROWSING_TOGGLE",
        // Navigation: data loss (research R1.1).
        "IDC_BACK",
        "IDC_FORWARD",
        "IDC_HOME",
        "IDC_RELOAD",
        "IDC_RELOAD_BYPASSING_CACHE",
        "IDC_RELOAD_CLEARING_CACHE",
        // Windows and tabs: Close and Exit would bypass the close question (FR-005).
        "IDC_NEW_WINDOW",
        "IDC_NEW_TAB",
        "IDC_NEW_TAB_TO_RIGHT",
        "IDC_NEW_SPLIT_TAB",
        "IDC_NEW_INCOGNITO_WINDOW",
        "IDC_CLOSE_TAB",
        "IDC_CLOSE_WINDOW",
        "IDC_EXIT",
        "IDC_RESTORE_TAB",
        "IDC_SELECT_NEXT_TAB",
        "IDC_SELECT_PREVIOUS_TAB",
        "IDC_SELECT_TAB_0",
        "IDC_SELECT_TAB_1",
        "IDC_SELECT_TAB_2",
        "IDC_SELECT_TAB_3",
        "IDC_SELECT_TAB_4",
        "IDC_SELECT_TAB_5",
        "IDC_SELECT_TAB_6",
        "IDC_SELECT_TAB_7",
        "IDC_SELECT_LAST_TAB",
        "IDC_MOVE_TAB_NEXT",
        "IDC_MOVE_TAB_PREVIOUS",
        "IDC_MOVE_TAB_TO_NEW_WINDOW",
        "IDC_CREATE_NEW_TAB_GROUP",
        "IDC_CREATE_NEW_TAB_GROUP_TOP_LEVEL",
        "IDC_CLOSE_TAB_GROUP",
        "IDC_GROUP_UNGROUPED_TABS",
        "IDC_GROUP_TARGET_TAB",
        "IDC_WINDOW_GROUP_TAB",
        "IDC_FOCUS_NEXT_TAB_GROUP",
        "IDC_FOCUS_PREV_TAB_GROUP",
        "IDC_UNFOCUS_TAB_GROUP",
        // The browser's interface: no meaning in the editor.
        "IDC_SHOW_HISTORY",
        "IDC_SHOW_DOWNLOADS",
        "IDC_SHOW_BOOKMARK_BAR",
        "IDC_SHOW_BOOKMARK_MANAGER",
        "IDC_BOOKMARK_THIS_TAB",
        "IDC_BOOKMARK_ALL_TABS",
        "IDC_CLEAR_BROWSING_DATA",
        "IDC_TASK_MANAGER",
        "IDC_TASK_MANAGER_APP_MENU",
        "IDC_TASK_MANAGER_SHORTCUT",
        "IDC_TASK_MANAGER_CONTEXT_MENU",
        "IDC_TASK_MANAGER_MAIN_MENU",
        "IDC_SHOW_APP_MENU",
        "IDC_SHOW_AVATAR_MENU",
        "IDC_TAB_SEARCH",
        "IDC_FEEDBACK",
        "IDC_SHOW_READING_MODE_KEYBOARD",
        "IDC_TOGGLE_MULTITASK_MENU",
        // Focus: the window has no toolbar, address bar or tab strip; F10 is the editor's.
        "IDC_FOCUS_TOOLBAR",
        "IDC_FOCUS_LOCATION",
        "IDC_FOCUS_SEARCH",
        "IDC_FOCUS_BOOKMARKS",
        "IDC_FOCUS_MENU_BAR",
        "IDC_FOCUS_NEXT_PANE",
        "IDC_FOCUS_PREVIOUS_PANE",
        "IDC_FOCUS_WEB_CONTENTS_PANE",
        "IDC_FOCUS_INACTIVE_POPUP_FOR_ACCESSIBILITY",
        "IDC_FOCUS_THIS_TAB",
        // Chromium's debugging aids.
        "IDC_DEBUG_TOGGLE_TABLET_MODE",
        "IDC_DEBUG_PRINT_VIEW_TREE",
        "IDC_DEBUG_PRINT_VIEW_TREE_DETAILS",
    };
    return names;
}

EngineDecision EngineCommandPolicy::decide(std::string_view name, bool developer_run) {
    if (contains(allowed(), name)) {
        return EngineDecision::Allow;
    }
    if (developer_run && contains(developerOnly(), name)) {
        return EngineDecision::Allow;
    }
    return EngineDecision::Block;  // deny by default, unknown commands included
}

EngineCommandNames::EngineCommandNames(const std::function<int(const char*)>& resolve) {
    for (const auto* list : {&EngineCommandPolicy::allowed(), &EngineCommandPolicy::developerOnly(),
                             &EngineCommandPolicy::blocked()}) {
        for (const std::string_view name : *list) {
            // The lists hold string literals, so data() is NUL-terminated.
            const int id = resolve(name.data());
            if (id >= 0) {
                names_.emplace(id, name);
            }
        }
    }
}

std::string_view EngineCommandNames::nameOf(int id) const {
    const auto it = names_.find(id);
    return it == names_.end() ? std::string_view{} : it->second;
}

std::string EngineCommandNames::label(int id) const {
    const std::string_view name = nameOf(id);
    return name.empty() ? "#" + std::to_string(id) : std::string(name);
}

EngineDecision EngineCommandNames::decide(int id, bool developer_run) const {
    return EngineCommandPolicy::decide(nameOf(id), developer_run);
}

std::string EngineCommandNames::logLine(int id, EngineDecision decision) const {
    return "shelltest: chrome-command " + label(id) +
           (decision == EngineDecision::Allow ? " allowed" : " blocked");
}

NavigationGuard::NavigationGuard(std::string app_origin) : app_origin_(std::move(app_origin)) {}

bool NavigationGuard::isAppUrl(std::string_view url) const {
    if (app_origin_.empty() || !startsWith(url, app_origin_)) {
        return false;
    }
    if (url.size() == app_origin_.size()) {
        return true;
    }
    const char next = url[app_origin_.size()];
    return next == '/' || next == '?' || next == '#';
}

bool NavigationGuard::isAllowedUrl(std::string_view url) const {
    return url.empty() || startsWith(url, "about:") || startsWith(url, "data:") ||
           startsWith(url, "devtools:") || startsWith(url, "chrome-devtools:") || isAppUrl(url);
}

void NavigationGuard::mainFrameCommitted(int browser_id, std::string_view url) {
    if (isAppUrl(url)) {
        loaded_.insert(browser_id);
    }
}

bool NavigationGuard::loaded(int browser_id) const {
    return loaded_.count(browser_id) != 0;
}

void NavigationGuard::browserClosed(int browser_id) {
    loaded_.erase(browser_id);
}

NavigationVerdict NavigationGuard::decide(int browser_id, const NavigationRequest& request) const {
    const bool allowed = isAllowedUrl(request.url);
    if (request.main_frame && loaded(browser_id)) {
        // The page is loaded once: nothing replaces it. An external address the user asked
        // for still opens in the system browser.
        if (!allowed && request.user_gesture) {
            return NavigationVerdict::OpenExternally;
        }
        return NavigationVerdict::Refuse;
    }
    if (allowed) {
        return NavigationVerdict::Allow;
    }
    return request.user_gesture ? NavigationVerdict::OpenExternally : NavigationVerdict::Refuse;
}

std::string NavigationGuard::transitionLabel(std::uint32_t transition) {
    if ((transition & kTransitionForwardBackFlag) != 0) {
        return "back-forward";
    }
    switch (transition & kTransitionSourceMask) {
        case kTransitionLink:
            return "link";
        case kTransitionExplicit:
            return "explicit";
        case kTransitionAutoSubframe:
            return "auto-subframe";
        case kTransitionManualSubframe:
            return "manual-subframe";
        case kTransitionAutoToplevel:
            return "auto-toplevel";
        case kTransitionFormSubmit:
            return "form-submit";
        case kTransitionReload:
            return "reload";
        default:
            return "#" + std::to_string(transition & kTransitionSourceMask);
    }
}

std::string NavigationGuard::urlOrigin(std::string_view url) {
    const std::size_t colon = url.find(':');
    if (colon == std::string_view::npos) {
        return std::string();
    }
    if (url.substr(colon, 3) != "://") {
        return std::string(url.substr(0, colon + 1));
    }
    const std::size_t end = url.find_first_of("/?#", colon + 3);
    return std::string(url.substr(0, end));
}

std::string NavigationGuard::logLine(const NavigationRequest& request) {
    return "shelltest: navigation-refused " + transitionLabel(request.transition) + " " +
           urlOrigin(request.url);
}

}  // namespace mfbe::shell
