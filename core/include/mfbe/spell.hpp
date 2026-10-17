// Spell checking (T086/T087, FR-070..FR-072, research D7) - contracts/rpc-api.md §3.4,
// contracts/resource-formats.md §4; feature 003 US4 (FR-030..FR-033, research R5): the
// dictionaries folder chosen in Settings, the report of rejected files and lookup folders.
//
//   DictionaryRegistry  `<tag>.aff` + `<tag>.dic` pairs discovered through the layered lookup
//                       (kind `dictionaries`: settings/user/portable layers + bundled
//                       resources/dictionaries); `<tag>.txt` is the licence/readme shown in
//                       About. Files it cannot use are kept as `rejected()` with the reason:
//                       a `.aff`/`.dic` without its partner, a file that cannot be read, an
//                       `.aff` whose `SET` encoding the core cannot convert, or a pair whose
//                       tag a higher layer provides (bundled over settings over user over
//                       portable - `shadowed`, naming the winning layer). Language matching:
//                       exact tag first ("en_US"), then the language ("ru" or "de-AT" -> the
//                       first "ru_*" / "de_*" tag; '-' and '_' are equivalent,
//                       case-insensitive).
//   SpellChecker        the engine interface (Hunspell behind it; Nuspell would be a drop-in).
//   HunspellChecker     one Hunspell instance per dictionary, created on first use, each
//                       guarded by its own mutex (UTF-8 in and out; dictionaries in another
//                       encoding are converted through mfbe/encodings.hpp; an unsupported
//                       encoding is an error, never a silent fallback). A refresh drops the
//                       instances whose files changed or disappeared.
//   CustomDictionary    persistent personal word list: UTF-8, one word per line, sorted on
//                       save, Hunspell personal-dictionary compatible; path configurable.
//   SpellService        facade for the RPC handlers: resolves langs, consults the custom
//                       dictionary, caches results per (langs, word) in an LRU so a batch of
//                       10 000 words completes well under a second.
#pragma once

#include <mfbe/resources.hpp>

#include <nlohmann/json.hpp>

#include <cstddef>
#include <filesystem>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace mfbe::spell {

struct Dictionary {
    std::string tag;  // "en_US", "ru_RU", ...
    std::filesystem::path aff;
    std::filesystem::path dic;
    std::optional<std::filesystem::path> readme;  // "<tag>.txt" when present
    resources::LayerName layer = resources::LayerName::bundled;

    std::string source() const;      // "bundled" | "user" | "portable" | "settings"
    nlohmann::json to_json() const;  // {tag, lang, name, path, dicPath, readmePath?, source}
};

// Normalises a language tag for matching: lower-case, '-' -> '_' ("ru-RU" -> "ru_ru").
std::string normalize_tag(std::string_view tag);

// A dictionary file the registry cannot use (feature 003 US4, contracts/rpc-api.md §3.4).
struct RejectedDictionary {
    std::filesystem::path path;  // the file concerned (.aff, or the lone / unreadable .dic)
    // "partnerMissing" | "unreadable" | "unsupportedEncoding" | "shadowed"
    std::string reason;
    // shadowed: the layer whose pair stays in effect ("bundled" | "settings" | "user");
    // unsupportedEncoding: the encoding the `SET` line declares.
    std::optional<std::string> detail;

    nlohmann::json to_json() const;  // {path, reason, detail?}
};

// The encoding of a Hunspell `.aff` file as the core can convert it: the `SET` line's value
// (Hunspell's names - "UTF-8", "ISO8859-2", "KOI8-R", "microsoft-cp1251" - and the aliases of
// mfbe/encodings.hpp; Hunspell's default ISO8859-1 when there is no `SET` line) canonicalised
// ("iso-8859-2"); nullopt when the core has no converter for it.
std::optional<std::string> dictionary_encoding(std::string_view declared);
// The value of the first `SET` line of an `.aff` file ("" when there is none; nullopt when the
// file cannot be read).
std::optional<std::string> read_set_line(const std::filesystem::path& aff);

class DictionaryRegistry {
public:
    explicit DictionaryRegistry(const resources::ResourceLayers& layers);

    // Rescans the layers: the effective pairs, the rejected files and the folders. Returns
    // true when the effective set (tags, paths, layers) differs from the previous scan.
    bool refresh();
    const std::vector<Dictionary>& dictionaries() const { return dictionaries_; }
    const std::vector<RejectedDictionary>& rejected() const { return rejected_; }
    // The folders of the lookup in report order (settings, user, portable, bundled) with
    // their state as of the last refresh.
    const std::vector<resources::Layer>& folders() const { return folders_; }
    // Exact tag first, then the language of `lang` ("de-AT" -> the first "de_*" tag, then any
    // tag starting with "de"); nullptr when nothing matches.
    const Dictionary* resolve(std::string_view lang) const;
    nlohmann::json to_json() const;  // [Dictionary::to_json()...]
    // {dictionaries: [Dictionary::to_json()...], rejected: [RejectedDictionary::to_json()...],
    //  folders: [{layer, path, exists, readable, writable}...]} - spell.dictionaryReport.
    nlohmann::json report_json() const;

private:
    const resources::ResourceLayers& layers_;
    std::vector<Dictionary> dictionaries_;
    std::vector<RejectedDictionary> rejected_;
    std::vector<resources::Layer> folders_;
};

