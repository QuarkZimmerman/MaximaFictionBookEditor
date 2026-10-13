// Small UTF-8 / Unicode helpers shared by settings validation, exclusions and the Words tool.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::unicode {

// Decodes UTF-8 into code points. Invalid sequences yield U+FFFD and `ok` (if given) = false.
std::vector<char32_t> decode_utf8(std::string_view text, bool* ok = nullptr);

// Encodes a code point as UTF-8 (appends to `out`).
void append_utf8(std::string& out, char32_t cp);

// True when `text` is well-formed UTF-8.
bool is_valid_utf8(std::string_view text);

// Approximate Unicode "letter" test (general categories L*) covering Latin, Greek, Cyrillic,
// Armenian, Hebrew, Arabic, Georgian, the major Indic blocks, CJK, Kana and Hangul.
bool is_letter(char32_t cp);

// Number of code points in a UTF-8 string (invalid bytes count as one each).
std::size_t length(std::string_view text);

}  // namespace mfbe::unicode
