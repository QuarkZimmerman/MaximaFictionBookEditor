#pragma once
// Feature 014 (D5, research R3 step 3, tasks T025): Chromium maps ligature glyphs to the Unicode
// ligature characters (U+FB00 to U+FB06), so copy and search see "ﬁ", not "fi". The finishing step
// rewrites each ToUnicode CMap so that those glyphs map to their letters.

#include <string>

namespace mfbe::pdf {

/// The CMap `cmap` with every destination U+FB00..U+FB06 replaced by its letters; bfrange entries
/// that reach a ligature are written out as bfchar entries. Unchanged when it has none.
std::string decompose_ligatures(const std::string& cmap);

}  // namespace mfbe::pdf
