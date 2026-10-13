// Words tool engine (T135, FR-080) - contracts/rpc-api.md §3.5.
//
// `analyze()` walks every text run of the document - bodies (all node types incl. tables,
// poems, cites, titles), the description's annotation/history blocks, book titles, keywords,
// author names, sequences, publish info, custom info - segments it into words and counts
// distinct words (case-sensitive, as the original Words dialog did).
//
// Segmentation (Unicode-aware, no ICU):
//   - word characters are letters (unicode::is_letter), combining marks and decimal digits;
//     a word is a maximal run of them, but tokens made of digits only ("1984") are skipped;
//   - apostrophes (U+0027, U+2019, U+02BC) and hyphens (U+002D, U+2010, U+2011) belong to the
//     word when a word character stands on both sides ("don't", "кто-то"); at an edge they
//     are separators;
//   - the soft hyphen (U+00AD) is removed (joins the halves of a hyphenated word);
//   - NBSP (U+00A0), other spaces, punctuation and any other character separate words.
// Exclusions (resource-formats.md §4) are filtered unless `include_exclusions` is set.
#pragma once

#include <mfbe/document.hpp>

#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::words {

struct WordStat {
    std::string word;
    std::int64_t count = 0;
    bool excluded = false;  // listed in the exclusion list (only with include_exclusions)
};

struct AnalyzeOptions {
    bool include_exclusions = false;
    // Returns true when `word` is excluded (the settings::ExclusionList); may be empty.
    std::function<bool(std::string_view)> is_excluded;
};

struct AnalyzeResult {
    std::vector<WordStat> words;   // sorted by word (byte order of UTF-8)
    std::int64_t total_words = 0;  // all word occurrences seen (before filtering)
    std::int64_t duration_ms = 0;
};

// Splits UTF-8 text into words (see header comment).
std::vector<std::string> segment(std::string_view text);

// Visits every text run of the document (bodies first, then description fields).
void visit_text_runs(const model::Document& document,
                     const std::function<void(std::string_view)>& visitor);

AnalyzeResult analyze(const model::Document& document, const AnalyzeOptions& options = {});

}  // namespace mfbe::words
