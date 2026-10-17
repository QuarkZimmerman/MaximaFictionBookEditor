// T085/T086: spell checking - dictionary discovery through the layers, EN/RU misspellings and
// suggestions, the batch cache, the persistent custom dictionary, timing (SC-005: a 10 000-word
// batch and a suggestion each under 1 s) and the spell.* RPCs.
//
// Feature 003 US4 (T043, spec FR-030 to FR-033): the dictionary report - pairs from the chosen,
// per-user and portable folders with their origin, rejected files with the reason (partner
// missing, unsupported encoding, shadowed by a higher layer, unreadable), the folders of the
// lookup with their state, the language fallback (`de-AT` -> `de_DE`), an ISO-8859-2 dictionary
// checked and suggesting correctly, stale Hunspell instances dropped at a refresh, and the
// `spell.dictionaryReport` / `resources.openDictionariesFolder` RPCs.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/spell.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <map>
#include <random>

#ifndef _WIN32
#include <unistd.h>
#endif

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

/* --------------------------------------------------------------- feature 003 US4 helpers */

std::filesystem::path dictionary_fixtures() {
    return test::fixtures_dir() / "dictionaries";
}

// Copies the T004 dictionary fixtures (`.aff` / `.dic` only) into `folder`.
void copy_dictionary_fixtures(const std::filesystem::path& folder) {
    std::filesystem::create_directories(folder);
    for (const auto& entry : std::filesystem::directory_iterator(dictionary_fixtures())) {
        const std::string ext = entry.path().extension().string();
        if (ext == ".aff" || ext == ".dic") {
            std::filesystem::copy_file(entry.path(), folder / entry.path().filename(),
                                       std::filesystem::copy_options::overwrite_existing);
        }
    }
}

void copy_pair(const std::string& tag, const std::filesystem::path& folder) {
    std::filesystem::create_directories(folder);
    for (const char* ext : {".aff", ".dic"}) {
        std::filesystem::copy_file(dictionary_fixtures() / (tag + ext), folder / (tag + ext),
                                   std::filesystem::copy_options::overwrite_existing);
    }
}

const spell::Dictionary* find_dictionary(const spell::DictionaryRegistry& registry,
                                         const std::string& tag) {
    for (const spell::Dictionary& d : registry.dictionaries()) {
        if (d.tag == tag) {
            return &d;
        }
    }
    return nullptr;
}

const spell::RejectedDictionary* find_rejected(const spell::DictionaryRegistry& registry,
                                               const std::filesystem::path& path) {
    for (const spell::RejectedDictionary& r : registry.rejected()) {
        if (r.path == path) {
            return &r;
        }
    }
    return nullptr;
}

std::vector<std::string> tags_of(const spell::DictionaryRegistry& registry) {
    std::vector<std::string> tags;
    for (const spell::Dictionary& d : registry.dictionaries()) {
        tags.push_back(d.tag);
    }
    return tags;
}

bool contains(const std::vector<std::string>& list, const std::string& value) {
    return std::find(list.begin(), list.end(), value) != list.end();
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
    // The lone .aff and the shadowed portable copy are reported, not silently dropped (US4).
    REQUIRE(registry.rejected().size() == 2);
    const auto* lonely = find_rejected(registry, tmp / "data" / "dictionaries" / "lonely.aff");
    REQUIRE(lonely != nullptr);
    CHECK(lonely->reason == "partnerMissing");
    const auto* portable_en =
        find_rejected(registry, tmp / "portable" / "dictionaries" / "en_US.aff");
    REQUIRE(portable_en != nullptr);
    CHECK(portable_en->reason == "shadowed");
    CHECK(portable_en->detail == "bundled");
    // Spelling with the tiny user dictionary works too.
    spell::SpellService service(layers, tmp / "custom.dic");
    const auto checked = service.check({"слова", "мова", "nope"}, {"be"});
    CHECK(checked.langs == std::vector<std::string>{"be_BY"});
    CHECK(checked.misspelled == std::vector<std::string>{"nope"});
}

