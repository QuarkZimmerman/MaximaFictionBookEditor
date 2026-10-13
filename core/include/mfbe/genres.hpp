// Genre catalogue (T073, FR-051/FR-054/FR-127) - contracts/resource-formats.md §3,
// data-model.md §3.2.
//
// The effective genre list is built from
//   1. the standard list: the codes enumerated by the bundled FictionBookGenres.xsd
//      (`source: "standard"`, always present, never modified);
//   2. the bundled name tables resources/genres/names.<lang>.txt + names.extra.<lang>.txt
//      (`category<TAB>code<TAB>name`, category = localised title mapped to a key through
//      categories.tsv / categories.extra.tsv); the primary category of a cross-listed code is
//      the one whose key is the code's prefix, else its first listing; other listings are
//      reported in `also_in`;
//   3. `*.genres.tsv` files found through the layered lookup: the bundled layer first
//      (`source: "bundled-extension"`, resources/genres/10-fbe-legacy.genres.tsv), then the
//      settings / user / portable layers (`source: "user:<file name>"`).
// User files are purely additive: a line whose code already exists is skipped (and logged as
// `genres.duplicate`), malformed lines are skipped and logged as `genres.parseError`
// {file, line}; the rest of the file is still used. A bundled line duplicating a standard code
// is ignored silently (the contract lists geo_guides as legacy although the schema has it).
//
// TSV line format: `code<TAB>category<TAB>name_en<TAB>name_ru`; `code` `[a-z0-9_]+` and
// `name_en` are required, `name_ru` falls back to `name_en`, `category` may be a known key or
// a new one (its title defaults to the key); UTF-8 (BOM optional), `#` comments, CRLF ok.
#pragma once

#include <mfbe/resources.hpp>

#include <nlohmann/json.hpp>

#include <filesystem>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::genres {

struct Category {
    std::string key;                            // "sf", "det", ... ("" = unknown)
    std::map<std::string, std::string> titles;  // "en" / "ru" -> title (key when unknown)
};

struct Listing {
    std::string category;                      // key
    std::map<std::string, std::string> names;  // "en" / "ru"
};

struct GenreEntry {
    std::string code;
    std::string category;                       // primary category key ("" when unknown)
    std::map<std::string, std::string> names;   // "en" / "ru" (the code itself when unnamed)
    std::string source;                         // "standard" | "bundled-extension" | "user:<file>"
    std::optional<std::filesystem::path> file;  // the TSV that added an extension entry
    std::vector<Listing> also_in;               // cross-listings under other categories
};

struct LoadIssue {
    std::filesystem::path file;
    int line = 0;        // 1-based; 0 = whole file
    std::string reason;  // "unreadable" | "invalidCode" | "missingName" | "duplicate" | ...
    std::string code;    // offending code when known
};

struct SourceInfo {
    std::string source;  // as in GenreEntry::source
    std::filesystem::path path;
    std::optional<resources::LayerName> layer;  // nullopt for the schema
    std::size_t entries = 0;                    // entries contributed to the effective list
};

struct ParsedTsv {
    std::vector<GenreEntry> entries;  // code/category/names filled; source/file left empty
    std::vector<LoadIssue> issues;
};

// Parses the text of one `*.genres.tsv` file (user format). `file` is used in the issues.
ParsedTsv parse_genres_tsv(const std::string& text, const std::filesystem::path& file);

// True for `[a-z0-9_]+`.
bool is_valid_genre_code(std::string_view code);

class GenreCatalog {
public:
    const std::vector<GenreEntry>& entries() const { return entries_; }
    const std::vector<Category>& categories() const { return categories_; }
    const std::vector<SourceInfo>& sources() const { return sources_; }
    const std::vector<LoadIssue>& issues() const { return issues_; }

    bool contains(const std::string& code) const;
    const GenreEntry* find(const std::string& code) const;
    const Category* category(const std::string& key) const;
    std::size_t size() const { return entries_.size(); }
    std::size_t count(const std::string& source) const;  // entries with this source

    // {entries: [...], categories: [...], userFiles: [...], effectiveSources: [...],
    //  issues: [...]} - the `resources.genres` result (see resources_handlers.cpp).
    nlohmann::json to_json() const;

    // Adds an entry (skips duplicates; returns false then). Exposed for the loader/tests.
    bool add(GenreEntry entry);
    void add_category(Category category);  // keeps an existing key's titles
    void add_source(SourceInfo source) { sources_.push_back(std::move(source)); }
    void add_issue(LoadIssue issue) { issues_.push_back(std::move(issue)); }

private:
    std::vector<GenreEntry> entries_;
    std::map<std::string, std::size_t> index_;
    std::vector<Category> categories_;
    std::vector<LoadIssue> issues_;
    std::vector<SourceInfo> sources_;
};

// Builds the effective catalogue (see the header comment). `schema_codes` is normally
// validation::schema_genres(); `bundled_genres_dir` is <resources>/genres (name tables);
// the TSV files come from `layers.list(Kind::genres)`.
GenreCatalog load_catalog(const std::vector<std::string>& schema_codes,
                          const std::filesystem::path& bundled_genres_dir,
                          const resources::ResourceLayers& layers);

// Installs `catalog` as the validator's genre check (validation::set_genre_validator); the
// check keeps the catalogue alive. nullptr restores the plain schema enumeration.
void install_genre_validator(std::shared_ptr<const GenreCatalog> catalog);

}  // namespace mfbe::genres
