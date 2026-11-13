// Feature 014 (plan DP-1, research R5, tasks T017): the shipped fonts' index.

#include "pdf/fonts.hpp"

#include <mfbe/atomic_file.hpp>

#include <nlohmann/json.hpp>

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_TRUETYPE_TABLES_H

#include "pdf/limits.hpp"
#include "util/sha256.hpp"

#include <algorithm>
#include <memory>
#include <stdexcept>
#include <system_error>

namespace mfbe::pdf {

std::vector<ShippedFamily> shipped_families(const std::filesystem::path& fonts_dir) {
    std::vector<ShippedFamily> families;
    nlohmann::json index;
    try {
        index = nlohmann::json::parse(atomic_file::read_file(fonts_dir / "fonts.json"));
    } catch (const std::exception&) {
        return families;
    }
    if (!index.contains("families") || !index["families"].is_array())
        return families;
    for (const auto& f : index["families"]) {
        if (!f.is_object() || !f.contains("id") || !f["id"].is_string())
            continue;
        ShippedFamily family;
        family.id = f["id"].get<std::string>();
        family.kind = f.value("kind", std::string("serif"));
        family.text_font = f.value("textFont", false);
        family.licence = f.value("licence", std::string());
        family.notice = f.value("notice", std::string());
        if (f.contains("scripts") && f["scripts"].is_array()) {
            for (const auto& s : f["scripts"]) {
                if (s.is_string())
                    family.scripts.push_back(s.get<std::string>());
            }
        }
        if (f.contains("styles") && f["styles"].is_object()) {
            for (const auto& [style, file] : f["styles"].items()) {
                if (file.is_string())
                    family.styles[style] = file.get<std::string>();
            }
        }
        families.push_back(std::move(family));
    }
    return families;
}

std::optional<std::filesystem::path> shipped_file(const std::filesystem::path& fonts_dir,
                                                  const std::string& id, const std::string& style) {
    for (const ShippedFamily& family : shipped_families(fonts_dir)) {
        if (family.id != id)
            continue;
        const auto it = family.styles.find(style);
        if (it == family.styles.end())
            return std::nullopt;
        // The index names plain files of the folder; anything else is not served.
        if (it->second.find('/') != std::string::npos ||
            it->second.find('\\') != std::string::npos || it->second.starts_with(".")) {
            return std::nullopt;
        }
        const auto path = fonts_dir / it->second;
        std::error_code ec;
        if (std::filesystem::is_regular_file(path, ec))
            return path;
        return std::nullopt;
    }
    return std::nullopt;
}

namespace {

struct FreeType {
    FT_Library library = nullptr;
    FreeType() {
        if (FT_Init_FreeType(&library) != 0)
            library = nullptr;
    }
    ~FreeType() {
        if (library)
            FT_Done_FreeType(library);
    }
    FreeType(const FreeType&) = delete;
    FreeType& operator=(const FreeType&) = delete;
};

struct Face {
    FT_Face face = nullptr;
    ~Face() {
        if (face)
            FT_Done_Face(face);
    }
};

// R5's kinds from the font's own data (OpenType OS/2): fixed pitch is monospace; the IBM family
// class (sFamilyClass, its high byte) 8 is sans-serif and 1-7 the serif classes; many fonts leave
// it 0 (Noto Sans does), and then PANOSE decides when it is "Latin Text" (bFamilyType 2): a
// monospaced proportion (9) is monospace, a serif style of 11-15 (the sans styles: normal, obtuse,
// perpendicular, flared, rounded) sans-serif. Anything else reads as serif.
std::string kind_of(FT_Face face) {
    if (FT_IS_FIXED_WIDTH(face))
        return "monospace";
    const auto* os2 = static_cast<const TT_OS2*>(FT_Get_Sfnt_Table(face, FT_SFNT_OS2));
    if (os2 == nullptr)
        return "serif";
    const int family_class = (os2->sFamilyClass >> 8) & 0xFF;
    if (family_class == 8)
        return "sans-serif";
    if (family_class >= 1 && family_class <= 7)
        return "serif";
    if (os2->panose[0] == 2) {
        if (os2->panose[3] == 9)
            return "monospace";
        if (os2->panose[1] >= 11 && os2->panose[1] <= 15)
            return "sans-serif";
    }
    return "serif";
}

nlohmann::json to_json(const AddedFont& f) {
    return {{"id", f.id},          {"file", f.file},
            {"face", f.face},      {"family", f.family},
            {"style", f.style},    {"kind", f.kind},
            {"fsType", f.fs_type}, {"wholeFont", f.whole_font},
            {"source", f.source},  {"sourceName", f.source_name}};
}

void write_index(const std::filesystem::path& dir, const std::vector<AddedFont>& fonts) {
    nlohmann::json list = nlohmann::json::array();
    for (const AddedFont& f : fonts)
        list.push_back(to_json(f));
    atomic_file::write_atomic(dir / "fonts.json",
                              nlohmann::json{{"version", 1}, {"fonts", list}}.dump(2));
}

}  // namespace

FontInspection inspect_font(std::string_view bytes, int face_index) {
    FontInspection out;
    FreeType ft;
    if (!ft.library || bytes.empty()) {
        out.refused = "unreadable";
        return out;
    }
    const auto* data = reinterpret_cast<const FT_Byte*>(bytes.data());
    const auto size = static_cast<FT_Long>(bytes.size());
    Face probe;
    if (FT_New_Memory_Face(ft.library, data, size, -1, &probe.face) != 0 ||
        probe.face->num_faces < 1) {
        out.refused = "unreadable";
        return out;
    }
    const FT_Long count = probe.face->num_faces;
    for (FT_Long n = 0; n < count; ++n) {
        Face each;
        if (FT_New_Memory_Face(ft.library, data, size, n, &each.face) != 0)
            continue;
        std::string name = each.face->family_name ? each.face->family_name : "";
        if (each.face->style_name)
            name += std::string(name.empty() ? "" : " ") + each.face->style_name;
        out.faces.push_back(name);
    }
    if (face_index < 0 || face_index >= count) {
        out.refused = "unreadable";
        return out;
    }
    Face chosen;
    if (FT_New_Memory_Face(ft.library, data, size, face_index, &chosen.face) != 0) {
        out.refused = "unreadable";
        return out;
    }
    // D7(c), DP-6: the embedding permission the font declares (OpenType OS/2 fsType).
    const FT_UShort fs_type = FT_Get_FSType_Flags(chosen.face);
    if ((fs_type & 0x000F) == FT_FSTYPE_RESTRICTED_LICENSE_EMBEDDING) {
        out.refused = "restricted";
        return out;
    }
    if ((fs_type & FT_FSTYPE_BITMAP_EMBEDDING_ONLY) != 0 && !FT_HAS_FIXED_SIZES(chosen.face)) {
        out.refused = "bitmapOnly";
        return out;
    }
    AddedFont font;
    font.face = face_index;
    font.family = chosen.face->family_name ? chosen.face->family_name : "";
    font.style = chosen.face->style_name ? chosen.face->style_name : "";
    font.kind = kind_of(chosen.face);
    font.fs_type = fs_type;
    font.whole_font = (fs_type & FT_FSTYPE_NO_SUBSETTING) != 0;
    out.font = font;
    return out;
}

std::vector<AddedFont> added_fonts(const std::filesystem::path& dir) {
    std::vector<AddedFont> out;
    std::error_code ec;
    if (!std::filesystem::exists(dir / "fonts.json", ec))
        return out;
    const nlohmann::json j =
        nlohmann::json::parse(atomic_file::read_file(dir / "fonts.json"), nullptr, false);
    if (!j.is_object() || !j.contains("fonts") || !j["fonts"].is_array())
        return out;
    for (const nlohmann::json& e : j["fonts"]) {
        if (!e.is_object())
            continue;
        AddedFont f;
        f.id = e.value("id", std::string());
        f.file = e.value("file", std::string());
        f.face = e.value("face", 0);
        f.family = e.value("family", std::string());
        f.style = e.value("style", std::string());
        f.kind = e.value("kind", std::string("serif"));
        f.fs_type = e.value("fsType", 0);
        f.whole_font = e.value("wholeFont", false);
        f.source = e.value("source", std::string("file"));
        f.source_name = e.value("sourceName", std::string());
        // Only plain names inside the folder: an index edited by hand cannot point elsewhere.
        if (f.id.empty() || f.file.empty() || f.file.find_first_of("/\\") != std::string::npos)
            continue;
        out.push_back(std::move(f));
    }
    return out;
}

AddResult add_font(const std::filesystem::path& dir, std::string_view bytes, const std::string& ext,
                   int face, const std::string& source, const std::string& source_name) {
    AddResult result;
    if (bytes.size() > kMaxAddedFontBytes) {
        result.refused = "tooLarge";  // DP-19
        return result;
    }
    FontInspection inspection = inspect_font(bytes, face);
    result.faces = inspection.faces;
    if (!inspection.font) {
        result.refused = inspection.refused;
        return result;
    }
    const std::string sha = util::sha256_hex(bytes);
    AddedFont font = *inspection.font;
    font.id = face > 0 ? sha + "-" + std::to_string(face) : sha;
    std::string extension = ext;
    std::transform(extension.begin(), extension.end(), extension.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (extension != "ttf" && extension != "otf" && extension != "ttc" && extension != "otc") {
        extension = "ttf";
    }
    font.file = sha + "." + extension;
    font.source = source;
    font.source_name = source_name;
    std::vector<AddedFont> fonts = added_fonts(dir);
    for (const AddedFont& existing : fonts) {
        if (existing.id == font.id) {
            result.font = existing;
            result.refused = "duplicate";
            return result;
        }
    }
    std::filesystem::create_directories(dir);
    if (std::error_code ec; !std::filesystem::exists(dir / font.file, ec)) {
        atomic_file::write_atomic(dir / font.file, bytes);
    }
    fonts.push_back(font);
    write_index(dir, fonts);
    result.font = font;
    return result;
}

bool remove_font(const std::filesystem::path& dir, const std::string& id) {
    std::vector<AddedFont> fonts = added_fonts(dir);
    const auto it =
        std::find_if(fonts.begin(), fonts.end(), [&](const AddedFont& f) { return f.id == id; });
    if (it == fonts.end())
        return false;
    const std::string file = it->file;
    fonts.erase(it);
    write_index(dir, fonts);
    const bool shared =
        std::any_of(fonts.begin(), fonts.end(), [&](const AddedFont& f) { return f.file == file; });
    if (!shared) {
        std::error_code ec;
        std::filesystem::remove(dir / file, ec);
    }
    return true;
}

}  // namespace mfbe::pdf
