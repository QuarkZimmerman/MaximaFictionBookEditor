// Language table (T074). See mfbe/resource_tables.hpp.
#include <mfbe/log.hpp>
#include <mfbe/resource_tables.hpp>

#include <fstream>
#include <stdexcept>

namespace mfbe::resources {
namespace {

using nlohmann::json;

std::map<std::string, std::string> names_from(const json& j, const char* field) {
    std::map<std::string, std::string> out;
    auto it = j.find(field);
    if (it == j.end() || !it->is_object()) {
        return out;
    }
    for (auto item = it->begin(); item != it->end(); ++item) {
        if (item.value().is_string()) {
            out[item.key()] = item.value().get<std::string>();
        }
    }
    return out;
}

}  // namespace

const LanguageEntry* LanguageTable::find(const std::string& code) const {
    for (const LanguageGroup& g : groups) {
        for (const LanguageEntry& e : g.languages) {
            if (e.code == code) {
                return &e;
            }
        }
    }
    return nullptr;
}

std::vector<LanguageEntry> LanguageTable::flat() const {
    std::vector<LanguageEntry> out;
    for (const LanguageGroup& g : groups) {
        out.insert(out.end(), g.languages.begin(), g.languages.end());
    }
    return out;
}

std::size_t LanguageTable::size() const {
    std::size_t n = 0;
    for (const LanguageGroup& g : groups) {
        n += g.languages.size();
    }
    return n;
}

json LanguageTable::to_json() const {
    json group_list = json::array();
    json entries = json::array();
    for (const LanguageGroup& g : groups) {
        json languages = json::array();
        for (const LanguageEntry& e : g.languages) {
            languages.push_back({{"code", e.code}, {"name", json(e.names)}});
            entries.push_back({{"code", e.code}, {"names", json(e.names)}, {"group", g.key}});
        }
        group_list.push_back(
            {{"key", g.key}, {"title", json(g.titles)}, {"languages", std::move(languages)}});
    }
    return json{{"groups", std::move(group_list)}, {"entries", std::move(entries)}};
}

LanguageTable parse_languages(const std::string& json_text) {
    json root;
    try {
        root = json::parse(json_text);
    } catch (const json::exception& e) {
        throw std::runtime_error(std::string("invalid JSON: ") + e.what());
    }
    if (!root.is_object() || !root.contains("groups") || !root["groups"].is_array()) {
        throw std::runtime_error("expected an object with a \"groups\" array");
    }
    LanguageTable table;
    for (const json& g : root["groups"]) {
        if (!g.is_object() || !g.contains("key") || !g["key"].is_string()) {
            throw std::runtime_error("every group needs a string \"key\"");
        }
        LanguageGroup group;
        group.key = g["key"].get<std::string>();
        group.titles = names_from(g, "title");
        if (group.titles.empty()) {
            group.titles["en"] = group.key;
        }
        if (g.contains("languages") && g["languages"].is_array()) {
            for (const json& l : g["languages"]) {
                if (!l.is_object() || !l.contains("code") || !l["code"].is_string()) {
                    throw std::runtime_error("every language needs a string \"code\"");
                }
                LanguageEntry entry;
                entry.code = l["code"].get<std::string>();
                entry.names = names_from(l, "name");
                if (entry.names.empty()) {
                    entry.names["en"] = entry.code;
                }
                entry.group = group.key;
                group.languages.push_back(std::move(entry));
            }
        }
        table.groups.push_back(std::move(group));
    }
    return table;
}

LanguageTable load_languages(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    if (!in) {
        log::warning("core", "resources.languagesUnavailable", "languages.json not readable",
                     log::extras({{"path", file.string()}}));
        return {};
    }
    const std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    try {
        return parse_languages(text);
    } catch (const std::runtime_error& e) {
        log::warning("core", "resources.languagesUnavailable", "languages.json malformed",
                     log::extras({{"path", file.string()}, {"reason", e.what()}}));
        return {};
    }
}

}  // namespace mfbe::resources
