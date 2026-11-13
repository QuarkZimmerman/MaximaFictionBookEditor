#pragma once
// Feature 014 (research R3 step 9, plan DP-18, tasks T028): the export's own check of the finished
// file, before anything is written. A fault writes nothing (D22, FR-041).

#include <string>
#include <vector>

namespace mfbe::pdf {

/// The faults of `finished`: a font without its program or ToUnicode map, encryption, a page whose
/// text (read back with Poppler) differs from `page_texts` (the page map's), or a page count that
/// differs. Empty when the file is sound. `page_texts` empty: the text is not compared.
std::vector<std::string> check_finished(const std::vector<char>& finished,
                                        const std::vector<std::string>& page_texts);

/// The text of a page as the check compares it: no whitespace at all.
std::string comparable(const std::string& text);

}  // namespace mfbe::pdf
