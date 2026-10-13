// Spell checking (T086/T087, FR-070..FR-072, research D7) - contracts/rpc-api.md §3.4,
// contracts/resource-formats.md §4.
//
//   DictionaryRegistry  `<tag>.aff` + `<tag>.dic` pairs discovered through the layered lookup
//                       (kind `dictionaries`: settings/user/portable layers + bundled
//                       resources/dictionaries); `<tag>.txt` is the licence/readme shown in
//                       About. Language matching: exact tag first ("en_US"), then prefix
//                       ("ru" -> first tag starting with "ru"; '-' and '_' are equivalent,
//                       case-insensitive).
//   SpellChecker        the engine interface (Hunspell behind it; Nuspell would be a drop-in).
//   HunspellChecker     one Hunspell instance per dictionary, created on first use, each
//                       guarded by its own mutex (UTF-8 in and out; dictionaries in another
//                       encoding are converted through mfbe/encodings.hpp when supported).
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

class DictionaryRegistry {
public:
    explicit DictionaryRegistry(const resources::ResourceLayers& layers);

    void refresh();  // rescans the layers
    const std::vector<Dictionary>& dictionaries() const { return dictionaries_; }
    // Exact tag first, then the first dictionary whose tag starts with `lang`; nullptr when
    // nothing matches.
    const Dictionary* resolve(std::string_view lang) const;
    nlohmann::json to_json() const;  // [Dictionary::to_json()...]

private:
    const resources::ResourceLayers& layers_;
    std::vector<Dictionary> dictionaries_;
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
