// Personal dictionary (T086, FR-072) and the SpellService facade. See mfbe/spell.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/spell.hpp>
#include <mfbe/unicode.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <system_error>

namespace mfbe::spell {

/* ----------------------------------------------------------------------------------------- */
/* CustomDictionary                                                                           */
/* ----------------------------------------------------------------------------------------- */

std::string custom_word_error(std::string_view word) {
    if (word.empty()) {
        return "empty";
    }
    if (word.size() > 128) {
        return "tooLong";
    }
    bool ok = true;
    const auto cps = unicode::decode_utf8(word, &ok);
    if (!ok) {
        return "invalidUtf8";
    }
    for (const char32_t cp : cps) {
        if (cp < 0x21 || cp == 0x7F || cp == 0xA0 || (cp >= 0x80 && cp < 0xA0) || cp == 0x2028 ||
            cp == 0x2029 || cp == 0x200B || cp == 0xFEFF) {
            return "invalidCharacter";
        }
    }
    return "";
}

CustomDictionary::CustomDictionary(std::filesystem::path file) : file_(std::move(file)) {}

void CustomDictionary::set_path(std::filesystem::path file) {
    file_ = std::move(file);
}

void CustomDictionary::load() {
    words_.clear();
    std::ifstream in(file_, std::ios::binary);
    if (!in) {
        return;  // missing -> empty
    }
    std::string line;
    bool first = true;
    while (std::getline(in, line)) {
        if (first) {
            first = false;
            if (line.size() >= 3 && line.compare(0, 3, "\xEF\xBB\xBF") == 0) {
                line.erase(0, 3);
            }
        }
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        // Hunspell personal dictionaries may carry "word/Flags" and a first line with a
        // count; keep just the word.
        const auto slash = line.find('/');
        std::string word = slash == std::string::npos ? line : line.substr(0, slash);
        while (!word.empty() && std::isspace(static_cast<unsigned char>(word.back())) != 0) {
            word.pop_back();
        }
        while (!word.empty() && std::isspace(static_cast<unsigned char>(word.front())) != 0) {
            word.erase(word.begin());
        }
        if (word.empty()) {
            continue;
        }
        if (std::all_of(word.begin(), word.end(),
                        [](unsigned char c) { return std::isdigit(c) != 0; })) {
            continue;  // Hunspell word-count header line
        }
        const std::string error = custom_word_error(word);
        if (!error.empty()) {
            log::warning("core", "spell.customDictionaryLine", "custom dictionary line skipped",
                         log::extras({{"path", file_.string()}, {"reason", error}}));
            continue;
        }
        words_.push_back(std::move(word));
    }
    std::sort(words_.begin(), words_.end());
    words_.erase(std::unique(words_.begin(), words_.end()), words_.end());
}

bool CustomDictionary::save() const {
    std::string text;
    for (const std::string& w : words_) {
        text += w;
        text += '\n';
    }
    try {
        if (file_.has_parent_path()) {
            std::error_code ec;
            std::filesystem::create_directories(file_.parent_path(), ec);
        }
        atomic_file::write_atomic(file_, text);
        return true;
    } catch (const atomic_file::WriteError& e) {
        log::error("core", "spell.customDictionarySaveFailed", "custom dictionary not written",
                   log::extras({{"path", e.path}, {"reason", e.reason}}));
        return false;
    }
}

bool CustomDictionary::contains(std::string_view word) const {
    return std::binary_search(words_.begin(), words_.end(), word);
}

std::string CustomDictionary::add(std::string_view word) {
    const std::string error = custom_word_error(word);
    if (!error.empty()) {
        return error;
    }
    if (contains(word)) {
        return "duplicate";
    }
    words_.insert(std::lower_bound(words_.begin(), words_.end(), word), std::string(word));
    save();
    return "";
}

bool CustomDictionary::remove(std::string_view word) {
    auto it = std::lower_bound(words_.begin(), words_.end(), word);
    if (it == words_.end() || *it != word) {
        return false;
    }
    words_.erase(it);
    save();
    return true;
}

/* ----------------------------------------------------------------------------------------- */
/* SpellService                                                                               */
/* ----------------------------------------------------------------------------------------- */

SpellService::SpellService(const resources::ResourceLayers& layers,
                           std::filesystem::path custom_path, std::size_t cache_capacity)
    : registry_(std::make_shared<DictionaryRegistry>(layers)),
      checker_(std::make_unique<HunspellChecker>(registry_)),
      custom_(std::move(custom_path)),
      capacity_(cache_capacity == 0 ? 1 : cache_capacity) {
    custom_.load();
    checker_->set_runtime_words(custom_.words());
}

std::vector<std::string> SpellService::resolve_langs(const std::vector<std::string>& langs,
                                                     std::vector<std::string>* unavailable) const {
    std::vector<std::string> tags;
    for (const std::string& lang : langs) {
        const Dictionary* d = registry_->resolve(lang);
        if (d == nullptr) {
            if (unavailable != nullptr) {
                unavailable->push_back(lang);
            }
            continue;
        }
        if (std::find(tags.begin(), tags.end(), d->tag) == tags.end()) {
            tags.push_back(d->tag);
        }
    }
    return tags;
}

namespace {

std::string langs_key(const std::vector<std::string>& tags) {
    std::string key;
    for (const std::string& t : tags) {
        key += t;
        key += ',';
    }
    return key;
}

}  // namespace

bool SpellService::cached(const std::string& key, bool* value) {
    std::lock_guard<std::mutex> lock(cache_mutex_);
    auto it = index_.find(key);
    if (it == index_.end()) {
        return false;
    }
    lru_.splice(lru_.begin(), lru_, it->second);  // move to front
    *value = it->second->second;
    return true;
}

void SpellService::remember(const std::string& key, bool value) {
    std::lock_guard<std::mutex> lock(cache_mutex_);
    auto it = index_.find(key);
    if (it != index_.end()) {
        it->second->second = value;
        lru_.splice(lru_.begin(), lru_, it->second);
        return;
    }
    lru_.emplace_front(key, value);
    index_[key] = lru_.begin();
    while (lru_.size() > capacity_) {
        index_.erase(lru_.back().first);
        lru_.pop_back();
    }
}

CheckResult SpellService::check(const std::vector<std::string>& words,
                                const std::vector<std::string>& langs) {
    CheckResult result;
    std::vector<std::string> unavailable;
    result.langs = resolve_langs(langs, &unavailable);
    if (result.langs.empty()) {
        throw SpellError(langs.empty() ? "" : langs.front(), "no dictionary for the language");
    }
    const std::string prefix = langs_key(result.langs) + '\x01';
    for (const std::string& word : words) {
        if (word.empty()) {
            continue;
        }
        const std::string key = prefix + word;
        bool ok = false;
        if (cached(key, &ok)) {
            ++result.cache_hits;
        } else {
            ok = custom_.contains(word);
            for (std::size_t i = 0; !ok && i < result.langs.size(); ++i) {
                ok = checker_->spell(result.langs[i], word);
            }
            remember(key, ok);
        }
        if (!ok) {
            result.misspelled.push_back(word);
        }
    }
    // De-duplicate while keeping the first occurrence order.
    std::vector<std::string> unique;
    unique.reserve(result.misspelled.size());
    std::unordered_map<std::string, bool> present;
    for (std::string& w : result.misspelled) {
        if (present.emplace(w, true).second) {
            unique.push_back(std::move(w));
        }
    }
    result.misspelled = std::move(unique);
    return result;
}

std::vector<std::string> SpellService::suggest(const std::string& word,
                                               const std::vector<std::string>& langs,
                                               std::size_t max) {
    const std::vector<std::string> tags = resolve_langs(langs);
    if (tags.empty()) {
        throw SpellError(langs.empty() ? "" : langs.front(), "no dictionary for the language");
    }
    std::vector<std::string> out;
    for (const std::string& tag : tags) {
        for (std::string& s : checker_->suggest(tag, word, max)) {
            if (out.size() >= max) {
                return out;
            }
            if (std::find(out.begin(), out.end(), s) == out.end()) {
                out.push_back(std::move(s));
            }
        }
    }
    return out;
}

std::string SpellService::add_word(const std::string& word) {
    const std::string error = custom_.add(word);
    if (!error.empty() && error != "duplicate") {
        return error;
    }
    checker_->add_word(word);
    clear_cache();
    return error;
}

bool SpellService::remove_word(const std::string& word) {
    // Only words the user added are removable; Hunspell's remove() would otherwise hide a
    // word of the bundled dictionary for the rest of the session.
    const bool existed = custom_.remove(word);
    if (existed) {
        checker_->remove_word(word);
        clear_cache();
    }
    return existed;
}

void SpellService::set_custom_path(const std::filesystem::path& path) {
    custom_.set_path(path);
    reload_custom();
}

void SpellService::reload_custom() {
    custom_.load();
    checker_->set_runtime_words(custom_.words());
    clear_cache();
}

void SpellService::clear_cache() {
    std::lock_guard<std::mutex> lock(cache_mutex_);
    lru_.clear();
    index_.clear();
}

std::size_t SpellService::cache_size() const {
    std::lock_guard<std::mutex> lock(cache_mutex_);
    return index_.size();
}

}  // namespace mfbe::spell
