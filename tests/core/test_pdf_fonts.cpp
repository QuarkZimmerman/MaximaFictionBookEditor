// Feature 014 (D7(c), DP-6, data-model AddedFont; tasks T049): the fonts the user adds - read with
// FreeType, refused when their embedding permission forbids it, kept once in <Data>/fonts/.

#include "pdf/fonts.hpp"
#include "pdf/limits.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <filesystem>
#include <string>

using namespace mfbe;

namespace {

std::filesystem::path shipped() {
    return test::fixtures_dir().parent_path().parent_path() / "resources" / "fonts";
}

std::string font(const char* name) {
    return atomic_file::read_file(shipped() / name);
}

// A copy of `bytes` whose OS/2 fsType is `fs_type` (the table's offset 8; FreeType does not check
// the table's checksum).
std::string with_fs_type(std::string bytes, std::uint16_t fs_type) {
    const auto u16 = [&](std::size_t at) {
        return static_cast<unsigned>(static_cast<unsigned char>(bytes[at]) << 8 |
                                     static_cast<unsigned char>(bytes[at + 1]));
    };
    const auto u32 = [&](std::size_t at) { return u16(at) << 16 | u16(at + 2); };
    for (unsigned i = 0, n = u16(4); i < n; ++i) {
        const std::size_t entry = 12 + 16 * i;
        if (bytes.compare(entry, 4, "OS/2") == 0) {
            const std::size_t at = u32(entry + 8) + 8;
            bytes[at] = static_cast<char>(fs_type >> 8);
            bytes[at + 1] = static_cast<char>(fs_type & 0xFF);
        }
    }
    return bytes;
}

}  // namespace

TEST_CASE("pdf fonts: a font's names, kind and permission, read with FreeType", "[pdf][fonts]") {
    const auto serif = pdf::inspect_font(font("NotoSerif-Regular.ttf"), 0);
    REQUIRE(serif.font);
    CHECK(serif.font->family == "Noto Serif");
    CHECK(serif.font->style == "Regular");
    CHECK(serif.font->kind == "serif");
    CHECK_FALSE(serif.font->whole_font);
    CHECK(serif.faces == std::vector<std::string>{"Noto Serif Regular"});
    // Noto Sans leaves its OS/2 family class 0: PANOSE says sans.
    CHECK(pdf::inspect_font(font("NotoSans-Regular.ttf"), 0).font->kind == "sans-serif");
    CHECK(pdf::inspect_font(font("DejaVuSansMono.ttf"), 0).font->kind == "monospace");

    // DP-6: restricted licence embedding (fsType 2) and bitmap embedding only without bitmaps are
    // refused; "No subsetting" (bit 8) is embedded whole.
    CHECK(pdf::inspect_font(with_fs_type(font("NotoSerif-Regular.ttf"), 0x0002), 0).refused ==
          "restricted");
    CHECK(pdf::inspect_font(with_fs_type(font("NotoSerif-Regular.ttf"), 0x0200), 0).refused ==
          "bitmapOnly");
    const auto whole = pdf::inspect_font(with_fs_type(font("NotoSerif-Regular.ttf"), 0x0108), 0);
    REQUIRE(whole.font);
    CHECK(whole.font->whole_font);
    CHECK(whole.font->fs_type == 0x0108);
    CHECK(pdf::inspect_font("not a font", 0).refused == "unreadable");
    CHECK(pdf::inspect_font(font("NotoSerif-Regular.ttf"), 3).refused == "unreadable");
}

TEST_CASE("pdf fonts: added once, listed, removed with its file", "[pdf][fonts]") {
    test::TempDir temp;
    const auto dir = temp.path() / "fonts";
    const std::string bytes = font("DejaVuSansMono.ttf");
    const auto added = pdf::add_font(dir, bytes, "TTF", 0, "file", "DejaVuSansMono.ttf");
    REQUIRE(added.font);
    CHECK(added.refused.empty());
    CHECK(added.font->id.size() == 64);
    CHECK(added.font->file == added.font->id + ".ttf");
    CHECK(std::filesystem::exists(dir / added.font->file));
    const auto again = pdf::add_font(dir, bytes, "ttf", 0, "installed", "DejaVu Sans Mono");
    CHECK(again.refused == "duplicate");
    REQUIRE(again.font);
    CHECK(again.font->source == "file");
    const auto listed = pdf::added_fonts(dir);
    REQUIRE(listed.size() == 1);
    CHECK(listed[0].kind == "monospace");
    CHECK(listed[0].source_name == "DejaVuSansMono.ttf");
    CHECK(pdf::remove_font(dir, added.font->id));
    CHECK_FALSE(std::filesystem::exists(dir / added.font->file));
    CHECK(pdf::added_fonts(dir).empty());
    CHECK_FALSE(pdf::remove_font(dir, added.font->id));
    // DP-19: over 64 MB, refused before it is read.
    CHECK(pdf::add_font(dir, std::string(pdf::kMaxAddedFontBytes + 1, '\0'), "ttf", 0, "file",
                        "big.ttf")
              .refused == "tooLarge");
}
