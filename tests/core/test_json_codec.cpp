// T016: document model JSON codec round-trips the fixtures exactly.
#include "test_support.hpp"

#include <mfbe/document.hpp>
#include <mfbe/json_codec.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/generators/catch_generators.hpp>

using namespace mfbe;
using nlohmann::json;

namespace {

json load_fixture(const std::string& name) {
    return json::parse(test::read_text(test::fixtures_dir() / "json" / name));
}

}  // namespace

TEST_CASE("json_codec: every document fixture round-trips byte-exactly (as JSON values)",
          "[codec]") {
    const std::string name =
        GENERATE("minimal-book.json", "rich-book.json", "description-full.json");
    INFO("fixture " << name);
    const json original = load_fixture(name);
    const model::Document doc = model::document_from_json(original);
    const json emitted = model::to_json(doc);
    CHECK(emitted == original);
    // And a second pass is stable.
    const model::Document again = model::document_from_json(emitted);
    CHECK(again == doc);
    CHECK(model::to_json(again) == original);
    // Text form too.
    CHECK(model::to_json(model::document_from_string(model::document_to_string(doc))) == original);
}

TEST_CASE("json_codec: typed fields of the rich fixture", "[codec]") {
    const model::Document doc = model::document_from_json(load_fixture("rich-book.json"));
    CHECK(doc.modelVersion == 1);
    CHECK(doc.docId == "d2");
    CHECK(doc.fileKind == model::FileKind::fb2);
    CHECK(doc.schemaHint == model::SchemaHint::legacy);
    CHECK(doc.sourceEncoding == "windows-1251");
    REQUIRE(doc.stylesheets.size() == 1);
    CHECK(doc.stylesheets[0].type == "text/css");

    const auto& ti = doc.description.titleInfo;
    REQUIRE(ti.genres.size() == 2);
    CHECK_FALSE(ti.genres[0].match.has_value());
    CHECK(ti.genres[1].match == 40);
    REQUIRE(ti.authors.size() == 1);
    CHECK(ti.authors[0].middleName == "Петровна");
    CHECK(ti.authors[0].homePages == std::vector<std::string>{"https://example.org/anna"});
    REQUIRE(ti.annotation.has_value());
    CHECK(ti.annotation->type == "annotation");
    CHECK(ti.annotation->node_id() == "n100");
    REQUIRE(ti.annotation->content.size() == 1);
    REQUIRE(ti.annotation->content[0].content.size() == 3);
    CHECK(ti.annotation->content[0].content[1].marks[0].type == "emphasis");
    CHECK(ti.date->lang == "ru");
    CHECK(ti.coverpage[0].href == "#cover.jpg");

    const auto& di = doc.description.documentInfo;
    CHECK(di.srcOcr == "ABBYY FineReader");
    CHECK(di.history.has_value());
    CHECK(di.version == "2.1");

    REQUIRE(doc.bodies.size() == 2);
    CHECK(doc.bodies[1].attr_string("name") == "notes");
    const model::Node& body = doc.bodies[0];
    CHECK(body.content[0].type == "image");
    CHECK(body.content[0].content.empty());
    const model::Node& section = body.content[3];
    CHECK(section.type == "section");
    CHECK(section.attr_string("id") == "ch1");
    const model::Node& p = section.content[1];
    CHECK(p.type == "p");
    CHECK(p.attr_string("style") == "lead");
    bool saw_link = false;
    bool saw_style = false;
    bool saw_inline_image = false;
    for (const auto& inline_node : p.content) {
        if (inline_node.type == "inline-image") {
            saw_inline_image = true;
            CHECK(inline_node.attr_string("href") == "#smile.png");
        }
        for (const auto& mark : inline_node.marks) {
            if (mark.type == "link") {
                saw_link = true;
                CHECK(mark.attrs["href"].is_string());
            }
            if (mark.type == "style") {
                saw_style = true;
                CHECK(mark.attrs["name"] == "note");
            }
        }
    }
    CHECK(saw_link);
    CHECK(saw_style);
    CHECK(saw_inline_image);
    // Table cell attributes keep their JSON types (numbers stay numbers).
    const model::Node& table = section.content[5];
    REQUIRE(table.type == "table");
    CHECK(table.content[0].content[0].attrs.at("colspan") == 2);
    // raw-xml blocks are leaves carrying xml + inline flag.
    const model::Node& raw = section.content[7];
    REQUIRE(raw.type == "raw-xml");
    CHECK(raw.attrs.at("inline") == false);
    CHECK(raw.attr_string("xml")->find("unknown-block") != std::string::npos);

    REQUIRE(doc.binaries.size() == 4);
    CHECK(doc.binaries[2].willConvert);
    CHECK_FALSE(doc.binaries[2].width.has_value());
    CHECK(doc.binaries[3].decodable == false);
    REQUIRE(doc.extras.size() == 1);
}

