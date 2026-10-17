// Hunspell wrapper (T086). See mfbe/spell.hpp.
//
// One Hunspell object per dictionary tag, created on first use and guarded by its own mutex
// (Hunspell is not thread-safe). Words travel as UTF-8; when a dictionary declares another
// encoding (`SET` line, reported by get_dic_encoding()) the word is converted with the table
// converters of mfbe/encodings.hpp. An encoding the core cannot convert is an error (the
// registry rejects such a pair before it gets here - feature 003 US4); there is no UTF-8
// fallback that would check words against bytes of another encoding. Every instance remembers
// the size and modification time of its two files, so `drop_stale()` can retire it when the
// files change or disappear.
#include <mfbe/encodings.hpp>
#include <mfbe/log.hpp>
#include <mfbe/spell.hpp>
#include <mfbe/utf8_paths.hpp>

#include <hunspell/hunspell.hxx>

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <system_error>

namespace mfbe::spell {
namespace {

// Identity of a dictionary file as loaded: path, size and modification time.
struct FileStamp {
    std::filesystem::path path;
    std::uintmax_t size = 0;
    std::filesystem::file_time_type modified{};

    bool operator==(const FileStamp& other) const {
        return path == other.path && size == other.size && modified == other.modified;
    }
};

FileStamp stamp_of(const std::filesystem::path& file) {
    FileStamp stamp;
    stamp.path = file;
    std::error_code ec;
    stamp.size = std::filesystem::file_size(file, ec);
    if (ec) {
        stamp.size = 0;
    }
    stamp.modified = std::filesystem::last_write_time(file, ec);
    if (ec) {
        stamp.modified = std::filesystem::file_time_type{};
    }
    return stamp;
}

// Name under which Hunspell opens a dictionary file. Hunspell 1.7 opens its files by a narrow
// name (myopen() in src/hunspell/csutil.cxx): on Windows a name that starts with the long-path
// prefix \\?\ is read as UTF-8 and opened with the wide API, any other name in the process
// code page. Windows therefore gets the prefixed absolute path (backslashes only: the prefix
// turns off path normalisation); elsewhere the UTF-8 path is the file name.
std::string hunspell_file_name(const std::filesystem::path& file) {
#ifdef _WIN32
    std::error_code ec;
    const std::filesystem::path absolute = std::filesystem::absolute(file, ec);
    const std::string text = platform::utf8_from_path((ec ? file : absolute).lexically_normal());
    if (text.rfind("\\\\?\\", 0) == 0) {
        return text;
    }
    if (text.rfind("\\\\", 0) == 0) {
        return "\\\\?\\UNC\\" + text.substr(2);  // \\server\share -> \\?\UNC\server\share
    }
    return "\\\\?\\" + text;
#else
    return platform::utf8_from_path(file);
#endif
}

}  // namespace

struct HunspellChecker::Instance {
    std::mutex mutex;
    std::unique_ptr<Hunspell> engine;
    std::string encoding;  // canonical dictionary encoding ("utf-8" = no conversion)
    FileStamp aff;         // the files as they were when the instance was created
    FileStamp dic;

    std::string to_dic(const std::string& utf8) const {
        if (encoding == encoding::kUtf8) {
            return utf8;
        }
        return encoding::encode_from_utf8(utf8, encoding, false).bytes;
    }
    std::string from_dic(const std::string& bytes) const {
        if (encoding == encoding::kUtf8) {
            return bytes;
        }
        return encoding::decode_to_utf8(bytes, encoding).utf8;
    }
};

HunspellChecker::HunspellChecker(std::shared_ptr<DictionaryRegistry> registry)
    : registry_(std::move(registry)) {}

HunspellChecker::~HunspellChecker() = default;

std::shared_ptr<HunspellChecker::Instance> HunspellChecker::instance(const std::string& tag) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = instances_.find(tag);
    if (it != instances_.end()) {
        return it->second;
    }
    const Dictionary* dictionary = nullptr;
    for (const Dictionary& d : registry_->dictionaries()) {
        if (d.tag == tag) {
            dictionary = &d;
            break;
        }
    }
    if (dictionary == nullptr) {
        throw SpellError(tag, "no dictionary with this tag");
    }
    std::error_code ec;
    if (!std::filesystem::is_regular_file(dictionary->aff, ec) ||
        !std::filesystem::is_regular_file(dictionary->dic, ec)) {
        throw SpellError(tag,
                         "dictionary files missing: " + platform::utf8_from_path(dictionary->aff));
    }
    auto inst = std::make_shared<Instance>();
    // The stamps are taken before the files are read: a change racing with the load makes the
    // instance stale at the next refresh rather than silently current.
    inst->aff = stamp_of(dictionary->aff);
    inst->dic = stamp_of(dictionary->dic);
    inst->engine = std::make_unique<Hunspell>(hunspell_file_name(dictionary->aff).c_str(),
                                              hunspell_file_name(dictionary->dic).c_str());
    const char* enc = inst->engine->get_dic_encoding();
    const std::string declared = enc == nullptr ? "" : enc;
    const std::optional<std::string> canonical = dictionary_encoding(declared);
    if (!canonical) {
        // The registry keeps such pairs out of `dictionaries()`; this guards a file edited
        // after the last refresh.
        log::warning("core", "spell.dictionaryEncoding", "dictionary encoding not supported",
                     log::extras({{"tag", tag}, {"encoding", declared}}));
        throw SpellError(tag, "unsupported dictionary encoding: " + declared);
    }
    inst->encoding = *canonical;
    for (const std::string& word : runtime_words_) {
        inst->engine->add(inst->to_dic(word));
    }
    instances_[tag] = inst;
    return inst;
}

