#pragma once
// Feature 014 (plan DP-1, research R5, tasks T017): the fonts the PDF export ships, as listed by
// resources/fonts/fonts.json (written by tools/fonts/fetch-fonts.py).

#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::pdf {

struct ShippedFamily {
    std::string id;    // noto-serif, noto-sans, dejavu-sans-mono, noto-serif-georgian...
    std::string kind;  // serif | sans-serif | monospace
    std::vector<std::string> scripts;
    bool text_font = false;  // offered as the Text font (D25)
    std::string licence;
    std::string notice;
    std::map<std::string, std::string> styles;  // Regular, Italic, Bold, BoldItalic -> file name
};

/// The families of `fonts_dir`/fonts.json; empty when the index is missing or unreadable.
std::vector<ShippedFamily> shipped_families(const std::filesystem::path& fonts_dir);

/// The file of style `style` of the shipped family `id`, when both exist.
std::optional<std::filesystem::path> shipped_file(const std::filesystem::path& fonts_dir,
                                                  const std::string& id, const std::string& style);

/* ------------------------------------------------------------------------------------------- */
/* Added fonts (D7(c), DP-4, DP-6, data-model AddedFont; tasks T049)                            */
/* ------------------------------------------------------------------------------------------- */

/// A font the user added, kept in `<Data>/fonts/` and listed in its fonts.json. `id` is the SHA-256
/// of the file's bytes, with "-<face>" for a face of a collection other than the first, so that
/// each entry has its own id while one file serves all its faces.
struct AddedFont {
    std::string id;
    std::string file;  // <sha256>.<ext>
    int face = 0;
    std::string family;
    std::string style;
    std::string kind;  // serif | sans-serif | monospace
    int fs_type = 0;
    bool whole_font = false;  // fsType bit 8, "No subsetting": embedded whole (R6)
    std::string source;       // file | installed
    std::string source_name;  // the file's or the installed font's name, for display
};

/// What a font file holds, read with FreeType: the names of its faces, and for face `face` the
/// entry it would become, or the reason it is refused.
struct FontInspection {
    std::vector<std::string> faces;  // "Family Style" of each face
    std::optional<AddedFont> font;
    std::string refused;  // unreadable | restricted | bitmapOnly
};

FontInspection inspect_font(std::string_view bytes, int face);

/// The entries of `dir`/fonts.json (empty when there is none).
std::vector<AddedFont> added_fonts(const std::filesystem::path& dir);

/// The result of adding a font: the entry, or a refusal (unreadable | restricted | bitmapOnly |
/// tooLarge | duplicate - a duplicate also gives the entry already there).
struct AddResult {
    std::optional<AddedFont> font;
    std::string refused;
    std::vector<std::string> faces;  // a collection's faces, to choose from
};

/// Adds `bytes` (a .ttf, .otf, .ttc or .otc file, `ext` without its dot) as face `face`: writes the
/// file and fonts.json atomically. Throws std::runtime_error when `dir` cannot be written.
AddResult add_font(const std::filesystem::path& dir, std::string_view bytes, const std::string& ext,
                   int face, const std::string& source, const std::string& source_name);

/// Removes the entry `id`, and its file when no other entry uses it; false when there is none.
bool remove_font(const std::filesystem::path& dir, const std::string& id);

}  // namespace mfbe::pdf
