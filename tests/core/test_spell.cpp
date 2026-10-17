// T085/T086: spell checking - dictionary discovery through the layers, EN/RU misspellings and
// suggestions, the batch cache, the persistent custom dictionary, timing (SC-005: a 10 000-word
// batch and a suggestion each under 1 s) and the spell.* RPCs.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/spell.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <random>

using namespace mfbe;
using nlohmann::json;

namespace {

std::filesystem::path resources_root() {
    return std::filesystem::path(MFBE_RESOURCES_SOURCE_DIR);
}

resources::Roots roots_for(const test::TempDir& tmp) {
    resources::Roots roots;
    roots.user_data = tmp / "data";
    roots.portable = tmp / "portable";
    roots.bundled_resources = resources_root();
    roots.bundled_scripts = tmp / "scripts";
    return roots;
}

long long ms_since(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() -
                                                                 t0)
        .count();
}

}  // namespace

TEST_CASE("spell: dictionaries are discovered through the layers; ru -> ru_RU, en -> en_US",
          "[spell]") {
    test::TempDir tmp{"mfbe-spell"};
    resources::Roots roots = roots_for(tmp);
    // A user dictionary pair (be_BY) and a lone .aff (ignored) in <Data>/dictionaries.
    std::filesystem::create_directories(tmp / "data" / "dictionaries");
    test::write_text(tmp / "data" / "dictionaries" / "be_BY.aff", "SET UTF-8\n");
    test::write_text(tmp / "data" / "dictionaries" / "be_BY.dic", "2\nслова\nмова\n");
    test::write_text(tmp / "data" / "dictionaries" / "be_BY.txt", "licence text");
    test::write_text(tmp / "data" / "dictionaries" / "lonely.aff", "SET UTF-8\n");
    // A portable copy of en_US conflicts with the bundled one: bundled wins.
    std::filesystem::create_directories(tmp / "portable" / "dictionaries");
    test::write_text(tmp / "portable" / "dictionaries" / "en_US.aff", "SET UTF-8\n");
    test::write_text(tmp / "portable" / "dictionaries" / "en_US.dic", "1\nzzz\n");
    const resources::ResourceLayers layers(roots);
    spell::DictionaryRegistry registry(layers);
    REQUIRE(registry.dictionaries().size() == 4);
    CHECK(registry.dictionaries()[0].tag == "en_US");
    CHECK(registry.dictionaries()[0].layer == resources::LayerName::bundled);
    CHECK(registry.dictionaries()[0].aff == resources_root() / "dictionaries" / "en_US.aff");
    CHECK(registry.dictionaries()[0].readme == resources_root() / "dictionaries" / "en_US.txt");
    CHECK(registry.dictionaries()[1].tag == "ru_RU");
    CHECK(registry.dictionaries()[2].tag == "uk_UA");
    CHECK(registry.dictionaries()[2].layer == resources::LayerName::bundled);
    CHECK(registry.dictionaries()[3].tag == "be_BY");
    CHECK(registry.dictionaries()[3].layer == resources::LayerName::user);
    CHECK(registry.dictionaries()[3].readme == tmp / "data" / "dictionaries" / "be_BY.txt");
    CHECK(registry.resolve("ru")->tag == "ru_RU");
    CHECK(registry.resolve("RU")->tag == "ru_RU");
    CHECK(registry.resolve("ru-RU")->tag == "ru_RU");
    CHECK(registry.resolve("ru_ru")->tag == "ru_RU");
    CHECK(registry.resolve("en")->tag == "en_US");
    CHECK(registry.resolve("en_US")->tag == "en_US");
    CHECK(registry.resolve("uk")->tag == "uk_UA");
    CHECK(registry.resolve("be")->tag == "be_BY");
    CHECK(registry.resolve("de") == nullptr);
    CHECK(registry.resolve("") == nullptr);
    const json j = registry.to_json();
    CHECK(j.size() == 4);
    CHECK(j[0]["tag"] == "en_US");
    CHECK(j[0]["lang"] == "en");
    CHECK(j[0]["source"] == "bundled");
    CHECK(j[0]["readmePath"].is_string());
    CHECK(j[2]["source"] == "bundled");
    CHECK(j[3]["source"] == "user");
    // Spelling with the tiny user dictionary works too.
    spell::SpellService service(layers, tmp / "custom.dic");
    const auto checked = service.check({"слова", "мова", "nope"}, {"be"});
    CHECK(checked.langs == std::vector<std::string>{"be_BY"});
    CHECK(checked.misspelled == std::vector<std::string>{"nope"});
}

