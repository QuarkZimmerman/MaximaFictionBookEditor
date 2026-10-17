// Bundled lookup tables of the Description form and the Insert-symbol menu (T074):
// resources/languages.json (ISO 639-1 codes grouped as in the original editor's eng.xsl) and
// resources/symbols.ini (`symN = codepoint`, `symN_9` English label, `symN_25` Russian label,
// `symN_34` Ukrainian label). Names are keyed by interface language ("en", "ru", "uk").
// Both are read once per server (resources_handlers.cpp) and exposed as `resources.languages`
// and `resources.symbols`.
#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <map>
#include <string>
#include <vector>

namespace mfbe::resources {

struct LanguageEntry {
    std::string code;                          // ISO 639-1 ("ru", "en", ...)
    std::map<std::string, std::string> names;  // "en" / "ru" / "uk"
    std::string group;                         // group key ("main", "europe", ...)
};

struct LanguageGroup {
    std::string key;
    std::map<std::string, std::string> titles;  // "en" / "ru" / "uk"
    std::vector<LanguageEntry> languages;
};

struct LanguageTable {
    std::vector<LanguageGroup> groups;

    const LanguageEntry* find(const std::string& code) const;
    std::vector<LanguageEntry> flat() const;
    std::size_t size() const;
    // {groups: [{key, title: {en, ru, uk}, languages: [{code, name: {en, ru, uk}}]}],
    //  entries: [{code, names: {en, ru, uk}, group}]}
    nlohmann::json to_json() const;
};

// Parses the languages.json text; throws std::runtime_error with a reason when malformed.
LanguageTable parse_languages(const std::string& json_text);
// Reads the file; a missing/malformed file yields an empty table and logs
// `resources.languagesUnavailable`.
LanguageTable load_languages(const std::filesystem::path& file);

struct SymbolEntry {
    int index = 0;                             // N of symN (1-based, as in the ini)
    char32_t codepoint = 0;                    // Unicode scalar value
    std::string utf8;                          // the character itself
    std::map<std::string, std::string> names;  // "en" / "ru" / "uk" (missing -> en -> U+XXXX)
};

// Parses symbols.ini (`[symbols]` section; `;`/`#` comments). Entries are returned in index
// order; symbols without a valid code point are skipped.
std::vector<SymbolEntry> parse_symbols_ini(const std::string& ini_text);
// Reads the file; missing -> empty list + log `resources.symbolsUnavailable`.
std::vector<SymbolEntry> load_symbols(const std::filesystem::path& file);
// [{index, codepoint, char, names: {en, ru, uk}}]
nlohmann::json to_json(const std::vector<SymbolEntry>& symbols);

}  // namespace mfbe::resources