TEST_CASE("json_codec: description-only fixture (fbd) with nested sequences and custom info",
          "[codec]") {
    const model::Document doc = model::document_from_json(load_fixture("description-full.json"));
    CHECK(doc.fileKind == model::FileKind::fbd);
    CHECK_FALSE(doc.path.has_value());
    CHECK(doc.bodies.empty());
    const auto& seqs = doc.description.titleInfo.sequences;
    REQUIRE(seqs.size() == 2);
    CHECK(seqs[0].number == 3);
    REQUIRE(seqs[0].children.size() == 2);
    CHECK(seqs[0].children[0].lang == "en");
    REQUIRE(seqs[0].children[1].children.size() == 1);
    CHECK(seqs[0].children[1].children[0].number == 0);
    CHECK_FALSE(seqs[1].number.has_value());
    REQUIRE(doc.description.srcTitleInfo.has_value());
    CHECK(doc.description.srcTitleInfo->lang == "ru");
    REQUIRE(doc.description.publishInfo.has_value());
    CHECK(doc.description.publishInfo->isbn == "978-5-00000-000-0");
    REQUIRE(doc.description.customInfo.size() == 2);
    CHECK(doc.description.customInfo[1].lang == "ru");
    REQUIRE(doc.description.outputs.size() == 1);
    CHECK(doc.description.outputs[0].type == "raw-xml");
}

TEST_CASE("json_codec: validation report fixture round-trips", "[codec]") {
    const json original = load_fixture("validation-report.json");
    const model::ValidationReport report = model::validation_report_from_json(original);
    CHECK(report.errorCount == 1);
    CHECK(report.warningCount == 2);
    REQUIRE(report.issues.size() == 3);
    CHECK(report.issues[0].severity == model::Severity::error);
    CHECK(report.issues[0].line == 42);
    CHECK(report.issues[0].path == "body[1]/section[3]");
    CHECK(report.issues[1].params.at("count") == 1);
    CHECK(model::to_json(report) == original);
}

TEST_CASE("json_codec: malformed input raises CodecError with a location", "[codec]") {
    json doc = load_fixture("minimal-book.json");

    SECTION("unsupported model version") {
        doc["modelVersion"] = 2;
        CHECK_THROWS_AS(model::document_from_json(doc), model::CodecError);
    }
    SECTION("wrong type deep inside the tree") {
        doc["bodies"][0]["content"][0]["content"][0]["content"][0]["text"] = 5;
        try {
            model::document_from_json(doc);
            FAIL("expected CodecError");
        } catch (const model::CodecError& e) {
            CHECK(e.path == "/bodies/0/content/0/content/0/content/0/text");
        }
    }
    SECTION("missing required description") {
        doc.erase("description");
        CHECK_THROWS_AS(model::document_from_json(doc), model::CodecError);
    }
    SECTION("bad enum") {
        doc["fileKind"] = "epub";
        CHECK_THROWS_AS(model::document_from_json(doc), model::CodecError);
    }
    SECTION("invalid JSON text") {
        CHECK_THROWS_AS(model::document_from_string("{not json"), model::CodecError);
    }
    SECTION("unknown keys are ignored") {
        doc["futureField"] = {{"x", 1}};
        doc["description"]["titleInfo"]["somethingNew"] = true;
        CHECK_NOTHROW(model::document_from_json(doc));
    }
}

