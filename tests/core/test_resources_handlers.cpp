// T074: resources.languages (ISO 639-1 table grouped as in the original editor) and
// resources.symbols (symbols.ini) - parsers and the RPC results; both carry English, Russian
// and (feature 003 US1) Ukrainian names.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/resource_tables.hpp>

#include <catch2/catch_test_macros.hpp>
#include <set>

using namespace mfbe;
using nlohmann::json;

namespace {

std::filesystem::path resources_root() {
    return std::filesystem::path(MFBE_RESOURCES_SOURCE_DIR);
}

// True when the UTF-8 text contains a Cyrillic letter (U+0400-U+04FF: lead bytes D0-D3).
bool has_cyrillic(const std::string& text) {
    for (char c : text) {
        const auto byte = static_cast<unsigned char>(c);
        if (byte >= 0xD0 && byte <= 0xD3) {
            return true;
        }
    }
    return false;
}

}  // namespace

TEST_CASE("languages: the bundled table has the 138 codes of eng.xsl in 7 groups, EN + RU + UK",
          "[resources]") {
    const resources::LanguageTable table =
        resources::load_languages(resources_root() / "languages.json");
    REQUIRE(table.groups.size() == 7);
    const std::vector<std::string> keys = {"main",   "europe",     "asia", "america",
                                           "africa", "artificial", "other"};
    for (std::size_t i = 0; i < keys.size(); ++i) {
        CHECK(table.groups[i].key == keys[i]);
        for (const char* lang : {"en", "ru", "uk"}) {
            INFO(keys[i] << " / " << lang);
            CHECK_FALSE(table.groups[i].titles.at(lang).empty());
        }
        CHECK(has_cyrillic(table.groups[i].titles.at("ru")));
        CHECK(has_cyrillic(table.groups[i].titles.at("uk")));
    }
    CHECK(table.size() == 138);
    CHECK(table.groups[0].languages.size() == 2);  // Main: ru, en
    CHECK(table.groups[1].languages.size() == 46);
    CHECK(table.groups[2].languages.size() == 54);
    std::set<std::string> codes;
    for (const resources::LanguageEntry& e : table.flat()) {
        CHECK(e.code.size() == 2);
        CHECK(codes.insert(e.code).second);
        for (const char* lang : {"en", "ru", "uk"}) {
            INFO(e.code << " / " << lang);
            REQUIRE(e.names.count(lang) == 1);
            CHECK_FALSE(e.names.at(lang).empty());
            // The "(ru)" code suffix of the original's option texts is stripped.
            CHECK(e.names.at(lang).find("(" + e.code + ")") == std::string::npos);
        }
        CHECK(e.names.at("en").find('(') == std::string::npos);
        // Every language has a Russian and a Ukrainian name in Cyrillic (no fallback).
        CHECK(has_cyrillic(e.names.at("ru")));
        CHECK(has_cyrillic(e.names.at("uk")));
    }
    REQUIRE(table.find("ru") != nullptr);
    CHECK(table.find("ru")->names.at("en") == "Russian");
    CHECK(table.find("ru")->names.at("ru") == "Русский");
    CHECK(table.find("ru")->names.at("uk") == "Російська");
    CHECK(table.find("ru")->group == "main");
    CHECK(table.find("uk")->names.at("ru") == "Украинский");
    CHECK(table.find("uk")->names.at("uk") == "Українська");
    CHECK(table.find("en")->names.at("uk") == "Англійська");
    // The Ukrainian names are the original's ukr.xsl ones ...
    CHECK(table.find("de")->names.at("uk") == "Німецька");
    CHECK(table.find("vi")->names.at("uk") == "В'єтнамська");
    // ... with its two slips normalised (nl was labelled "Danish", sh had a capital inside).
    CHECK(table.find("nl")->names.at("uk") == "Нідерландська");
    CHECK(table.find("da")->names.at("uk") == "Данська");
    CHECK(table.find("sh")->names.at("uk") == "Сербохорватська");
    CHECK(table.find("eo")->group == "artificial");
    CHECK(table.groups[0].titles.at("ru") == "Основные");
    CHECK(table.groups[0].titles.at("uk") == "Основні");
    CHECK(table.groups[1].titles.at("uk") == "Європа");
    CHECK(table.groups[5].titles.at("uk") == "Штучні");
    CHECK(table.find("xx") == nullptr);

    const json j = table.to_json();
    CHECK(j["groups"].size() == 7);
    CHECK(j["groups"][0]["key"] == "main");
    CHECK(j["groups"][0]["title"]["en"] == "Main");
    CHECK(j["groups"][0]["languages"][0] ==
          json{{"code", "ru"},
               {"name", {{"en", "Russian"}, {"ru", "Русский"}, {"uk", "Російська"}}}});
    CHECK(j["entries"].size() == 138);
    CHECK(j["entries"][1] ==
          json{{"code", "en"},
               {"names", {{"en", "English"}, {"ru", "Английский"}, {"uk", "Англійська"}}},
               {"group", "main"}});
}

