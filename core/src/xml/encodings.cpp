// Table-driven legacy encodings and their libxml2 registration (T040). See mfbe/encodings.hpp.
#include <mfbe/encodings.hpp>

#include <libxml/encoding.h>
#include <libxml/parser.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <stdexcept>
#include <unordered_map>

namespace mfbe::encoding {
namespace {

/* ----------------------------------------------------------------------------------------- */
/* Single-byte tables: code points for bytes 0x80..0xFF (0 = undefined). Generated from the   */
/* Unicode mapping tables (via Python's codecs) - see tests/core/test_encodings.cpp.          */
/* ----------------------------------------------------------------------------------------- */

using Table = std::array<char16_t, 128>;

constexpr Table kWindows1251 = {
    0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021, 0x20AC, 0x2030, 0x0409, 0x2039,
    0x040A, 0x040C, 0x040B, 0x040F, 0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x0000, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F, 0x00A0, 0x040E, 0x045E, 0x0408,
    0x00A4, 0x0490, 0x00A6, 0x00A7, 0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
    0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7, 0x0451, 0x2116, 0x0454, 0x00BB,
    0x0458, 0x0405, 0x0455, 0x0457, 0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
    0x0418, 0x0419, 0x041A, 0x041B, 0x041C, 0x041D, 0x041E, 0x041F, 0x0420, 0x0421, 0x0422, 0x0423,
    0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042A, 0x042B, 0x042C, 0x042D, 0x042E, 0x042F,
    0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043A, 0x043B,
    0x043C, 0x043D, 0x043E, 0x043F, 0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
    0x0448, 0x0449, 0x044A, 0x044B, 0x044C, 0x044D, 0x044E, 0x044F,
};

constexpr Table kWindows1252 = {
    0x20AC, 0x0000, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039,
    0x0152, 0x0000, 0x017D, 0x0000, 0x0000, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x0000, 0x017E, 0x0178, 0x00A0, 0x00A1, 0x00A2, 0x00A3,
    0x00A4, 0x00A5, 0x00A6, 0x00A7, 0x00A8, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF,
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, 0x00B8, 0x00B9, 0x00BA, 0x00BB,
    0x00BC, 0x00BD, 0x00BE, 0x00BF, 0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7,
    0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, 0x00D0, 0x00D1, 0x00D2, 0x00D3,
    0x00D4, 0x00D5, 0x00D6, 0x00D7, 0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00DE, 0x00DF,
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7, 0x00E8, 0x00E9, 0x00EA, 0x00EB,
    0x00EC, 0x00ED, 0x00EE, 0x00EF, 0x00F0, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7,
    0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF,
};

// ISO-8859-1 maps every byte to the same code point; the table is generated at start-up.
constexpr Table make_latin1() {
    Table t{};
    for (std::size_t i = 0; i < t.size(); ++i) {
        t[i] = static_cast<char16_t>(0x80 + i);
    }
    return t;
}
constexpr Table kIso88591 = make_latin1();

constexpr Table kIso88592 = {
    0x0080, 0x0081, 0x0082, 0x0083, 0x0084, 0x0085, 0x0086, 0x0087, 0x0088, 0x0089, 0x008A, 0x008B,
    0x008C, 0x008D, 0x008E, 0x008F, 0x0090, 0x0091, 0x0092, 0x0093, 0x0094, 0x0095, 0x0096, 0x0097,
    0x0098, 0x0099, 0x009A, 0x009B, 0x009C, 0x009D, 0x009E, 0x009F, 0x00A0, 0x0104, 0x02D8, 0x0141,
    0x00A4, 0x013D, 0x015A, 0x00A7, 0x00A8, 0x0160, 0x015E, 0x0164, 0x0179, 0x00AD, 0x017D, 0x017B,
    0x00B0, 0x0105, 0x02DB, 0x0142, 0x00B4, 0x013E, 0x015B, 0x02C7, 0x00B8, 0x0161, 0x015F, 0x0165,
    0x017A, 0x02DD, 0x017E, 0x017C, 0x0154, 0x00C1, 0x00C2, 0x0102, 0x00C4, 0x0139, 0x0106, 0x00C7,
    0x010C, 0x00C9, 0x0118, 0x00CB, 0x011A, 0x00CD, 0x00CE, 0x010E, 0x0110, 0x0143, 0x0147, 0x00D3,
    0x00D4, 0x0150, 0x00D6, 0x00D7, 0x0158, 0x016E, 0x00DA, 0x0170, 0x00DC, 0x00DD, 0x0162, 0x00DF,
    0x0155, 0x00E1, 0x00E2, 0x0103, 0x00E4, 0x013A, 0x0107, 0x00E7, 0x010D, 0x00E9, 0x0119, 0x00EB,
    0x011B, 0x00ED, 0x00EE, 0x010F, 0x0111, 0x0144, 0x0148, 0x00F3, 0x00F4, 0x0151, 0x00F6, 0x00F7,
    0x0159, 0x016F, 0x00FA, 0x0171, 0x00FC, 0x00FD, 0x0163, 0x02D9,
};

constexpr Table kIso88595 = {
    0x0080, 0x0081, 0x0082, 0x0083, 0x0084, 0x0085, 0x0086, 0x0087, 0x0088, 0x0089, 0x008A, 0x008B,
    0x008C, 0x008D, 0x008E, 0x008F, 0x0090, 0x0091, 0x0092, 0x0093, 0x0094, 0x0095, 0x0096, 0x0097,
    0x0098, 0x0099, 0x009A, 0x009B, 0x009C, 0x009D, 0x009E, 0x009F, 0x00A0, 0x0401, 0x0402, 0x0403,
    0x0404, 0x0405, 0x0406, 0x0407, 0x0408, 0x0409, 0x040A, 0x040B, 0x040C, 0x00AD, 0x040E, 0x040F,
    0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x0419, 0x041A, 0x041B,
    0x041C, 0x041D, 0x041E, 0x041F, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
    0x0428, 0x0429, 0x042A, 0x042B, 0x042C, 0x042D, 0x042E, 0x042F, 0x0430, 0x0431, 0x0432, 0x0433,
    0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F,
    0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044A, 0x044B,
    0x044C, 0x044D, 0x044E, 0x044F, 0x2116, 0x0451, 0x0452, 0x0453, 0x0454, 0x0455, 0x0456, 0x0457,
    0x0458, 0x0459, 0x045A, 0x045B, 0x045C, 0x00A7, 0x045E, 0x045F,
};

constexpr Table kIso885915 = {
    0x0080, 0x0081, 0x0082, 0x0083, 0x0084, 0x0085, 0x0086, 0x0087, 0x0088, 0x0089, 0x008A, 0x008B,
    0x008C, 0x008D, 0x008E, 0x008F, 0x0090, 0x0091, 0x0092, 0x0093, 0x0094, 0x0095, 0x0096, 0x0097,
    0x0098, 0x0099, 0x009A, 0x009B, 0x009C, 0x009D, 0x009E, 0x009F, 0x00A0, 0x00A1, 0x00A2, 0x00A3,
    0x20AC, 0x00A5, 0x0160, 0x00A7, 0x0161, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF,
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x017D, 0x00B5, 0x00B6, 0x00B7, 0x017E, 0x00B9, 0x00BA, 0x00BB,
    0x0152, 0x0153, 0x0178, 0x00BF, 0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7,
    0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, 0x00D0, 0x00D1, 0x00D2, 0x00D3,
    0x00D4, 0x00D5, 0x00D6, 0x00D7, 0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00DE, 0x00DF,
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7, 0x00E8, 0x00E9, 0x00EA, 0x00EB,
    0x00EC, 0x00ED, 0x00EE, 0x00EF, 0x00F0, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7,
    0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF,
};

constexpr Table kKoi8R = {
    0x2500, 0x2502, 0x250C, 0x2510, 0x2514, 0x2518, 0x251C, 0x2524, 0x252C, 0x2534, 0x253C, 0x2580,
    0x2584, 0x2588, 0x258C, 0x2590, 0x2591, 0x2592, 0x2593, 0x2320, 0x25A0, 0x2219, 0x221A, 0x2248,
    0x2264, 0x2265, 0x00A0, 0x2321, 0x00B0, 0x00B2, 0x00B7, 0x00F7, 0x2550, 0x2551, 0x2552, 0x0451,
    0x2553, 0x2554, 0x2555, 0x2556, 0x2557, 0x2558, 0x2559, 0x255A, 0x255B, 0x255C, 0x255D, 0x255E,
    0x255F, 0x2560, 0x2561, 0x0401, 0x2562, 0x2563, 0x2564, 0x2565, 0x2566, 0x2567, 0x2568, 0x2569,
    0x256A, 0x256B, 0x256C, 0x00A9, 0x044E, 0x0430, 0x0431, 0x0446, 0x0434, 0x0435, 0x0444, 0x0433,
    0x0445, 0x0438, 0x0439, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F, 0x044F, 0x0440, 0x0441,
    0x0442, 0x0443, 0x0436, 0x0432, 0x044C, 0x044B, 0x0437, 0x0448, 0x044D, 0x0449, 0x0447, 0x044A,
    0x042E, 0x0410, 0x0411, 0x0426, 0x0414, 0x0415, 0x0424, 0x0413, 0x0425, 0x0418, 0x0419, 0x041A,
    0x041B, 0x041C, 0x041D, 0x041E, 0x041F, 0x042F, 0x0420, 0x0421, 0x0422, 0x0423, 0x0416, 0x0412,
    0x042C, 0x042B, 0x0417, 0x0428, 0x042D, 0x0429, 0x0427, 0x042A,
};

struct SingleByte {
    const char* name;
    const Table* table;
};

constexpr std::array<SingleByte, 7> kSingleByte = {{
    {"windows-1251", &kWindows1251},
    {"windows-1252", &kWindows1252},
    {"iso-8859-1", &kIso88591},
    {"iso-8859-2", &kIso88592},
    {"iso-8859-5", &kIso88595},
    {"iso-8859-15", &kIso885915},
    {"koi8-r", &kKoi8R},
}};

const Table* table_for(std::string_view canonical) {
    for (const auto& entry : kSingleByte) {
        if (canonical == entry.name) {
            return entry.table;
        }
    }
    return nullptr;
}

// Reverse map (code point -> byte) per table, built once.
const std::unordered_map<char32_t, unsigned char>& reverse_map(const Table* table) {
    static std::array<std::unordered_map<char32_t, unsigned char>, kSingleByte.size()> maps;
    static std::array<bool, kSingleByte.size()> built{};
    static std::mutex mutex;
    std::size_t index = 0;
    for (; index < kSingleByte.size(); ++index) {
        if (kSingleByte[index].table == table) {
            break;
        }
    }
    std::lock_guard<std::mutex> lock(mutex);
    if (!built[index]) {
        auto& map = maps[index];
        for (unsigned b = 0; b < 0x80; ++b) {
            map.emplace(static_cast<char32_t>(b), static_cast<unsigned char>(b));
        }
        for (std::size_t i = 0; i < table->size(); ++i) {
            if ((*table)[i] != 0) {
                map.emplace(static_cast<char32_t>((*table)[i]),
                            static_cast<unsigned char>(0x80 + i));
            }
        }
        built[index] = true;
    }
    return maps[index];
}

/* ----------------------------------------------------------------------------------------- */
/* UTF-8 / UTF-16 primitives                                                                  */
/* ----------------------------------------------------------------------------------------- */

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

// Decodes one UTF-8 sequence at `pos`; returns the code point (U+FFFD on error, consuming
// one byte) and advances `pos`.
char32_t next_utf8(std::string_view s, std::size_t& pos, bool* ok) {
    const auto byte = [&](std::size_t i) { return static_cast<unsigned char>(s[i]); };
    const unsigned char c = byte(pos);
    if (c < 0x80) {
        ++pos;
        return c;
    }
    int len = 0;
    char32_t cp = 0;
    char32_t min = 0;
    if ((c & 0xE0) == 0xC0) {
        len = 2;
        cp = c & 0x1F;
        min = 0x80;
    } else if ((c & 0xF0) == 0xE0) {
        len = 3;
        cp = c & 0x0F;
        min = 0x800;
    } else if ((c & 0xF8) == 0xF0) {
        len = 4;
        cp = c & 0x07;
        min = 0x10000;
    } else {
        ++pos;
        *ok = false;
        return 0xFFFD;
    }
    if (pos + static_cast<std::size_t>(len) > s.size()) {
        ++pos;
        *ok = false;
        return 0xFFFD;
    }
    for (int i = 1; i < len; ++i) {
        const unsigned char cc = byte(pos + static_cast<std::size_t>(i));
        if ((cc & 0xC0) != 0x80) {
            ++pos;
            *ok = false;
            return 0xFFFD;
        }
        cp = (cp << 6) | (cc & 0x3F);
    }
    if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
        ++pos;
        *ok = false;
        return 0xFFFD;
    }
    pos += static_cast<std::size_t>(len);
    return cp;
}

DecodeResult decode_utf8_checked(std::string_view bytes) {
    DecodeResult result;
    result.utf8.reserve(bytes.size());
    std::size_t pos = 0;
    while (pos < bytes.size()) {
        bool ok = true;
        const std::size_t start = pos;
        (void)next_utf8(bytes, pos, &ok);
        if (ok) {
            result.utf8.append(bytes.data() + start, pos - start);
        } else {
            ++result.replacements;
            append_utf8(result.utf8, 0xFFFD);
        }
    }
    return result;
}

DecodeResult decode_utf16(std::string_view bytes, bool little_endian) {
    DecodeResult result;
    result.utf8.reserve(bytes.size());
    const auto unit = [&](std::size_t i) -> char32_t {
        const auto b0 = static_cast<unsigned char>(bytes[i]);
        const auto b1 = static_cast<unsigned char>(bytes[i + 1]);
        return little_endian ? static_cast<char32_t>(b0 | (b1 << 8))
                             : static_cast<char32_t>((b0 << 8) | b1);
    };
    std::size_t i = 0;
    while (i + 1 < bytes.size()) {
        char32_t cp = unit(i);
        i += 2;
        if (cp >= 0xD800 && cp <= 0xDBFF) {
            if (i + 1 < bytes.size()) {
                const char32_t low = unit(i);
                if (low >= 0xDC00 && low <= 0xDFFF) {
                    i += 2;
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                } else {
                    cp = 0xFFFD;
                    ++result.replacements;
                }
            } else {
                cp = 0xFFFD;
                ++result.replacements;
            }
        } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            cp = 0xFFFD;
            ++result.replacements;
        }
        append_utf8(result.utf8, cp);
    }
    if (i < bytes.size()) {  // odd trailing byte
        ++result.replacements;
        append_utf8(result.utf8, 0xFFFD);
    }
    return result;
}

