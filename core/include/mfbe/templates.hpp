// Template of new documents (feature 002 FR-006, FR-008) - contracts/resource-formats.md §2a.
// Unlike the additive resources (genres, scripts, dictionaries) the template is replaced: the
// first `blank.fb2` found in the template folder chosen in Settings, the per-user data folder
// or the portable folder is used instead of the bundled one, which is never changed. A user
// file that cannot be used falls back to the bundled template, with the reason. Resolved on
// every use, so a file copied in is found without a restart.
#pragma once

#include <mfbe/resources.hpp>

#include <nlohmann/json.hpp>

#include <filesystem>
#include <optional>
#include <string>

namespace mfbe::resources {

inline constexpr const char* kTemplateFileName = "blank.fb2";

struct TemplateIssue {
    std::filesystem::path path;
    // unreadable | empty | notWellFormed | notFictionBook
    std::string reason;
    // The reader's message (English; may be empty).
    std::string detail;
};

struct EffectiveTemplate {
    std::filesystem::path path;
    LayerName layer = LayerName::bundled;
    // The user template found first could not be used (the bundled one is used instead).
    std::optional<TemplateIssue> issue;
};

// `settings_folder`: settings other.templateFolder ("" = not set).
EffectiveTemplate resolve_template(const ResourceLayers& layers,
                                   const std::filesystem::path& settings_folder);

// The folder "Open template folder" shows: the one chosen in Settings, else <Data>.
std::filesystem::path template_folder(const ResourceLayers& layers,
                                      const std::filesystem::path& settings_folder);

// {path, reason, detail?} and {path, layer, issue?} (UTF-8 paths).
nlohmann::json to_json(const TemplateIssue& issue);
nlohmann::json to_json(const EffectiveTemplate& effective);

}  // namespace mfbe::resources
