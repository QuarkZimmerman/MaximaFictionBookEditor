// The text judge of the Markdown import (feature 010, DP-15). See mfbe/text_encoding.hpp.

#include <mfbe/archive.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/single_byte.hpp>
#include <mfbe/text_encoding.hpp>

#include <algorithm>
#include <array>
#include <cctype>

namespace mfbe::text {
namespace {

// The judge reads the start of the file: plenty of words, and a bounded cost for a large file.
constexpr std::size_t kSampleBytes = 256 * 1024;

// The words of a decoded sample that hold a character outside ASCII - the only ones the
// candidates read differently (every candidate reads ASCII alike).
std::vector<std::string> non_ascii_words(const std::string& utf8) {
    std::vector<std::string> words;
    std::string word;
    bool wide = false;
    const auto flush = [&] {
        if (wide && !word.empty()) {
            words.push_back(word);
        }
        word.clear();
        wide = false;
    };
    for (const char ch : utf8) {
        const auto c = static_cast<unsigned char>(ch);
        if (c >= 0x80) {
            word.push_back(ch);
            wide = true;
        } else if (std::isalnum(c) != 0 || c == '\'' || c == '-') {
            word.push_back(ch);
        } else {
            flush();
        }
    }
    flush();
    return words;
}

// Capital letters inside words. A page of real text has few (words in capitals are rare); the
// wrong one of KOI8-R and windows-1251 swaps the cases and makes most letters capitals.
long inner_capitals(const std::vector<std::string>& words) {
    long count = 0;
    for (const std::string& word : words) {
        std::size_t index = 0;
        for (std::size_t i = 0; i < word.size(); ++index) {
            const auto c = static_cast<unsigned char>(word[i]);
            char32_t cp = c;
            std::size_t length = 1;
            const auto next = [&](std::size_t k) {
                return static_cast<char32_t>(static_cast<unsigned char>(word[i + k]) & 0x3Fu);
            };
            if (c >= 0xC0 && c < 0xE0 && i + 1 < word.size()) {
                cp = (static_cast<char32_t>(c & 0x1Fu) << 6) | next(1);
                length = 2;
            } else if (c >= 0xE0 && c < 0xF0 && i + 2 < word.size()) {
                cp = (static_cast<char32_t>(c & 0x0Fu) << 12) | (next(1) << 6) | next(2);
                length = 3;
            } else if (c >= 0xF0) {
                cp = 0;
                length = 4;
            }
            const bool capital = (cp >= 'A' && cp <= 'Z') ||
                                 (cp >= 0xC0 && cp <= 0xDE && cp != 0xD7) ||
                                 (cp >= 0x400 && cp <= 0x42F);
            if (capital && index > 0) {
                ++count;
            }
            i += length;
        }
    }
    return count;
}

// Feature 017 (D26): a symbol that touches a letter - "¬аша" where a wrong table read a capital as
// a sign - marks a wrong encoding; the punctuation of ordinary text does not count.
bool is_letter(char32_t c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
           (c >= 0xC0 && c <= 0x24F && c != 0xD7 && c != 0xF7) || (c >= 0x370 && c <= 0x3FF) ||
           (c >= 0x400 && c <= 0x52F);
}

bool is_ordinary(char32_t c) {
    if (c < 0x80) {
        return true;  // ASCII: letters, digits and the punctuation of plain text
    }
    switch (c) {
        // Feature 017 (D26): also the degree, copyright, registered, section, plus-minus, middle
        // dot, bullet, euro, pound and multiplication signs of running text.
        case 0xA0:
        case 0xA3:
        case 0xA7:
        case 0xA9:
        case 0xAE:
        case 0xB0:
        case 0xB1:
        case 0xB2:
        case 0xB3:
        case 0xB7:
        case 0xB9:
        case 0xBC:
        case 0xBD:
        case 0xBE:
        case 0xD7:
        case 0x2022:
        case 0x20AC:
        case 0xAB:
        case 0xBB:
        case 0x2013:
        case 0x2014:
        case 0x2018:
        case 0x2019:
        case 0x201C:
        case 0x201D:
        case 0x201E:
        case 0x2026:
        case 0x2116:
            return true;
        default:
            return is_letter(c);
    }
}

long stray_symbols(const std::string& utf8) {
    std::vector<char32_t> cps;
    cps.reserve(utf8.size());
    for (std::size_t i = 0; i < utf8.size();) {
        const auto c = static_cast<unsigned char>(utf8[i]);
        const std::size_t len = c < 0x80 ? 1 : c < 0xE0 ? 2 : c < 0xF0 ? 3 : 4;
        char32_t cp = len == 1 ? c : len == 2 ? (c & 0x1Fu) : len == 3 ? (c & 0x0Fu) : (c & 0x07u);
        for (std::size_t k = 1; k < len && i + k < utf8.size(); ++k) {
            cp = (cp << 6) | (static_cast<unsigned char>(utf8[i + k]) & 0x3Fu);
        }
        cps.push_back(cp);
        i += len;
    }
    long count = 0;
    for (std::size_t i = 0; i < cps.size(); ++i) {
        if (is_ordinary(cps[i])) {
            continue;
        }
        if ((i > 0 && is_letter(cps[i - 1])) || (i + 1 < cps.size() && is_letter(cps[i + 1]))) {
            ++count;
        }
    }
    return count;
}

long replacement_count(const std::string& utf8) {
    long count = 0;
    for (std::size_t at = utf8.find("\xEF\xBF\xBD"); at != std::string::npos;
         at = utf8.find("\xEF\xBF\xBD", at + 3)) {
        ++count;
    }
    return count;
}

}  // namespace

const std::vector<std::string>& legacy_candidates() {
    static const std::vector<std::string> names{"windows-1251", "koi8-r", "cp866", "windows-1252",
                                                "iso-8859-2"};
    return names;
}

const std::vector<std::string>& txt_candidates() {
    // Feature 017 (D26, DP-9): the encodings of D11's lists for English, Russian and Ukrainian,
    // in tie order (an earlier one wins when two read the bytes alike).
    static const std::vector<std::string> names{
        "windows-1251",   "koi8-r",       "koi8-u",     "ibm866",      "iso-8859-5",
        "x-mac-cyrillic", "windows-1252", "iso-8859-1", "iso-8859-15", "macintosh"};
    return names;
}

std::optional<std::string> decode_text(std::string_view bytes, std::string_view encoding) {
    if (encoding == "cp866" || encoding == "ibm866") {
        // Feature 017 (DP-3): IBM866 from the WHATWG tables, as the TXT export writes it.
        return text::decode_single_byte(bytes, "ibm866");
    }
    if (text::is_single_byte(encoding)) {
        return text::decode_single_byte(bytes, encoding);
    }
    const std::optional<std::string> name = encoding::normalize_name(encoding);
    if (!name || !encoding::is_supported(*name)) {
        return std::nullopt;
    }
    return encoding::decode_to_utf8(bytes, *name).utf8;
}

bool looks_binary(std::string_view bytes) {
    if (!encoding::detect_bom(bytes).encoding.empty()) {
        return false;  // UTF-16 holds NUL bytes, and a byte-order mark says it is text
    }
    const std::size_t n = std::min<std::size_t>(bytes.size(), 64 * 1024);
    std::size_t controls = 0;
    for (std::size_t i = 0; i < n; ++i) {
        const auto c = static_cast<unsigned char>(bytes[i]);
        if (c == 0) {
            return true;
        }
        if (c < 0x20 && c != '\n' && c != '\r' && c != '\t' && c != '\f') {
            ++controls;
        }
    }
    return n > 0 && controls * 100 > n;
}

namespace {

// Feature 017 (D26, the requester at implement after the corpus run: "decide alone"): no clear
// lead, and nothing in the text to judge by - as in an English text whose only bytes above 0x7F are
// no-break spaces (IBM866 reads them as the letter "а", a word of its own). Every candidate reads
// the ASCII bytes alike, so candidates read the file alike when they map its other byte values
// alike. When one such set of candidates reads them as the ordinary marks of text only (a no-break
// space, quotes, dashes - is_ordinary, letters aside) and every other set as letters or other
// signs, one of the set is taken without a question: windows-1252 first, as the text is Latin. A
// text with letters above 0x7F has no such set, and is asked about as before.
std::optional<std::string> neutral_reading(std::string_view bytes,
                                           const std::vector<std::string>& candidates) {
    std::array<bool, 256> present{};
    for (const char c : bytes) {
        present[static_cast<unsigned char>(c)] = true;
    }
    std::string high;
    for (int b = 0x80; b < 0x100; ++b) {
        if (present[static_cast<std::size_t>(b)]) {
            high.push_back(static_cast<char>(b));
        }
    }
    if (high.empty()) {
        return std::nullopt;
    }
    struct Set {
        std::string reads;  // what the candidates read for the file's bytes above 0x7F
        std::vector<std::string> names;
    };
    std::vector<Set> sets;
    for (const std::string& name : candidates) {
        std::optional<std::string> reads = decode_text(high, name);
        if (!reads) {
            continue;
        }
        const auto it = std::find_if(sets.begin(), sets.end(),
                                     [&](const Set& set) { return set.reads == *reads; });
        if (it == sets.end()) {
            sets.push_back(Set{std::move(*reads), {name}});
        } else {
            it->names.push_back(name);
        }
    }
    // A reading is clean when it gives the text no sign beyond the ordinary marks of text and no
    // word that mixes Latin with other letters ("plainаtext", where IBM866 reads a no-break space
    // as "а"); a lone letter of another script counts as a mixed one when no word of that script
    // stands in the text.
    const auto clean = [&bytes](const std::string& name) {
        const std::optional<std::string> text = decode_text(bytes, name);
        if (!text) {
            return false;
        }
        long odd = 0;
        long lone = 0;
        long words = 0;  // words of two or more letters of another script than Latin
        bool latin = false;
        long other = 0;
        const auto end_word = [&] {
            if (other > 0 && latin) {
                ++odd;
            } else if (other == 1) {
                ++lone;
            } else if (other > 1) {
                ++words;
            }
            latin = false;
            other = 0;
        };
        const std::string& utf8 = *text;
        for (std::size_t i = 0; i < utf8.size();) {
            const auto c = static_cast<unsigned char>(utf8[i]);
            const std::size_t len = c < 0x80 ? 1 : c < 0xE0 ? 2 : c < 0xF0 ? 3 : 4;
            char32_t cp = len == 1   ? c
                          : len == 2 ? (c & 0x1Fu)
                          : len == 3 ? (c & 0x0Fu)
                                     : (c & 0x07u);
            for (std::size_t k = 1; k < len && i + k < utf8.size(); ++k) {
                cp = (cp << 6) | (static_cast<unsigned char>(utf8[i + k]) & 0x3Fu);
            }
            i += len;
            if (is_letter(cp)) {
                if (cp < 0x250) {
                    latin = true;  // ASCII and the Latin letters above it
                } else {
                    ++other;
                }
                continue;
            }
            end_word();
            if (!is_ordinary(cp)) {
                ++odd;
            }
        }
        end_word();
        return odd == 0 && (words > 0 || lone == 0);
    };
    const Set* chosen = nullptr;
    for (const Set& set : sets) {
        if (clean(set.names.front())) {
            if (chosen != nullptr) {
                return std::nullopt;  // two sets read the file differently, both plausibly: ask
            }
            chosen = &set;
        }
    }
    if (chosen == nullptr) {
        return std::nullopt;
    }
    for (const char* preferred : {"windows-1252", "iso-8859-1", "iso-8859-15", "windows-1251"}) {
        if (std::find(chosen->names.begin(), chosen->names.end(), preferred) !=
            chosen->names.end()) {
            return std::string(preferred);
        }
    }
    return chosen->names.front();
}

}  // namespace

TextReading read_text(std::string_view bytes) {
    return read_text(bytes, legacy_candidates());
}

TextReading read_text(std::string_view bytes, const std::vector<std::string>& candidates) {
    TextReading reading;
    const encoding::Bom bom = encoding::detect_bom(bytes);
    if (!bom.encoding.empty()) {
        reading.decided = true;
        reading.encoding = bom.encoding;
        reading.source = "bom";
        reading.utf8 = encoding::decode_to_utf8(bytes, bom.encoding).utf8;
        return reading;
    }
    encoding::DecodeResult utf8 = encoding::decode_to_utf8(bytes, "utf-8");
    if (utf8.replacements == 0) {
        reading.decided = true;
        reading.encoding = "utf-8";
        reading.source = "utf8";
        reading.utf8 = std::move(utf8.utf8);
        return reading;
    }
    // An older encoding: every candidate reads a sample; the most plausible words win.
    const std::string_view sample = bytes.substr(0, std::min(bytes.size(), kSampleBytes));
    struct Scored {
        std::string name;
        long score;
    };
    std::vector<Scored> scored;
    for (const std::string& name : candidates) {
        const std::optional<std::string> text = decode_text(sample, name);
        if (!text) {
            continue;
        }
        const std::vector<std::string> words = non_ascii_words(*text);
        scored.push_back(Scored{name, archive::plausibility(words) - 2 * inner_capitals(words) -
                                          20 * replacement_count(*text) -
                                          10 * stray_symbols(*text)});
    }
    std::stable_sort(scored.begin(), scored.end(),
                     [](const Scored& a, const Scored& b) { return a.score > b.score; });
    // Feature 017 (D26): a runner-up that reads the whole file exactly as the leader does (KOI8-R
    // and KOI8-U for a Russian text, windows-1252 and ISO-8859-1 for a Western one) is no other
    // choice - asking would offer the same text twice - so the leader stands for both.
    const auto leads = [&scored] {
        return scored.size() == 1 ||
               scored[0].score - scored[1].score >= std::max<long>(10, scored[0].score / 5);
    };
    while (scored.size() >= 2 && !leads() &&
           decode_text(bytes, scored[0].name) == decode_text(bytes, scored[1].name)) {
        scored.erase(scored.begin() + 1);
    }
    for (const Scored& s : scored) {
        reading.candidates.push_back(s.name);
    }
    // Decided only with a clear lead: a positive score at least a fifth (and ten points) above
    // the runner-up's.
    if (!scored.empty() && scored[0].score > 0 &&
        (scored.size() == 1 ||
         scored[0].score - scored[1].score >= std::max<long>(10, scored[0].score / 5))) {
        if (std::optional<std::string> text = decode_text(bytes, scored[0].name)) {
            reading.decided = true;
            reading.encoding = scored[0].name;
            reading.source = "judged";
            reading.utf8 = std::move(*text);
        }
    }
    if (!reading.decided) {
        if (std::optional<std::string> name = neutral_reading(bytes, candidates)) {
            if (std::optional<std::string> text = decode_text(bytes, *name)) {
                reading.decided = true;
                reading.encoding = *name;
                reading.source = "judged";
                reading.utf8 = std::move(*text);
            }
        }
    }
    return reading;
}

}  // namespace mfbe::text
