// Genre catalogue (T073). See mfbe/genres.hpp.
#include <mfbe/genres.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>
#include <mfbe/validator.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <sstream>

namespace mfbe::genres {
namespace {

namespace fs = std::filesystem;
using nlohmann::json;

constexpr const char* kLanguages[] = {"en", "ru"};

std::string trim(std::string s) {
    const auto not_space = [](unsigned char c) { return !std::isspace(c); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), not_space));
    s.erase(std::find_if(s.rbegin(), s.rend(), not_space).base(), s.end());
    return s;
}

void strip_bom(std::string& text) {
    if (text.size() >= 3 && text.compare(0, 3, "\xEF\xBB\xBF") == 0) {
        text.erase(0, 3);
    }
}

std::vector<std::string> split_tabs(const std::string& line) {
    std::vector<std::string> fields;
    std::string::size_type start = 0;
    for (;;) {
        const auto tab = line.find('\t', start);
        fields.push_back(
            trim(line.substr(start, tab == std::string::npos ? std::string::npos : tab - start)));
        if (tab == std::string::npos) {
            break;
        }
        start = tab + 1;
    }
    return fields;
}

// Splits text into lines (LF or CRLF), keeping 1-based numbering.
std::vector<std::string> split_lines(std::string text) {
    strip_bom(text);
    std::vector<std::string> lines;
    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        lines.push_back(line);
    }
    return lines;
}

bool is_comment_or_blank(const std::string& line) {
    const std::string t = trim(line);
    return t.empty() || t[0] == '#' || t[0] == ';';
}

std::optional<std::string> read_text_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return std::nullopt;
    }
    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (in.bad()) {
        return std::nullopt;
    }
    return text;
}

std::string code_prefix(const std::string& code) {
    const auto pos = code.find('_');
    return pos == std::string::npos ? code : code.substr(0, pos);
}

/* ----------------------------------------------------------------------------------------- */
/* Bundled name tables                                                                        */
/* ----------------------------------------------------------------------------------------- */

struct NameTables {
    std::vector<Category> categories;                        // in file order
    std::map<std::string, std::string> key_by_title;         // any language title -> key
    std::map<std::string, std::vector<Listing>> listings;    // code -> listings (EN order)
    std::vector<std::string> code_order;                     // codes in EN table order
    std::map<std::string, std::vector<Listing>> ru_listing;  // code -> RU listings
};

void read_categories(const fs::path& file, NameTables& tables) {
    const auto text = read_text_file(file);
    if (!text) {
        return;
    }
    for (const std::string& line : split_lines(*text)) {
        if (is_comment_or_blank(line)) {
            continue;
        }
        const auto fields = split_tabs(line);
        if (fields.size() < 2 || fields[0] == "key") {
            continue;  // header row
        }
        Category category;
        category.key = fields[0];
        category.titles["en"] = fields[1];
        category.titles["ru"] = fields.size() > 2 && !fields[2].empty() ? fields[2] : fields[1];
        for (const auto& [lang, title] : category.titles) {
            tables.key_by_title.emplace(title, category.key);
        }
        const bool known = std::any_of(tables.categories.begin(), tables.categories.end(),
                                       [&](const Category& c) { return c.key == category.key; });
        if (!known) {
            tables.categories.push_back(std::move(category));
        }
    }
}

// Reads one `category<TAB>code<TAB>name` table into `out` (code -> listings, file order).
void read_names(const fs::path& file, const std::string& lang, NameTables& tables,
                std::map<std::string, std::vector<Listing>>& out, std::vector<std::string>* order) {
    const auto text = read_text_file(file);
    if (!text) {
        return;
    }
    for (const std::string& line : split_lines(*text)) {
        if (is_comment_or_blank(line)) {
            continue;
        }
        const auto fields = split_tabs(line);
        if (fields.size() < 3 || fields[1].empty() || fields[2].empty()) {
            continue;
        }
        auto key_it = tables.key_by_title.find(fields[0]);
        Listing listing;
        listing.category = key_it == tables.key_by_title.end() ? fields[0] : key_it->second;
        listing.names[lang] = fields[2];
        auto& list = out[fields[1]];
        if (order != nullptr && list.empty()) {
            order->push_back(fields[1]);
        }
        const bool seen = std::any_of(list.begin(), list.end(), [&](const Listing& l) {
            return l.category == listing.category;
        });
        if (!seen) {
            list.push_back(std::move(listing));
        }
    }
}

