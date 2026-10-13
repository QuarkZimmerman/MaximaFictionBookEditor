// Hotkey overrides store - `hotkeys.json` (contracts/resource-formats.md §7).
// { "schemaVersion": 1, "bindings": [ { "command": "edit.bold", "keys": "Mod+B" } ] }
// Chord validation and collision detection live in the UI; the core only persists.
#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace mfbe::settings {

struct HotkeyBinding {
    std::string command;  // stable command id, e.g. "edit.undo"
    std::string keys;     // chord, e.g. "Ctrl+Z"; "" = unbound

    bool operator==(const HotkeyBinding&) const = default;
};

nlohmann::json to_json(const HotkeyBinding& binding);

class HotkeysStore {
public:
    explicit HotkeysStore(std::filesystem::path file);

    void load();        // missing -> empty; invalid entries skipped + logged
    bool save() const;  // atomic

    const std::vector<HotkeyBinding>& bindings() const { return bindings_; }
    nlohmann::json to_json() const;  // array of bindings

    // Replaces all user bindings (duplicates by command collapse to the last one). Saves.
    void set_bindings(std::vector<HotkeyBinding> bindings);

private:
    std::filesystem::path file_;
    std::vector<HotkeyBinding> bindings_;
};

}  // namespace mfbe::settings
