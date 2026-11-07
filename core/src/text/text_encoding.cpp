// The text judge of the Markdown import (feature 010, DP-15). See mfbe/text_encoding.hpp.

#include <mfbe/archive.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/text_encoding.hpp>

#include <algorithm>
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

std::optional<std::string> decode_text(std::string_view bytes, std::string_view encoding) {
    if (encoding == "cp866") {
        std::string out = archive::convert_codepage(bytes, 866);
        if (out.empty() && !bytes.empty()) {
            return std::nullopt;
        }
        return out;
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

TextReading read_text(std::string_view bytes) {
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
    for (const std::string& name : legacy_candidates()) {
        const std::optional<std::string> text = decode_text(sample, name);
        if (!text) {
            continue;
        }
        const std::vector<std::string> words = non_ascii_words(*text);
        scored.push_back(Scored{name, archive::plausibility(words) - 2 * inner_capitals(words) -
                                          20 * replacement_count(*text)});
    }
    std::stable_sort(scored.begin(), scored.end(),
                     [](const Scored& a, const Scored& b) { return a.score > b.score; });
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
    return reading;
}

}  // namespace mfbe::text