TEST_CASE(
    "spell: the dictionary report lists the pairs of a user folder with their origin and "
    "rejects the broken, unsupported and shadowed files with the reason (feature 003 US4)",
    "[spell]") {
    test::TempDir tmp{"mfbe-spell-report"};
    const resources::Roots roots = roots_for(tmp);
    const std::filesystem::path user = tmp / "data" / "dictionaries";
    copy_dictionary_fixtures(user);
    const resources::ResourceLayers layers(roots);
    spell::SpellService service(layers, tmp / "custom.dic");
    const spell::DictionaryRegistry& registry = service.registry();

    // Effective: the three bundled ones, then the usable user pairs (alphabetically).
    CHECK(tags_of(registry) ==
          std::vector<std::string>{"en_US", "ru_RU", "uk_UA", "de_DE", "pl_PL"});
    const spell::Dictionary* de = find_dictionary(registry, "de_DE");
    REQUIRE(de != nullptr);
    CHECK(de->layer == resources::LayerName::user);
    CHECK(de->aff == user / "de_DE.aff");
    CHECK(de->source() == "user");
    const spell::Dictionary* pl = find_dictionary(registry, "pl_PL");
    REQUIRE(pl != nullptr);
    CHECK(pl->layer == resources::LayerName::user);
    CHECK(find_dictionary(registry, "ru_RU")->layer == resources::LayerName::bundled);
    CHECK(find_dictionary(registry, "cs_CZ") == nullptr);
    CHECK(find_dictionary(registry, "xx_XX") == nullptr);

    // Rejected: cs_CZ.aff has no .dic, xx_XX declares an encoding the core cannot convert,
    // the user ru_RU is shadowed by the bundled one (which stays in effect).
    REQUIRE(registry.rejected().size() == 3);
    const spell::RejectedDictionary* cs = find_rejected(registry, user / "cs_CZ.aff");
    REQUIRE(cs != nullptr);
    CHECK(cs->reason == "partnerMissing");
    CHECK_FALSE(cs->detail.has_value());
    const spell::RejectedDictionary* xx = find_rejected(registry, user / "xx_XX.aff");
    REQUIRE(xx != nullptr);
    CHECK(xx->reason == "unsupportedEncoding");
    CHECK(xx->detail == "X-UNKNOWN");
    const spell::RejectedDictionary* ru = find_rejected(registry, user / "ru_RU.aff");
    REQUIRE(ru != nullptr);
    CHECK(ru->reason == "shadowed");
    CHECK(ru->detail == "bundled");

    // Language matching: exact tag first, then the language (FR-033).
    CHECK(registry.resolve("de")->tag == "de_DE");
    CHECK(registry.resolve("de_DE")->tag == "de_DE");
    CHECK(registry.resolve("de-AT")->tag == "de_DE");
    CHECK(registry.resolve("de_AT")->tag == "de_DE");
    CHECK(registry.resolve("DE-CH")->tag == "de_DE");
    CHECK(registry.resolve("pl")->tag == "pl_PL");
    CHECK(registry.resolve("pl-PL")->tag == "pl_PL");
    CHECK(registry.resolve("cs") == nullptr);
    CHECK(registry.resolve("xx") == nullptr);
    CHECK(service.resolve_langs({"de-AT", "de", "pl"}) ==
          std::vector<std::string>{"de_DE", "pl_PL"});

    // The German pair checks and suggests like a built-in dictionary.
    const auto german = service.check({"Haus", "Straße", "Bücher", "Hauss", "Büchr"}, {"de-AT"});
    CHECK(german.langs == std::vector<std::string>{"de_DE"});
    CHECK(german.misspelled == std::vector<std::string>{"Hauss", "Büchr"});
    CHECK(contains(service.suggest("Hauss", {"de"}), "Haus"));
    CHECK(contains(service.suggest("Büchr", {"de"}), "Bücher"));

    // The ISO-8859-2 Polish pair: words are converted to and from the dictionary's encoding,
    // so the five words pass, the misspellings are caught and the suggestions come back as
    // UTF-8 with the Polish letters intact (spec US4 scenario 6).
    const auto polish =
        service.check({"książka", "łódź", "źdźbło", "żółw", "ćma", "ksiażka", "zółw"}, {"pl"});
    CHECK(polish.langs == std::vector<std::string>{"pl_PL"});
    CHECK(polish.misspelled == std::vector<std::string>{"ksiażka", "zółw"});
    CHECK(contains(service.suggest("ksiażka", {"pl"}), "książka"));
    CHECK(contains(service.suggest("zółw", {"pl"}), "żółw"));

    // The shadowed user ru_RU is ignored: the bundled dictionary knows "книга", not "фикстура".
    CHECK(service.check({"книга", "фикстура"}, {"ru"}).misspelled ==
          std::vector<std::string>{"фикстура"});
    // The unsupported pair is never loaded, even when asked for by its tag.
    CHECK_THROWS_AS(service.checker().preload("xx_XX"), spell::SpellError);

    // Report shape (contracts/rpc-api.md §3.4): dictionaries, rejected, folders.
    const json report = registry.report_json();
    REQUIRE(report.contains("dictionaries"));
    REQUIRE(report.contains("rejected"));
    REQUIRE(report.contains("folders"));
    CHECK(report["dictionaries"].size() == 5);
    CHECK(report["dictionaries"][3]["tag"] == "de_DE");
    CHECK(report["dictionaries"][3]["source"] == "user");
    CHECK(report["dictionaries"][3]["path"] == (user / "de_DE.aff").string());
    CHECK(report["dictionaries"][3]["dicPath"] == (user / "de_DE.dic").string());
    REQUIRE(report["rejected"].size() == 3);
    for (const json& item : report["rejected"]) {
        CHECK(item["path"].is_string());
        CHECK(item["reason"].is_string());
        if (item["reason"] == "shadowed") {
            CHECK(item["detail"] == "bundled");
        }
        if (item["reason"] == "partnerMissing") {
            CHECK_FALSE(item.contains("detail"));
        }
    }
    REQUIRE(report["folders"].size() == 4);
    CHECK(report["folders"][0]["layer"] == "settings");
    CHECK(report["folders"][0]["path"] == "");
    CHECK(report["folders"][0]["exists"] == false);
    CHECK(report["folders"][0]["readable"] == false);
    CHECK(report["folders"][0]["writable"] == false);
    CHECK(report["folders"][1]["layer"] == "user");
    CHECK(report["folders"][1]["path"] == user.string());
    CHECK(report["folders"][1]["exists"] == true);
    CHECK(report["folders"][1]["readable"] == true);
    CHECK(report["folders"][1]["writable"] == true);
    CHECK(report["folders"][2]["layer"] == "portable");
    CHECK(report["folders"][3]["layer"] == "bundled");
    CHECK(report["folders"][3]["exists"] == true);
    for (const json& folder : report["folders"]) {
        CHECK(folder.size() == 5);
    }
}

