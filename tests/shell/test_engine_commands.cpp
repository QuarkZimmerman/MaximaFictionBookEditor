// The browser engine's commands and the navigation guard (feature 007, contracts/shell.md §3-§5,
// data-model §1, research R1.4): every command of the R1.4 table in both kinds of run, deny by
// default for the rest and for unknown ids, the id map built from the running engine's names,
// and the guard's states - today's rule until the editor's page has loaded, then no
// cross-document navigation of the main frame at all.
#include "engine_commands.h"

#include <catch2/catch_test_macros.hpp>

#include <map>
#include <string>
#include <vector>

using namespace mfbe::shell;

namespace {

const std::vector<const char*> kAllowed = {
    "IDC_ZOOM_PLUS",
    "IDC_ZOOM_MINUS",
    "IDC_ZOOM_NORMAL",
    "IDC_FULLSCREEN",
    "IDC_MINIMIZE_WINDOW",
    "IDC_CUT",
    "IDC_COPY",
    "IDC_PASTE",
    "IDC_CONTENT_CONTEXT_UNDO",
    "IDC_CONTENT_CONTEXT_REDO",
    "IDC_CONTENT_CONTEXT_CUT",
    "IDC_CONTENT_CONTEXT_COPY",
    "IDC_CONTENT_CONTEXT_PASTE",
    "IDC_CONTENT_CONTEXT_PASTE_AND_MATCH_STYLE",
    "IDC_CONTENT_CONTEXT_DELETE",
    "IDC_CONTENT_CONTEXT_SELECTALL",
};

const std::vector<const char*> kDeveloperOnly = {
    "IDC_DEV_TOOLS",
    "IDC_DEV_TOOLS_CONSOLE",
    "IDC_DEV_TOOLS_INSPECT",
    "IDC_DEV_TOOLS_TOGGLE",
    "IDC_DEV_TOOLS_DEVICES",
    "IDC_CONTENT_CONTEXT_INSPECTELEMENT",
    "IDC_CONTENT_CONTEXT_INSPECTELEMENT_WITH_DEVTOOLS",
};

// The Block rows of research R1.4, the wildcard rows spelt out against CEF 150.
const std::vector<const char*> kBlocked = {
    // Page actions
    "IDC_SAVE_PAGE", "IDC_PRINT", "IDC_BASIC_PRINT", "IDC_VIEW_SOURCE", "IDC_OPEN_FILE",
    "IDC_STOP", "IDC_HELP_PAGE_VIA_KEYBOARD",
    // Find
    "IDC_FIND", "IDC_FIND_NEXT", "IDC_FIND_PREVIOUS", "IDC_CLOSE_FIND_OR_STOP",
    // Caret browsing
    "IDC_CARET_BROWSING_TOGGLE",
    // Navigation
    "IDC_BACK", "IDC_FORWARD", "IDC_HOME", "IDC_RELOAD", "IDC_RELOAD_BYPASSING_CACHE",
    "IDC_RELOAD_CLEARING_CACHE",
    // Windows and tabs
    "IDC_NEW_WINDOW", "IDC_NEW_TAB", "IDC_NEW_SPLIT_TAB", "IDC_NEW_INCOGNITO_WINDOW",
    "IDC_CLOSE_TAB", "IDC_CLOSE_WINDOW", "IDC_EXIT", "IDC_RESTORE_TAB", "IDC_SELECT_NEXT_TAB",
    "IDC_SELECT_PREVIOUS_TAB", "IDC_SELECT_TAB_0", "IDC_SELECT_TAB_7", "IDC_SELECT_LAST_TAB",
    "IDC_MOVE_TAB_NEXT", "IDC_MOVE_TAB_PREVIOUS", "IDC_CREATE_NEW_TAB_GROUP",
    "IDC_CLOSE_TAB_GROUP",
    // Browser interface
    "IDC_SHOW_HISTORY", "IDC_SHOW_DOWNLOADS", "IDC_SHOW_BOOKMARK_BAR",
    "IDC_SHOW_BOOKMARK_MANAGER", "IDC_BOOKMARK_THIS_TAB", "IDC_BOOKMARK_ALL_TABS",
    "IDC_CLEAR_BROWSING_DATA", "IDC_TASK_MANAGER_SHORTCUT", "IDC_TASK_MANAGER_MAIN_MENU",
    "IDC_SHOW_APP_MENU", "IDC_SHOW_AVATAR_MENU", "IDC_TAB_SEARCH", "IDC_FEEDBACK",
    "IDC_SHOW_READING_MODE_KEYBOARD", "IDC_TOGGLE_MULTITASK_MENU",
    // Focus
    "IDC_FOCUS_TOOLBAR", "IDC_FOCUS_LOCATION", "IDC_FOCUS_SEARCH", "IDC_FOCUS_BOOKMARKS",
    "IDC_FOCUS_MENU_BAR", "IDC_FOCUS_NEXT_PANE", "IDC_FOCUS_PREVIOUS_PANE",
    "IDC_FOCUS_WEB_CONTENTS_PANE", "IDC_FOCUS_INACTIVE_POPUP_FOR_ACCESSIBILITY",
    // Debug
    "IDC_DEBUG_PRINT_VIEW_TREE", "IDC_DEBUG_TOGGLE_TABLET_MODE"};

constexpr const char* kOrigin = "http://127.0.0.1:41234";

NavigationRequest main_frame(std::string url, std::uint32_t transition, bool gesture = false) {
    return NavigationRequest{true, std::move(url), transition, gesture};
}

NavigationRequest sub_frame(std::string url, bool gesture = false) {
    return NavigationRequest{false, std::move(url), kTransitionAutoSubframe, gesture};
}

}  // namespace

