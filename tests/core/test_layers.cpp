// T020: layered resource lookup. Feature 003 US4 (T043/T045): the settings layer of the
// dictionaries kind (`Roots::settings_dictionaries`), the `readable` flag of a layer and the
// winning layer recorded with every conflict.
#include "test_support.hpp"

#include <mfbe/resources.hpp>

#include <catch2/catch_test_macros.hpp>
#include <map>

#ifndef _WIN32
#include <unistd.h>
#endif

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
    CHECK(dicts[0].path.empty());  // no dictionaries folder chosen in Settings
    CHECK(dicts[3].path == tmp / "bundled" / "dictionaries");

    const json report = layers.report();
    REQUIRE(report.size() == 12);
    CHECK(report[0] == json{{"kind", "genres"},
                            {"layer", "settings"},
                            {"path", (tmp / "custom-genres").string()},
                            {"exists", false},
                            {"readable", false},
                            {"writable", false}});
    CHECK(report[1]["readable"] == true);  // <Data>/genres exists and can be listed
    CHECK(report[11]["kind"] == "dictionaries");
    CHECK(report[11]["layer"] == "bundled");
}

TEST_CASE(
    "layers: the dictionaries folder chosen in Settings is the settings layer; lookup order "
    "bundled, settings, user, portable (feature 003 US4)",
    "[layers]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    roots.settings_dictionaries = tmp / "chosen-dicts";
    for (const char* folder : {"bundled", "chosen-dicts", "data", "portable"}) {
        const std::filesystem::path base =
            std::string(folder) == "chosen-dicts" ? tmp / folder : tmp / folder / "dictionaries";
        touch(base / "de_DE.aff", "SET UTF-8\n");
        touch(base / "de_DE.dic", "1\nHaus\n");
    }
    touch(tmp / "bundled" / "dictionaries" / "en_US.aff", "SET UTF-8\n");
    touch(tmp / "bundled" / "dictionaries" / "en_US.dic", "1\nhouse\n");
    touch(tmp / "chosen-dicts" / "pl_PL.aff", "SET ISO8859-2\n");
    touch(tmp / "chosen-dicts" / "pl_PL.dic", "1\ncma\n");
    touch(tmp / "data" / "dictionaries" / "pl_PL.aff", "SET ISO8859-2\n");
    touch(tmp / "data" / "dictionaries" / "pl_PL.dic", "1\ncma\n");
    touch(tmp / "portable" / "dictionaries" / "be_BY.aff", "SET UTF-8\n");
    touch(tmp / "portable" / "dictionaries" / "be_BY.dic", "1\nмова\n");
    resources::ResourceLayers layers(roots);

    const auto dicts = layers.layers(resources::Kind::dictionaries);
    REQUIRE(dicts.size() == 4);
    CHECK(dicts[0].layer == resources::LayerName::settings);
    CHECK(dicts[0].path == tmp / "chosen-dicts");
    CHECK(dicts[0].exists);
    CHECK(dicts[0].readable);
    CHECK(dicts[1].layer == resources::LayerName::user);
    CHECK(dicts[1].path == tmp / "data" / "dictionaries");
    CHECK(dicts[2].layer == resources::LayerName::portable);
    CHECK(dicts[3].layer == resources::LayerName::bundled);
    // The genres and scripts settings folders stay independent of the dictionaries one.
    CHECK(layers.layers(resources::Kind::genres)[0].path.empty());
    CHECK(layers.layers(resources::Kind::scripts)[0].path.empty());

    std::vector<resources::Conflict> conflicts;
    const auto entries = layers.list(resources::Kind::dictionaries, &conflicts);
    std::map<std::string, resources::LayerName> by_id;
    for (const auto& e : entries) {
        by_id[e.id] = e.layer;
    }
    REQUIRE(by_id.size() == 4);
    CHECK(by_id.at("de_DE") == resources::LayerName::bundled);
    CHECK(by_id.at("en_US") == resources::LayerName::bundled);
    CHECK(by_id.at("pl_PL") == resources::LayerName::settings);  // chosen beats per-user
    CHECK(by_id.at("be_BY") == resources::LayerName::portable);
    // Every lower-priority duplicate is a conflict naming the layer that stays in effect.
    REQUIRE(conflicts.size() == 4);
    std::map<std::string, resources::LayerName> winner_of;
    for (const auto& c : conflicts) {
        CHECK(c.kind == resources::Kind::dictionaries);
        winner_of[(c.ignored.parent_path() / c.id).string()] = c.kept_layer;
        if (c.id == "de_DE") {
            CHECK(c.kept == tmp / "bundled" / "dictionaries" / "de_DE.aff");
            CHECK(c.kept_layer == resources::LayerName::bundled);
        } else {
            CHECK(c.id == "pl_PL");
            CHECK(c.kept == tmp / "chosen-dicts" / "pl_PL.aff");
            CHECK(c.kept_layer == resources::LayerName::settings);
            CHECK(c.ignored == tmp / "data" / "dictionaries" / "pl_PL.aff");
            CHECK(c.ignored_layer == resources::LayerName::user);
        }
    }
    CHECK(winner_of.count((tmp / "chosen-dicts" / "de_DE").string()) == 1);
    CHECK(winner_of.count((tmp / "data" / "dictionaries" / "de_DE").string()) == 1);
    CHECK(winner_of.count((tmp / "portable" / "dictionaries" / "de_DE").string()) == 1);
    CHECK(winner_of.count((tmp / "data" / "dictionaries" / "pl_PL").string()) == 1);

    const json report = layers.report();
    CHECK(report[8] == json{{"kind", "dictionaries"},
                            {"layer", "settings"},
                            {"path", (tmp / "chosen-dicts").string()},
                            {"exists", true},
                            {"readable", true},
                            {"writable", true}});
}