TEST_CASE("spell: a lone .dic, a shadowed portable pair and an unreadable file are reported too",
          "[spell]") {
    test::TempDir tmp{"mfbe-spell-report"};
    const resources::Roots roots = roots_for(tmp);
    const std::filesystem::path user = tmp / "data" / "dictionaries";
    const std::filesystem::path portable = tmp / "portable" / "dictionaries";
    copy_pair("de_DE", user);
    copy_pair("de_DE", portable);                         // shadowed by the per-user copy
    test::write_text(user / "fr_FR.dic", "1\nmaison\n");  // no .aff
    const resources::ResourceLayers layers(roots);
    spell::DictionaryRegistry registry(layers);
    CHECK(tags_of(registry) == std::vector<std::string>{"en_US", "ru_RU", "uk_UA", "de_DE"});
    CHECK(find_dictionary(registry, "de_DE")->layer == resources::LayerName::user);
    REQUIRE(registry.rejected().size() == 2);
    const auto* fr = find_rejected(registry, user / "fr_FR.dic");
    REQUIRE(fr != nullptr);
    CHECK(fr->reason == "partnerMissing");
    const auto* shadowed = find_rejected(registry, portable / "de_DE.aff");
    REQUIRE(shadowed != nullptr);
    CHECK(shadowed->reason == "shadowed");
    CHECK(shadowed->detail == "user");
#ifndef _WIN32
    if (::geteuid() != 0) {
        // A .dic the editor cannot read: the pair is unusable and says why; it no longer
        // shadows the usable portable copy, which takes its place.
        std::filesystem::permissions(user / "de_DE.dic", std::filesystem::perms::none);
        registry.refresh();
        std::filesystem::permissions(user / "de_DE.dic", std::filesystem::perms::owner_all);
        REQUIRE(find_dictionary(registry, "de_DE") != nullptr);
        CHECK(find_dictionary(registry, "de_DE")->layer == resources::LayerName::portable);
        REQUIRE(registry.rejected().size() == 2);
        const auto* unreadable = find_rejected(registry, user / "de_DE.dic");
        REQUIRE(unreadable != nullptr);
        CHECK(unreadable->reason == "unreadable");
        CHECK(find_rejected(registry, portable / "de_DE.aff") == nullptr);
    }
#endif
}

