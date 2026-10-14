// Words-tool exclusion list (T019). See mfbe/exclusions.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/exclusions.hpp>
#include <mfbe/log.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <sstream>
#include <system_error>

namespace mfbe::settings {
namespace {

std::string trim(std::string_view line) {
    std::size_t begin = 0;
    std::size_t end = line.size();
    while (begin < end && (line[begin] == ' ' || line[begin] == '\t' || line[begin] == '\r')) {
        ++begin;
    }
    while (end > begin &&
           (line[end - 1] == ' ' || line[end - 1] == '\t' || line[end - 1] == '\r')) {
        --end;
    }
    return std::string(line.substr(begin, end - begin));
}

std::string strip_bom(std::string text) {
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB &&
        static_cast<unsigned char>(text[2]) == 0xBF) {
        text.erase(0, 3);
    }
    return text;
}

}  // namespace

std::string exclusion_word_error(std::string_view word) {
    if (word.empty()) {
        return "empty";
    }
    bool ok = true;
    const auto cps = unicode::decode_utf8(word, &ok);
    if (!ok) {
        return "invalidUtf8";
    }
    std::size_t hyphens = 0;
    for (std::size_t i = 0; i < cps.size(); ++i) {
        const char32_t cp = cps[i];
        if (cp == U'-') {
            if (i == 0 || i + 1 == cps.size()) {
                return "hyphenPosition";
            }
            if (++hyphens > 1) {
                return "multipleHyphens";
            }
            continue;
        }
        if (!unicode::is_letter(cp)) {
            return "invalidCharacter";
        }
    }
    return "";
}

ExclusionList::ExclusionList(std::filesystem::path file) : file_(std::move(file)) {}

void ExclusionList::load() {
    words_.clear();
    std::error_code ec;
    if (!std::filesystem::exists(file_, ec)) {
        return;
    }
    std::string text;
    try {
        text = strip_bom(atomic_file::read_file(file_));
    } catch (const atomic_file::WriteError& e) {
        log::error("core", "exclusions.unreadable", "exclusions.txt could not be read",
                   log::extras({{"path", e.path}, {"reason", e.reason}}));
        return;
    }
    std::istringstream in(text);
    std::string line;
    std::size_t skipped = 0;
    while (std::getline(in, line)) {
        const std::string word = trim(line);
        if (word.empty()) {
            continue;
        }
        if (!exclusion_word_error(word).empty()) {
            ++skipped;
            continue;
        }
        words_.push_back(word);
    }
    std::sort(words_.begin(), words_.end());
    words_.erase(std::unique(words_.begin(), words_.end()), words_.end());
    if (skipped > 0) {
        log::warning("core", "exclusions.invalidLines", "exclusions.txt contains invalid words",
                     log::extras({{"path", platform::utf8_from_path(file_)},
                                  {"skipped", std::to_string(skipped)}}));
    }
}

bool ExclusionList::save() const {
    std::string text;
    for (const auto& w : words_) {
        text += w;
        text += '\n';
    }
    try {
        std::error_code ec;
        std::filesystem::create_directories(file_.parent_path(), ec);
        atomic_file::write_atomic(file_, text);
        return true;
    } catch (const atomic_file::WriteError& e) {
        log::error("core", "exclusions.writeFailed", "exclusions.txt could not be written",
                   log::extras({{"path", e.path}, {"reason", e.reason}}));
        return false;
    }
}

bool ExclusionList::contains(std::string_view word) const {
    return std::binary_search(words_.begin(), words_.end(), word);
}

std::string ExclusionList::add(std::string_view word) {
    return apply({std::string(word)}, {});
}

bool ExclusionList::remove(std::string_view word) {
    auto it = std::lower_bound(words_.begin(), words_.end(), word);
    if (it == words_.end() || *it != word) {
        return false;
    }
    words_.erase(it);
    save();
    return true;
}

std::string ExclusionList::apply(const std::vector<std::string>& add,
                                 const std::vector<std::string>& remove_words) {
    for (const auto& w : add) {
        const std::string err = exclusion_word_error(w);
        if (!err.empty()) {
            return err;
        }
    }
    for (const auto& w : remove_words) {
        auto it = std::lower_bound(words_.begin(), words_.end(), w);
        if (it != words_.end() && *it == w) {
            words_.erase(it);
        }
    }
    for (const auto& w : add) {
        auto it = std::lower_bound(words_.begin(), words_.end(), w);
        if (it == words_.end() || *it != w) {
            words_.insert(it, w);
        }
    }
    save();
    return "";
}

}  // namespace mfbe::settings