#ifndef _WIN32
TEST_CASE("layers: a folder that cannot be read is reported as unreadable and skipped",
          "[layers]") {
    if (::geteuid() == 0) {
        SKIP("root reads folders without permissions");
    }
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    roots.settings_dictionaries = tmp / "locked";
    touch(tmp / "locked" / "de_DE.aff", "SET UTF-8\n");
    touch(tmp / "locked" / "de_DE.dic", "1\nHaus\n");
    touch(tmp / "data" / "dictionaries" / "de_DE.aff", "SET UTF-8\n");
    touch(tmp / "data" / "dictionaries" / "de_DE.dic", "1\nHaus\n");
    std::filesystem::permissions(tmp / "locked", std::filesystem::perms::none);
    resources::ResourceLayers layers(roots);
    const auto dicts = layers.layers(resources::Kind::dictionaries);
    CHECK(dicts[0].exists);
    CHECK_FALSE(dicts[0].readable);
    CHECK_FALSE(dicts[0].writable);
    CHECK(dicts[1].readable);
    std::vector<resources::Conflict> conflicts;
    const auto entries = layers.list(resources::Kind::dictionaries, &conflicts);
    std::filesystem::permissions(tmp / "locked", std::filesystem::perms::owner_all);
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].layer == resources::LayerName::user);  // the default folder is used
    CHECK(conflicts.empty());
}
#endif

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

TEST_CASE("layers: a portable folder that holds the data is listed once, as the user layer",
          "[layers]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    roots.portable = roots.user_data;
    touch(tmp / "data" / "genres" / "mine.genres.tsv");
    resources::ResourceLayers layers(roots);

    const auto genres = layers.layers(resources::Kind::genres);
    REQUIRE(genres.size() == 4);
    CHECK(genres[1].layer == resources::LayerName::user);
    CHECK(genres[1].path == tmp / "data" / "genres");
    CHECK(genres[2].layer == resources::LayerName::portable);
    CHECK(genres[2].path.empty());
    CHECK_FALSE(genres[2].exists);

    std::vector<resources::Conflict> conflicts;
    const auto entries = layers.list(resources::Kind::genres, &conflicts);
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].layer == resources::LayerName::user);
    CHECK(conflicts.empty());
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

// Feature 015 (FR-004, research R2): every item of a user layer that the editor does not use is
// listed with its reason; nothing is passed over silently. Bundled layers are never listed.
namespace {

std::map<std::string, std::string> reasons_of(const std::vector<resources::PassedOver>& items) {
    std::map<std::string, std::string> out;
    for (const auto& item : items) {
        out[item.path.filename().string()] = item.reason;
    }
    return out;
}

}  // namespace

TEST_CASE("layers: passed-over genre items are listed with their reasons (feature 015)",
          "[layers][015]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    roots.settings_genres = tmp / "chosen-genres";
    touch(tmp / "data" / "genres" / "my.genres.tsv", "my_genre\tOther\tMine\tМой\n");
    touch(tmp / "data" / "genres" / "genres.txt", "x\tOther\tX\tX\n");
    touch(tmp / "data" / "genres" / "genres.tsv", "x\tOther\tX\tX\n");
    std::filesystem::create_directories(tmp / "data" / "genres" / "folder.genres.tsv");
    touch(tmp / "data" / "genres" / ".hidden.txt");
    // Windows-1251 text: not UTF-8, so not used (garbled names would be worse).
    touch(tmp / "chosen-genres" / "cp1251.genres.tsv", std::string("x\tOther\tX\t\xcc\xee\xe9\n"));
    touch(tmp / "portable" / "genres" / "notes.md", "a note");
    touch(tmp / "bundled" / "genres" / "README.txt", "bundled files are never listed");
    resources::ResourceLayers layers(roots);

    const auto items = layers.passed_over(resources::Kind::genres);
    const auto reasons = reasons_of(items);
    CHECK(reasons.at("genres.txt") == "name");
    CHECK(reasons.at("genres.tsv") == "name");
    CHECK(reasons.at("folder.genres.tsv") == "notAFile");
    CHECK(reasons.at("cp1251.genres.tsv") == "encoding");
    CHECK(reasons.at("notes.md") == "name");
    CHECK(reasons.count("my.genres.tsv") == 0);
    CHECK(reasons.count(".hidden.txt") == 0);
    CHECK(reasons.count("README.txt") == 0);
    for (const auto& item : items) {
        CHECK(item.kind == resources::Kind::genres);
        CHECK(item.layer != resources::LayerName::bundled);
        if (item.path.filename() == "cp1251.genres.tsv") {
            CHECK(item.layer == resources::LayerName::settings);
        }
        if (item.path.filename() == "notes.md") {
            CHECK(item.layer == resources::LayerName::portable);
        }
    }
}

