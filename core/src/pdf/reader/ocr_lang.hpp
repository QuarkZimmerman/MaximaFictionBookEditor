// Feature 020 (T017, research.md R3): script grouping and trigram/stopword/confidence language
// scoring for automatic OCR language detection across enabled language packs.
#pragma once

#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::pdf_reader {

struct OcrCandidateScore {
    std::string code;       // Tesseract pack code (e.g. "deu", "rus")
    std::string fb2_lang;   // Mapped FB2 ISO language code (e.g. "de", "ru")
    std::string script;     // Script family (e.g. "latin", "cyrillic")
    double total_score = 0.0;
    double text_score = 0.0;
    double mean_conf = 0.0;
    double plain_ratio = 0.0;
    int word_count = 0;
};

// Groups Tesseract pack codes by primary script family ("latin", "cyrillic", ...).
std::map<std::string, std::vector<std::string>> group_packs_by_script(
    const std::vector<std::string>& pack_codes);

// Returns the dominant letter script family in `utf8_text` ("" if no letters found).
std::string dominant_text_script(std::string_view utf8_text);

// Pure text-based language score in [0.0, 1.0] for `pack_code` using trigram, stopword, and
// characteristic/forbidden letter signals. For custom languages without a static profile,
// returns a neutral 0.42 baseline when the text's dominant script matches the pack's script.
double score_text_for_language(std::string_view utf8_text, std::string_view pack_code);

// Combines text language score, Tesseract mean confidence (0..100), and plain-word ratio (0..1)
// into a single candidate score for ranking same-script language hypotheses.
OcrCandidateScore evaluate_ocr_candidate(std::string_view utf8_text, std::string_view pack_code,
                                         double mean_conf, double plain_ratio, int word_count);

// Picks the best-scoring candidate pack code (empty if `candidates` is empty).
std::string pick_best_candidate(const std::vector<OcrCandidateScore>& candidates);

// Given a multi-language text block and a list of enabled pack codes sharing its script,
// selects the highest-scoring language pack purely from text cues (used to tag distinct blocks
// without re-running Tesseract when a single script pass already yielded clean text).
std::string detect_same_script_pack(std::string_view utf8_text,
                                    const std::vector<std::string>& candidate_codes);

}  // namespace mfbe::pdf_reader
