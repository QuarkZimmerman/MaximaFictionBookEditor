// Feature 020 (T017, research.md R3): script grouping and trigram/confidence language scoring.
#include "pdf/reader/ocr_lang.hpp"

#include "pdf/reader/ocr_trigrams.inc"

#include <mfbe/ocr.hpp>
#include <mfbe/unicode.hpp>

#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <string>
#include <unordered_set>

namespace mfbe::pdf_reader {
namespace {

std::string script_of_codepoint(char32_t c) {
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= 0xC0 && c <= 0x24F) ||
        (c >= 0x1E00 && c <= 0x1EFF)) {
        return "latin";
    }
    if ((c >= 0x370 && c <= 0x3FF) || (c >= 0x1F00 && c <= 0x1FFF)) {
        return "greek";
    }
    if ((c >= 0x400 && c <= 0x52F) || (c >= 0x2DE0 && c <= 0x2DFF) ||
        (c >= 0xA640 && c <= 0xA69F)) {
        return "cyrillic";
    }
    if (c >= 0x530 && c <= 0x58F) {
        return "armenian";
    }
    if (c >= 0x590 && c <= 0x5FF) {
        return "hebrew";
    }
    if ((c >= 0x600 && c <= 0x6FF) || (c >= 0x750 && c <= 0x77F)) {
        return "arabic";
    }
    if (c >= 0x900 && c <= 0xDFF) {
        return "indic";
    }
    if (c >= 0x10A0 && c <= 0x10FF) {
        return "georgian";
    }
    if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x3400 && c <= 0x4DBF) ||
        (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF) ||
        (c >= 0xF900 && c <= 0xFAFF)) {
        return "cjk";
    }
    return {};
}

// Lowercases Latin, Cyrillic, and Greek code points used across the bundled European/Slavic packs.
char32_t fold_lower(char32_t c) {
    if (c >= 'A' && c <= 'Z') {
        return c + 32;
    }
    // Latin-1 Supplement uppercase letters (À..Ö, Ø..Þ)
    if ((c >= 0xC0 && c <= 0xD6) || (c >= 0xD8 && c <= 0xDE)) {
        return c + 32;
    }
    // Polish & Latin Extended-A uppercase pairs (even -> odd for 0x100..0x17E, plus Ł/ł etc.)
    switch (c) {
        case 0x0104: return 0x0105;  // Ą -> ą
        case 0x0106: return 0x0107;  // Ć -> ć
        case 0x0118: return 0x0119;  // Ę -> ę
        case 0x0141: return 0x0142;  // Ł -> ł
        case 0x0143: return 0x0144;  // Ń -> ń
        case 0x0152: return 0x0153;  // Œ -> œ
        case 0x015A: return 0x015B;  // Ś -> ś
        case 0x0179: return 0x017A;  // Ź -> ź
        case 0x017B: return 0x017C;  // Ż -> ż
        case 0x0178: return 0x00FF;  // Ÿ -> ÿ
        default: break;
    }
    // Basic Cyrillic А..Я (0x0410..0x042F -> 0x0430..0x044F)
    if (c >= 0x0410 && c <= 0x042F) {
        return c + 0x20;
    }
    // Extended Cyrillic Ѐ..Џ (Ё, Є, І, Ї, Ў: 0x0400..0x040F -> 0x0450..0x045F)
    if (c >= 0x0400 && c <= 0x040F) {
        return c + 0x50;
    }
    if (c == 0x0490) {
        return 0x0491;  // Ґ -> ґ
    }
    return c;
}

