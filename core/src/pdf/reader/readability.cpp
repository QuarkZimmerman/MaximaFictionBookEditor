// Feature 016 (D19, DP-9; research R7): how readable a text layer is - the share of its tokens that
// are plain words in one script, as the probe of spec §4 measured it (readable layers 0.69 and
// above, failed recognition 0.43 and 0.51). Digits, stray marks, letters of two scripts in one word
// and letters outside the writing systems (IPA, combining marks alone) make a token no word.
#include "pdf/reader/reader.hpp"

#include <mfbe/unicode.hpp>

#include <string_view>

namespace mfbe::pdf_reader {

namespace {

enum class Script { none, latin, greek, cyrillic, armenian, hebrew, arabic, indic, georgian, cjk };

Script script_of(char32_t c) {
    if (c < 0x250 || (c >= 0x1E00 && c <= 0x1EFF)) {
        return Script::latin;
    }
    if ((c >= 0x370 && c <= 0x3FF) || (c >= 0x1F00 && c <= 0x1FFF)) {
        return Script::greek;
    }
    if ((c >= 0x400 && c <= 0x52F) || (c >= 0x2DE0 && c <= 0x2DFF) ||
        (c >= 0xA640 && c <= 0xA69F)) {
        return Script::cyrillic;
    }
    if (c >= 0x530 && c <= 0x58F) {
        return Script::armenian;
    }
    if (c >= 0x590 && c <= 0x5FF) {
        return Script::hebrew;
    }
    if ((c >= 0x600 && c <= 0x6FF) || (c >= 0x750 && c <= 0x77F)) {
        return Script::arabic;
    }
    if (c >= 0x900 && c <= 0xDFF) {
        return Script::indic;
    }
    if (c >= 0x10A0 && c <= 0x10FF) {
        return Script::georgian;
    }
    if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x3400 && c <= 0x4DBF) ||
        (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF) ||
        (c >= 0xF900 && c <= 0xFAFF)) {
        return Script::cjk;
    }
    return Script::none;
}

constexpr std::u32string_view kOpening = U"«\"([„“‘'‹";
constexpr std::u32string_view kClosing = U"]),.;:!?»\"…-–—”’'›\u00ad";
constexpr std::u32string_view kInner = U"-'’\u00ad";

}  // namespace

bool is_plain_word(std::string_view token) {
    const std::vector<char32_t> cps = unicode::decode_utf8(token);
    std::size_t begin = 0;
    std::size_t end = cps.size();
    while (begin < end && kOpening.find(cps[begin]) != std::u32string_view::npos) {
        ++begin;
    }
    while (end > begin && kClosing.find(cps[end - 1]) != std::u32string_view::npos) {
        --end;
    }
    if (begin == end) {
        return false;
    }
    Script script = Script::none;
    for (std::size_t i = begin; i < end; ++i) {
        const char32_t c = cps[i];
        // A hyphen or an apostrophe inside a word ("из-за", "don't") keeps it a word.
        if (i > begin && i + 1 < end && kInner.find(c) != std::u32string_view::npos) {
            continue;
        }
        if (!unicode::is_letter(c)) {
            return false;
        }
        const Script s = script_of(c);
        if (s == Script::none || (script != Script::none && s != script)) {
            return false;
        }
        script = s;
    }
    return script != Script::none;
}

Readability readability(const nlohmann::json& words) {
    Readability r;
    for (const auto& word : words) {
        const std::string text = word.value("t", "");
        if (text.empty()) {
            continue;
        }
        ++r.tokens;
        r.plain += is_plain_word(text) ? 1 : 0;
    }
    return r;
}

}  // namespace mfbe::pdf_reader