TEST_CASE(
    "spell: the chosen folder is searched first after the bundled layer; its pair shadows the "
    "per-user one, which is reported with the winning layer",
    "[spell]") {
    test::TempDir tmp{"mfbe-spell-chosen"};
    resources::Roots roots = roots_for(tmp);
    roots.settings_dictionaries = tmp / "chosen";
    const std::filesystem::path user = tmp / "data" / "dictionaries";
    copy_pair("de_DE", user);
    // The chosen folder's German pair knows one more word, so the test can tell them apart.
    test::write_text(tmp / "chosen" / "de_DE.aff", "SET UTF-8\nTRY esianrtolcdugmphbyfvkwz\n");
    test::write_text(tmp / "chosen" / "de_DE.dic", "2\nHaus\nZimmer\n");
    const resources::ResourceLayers layers(roots);
    spell::SpellService service(layers, tmp / "custom.dic");
    const spell::DictionaryRegistry& registry = service.registry();

    const spell::Dictionary* de = find_dictionary(registry, "de_DE");
    REQUIRE(de != nullptr);
    CHECK(de->layer == resources::LayerName::settings);
    CHECK(de->source() == "settings");
    CHECK(de->aff == tmp / "chosen" / "de_DE.aff");
    REQUIRE(registry.rejected().size() == 1);
    CHECK(registry.rejected()[0].path == user / "de_DE.aff");
    CHECK(registry.rejected()[0].reason == "shadowed");
    CHECK(registry.rejected()[0].detail == "settings");
    CHECK(service.check({"Haus", "Zimmer", "Straße"}, {"de"}).misspelled ==
          std::vector<std::string>{"Straße"});

    const json report = registry.report_json();
    CHECK(report["folders"][0]["layer"] == "settings");
    CHECK(report["folders"][0]["path"] == (tmp / "chosen").string());
    CHECK(report["folders"][0]["exists"] == true);
    CHECK(report["folders"][0]["readable"] == true);
    CHECK(report["rejected"][0]["detail"] == "settings");

    // A chosen folder that does not exist: reported, the default folder used.
    roots.settings_dictionaries = tmp / "gone";
    resources::ResourceLayers moved(roots);
    spell::DictionaryRegistry again(moved);
    CHECK(find_dictionary(again, "de_DE")->layer == resources::LayerName::user);
    CHECK(again.rejected().empty());
    const json gone = again.report_json();
    CHECK(gone["folders"][0]["path"] == (tmp / "gone").string());
    CHECK(gone["folders"][0]["exists"] == false);
    CHECK(gone["folders"][0]["readable"] == false);
}

#ifndef _WIN32
TEST_CASE("spell: a chosen folder that cannot be read is reported and the default folder used",
          "[spell]") {
    if (::geteuid() == 0) {
        SKIP("root reads folders without permissions");
    }
    test::TempDir tmp{"mfbe-spell-locked"};
    resources::Roots roots = roots_for(tmp);
    roots.settings_dictionaries = tmp / "locked";
    copy_pair("de_DE", tmp / "locked");
    copy_pair("de_DE", tmp / "data" / "dictionaries");
    std::filesystem::permissions(tmp / "locked", std::filesystem::perms::none);
    const resources::ResourceLayers layers(roots);
    spell::DictionaryRegistry registry(layers);
    const json report = registry.report_json();
    std::filesystem::permissions(tmp / "locked", std::filesystem::perms::owner_all);
    CHECK(report["folders"][0]["layer"] == "settings");
    CHECK(report["folders"][0]["exists"] == true);
    CHECK(report["folders"][0]["readable"] == false);
    REQUIRE(find_dictionary(registry, "de_DE") != nullptr);
    CHECK(find_dictionary(registry, "de_DE")->layer == resources::LayerName::user);
    CHECK(registry.rejected().empty());
}
#endif

