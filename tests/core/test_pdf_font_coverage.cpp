// Feature 014 (SC-018, D7, research R5; tasks T031): every character CLDR lists for a language
// written in Latin, Cyrillic, Greek, Georgian or Armenian - its main, auxiliary, punctuation and
// digit sets (tests/core/data/cldr-exemplars.json, written by tools/fonts/cldr-coverage.py from
// CLDR 49.0.0) - is drawn by the shipped fonts: in regular and bold, and in italic for Latin,
// Cyrillic and Greek. Each character is looked up as the paged document's font list looks it up
// (ui/src/features/pdf/export/layout.ts): the text family, then the script's own family (Georgian,
// Armenian), then the shipped monospace family, whose punctuation fills a few gaps of the text
// families (Hungarian's ⟨⟩, Occitan's ⋅).
//
// Venetian's CLDR punctuation holds the CJK angle brackets 〈〉 (U+3008, U+3009), which no shipped
// font has: they are drawn with a system font and listed (D7). That gap is recorded here exactly,
// awaiting the requester's decision; any other gap fails the test.

#include "pdf/coverage.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <map>
#include <set>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

std::u32string code_points(const std::string& utf8) {
    std::u32string out;
    for (std::size_t i = 0; i < utf8.size();) {
        const unsigned char c = static_cast<unsigned char>(utf8[i]);
        const int extra = c < 0x80 ? 0 : (c >> 5) == 0x6 ? 1 : (c >> 4) == 0xE ? 2 : 3;
        char32_t cp = extra == 0 ? c : c & (0x3F >> extra);
        for (int k = 1; k <= extra && i + k < utf8.size(); ++k) {
            cp = (cp << 6) | (static_cast<unsigned char>(utf8[i + k]) & 0x3F);
        }
        out.push_back(cp);
        i += static_cast<std::size_t>(extra) + 1;
    }
    return out;
}

}  // namespace

TEST_CASE("pdf fonts: the shipped fonts draw every character CLDR lists (SC-018)", "[pdf][fonts]") {
    const auto repo = test::fixtures_dir().parent_path().parent_path();
    const auto fonts = repo / "resources" / "fonts";
    const auto table = nlohmann::json::parse(
        atomic_file::read_file(repo / "tests" / "core" / "data" / "cldr-exemplars.json"));
    REQUIRE(table["cldr"] == "49.0.0");
    REQUIRE(table["languages"].size() > 400);

    std::map<std::string, std::set<char32_t>> coverage;
    const auto covered = [&](const std::string& file) -> const std::set<char32_t>& {
        auto it = coverage.find(file);
        if (it == coverage.end()) {
            it = coverage.emplace(file, pdf::font_coverage(fonts / file)).first;
        }
        return it->second;
    };
    const std::map<std::string, std::string> mono = {
        {"Regular", "DejaVuSansMono.ttf"},
        {"Bold", "DejaVuSansMono-Bold.ttf"},
        {"Italic", "DejaVuSansMono-Oblique.ttf"},
        {"BoldItalic", "DejaVuSansMono-BoldOblique.ttf"}};
    std::set<std::string> faults;
    int checked = 0;
    for (const auto& [locale, entry] : table["languages"].items()) {
        const std::string script = entry["script"];
        const std::u32string chars = code_points(entry["chars"].get<std::string>());
        // Georgian and Armenian have their own families, in regular and bold only (the engine
        // slants them for italic).
        const std::string own = script == "Geor" ? "Georgian" : script == "Armn" ? "Armenian" : "";
        const std::vector<std::string> styles =
            own.empty() ? std::vector<std::string>{"Regular", "Bold", "Italic", "BoldItalic"}
                        : std::vector<std::string>{"Regular", "Bold"};
        for (const std::string family : {"NotoSerif", "NotoSans"}) {
            for (const std::string& style : styles) {
                const auto& text = covered(family + "-" + style + ".ttf");
                const auto* letters =
                    own.empty() ? nullptr : &covered(family + own + "-" + style + ".ttf");
                const auto& fallback = covered(mono.at(style));
                std::u32string missing;
                for (char32_t c : chars) {
                    if (!text.contains(c) && !(letters && letters->contains(c)) &&
                        !fallback.contains(c)) {
                        missing.push_back(c);
                    }
                }
                ++checked;
                if (!missing.empty())
                    faults.insert(locale + ": " + pdf::utf8(missing));
            }
        }
    }
    INFO("checked " << checked << " locale and style pairs");
    for (const std::string& fault : faults) {
        UNSCOPED_INFO(fault);
    }
    CHECK(faults == std::set<std::string>{"vec: 〈〉"});
}
