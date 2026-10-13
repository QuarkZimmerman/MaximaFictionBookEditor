// T072/T073: genre catalogue - 186 standard codes from the schema with EN/RU names, the
// bundled legacy extension, user *.genres.tsv parsing (BOM/CRLF/header/bad lines), the
// additive-only rule, the validator hook and the resources.genres / openGenresFolder RPCs.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/genres.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/validator.hpp>

#include <catch2/catch_test_macros.hpp>
#include <set>

using namespace mfbe;
using nlohmann::json;

namespace {

std::filesystem::path resources_root() {
    return std::filesystem::path(MFBE_RESOURCES_SOURCE_DIR);
}

resources::Roots bundled_only_roots(const test::TempDir& tmp) {
    resources::Roots roots;
    roots.user_data = tmp / "data";
    roots.bundled_resources = resources_root();
    roots.bundled_scripts = tmp / "scripts";
    return roots;
}

genres::GenreCatalog load_with(const resources::Roots& roots) {
    validation::set_schema_dir(resources_root() / "schema");
    const resources::ResourceLayers layers(roots);
    return genres::load_catalog(validation::schema_genres(), resources_root() / "genres", layers);
}

const std::vector<std::string> kLegacy = {"adv_indian",         "det_maniac",     "economics_ref",
                                          "prose_contemporary", "sci_psychology", "sf_epic"};

}  // namespace

TEST_CASE("genres: the standard list is the 186 schema codes, all named in EN and RU", "[genres]") {
    test::TempDir tmp{"mfbe-genres"};
    const genres::GenreCatalog catalog = load_with(bundled_only_roots(tmp));
    const auto& schema = validation::schema_genres();
    REQUIRE(schema.size() == 186);
    CHECK(catalog.count("standard") == 186);
    std::set<std::string> codes;
    for (const genres::GenreEntry& e : catalog.entries()) {
        CHECK(genres::is_valid_genre_code(e.code));
        CHECK(codes.insert(e.code).second);  // unique
        REQUIRE(e.names.count("en") == 1);
        REQUIRE(e.names.count("ru") == 1);
        CHECK_FALSE(e.names.at("en").empty());
        CHECK_FALSE(e.names.at("ru").empty());
        // Every code has a real display name (never the bare code) and a category.
        CHECK(e.names.at("en") != e.code);
        CHECK(e.names.at("ru") != e.code);
        CHECK_FALSE(e.category.empty());
        CHECK(catalog.category(e.category) != nullptr);
    }
    for (const std::string& code : schema) {
        CHECK(catalog.contains(code));
        CHECK(catalog.find(code)->source == "standard");
    }
    // Names come from the original FBE tables ...
    CHECK(catalog.find("sf")->names.at("en") == "Science Fiction");
    CHECK(catalog.find("sf")->names.at("ru") == "Научная фантастика");
    CHECK(catalog.find("sf")->category == "sf");
    // ... cross-listed codes keep their prefix category and report the other listings.
    const genres::GenreEntry* child_prose = catalog.find("child_prose");
    REQUIRE(child_prose != nullptr);
    CHECK(child_prose->category == "child");
    CHECK(child_prose->names.at("en") == "Prose for Kids");
    REQUIRE(child_prose->also_in.size() == 1);
    CHECK(child_prose->also_in[0].category == "prose");
    CHECK(child_prose->also_in[0].names.at("en") == "Prose");
    // ... and the 65 codes the FBE lists did not know have names from the supplement.
    CHECK(catalog.find("foreign_sf")->names.at("en") == "Foreign Science Fiction");
    CHECK(catalog.find("foreign_sf")->names.at("ru") == "Зарубежная фантастика");
    CHECK(catalog.find("foreign_sf")->category == "foreign");
    CHECK(catalog.category("foreign")->titles.at("ru") == "Зарубежная литература");
    CHECK(catalog.find("popadanec")->category == "sf");
    CHECK(catalog.find("unrecognised")->category == "other");
    CHECK(catalog.find("geo_guides")->source == "standard");  // in the schema, not legacy
    // Categories: the 16 original ones plus the 4 of the supplement.
    CHECK(catalog.categories().size() == 20);
    CHECK(catalog.category("det")->titles.at("en") == "Detectives, Thrillers");
    // Original table order first (SF block), then schema order for the rest.
    CHECK(catalog.entries()[0].code == "sf_history");
    CHECK(catalog.entries()[1].code == "sf_action");
}

