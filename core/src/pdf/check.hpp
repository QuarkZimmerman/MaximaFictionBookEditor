#pragma once
// Feature 014 (research R3 step 9, plan DP-18, tasks T028): the export's own check of the finished
// file, before anything is written. A fault writes nothing (D22, FR-041).

#include "pdf/pictures.hpp"

#include <functional>
#include <string>
#include <vector>

namespace mfbe::pdf {

/// The faults of `finished`: a font without its program or ToUnicode map, a link that leads to no
/// destination of the file, encryption, a page whose text (read back with Poppler) differs from
/// `page_texts` (the page map's), or a page count that differs. Empty when the file is sound.
/// `page_texts` empty: the text is not compared. `progress` is told the pages checked so far and
/// their number.
std::vector<std::string> check_finished(
    const std::vector<char>& finished, const std::vector<std::string>& page_texts,
    const std::function<void(int done, int total)>& progress = {});

/// DP-18: the pictures the core drew, each found drawn in its box (to 1.5 pt) when its page is
/// interpreted - not only present in the file (a transformation the engine's content leaves in
/// force once drew every picture small and upside down). A fault for each picture drawn elsewhere
/// or not at all; `pictures` holds only those that were drawn (not those left out).
std::vector<std::string> check_pictures(const std::vector<char>& finished,
                                        const std::vector<PlacedPicture>& pictures);

/// The text of a page as the check compares it: no whitespace at all.
std::string comparable(const std::string& text);

}  // namespace mfbe::pdf
