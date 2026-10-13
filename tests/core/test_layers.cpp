// T020: layered resource lookup.
#include "test_support.hpp"

#include <mfbe/resources.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;
using nlohmann::json;

namespace {

void touch(const std::filesystem::path& p, const std::string& content = "x") {
    test::write_text(p, content);
}

resources::Roots make_roots(const test::TempDir& tmp) {
    resources::Roots roots;
    roots.user_data = tmp / "data";
    roots.portable = tmp / "portable";
    roots.bundled_resources = tmp / "bundled";
    roots.bundled_scripts = tmp / "bundled-scripts";
    return roots;
}

}  // namespace

TEST_CASE("layers: report lists settings/user/portable/bundled per kind", "[layers]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    roots.settings_genres = tmp / "custom-genres";
    std::filesystem::create_directories(tmp / "bundled" / "genres");
    std::filesystem::create_directories(tmp / "data" / "genres");
    resources::ResourceLayers layers(roots);

    const auto genres = layers.layers(resources::Kind::genres);
    REQUIRE(genres.size() == 4);
    CHECK(genres[0].layer == resources::LayerName::settings);
    CHECK(genres[0].path == tmp / "custom-genres");
    CHECK_FALSE(genres[0].exists);
    CHECK(genres[1].layer == resources::LayerName::user);
    CHECK(genres[1].path == tmp / "data" / "genres");
    CHECK(genres[1].exists);
    CHECK(genres[1].writable);
    CHECK(genres[2].layer == resources::LayerName::portable);
    CHECK(genres[2].path == tmp / "portable" / "genres");
    CHECK(genres[3].layer == resources::LayerName::bundled);
    CHECK(genres[3].path == tmp / "bundled" / "genres");
    CHECK(genres[3].exists);

    const auto scripts = layers.layers(resources::Kind::scripts);
    CHECK(scripts[0].path.empty());  // no custom scripts folder configured
    CHECK(scripts[3].path == tmp / "bundled-scripts");
    const auto dicts = layers.layers(resources::Kind::dictionaries);
    CHECK(dicts[0].path.empty());  // dictionaries have no settings folder
    CHECK(dicts[3].path == tmp / "bundled" / "dictionaries");

    const json report = layers.report();
    REQUIRE(report.size() == 12);
    CHECK(report[0] == json{{"kind", "genres"},
                            {"layer", "settings"},
                            {"path", (tmp / "custom-genres").string()},
                            {"exists", false},
                            {"writable", false}});
    CHECK(report[11]["kind"] == "dictionaries");
    CHECK(report[11]["layer"] == "bundled");
}

TEST_CASE("layers: effective set is additive; bundled wins conflicts; others by priority",
          "[layers]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    roots.settings_genres = tmp / "custom-genres";
    touch(tmp / "bundled" / "genres" / "10-fbe-legacy.genres.tsv");
    touch(tmp / "bundled" / "genres" / "names.en.txt");           // not a genre file
    touch(tmp / "data" / "genres" / "10-fbe-legacy.genres.tsv");  // conflict with bundled
    touch(tmp / "data" / "genres" / "mine.genres.tsv");
    touch(tmp / "data" / "genres" / "Upper.GENRES.TSV");     // case-insensitive suffix
    touch(tmp / "portable" / "genres" / "mine.genres.tsv");  // conflict with user
    touch(tmp / "portable" / "genres" / "portable-only.genres.tsv");
    touch(tmp / "custom-genres" / "mine.genres.tsv");  // settings beats user
    touch(tmp / "custom-genres" / "custom.genres.tsv");
    resources::ResourceLayers layers(roots);

    std::vector<resources::Conflict> conflicts;
    const auto entries = layers.list(resources::Kind::genres, &conflicts);
    std::map<std::string, resources::LayerName> by_id;
    for (const auto& e : entries) {
        by_id[e.id] = e.layer;
    }
    REQUIRE(by_id.size() == 5);
    CHECK(by_id.at("10-fbe-legacy.genres.tsv") == resources::LayerName::bundled);
    CHECK(by_id.at("mine.genres.tsv") == resources::LayerName::settings);
    CHECK(by_id.at("custom.genres.tsv") == resources::LayerName::settings);
    CHECK(by_id.at("Upper.GENRES.TSV") == resources::LayerName::user);
    CHECK(by_id.at("portable-only.genres.tsv") == resources::LayerName::portable);
    REQUIRE(conflicts.size() == 3);
    for (const auto& c : conflicts) {
        CHECK(c.kind == resources::Kind::genres);
        CHECK((c.id == "10-fbe-legacy.genres.tsv" || c.id == "mine.genres.tsv"));
    }
}

TEST_CASE("layers: dictionaries need .aff + .dic, scripts need script.json", "[layers]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    touch(tmp / "bundled" / "dictionaries" / "en_US.aff");
    touch(tmp / "bundled" / "dictionaries" / "en_US.dic");
    touch(tmp / "bundled" / "dictionaries" / "ru_RU.aff");
    touch(tmp / "bundled" / "dictionaries" / "ru_RU.dic");
    touch(tmp / "bundled" / "dictionaries" / "ru_RU.txt");
    touch(tmp / "data" / "dictionaries" / "uk_UA.aff");  // no .dic -> ignored
    touch(tmp / "data" / "dictionaries" / "de_DE.aff");
    touch(tmp / "data" / "dictionaries" / "de_DE.dic");
    touch(tmp / "bundled-scripts" / "01_Clean" / "script.json");
    touch(tmp / "bundled-scripts" / "01_Clean" / "index.js");
    touch(tmp / "bundled-scripts" / "README.md");
    touch(tmp / "data" / "scripts" / "my-script" / "script.json");
    touch(tmp / "data" / "scripts" / "broken" / "index.js");  // no manifest -> ignored
    resources::ResourceLayers layers(roots);

    const auto dicts = layers.list(resources::Kind::dictionaries);
    std::vector<std::string> ids;
    for (const auto& d : dicts) {
        ids.push_back(d.id);
    }
    std::sort(ids.begin(), ids.end());
    CHECK(ids == std::vector<std::string>{"de_DE", "en_US", "ru_RU"});

    const auto scripts = layers.list(resources::Kind::scripts);
    REQUIRE(scripts.size() == 2);
    CHECK(scripts[0].id == "01_Clean");
    CHECK(scripts[0].layer == resources::LayerName::bundled);
    CHECK(std::filesystem::is_directory(scripts[0].path));
    CHECK(scripts[1].id == "my-script");

    // Custom id function.
    const auto custom =
        layers.list(resources::Kind::scripts,
                    [](const std::filesystem::directory_entry& e) -> std::optional<std::string> {
                        if (!e.is_directory()) {
                            return std::nullopt;
                        }
                        return "id:" + e.path().filename().string();
                    });
    CHECK(custom.size() == 3);  // includes "broken"

    CHECK(layers.user_folder(resources::Kind::genres) == tmp / "data" / "genres");
    CHECK_FALSE(std::filesystem::exists(tmp / "data" / "genres"));
    layers.user_folder(resources::Kind::genres, true);
    CHECK(std::filesystem::is_directory(tmp / "data" / "genres"));
}

TEST_CASE("layers: names and kinds round-trip", "[layers]") {
    CHECK(resources::kind_from_string("genres") == resources::Kind::genres);
    CHECK(resources::kind_from_string("scripts") == resources::Kind::scripts);
    CHECK(resources::kind_from_string("dictionaries") == resources::Kind::dictionaries);
    CHECK_FALSE(resources::kind_from_string("fonts").has_value());
    CHECK(std::string(resources::to_string(resources::LayerName::portable)) == "portable");
}
