// Dictionary discovery through the resource layers (T086; feature 003 US4: rejected files,
// lookup folders, language fallback). See mfbe/spell.hpp.
#include <mfbe/encodings.hpp>
#include <mfbe/spell.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <system_error>

namespace mfbe::spell {

using nlohmann::json;

namespace fs = std::filesystem;

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

json RejectedDictionary::to_json() const {
    json j{{"path", platform::utf8_from_path(path)}, {"reason", reason}};
    if (detail) {
        j["detail"] = *detail;
    }
    return j;
}

/* ----------------------------------------------------------------------------------------- */
/* .aff encoding                                                                              */
/* ----------------------------------------------------------------------------------------- */

namespace {

std::string trim(std::string_view text) {
    std::size_t begin = 0;
    std::size_t end = text.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(text[begin])) != 0) {
        ++begin;
    }
    while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1])) != 0) {
        --end;
    }
    return std::string(text.substr(begin, end - begin));
}

std::string lower_ascii(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

// True when the file can be opened for reading (it exists and the permissions allow it).
bool file_readable(const fs::path& file) {
    std::error_code ec;
    if (!fs::is_regular_file(file, ec)) {
        return false;
    }
    std::ifstream in(file, std::ios::binary);
    return in.is_open();
}

}  // namespace

std::optional<std::string> dictionary_encoding(std::string_view declared) {
    std::string name = trim(declared);
    if (name.empty()) {
        name = "ISO8859-1";  // Hunspell's default without a SET line (affixmgr.cxx)
    }
    // Hunspell's own spelling of the Windows Cyrillic code page (e.g. Bulgarian and older
    // Russian dictionaries); the other Hunspell names are aliases mfbe/encodings.hpp knows.
    if (lower_ascii(name) == "microsoft-cp1251") {
        name = "windows-1251";
    }
    const auto canonical = encoding::normalize_name(name);
    if (!canonical || !encoding::is_supported(*canonical)) {
        return std::nullopt;
    }
    return canonical;
}

std::optional<std::string> read_set_line(const fs::path& aff) {
    std::ifstream in(aff, std::ios::binary);
    if (!in.is_open()) {
        return std::nullopt;
    }
    std::string line;
    bool first = true;
    while (std::getline(in, line)) {
        if (first) {
            first = false;
            if (line.rfind("\xEF\xBB\xBF", 0) == 0) {
                line.erase(0, 3);  // UTF-8 BOM, skipped by Hunspell as well
            }
        }
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        // Hunspell: the keyword SET at the start of a line, then the value as the next
        // whitespace-separated token.
        if (line.rfind("SET", 0) != 0 ||
            (line.size() > 3 && std::isspace(static_cast<unsigned char>(line[3])) == 0)) {
            continue;
        }
        std::string value = trim(std::string_view(line).substr(3));
        const auto space = value.find_first_of(" \t");
        if (space != std::string::npos) {
            value.erase(space);
        }
        return value;
    }
    if (in.bad()) {
        return std::nullopt;
    }
    return std::string();
}

/* ----------------------------------------------------------------------------------------- */
/* Registry                                                                                   */
/* ----------------------------------------------------------------------------------------- */

DictionaryRegistry::DictionaryRegistry(const resources::ResourceLayers& layers) : layers_(layers) {
    refresh();
}

