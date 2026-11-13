#pragma once
// Feature 014 (plan DP-1, research R5, tasks T017): the fonts the PDF export ships, as listed by
// resources/fonts/fonts.json (written by tools/fonts/fetch-fonts.py).

#include <filesystem>
#include <map>
#include <optional>
#include <string>
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

}  // namespace mfbe::pdf