TEST_CASE(
    "spell: English and Russian misspellings are flagged, correct words pass, "
    "suggestions contain the fix",
    "[spell]") {
    test::TempDir tmp{"mfbe-spell"};
    const resources::ResourceLayers layers(roots_for(tmp));
    spell::SpellService service(layers, tmp / "custom.dic");

    auto en = service.check({"teh", "hello", "world", "recieve", "Hello", "don't", "teh"}, {"en"});
    CHECK(en.langs == std::vector<std::string>{"en_US"});
    CHECK(en.misspelled == std::vector<std::string>{"teh", "recieve"});  // unique, input order
    auto ru = service.check({"превет", "привет", "мир", "книга", "кто-то", "ашибка"}, {"ru"});
    CHECK(ru.misspelled == std::vector<std::string>{"превет", "ашибка"});
    // Both dictionaries active: a word valid in either is not flagged (US6 scenario 3).
    auto both = service.check({"hello", "привет", "teh", "превет"}, {"ru", "en"});
    CHECK(both.langs == std::vector<std::string>{"ru_RU", "en_US"});
    CHECK(both.misspelled == std::vector<std::string>{"teh", "превет"});
    // Only Russian: English words are misspellings and vice versa.
    CHECK(service.check({"hello"}, {"ru"}).misspelled == std::vector<std::string>{"hello"});
    CHECK(service.check({"привет"}, {"en"}).misspelled == std::vector<std::string>{"привет"});
    // Unknown languages are skipped when another one resolves; none -> error.
    auto mixed = service.check({"hello"}, {"xx", "en"});
    CHECK(mixed.langs == std::vector<std::string>{"en_US"});
    CHECK_THROWS_AS(service.check({"hello"}, {"xx"}), spell::SpellError);
    CHECK_THROWS_AS(service.check({"hello"}, {}), spell::SpellError);
    // Suggestions.
    const auto teh = service.suggest("teh", {"en"});
    CHECK(std::find(teh.begin(), teh.end(), "the") != teh.end());
    CHECK(teh.size() <= 10);
    const auto privet = service.suggest("превет", {"ru"});
    CHECK(std::find(privet.begin(), privet.end(), "привет") != privet.end());
    const auto merged = service.suggest("teh", {"ru", "en"}, 5);
    CHECK(merged.size() <= 5);
    CHECK(std::find(merged.begin(), merged.end(), "the") != merged.end());
    CHECK_THROWS_AS(service.suggest("teh", {"xx"}), spell::SpellError);
    // Accents and NBSP never reach the checker as part of a word; a combining accent on a
    // valid word is still accepted by the dictionary? Not guaranteed - the UI tokenizer strips
    // them (edge case list) - but the engine must not crash on them.
    CHECK_NOTHROW(service.check({"приве\xCC\x81т",
                                 "a\xC2\xA0"
                                 "b",
                                 ""},
                                {"ru", "en"}));
}