bool DictionaryRegistry::refresh() {
    folders_ = layers_.layers(resources::Kind::dictionaries);

    // Pass 1: every .aff / .dic of every readable folder is checked on its own - partner,
    // readability, encoding - and the unusable .aff files are kept out of the layered lookup,
    // so a broken pair never shadows a usable one in a lower layer (and is reported instead).
    std::vector<RejectedDictionary> rejected;
    std::set<fs::path> unusable;
    for (const resources::Layer& folder : folders_) {
        if (!folder.readable) {
            continue;
        }
        std::error_code ec;
        std::vector<fs::path> files;
        for (fs::directory_iterator it(folder.path, ec), end; !ec && it != end; it.increment(ec)) {
            std::error_code type_ec;
            if (it->is_regular_file(type_ec)) {
                files.push_back(it->path());
            }
        }
        std::sort(files.begin(), files.end());
        for (const fs::path& file : files) {
            const std::string ext = lower_ascii(platform::utf8_from_path(file.extension()));
            std::error_code partner_ec;
            if (ext == ".dic") {
                fs::path aff = file;
                aff.replace_extension(".aff");
                if (!fs::is_regular_file(aff, partner_ec)) {
                    rejected.push_back({file, "partnerMissing", std::nullopt});
                }
                continue;
            }
            if (ext != ".aff") {
                continue;
            }
            fs::path dic = file;
            dic.replace_extension(".dic");
            if (!fs::is_regular_file(dic, partner_ec)) {
                rejected.push_back({file, "partnerMissing", std::nullopt});
                unusable.insert(file);
                continue;
            }
            const std::optional<std::string> set = read_set_line(file);
            if (!set) {
                rejected.push_back({file, "unreadable", std::nullopt});
                unusable.insert(file);
                continue;
            }
            if (!file_readable(dic)) {
                rejected.push_back({dic, "unreadable", std::nullopt});
                unusable.insert(file);
                continue;
            }
            if (!dictionary_encoding(*set)) {
                rejected.push_back({file, "unsupportedEncoding", *set});
                unusable.insert(file);
            }
        }
    }

    // Pass 2: the layered lookup over the usable pairs; a tag present in several layers keeps
    // the highest one (bundled, settings, user, portable) and reports the others as shadowed.
    const resources::IdFunction pair_id =
        resources::default_id_function(resources::Kind::dictionaries);
    const resources::IdFunction usable_id =
        [&pair_id, &unusable](const fs::directory_entry& entry) -> std::optional<std::string> {
        if (unusable.count(entry.path()) != 0) {
            return std::nullopt;
        }
        return pair_id(entry);
    };
    std::vector<resources::Conflict> conflicts;
    std::vector<Dictionary> found;
    for (const resources::Entry& entry :
         layers_.list(resources::Kind::dictionaries, usable_id, &conflicts)) {
        Dictionary d;
        d.tag = entry.id;
        d.aff = entry.path;
        d.dic = entry.path;
        d.dic.replace_extension(".dic");
        d.layer = entry.layer;
        fs::path readme = entry.path;
        readme.replace_extension(".txt");
        std::error_code ec;
        if (fs::is_regular_file(readme, ec)) {
            d.readme = readme;
        }
        found.push_back(std::move(d));
    }
    for (const resources::Conflict& conflict : conflicts) {
        rejected.push_back(
            {conflict.ignored, "shadowed", std::string(resources::to_string(conflict.kept_layer))});
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
    std::stable_sort(
        rejected.begin(), rejected.end(),
        [](const RejectedDictionary& a, const RejectedDictionary& b) { return a.path < b.path; });

    const auto same = [](const Dictionary& a, const Dictionary& b) {
        return a.tag == b.tag && a.aff == b.aff && a.dic == b.dic && a.layer == b.layer;
    };
    const bool changed = found.size() != dictionaries_.size() ||
                         !std::equal(found.begin(), found.end(), dictionaries_.begin(), same);
    dictionaries_ = std::move(found);
    rejected_ = std::move(rejected);
    return changed;
}

const Dictionary* DictionaryRegistry::resolve(std::string_view lang) const {
    const std::string wanted = normalize_tag(lang);
    if (wanted.empty()) {
        return nullptr;
    }
    // 1. The exact tag ("de_AT" when a de_AT dictionary exists).
    for (const Dictionary& d : dictionaries_) {
        if (normalize_tag(d.tag) == wanted) {
            return &d;
        }
    }
    // 2. A regional variant of the requested tag ("en" -> "en_US", "zh_hans" -> "zh_hans_cn").
    const auto starts_with_region = [](const std::string& tag, const std::string& prefix) {
        return tag.size() > prefix.size() && tag.compare(0, prefix.size(), prefix) == 0 &&
               tag[prefix.size()] == '_';
    };
    for (const Dictionary& d : dictionaries_) {
        if (starts_with_region(normalize_tag(d.tag), wanted)) {
            return &d;
        }
    }
    // 3. The language alone ("de_AT" -> "de" -> "de_DE"): the tag itself or a variant of it.
    const std::string language = wanted.substr(0, wanted.find('_'));
    if (language != wanted) {
        for (const Dictionary& d : dictionaries_) {
            const std::string tag = normalize_tag(d.tag);
            if (tag == language || starts_with_region(tag, language)) {
                return &d;
            }
        }
    }
    // 4. Last resort: any tag starting with the language ("en" -> "english" style tags).
    for (const Dictionary& d : dictionaries_) {
        if (normalize_tag(d.tag).rfind(language, 0) == 0) {
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

json DictionaryRegistry::report_json() const {
    json rejected = json::array();
    for (const RejectedDictionary& r : rejected_) {
        rejected.push_back(r.to_json());
    }
    json folders = json::array();
    for (const resources::Layer& folder : folders_) {
        folders.push_back({{"layer", resources::to_string(folder.layer)},
                           {"path", platform::utf8_from_path(folder.path)},
                           {"exists", folder.exists},
                           {"readable", folder.readable},
                           {"writable", folder.writable}});
    }
    return json{{"dictionaries", to_json()}, {"rejected", rejected}, {"folders", folders}};
}

}  // namespace mfbe::spell
