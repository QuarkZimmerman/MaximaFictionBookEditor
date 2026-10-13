// T134/T135: Words engine - Unicode segmentation (Cyrillic, hyphens, apostrophes, NBSP, digits,
// combining marks, soft hyphens), case-sensitive counts over bodies and description fields,
// exclusions filtering, and the words.analyze / words.exclusions RPCs.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/words.hpp>

#include <catch2/catch_test_macros.hpp>
#include <map>
#include <set>

using namespace mfbe;
using nlohmann::json;
using Words = std::vector<std::string>;

namespace {

std::map<std::string, std::int64_t> counts_of(const words::AnalyzeResult& r) {
    std::map<std::string, std::int64_t> out;
    for (const auto& w : r.words) {
        out[w.word] = w.count;
    }
    return out;
}

}  // namespace

TEST_CASE("words: segmentation handles Cyrillic, hyphens, apostrophes, NBSP, digits, accents",
          "[words]") {
    CHECK(words::segment("Hello, world! Привет — мир.") ==
          Words{"Hello", "world", "Привет", "мир"});
    // Hyphens and apostrophes inside a word belong to it; at an edge they separate.
    CHECK(words::segment("кто-то где-нибудь -дефис- что-") ==
          Words{"кто-то", "где-нибудь", "дефис", "что"});
    CHECK(words::segment("don't rock'n'roll 'quoted' O’Neil ’tis") ==
          Words{"don't", "rock'n'roll", "quoted", "O’Neil", "tis"});
    CHECK(words::segment("U+2010 hy\u2010phen U+2011 non\u2011breaking en\u2013dash") ==
          Words{"U", "hy\u2010phen", "U", "non\u2011breaking", "en", "dash"});
    // NBSP is a separator; soft hyphen is removed; combining marks stay with the letter.
    CHECK(words::segment("два\u00A0слова") == Words{"два", "слова"});
    CHECK(words::segment("пере\u00ADнос") == Words{"перенос"});
    CHECK(words::segment("за\u0301мок e\u0301cole") == Words{"за\u0301мок", "e\u0301cole"});
    // Digits: digits-only tokens are skipped, mixed tokens are words.
    CHECK(words::segment("1984 год, 2-й том, mp3 и 4x4") ==
          Words{"год", "2-й", "том", "mp3", "и", "4x4"});
    CHECK(words::segment("12.5 100% 3-4") == Words{});
    // Punctuation, tags, quotes, ellipsis, dashes never stick to words; case is preserved.
    CHECK(words::segment("«Книга»… (Глава) [1] Слово/слово Word–word Word—WORD") ==
          Words{"Книга", "Глава", "Слово", "слово", "Word", "word", "Word", "WORD"});
    CHECK(words::segment("") == Words{});
    CHECK(words::segment("   \n\t ") == Words{});
    CHECK(words::segment("Ёжик ёлка ÄÖÜ straße café") ==
          Words{"Ёжик", "ёлка", "ÄÖÜ", "straße", "café"});
    // Invalid UTF-8 does not crash and does not produce words from replacement characters.
    CHECK(words::segment("ok \xFF\xFE bad") == Words{"ok", "bad"});
}

TEST_CASE("words: analyze counts case-sensitively over bodies and description fields", "[words]") {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const fb2::ReadResult read =
        fb2::read_file(test::fixtures_dir() / "books" / "modern-utf8.fb2", store, ids);
    const words::AnalyzeResult result = words::analyze(read.document);
    const auto counts = counts_of(result);
    CHECK(result.total_words > 100);
    CHECK(result.words.size() > 60);
    CHECK(result.duration_ms >= 0);
    // Body text, titles, poems, tables, notes bodies.
    CHECK(counts.at("Глава") == 2);
    CHECK(counts.at("строка") == 4);  // "строка эпиграфа два", "Первая/вторая/Третья строка"
    CHECK(counts.at("Строка") == 1);  // case-sensitive: "Строка эпиграфа раз"
    CHECK(counts.at("Шапка") == 1);   // table header cell
    CHECK(counts.at("сноска") == 2);  // notes body
    CHECK(counts.at("code") == 1);    // inline <code>code()</code>
    CHECK(counts.at("H") == 1);       // H<sub>2</sub>O -> "H", "O" (2 is a digit)
    CHECK(counts.at("O") == 1);
    CHECK(counts.count("2") == 0);
    // Description: title, annotation, keywords, author names, history, publisher, custom info.
    CHECK(counts.at("Современная") == 3);  // book-title, body title, publish-info book-name
    CHECK(counts.at("Аннотация") == 2);    // description annotation + section annotation
    CHECK(counts.at("фантастика") == 1);   // keywords
    CHECK(counts.at("Анна") == 1);         // author first name
    CHECK(counts.at("Anna") == 1);         // src-title-info author
    CHECK(counts.at("вычитка") == 1);      // history
    CHECK(counts.at("Издательство") == 1);
    CHECK(counts.at("fixture") == 1);  // custom-info text
    CHECK(counts.at("Modern") == 1);   // src-title-info book title
    CHECK(counts.count("sf") == 0);    // genre codes / ids / hrefs are not text
    CHECK(counts.count("cover") == 0);
    CHECK(counts.count("image") == 0);
    // Sorted by word (byte order), unique.
    for (std::size_t i = 1; i < result.words.size(); ++i) {
        CHECK(result.words[i - 1].word < result.words[i].word);
    }
}

