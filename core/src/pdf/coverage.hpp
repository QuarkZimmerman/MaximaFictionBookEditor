#pragma once
// Feature 014 (D7, FR-006, research R5; tasks T030, T031): which characters the shipped fonts draw.
// Before the file is written the export checks every character of the pages against them; those
// they lack were drawn with a system font (or as a replacement mark) and are listed (D23).

#include <filesystem>
#include <set>
#include <string>
#include <vector>

namespace mfbe::pdf {

/// The characters a TrueType or OpenType font maps (its `cmap` table, formats 4 and 12); empty when
/// the file is not such a font.
std::set<char32_t> font_coverage(const std::filesystem::path& font_file);

/// The same, of a font program held in memory (a collection's face, written out by font_program).
std::set<char32_t> font_coverage_of(const std::string& font_program);

/// The characters of `texts` (UTF-8) that `font` does not map, in order of first appearance, at
/// most `limit`; whitespace and control characters are not counted.
std::u32string characters_not_in(const std::vector<std::string>& texts,
                                 const std::set<char32_t>& font, std::size_t limit = 200);

/// The characters of `texts` (UTF-8) that no font of `fonts_dir`/fonts.json maps, in order of first
/// appearance, at most `limit`; whitespace and control characters are not counted.
std::u32string uncovered_characters(const std::vector<std::string>& texts,
                                    const std::filesystem::path& fonts_dir,
                                    std::size_t limit = 200);

/// UTF-8 of `text`.
std::string utf8(const std::u32string& text);

}  // namespace mfbe::pdf