struct SpellError : std::runtime_error {
    SpellError(std::string lang_, std::string reason_)
        : std::runtime_error(reason_), lang(std::move(lang_)), reason(std::move(reason_)) {}
    std::string lang;
    std::string reason;
};

class SpellChecker {
public:
    virtual ~SpellChecker() = default;
    // True when `word` is accepted by the dictionary `tag` (dictionary tag, not a language).
    virtual bool spell(const std::string& tag, const std::string& word) = 0;
    // Suggestions of one dictionary (at most `max`).
    virtual std::vector<std::string> suggest(const std::string& tag, const std::string& word,
                                             std::size_t max) = 0;
    // Runtime additions/removals (personal words) applied to every loaded dictionary.
    virtual void add_word(const std::string& word) = 0;
    virtual void remove_word(const std::string& word) = 0;
};

class HunspellChecker : public SpellChecker {
public:
    explicit HunspellChecker(std::shared_ptr<DictionaryRegistry> registry);
    ~HunspellChecker() override;

    bool spell(const std::string& tag, const std::string& word) override;
    std::vector<std::string> suggest(const std::string& tag, const std::string& word,
                                     std::size_t max) override;
    void add_word(const std::string& word) override;
    void remove_word(const std::string& word) override;

    // Words fed into every instance when it is created (custom dictionary); replaces the set.
    void set_runtime_words(std::vector<std::string> words);
    // Loads a dictionary now (otherwise it happens on first use). Throws SpellError.
    void preload(const std::string& tag);
    std::size_t loaded_count() const;
    // Drops the loaded instances whose dictionary left the registry or whose files changed
    // (path, size or modification time) since they were loaded, so a refresh never keeps using
    // a removed or replaced file. Returns how many were dropped.
    std::size_t drop_stale();

private:
    struct Instance;
    std::shared_ptr<Instance> instance(const std::string& tag);  // throws SpellError

    std::shared_ptr<DictionaryRegistry> registry_;
    mutable std::mutex mutex_;
    std::map<std::string, std::shared_ptr<Instance>> instances_;
    std::vector<std::string> runtime_words_;
};

// Validates a custom-dictionary word: non-empty, no whitespace/control characters, valid
// UTF-8, at most 128 bytes. Returns "" when valid, else the reason code.
std::string custom_word_error(std::string_view word);

class CustomDictionary {
public:
    explicit CustomDictionary(std::filesystem::path file);

    void load();        // missing -> empty; invalid lines skipped + logged
    bool save() const;  // atomic; sorted; one word per line; trailing newline

    const std::filesystem::path& path() const { return file_; }
    void set_path(std::filesystem::path file);  // does not load; call load()

    const std::vector<std::string>& words() const { return words_; }
    bool contains(std::string_view word) const;
    // Returns the error code ("" on success; "duplicate" when already present). Saves.
    std::string add(std::string_view word);
    // Returns true when the word existed. Saves.
    bool remove(std::string_view word);

private:
    std::filesystem::path file_;
    std::vector<std::string> words_;  // sorted (byte order), unique
};

struct CheckResult {
    std::vector<std::string> misspelled;  // input order, unique
    std::vector<std::string> langs;       // dictionary tags actually used
    std::size_t cache_hits = 0;
};

class SpellService {
public:
    static constexpr std::size_t kDefaultCacheCapacity = 200000;

    SpellService(const resources::ResourceLayers& layers, std::filesystem::path custom_path,
                 std::size_t cache_capacity = kDefaultCacheCapacity);

    DictionaryRegistry& registry() { return *registry_; }
    HunspellChecker& checker() { return *checker_; }
    CustomDictionary& custom() { return custom_; }

    // Resolves document languages to dictionary tags (duplicates removed, input order).
    // Languages without a dictionary are skipped; `unavailable` (when given) receives them.
    std::vector<std::string> resolve_langs(const std::vector<std::string>& langs,
                                           std::vector<std::string>* unavailable = nullptr) const;

    // Misspelled words = words accepted by none of the resolved dictionaries and not in the
    // custom dictionary. Throws SpellError when no language resolves to a dictionary.
    CheckResult check(const std::vector<std::string>& words, const std::vector<std::string>& langs);
    // Merged suggestions of the resolved dictionaries (first language first), at most `max`.
    std::vector<std::string> suggest(const std::string& word, const std::vector<std::string>& langs,
                                     std::size_t max = 10);

    // Custom dictionary operations (persist + feed Hunspell + invalidate the cache).
    std::string add_word(const std::string& word);
    bool remove_word(const std::string& word);
    void set_custom_path(const std::filesystem::path& path);
    void reload_custom();

    // Rescans the dictionary layers (start-up, Settings applied - feature 003 US4): refreshes
    // the registry, drops the Hunspell instances whose files changed or disappeared and forgets
    // the cached verdicts when anything changed. Returns true when something changed.
    bool refresh_dictionaries();

    void clear_cache();
    std::size_t cache_size() const;

private:
    bool cached(const std::string& key, bool* value);
    void remember(const std::string& key, bool value);

    std::shared_ptr<DictionaryRegistry> registry_;
    std::unique_ptr<HunspellChecker> checker_;
    CustomDictionary custom_;

    mutable std::mutex cache_mutex_;
    std::size_t capacity_;
    std::list<std::pair<std::string, bool>> lru_;  // front = most recent
    std::unordered_map<std::string, std::list<std::pair<std::string, bool>>::iterator> index_;
};

}  // namespace mfbe::spell
