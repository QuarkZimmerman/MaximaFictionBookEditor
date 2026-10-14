// Insert-symbol table (T074): parser of resources/symbols.ini. See mfbe/resource_tables.hpp.
#include <mfbe/log.hpp>
#include <mfbe/resource_tables.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <map>
#include <optional>
#include <sstream>

namespace mfbe::resources {
namespace {

using nlohmann::json;

std::string trim(std::string s) {
    const auto not_space = [](unsigned char c) { return !std::isspace(c); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), not_space));
    s.erase(std::find_if(s.rbegin(), s.rend(), not_space).base(), s.end());
    return s;
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

bool all_digits(const std::string& s) {
    return !s.empty() &&
           std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
}

struct Raw {
    std::optional<long> codepoint;
    std::map<std::string, std::string> names;  // "9" -> en, "25" -> ru (Windows LANG ids)
};

}  // namespace

std::vector<SymbolEntry> parse_symbols_ini(const std::string& ini_text) {
    std::map<int, Raw> raw;
    std::istringstream in(ini_text);
    std::string line;
    bool in_symbols = true;  // keys before any section header count as well
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (line.size() >= 3 && line.compare(0, 3, "\xEF\xBB\xBF") == 0) {
            line.erase(0, 3);
        }
        const std::string t = trim(line);
        if (t.empty() || t[0] == ';' || t[0] == '#') {
            continue;
        }
        if (t.front() == '[' && t.back() == ']') {
            in_symbols = lower(trim(t.substr(1, t.size() - 2))) == "symbols";
            continue;
        }
        if (!in_symbols) {
            continue;
        }
        const auto eq = t.find('=');
        if (eq == std::string::npos) {
            continue;
        }
        const std::string key = lower(trim(t.substr(0, eq)));
        const std::string value = trim(t.substr(eq + 1));
        if (key.rfind("sym", 0) != 0) {
            continue;
        }
        const std::string rest = key.substr(3);  // "N" or "N_LANG"
        const auto underscore = rest.find('_');
        const std::string number = rest.substr(0, underscore);
        if (!all_digits(number)) {
            continue;
        }
        const int index = std::stoi(number);
        if (underscore == std::string::npos) {
            if (all_digits(value)) {
                const long cp = std::stol(value);
                if (cp > 0 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF)) {
                    raw[index].codepoint = cp;
                }
            }
        } else {
            raw[index].names[rest.substr(underscore + 1)] = value;
        }
    }
    std::vector<SymbolEntry> out;
    for (const auto& [index, r] : raw) {
        if (!r.codepoint) {
            continue;
        }
        SymbolEntry entry;
        entry.index = index;
        entry.codepoint = static_cast<char32_t>(*r.codepoint);
        unicode::append_utf8(entry.utf8, entry.codepoint);
        char fallback[16];
        std::snprintf(fallback, sizeof(fallback), "U+%04lX", *r.codepoint);
        auto en = r.names.find("9");
        auto ru = r.names.find("25");
        entry.names["en"] = en != r.names.end() && !en->second.empty() ? en->second : fallback;
        entry.names["ru"] =
            ru != r.names.end() && !ru->second.empty() ? ru->second : entry.names["en"];
        out.push_back(std::move(entry));
    }
    return out;
}

std::vector<SymbolEntry> load_symbols(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    if (!in) {
        log::warning("core", "resources.symbolsUnavailable", "symbols.ini not readable",
                     log::extras({{"path", platform::utf8_from_path(file)}}));
        return {};
    }
    const std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    return parse_symbols_ini(text);
}

json to_json(const std::vector<SymbolEntry>& symbols) {
    json out = json::array();
    for (const SymbolEntry& s : symbols) {
        out.push_back({{"index", s.index},
                       {"codepoint", static_cast<std::uint32_t>(s.codepoint)},
                       {"char", s.utf8},
                       {"names", json(s.names)}});
    }
    return out;
}

}  // namespace mfbe::resources