TEST_CASE("json_codec: emission rules for nodes and marks", "[codec]") {
    model::Node text;
    text.type = "text";
    text.text = "hi";
    CHECK(model::to_json(text) == json{{"type", "text"}, {"text", "hi"}});
    text.marks.push_back({"strong", nullptr});
    CHECK(model::to_json(text)["marks"] == json::array({{{"type", "strong"}}}));

    model::Node empty_p;
    empty_p.type = "p";
    empty_p.set_node_id("n9");
    const json p = model::to_json(empty_p);
    CHECK(p["content"] == json::array());  // containers always carry content
    CHECK(p["attrs"]["nodeId"] == "n9");

    model::Node image;
    image.type = "image";
    image.attrs["href"] = "#x";
    CHECK_FALSE(model::to_json(image).contains("content"));  // leaves never do
    CHECK(model::is_leaf_type("empty-line"));
    CHECK_FALSE(model::is_leaf_type("p"));

    model::Document d;
    d.description.titleInfo.lang = "en";
    const json dj = model::to_json(d);
    CHECK(dj["modelVersion"] == 1);
    CHECK_FALSE(dj.contains("path"));
    CHECK(dj["schemaHint"] == "unknown");
    CHECK(dj["description"]["documentInfo"]["date"] == json{{"text", ""}});
    CHECK(model::file_kind_from_extension(".FB2") == model::FileKind::fb2);
    CHECK(model::file_kind_from_extension("fbd") == model::FileKind::fbd);
    CHECK(model::file_kind_from_extension(".xml") == model::FileKind::xml);
}

TEST_CASE("json_codec: marks carry lang and xlinkType; a mark without attributes has no attrs",
          "[codec][marks]") {
    // Feature 006 (document-model §2.1): the codec carries a mark's attributes as they are;
    // `attrs` is written only when it has a member.
    const json marks = json::array({
        {{"type", "strong"}},
        {{"type", "emphasis"}, {"attrs", {{"lang", "la"}}}},
        {{"type", "code"}, {"attrs", {{"lang", ""}}}},
        {{"type", "style"}, {"attrs", {{"name", "foreign"}, {"lang", "la"}}}},
        {{"type", "link"}, {"attrs", {{"href", "#n1"}, {"type", "note"}, {"xlinkType", "simple"}}}},
    });
    const json text{{"type", "text"}, {"text", "x"}, {"marks", marks}};
    const model::Node node = model::node_from_json(text);
    REQUIRE(node.marks.size() == 5);
    CHECK(node.marks[0] == model::Mark{"strong", nullptr});
    CHECK(node.marks[1] == model::Mark{"emphasis", json{{"lang", "la"}}});
    CHECK(node.marks[2] == model::Mark{"code", json{{"lang", ""}}});
    CHECK(node.marks[3] == model::Mark{"style", json{{"name", "foreign"}, {"lang", "la"}}});
    CHECK(node.marks[4] ==
          model::Mark{"link", json{{"href", "#n1"}, {"type", "note"}, {"xlinkType", "simple"}}});
    CHECK(model::to_json(node) == text);
    // A mark without attributes has no attrs member, also when it was given an empty object.
    CHECK(model::to_json(model::Mark{"sub", nullptr}) == json{{"type", "sub"}});
    CHECK(model::to_json(model::Mark{"sub", json::object()}) == json{{"type", "sub"}});
    CHECK_FALSE(model::to_json(model::mark_from_json(json{{"type", "sup"}})).contains("attrs"));
}