TEST_CASE(
    "layers: passed-over script and dictionary items are listed with their reasons "
    "(feature 015)",
    "[layers][015]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    touch(tmp / "data" / "scripts" / "my-script" / "script.json", "{}");
    touch(tmp / "data" / "scripts" / "stray.js", "// bare file");
    touch(tmp / "data" / "scripts" / "no-description" / "index.js", "// no script.json");
    touch(tmp / "data" / "scripts" / "20_group" / "good" / "script.json", "{}");
    touch(tmp / "data" / "scripts" / "20_group" / "group.json", "{}");
    touch(tmp / "data" / "scripts" / "20_group" / "broken" / "index.js", "// no script.json");
    touch(tmp / "data" / "dictionaries" / "xx_XX.aff");
    touch(tmp / "data" / "dictionaries" / "xx_XX.dic");
    touch(tmp / "data" / "dictionaries" / "xx_XX.txt", "the dictionary's notice");
    touch(tmp / "data" / "dictionaries" / "yy_YY.aff");
    touch(tmp / "data" / "dictionaries" / "zz_ZZ.dic");
    touch(tmp / "bundled-scripts" / "stray.txt", "bundled files are never listed");
    resources::ResourceLayers layers(roots);

    const auto scripts = reasons_of(layers.passed_over(resources::Kind::scripts));
    CHECK(scripts.at("stray.js") == "notAFolder");
    CHECK(scripts.at("no-description") == "noDescription");
    CHECK(scripts.at("broken") == "noDescription");
    CHECK(scripts.count("my-script") == 0);
    CHECK(scripts.count("20_group") == 0);  // a group of packages
    CHECK(scripts.count("good") == 0);
    CHECK(scripts.count("group.json") == 0);  // the group's own file
    CHECK(scripts.count("stray.txt") == 0);

    const auto dicts = reasons_of(layers.passed_over(resources::Kind::dictionaries));
    CHECK(dicts.at("yy_YY.aff") == "partnerMissing");
    CHECK(dicts.at("zz_ZZ.dic") == "partnerMissing");
    CHECK(dicts.count("xx_XX.aff") == 0);
    CHECK(dicts.count("xx_XX.dic") == 0);
    CHECK(dicts.count("xx_XX.txt") == 0);  // the notice of a usable pair
}

TEST_CASE(
    "layers: a missing chosen folder contributes nothing; a linked folder is followed "
    "(feature 015)",
    "[layers][015]") {
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    roots.settings_genres = tmp / "gone";
    touch(tmp / "real-genres" / "linked.genres.tsv", "linked_genre\tOther\tLinked\tСвязанный\n");
    std::error_code ec;
    std::filesystem::create_directories(tmp / "data", ec);
    std::filesystem::create_directory_symlink(tmp / "real-genres", tmp / "data" / "genres", ec);
    if (ec) {
        SKIP("folder links are not available here: " << ec.message());
    }
    resources::ResourceLayers layers(roots);
    const auto all = layers.layers(resources::Kind::genres);
    CHECK_FALSE(all.front().exists);  // the chosen folder no longer exists
    CHECK(layers.passed_over(resources::Kind::genres).empty());
    const auto genres = layers.list(resources::Kind::genres);
    REQUIRE(genres.size() == 1);
    CHECK(genres[0].id == "linked.genres.tsv");
}

#ifndef _WIN32
TEST_CASE("layers: a genre file that cannot be read is passed over as unreadable (feature 015)",
          "[layers][015]") {
    if (::geteuid() == 0) {
        SKIP("root reads every file");
    }
    test::TempDir tmp;
    auto roots = make_roots(tmp);
    const auto file = tmp / "data" / "genres" / "locked.genres.tsv";
    touch(file, "locked\tOther\tLocked\tЗаперт\n");
    std::filesystem::permissions(file, std::filesystem::perms::none);
    resources::ResourceLayers layers(roots);
    const auto reasons = reasons_of(layers.passed_over(resources::Kind::genres));
    std::filesystem::permissions(file, std::filesystem::perms::owner_all);
    CHECK(reasons.at("locked.genres.tsv") == "unreadable");
}
#endif
