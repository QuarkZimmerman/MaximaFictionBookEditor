// Table-driven legacy encodings and their libxml2 registration (T040). See mfbe/encodings.hpp.
#include <mfbe/encodings.hpp>
#include <mfbe/single_byte.hpp>

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
/* Single-byte tables: code points for bytes 0x80..0xFF (0 = undefined), from the WHATWG      */
/* Encoding Standard's index tables (feature 017, DP-3) - see mfbe/single_byte.hpp.           */
/* ----------------------------------------------------------------------------------------- */

using Table = std::array<char16_t, 128>;

// Feature 017 (DP-3; the requester's decision of 2026-11-17): the tables are the WHATWG Encoding
// Standard's (core/src/text/single_byte_tables.inc), shared with the TXT export and import, so that
// no encoding has two tables. They differ from the earlier hand-made tables only in six bytes
// Microsoft leaves undefined (windows-1251 0x98; windows-1252 0x81, 0x8D, 0x8F, 0x90, 0x9D), which
// the Standard reads as the C1 control characters of the same numbers.
Table table_from(std::string_view name) {
    Table table{};
    const std::uint16_t* high = text::single_byte_high(name);
    for (std::size_t i = 0; i < table.size(); ++i) {
        table[i] = static_cast<char16_t>(high[i]);
    }
    return table;
}

const Table kWindows1251 = table_from("windows-1251");
const Table kWindows1252 = table_from("windows-1252");
const Table kIso88591 = table_from("iso-8859-1");
const Table kIso88592 = table_from("iso-8859-2");
const Table kIso88595 = table_from("iso-8859-5");
const Table kIso885915 = table_from("iso-8859-15");
const Table kKoi8R = table_from("koi8-r");

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
