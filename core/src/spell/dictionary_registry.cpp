// Dictionary discovery through the resource layers (T086). See mfbe/spell.hpp.
#include <mfbe/spell.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <system_error>

namespace mfbe::spell {

using nlohmann::json;

std::string normalize_tag(std::string_view tag) {
    std::string out;
    out.reserve(tag.size());
    for (const char c : tag) {
        if (c == '-') {
            out.push_back('_');
        } else {
            out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
        }
    }
    while (!out.empty() && std::isspace(static_cast<unsigned char>(out.back())) != 0) {
        out.pop_back();
    }
    std::size_t start = 0;
    while (start < out.size() && std::isspace(static_cast<unsigned char>(out[start])) != 0) {
        ++start;
    }
    return out.substr(start);
}

std::string Dictionary::source() const {
    return resources::to_string(layer);
}

json Dictionary::to_json() const {
    // `lang` = language part of the tag ("en" of "en_US"); `name` = tag (display label).
    const std::string normalized = normalize_tag(tag);
    const auto underscore = normalized.find('_');
    json j{
        {"tag", tag},
        {"lang", underscore == std::string::npos ? normalized : normalized.substr(0, underscore)},
        {"name", tag},
        {"path", platform::utf8_from_path(aff)},
        {"dicPath", platform::utf8_from_path(dic)},
        {"source", source()}};
    if (readme) {
        j["readmePath"] = platform::utf8_from_path(*readme);
    }
    return j;
}

DictionaryRegistry::DictionaryRegistry(const resources::ResourceLayers& layers) : layers_(layers) {
    refresh();
}

void DictionaryRegistry::refresh() {
    std::vector<Dictionary> found;
    for (const resources::Entry& entry : layers_.list(resources::Kind::dictionaries)) {
        Dictionary d;
        d.tag = entry.id;
        d.aff = entry.path;
        d.dic = entry.path;
        d.dic.replace_extension(".dic");
        d.layer = entry.layer;
        std::filesystem::path readme = entry.path;
        readme.replace_extension(".txt");
        std::error_code ec;
        if (std::filesystem::is_regular_file(readme, ec)) {
            d.readme = readme;
        }
        found.push_back(std::move(d));
    }
    // Stable order: bundled first, then the other layers, each alphabetically by tag.
    std::stable_sort(found.begin(), found.end(), [](const Dictionary& a, const Dictionary& b) {
        const bool ab = a.layer == resources::LayerName::bundled;
        const bool bb = b.layer == resources::LayerName::bundled;
        if (ab != bb) {
            return ab;
        }
        return normalize_tag(a.tag) < normalize_tag(b.tag);
    });
    dictionaries_ = std::move(found);
}

const Dictionary* DictionaryRegistry::resolve(std::string_view lang) const {
    const std::string wanted = normalize_tag(lang);
    if (wanted.empty()) {
        return nullptr;
    }
    for (const Dictionary& d : dictionaries_) {
        if (normalize_tag(d.tag) == wanted) {
            return &d;
        }
    }
    for (const Dictionary& d : dictionaries_) {
        const std::string tag = normalize_tag(d.tag);
        if (tag.size() > wanted.size() && tag.compare(0, wanted.size(), wanted) == 0 &&
            (tag[wanted.size()] == '_')) {
            return &d;
        }
    }
    // Last resort: any tag starting with the language ("en" -> "english" style tags).
    for (const Dictionary& d : dictionaries_) {
        if (normalize_tag(d.tag).rfind(wanted, 0) == 0) {
            return &d;
        }
    }
    return nullptr;
}

json DictionaryRegistry::to_json() const {
    json out = json::array();
    for (const Dictionary& d : dictionaries_) {
        out.push_back(d.to_json());
    }
    return out;
}

}  // namespace mfbe::spell