void append_utf8(std::string& out, char32_t c) {
    if (c < 0x80) {
        out.push_back(static_cast<char>(c));
    } else if (c < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (c >> 6)));
        out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    } else if (c < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (c >> 12)));
        out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (c >> 18)));
        out.push_back(static_cast<char>(0x80 | ((c >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    }
}

const ocr_detail::LanguageProfile* find_profile(std::string_view pack_code) {
    std::string lower(pack_code);
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    for (const auto& p : ocr_detail::kBundledProfiles) {
        if (p.code == lower) {
            return &p;
        }
    }
    // Custom variant like "rus_old" or "deu_frak" inherits its base profile when available.
    const std::size_t sep = lower.find_first_of("_.-");
    if (sep != std::string::npos && sep >= 2) {
        const std::string base = lower.substr(0, sep);
        for (const auto& p : ocr_detail::kBundledProfiles) {
            if (p.code == base) {
                return &p;
            }
        }
    }
    return nullptr;
}

bool contains_char(const char32_t* arr, std::size_t count, char32_t c) {
    for (std::size_t i = 0; i < count; ++i) {
        if (arr[i] == c) {
            return true;
        }
    }
    return false;
}

}  // namespace

std::map<std::string, std::vector<std::string>> group_packs_by_script(
    const std::vector<std::string>& pack_codes) {
    std::map<std::string, std::vector<std::string>> groups;
    for (const std::string& code : pack_codes) {
        const auto info = ocr::language_info_for_code(code);
        groups[info.script].push_back(code);
    }
    return groups;
}

std::string dominant_text_script(std::string_view utf8_text) {
    const std::vector<char32_t> cps = unicode::decode_utf8(utf8_text);
    std::map<std::string, int> counts;
    for (char32_t c : cps) {
        if (!unicode::is_letter(c)) {
            continue;
        }
        const std::string s = script_of_codepoint(c);
        if (!s.empty()) {
            counts[s]++;
        }
    }
    std::string best;
    int best_count = 0;
    for (const auto& [script, count] : counts) {
        if (count > best_count) {
            best = script;
            best_count = count;
        }
    }
    return best;
}

double score_text_for_language(std::string_view utf8_text, std::string_view pack_code) {
    const std::vector<char32_t> raw = unicode::decode_utf8(utf8_text);
    if (raw.empty()) {
        return 0.0;
    }

    const auto info = ocr::language_info_for_code(pack_code);
    const std::string dom = dominant_text_script(utf8_text);
    if (dom.empty()) {
        return 0.0;
    }
    if (info.script != "other" && dom != info.script) {
        return 0.0;
    }

    const ocr_detail::LanguageProfile* profile = find_profile(pack_code);
    if (profile == nullptr) {
        // Custom language without a static trigram table: neutral script-match score so
        // Tesseract's LSTM confidence and plain-word ratio decide cleanly.
        return 0.42;
    }

    // Normalize into lowercase words and a single-space-delimited codepoint buffer.
    std::vector<char32_t> norm;
    norm.reserve(raw.size() + 2);
    norm.push_back(U' ');
    std::vector<std::string> words;
    std::string current_word;
    int letter_count = 0;
    int char_hits = 0;
    int forbidden_hits = 0;

    for (char32_t c : raw) {
        const char32_t lc = fold_lower(c);
        if (unicode::is_letter(lc)) {
            ++letter_count;
            norm.push_back(lc);
            append_utf8(current_word, lc);
            if (contains_char(profile->characteristic_chars, profile->characteristic_count, lc)) {
                ++char_hits;
            }
            if (contains_char(profile->forbidden_chars, profile->forbidden_count, lc)) {
                ++forbidden_hits;
            }
        } else {
            if (!current_word.empty()) {
                words.push_back(std::move(current_word));
                current_word.clear();
            }
            if (norm.back() != U' ') {
                norm.push_back(U' ');
            }
        }
    }
    if (!current_word.empty()) {
        words.push_back(std::move(current_word));
    }
    if (norm.back() != U' ') {
        norm.push_back(U' ');
    }
    if (letter_count < 3) {
        return 0.0;
    }

    // 1. Trigram hit rate (weighted slightly toward higher-ranked trigrams)
    std::unordered_set<std::string_view> trigram_set(
        profile->trigrams, profile->trigrams + profile->trigram_count);
    int total_trigrams = 0;
    int trigram_hits = 0;
    std::string tri;
    for (std::size_t i = 0; i + 2 < norm.size(); ++i) {
        if (norm[i] == U' ' && norm[i + 2] == U' ') {
            continue;
        }
        tri.clear();
        append_utf8(tri, norm[i]);
        append_utf8(tri, norm[i + 1]);
        append_utf8(tri, norm[i + 2]);
        ++total_trigrams;
        if (trigram_set.contains(tri)) {
            ++trigram_hits;
        }
    }
    const double trigram_rate =
        total_trigrams > 0 ? static_cast<double>(trigram_hits) / total_trigrams : 0.0;
    // Typical in-language prose hits 20%..45% of its trigrams in a 70-trigram profile.
    const double trigram_score = std::clamp(trigram_rate / 0.35, 0.0, 1.0);

    // 2. High-frequency stopword match rate
    std::unordered_set<std::string_view> stop_set(
        profile->stopwords, profile->stopwords + profile->stopword_count);
    int stop_hits = 0;
    for (const std::string& w : words) {
        if (stop_set.contains(w)) {
            ++stop_hits;
        }
    }
    const double stop_rate =
        !words.empty() ? static_cast<double>(stop_hits) / static_cast<double>(words.size()) : 0.0;
    const double stop_score = std::clamp(stop_rate / 0.18, 0.0, 1.0);

    // 3. Characteristic letters bonus vs forbidden letters penalty
    const double char_bonus =
        profile->characteristic_count > 0
            ? std::clamp(static_cast<double>(char_hits) / std::max(1.0, letter_count * 0.03), 0.0,
                         1.0) *
                  0.22
            : 0.0;
    const double forbidden_penalty =
        profile->forbidden_count > 0 && forbidden_hits > 0
            ? std::clamp(static_cast<double>(forbidden_hits) / std::max(1.0, letter_count * 0.02),
                         0.0, 1.0) *
                  0.55
            : 0.0;

    return std::clamp(0.50 * trigram_score + 0.45 * stop_score + char_bonus - forbidden_penalty,
                      0.0, 1.0);
}

OcrCandidateScore evaluate_ocr_candidate(std::string_view utf8_text, std::string_view pack_code,
                                         double mean_conf, double plain_ratio, int word_count) {
    const auto info = ocr::language_info_for_code(pack_code);
    OcrCandidateScore out;
    out.code = std::string(pack_code);
    out.fb2_lang = info.fb2_lang;
    out.script = info.script;
    out.mean_conf = std::clamp(mean_conf, 0.0, 100.0);
    out.plain_ratio = std::clamp(plain_ratio, 0.0, 1.0);
    out.word_count = word_count;
    out.text_score = score_text_for_language(utf8_text, pack_code);

    const double conf_norm = out.mean_conf / 100.0;
    // Language profile match carries strong weight when discriminating same-script packs
    // (e.g. German vs English or Ukrainian vs Russian), while confidence + plain-word share
    // protect against garbled/wrong-script reads.
    const double word_factor = word_count >= 5 ? 1.0 : (word_count > 0 ? 0.5 + 0.1 * word_count : 0.0);
    out.total_score =
        word_factor * (0.35 * conf_norm + 0.20 * out.plain_ratio + 0.45 * out.text_score);
    return out;
}

std::string pick_best_candidate(const std::vector<OcrCandidateScore>& candidates) {
    if (candidates.empty()) {
        return {};
    }
    const OcrCandidateScore* best = &candidates.front();
    for (std::size_t i = 1; i < candidates.size(); ++i) {
        if (candidates[i].total_score > best->total_score + 1e-6) {
            best = &candidates[i];
        }
    }
    return best->code;
}

std::string detect_same_script_pack(std::string_view utf8_text,
                                    const std::vector<std::string>& candidate_codes) {
    if (candidate_codes.empty()) {
        return {};
    }
    if (candidate_codes.size() == 1) {
        return candidate_codes.front();
    }
    std::string best = candidate_codes.front();
    double best_score = -1.0;
    for (const std::string& code : candidate_codes) {
        const double s = score_text_for_language(utf8_text, code);
        if (s > best_score + 1e-6) {
            best_score = s;
            best = code;
        }
    }
    return best;
}

}  // namespace mfbe::pdf_reader
