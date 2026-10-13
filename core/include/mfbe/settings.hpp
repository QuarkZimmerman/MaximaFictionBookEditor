// Per-user settings store (T018) - `settings.json`, schemaVersion 1.
//
// Defaults are exactly contracts/resource-formats.md §6. Unknown keys are preserved on load,
// patch and save; missing keys take defaults; invalid values are replaced by defaults and
// logged (`settings.invalidValue`). `settings.set` patches are deep-merged: objects merge
// recursively, scalars/arrays replace, `null` resets a known key to its default (and removes
// an unknown one). Invalid patch values raise SettingsError (RPC error 1040 {field}).
#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

namespace mfbe::settings {

inline constexpr int kSchemaVersion = 1;

// The default settings document (a fresh copy each call).
nlohmann::json defaults();

// Encodings offered by Save As / `other.defaultEncoding`.
const std::vector<std::string>& supported_encodings();

struct SettingsError : std::runtime_error {
    SettingsError(std::string field_, std::string reason_)
        : std::runtime_error(field_ + ": " + reason_),
          field(std::move(field_)),
          reason(std::move(reason_)) {}
    std::string field;  // dotted path, e.g. "other.jpegQuality"
    std::string reason;
};

struct Invalid {
    std::string field;
    std::string reason;
};

// Fills missing known keys with defaults and replaces invalid known values by their defaults.
// Unknown keys are left untouched. Returns the fields that were reset.
std::vector<Invalid> sanitize(nlohmann::json& settings);

// Validates every known key present in `patch` without modifying anything; throws
// SettingsError for the first invalid field.
void validate_patch(const nlohmann::json& patch);

struct ApplyResult {
    nlohmann::json settings;
    bool restartRequired = false;  // true when view.uiLanguage changed
};

class SettingsStore {
public:
    explicit SettingsStore(std::filesystem::path file);

    // Reads the file (missing -> defaults; unreadable/invalid JSON -> defaults + log).
    void load();
    // Writes the file atomically (directory created when missing). Logs on failure and
    // returns false.
    bool save() const;

    const nlohmann::json& get() const { return settings_; }
    const std::filesystem::path& path() const { return file_; }

    // Validates, merges, saves and returns the new settings. Throws SettingsError.
    ApplyResult apply_patch(const nlohmann::json& patch);

    // Convenience accessors with defaults when the path is missing/mistyped.
    std::string get_string(const std::string& dotted_path, const std::string& fallback = "") const;
    bool get_bool(const std::string& dotted_path, bool fallback = false) const;
    int get_int(const std::string& dotted_path, int fallback = 0) const;

private:
    std::filesystem::path file_;
    nlohmann::json settings_;
};

// Deep-merge helper used by apply_patch (exposed for tests): see header comment for rules.
void merge_patch(nlohmann::json& target, const nlohmann::json& patch,
                 const nlohmann::json& defaults);

}  // namespace mfbe::settings