NameTables load_name_tables(const fs::path& dir) {
    NameTables tables;
    read_categories(dir / "categories.tsv", tables);
    read_categories(dir / "categories.extra.tsv", tables);
    read_names(dir / "names.en.txt", "en", tables, tables.listings, &tables.code_order);
    read_names(dir / "names.extra.en.txt", "en", tables, tables.listings, &tables.code_order);
    read_names(dir / "names.ru.txt", "ru", tables, tables.ru_listing, nullptr);
    read_names(dir / "names.extra.ru.txt", "ru", tables, tables.ru_listing, nullptr);
    // Merge the Russian names into the English listings (same code + category; else any
    // Russian listing of the code; else the English name is the fallback).
    for (auto& [code, listings] : tables.listings) {
        auto ru = tables.ru_listing.find(code);
        for (Listing& listing : listings) {
            std::string ru_name;
            if (ru != tables.ru_listing.end()) {
                for (const Listing& r : ru->second) {
                    if (r.category == listing.category) {
                        ru_name = r.names.at("ru");
                        break;
                    }
                }
                if (ru_name.empty() && !ru->second.empty()) {
                    ru_name = ru->second.front().names.at("ru");
                }
            }
            listing.names["ru"] = ru_name.empty() ? listing.names["en"] : ru_name;
        }
    }
    // Codes only present in the Russian tables.
    for (const auto& [code, listings] : tables.ru_listing) {
        if (tables.listings.count(code) == 0) {
            auto& list = tables.listings[code];
            tables.code_order.push_back(code);
            for (Listing l : listings) {
                l.names["en"] = l.names["ru"];
                list.push_back(std::move(l));
            }
        }
    }
    return tables;
}

GenreEntry standard_entry(const std::string& code, const NameTables& tables) {
    GenreEntry entry;
    entry.code = code;
    entry.source = "standard";
    auto it = tables.listings.find(code);
    if (it == tables.listings.end() || it->second.empty()) {
        for (const char* lang : kLanguages) {
            entry.names[lang] = code;
        }
        return entry;
    }
    const std::vector<Listing>& listings = it->second;
    std::size_t primary = 0;
    const std::string prefix = code_prefix(code);
    for (std::size_t i = 0; i < listings.size(); ++i) {
        if (listings[i].category == prefix) {
            primary = i;
            break;
        }
    }
    entry.category = listings[primary].category;
    entry.names = listings[primary].names;
    for (std::size_t i = 0; i < listings.size(); ++i) {
        if (i != primary) {
            entry.also_in.push_back(listings[i]);
        }
    }
    return entry;
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* TSV parsing                                                                                */
/* ----------------------------------------------------------------------------------------- */

bool is_valid_genre_code(std::string_view code) {
    if (code.empty()) {
        return false;
    }
    return std::all_of(code.begin(), code.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
    });
}

ParsedTsv parse_genres_tsv(const std::string& text, const fs::path& file) {
    ParsedTsv parsed;
    std::set<std::string> seen;
    const std::vector<std::string> lines = split_lines(text);
    for (std::size_t i = 0; i < lines.size(); ++i) {
        const int number = static_cast<int>(i) + 1;
        const std::string& line = lines[i];
        if (is_comment_or_blank(line)) {
            continue;
        }
        const auto fields = split_tabs(line);
        if (fields[0] == "code" && fields.size() > 1 && fields[1] == "category") {
            continue;  // header row without '#'
        }
        if (!is_valid_genre_code(fields[0])) {
            parsed.issues.push_back({file, number, "invalidCode", fields[0]});
            continue;
        }
        if (fields.size() < 3 || fields[2].empty()) {
            parsed.issues.push_back({file, number, "missingName", fields[0]});
            continue;
        }
        if (!seen.insert(fields[0]).second) {
            parsed.issues.push_back({file, number, "duplicate", fields[0]});
            continue;
        }
        GenreEntry entry;
        entry.code = fields[0];
        entry.category = fields[1];
        entry.names["en"] = fields[2];
        entry.names["ru"] = fields.size() > 3 && !fields[3].empty() ? fields[3] : fields[2];
        parsed.entries.push_back(std::move(entry));
    }
    return parsed;
}

/* ----------------------------------------------------------------------------------------- */
/* GenreCatalog                                                                               */
/* ----------------------------------------------------------------------------------------- */

bool GenreCatalog::contains(const std::string& code) const {
    return index_.count(code) > 0;
}

const GenreEntry* GenreCatalog::find(const std::string& code) const {
    auto it = index_.find(code);
    return it == index_.end() ? nullptr : &entries_[it->second];
}

const Category* GenreCatalog::category(const std::string& key) const {
    for (const Category& c : categories_) {
        if (c.key == key) {
            return &c;
        }
    }
    return nullptr;
}

std::size_t GenreCatalog::count(const std::string& source) const {
    return static_cast<std::size_t>(std::count_if(
        entries_.begin(), entries_.end(), [&](const GenreEntry& e) { return e.source == source; }));
}

bool GenreCatalog::add(GenreEntry entry) {
    if (index_.count(entry.code) > 0) {
        return false;
    }
    if (!entry.category.empty() && category(entry.category) == nullptr) {
        Category c;
        c.key = entry.category;
        for (const char* lang : kLanguages) {
            c.titles[lang] = entry.category;
        }
        categories_.push_back(std::move(c));
    }
    index_[entry.code] = entries_.size();
    entries_.push_back(std::move(entry));
    return true;
}

void GenreCatalog::add_category(Category c) {
    if (category(c.key) == nullptr) {
        categories_.push_back(std::move(c));
    }
}

