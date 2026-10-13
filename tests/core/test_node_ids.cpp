// T017: node id allocation, structural paths and remap tables.
#include "test_support.hpp"

#include <mfbe/json_codec.hpp>
#include <mfbe/node_ids.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;
using nlohmann::json;

namespace {

model::Document load(const std::string& name) {
    return model::document_from_json(
        json::parse(test::read_text(test::fixtures_dir() / "json" / name)));
}

model::Node text(const std::string& t) {
    model::Node n;
    n.type = "text";
    n.text = t;
    return n;
}

model::Node para(const std::string& t) {
    model::Node n;
    n.type = "p";
    n.content.push_back(text(t));
    return n;
}

}  // namespace

TEST_CASE("node_ids: allocator issues sequential ids and never reuses reserved ones",
          "[node_ids]") {
    model::NodeIdAllocator alloc;
    CHECK(alloc.next() == "n1");
    CHECK(alloc.next() == "n2");
    alloc.reserve("n10");
    CHECK(alloc.next() == "n11");
    alloc.reserve("n5");      // below the counter: no effect
    alloc.reserve("x99");     // foreign id scheme: ignored
    alloc.reserve("n99abc");  // not a pure number: ignored
    CHECK(alloc.next() == "n12");
    model::Document doc = load("rich-book.json");
    model::NodeIdAllocator adopted;
    adopted.adopt(doc);
    CHECK(adopted.next() == "n112");  // highest id in the fixture is n111 (history)
}

TEST_CASE("node_ids: assign only missing ids; reassign replaces all", "[node_ids]") {
    model::Document doc;
    model::Node body;
    body.type = "body";
    model::Node section;
    section.type = "section";
    section.content.push_back(para("one"));
    section.content.push_back(para("two"));
    section.content[1].set_node_id("n50");
    body.content.push_back(section);
    doc.bodies.push_back(body);

    model::NodeIdAllocator alloc;
    alloc.adopt(doc);
    CHECK(model::assign_node_ids(doc, alloc) == 3);  // body, section, first p
    CHECK(doc.bodies[0].node_id() == "n51");
    CHECK(doc.bodies[0].content[0].node_id() == "n52");
    CHECK(doc.bodies[0].content[0].content[0].node_id() == "n53");
    CHECK(doc.bodies[0].content[0].content[1].node_id() == "n50");
    // Text nodes never get ids.
    CHECK(doc.bodies[0].content[0].content[0].content[0].attrs.empty());

    model::NodeIdAllocator fresh(1000);
    CHECK(model::reassign_node_ids(doc, fresh) == 4);
    CHECK(doc.bodies[0].node_id() == "n1000");
    CHECK(doc.bodies[0].content[0].content[1].node_id() == "n1003");
}

TEST_CASE("node_ids: paths are XPath-like, 1-based per sibling type", "[node_ids]") {
    const model::Document doc = load("rich-book.json");
    CHECK(model::node_path(doc, "n1") == "body[1]");
    CHECK(model::node_path(doc, "n60") == "body[2]");
    CHECK(model::node_path(doc, "n10") == "body[1]/section[1]");
    CHECK(model::node_path(doc, "n14") == "body[1]/section[1]/p[1]");
    CHECK(model::node_path(doc, "n48") == "body[1]/section[1]/p[2]");
    CHECK(model::node_path(doc, "n25") == "body[1]/section[1]/poem[1]/stanza[1]/v[2]");
    CHECK(model::node_path(doc, "n45") == "body[1]/section[1]/table[1]/tr[2]/td[2]");
    CHECK(model::node_path(doc, "n49") == "body[1]/section[1]/p[2]/raw-xml[1]");
    CHECK(model::node_path(doc, "n64") == "body[2]/section[1]/p[1]");
    CHECK(model::node_path(doc, "n101") == "title-info/annotation[1]/p[1]");
    CHECK(model::node_path(doc, "n111") == "document-info/history[1]/p[1]");
    CHECK(model::node_path(doc, "n70") == "extra[1]");
    CHECK(model::node_path(doc, "nope").empty());
    CHECK(model::node_path(doc, "").empty());

    CHECK(model::node_id_at_path(doc, "body[1]/section[1]/table[1]/tr[2]/td[2]") == "n45");
    CHECK_FALSE(model::node_id_at_path(doc, "body[9]").has_value());
    const model::Node* n = model::find_node(doc, "n27");
    REQUIRE(n != nullptr);
    CHECK(n->type == "date");
    CHECK(model::find_node(doc, "missing") == nullptr);

    const auto all = model::node_paths(doc);
    CHECK(all.size() == 46);
    CHECK(all.at("n61") == "body[2]/section[1]");
}

TEST_CASE("node_ids: remap table after a re-parse pairs ids by path", "[node_ids]") {
    const model::Document old_doc = load("rich-book.json");
    model::Document new_doc = old_doc;
    model::NodeIdAllocator fresh(5000);
    model::reassign_node_ids(new_doc, fresh);

    SECTION("identical structure maps every id") {
        const model::RemapTable table = model::build_remap(old_doc, new_doc);
        CHECK(table.unmapped_old.empty());
        CHECK(table.unmapped_new.empty());
        CHECK(table.old_to_new.size() == 46);
        CHECK(table.map("n14") == new_doc.bodies[0].content[3].content[1].node_id());
        CHECK_FALSE(table.map("zzz").has_value());
        const json j = table.to_json();
        CHECK(j["map"].size() == 46);
        CHECK(j["unmappedOld"].empty());
    }
    SECTION("removed and added nodes are reported") {
        // Drop the cite (n30/n31/n32) and add a paragraph at the end of the section.
        model::Node& section = new_doc.bodies[0].content[3];
        section.content.erase(section.content.begin() + 4);
        model::Node extra = para("added");
        extra.set_node_id("n9999");
        section.content.push_back(extra);
        const model::RemapTable table = model::build_remap(old_doc, new_doc);
        CHECK(table.unmapped_old == std::vector<std::string>{"n30", "n31", "n32"});
        CHECK(table.unmapped_new == std::vector<std::string>{"n9999"});
        // Paragraph numbering after the removed cite is unchanged (different type), so p[2]
        // still maps.
        CHECK(table.map("n48").has_value());
        CHECK(*table.map("n48") == *model::node_id_at_path(new_doc, "body[1]/section[1]/p[2]"));
    }
}

TEST_CASE("node_ids: visit_nodes can stop early", "[node_ids]") {
    const model::Document doc = load("rich-book.json");
    int visited = 0;
    model::visit_nodes(doc, [&](const model::Node&, const std::string&) { return ++visited < 3; });
    CHECK(visited == 3);
}