TEST_CASE("genres: the bundled legacy extension adds the six FBE codes missing from the schema",
          "[genres]") {
    test::TempDir tmp{"mfbe-genres"};
    const genres::GenreCatalog catalog = load_with(bundled_only_roots(tmp));
    CHECK(catalog.count("bundled-extension") == kLegacy.size());
    CHECK(catalog.size() == 186 + kLegacy.size());
    for (const std::string& code : kLegacy) {
        const genres::GenreEntry* e = catalog.find(code);
        REQUIRE(e != nullptr);
        CHECK(e->source == "bundled-extension");
        CHECK(e->file->filename() == "10-fbe-legacy.genres.tsv");
        CHECK_FALSE(e->category.empty());
        CHECK(e->names.at("en") != code);
        CHECK(e->names.at("ru") != code);
    }
    CHECK(catalog.find("sf_epic")->names.at("ru") == "Эпическая фантастика");
    CHECK(catalog.find("economics_ref")->category == "economics");
    // The geo_guides line of the bundled file is ignored silently: no issue, still standard.
    CHECK(catalog.issues().empty());
    REQUIRE(catalog.sources().size() == 2);
    CHECK(catalog.sources()[0].source == "standard");
    CHECK(catalog.sources()[0].entries == 186);
    CHECK(catalog.sources()[1].source == "bundled-extension");
    CHECK(catalog.sources()[1].entries == kLegacy.size());
    CHECK(catalog.sources()[1].layer == resources::LayerName::bundled);
}

TEST_CASE("genres: TSV parser accepts BOM/CRLF/header/comments and reports bad lines", "[genres]") {
    const auto good = genres::parse_genres_tsv(
        test::read_text(test::fixtures_dir() / "genres" / "user.genres.tsv"), "user.genres.tsv");
    CHECK(good.issues.empty());
    REQUIRE(good.entries.size() == 3);
    CHECK(good.entries[0].code == "sf_litrpg");
    CHECK(good.entries[0].category == "sf");
    CHECK(good.entries[0].names.at("en") == "LitRPG");
    CHECK(good.entries[0].names.at("ru") == "ЛитРПГ");
    CHECK(good.entries[1].code == "fanfiction");
    CHECK(good.entries[1].category == "fanfic");
    CHECK(good.entries[1].names.at("ru") == "Fan fiction");  // falls back to EN
    CHECK(good.entries[2].names.at("ru") == "RealRPG");      // empty RU column -> EN

    const auto bad = genres::parse_genres_tsv(
        test::read_text(test::fixtures_dir() / "genres" / "bad-lines.genres.tsv"),
        "bad-lines.genres.tsv");
    // Good lines survive: sf (duplicate of a standard code is decided by the catalogue, not the
    // parser), sf_litrpg, ok_genre, whitespace_ok.
    std::vector<std::string> codes;
    for (const auto& e : bad.entries) {
        codes.push_back(e.code);
    }
    CHECK(codes == std::vector<std::string>{"sf", "sf_litrpg", "ok_genre", "whitespace_ok"});
    CHECK(bad.entries[3].category == "det");
    CHECK(bad.entries[3].names.at("en") == "Trimmed name");
    CHECK(bad.entries[3].names.at("ru") == "Обрезанное имя");
    REQUIRE(bad.issues.size() == 5);
    CHECK(bad.issues[0].line == 2);
    CHECK(bad.issues[0].reason == "invalidCode");
    CHECK(bad.issues[1].line == 3);
    CHECK(bad.issues[1].reason == "invalidCode");
    CHECK(bad.issues[2].line == 4);
    CHECK(bad.issues[2].reason == "missingName");
    CHECK(bad.issues[3].line == 5);
    CHECK(bad.issues[3].reason == "invalidCode");
    CHECK(bad.issues[4].line == 9);
    CHECK(bad.issues[4].reason == "duplicate");
    CHECK(bad.issues[4].code == "ok_genre");
    CHECK(bad.issues[4].file == "bad-lines.genres.tsv");
}