TEST_CASE("spell: batch cache makes repeated checks cheap; 10 000 words < 1 s cold",
          "[spell][perf]") {
    test::TempDir tmp{"mfbe-spell"};
    const resources::ResourceLayers layers(roots_for(tmp));
    spell::SpellService service(layers, tmp / "custom.dic");
    // Realistic batch: 10 000 words drawn from the dictionaries (plus misspellings), both
    // languages active, dictionaries not loaded yet (cold).
    std::vector<std::string> pool;
    for (const auto& dic : {resources_root() / "dictionaries" / "ru_RU.dic",
                            resources_root() / "dictionaries" / "en_US.dic"}) {
        const std::string text = test::read_text(dic);
        std::size_t pos = text.find('\n');
        int taken = 0;
        while (pos != std::string::npos && taken < 3000) {
            const std::size_t end = text.find('\n', pos + 1);
            std::string line =
                text.substr(pos + 1, end == std::string::npos ? std::string::npos : end - pos - 1);
            const auto slash = line.find('/');
            if (slash != std::string::npos) {
                line = line.substr(0, slash);
            }
            if (!line.empty()) {
                pool.push_back(line);
                ++taken;
            }
            pos = end;
        }
    }
    REQUIRE(pool.size() >= 5000);
    std::mt19937 rng(42);
    std::vector<std::string> batch;
    batch.reserve(10000);
    for (int i = 0; i < 10000; ++i) {
        std::string w = pool[rng() % pool.size()];
        if (i % 10 == 0) {
            w += "zq";  // deliberate misspelling
        }
        batch.push_back(std::move(w));
    }
    const auto t0 = std::chrono::steady_clock::now();
    const auto cold = service.check(batch, {"ru", "en"});
    const long long cold_ms = ms_since(t0);
    INFO("cold batch of 10000 words: " << cold_ms << " ms, misspelled " << cold.misspelled.size());
    CHECK(cold_ms < 1000);
    CHECK(cold.misspelled.size() >= 500);
    CHECK(cold.cache_hits < batch.size());
    const auto t1 = std::chrono::steady_clock::now();
    const auto warm = service.check(batch, {"ru", "en"});
    const long long warm_ms = ms_since(t1);
    INFO("warm batch: " << warm_ms << " ms");
    CHECK(warm.cache_hits == batch.size());
    CHECK(warm.misspelled == cold.misspelled);
    CHECK(warm_ms <= cold_ms);
    CHECK(service.cache_size() <= batch.size());
    const auto t2 = std::chrono::steady_clock::now();
    const auto suggestions = service.suggest("превет", {"ru"});
    const long long suggest_ms = ms_since(t2);
    INFO("suggestion request: " << suggest_ms << " ms");
    CHECK(suggest_ms < 1000);
    CHECK_FALSE(suggestions.empty());
    std::printf("[perf] spell: 10000 words cold %lld ms, warm %lld ms, suggest %lld ms\n", cold_ms,
                warm_ms, suggest_ms);
}

TEST_CASE("spell: custom dictionary adds/removes words, persists and survives a new checker",
          "[spell]") {
    test::TempDir tmp{"mfbe-spell"};
    const resources::ResourceLayers layers(roots_for(tmp));
    const std::filesystem::path custom = tmp / "dic" / "custom.dic";
    {
        spell::SpellService service(layers, custom);
        CHECK(service.check({"Zorblax", "фбредактор"}, {"en", "ru"}).misspelled ==
              std::vector<std::string>{"Zorblax", "фбредактор"});
        CHECK(service.add_word("Zorblax").empty());
        CHECK(service.add_word("фбредактор").empty());
        CHECK(service.add_word("Zorblax") == "duplicate");
        CHECK(service.add_word("") == "empty");
        CHECK(service.add_word("two words") == "invalidCharacter");
        CHECK(service.check({"Zorblax", "фбредактор", "teh"}, {"en", "ru"}).misspelled ==
              std::vector<std::string>{"teh"});
        // Also accepted by Hunspell itself (runtime add), so suggestions can offer it.
        CHECK(service.checker().spell("en_US", "Zorblax"));
        CHECK(service.custom().words() == std::vector<std::string>{"Zorblax", "фбредактор"});
        CHECK(test::read_text(custom) == "Zorblax\nфбредактор\n");  // sorted, one per line
    }
    {
        spell::SpellService again(layers, custom);  // "restart"
        CHECK(again.custom().words().size() == 2);
        CHECK(again.check({"Zorblax", "фбредактор"}, {"en", "ru"}).misspelled.empty());
        CHECK(again.remove_word("Zorblax"));
        CHECK_FALSE(again.remove_word("Zorblax"));
        CHECK(again.check({"Zorblax"}, {"en"}).misspelled == std::vector<std::string>{"Zorblax"});
        CHECK(test::read_text(custom) == "фбредактор\n");
        // Switching the path loads another list (Hunspell personal-dictionary tolerant: a
        // leading word count, "word/Flags" forms; lines with spaces are skipped and logged).
        test::write_text(tmp / "other.dic", "3\nnot a word line\nhello2\n\nwerd/S\n");
        again.set_custom_path(tmp / "other.dic");
        CHECK(again.custom().words() == std::vector<std::string>{"hello2", "werd"});
        CHECK(again.check({"werd", "фбредактор"}, {"en", "ru"}).misspelled ==
              std::vector<std::string>{"фбредактор"});
    }
    CHECK(spell::custom_word_error("ok") == "");
    CHECK(spell::custom_word_error("\xFF") == "invalidUtf8");
    CHECK(spell::custom_word_error(std::string(129, 'a')) == "tooLong");
    CHECK(spell::custom_word_error("a\tb") == "invalidCharacter");
}

