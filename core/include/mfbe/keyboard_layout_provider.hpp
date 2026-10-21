// Keyboard layout provider (feature 004, User Story 11; rpc-api.md §3.11, shell.md §2) - the
// shell-owned capability behind `system.keyboardLayouts` and `system.activateKeyboardLayout`:
// the keyboard layouts the system offers for switching and the switch of the editor's own
// window to one of them when a document is opened (FR-090 to FR-093). The core declares the
// interface, the CEF shell implements it per platform and answers from its UI thread;
// `--test-hooks` installs the recording stand-in instead, so the headless journeys see every
// request (`test.keyboardLayoutRequests`) and shape the answers (`test.setKeyboardLayouts`).
// Without a provider (browser/dev mode) the handlers answer the "no shell" results - a result,
// never an error.
#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace mfbe {

struct KeyboardLayout {
    std::string id;    // the shell's stable identifier: Windows KLID "00000419", macOS input
                       // source id "com.apple.keylayout.Russian", X11 group name "Russian"
    std::string name;  // what the system shows for it
};

struct KeyboardLayoutList {
    bool supported = false;
    std::string reason;  // "" | "wayland" | "noDisplay" | "noShell" | "unsupported"
    std::vector<KeyboardLayout> layouts;
    std::optional<std::string> current;  // the active layout's id when the platform can tell
};

struct KeyboardLayoutSwitch {
    bool activated = false;
    std::string reason;                   // "" | "notInstalled" | "refused" | "unsupported"
    std::optional<long long> systemCode;  // GetLastError / OSStatus / X status, when refused
};

// JSON shapes of rpc-api.md §3.11 and §5 ({supported, reason?, layouts, current?} and
// {activated, reason?}); the parser is tolerant (missing fields -> defaults) and throws
// std::invalid_argument on wrong types.
nlohmann::json to_json(const KeyboardLayoutList& list);
nlohmann::json to_json(const KeyboardLayoutSwitch& result);
KeyboardLayoutList keyboard_layout_list_from_json(const nlohmann::json& j);

class KeyboardLayoutProvider {
public:
    virtual ~KeyboardLayoutProvider() = default;

    template <typename R>
    using Callback = std::function<void(R)>;

    // The layouts the system currently offers, read afresh on every call. Called on the core's
    // transport thread; `done` may be invoked on any thread, once.
    virtual void list(Callback<KeyboardLayoutList> done) = 0;
    // Activates `id` for the editor's window when the system currently lists it (else
    // `notInstalled`); never installs or loads a layout. `done` as for list().
    virtual void activate(const std::string& id, Callback<KeyboardLayoutSwitch> done) = 0;
};

// The `--test-hooks` stand-in: a seeded list (default `test-en` "English (United States)",
// `test-ru` "Russian", current `test-en`) and a record of every activation request. Thread-safe;
// callbacks are invoked synchronously inside the call.
class RecordingKeyboardLayoutProvider : public KeyboardLayoutProvider {
public:
    RecordingKeyboardLayoutProvider();

    // Replaces the seed (test.setKeyboardLayouts).
    void seed(KeyboardLayoutList list);
    KeyboardLayoutList seeded() const;
    // Every activate() call since start (test.keyboardLayoutRequests): {id, at, activated}
    // with `at` the ISO 8601 UTC time of the call.
    std::vector<nlohmann::json> requests() const;
    void clear_requests();

    void list(Callback<KeyboardLayoutList> done) override;
    // Answers `activated: true` for an id of the seeded list, `notInstalled` for any other and
    // `unsupported` while the seed says supported:false; records the request either way.
    void activate(const std::string& id, Callback<KeyboardLayoutSwitch> done) override;

private:
    mutable std::mutex mutex_;
    KeyboardLayoutList seed_;
    std::vector<nlohmann::json> requests_;
};

}  // namespace mfbe