TEST_CASE("genres: user files add genres through the layers, never modify existing ones",
          "[genres]") {
    test::TempDir tmp{"mfbe-genres"};
    resources::Roots roots = bundled_only_roots(tmp);
    // Load order: bundled, then the settings layer (custom/: override, user), then the user
    // layer (<Data>/genres: bad-lines).
    roots.settings_genres = tmp / "custom";
    std::filesystem::create_directories(tmp / "custom");
    std::filesystem::create_directories(tmp / "data" / "genres");
    std::filesystem::copy_file(test::fixtures_dir() / "genres" / "user.genres.tsv",
                               tmp / "custom" / "user.genres.tsv");
    std::filesystem::copy_file(test::fixtures_dir() / "genres" / "bad-lines.genres.tsv",
                               tmp / "data" / "genres" / "bad-lines.genres.tsv");
    // A user file trying to redefine a standard code and a legacy code: both ignored.
    test::write_text(tmp / "custom" / "override.genres.tsv",
                     "sf\tdet\tHijacked SF\tУгнанная фантастика\n"
                     "sf_epic\tdet\tHijacked legacy\n"
                     "mine\tsf\tMine\n");
    const genres::GenreCatalog catalog = load_with(roots);

    // Standard and bundled entries untouched.
    CHECK(catalog.find("sf")->names.at("en") == "Science Fiction");
    CHECK(catalog.find("sf")->category == "sf");
    CHECK(catalog.find("sf")->source == "standard");
    CHECK(catalog.find("sf_epic")->source == "bundled-extension");
    CHECK(catalog.find("sf_epic")->names.at("en") == "Epic SF");
    // Additions from every layer, with the source naming the file.
    REQUIRE(catalog.find("sf_litrpg") != nullptr);
    CHECK(catalog.find("sf_litrpg")->source == "user:user.genres.tsv");
    CHECK(catalog.find("sf_litrpg")->file == tmp / "custom" / "user.genres.tsv");
    CHECK(catalog.find("sf_litrpg")->names.at("en") == "LitRPG");  // first file wins
    CHECK(catalog.find("fanfiction")->category == "fanfic");
    CHECK(catalog.category("fanfic")->titles.at("en") == "fanfic");  // new key -> key as title
    CHECK(catalog.find("ok_genre")->source == "user:bad-lines.genres.tsv");
    CHECK(catalog.find("mine")->source == "user:override.genres.tsv");
    CHECK(catalog.size() == 186 + kLegacy.size() + 3 + 2 + 1);
    // Issues: the parse errors of bad-lines plus the duplicates across files.
    std::set<std::string> duplicates;
    std::size_t parse_errors = 0;
    for (const genres::LoadIssue& issue : catalog.issues()) {
        if (issue.reason == "duplicate") {
            duplicates.insert(issue.code);
        } else {
            ++parse_errors;
        }
    }
    CHECK(parse_errors == 4);  // invalidCode x3 + missingName
    CHECK(duplicates == std::set<std::string>{"sf", "sf_litrpg", "ok_genre", "sf_epic"});
    // Sources list and userFiles in the JSON.
    const json j = catalog.to_json();
    CHECK(j["entries"].size() == catalog.size());
    CHECK(j["userFiles"].size() == 3);
    CHECK(j["effectiveSources"].size() == 5);
    CHECK(j["effectiveSources"][0]["source"] == "standard");
    CHECK(j["effectiveSources"][1]["source"] == "bundled-extension");
    CHECK(j["effectiveSources"][1]["layer"] == "bundled");
    CHECK(j["categories"].size() == 21);
    bool saw_user_entry = false;
    for (const json& e : j["entries"]) {
        if (e["code"] == "sf_litrpg") {
            saw_user_entry = true;
            CHECK(e["source"] == "user:user.genres.tsv");
            CHECK(e["names"]["ru"] == "ЛитРПГ");
            CHECK(e["category"] == "sf");
            CHECK(e.contains("file"));
        }
        if (e["code"] == "child_prose") {
            CHECK(e["alsoIn"][0]["category"] == "prose");
        }
    }
    CHECK(saw_user_entry);
    CHECK(catalog.find("ok_genre")->file == tmp / "data" / "genres" / "bad-lines.genres.tsv");
}

TEST_CASE("genres: the validator accepts the effective list and rejects unknown codes (FR-054)",
          "[genres][validator]") {
    test::TempDir tmp{"mfbe-genres"};
    resources::Roots roots = bundled_only_roots(tmp);
    std::filesystem::create_directories(tmp / "data" / "genres");
    test::write_text(tmp / "data" / "genres" / "mine.genres.tsv", "my_genre\tsf\tMine\n");
    auto catalog = std::make_shared<const genres::GenreCatalog>(load_with(roots));
    genres::install_genre_validator(catalog);
    CHECK(validation::is_known_genre("sf"));
    CHECK(validation::is_known_genre("sf_epic"));   // bundled extension
    CHECK(validation::is_known_genre("my_genre"));  // user file
    CHECK_FALSE(validation::is_known_genre("not_a_genre"));
    // Document-level: a user genre produces no genre.unknown, an unknown one does.
    const std::string book = test::read_text(test::fixtures_dir() / "books" / "modern-utf8.fb2");
    auto with_genre = [&](const std::string& code) {
        std::string text = book;
        const auto pos = text.find("<genre>sf</genre>");
        REQUIRE(pos != std::string::npos);
        text.replace(pos, std::string("<genre>sf</genre>").size(), "<genre>" + code + "</genre>");
        return validation::validate_xml_text(text);
    };
    auto count_unknown = [](const model::ValidationReport& r) {
        int n = 0;
        for (const auto& i : r.issues) {
            n += i.code == "genre.unknown" ? 1 : 0;
        }
        return n;
    };
    CHECK(count_unknown(with_genre("my_genre")) == 0);
    CHECK(count_unknown(with_genre("det_maniac")) == 0);
    CHECK(count_unknown(with_genre("totally_unknown")) == 1);
    genres::install_genre_validator(nullptr);
    CHECK_FALSE(validation::is_known_genre("my_genre"));
    CHECK(validation::is_known_genre("sf"));
}