void append_utf16(std::string& out, char32_t cp, bool little_endian) {
    const auto put = [&](char32_t unit) {
        const auto lo = static_cast<char>(unit & 0xFF);
        const auto hi = static_cast<char>((unit >> 8) & 0xFF);
        if (little_endian) {
            out.push_back(lo);
            out.push_back(hi);
        } else {
            out.push_back(hi);
            out.push_back(lo);
        }
    };
    if (cp >= 0x10000) {
        cp -= 0x10000;
        put(0xD800 + (cp >> 10));
        put(0xDC00 + (cp & 0x3FF));
    } else {
        put(cp);
    }
}

void append_char_ref(std::string& out, char32_t cp) {
    char buf[16];
    std::snprintf(buf, sizeof(buf), "&#x%X;", static_cast<unsigned>(cp));
    out += buf;
}

std::string lower_ascii(std::string_view s) {
    std::string out(s);
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

bool is_single_byte_name(std::string_view canonical) {
    return table_for(canonical) != nullptr;
}

/* ----------------------------------------------------------------------------------------- */
/* libxml2 custom handlers                                                                    */
/* ----------------------------------------------------------------------------------------- */

xmlCharEncError table_to_utf8(void* vctxt, unsigned char* out, int* outlen, const unsigned char* in,
                              int* inlen, int /*flush*/) {
    const Table* table = static_cast<const Table*>(vctxt);
    const unsigned char* const in_start = in;
    const unsigned char* const in_end = in + *inlen;
    unsigned char* const out_start = out;
    unsigned char* const out_end = out + *outlen;
    xmlCharEncError ret = XML_ENC_ERR_SUCCESS;
    while (in < in_end) {
        const unsigned c = *in;
        char32_t cp = c;
        if (c >= 0x80) {
            cp = (*table)[c - 0x80];
            if (cp == 0) {
                cp = 0xFFFD;  // undefined byte: keep going with a replacement character
            }
        }
        if (cp < 0x80) {
            if (out >= out_end) {
                ret = XML_ENC_ERR_SPACE;
                break;
            }
            *out++ = static_cast<unsigned char>(cp);
        } else if (cp < 0x800) {
            if (out_end - out < 2) {
                ret = XML_ENC_ERR_SPACE;
                break;
            }
            *out++ = static_cast<unsigned char>(0xC0 | (cp >> 6));
            *out++ = static_cast<unsigned char>(0x80 | (cp & 0x3F));
        } else {
            if (out_end - out < 3) {
                ret = XML_ENC_ERR_SPACE;
                break;
            }
            *out++ = static_cast<unsigned char>(0xE0 | (cp >> 12));
            *out++ = static_cast<unsigned char>(0x80 | ((cp >> 6) & 0x3F));
            *out++ = static_cast<unsigned char>(0x80 | (cp & 0x3F));
        }
        ++in;
    }
    *inlen = static_cast<int>(in - in_start);
    *outlen = static_cast<int>(out - out_start);
    return ret;
}

xmlCharEncError utf8_to_table(void* vctxt, unsigned char* out, int* outlen, const unsigned char* in,
                              int* inlen, int /*flush*/) {
    const Table* table = static_cast<const Table*>(vctxt);
    const auto& reverse = reverse_map(table);
    const std::string_view input(reinterpret_cast<const char*>(in),
                                 static_cast<std::size_t>(*inlen));
    std::size_t pos = 0;
    unsigned char* const out_start = out;
    unsigned char* const out_end = out + *outlen;
    xmlCharEncError ret = XML_ENC_ERR_SUCCESS;
    while (pos < input.size()) {
        if (out >= out_end) {
            ret = XML_ENC_ERR_SPACE;
            break;
        }
        // Stop before a truncated multi-byte sequence so libxml2 can feed the rest later.
        const auto lead = static_cast<unsigned char>(input[pos]);
        std::size_t need = 1;
        if ((lead & 0xE0) == 0xC0) {
            need = 2;
        } else if ((lead & 0xF0) == 0xE0) {
            need = 3;
        } else if ((lead & 0xF8) == 0xF0) {
            need = 4;
        }
        if (pos + need > input.size()) {
            break;
        }
        std::size_t next = pos;
        bool ok = true;
        const char32_t cp = next_utf8(input, next, &ok);
        auto it = reverse.find(cp);
        if (!ok || it == reverse.end()) {
            // Unmappable: libxml2 substitutes a character reference and resumes after it.
            ret = XML_ENC_ERR_INPUT;
            break;
        }
        *out++ = it->second;
        pos = next;
    }
    *inlen = static_cast<int>(pos);
    *outlen = static_cast<int>(out - out_start);
    return ret;
}

xmlParserErrors handler_impl(void* /*vctxt*/, const char* name, xmlCharEncFlags flags,
                             xmlCharEncodingHandler** out) {
    if (name == nullptr || out == nullptr) {
        return XML_ERR_ARGUMENT;
    }
    const auto canonical = normalize_name(name);
    if (!canonical) {
        return XML_ERR_UNSUPPORTED_ENCODING;
    }
    const Table* table = table_for(*canonical);
    if (table == nullptr) {
        // UTF-8/UTF-16 are handled by libxml2 itself before it asks us.
        return XML_ERR_UNSUPPORTED_ENCODING;
    }
    void* ctxt = const_cast<Table*>(table);  // NOLINT: libxml2 wants a non-const context
    return xmlCharEncNewCustomHandler(name, (flags & XML_ENC_INPUT) ? table_to_utf8 : nullptr,
                                      (flags & XML_ENC_OUTPUT) ? utf8_to_table : nullptr, nullptr,
                                      ctxt, ctxt, out);
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Names                                                                                      */
/* ----------------------------------------------------------------------------------------- */

std::optional<std::string> normalize_name(std::string_view label) {
    std::string s = lower_ascii(label);
    // Trim whitespace and quotes that sloppy declarations sometimes carry.
    while (!s.empty() && (std::isspace(static_cast<unsigned char>(s.front())) != 0 ||
                          s.front() == '"' || s.front() == '\'')) {
        s.erase(s.begin());
    }
    while (!s.empty() && (std::isspace(static_cast<unsigned char>(s.back())) != 0 ||
                          s.back() == '"' || s.back() == '\'')) {
        s.pop_back();
    }
    if (s.empty()) {
        return std::nullopt;
    }
    static const std::unordered_map<std::string, std::string> kAliases = {
        {"utf-8", "utf-8"},
        {"utf8", "utf-8"},
        {"utf-16", "utf-16"},
        {"utf16", "utf-16"},
        {"ucs-2", "utf-16"},
        {"ucs2", "utf-16"},
        {"unicode", "utf-16"},
        {"utf-16le", "utf-16le"},
        {"utf16le", "utf-16le"},
        {"utf-16be", "utf-16be"},
        {"utf16be", "utf-16be"},
        {"windows-1251", "windows-1251"},
        {"windows1251", "windows-1251"},
        {"win-1251", "windows-1251"},
        {"win1251", "windows-1251"},
        {"cp1251", "windows-1251"},
        {"cp-1251", "windows-1251"},
        {"x-cp1251", "windows-1251"},
        {"ms-cyrl", "windows-1251"},
        {"windows-1252", "windows-1252"},
        {"windows1252", "windows-1252"},
        {"win-1252", "windows-1252"},
        {"cp1252", "windows-1252"},
        {"cp-1252", "windows-1252"},
        {"x-cp1252", "windows-1252"},
        {"iso-8859-1", "iso-8859-1"},
        {"iso8859-1", "iso-8859-1"},
        {"iso_8859-1", "iso-8859-1"},
        {"iso88591", "iso-8859-1"},
        {"latin1", "iso-8859-1"},
        {"latin-1", "iso-8859-1"},
        {"l1", "iso-8859-1"},
        {"cp819", "iso-8859-1"},
        {"iso-8859-2", "iso-8859-2"},
        {"iso8859-2", "iso-8859-2"},
        {"iso_8859-2", "iso-8859-2"},
        {"iso88592", "iso-8859-2"},
        {"latin2", "iso-8859-2"},
        {"latin-2", "iso-8859-2"},
        {"l2", "iso-8859-2"},
        {"iso-8859-5", "iso-8859-5"},
        {"iso8859-5", "iso-8859-5"},
        {"iso_8859-5", "iso-8859-5"},
        {"iso88595", "iso-8859-5"},
        {"cyrillic", "iso-8859-5"},
        {"iso-8859-15", "iso-8859-15"},
        {"iso8859-15", "iso-8859-15"},
        {"iso_8859-15", "iso-8859-15"},
        {"iso885915", "iso-8859-15"},
        {"latin9", "iso-8859-15"},
        {"latin-9", "iso-8859-15"},
        {"l9", "iso-8859-15"},
        {"koi8-r", "koi8-r"},
        {"koi8r", "koi8-r"},
        {"koi8", "koi8-r"},
        {"koi-8", "koi8-r"},
        {"cskoi8r", "koi8-r"},
    };
    auto it = kAliases.find(s);
    if (it == kAliases.end()) {
        return std::nullopt;
    }
    return it->second;
}

const std::vector<std::string>& supported_names() {
    static const std::vector<std::string> names = {
        "utf-8",      "utf-16",     "utf-16le",   "utf-16be",    "windows-1251", "windows-1252",
        "iso-8859-1", "iso-8859-2", "iso-8859-5", "iso-8859-15", "koi8-r"};
    return names;
}

bool is_supported(std::string_view canonical_name) {
    const auto& names = supported_names();
    return std::find(names.begin(), names.end(), canonical_name) != names.end();
}

/* ----------------------------------------------------------------------------------------- */
/* Conversion                                                                                 */
/* ----------------------------------------------------------------------------------------- */

DecodeResult decode_to_utf8(std::string_view bytes, std::string_view encoding) {
    const auto canonical = normalize_name(encoding);
    if (!canonical || !is_supported(*canonical)) {
        throw std::invalid_argument("unsupported encoding: " + std::string(encoding));
    }
    const Bom bom = detect_bom(bytes);
    if (*canonical == "utf-8") {
        if (bom.encoding == "utf-8") {
            bytes.remove_prefix(bom.length);
        }
        return decode_utf8_checked(bytes);
    }
    if (*canonical == "utf-16" || *canonical == "utf-16le" || *canonical == "utf-16be") {
        bool little_endian = *canonical != "utf-16be";
        if (bom.encoding == "utf-16le" || bom.encoding == "utf-16be") {
            little_endian = bom.encoding == "utf-16le";
            bytes.remove_prefix(bom.length);
        } else if (*canonical == "utf-16" && bytes.size() >= 2) {
            // No BOM: guess from the first (ASCII) character of the declaration.
            little_endian = bytes[0] != '\0';
        }
        return decode_utf16(bytes, little_endian);
    }
    const Table* table = table_for(*canonical);
    DecodeResult result;
    result.utf8.reserve(bytes.size() + bytes.size() / 2);
    for (const char ch : bytes) {
        const auto c = static_cast<unsigned char>(ch);
        if (c < 0x80) {
            result.utf8.push_back(ch);
            continue;
        }
        char32_t cp = (*table)[c - 0x80];
        if (cp == 0) {
            cp = 0xFFFD;
            ++result.replacements;
        }
        append_utf8(result.utf8, cp);
    }
    return result;
}

EncodeResult encode_from_utf8(std::string_view utf8, std::string_view encoding, bool char_refs) {
    const auto canonical = normalize_name(encoding);
    if (!canonical || !is_supported(*canonical)) {
        throw std::invalid_argument("unsupported encoding: " + std::string(encoding));
    }
    EncodeResult result;
    if (*canonical == "utf-8") {
        result.bytes.assign(utf8);
        return result;
    }
    if (*canonical == "utf-16" || *canonical == "utf-16le" || *canonical == "utf-16be") {
        const bool little_endian = *canonical != "utf-16be";
        result.bytes.reserve(utf8.size() * 2 + 2);
        if (*canonical == "utf-16") {
            result.bytes.push_back(static_cast<char>(0xFF));
            result.bytes.push_back(static_cast<char>(0xFE));
        }
        std::size_t pos = 0;
        while (pos < utf8.size()) {
            bool ok = true;
            const char32_t cp = next_utf8(utf8, pos, &ok);
            append_utf16(result.bytes, cp, little_endian);
        }
        return result;
    }
    const Table* table = table_for(*canonical);
    const auto& reverse = reverse_map(table);
    result.bytes.reserve(utf8.size());
    std::size_t pos = 0;
    while (pos < utf8.size()) {
        const auto lead = static_cast<unsigned char>(utf8[pos]);
        if (lead < 0x80) {
            result.bytes.push_back(static_cast<char>(lead));
            ++pos;
            continue;
        }
        bool ok = true;
        const char32_t cp = next_utf8(utf8, pos, &ok);
        auto it = reverse.find(cp);
        if (ok && it != reverse.end()) {
            result.bytes.push_back(static_cast<char>(it->second));
        } else {
            ++result.unmappable;
            if (char_refs && ok) {
                append_char_ref(result.bytes, cp);
            } else {
                result.bytes.push_back('?');
            }
        }
    }
    return result;
}

bool can_encode(std::string_view encoding, char32_t code_point) {
    const auto canonical = normalize_name(encoding);
    if (!canonical) {
        return false;
    }
    if (canonical->rfind("utf-", 0) == 0) {
        return code_point <= 0x10FFFF && !(code_point >= 0xD800 && code_point <= 0xDFFF);
    }
    const Table* table = table_for(*canonical);
    if (table == nullptr) {
        return false;
    }
    return reverse_map(table).count(code_point) != 0;
}

/* ----------------------------------------------------------------------------------------- */
/* Detection                                                                                  */
/* ----------------------------------------------------------------------------------------- */

Bom detect_bom(std::string_view bytes) {
    const auto b = [&](std::size_t i) { return static_cast<unsigned char>(bytes[i]); };
    if (bytes.size() >= 3 && b(0) == 0xEF && b(1) == 0xBB && b(2) == 0xBF) {
        return Bom{"utf-8", 3};
    }
    if (bytes.size() >= 2 && b(0) == 0xFF && b(1) == 0xFE) {
        return Bom{"utf-16le", 2};
    }
    if (bytes.size() >= 2 && b(0) == 0xFE && b(1) == 0xFF) {
        return Bom{"utf-16be", 2};
    }
    return Bom{};
}

std::string declared_encoding(std::string_view bytes) {
    const Bom bom = detect_bom(bytes);
    std::string head;
    const std::size_t limit = std::min<std::size_t>(bytes.size(), 1024);
    if (bom.encoding == "utf-16le" || bom.encoding == "utf-16be" ||
        (bytes.size() >= 2 && (bytes[0] == '\0' || bytes[1] == '\0'))) {
        // UTF-16 text: squeeze the ASCII declaration out of the 16-bit units.
        const bool little_endian =
            bom.encoding == "utf-16le" || (bom.encoding.empty() && bytes[1] == '\0');
        for (std::size_t i = bom.length; i + 1 < limit; i += 2) {
            const auto lo = static_cast<unsigned char>(little_endian ? bytes[i] : bytes[i + 1]);
            const auto hi = static_cast<unsigned char>(little_endian ? bytes[i + 1] : bytes[i]);
            if (hi != 0 || lo >= 0x80) {
                head.push_back('?');
            } else {
                head.push_back(static_cast<char>(lo));
            }
        }
    } else {
        head.assign(bytes.substr(bom.length, limit > bom.length ? limit - bom.length : 0));
    }
    // Only an XML declaration at the very start counts (leading whitespace tolerated).
    std::size_t pos = 0;
    while (pos < head.size() && std::isspace(static_cast<unsigned char>(head[pos])) != 0) {
        ++pos;
    }
    if (head.compare(pos, 5, "<?xml") != 0) {
        return "";
    }
    const std::size_t end = head.find("?>", pos);
    const std::string decl =
        head.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
    const std::size_t enc = decl.find("encoding");
    if (enc == std::string::npos) {
        return "";
    }
    std::size_t p = enc + 8;
    while (p < decl.size() &&
           (std::isspace(static_cast<unsigned char>(decl[p])) != 0 || decl[p] == '=')) {
        ++p;
    }
    if (p >= decl.size() || (decl[p] != '"' && decl[p] != '\'')) {
        return "";
    }
    const char quote = decl[p];
    const std::size_t close = decl.find(quote, p + 1);
    if (close == std::string::npos) {
        return "";
    }
    return decl.substr(p + 1, close - p - 1);
}

Detection detect_encoding(std::string_view bytes, std::size_t sample_bytes) {
    Detection d;
    const Bom bom = detect_bom(bytes);
    const std::string label = declared_encoding(bytes);
    const auto declared = label.empty() ? std::nullopt : normalize_name(label);
    d.declared = declared.value_or(label.empty() ? "" : lower_ascii(label));

    if (!bom.encoding.empty()) {
        d.bom = true;
        d.detected = bom.encoding;
        if (!label.empty()) {
            const bool same =
                declared && (*declared == bom.encoding ||
                             (*declared == "utf-16" && bom.encoding.rfind("utf-16", 0) == 0));
            if (!same) {
                d.mismatch = true;
                d.reason = "bom";
            }
        }
        return d;
    }

    // No BOM: UTF-16 without a BOM is recognisable from the NUL bytes of the declaration.
    if (bytes.size() >= 4 && bytes[0] == '<' && bytes[1] == '\0') {
        d.detected = "utf-16le";
        d.mismatch = declared && *declared != "utf-16" && *declared != "utf-16le";
        d.reason = d.mismatch ? "utf16-bytes" : "";
        return d;
    }
    if (bytes.size() >= 4 && bytes[0] == '\0' && bytes[1] == '<') {
        d.detected = "utf-16be";
        d.mismatch = declared && *declared != "utf-16" && *declared != "utf-16be";
        d.reason = d.mismatch ? "utf16-bytes" : "";
        return d;
    }

    std::string_view sample = bytes.substr(0, std::min(sample_bytes, bytes.size()));
    if (sample.size() < bytes.size()) {
        // Never cut a multi-byte sequence in half: end the sample on an ASCII byte.
        std::size_t end = sample.size();
        while (end > 0 && static_cast<unsigned char>(sample[end - 1]) >= 0x80) {
            --end;
        }
        if (end > sample.size() / 2) {
            sample = sample.substr(0, end);
        }
    }
    const auto clean = [&](const std::string& enc) {
        return decode_to_utf8(sample, enc).replacements == 0;
    };
    const auto has_non_ascii = [&] {
        return std::any_of(sample.begin(), sample.end(),
                           [](char c) { return static_cast<unsigned char>(c) >= 0x80; });
    };

    std::string claimed = declared.value_or("utf-8");  // XML default
    if (!label.empty() && !declared) {
        d.mismatch = true;
        d.reason = "unsupported";
    } else if (claimed == "utf-16" || claimed == "utf-16le" || claimed == "utf-16be") {
        // Declared UTF-16 but the bytes are 8-bit: treat the declaration as wrong.
        d.mismatch = true;
        d.reason = "invalid-bytes";
    } else if (clean(claimed)) {
        if (is_single_byte_name(claimed) && has_non_ascii() && clean("utf-8")) {
            // Single-byte declaration over bytes that are valid multi-byte UTF-8: almost
            // certainly a wrong declaration (UTF-8 text rarely survives as valid UTF-8 after
            // being mis-labelled).
            d.detected = "utf-8";
            d.mismatch = true;
            d.reason = "utf8-bytes";
            return d;
        }
        d.detected = claimed;
        return d;
    } else {
        d.mismatch = true;
        d.reason = "invalid-bytes";
    }

    for (const char* candidate :
         {"utf-8", "windows-1251", "koi8-r", "windows-1252", "iso-8859-1"}) {
        if (clean(candidate)) {
            d.detected = candidate;
            return d;
        }
    }
    d.detected = "windows-1251";  // unreachable in practice: iso-8859-1 always decodes
    return d;
}

/* ----------------------------------------------------------------------------------------- */
/* libxml2 integration                                                                        */
/* ----------------------------------------------------------------------------------------- */

void install_libxml_handlers(_xmlParserCtxt* ctxt) {
    if (ctxt != nullptr) {
        xmlCtxtSetCharEncConvImpl(ctxt, handler_impl, nullptr);
    }
}

}  // namespace mfbe::encoding