TEST_CASE("words: exclusions are filtered unless includeExclusions (then flagged)", "[words]") {
    model::Document doc;
    model::Node p;
    p.type = "p";
    model::Node text;
    text.type = "text";
    text.text = "the cat and the dog and the bird";
    p.content.push_back(text);
    model::Node section;
    section.type = "section";
    section.content.push_back(p);
    model::Node body;
    body.type = "body";
    body.content.push_back(section);
    doc.bodies.push_back(body);
    doc.description.titleInfo.bookTitle = "The cat";
    const std::set<std::string> excluded = {"the", "and"};
    words::AnalyzeOptions options;
    options.is_excluded = [&](std::string_view w) { return excluded.count(std::string(w)) > 0; };
    const words::AnalyzeResult filtered = words::analyze(doc, options);
    CHECK(counts_of(filtered) ==
          std::map<std::string, std::int64_t>{{"The", 1}, {"bird", 1}, {"cat", 2}, {"dog", 1}});
    CHECK(filtered.total_words == 10);
    options.include_exclusions = true;
    const words::AnalyzeResult all = words::analyze(doc, options);
    CHECK(counts_of(all).at("the") == 3);
    CHECK(counts_of(all).at("and") == 2);
    for (const auto& w : all.words) {
        CHECK(w.excluded == (excluded.count(w.word) > 0));
    }
    CHECK(words::analyze(doc).words.size() == 6);  // no exclusion callback at all
}

TEST_CASE("words.analyze / words.exclusions over RPC", "[words][server]") {
    test::TempDir data{"mfbe-words-rpc"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const json opened = ws.call(
        "doc.open", json{{"path", (test::fixtures_dir() / "books" / "modern-utf8.fb2").string()}});
    REQUIRE(opened.contains("result"));
    const json doc = opened["result"]["document"];
    const std::string doc_id = doc["docId"];

    json analyzed = ws.call("words.analyze", json{{"docId", doc_id}, {"document", doc}});
    REQUIRE(analyzed.contains("result"));
    const json& r = analyzed["result"];
    CHECK(r["words"].is_array());
    CHECK(r["entries"] == r["words"]);
    CHECK(r["durationMs"].is_number());
    CHECK(r["totalWords"].get<int>() > 100);
    std::map<std::string, int> counts;
    for (const json& w : r["words"]) {
        counts[w["word"]] = w["count"];
        CHECK_FALSE(w.contains("excluded"));
    }
    CHECK(counts["Глава"] == 2);
    CHECK(counts["кто-то"] == 0);
    // Without `document` the session snapshot is analysed.
    CHECK(ws.call("words.analyze", json{{"docId", doc_id}})["result"]["words"] == r["words"]);
    CHECK(ws.call("words.analyze", json{{"docId", "d99"}})["error"]["code"] == 1000);

    // Exclusions: validated, persisted, filtered out of the analysis unless requested.
    json ex = ws.call("words.exclusions", json{{"add", {"Глава", "и"}}});
    REQUIRE(ex.contains("result"));
    CHECK(ex["result"]["words"] == json::array({"Глава", "и"}));
    const json bad = ws.call("words.exclusions", json{{"add", {"two words"}}});
    REQUIRE(bad.contains("error"));
    CHECK(bad["error"]["code"] == -32602);
    CHECK(bad["error"]["data"]["reason"] == "invalidCharacter");
    CHECK(ws.call("words.exclusions", json{{"add", {"a--b"}}})["error"]["data"]["reason"] ==
          "multipleHyphens");
    CHECK(ws.call("words.exclusions")["result"]["words"] == json::array({"Глава", "и"}));
    CHECK(test::read_text(data / "exclusions.txt") == "Глава\nи\n");
    analyzed = ws.call("words.analyze", json{{"docId", doc_id}});
    counts.clear();
    for (const json& w : analyzed["result"]["words"]) {
        counts[w["word"]] = w["count"];
    }
    CHECK(counts.count("Глава") == 0);
    CHECK(counts.count("и") == 0);
    analyzed = ws.call("words.analyze", json{{"docId", doc_id}, {"includeExclusions", true}});
    bool flagged = false;
    for (const json& w : analyzed["result"]["words"]) {
        if (w["word"] == "Глава") {
            flagged = w["excluded"] == true && w["count"] == 2;
        } else {
            CHECK(w["excluded"] == (w["word"] == "и"));
        }
    }
    CHECK(flagged);
    CHECK(ws.call("words.exclusions", json{{"remove", {"и"}}})["result"]["words"] ==
          json::array({"Глава"}));
}