TEST_CASE("engine commands: the Allow rows of R1.4 run in every run", "[engine]") {
    for (const char* name : kAllowed) {
        INFO(name);
        CHECK(EngineCommandPolicy::decide(name, false) == EngineDecision::Allow);
        CHECK(EngineCommandPolicy::decide(name, true) == EngineDecision::Allow);
    }
}

TEST_CASE("engine commands: the developer tools run only in a developer run", "[engine]") {
    for (const char* name : kDeveloperOnly) {
        INFO(name);
        CHECK(EngineCommandPolicy::decide(name, false) == EngineDecision::Block);
        CHECK(EngineCommandPolicy::decide(name, true) == EngineDecision::Allow);
    }
}

TEST_CASE("engine commands: every Block row of R1.4 is blocked in both kinds of run",
          "[engine]") {
    for (const char* name : kBlocked) {
        INFO(name);
        CHECK(EngineCommandPolicy::decide(name, false) == EngineDecision::Block);
        CHECK(EngineCommandPolicy::decide(name, true) == EngineDecision::Block);
    }
}

TEST_CASE("engine commands: deny by default - unknown ids and names are blocked", "[engine]") {
    CHECK(EngineCommandPolicy::decide("", false) == EngineDecision::Block);
    CHECK(EngineCommandPolicy::decide("", true) == EngineDecision::Block);
    for (const char* name : {"IDC_CONTENT_CONTEXT_INSPECTELEMENT_WITH_GEMINI",
                             "IDC_SOME_FUTURE_COMMAND", "IDC_PASTE_AND_GO", "IDC_COPY_URL"}) {
        INFO(name);
        CHECK(EngineCommandPolicy::decide(name, true) == EngineDecision::Block);
    }
    // The lists do not overlap, and each names only IDC_ commands.
    for (const auto* list : {&EngineCommandPolicy::allowed(), &EngineCommandPolicy::developerOnly(),
                             &EngineCommandPolicy::blocked()}) {
        for (const std::string_view name : *list) {
            INFO(std::string(name));
            CHECK(name.substr(0, 4) == "IDC_");
        }
    }
    for (const std::string_view name : EngineCommandPolicy::blocked()) {
        INFO(std::string(name));
        CHECK(EngineCommandPolicy::decide(name, true) == EngineDecision::Block);
    }
}