TEST_CASE("genres: resources.genres / resources.openGenresFolder / resources.layers over RPC",
          "[genres][server]") {
    test::TempDir data{"mfbe-genres-rpc"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    json genres_result = ws.call("resources.genres")["result"];
    REQUIRE(genres_result.contains("entries"));
    CHECK(genres_result["entries"].size() == 186 + kLegacy.size());
    CHECK(genres_result["userFiles"] == json::array());
    CHECK(genres_result["effectiveSources"].size() == 2);
    CHECK(genres_result["issues"] == json::array());
    const json& first = genres_result["entries"][0];
    CHECK(first["code"] == "sf_history");
    CHECK(first["category"] == "sf");
    CHECK(first["names"]["en"] == "Alternative history");
    CHECK(first["names"]["ru"] == "Альтернативная история");
    CHECK(first["source"] == "standard");

    // A user file dropped into <Data>/genres is picked up on the next call (no restart) and
    // accepted by doc.validate.
    std::filesystem::create_directories(data / "genres");
    test::write_text(data / "genres" / "mine.genres.tsv", "sf_litrpg\tsf\tLitRPG\tЛитРПГ\n");
    genres_result = ws.call("resources.genres")["result"];
    CHECK(genres_result["entries"].size() == 186 + kLegacy.size() + 1);
    REQUIRE(genres_result["userFiles"].size() == 1);
    CHECK(genres_result["userFiles"][0] == (data / "genres" / "mine.genres.tsv").string());
    CHECK(genres_result["effectiveSources"][2]["layer"] == "user");
    CHECK(genres_result["effectiveSources"][2]["source"] == "user:mine.genres.tsv");
    std::string text = test::read_text(test::fixtures_dir() / "books" / "modern-utf8.fb2");
    text.replace(text.find("<genre>sf</genre>"), 17, "<genre>sf_litrpg</genre>");
    const json created = ws.call("doc.new");
    const std::string doc_id = created["result"]["docId"];
    const json validated = ws.call("doc.validate", json{{"docId", doc_id}, {"text", text}});
    REQUIRE(validated.contains("result"));
    for (const json& issue : validated["result"]["issues"]) {
        CHECK(issue["code"] != "genre.unknown");
    }
    text.replace(text.find("<genre>sf_litrpg</genre>"), 24, "<genre>nope_genre</genre>");
    const json invalid = ws.call("doc.validate", json{{"docId", doc_id}, {"text", text}});
    bool unknown = false;
    for (const json& issue : invalid["result"]["issues"]) {
        unknown = unknown ||
                  (issue["code"] == "genre.unknown" && issue["params"]["code"] == "nope_genre");
    }
    CHECK(unknown);

    // openGenresFolder: shell-delegated through the queued provider (records the path).
    const json opened = ws.call("resources.openGenresFolder");
    REQUIRE(opened.contains("result"));
    CHECK(opened["result"]["path"] == (data / "genres").string());
    // A custom folder from the settings becomes the settings layer and the folder to open.
    std::filesystem::create_directories(data / "custom-genres");
    test::write_text(data / "custom-genres" / "extra.genres.tsv", "extra_one\tsf\tExtra\n");
    ws.call("settings.set",
            json{{"patch", {{"other", {{"genresFolder", (data / "custom-genres").string()}}}}}});
    genres_result = ws.call("resources.genres")["result"];
    CHECK(genres_result["entries"].size() == 186 + kLegacy.size() + 2);
    CHECK(ws.call("resources.openGenresFolder")["result"]["path"] ==
          (data / "custom-genres").string());
    const json layers = ws.call("resources.layers")["result"];
    REQUIRE(layers.is_array());
    CHECK(layers[0]["kind"] == "genres");
    CHECK(layers[0]["layer"] == "settings");
    CHECK(layers[0]["path"] == (data / "custom-genres").string());
    CHECK(layers[0]["exists"] == true);
}