json GenreCatalog::to_json() const {
    json entries = json::array();
    for (const GenreEntry& e : entries_) {
        json j{{"code", e.code},
               {"category", e.category},
               {"names", json(e.names)},
               {"source", e.source}};
        if (e.file) {
            j["file"] = platform::utf8_from_path(*e.file);
        }
        if (!e.also_in.empty()) {
            json also = json::array();
            for (const Listing& l : e.also_in) {
                also.push_back({{"category", l.category}, {"names", json(l.names)}});
            }
            j["alsoIn"] = std::move(also);
        }
        entries.push_back(std::move(j));
    }
    json categories = json::array();
    for (const Category& c : categories_) {
        categories.push_back({{"key", c.key}, {"titles", json(c.titles)}});
    }
    json user_files = json::array();
    json sources = json::array();
    for (const SourceInfo& s : sources_) {
        json j{{"source", s.source},
               {"path", platform::utf8_from_path(s.path)},
               {"entries", s.entries}};
        if (s.layer) {
            j["layer"] = resources::to_string(*s.layer);
        }
        sources.push_back(std::move(j));
        if (s.source.rfind("user:", 0) == 0) {
            user_files.push_back(platform::utf8_from_path(s.path));
        }
    }
    json issues = json::array();
    for (const LoadIssue& i : issues_) {
        json j{{"file", platform::utf8_from_path(i.file)}, {"line", i.line}, {"reason", i.reason}};
        if (!i.code.empty()) {
            j["code"] = i.code;
        }
        issues.push_back(std::move(j));
    }
    return json{{"entries", std::move(entries)},
                {"categories", std::move(categories)},
                {"userFiles", std::move(user_files)},
                {"effectiveSources", std::move(sources)},
                {"issues", std::move(issues)}};
}

/* ----------------------------------------------------------------------------------------- */
/* Loader                                                                                     */
/* ----------------------------------------------------------------------------------------- */

GenreCatalog load_catalog(const std::vector<std::string>& schema_codes,
                          const fs::path& bundled_genres_dir,
                          const resources::ResourceLayers& layers) {
    GenreCatalog catalog;
    const NameTables tables = load_name_tables(bundled_genres_dir);
    for (const Category& c : tables.categories) {
        catalog.add_category(c);
    }
    // Standard list: original table order first, then the remaining schema codes.
    const std::set<std::string> schema(schema_codes.begin(), schema_codes.end());
    for (const std::string& code : tables.code_order) {
        if (schema.count(code) > 0) {
            catalog.add(standard_entry(code, tables));
        }
    }
    for (const std::string& code : schema_codes) {
        if (!catalog.contains(code)) {
            catalog.add(standard_entry(code, tables));
        }
    }
    SourceInfo standard;
    standard.source = "standard";
    standard.path = validation::schema_dir() / "FictionBookGenres.xsd";
    standard.entries = catalog.size();
    catalog.add_source(std::move(standard));

    // Extension files through the layers (bundled first).
    for (const resources::Entry& file : layers.list(resources::Kind::genres)) {
        const bool bundled = file.layer == resources::LayerName::bundled;
        const std::string source = bundled
                                       ? "bundled-extension"
                                       : "user:" + platform::utf8_from_path(file.path.filename());
        SourceInfo info;
        info.source = source;
        info.path = file.path;
        info.layer = file.layer;
        const auto text = read_text_file(file.path);
        if (!text) {
            catalog.add_issue({file.path, 0, "unreadable", ""});
            log::warning(
                "core", "genres.parseError", "genre file could not be read",
                log::extras({{"file", platform::utf8_from_path(file.path)}, {"line", "0"}}));
            catalog.add_source(std::move(info));
            continue;
        }
        ParsedTsv parsed = parse_genres_tsv(*text, file.path);
        for (LoadIssue& issue : parsed.issues) {
            log::warning("core", "genres.parseError", "genre file line skipped",
                         log::extras({{"file", platform::utf8_from_path(issue.file)},
                                      {"line", std::to_string(issue.line)},
                                      {"reason", issue.reason}}));
            catalog.add_issue(std::move(issue));
        }
        // Line numbers of the parsed entries are not kept; report duplicates per code.
        for (GenreEntry& entry : parsed.entries) {
            entry.source = source;
            entry.file = file.path;
            const GenreEntry* existing = catalog.find(entry.code);
            if (existing != nullptr) {
                if (bundled && existing->source == "standard") {
                    continue;  // documented: the standard list always wins, silently
                }
                log::warning("core", "genres.duplicate",
                             "genre code already present; additive lookup keeps the first",
                             log::extras({{"file", platform::utf8_from_path(file.path)},
                                          {"code", entry.code},
                                          {"existingSource", existing->source}}));
                catalog.add_issue({file.path, 0, "duplicate", entry.code});
                continue;
            }
            catalog.add(std::move(entry));
            ++info.entries;
        }
        catalog.add_source(std::move(info));
    }
    return catalog;
}

void install_genre_validator(std::shared_ptr<const GenreCatalog> catalog) {
    if (!catalog) {
        validation::set_genre_validator(nullptr);
        return;
    }
    validation::set_genre_validator(
        [catalog](const std::string& code) { return catalog->contains(code); });
}

}  // namespace mfbe::genres