TEST_CASE(
    "spell: a refresh drops the Hunspell instance of a dictionary whose files changed or "
    "disappeared, so a removed file is never used again",
    "[spell]") {
    test::TempDir tmp{"mfbe-spell-refresh"};
    const resources::Roots roots = roots_for(tmp);
    const std::filesystem::path user = tmp / "data" / "dictionaries";
    copy_pair("de_DE", user);
    const resources::ResourceLayers layers(roots);
    spell::SpellService service(layers, tmp / "custom.dic");
    CHECK(service.check({"Haus", "Zimmer"}, {"de"}).misspelled ==
          std::vector<std::string>{"Zimmer"});
    CHECK(service.checker().loaded_count() == 1);

    // Same paths, new content: the next refresh reloads the pair and forgets cached verdicts.
    test::write_text(user / "de_DE.dic", "2\nHaus\nZimmer\n");
    CHECK(service.refresh_dictionaries());
    CHECK(service.check({"Haus", "Zimmer"}, {"de"}).misspelled.empty());
    // Nothing changed: no work, no cache loss.
    CHECK_FALSE(service.refresh_dictionaries());
    CHECK(service.checker().loaded_count() == 1);

    // Files removed: the dictionary disappears from the registry and is no longer used.
    std::filesystem::remove(user / "de_DE.aff");
    std::filesystem::remove(user / "de_DE.dic");
    CHECK(service.refresh_dictionaries());
    CHECK(find_dictionary(service.registry(), "de_DE") == nullptr);
    CHECK(service.checker().loaded_count() == 0);
    CHECK_THROWS_AS(service.check({"Haus"}, {"de"}), spell::SpellError);

    // A pair copied in later is picked up by the next refresh - no restart needed.
    copy_pair("pl_PL", user);
    CHECK(service.refresh_dictionaries());
    CHECK(service.check({"ćma", "cma"}, {"pl"}).misspelled == std::vector<std::string>{"cma"});
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

TEST_CASE(
    "spell.dictionaryReport / resources.openDictionariesFolder over RPC: dictionaries picked up "
    "at start-up and on the next report, the chosen folder, a missing chosen folder (US4)",
    "[spell][server]") {
    test::TempDir data{"mfbe-spell-report-rpc"};
    const std::filesystem::path user = data / "dictionaries";
    copy_pair("de_DE", user);
    test::write_text(user / "cs_CZ.aff", "SET UTF-8\n");
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    // Start-up: the user pair is in effect, the lone .aff reported; the report has the three
    // parts of contracts/rpc-api.md §3.4 and `spell.dictionaries` is unchanged.
    json report = ws.call("spell.dictionaryReport")["result"];
    REQUIRE(report.contains("dictionaries"));
    REQUIRE(report.contains("rejected"));
    REQUIRE(report.contains("folders"));
    REQUIRE(report["dictionaries"].size() == 4);
    CHECK(report["dictionaries"][0]["tag"] == "en_US");
    CHECK(report["dictionaries"][0]["source"] == "bundled");
    CHECK(report["dictionaries"][3]["tag"] == "de_DE");
    CHECK(report["dictionaries"][3]["source"] == "user");
    CHECK(report["dictionaries"][3]["lang"] == "de");
    CHECK(report["dictionaries"][3]["path"] == (user / "de_DE.aff").string());
    REQUIRE(report["rejected"].size() == 1);
    CHECK(report["rejected"][0] ==
          json{{"path", (user / "cs_CZ.aff").string()}, {"reason", "partnerMissing"}});
    REQUIRE(report["folders"].size() == 4);
    CHECK(report["folders"][0] == json{{"layer", "settings"},
                                       {"path", ""},
                                       {"exists", false},
                                       {"readable", false},
                                       {"writable", false}});
    CHECK(report["folders"][1] == json{{"layer", "user"},
                                       {"path", user.string()},
                                       {"exists", true},
                                       {"readable", true},
                                       {"writable", true}});
    CHECK(report["folders"][2]["layer"] == "portable");
    CHECK(report["folders"][3]["layer"] == "bundled");
    CHECK(report["folders"][3]["exists"] == true);
    const json plain = ws.call("spell.dictionaries")["result"];
    REQUIRE(plain.is_array());
    CHECK(plain.size() == 4);
    CHECK(plain[3]["tag"] == "de_DE");

    // A German book, and one in Austrian German, is checked with it (exact tag, then language).
    json checked = ws.call("spell.check", json{{"words", {"Haus", "Hauss"}}, {"langs", {"de-AT"}}});
    REQUIRE(checked.contains("result"));
    CHECK(checked["result"]["langs"] == json::array({"de_DE"}));
    CHECK(checked["result"]["misspelled"] == json::array({"Hauss"}));
    const json suggested =
        ws.call("spell.suggest", json{{"word", "Hauss"}, {"langs", {"de"}}})["result"];
    CHECK(std::find(suggested["suggestions"].begin(), suggested["suggestions"].end(),
                    json("Haus")) != suggested["suggestions"].end());

    // Files copied in while the editor runs are picked up by the next report - no restart.
    copy_dictionary_fixtures(user);
    report = ws.call("spell.dictionaryReport")["result"];
    std::vector<std::string> tags;
    for (const json& d : report["dictionaries"]) {
        tags.push_back(d["tag"]);
    }
    CHECK(tags == std::vector<std::string>{"en_US", "ru_RU", "uk_UA", "de_DE", "pl_PL"});
    std::map<std::string, std::string> reasons;
    for (const json& r : report["rejected"]) {
        reasons[r["path"]] = r["reason"];
    }
    CHECK(reasons == std::map<std::string, std::string>{
                         {(user / "cs_CZ.aff").string(), "partnerMissing"},
                         {(user / "xx_XX.aff").string(), "unsupportedEncoding"},
                         {(user / "ru_RU.aff").string(), "shadowed"},
                     });
    CHECK(ws.call("spell.check",
                  json{{"words", {"żółw", "zółw"}}, {"langs", {"pl"}}})["result"]["misspelled"] ==
          json::array({"zółw"}));

    // "Open dictionaries folder" without a chosen folder: the per-user folder, created on
    // demand (shell-delegated; the test provider records the request).
    std::filesystem::remove_all(data / "dictionaries");
    json opened = ws.call("resources.openDictionariesFolder");
    REQUIRE(opened.contains("result"));
    CHECK(opened["result"]["path"] == user.string());
    CHECK(std::filesystem::is_directory(user));

    // A chosen folder (settings other.dictionariesFolder) becomes the settings layer: its pair
    // wins over the per-user copy of the same tag, which is reported as shadowed by it.
    const std::filesystem::path chosen = data / "chosen";
    copy_pair("de_DE", chosen);
    copy_pair("de_DE", user);
    ws.call("settings.set",
            json{{"patch", {{"other", {{"dictionariesFolder", chosen.string()}}}}}});
    report = ws.call("spell.dictionaryReport")["result"];
    REQUIRE(report["dictionaries"].size() == 4);
    CHECK(report["dictionaries"][3]["tag"] == "de_DE");
    CHECK(report["dictionaries"][3]["source"] == "settings");
    CHECK(report["dictionaries"][3]["path"] == (chosen / "de_DE.aff").string());
    REQUIRE(report["rejected"].size() == 1);
    CHECK(report["rejected"][0]["path"] == (user / "de_DE.aff").string());
    CHECK(report["rejected"][0]["reason"] == "shadowed");
    CHECK(report["rejected"][0]["detail"] == "settings");
    CHECK(report["folders"][0]["layer"] == "settings");
    CHECK(report["folders"][0]["path"] == chosen.string());
    CHECK(report["folders"][0]["exists"] == true);
    CHECK(report["folders"][0]["readable"] == true);
    CHECK(ws.call("resources.openDictionariesFolder")["result"]["path"] == chosen.string());

    // The chosen folder no longer exists: reported through the folders, the default used.
    std::filesystem::remove_all(chosen);
    report = ws.call("spell.dictionaryReport")["result"];
    CHECK(report["folders"][0]["path"] == chosen.string());
    CHECK(report["folders"][0]["exists"] == false);
    CHECK(report["folders"][0]["readable"] == false);
    CHECK(report["dictionaries"][3]["source"] == "user");
    CHECK(report["rejected"] == json::array());
    // Opening it creates it again (FR-030: created when it does not exist).
    CHECK(ws.call("resources.openDictionariesFolder")["result"]["path"] == chosen.string());
    CHECK(std::filesystem::is_directory(chosen));
    ws.call("settings.set", json{{"patch", {{"other", {{"dictionariesFolder", ""}}}}}});
    CHECK(ws.call("resources.openDictionariesFolder")["result"]["path"] == user.string());
}