TEST_CASE("engine commands: the id map is built once from the running engine's names",
          "[engine]") {
    // The engine knows some names; a name it does not know resolves to -1 and is skipped.
    const std::map<std::string, int> known = {
        {"IDC_SAVE_PAGE", 35004}, {"IDC_ZOOM_PLUS", 38001}, {"IDC_DEV_TOOLS_TOGGLE", 40237}};
    int calls = 0;
    const EngineCommandNames names([&](const char* name) {
        ++calls;
        const auto it = known.find(name);
        return it == known.end() ? -1 : it->second;
    });
    const int expected_calls =
        static_cast<int>(EngineCommandPolicy::allowed().size() +
                         EngineCommandPolicy::developerOnly().size() +
                         EngineCommandPolicy::blocked().size());
    CHECK(calls == expected_calls);
    CHECK(names.nameOf(35004) == "IDC_SAVE_PAGE");
    CHECK(names.nameOf(38001) == "IDC_ZOOM_PLUS");
    CHECK(names.nameOf(-1).empty());
    CHECK(names.nameOf(12345).empty());
    CHECK(names.label(35004) == "IDC_SAVE_PAGE");
    CHECK(names.label(12345) == "#12345");
    CHECK(names.size() == 3);

    // The decision of an id: through its name, an id outside the map being unknown.
    CHECK(names.decide(35004, true) == EngineDecision::Block);
    CHECK(names.decide(38001, false) == EngineDecision::Allow);
    CHECK(names.decide(40237, false) == EngineDecision::Block);
    CHECK(names.decide(40237, true) == EngineDecision::Allow);
    CHECK(names.decide(12345, true) == EngineDecision::Block);
    // The test-hook log line of contracts/shell.md §3.
    CHECK(names.logLine(35004, EngineDecision::Block) ==
          "shelltest: chrome-command IDC_SAVE_PAGE blocked");
    CHECK(names.logLine(38001, EngineDecision::Allow) ==
          "shelltest: chrome-command IDC_ZOOM_PLUS allowed");
    CHECK(names.logLine(777, EngineDecision::Block) == "shelltest: chrome-command #777 blocked");
}

TEST_CASE("navigation guard: today's rule until the editor's page has loaded", "[engine]") {
    NavigationGuard guard(kOrigin);
    constexpr int browser = 1;
    CHECK_FALSE(guard.loaded(browser));
    CHECK(guard.decide(browser, main_frame(std::string(kOrigin) + "/", kTransitionExplicit)) ==
          NavigationVerdict::Allow);
    CHECK(guard.decide(browser, main_frame(kOrigin, kTransitionExplicit)) ==
          NavigationVerdict::Allow);
    // The load-error page and its Retry link keep working while nothing has loaded.
    CHECK(guard.decide(browser, main_frame("data:text/html;base64,AA==", kTransitionLink)) ==
          NavigationVerdict::Allow);
    guard.mainFrameCommitted(browser, "data:text/html;base64,AA==");
    CHECK_FALSE(guard.loaded(browser));
    CHECK(guard.decide(browser, main_frame(std::string(kOrigin) + "/", kTransitionLink, true)) ==
          NavigationVerdict::Allow);
    // External addresses: the system browser on a user gesture, refused otherwise.
    CHECK(guard.decide(browser, main_frame("https://example.org/", kTransitionLink, true)) ==
          NavigationVerdict::OpenExternally);
    CHECK(guard.decide(browser, main_frame("https://example.org/", kTransitionLink, false)) ==
          NavigationVerdict::Refuse);
    // Another loopback port is not the editor's origin.
    CHECK(guard.decide(browser, main_frame("http://127.0.0.1:41235/", kTransitionLink)) ==
          NavigationVerdict::Refuse);
    CHECK(guard.decide(browser, main_frame(std::string(kOrigin) + "0/", kTransitionLink)) ==
          NavigationVerdict::Refuse);
}

