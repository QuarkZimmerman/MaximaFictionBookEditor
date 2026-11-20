// Feature 010 (US8, spec D31, research DP-15): the encoding of a whole text file - a Markdown file
// to import. UTF-8 (with or without a byte-order mark) and UTF-16 with one are read directly; a
// file in an older encoding is judged by how plausible its words are in each candidate, the way
// the legacy-name judge of feature 009 judges an archive's names. Below a clear margin nothing is
// decided and the caller asks, offering the candidates best first.
#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::text {

struct TextReading {
    bool decided = false;
    std::string encoding;                 // canonical name, when decided
    std::string source;                   // "bom" | "utf8" | "judged", when decided
    std::string utf8;                     // the text, when decided
    std::vector<std::string> candidates;  // the legacy candidates, most plausible first
};

// The legacy encodings the judge weighs, in tie order.
const std::vector<std::string>& legacy_candidates();

// Feature 017 (D26, DP-9): the TXT import's candidates - the encodings of D11's lists for English,
// Russian and Ukrainian, in tie order.
const std::vector<std::string>& txt_candidates();

// Reads `bytes` as text (see above), the legacy encodings judged among legacy_candidates().
TextReading read_text(std::string_view bytes);

// The same with other candidates (feature 017: txt_candidates()); candidates that read the bytes
// alike count once, the earlier standing for both.
TextReading read_text(std::string_view bytes, const std::vector<std::string>& candidates);

// `bytes` in `encoding` ("utf-8", a UTF-16 form, one of legacy_candidates() or of the 28
// single-byte encodings of feature 017); nullopt when the encoding is unknown or cannot read the
// bytes.
std::optional<std::string> decode_text(std::string_view bytes, std::string_view encoding);

// True when the bytes look like a binary file rather than text: a NUL byte, or more than one
// control character in a hundred (a UTF-16 file with a byte-order mark is text).
bool looks_binary(std::string_view bytes);

}  // namespace mfbe::text
