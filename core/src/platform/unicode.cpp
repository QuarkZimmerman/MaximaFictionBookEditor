// UTF-8 helpers and an approximate letter classifier. See mfbe/unicode.hpp.
#include <mfbe/unicode.hpp>

#include <algorithm>
#include <array>

namespace mfbe::unicode {
namespace {

struct Range {
    char32_t first;
    char32_t last;
};

// Sorted, non-overlapping ranges of code points treated as letters.
constexpr std::array<Range, 44> kLetterRanges{{
    {0x0041, 0x005A},                    // A-Z
    {0x0061, 0x007A},                    // a-z
    {0x00AA, 0x00AA},                    // ª
    {0x00B5, 0x00B5},                    // µ
    {0x00BA, 0x00BA},                    // º
    {0x00C0, 0x00D6},                    // Latin-1 letters
    {0x00D8, 0x00F6}, {0x00F8, 0x02C1},  // Latin Extended-A/B, IPA, modifier letters
    {0x02C6, 0x02D1}, {0x02E0, 0x02E4}, {0x0370, 0x0373},  // Greek
    {0x0376, 0x0377}, {0x037B, 0x037D}, {0x0386, 0x0386},
    {0x0388, 0x03FF}, {0x0400, 0x0481},  // Cyrillic (letters before the combining marks)
    {0x048A, 0x052F},                    // Cyrillic (after the combining marks) + Supplement
    {0x0531, 0x0556},                    // Armenian
    {0x0560, 0x0588}, {0x05D0, 0x05EA},  // Hebrew
    {0x05EF, 0x05F2}, {0x0620, 0x064A},  // Arabic
    {0x066E, 0x066F}, {0x0671, 0x06D3}, {0x06FA, 0x06FC},
    {0x0904, 0x0939},                    // Devanagari (letters only)
    {0x0958, 0x0961}, {0x0985, 0x09B9},  // Bengali (approximate)
    {0x0E01, 0x0E30},                    // Thai consonants
    {0x10A0, 0x10FA},                    // Georgian
    {0x10FC, 0x10FF}, {0x1100, 0x11FF},  // Hangul Jamo
    {0x1C80, 0x1C88},                    // Cyrillic Extended-C
    {0x1E00, 0x1FBC},                    // Latin Extended Additional, Greek Extended (approximate)
    {0x1FC2, 0x1FFC}, {0x2C60, 0x2C7F},  // Latin Extended-C
    {0x3041, 0x3096},                    // Hiragana
    {0x30A1, 0x30FA},                    // Katakana
    {0x3400, 0x4DBF},                    // CJK Extension A
    {0x4E00, 0x9FFF},                    // CJK Unified Ideographs
    {0xA640, 0xA66E},                    // Cyrillic Extended-B (letters)
    {0xA722, 0xA7FF},                    // Latin Extended-D (approximate)
    {0xAB30, 0xAB6F},                    // Latin Extended-E
    {0xAC00, 0xD7A3},                    // Hangul syllables
}};

}  // namespace

std::vector<char32_t> decode_utf8(std::string_view text, bool* ok) {
    std::vector<char32_t> out;
    out.reserve(text.size());
    bool valid = true;
    std::size_t i = 0;
    while (i < text.size()) {
        const auto b0 = static_cast<unsigned char>(text[i]);
        std::size_t len = 0;
        char32_t cp = 0;
        char32_t min = 0;
        if (b0 < 0x80) {
            out.push_back(b0);
            ++i;
            continue;
        } else if ((b0 & 0xE0) == 0xC0) {
            len = 2;
            cp = b0 & 0x1F;
            min = 0x80;
        } else if ((b0 & 0xF0) == 0xE0) {
            len = 3;
            cp = b0 & 0x0F;
            min = 0x800;
        } else if ((b0 & 0xF8) == 0xF0) {
            len = 4;
            cp = b0 & 0x07;
            min = 0x10000;
        } else {
            valid = false;
            out.push_back(0xFFFD);
            ++i;
            continue;
        }
        if (i + len > text.size()) {
            valid = false;
            out.push_back(0xFFFD);
            break;
        }
        bool bad = false;
        for (std::size_t k = 1; k < len; ++k) {
            const auto b = static_cast<unsigned char>(text[i + k]);
            if ((b & 0xC0) != 0x80) {
                bad = true;
                break;
            }
            cp = (cp << 6) | (b & 0x3F);
        }
        if (bad || cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
            valid = false;
            out.push_back(0xFFFD);
            ++i;
            continue;
        }
        out.push_back(cp);
        i += len;
    }
    if (ok != nullptr) {
        *ok = valid;
    }
    return out;
}

void append_utf8(std::string& out, char32_t cp) {
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

bool is_valid_utf8(std::string_view text) {
    bool ok = true;
    (void)decode_utf8(text, &ok);
    return ok;
}

bool is_letter(char32_t cp) {
    auto it = std::upper_bound(kLetterRanges.begin(), kLetterRanges.end(), cp,
                               [](char32_t value, const Range& r) { return value < r.first; });
    if (it == kLetterRanges.begin()) {
        return false;
    }
    --it;
    return cp >= it->first && cp <= it->last;
}

std::size_t length(std::string_view text) {
    return decode_utf8(text).size();
}

}  // namespace mfbe::unicode