TEST_CASE("languages: malformed or missing files yield an empty table", "[resources]") {
    CHECK_THROWS(resources::parse_languages("not json"));
    CHECK_THROWS(resources::parse_languages("{\"groups\": [{\"languages\": []}]}"));
    CHECK(resources::parse_languages("{\"groups\": []}").groups.empty());
    const auto minimal = resources::parse_languages(
        "{\"groups\": [{\"key\": \"g\", \"languages\": [{\"code\": \"zz\"}]}]}");
    REQUIRE(minimal.size() == 1);
    CHECK(minimal.groups[0].titles.at("en") == "g");
    CHECK(minimal.find("zz")->names.at("en") == "zz");
    test::TempDir tmp{"mfbe-lang"};
    CHECK(resources::load_languages(tmp / "missing.json").groups.empty());
}

TEST_CASE("symbols: symbols.ini parses into 19 entries with code points and EN/RU/UK labels",
          "[resources]") {
    const auto symbols = resources::load_symbols(resources_root() / "symbols.ini");
    REQUIRE(symbols.size() == 19);
    CHECK(symbols[0].index == 1);
    CHECK(symbols[0].codepoint == 769);
    CHECK(symbols[0].utf8 == "\xCC\x81");                           // U+0301 combining acute accent
    CHECK(symbols[0].names.at("en") == "Combining accute accent");  // verbatim upstream typo
    CHECK(symbols[0].names.at("ru") == "Стандартное комбинирующееся ударение");
    CHECK(symbols[0].names.at("uk") == "Комбінований знак наголосу");
    CHECK(symbols[15].index == 16);
    CHECK(symbols[15].codepoint == 160);
    CHECK(symbols[15].utf8 == "\xC2\xA0");
    CHECK(symbols[15].names.at("en") == "Non-breaking space");
    CHECK(symbols[15].names.at("uk") == "Нерозривний пробіл");
    CHECK(symbols[18].codepoint == 8222);
    CHECK(symbols[18].names.at("ru") == "Кавычки-\"лапки\" открывающие нижние");
    CHECK(symbols[18].names.at("uk") == "Подвійні лапки нижні початкові");
    // Every symbol has a Ukrainian label of its own (symN_34), none fell back to English.
    for (const resources::SymbolEntry& s : symbols) {
        INFO("sym" << s.index);
        REQUIRE(s.names.count("uk") == 1);
        CHECK(has_cyrillic(s.names.at("uk")));
        CHECK(has_cyrillic(s.names.at("ru")));
    }
    const json j = resources::to_json(symbols);
    CHECK(j.size() == 19);
    CHECK(j[14] ==
          json{{"index", 15},
               {"codepoint", 8212},
               {"char", "\xE2\x80\x94"},
               {"names", {{"en", "Em dash"}, {"ru", "Длинное тире"}, {"uk", "Довге тире"}}}});
}

TEST_CASE("symbols: parser tolerates comments, CRLF, missing labels and odd order", "[resources]") {
    const auto parsed = resources::parse_symbols_ini(
        "\xEF\xBB\xBF; comment\r\n[symbols]\r\nsym2_9 = Second\r\nsym2 = 66\r\n"
        "sym1 = 65\r\n# hash comment\r\nsym3 = notanumber\r\nsym4 = 0\r\n"
        "sym5=8364\nsym5_25=Евро\nsym5_34=Євро\n[other]\nsym6 = 67\n");
    REQUIRE(parsed.size() == 3);
    CHECK(parsed[0].index == 1);
    CHECK(parsed[0].utf8 == "A");
    CHECK(parsed[0].names.at("en") == "U+0041");  // no label -> code point
    CHECK(parsed[0].names.at("ru") == "U+0041");
    CHECK(parsed[0].names.at("uk") == "U+0041");
    CHECK(parsed[1].index == 2);
    CHECK(parsed[1].names.at("en") == "Second");
    CHECK(parsed[1].names.at("ru") == "Second");  // RU falls back to EN
    CHECK(parsed[1].names.at("uk") == "Second");  // UK too
    CHECK(parsed[2].index == 5);
    CHECK(parsed[2].utf8 == "\xE2\x82\xAC");
    CHECK(parsed[2].names.at("ru") == "Евро");
    CHECK(parsed[2].names.at("uk") == "Євро");
    CHECK(parsed[2].names.at("en") == "U+20AC");
}

TEST_CASE("resources.languages / resources.symbols over RPC", "[resources][server]") {
    test::TempDir data{"mfbe-res-rpc"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    const json languages = ws.call("resources.languages")["result"];
    REQUIRE(languages.contains("groups"));
    CHECK(languages["groups"].size() == 7);
    CHECK(languages["entries"].size() == 138);
    CHECK(languages["groups"][1]["title"]["ru"] == "Европа");
    CHECK(languages["groups"][1]["title"]["uk"] == "Європа");
    for (const json& group : languages["groups"]) {
        CHECK(group["title"].contains("uk"));
        for (const json& language : group["languages"]) {
            INFO(language["code"]);
            CHECK(language["name"].contains("uk"));
        }
    }
    for (const json& entry : languages["entries"]) {
        INFO(entry["code"]);
        CHECK(entry["names"].contains("uk"));
    }
    const json symbols = ws.call("resources.symbols")["result"];
    REQUIRE(symbols.is_array());
    CHECK(symbols.size() == 19);
    CHECK(symbols[12]["names"]["en"] == "Horizontal ellipsis");
    CHECK(symbols[12]["names"]["uk"] == "Три крапки");
    CHECK(symbols[12]["char"] == "\xE2\x80\xA6");
    for (const json& symbol : symbols) {
        INFO(symbol["index"]);
        CHECK(symbol["names"].contains("uk"));
    }
}