std::size_t HunspellChecker::drop_stale() {
    std::lock_guard<std::mutex> lock(mutex_);
    std::size_t dropped = 0;
    for (auto it = instances_.begin(); it != instances_.end();) {
        const Dictionary* current = nullptr;
        for (const Dictionary& d : registry_->dictionaries()) {
            if (d.tag == it->first) {
                current = &d;
                break;
            }
        }
        const bool stale = current == nullptr || !(stamp_of(current->aff) == it->second->aff) ||
                           !(stamp_of(current->dic) == it->second->dic);
        if (stale) {
            it = instances_.erase(it);
            ++dropped;
        } else {
            ++it;
        }
    }
    return dropped;
}

bool HunspellChecker::spell(const std::string& tag, const std::string& word) {
    auto inst = instance(tag);
    std::lock_guard<std::mutex> lock(inst->mutex);
    return inst->engine->spell(inst->to_dic(word));
}

std::vector<std::string> HunspellChecker::suggest(const std::string& tag, const std::string& word,
                                                  std::size_t max) {
    auto inst = instance(tag);
    std::vector<std::string> raw;
    {
        std::lock_guard<std::mutex> lock(inst->mutex);
        raw = inst->engine->suggest(inst->to_dic(word));
    }
    std::vector<std::string> out;
    for (const std::string& s : raw) {
        if (out.size() >= max) {
            break;
        }
        out.push_back(inst->from_dic(s));
    }
    return out;
}

void HunspellChecker::add_word(const std::string& word) {
    std::vector<std::shared_ptr<Instance>> loaded;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (std::find(runtime_words_.begin(), runtime_words_.end(), word) == runtime_words_.end()) {
            runtime_words_.push_back(word);
        }
        for (auto& [tag, inst] : instances_) {
            loaded.push_back(inst);
        }
    }
    for (auto& inst : loaded) {
        std::lock_guard<std::mutex> lock(inst->mutex);
        inst->engine->add(inst->to_dic(word));
    }
}

void HunspellChecker::remove_word(const std::string& word) {
    std::vector<std::shared_ptr<Instance>> loaded;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        runtime_words_.erase(std::remove(runtime_words_.begin(), runtime_words_.end(), word),
                             runtime_words_.end());
        for (auto& [tag, inst] : instances_) {
            loaded.push_back(inst);
        }
    }
    for (auto& inst : loaded) {
        std::lock_guard<std::mutex> lock(inst->mutex);
        inst->engine->remove(inst->to_dic(word));
    }
}

void HunspellChecker::set_runtime_words(std::vector<std::string> words) {
    std::vector<std::string> previous;
    std::vector<std::shared_ptr<Instance>> loaded;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        previous = std::move(runtime_words_);
        runtime_words_ = std::move(words);
        for (auto& [tag, inst] : instances_) {
            loaded.push_back(inst);
        }
        words = runtime_words_;
    }
    for (auto& inst : loaded) {
        std::lock_guard<std::mutex> lock(inst->mutex);
        for (const std::string& w : previous) {
            if (std::find(words.begin(), words.end(), w) == words.end()) {
                inst->engine->remove(inst->to_dic(w));
            }
        }
        for (const std::string& w : words) {
            inst->engine->add(inst->to_dic(w));
        }
    }
}

void HunspellChecker::preload(const std::string& tag) {
    (void)instance(tag);
}

std::size_t HunspellChecker::loaded_count() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return instances_.size();
}

}  // namespace mfbe::spell
