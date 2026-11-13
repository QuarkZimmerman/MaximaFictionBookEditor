// Feature 014 (plan DP-1, research R5, tasks T017): the shipped fonts' index.

#include "pdf/fonts.hpp"

#include <mfbe/atomic_file.hpp>

#include <nlohmann/json.hpp>

namespace mfbe::pdf {

std::vector<ShippedFamily> shipped_families(const std::filesystem::path& fonts_dir) {
    std::vector<ShippedFamily> families;
    nlohmann::json index;
    try {
        index = nlohmann::json::parse(atomic_file::read_file(fonts_dir / "fonts.json"));
    } catch (const std::exception&) {
        return families;
    }
    if (!index.contains("families") || !index["families"].is_array())
        return families;
    for (const auto& f : index["families"]) {
        if (!f.is_object() || !f.contains("id") || !f["id"].is_string())
            continue;
        ShippedFamily family;
        family.id = f["id"].get<std::string>();
        family.kind = f.value("kind", std::string("serif"));
        family.text_font = f.value("textFont", false);
        family.licence = f.value("licence", std::string());
        family.notice = f.value("notice", std::string());
        if (f.contains("scripts") && f["scripts"].is_array()) {
            for (const auto& s : f["scripts"]) {
                if (s.is_string())
                    family.scripts.push_back(s.get<std::string>());
            }
        }
        if (f.contains("styles") && f["styles"].is_object()) {
            for (const auto& [style, file] : f["styles"].items()) {
                if (file.is_string())
                    family.styles[style] = file.get<std::string>();
            }
        }
        families.push_back(std::move(family));
    }
    return families;
}

std::optional<std::filesystem::path> shipped_file(const std::filesystem::path& fonts_dir,
                                                  const std::string& id, const std::string& style) {
    for (const ShippedFamily& family : shipped_families(fonts_dir)) {
        if (family.id != id)
            continue;
        const auto it = family.styles.find(style);
        if (it == family.styles.end())
            return std::nullopt;
        // The index names plain files of the folder; anything else is not served.
        if (it->second.find('/') != std::string::npos ||
            it->second.find('\\') != std::string::npos || it->second.starts_with(".")) {
            return std::nullopt;
        }
        const auto path = fonts_dir / it->second;
        std::error_code ec;
        if (std::filesystem::is_regular_file(path, ec))
            return path;
        return std::nullopt;
    }
    return std::nullopt;
}

}  // namespace mfbe::pdf
