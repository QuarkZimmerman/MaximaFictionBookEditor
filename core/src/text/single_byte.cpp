// Feature 017 (PD2, DP-2). See mfbe/single_byte.hpp.

#include <mfbe/single_byte.hpp>

#include <algorithm>
#include <array>
#include <cstdint>
#include <utility>

namespace mfbe::text {
namespace {

struct SingleByteIndex {
    std::string_view name;
    std::array<std::uint16_t, 128> high;  // the code points of the bytes 0x80-0xFF, 0 for none
};

constexpr SingleByteIndex kIndexes[] = {
#include "single_byte_tables.inc"
};

const SingleByteIndex* index_for(std::string_view name) {
    for (const auto& index : kIndexes) {
        if (index.name == name) {
            return &index;
        }
    }
    return nullptr;
}

// Contract §"Encoding": the plain forms of typographic characters (D12 as approved).
std::string_view plain_form(char32_t c) {
    switch (c) {
        case 0x00AB:
        case 0x00BB:
        case 0x201E:
        case 0x201C:
        case 0x201D:
        case 0x201F:
            return "\"";
        case 0x2018:
        case 0x2019:
        case 0x201A:
        case 0x201B:
        case 0x02BC:
            return "'";
        case 0x2010:
        case 0x2011:
        case 0x2014:
        case 0x2013:
        case 0x2012:
        case 0x2015:
            return "-";
        case 0x2026:
            return "...";
        case 0x00A0:
        case 0x2007:
        case 0x202F:
        case 0xE088:
        case 0xF04A:
            return " ";
        case 0x2116:
            return "No.";
        case 0x2022:
            return "*";
        case 0x2039:
            return "<";
        case 0x203A:
            return ">";
        case 0x2122:
            return "(TM)";
        case 0x00A9:
            return "(C)";
        case 0x00AE:
            return "(R)";
        default:
            break;
    }
    if (c >= 0x2000 && c <= 0x200A) {
        return " ";
    }
    return {};
}

// Invisible formatting characters, left out when the encoding cannot write them.
bool invisible(char32_t c) {
    return (c >= 0x200B && c <= 0x200F) || (c >= 0x2028 && c <= 0x202E) ||
           (c >= 0x2060 && c <= 0x2064) || c == 0xFEFF || c == 0xFFFC || c == 0xE06E ||
           (c >= 0xFE00 && c <= 0xFE0F) || (c >= 0xE0100 && c <= 0xE01EF);
}

// Reads one code point at `i`; an invalid sequence gives U+FFFD and advances one byte.
char32_t next_code_point(std::string_view s, std::size_t& i) {
    const auto b0 = static_cast<unsigned char>(s[i]);
    const auto cont = [&](std::size_t k) -> int {
        if (i + k >= s.size())
            return -1;
        const auto b = static_cast<unsigned char>(s[i + k]);
        return (b & 0xC0u) == 0x80u ? static_cast<int>(b & 0x3Fu) : -1;
    };
    if (b0 < 0x80) {
        ++i;
        return b0;
    }
    if (b0 >= 0xC2 && b0 < 0xE0) {
        const int c1 = cont(1);
        if (c1 >= 0) {
            i += 2;
            return (static_cast<char32_t>(b0 & 0x1Fu) << 6) | static_cast<char32_t>(c1);
        }
    } else if (b0 >= 0xE0 && b0 < 0xF0) {
        const int c1 = cont(1), c2 = cont(2);
        if (c1 >= 0 && c2 >= 0) {
            const char32_t cp = (static_cast<char32_t>(b0 & 0x0Fu) << 12) |
                                (static_cast<char32_t>(c1) << 6) | static_cast<char32_t>(c2);
            if (cp >= 0x800 && (cp < 0xD800 || cp > 0xDFFF)) {
                i += 3;
                return cp;
            }
        }
    } else if (b0 >= 0xF0 && b0 < 0xF5) {
        const int c1 = cont(1), c2 = cont(2), c3 = cont(3);
        if (c1 >= 0 && c2 >= 0 && c3 >= 0) {
            const char32_t cp = (static_cast<char32_t>(b0 & 0x07u) << 18) |
                                (static_cast<char32_t>(c1) << 12) |
                                (static_cast<char32_t>(c2) << 6) | static_cast<char32_t>(c3);
            if (cp >= 0x10000 && cp <= 0x10FFFF) {
                i += 4;
                return cp;
            }
        }
    }
    ++i;
    return 0xFFFD;
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

}  // namespace

const std::vector<std::string>& single_byte_names() {
    static const std::vector<std::string> names = [] {
        std::vector<std::string> out;
        for (const auto& index : kIndexes) {
            out.emplace_back(index.name);
        }
        return out;
    }();
    return names;
}

bool is_single_byte(std::string_view name) {
    return index_for(name) != nullptr;
}

const std::uint16_t* single_byte_high(std::string_view name) {
    const SingleByteIndex* index = index_for(name);
    return index == nullptr ? nullptr : index->high.data();
}

std::optional<Encoded> encode_single_byte(std::string_view utf8, std::string_view name) {
    const SingleByteIndex* index = index_for(name);
    if (index == nullptr) {
        return std::nullopt;
    }
    // The reverse table: code point -> byte, sorted for a binary search.
    std::vector<std::pair<char32_t, unsigned char>> reverse;
    reverse.reserve(128);
    for (std::size_t k = 0; k < 128; ++k) {
        if (index->high[k] != 0) {
            reverse.emplace_back(index->high[k], static_cast<unsigned char>(0x80 + k));
        }
    }
    std::sort(reverse.begin(), reverse.end());
    const auto byte_of = [&](char32_t cp) -> int {
        const auto it = std::lower_bound(reverse.begin(), reverse.end(),
                                         std::make_pair(cp, static_cast<unsigned char>(0)));
        return it != reverse.end() && it->first == cp ? it->second : -1;
    };
    Encoded out;
    out.bytes.reserve(utf8.size());
    const auto note = [&](char32_t c, std::string_view as) {
        for (auto& r : out.replaced) {
            if (r.character == c) {
                ++r.count;
                return;
            }
        }
        out.replaced.push_back(Replacement{c, std::string(as), 1});
    };
    for (std::size_t i = 0; i < utf8.size();) {
        const char32_t cp = next_code_point(utf8, i);
        if (cp < 0x80) {
            out.bytes.push_back(static_cast<char>(cp));
            continue;
        }
        if (cp == 0x00AD) {
            continue;  // soft hyphens are left out in every encoding, uncounted (D12)
        }
        if (const int b = byte_of(cp); b >= 0) {
            out.bytes.push_back(static_cast<char>(b));
            continue;
        }
        if (const std::string_view plain = plain_form(cp); !plain.empty()) {
            out.bytes.append(plain);
            note(cp, plain);
        } else if (invisible(cp)) {
            note(cp, "");
        } else {
            out.bytes.push_back('?');
            note(cp, "?");
        }
    }
    return out;
}

std::string utf8_without_soft_hyphens(std::string_view utf8) {
    std::string out;
    out.reserve(utf8.size());
    for (std::size_t i = 0; i < utf8.size(); ++i) {
        if (i + 1 < utf8.size() && static_cast<unsigned char>(utf8[i]) == 0xC2 &&
            static_cast<unsigned char>(utf8[i + 1]) == 0xAD) {
            ++i;
            continue;
        }
        out.push_back(utf8[i]);
    }
    return out;
}

std::optional<std::string> decode_single_byte(std::string_view bytes, std::string_view name,
                                              std::size_t* unmapped) {
    const SingleByteIndex* index = index_for(name);
    if (index == nullptr) {
        return std::nullopt;
    }
    std::string out;
    out.reserve(bytes.size() * 2);
    std::size_t missing = 0;
    for (const char ch : bytes) {
        const auto b = static_cast<unsigned char>(ch);
        if (b < 0x80) {
            out.push_back(ch);
            continue;
        }
        const char32_t cp = index->high[b - 0x80];
        if (cp == 0) {
            ++missing;
            append_utf8(out, 0xFFFD);
        } else {
            append_utf8(out, cp);
        }
    }
    if (unmapped != nullptr) {
        *unmapped = missing;
    }
    return out;
}

}  // namespace mfbe::text
