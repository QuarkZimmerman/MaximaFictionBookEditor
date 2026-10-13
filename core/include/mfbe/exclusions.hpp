// Words-tool exclusion list (T019) - `exclusions.txt`: UTF-8, one word per line.
// Allowed characters: letters plus a single internal '-'.
#pragma once

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::settings {

// Validates one exclusion word (letters only, optionally one '-' that is neither first nor
// last). Returns an empty string when valid, otherwise the reason code:
// "empty" | "invalidUtf8" | "invalidCharacter" | "hyphenPosition" | "multipleHyphens".
std::string exclusion_word_error(std::string_view word);

class ExclusionList {
public:
    explicit ExclusionList(std::filesystem::path file);

    void load();        // missing -> empty; invalid lines skipped + logged
    bool save() const;  // atomic; one word per line, sorted, trailing newline

    const std::vector<std::string>& words() const { return words_; }
    bool contains(std::string_view word) const;

    // Adds a word (validated). Returns the error code or "" on success/duplicate. Saves.
    std::string add(std::string_view word);
    // Removes a word. Returns true when it existed. Saves.
    bool remove(std::string_view word);

    // Applies a batch: returns the error of the first invalid word to add ("" when all fine);
    // nothing is modified when any word is invalid.
    std::string apply(const std::vector<std::string>& add, const std::vector<std::string>& remove);

private:
    std::filesystem::path file_;
    std::vector<std::string> words_;  // kept sorted (byte order)
};

}  // namespace mfbe::settings
