// The browser engine's own commands and navigation, held to the editor's paradigm (feature 007,
// contracts/shell.md §3-§5, data-model §1, research R1.4). Pure logic without CEF types, shared
// by the shell (mfbe_client.cpp) and tests/shell/test_engine_commands.cpp.
//
// - EngineCommandPolicy: every Chrome command - from a key, a mouse button, a native menu or a
//   context menu - passes one gate. The Allow rows of R1.4 run, the developer tools run only in
//   a developer run, everything else is blocked: deny by default, unknown commands included.
// - EngineCommandNames: the id -> name map of the policy's names, built once at start-up from
//   the running engine (cef_id_for_command_id_name; a name it does not know resolves to -1 and
//   is skipped). An id outside the map is unknown: blocked, and named "#<id>" in the log.
// - NavigationGuard: the editor's page is loaded once. Until the main frame of a browser has
//   committed the editor's address, today's rule applies (the editor's origin, about: and data:
//   load; another address is refused and, on a user gesture, handed to the system browser).
//   After it, the main frame makes no cross-document navigation at all: no reload, back,
//   forward or new address; an external address with a user gesture still goes to the system
//   browser. Sub-frames keep today's rule.
#pragma once

#include <cstdint>
#include <functional>
#include <set>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace mfbe::shell {

enum class EngineDecision { Allow, Block };

class EngineCommandPolicy {
public:
    // The Allow rows of research R1.4: zoom, full screen and minimise, the dedicated Cut, Copy
    // and Paste keys, the text field's edit menu.
    static const std::vector<std::string_view>& allowed();
    // The developer tools (FR-006): allowed only in a developer run.
    static const std::vector<std::string_view>& developerOnly();
    // The Block rows of R1.4, spelt out: they are blocked by default anyway and are listed so
    // that the log names them.
    static const std::vector<std::string_view>& blocked();
    // `name` is the command's IDC name, "" for an id the shell does not know.
    static EngineDecision decide(std::string_view name, bool developer_run);
};

class EngineCommandNames {
public:
    // Resolves every name of the policy's lists once; -1 = unknown to the running engine.
    explicit EngineCommandNames(const std::function<int(const char*)>& resolve);

    std::string_view nameOf(int id) const;  // "" for an id outside the map
    std::string label(int id) const;        // the name, or "#<id>"
    std::size_t size() const { return names_.size(); }
    EngineDecision decide(int id, bool developer_run) const;
    // "shelltest: chrome-command <IDC_NAME|#id> allowed|blocked" (test-hook builds only).
    std::string logLine(int id, EngineDecision decision) const;

private:
    std::unordered_map<int, std::string_view> names_;
};

// cef_transition_type_t, without CEF types (mfbe_client.cpp checks the values against CEF).
inline constexpr std::uint32_t kTransitionLink = 0;
inline constexpr std::uint32_t kTransitionExplicit = 1;
inline constexpr std::uint32_t kTransitionAutoSubframe = 3;
inline constexpr std::uint32_t kTransitionManualSubframe = 4;
inline constexpr std::uint32_t kTransitionAutoToplevel = 6;
inline constexpr std::uint32_t kTransitionFormSubmit = 7;
inline constexpr std::uint32_t kTransitionReload = 8;
inline constexpr std::uint32_t kTransitionSourceMask = 0xFF;
inline constexpr std::uint32_t kTransitionForwardBackFlag = 0x01000000;
inline constexpr std::uint32_t kTransitionFromApiFlag = 0x08000000;

struct NavigationRequest {
    bool main_frame = true;
    std::string url;
    std::uint32_t transition = kTransitionLink;
    bool user_gesture = false;
};

enum class NavigationVerdict { Allow, Refuse, OpenExternally };

class NavigationGuard {
public:
    // `app_origin` is "http://127.0.0.1:<port>", the only address of the editor's page.
    explicit NavigationGuard(std::string app_origin);

    // Today's rule: the editor's origin (followed by nothing, "/", "?" or "#"), about:, data:
    // and the developer tools' own addresses.
    bool isAllowedUrl(std::string_view url) const;
    // The main frame of `browser_id` committed `url` (OnLoadStart): the editor's address makes
    // that browser Loaded; any other address (the load-error page) leaves it as it is.
    void mainFrameCommitted(int browser_id, std::string_view url);
    bool loaded(int browser_id) const;
    void browserClosed(int browser_id);
    NavigationVerdict decide(int browser_id, const NavigationRequest& request) const;

    // "reload", "back-forward", "link", "explicit", "form-submit", … or "#<n>".
    static std::string transitionLabel(std::uint32_t transition);
    // "scheme://host[:port]" of an address, or "<scheme>:" when it has no authority - never
    // its path or query.
    static std::string urlOrigin(std::string_view url);
    // "shelltest: navigation-refused <transition> <url-origin>" (test-hook builds only).
    static std::string logLine(const NavigationRequest& request);

private:
    // The editor's own address: its origin followed by nothing, "/", "?" or "#".
    bool isAppUrl(std::string_view url) const;

    std::string app_origin_;
    std::set<int> loaded_;
};

}  // namespace mfbe::shell