TEST_CASE("spell.* RPC: dictionaries, check, suggest, custom words, custom path",
          "[spell][server]") {
    test::TempDir data{"mfbe-spell-rpc"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    const json dictionaries = ws.call("spell.dictionaries")["result"];
    REQUIRE(dictionaries.size() == 3);
    CHECK(dictionaries[0]["tag"] == "en_US");
    CHECK(dictionaries[0]["source"] == "bundled");
    CHECK(dictionaries[1]["tag"] == "ru_RU");
    CHECK(dictionaries[2]["tag"] == "uk_UA");
    const json licence = ws.call("spell.dictionaryLicense", json{{"tag", "ru_RU"}})["result"];
    CHECK(licence["text"].get<std::string>().find("Lebedev") != std::string::npos);
    CHECK(ws.call("spell.dictionaryLicense", json{{"tag", "xx"}})["error"]["code"] == 1020);

    json checked = ws.call("spell.check", json{{"words", {"teh", "hello", "превет", "привет"}},
                                               {"langs", {"en", "ru"}}});
    REQUIRE(checked.contains("result"));
    CHECK(checked["result"]["misspelled"] == json::array({"teh", "превет"}));
    CHECK(checked["result"]["langs"] == json::array({"en_US", "ru_RU"}));
    const json unavailable = ws.call("spell.check", json{{"words", {"x"}}, {"langs", {"de"}}});
    REQUIRE(unavailable.contains("error"));
    CHECK(unavailable["error"]["code"] == 1020);
    CHECK(unavailable["error"]["message"] == "spell.dictionaryUnavailable");
    CHECK(unavailable["error"]["data"]["lang"] == "de");
    CHECK(ws.call("spell.check", json{{"langs", {"en"}}})["error"]["code"] == -32602);
    CHECK(ws.call("spell.check", json{{"words", "teh"}, {"langs", {"en"}}})["error"]["code"] ==
          -32602);

    const json suggested = ws.call("spell.suggest", json{{"word", "teh"}, {"langs", {"en"}}});
    REQUIRE(suggested.contains("result"));
    const json& list = suggested["result"]["suggestions"];
    CHECK(list.size() <= 10);
    CHECK(std::find(list.begin(), list.end(), json("the")) != list.end());
    CHECK(ws.call("spell.suggest",
                  json{{"word", "teh"}, {"langs", {"en"}}, {"max", 2}})["result"]["suggestions"]
              .size() <= 2);

    // Custom words: default path <Data>/custom.dic.
    CHECK(ws.call("spell.customWords")["result"] == json::array());
    CHECK(ws.call("spell.customDictionaryPath")["result"]["path"] ==
          (data / "custom.dic").string());
    json added = ws.call("spell.addWord", json{{"word", "teh"}});
    REQUIRE(added.contains("result"));
    CHECK(added["result"]["added"] == true);
    CHECK(added["result"]["words"] == json::array({"teh"}));
    CHECK(ws.call("spell.addWord", json{{"word", "teh"}})["result"]["added"] == false);
    CHECK(ws.call("spell.addWord", json{{"word", "a b"}})["error"]["code"] == -32602);
    CHECK(ws.call("spell.check", json{{"words", {"teh"}},
                                      {"langs", {"en"}}})["result"]["misspelled"] == json::array());
    CHECK(test::read_text(data / "custom.dic") == "teh\n");
    CHECK(ws.call("spell.removeWord", json{{"word", "teh"}})["result"]["removed"] == true);
    CHECK(ws.call("spell.check",
                  json{{"words", {"teh"}}, {"langs", {"en"}}})["result"]["misspelled"] ==
          json::array({"teh"}));
    // A configurable path (FR-072): persisted in settings and used immediately.
    const std::string custom = (data / "mine" / "words.dic").string();
    const json moved = ws.call("spell.customDictionaryPath", json{{"path", custom}});
    CHECK(moved["result"]["path"] == custom);
    CHECK(ws.call("settings.get")["result"]["view"]["customDictionaryPath"] == custom);
    ws.call("spell.addWord", json{{"word", "Zorblax"}});
    CHECK(test::read_text(custom) == "Zorblax\n");
    CHECK(ws.call("spell.customWords")["result"] == json::array({"Zorblax"}));
    // Back to the default through settings.set.
    ws.call("settings.set", json{{"patch", {{"view", {{"customDictionaryPath", ""}}}}}});
    CHECK(ws.call("spell.customDictionaryPath")["result"]["path"] ==
          (data / "custom.dic").string());
    CHECK(ws.call("spell.customWords")["result"] == json::array());
}
