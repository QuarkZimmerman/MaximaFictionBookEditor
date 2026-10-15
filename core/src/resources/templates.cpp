// Template of new documents (feature 002). See mfbe/templates.hpp.
#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/templates.hpp>
#include <mfbe/utf8_paths.hpp>

#include <system_error>
#include <utility>

namespace mfbe::resources {
namespace {

namespace fs = std::filesystem;

// Why a template file cannot be used (nullopt: it can).
std::optional<TemplateIssue> check_template(const fs::path& file) {
    std::string bytes;
    try {
        bytes = fb2::read_file_bytes(file);
    } catch (const fb2::IoFailure& e) {
        return TemplateIssue{file, "unreadable", e.reason};
    }
    if (bytes.find_first_not_of(" \t\r\n") == std::string::npos) {
        return TemplateIssue{file, "empty", ""};
    }
    BinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadOptions options;
    options.compute_schema_hint = false;
    options.file_kind = model::FileKind::fb2;
    try {
        fb2::read_bytes(bytes, store, ids, options, platform::utf8_from_path(file));
    } catch (const fb2::NotFictionBookFailure& e) {
        return TemplateIssue{file, "notFictionBook", e.reason};
    } catch (const fb2::ParseFailure& e) {
        return TemplateIssue{file, "notWellFormed", e.what()};
    }
    return std::nullopt;
}

bool is_file(const fs::path& path) {
    std::error_code ec;
    return fs::is_regular_file(path, ec);
}

}  // namespace

EffectiveTemplate resolve_template(const ResourceLayers& layers, const fs::path& settings_folder) {
    const Roots& roots = layers.roots();
    std::vector<std::pair<LayerName, fs::path>> candidates;
    if (!settings_folder.empty()) {
        candidates.emplace_back(LayerName::settings, settings_folder / kTemplateFileName);
    }
    candidates.emplace_back(LayerName::user, roots.user_data / kTemplateFileName);
    if (roots.portable) {
        candidates.emplace_back(LayerName::portable, *roots.portable / kTemplateFileName);
    }
    EffectiveTemplate bundled{roots.bundled_resources / kTemplateFileName, LayerName::bundled,
                              std::nullopt};
    for (const auto& [layer, path] : candidates) {
        if (!is_file(path)) {
            continue;
        }
        // The first file found decides: usable, or the bundled template with the reason.
        if (auto issue = check_template(path)) {
            bundled.issue = std::move(issue);
            return bundled;
        }
        return EffectiveTemplate{path, layer, std::nullopt};
    }
    return bundled;
}

fs::path template_folder(const ResourceLayers& layers, const fs::path& settings_folder) {
    return settings_folder.empty() ? layers.roots().user_data : settings_folder;
}

nlohmann::json to_json(const TemplateIssue& issue) {
    nlohmann::json j{{"path", platform::utf8_from_path(issue.path)}, {"reason", issue.reason}};
    if (!issue.detail.empty()) {
        j["detail"] = issue.detail;
    }
    return j;
}

nlohmann::json to_json(const EffectiveTemplate& effective) {
    nlohmann::json j{{"path", platform::utf8_from_path(effective.path)},
                     {"layer", to_string(effective.layer)}};
    if (effective.issue) {
        j["issue"] = to_json(*effective.issue);
    }
    return j;
}

}  // namespace mfbe::resources