TEST_CASE("navigation guard: after the first load no cross-document navigation of the main "
          "frame",
          "[engine]") {
    NavigationGuard guard(kOrigin);
    constexpr int browser = 7;
    guard.mainFrameCommitted(browser, std::string(kOrigin) + "/?lang=ru");
    REQUIRE(guard.loaded(browser));
    const std::string app = std::string(kOrigin) + "/";
    // A reload of any kind, back or forward, a link or a typed address to the editor itself.
    CHECK(guard.decide(browser, main_frame(app, kTransitionReload)) == NavigationVerdict::Refuse);
    CHECK(guard.decide(browser, main_frame(app, kTransitionReload | kTransitionFromApiFlag)) ==
          NavigationVerdict::Refuse);
    CHECK(guard.decide(browser, main_frame(app, kTransitionLink | kTransitionForwardBackFlag)) ==
          NavigationVerdict::Refuse);
    CHECK(guard.decide(browser, main_frame(app, kTransitionLink, true)) ==
          NavigationVerdict::Refuse);
    CHECK(guard.decide(browser, main_frame(app + "?open=x.fb2", kTransitionExplicit)) ==
          NavigationVerdict::Refuse);
    CHECK(guard.decide(browser, main_frame("about:blank", kTransitionLink)) ==
          NavigationVerdict::Refuse);
    CHECK(guard.decide(browser, main_frame("data:text/html,x", kTransitionLink)) ==
          NavigationVerdict::Refuse);
    // An external address with a user gesture still goes to the system browser.
    CHECK(guard.decide(browser, main_frame("https://example.org/a", kTransitionLink, true)) ==
          NavigationVerdict::OpenExternally);
    CHECK(guard.decide(browser, main_frame("https://example.org/a", kTransitionLink, false)) ==
          NavigationVerdict::Refuse);
    // Sub-frames keep today's rule (the report window's sandboxed frame loads about:srcdoc).
    CHECK(guard.decide(browser, sub_frame("about:srcdoc")) == NavigationVerdict::Allow);
    CHECK(guard.decide(browser, sub_frame("about:blank")) == NavigationVerdict::Allow);
    CHECK(guard.decide(browser, sub_frame("data:text/html,x")) == NavigationVerdict::Allow);
    CHECK(guard.decide(browser, sub_frame(app + "frame.html")) == NavigationVerdict::Allow);
    CHECK(guard.decide(browser, sub_frame("https://example.org/", true)) ==
          NavigationVerdict::OpenExternally);
    CHECK(guard.decide(browser, sub_frame("https://example.org/", false)) ==
          NavigationVerdict::Refuse);
    // Other browsers (the developer tools' window) keep today's rule.
    CHECK_FALSE(guard.loaded(8));
    CHECK(guard.decide(8, main_frame("devtools://devtools/bundled/devtools_app.html",
                                     kTransitionAutoToplevel)) == NavigationVerdict::Allow);
    // A closed browser forgets its state.
    guard.browserClosed(browser);
    CHECK_FALSE(guard.loaded(browser));
}

TEST_CASE("navigation guard: the log line names the transition and the address's origin",
          "[engine]") {
    CHECK(NavigationGuard::transitionLabel(kTransitionReload) == "reload");
    CHECK(NavigationGuard::transitionLabel(kTransitionLink | kTransitionForwardBackFlag) ==
          "back-forward");
    CHECK(NavigationGuard::transitionLabel(kTransitionLink) == "link");
    CHECK(NavigationGuard::transitionLabel(kTransitionExplicit) == "explicit");
    CHECK(NavigationGuard::transitionLabel(kTransitionFormSubmit) == "form-submit");
    CHECK(NavigationGuard::transitionLabel(42) == "#42");
    CHECK(NavigationGuard::urlOrigin("https://example.org/a/b?c#d") == "https://example.org");
    CHECK(NavigationGuard::urlOrigin("http://127.0.0.1:41234/?x") == "http://127.0.0.1:41234");
    CHECK(NavigationGuard::urlOrigin("about:blank") == "about:");
    CHECK(NavigationGuard::urlOrigin("data:text/html,secret") == "data:");
    CHECK(NavigationGuard::logLine(main_frame("https://example.org/a?secret", kTransitionReload)) ==
          "shelltest: navigation-refused reload https://example.org");
}
