// Feature 005 (T021/T022): FictionBook fragments - fb2::write_fragment and doc.fragmentToXml
// (writer parity: a fragment is byte-equal to the slice of the whole-document text, re-based
// to column 0; the `nodes` and `nodeIds` forms; no side effects on the session), then
// fb2::read_fragment and doc.fragmentFromXml (the reader half, the admission table).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/schema_table.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <set>
#include <string>
#include <utility>
#include <vector>

using namespace mfbe;
using Catch::Matchers::ContainsSubstring;
using nlohmann::json;

namespace {

// A book with every block kind of the body tree (p, subtitle, poem/stanza/v, cite, table,
// image, empty-line, a raw block) and inline content with every mark, an inline image, a
// comment and an unknown inline element (raw-xml, inline). Block text is single-line so that
// the slice of the whole-document text can be re-based line by line.
const char* kBook = R"xml(<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>prose</genre><author><first-name>A</first-name><last-name>B</last-name></author><book-title>Fragments</book-title><lang>ru</lang></title-info>
<document-info><author><nickname>t</nickname></author><date value="2026-01-01">2026</date><id>frag-1</id><version>1.0</version></document-info>
</description>
<body>
<title><p>Book</p></title>
<section id="s1">
<title><p>Chapter <strong>one</strong></p></title>
<epigraph><p>Epi</p><text-author>Someone</text-author></epigraph>
<p id="p1">Plain <strong>bold</strong> <emphasis>em</emphasis> <strikethrough>st</strikethrough> <sub>sub</sub> <sup>sup</sup> <code>code</code> <style name="x">styled</style> <a l:href="#n1" type="note">1</a> &amp; &lt;tag&gt; <image l:href="#i.png" alt="inline"/> <!-- note --> <foo>bar</foo> end</p>
<subtitle>Sub &amp; title</subtitle>
<empty-line/>
<poem id="poem1"><title><p>Poem</p></title><stanza><v>Line one</v><v>Line <emphasis>two</emphasis></v></stanza><text-author>Poet</text-author><date value="1900-01-01">1900</date></poem>
<cite><p>Quote</p><text-author>Author</text-author></cite>
<table><tr align="center"><th>H1</th><th colspan="2">H2</th></tr><tr><td>c1</td><td style="s">c2</td><td>c3</td></tr></table>
<image l:href="#pic.jpg" alt="Alt" title="T"/>
<unknown-block attr="1">raw block</unknown-block>
<p>After the raw one</p>
</section>
<section id="s2"><p>Second</p></section>
</body>
<body name="notes"><section id="n1"><p>Note</p></section></body>
</FictionBook>
)xml";

struct Loaded {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadResult read;
    std::string text;  // write_document of the read document (default options)

    Loaded() {
        read = fb2::read_bytes(kBook, store, ids);
        text = fb2::write_document(read.document, &store).text;
    }
    const model::Node& body() const { return read.document.bodies.at(0); }
    const model::Node& section1() const { return body().content.at(1); }
};

std::vector<std::string> lines_of(const std::string& text) {
    std::vector<std::string> out;
    std::size_t pos = 0;
    while (pos < text.size()) {
        const auto nl = text.find('\n', pos);
        out.push_back(text.substr(pos, nl == std::string::npos ? std::string::npos : nl - pos));
        if (nl == std::string::npos) {
            break;
        }
        pos = nl + 1;
    }
    return out;
}

// The lines of `text` from the line holding `open` to the line holding `close` - the two
// lines themselves excluded (`inclusive` false: the children of that element) or included
// (the element itself) - each with `depth` leading tabs removed: the slice of the
// whole-document text re-based to column 0, without a trailing newline.
std::string slice_lines(const std::string& text, const std::string& open, const std::string& close,
                        int depth, bool inclusive = false) {
    const std::vector<std::string> lines = lines_of(text);
    std::size_t first = lines.size();
    std::size_t last = lines.size();
    for (std::size_t i = 0; i < lines.size(); ++i) {
        if (first == lines.size() && lines[i].find(open) != std::string::npos) {
            first = i;
        } else if (first != lines.size() && lines[i].find(close) != std::string::npos) {
            last = i;
            break;
        }
    }
    REQUIRE(first < last);
    REQUIRE(last < lines.size());
    std::string out;
    for (std::size_t i = inclusive ? first : first + 1; i < (inclusive ? last + 1 : last); ++i) {
        std::string line = lines[i];
        REQUIRE(line.compare(0, static_cast<std::size_t>(depth), std::string(depth, '\t')) == 0);
        out += line.substr(static_cast<std::size_t>(depth));
        out += "\n";
    }
    out.pop_back();
    return out;
}

const model::Node& child_of_type(const model::Node& parent, const std::string& type,
                                 std::size_t nth = 0) {
    std::size_t seen = 0;
    for (const model::Node& child : parent.content) {
        if (child.type == type) {
            if (seen == nth) {
                return child;
            }
            ++seen;
        }
    }
    FAIL("no child of type " << type);
    return parent;
}

struct ServerFixture {
    test::TempDir data{"mfbe-fragment"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    ServerFixture() {
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    // Opens kBook from a file; returns {docId, document}.
    std::pair<std::string, json> open_book() {
        const std::filesystem::path path = data / "fragments.fb2";
        test::write_text(path, kBook);
        const json opened = ws.call("doc.open", json{{"path", path.string()}});
        REQUIRE(opened.contains("result"));
        const json& document = opened["result"]["document"];
        return {document["docId"].get<std::string>(), document};
    }
};

const json& json_child_of_type(const json& parent, const std::string& type, std::size_t nth = 0) {
    std::size_t seen = 0;
    for (const json& child : parent["content"]) {
        if (child["type"] == type) {
            if (seen == nth) {
                return child;
            }
            ++seen;
        }
    }
    FAIL("no child of type " << type);
    return parent;
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Writer                                                                                    */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("fragment writer: sibling blocks of every kind equal the slice of the document text",
          "[fragment][writer]") {
    Loaded l;
    const model::Node& section = l.section1();
    // Every block kind is present: title, epigraph, p, subtitle, empty-line, poem (stanza, v,
    // text-author, date), cite, table (tr, th, td), image, raw-xml.
    for (const char* type : {"title", "epigraph", "p", "subtitle", "empty-line", "poem", "cite",
                             "table", "image", "raw-xml"}) {
        INFO(type);
        CHECK_NOTHROW(child_of_type(section, type));
    }
    const std::string expected = slice_lines(l.text, "<section id=\"s1\">", "</section>", 3);
    const std::string xml = fb2::write_fragment(section.content);
    CHECK(xml == expected);
    CHECK(xml.rfind("<title>\n\t<p>Chapter <strong>one</strong></p>\n</title>\n", 0) == 0);
    CHECK(xml.back() != '\n');
    CHECK(xml.find("nodeId") == std::string::npos);
    CHECK(xml.find("xmlns") == std::string::npos);
    CHECK(xml.find("<?xml") == std::string::npos);
    CHECK_THAT(xml, ContainsSubstring("<unknown-block attr=\"1\">raw block</unknown-block>\n"));
    CHECK_THAT(xml, ContainsSubstring("<image l:href=\"#pic.jpg\" alt=\"Alt\" title=\"T\"/>\n"));

    // Each kind alone: the fragment of one node is its own lines of the slice.
    const std::vector<std::string> lines = lines_of(expected);
    std::size_t line = 0;
    for (const model::Node& child : section.content) {
        const std::string one = fb2::write_fragment({child});
        const std::vector<std::string> own = lines_of(one);
        REQUIRE(line + own.size() <= lines.size());
        for (std::size_t i = 0; i < own.size(); ++i) {
            INFO(child.type << " line " << i);
            CHECK(own[i] == lines[line + i]);
        }
        line += own.size();
    }
    CHECK(line == lines.size());

    // Nested structure is re-based to the node: one tab per level below it.
    const std::string poem = fb2::write_fragment({child_of_type(section, "poem")});
    CHECK(poem ==
          "<poem id=\"poem1\">\n\t<title>\n\t\t<p>Poem</p>\n\t</title>\n\t<stanza>\n"
          "\t\t<v>Line one</v>\n\t\t<v>Line <emphasis>two</emphasis></v>\n\t</stanza>\n"
          "\t<text-author>Poet</text-author>\n\t<date value=\"1900-01-01\">1900</date>\n"
          "</poem>");
    // Two siblings: separated by "\n", nothing after the last.
    const std::string two = fb2::write_fragment(
        {child_of_type(section, "subtitle"), child_of_type(section, "empty-line")});
    CHECK(two == "<subtitle>Sub &amp; title</subtitle>\n<empty-line/>");
    // A whole body (depth 1 in the book) is re-based the same way.
    CHECK(fb2::write_fragment({l.body()}) == slice_lines(l.text, "<body>", "</body>", 1, true));
    CHECK(fb2::write_fragment({}).empty());
}

TEST_CASE("fragment writer: inline content with every mark is the container's content",
          "[fragment][writer]") {
    Loaded l;
    const model::Node& p1 = child_of_type(l.section1(), "p");
    REQUIRE(p1.attr_string("id") == "p1");
    const std::string xml = fb2::write_fragment(p1.content);
    const std::string expected =
        "Plain <strong>bold</strong> <emphasis>em</emphasis> <strikethrough>st</strikethrough> "
        "<sub>sub</sub> <sup>sup</sup> <code>code</code> <style name=\"x\">styled</style> "
        "<a l:href=\"#n1\" type=\"note\">1</a> &amp; &lt;tag&gt; "
        "<image l:href=\"#i.png\" alt=\"inline\"/> <!-- note --> <foo>bar</foo> end";
    CHECK(xml == expected);
    // Byte-equal to the paragraph's content in the whole-document text.
    const std::string open = "<p id=\"p1\">";
    const std::size_t start = l.text.find(open);
    REQUIRE(start != std::string::npos);
    const std::size_t end = l.text.find("</p>", start);
    CHECK(l.text.substr(start + open.size(), end - start - open.size()) == xml);
    // The session's xlink prefix is honoured for links and inline images.
    fb2::FragmentOptions options;
    options.xlink_prefix = "xlink";
    const std::string prefixed = fb2::write_fragment(p1.content, options);
    CHECK_THAT(prefixed, ContainsSubstring("<a xlink:href=\"#n1\" type=\"note\">1</a>"));
    CHECK_THAT(prefixed, ContainsSubstring("<image xlink:href=\"#i.png\" alt=\"inline\"/>"));
    CHECK(fb2::write_fragment({child_of_type(l.section1(), "image")}, options) ==
          "<image xlink:href=\"#pic.jpg\" alt=\"Alt\" title=\"T\"/>");
    // Classification: text, inline images and inline raw-xml are inline; the rest is not.
    for (const model::Node& node : p1.content) {
        INFO(node.type);
        CHECK(fb2::is_inline_node(node));
    }
    for (const model::Node& node : l.section1().content) {
        INFO(node.type);
        CHECK_FALSE(fb2::is_inline_node(node));
    }
}

/* ----------------------------------------------------------------------------------------- */
/* doc.fragmentToXml                                                                         */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE(
    "doc.fragmentToXml: nodes and nodeIds give the writer's text with re-based "
    "indentation; snapshot and map untouched",
    "[fragment][server]") {
    ServerFixture f;
    auto [doc_id, document] = f.open_book();
    const json& section = document["bodies"][0]["content"][1];
    REQUIRE(section["attrs"]["id"] == "s1");
    const json to_xml = f.ws.call(
        "doc.toXml", json{{"docId", doc_id}, {"document", document}, {"positions", true}});
    REQUIRE(to_xml.contains("result"));
    const std::string text = to_xml["result"]["text"];
    const int serial = to_xml["result"]["serial"];
    const std::string expected = slice_lines(text, "<section id=\"s1\">", "</section>", 3);

    // The nodes form: the section's children as the UI holds them.
    const json by_nodes =
        f.ws.call("doc.fragmentToXml", json{{"docId", doc_id}, {"nodes", section["content"]}});
    REQUIRE(by_nodes.contains("result"));
    CHECK(by_nodes["result"]["xml"] == expected);
    CHECK(by_nodes["result"].size() == 1);  // no serial, nothing else

    // The nodeIds form: the same ids in any order, written in document order.
    std::vector<std::string> ids;
    for (const json& child : section["content"]) {
        ids.push_back(child["attrs"]["nodeId"].get<std::string>());
    }
    std::vector<std::string> shuffled(ids.rbegin(), ids.rend());
    const json by_ids =
        f.ws.call("doc.fragmentToXml", json{{"docId", doc_id}, {"nodeIds", shuffled}});
    REQUIRE(by_ids.contains("result"));
    CHECK(by_ids["result"]["xml"] == expected);

    // A nested id is written once inside its ancestor; duplicates are ignored.
    const json& poem = json_child_of_type(section, "poem");
    const std::string poem_id = poem["attrs"]["nodeId"];
    const std::string verse_id = poem["content"][1]["content"][0]["attrs"]["nodeId"];
    const json nested =
        f.ws.call("doc.fragmentToXml",
                  json{{"docId", doc_id}, {"nodeIds", json::array({verse_id, poem_id, poem_id})}});
    REQUIRE(nested.contains("result"));
    const std::string poem_xml = nested["result"]["xml"];
    CHECK(poem_xml.rfind("<poem id=\"poem1\">\n\t<title>", 0) == 0);
    CHECK(poem_xml.find("<v>Line one</v>") == poem_xml.rfind("<v>Line one</v>"));
    CHECK(poem_xml.find("</poem>") == poem_xml.size() - 7);

    // The two bodies by id: the second after the first whatever the order given.
    const std::string body1 = document["bodies"][0]["attrs"]["nodeId"];
    const std::string body2 = document["bodies"][1]["attrs"]["nodeId"];
    const json bodies = f.ws.call(
        "doc.fragmentToXml", json{{"docId", doc_id}, {"nodeIds", json::array({body2, body1})}});
    REQUIRE(bodies.contains("result"));
    const std::string bodies_xml = bodies["result"]["xml"];
    CHECK(bodies_xml.rfind("<body>\n", 0) == 0);
    CHECK(bodies_xml.find("<body name=\"notes\">") > bodies_xml.find("</body>"));
    CHECK(bodies_xml.find("xmlns") == std::string::npos);

    // A `document` given here is used for the ids and does not become the snapshot.
    json changed = document;
    changed["bodies"][0]["content"][1]["content"][2]["content"] =
        json::array({{{"type", "text"}, {"text", "Changed"}}});
    const std::string p1_id = section["content"][2]["attrs"]["nodeId"];
    const json from_given = f.ws.call(
        "doc.fragmentToXml",
        json{{"docId", doc_id}, {"document", changed}, {"nodeIds", json::array({p1_id})}});
    REQUIRE(from_given.contains("result"));
    CHECK(from_given["result"]["xml"] == "<p id=\"p1\">Changed</p>");
    const json from_snapshot =
        f.ws.call("doc.fragmentToXml", json{{"docId", doc_id}, {"nodeIds", json::array({p1_id})}});
    REQUIRE(from_snapshot.contains("result"));
    CHECK(from_snapshot["result"]["xml"].get<std::string>().rfind("<p id=\"p1\">Plain ", 0) == 0);
    // The position map of the last doc.toXml is still the current one.
    const json mapped =
        f.ws.call("doc.mapPositions",
                  json{{"docId", doc_id},
                       {"serial", serial},
                       {"toSource", json::array({json{{"nodeId", p1_id}, {"offset", 0}}})}});
    REQUIRE(mapped.contains("result"));
    CHECK(mapped["result"]["toSource"][0].is_number());
    // doc.fromXml after it: the allocator went on from where doc.open left it (no ids were
    // issued by the fragment calls), so the remap keeps every id.
    const json reparsed = f.ws.call("doc.fromXml", json{{"docId", doc_id}, {"text", text}});
    REQUIRE(reparsed.contains("result"));
    CHECK(reparsed["result"]["remap"]["unmappedOld"].empty());
}

TEST_CASE(
    "doc.fragmentToXml: inline nodes are written as content; mixed lists and unknown ids "
    "are invalidParams",
    "[fragment][server]") {
    ServerFixture f;
    auto [doc_id, document] = f.open_book();
    const json& section = document["bodies"][0]["content"][1];
    const json& p1 = section["content"][2];
    REQUIRE(p1["attrs"]["id"] == "p1");

    const json inline_xml =
        f.ws.call("doc.fragmentToXml", json{{"docId", doc_id}, {"nodes", p1["content"]}});
    REQUIRE(inline_xml.contains("result"));
    const std::string xml = inline_xml["result"]["xml"];
    CHECK(xml.rfind("Plain <strong>bold</strong> <emphasis>em</emphasis>", 0) == 0);
    CHECK_THAT(xml, ContainsSubstring("<a l:href=\"#n1\" type=\"note\">1</a> &amp; &lt;tag&gt; "
                                      "<image l:href=\"#i.png\" alt=\"inline\"/>"));
    CHECK(xml.find("<p") == std::string::npos);
    CHECK(xml.find("nodeId") == std::string::npos);

    // Inline nodes by id: the inline image alone.
    std::string image_id;
    for (const json& node : p1["content"]) {
        if (node["type"] == "inline-image") {
            image_id = node["attrs"]["nodeId"];
        }
    }
    REQUIRE_FALSE(image_id.empty());
    const json image = f.ws.call("doc.fragmentToXml",
                                 json{{"docId", doc_id}, {"nodeIds", json::array({image_id})}});
    REQUIRE(image.contains("result"));
    CHECK(image["result"]["xml"] == "<image l:href=\"#i.png\" alt=\"inline\"/>");

    // Mixed lists: a paragraph with inline content, in both forms.
    json mixed = json::array({p1, p1["content"][0]});
    const json mixed_nodes =
        f.ws.call("doc.fragmentToXml", json{{"docId", doc_id}, {"nodes", mixed}});
    REQUIRE(mixed_nodes.contains("error"));
    CHECK(mixed_nodes["error"]["code"] == -32602);
    CHECK(mixed_nodes["error"]["data"]["field"] == "nodes");
    const std::string p1_id = p1["attrs"]["nodeId"];
    // (The image inside p1 is covered by p1; a sibling block beside the image is a mix.)
    const std::string subtitle_id = json_child_of_type(section, "subtitle")["attrs"]["nodeId"];
    const json mixed_ids =
        f.ws.call("doc.fragmentToXml",
                  json{{"docId", doc_id}, {"nodeIds", json::array({subtitle_id, image_id})}});
    REQUIRE(mixed_ids.contains("error"));
    CHECK(mixed_ids["error"]["code"] == -32602);
    CHECK(mixed_ids["error"]["data"]["field"] == "nodeIds");

    // Unknown id, both forms, neither form, an undecodable node, an unknown document.
    const json unknown = f.ws.call(
        "doc.fragmentToXml", json{{"docId", doc_id}, {"nodeIds", json::array({p1_id, "n999"})}});
    REQUIRE(unknown.contains("error"));
    CHECK(unknown["error"]["code"] == -32602);
    CHECK(unknown["error"]["data"]["field"] == "nodeIds");
    CHECK(unknown["error"]["data"]["nodeId"] == "n999");
    const json both = f.ws.call(
        "doc.fragmentToXml",
        json{{"docId", doc_id}, {"nodes", json::array()}, {"nodeIds", json::array({p1_id})}});
    REQUIRE(both.contains("error"));
    CHECK(both["error"]["code"] == -32602);
    CHECK(both["error"]["data"]["field"] == "nodes");
    const json neither = f.ws.call("doc.fragmentToXml", json{{"docId", doc_id}});
    REQUIRE(neither.contains("error"));
    CHECK(neither["error"]["data"]["field"] == "nodes");
    const json bad_node = f.ws.call(
        "doc.fragmentToXml",
        json{{"docId", doc_id}, {"nodes", json::array({{{"type", "p"}, {"content", "x"}}})}});
    REQUIRE(bad_node.contains("error"));
    CHECK(bad_node["error"]["code"] == -32602);
    CHECK(bad_node["error"]["data"]["field"] == "nodes");
    CHECK(f.ws.call("doc.fragmentToXml",
                    json{{"docId", "d99"}, {"nodes", json::array()}})["error"]["code"] == 1000);
    // An empty list is an empty text.
    CHECK(f.ws.call("doc.fragmentToXml",
                    json{{"docId", doc_id}, {"nodes", json::array()}})["result"]["xml"] == "");

    // A Source-only session has no model to take nodes from: 1003.
    const json source =
        f.ws.call("doc.openSource",
                  json{{"path", (test::fixtures_dir() / "books" / "malformed.fb2").string()}});
    REQUIRE(source.contains("result"));
    const std::string source_id = source["result"]["docId"];
    const json no_model = f.ws.call("doc.fragmentToXml",
                                    json{{"docId", source_id}, {"nodeIds", json::array({"n1"})}});
    REQUIRE(no_model.contains("error"));
    CHECK(no_model["error"]["code"] == 1003);
    // ... but the nodes form works for it (nothing of the session is needed).
    CHECK(f.ws.call("doc.fragmentToXml",
                    json{{"docId", source_id}, {"nodes", p1["content"]}})["result"]["xml"] == xml);
}

/* ----------------------------------------------------------------------------------------- */
/* Reader and the admission table                                                            */
/* ----------------------------------------------------------------------------------------- */

namespace {

// True when no node of the tree carries a nodeId attribute.
bool without_ids(const model::Node& node) {
    if (!node.is_text() && node.attrs.count("nodeId") != 0) {
        return false;
    }
    return std::all_of(node.content.begin(), node.content.end(), without_ids);
}

bool json_without_ids(const json& node) {
    if (node.contains("attrs") && node["attrs"].contains("nodeId")) {
        return false;
    }
    if (node.contains("content")) {
        for (const json& child : node["content"]) {
            if (!json_without_ids(child)) {
                return false;
            }
        }
    }
    return true;
}

model::Node strip_ids(model::Node node) {
    node.attrs.erase("nodeId");
    for (model::Node& child : node.content) {
        child = strip_ids(child);
    }
    return node;
}

std::vector<model::Node> strip_ids(const std::vector<model::Node>& nodes) {
    std::vector<model::Node> out;
    for (const model::Node& node : nodes) {
        out.push_back(strip_ids(node));
    }
    return out;
}

fb2::ParseError parse_failure_of(const std::string& xml, const std::string& parent) {
    try {
        fb2::read_fragment(xml, parent);
    } catch (const fb2::ParseFailure& e) {
        return e.error;
    }
    FAIL("expected a ParseFailure for " << xml);
    return {};
}

std::pair<std::string, std::string> refusal_of(const std::string& xml, const std::string& parent) {
    try {
        fb2::read_fragment(xml, parent);
    } catch (const fb2::FragmentNotAllowed& e) {
        return {e.element, e.parent};
    }
    FAIL("expected FragmentNotAllowed for " << xml);
    return {};
}

std::filesystem::path repo_root() {
    return test::fixtures_dir().parent_path().parent_path();
}

}  // namespace

TEST_CASE(
    "fragment reader: the admission table built from the XSD equals the Source view's "
    "completion table",
    "[fragment][schema]") {
    const auto table = schema::content_table();
    REQUIRE(table->error.empty());
    CHECK(table->root == "FictionBook");
    const json ui = json::parse(
        test::read_text(repo_root() / "ui" / "src" / "views" / "source" / "fb2Elements.json"));
    CHECK(ui["root"] == table->root);
    REQUIRE(ui["elements"].size() == table->elements.size());
    for (const auto& [name, content] : table->elements) {
        INFO(name);
        REQUIRE(ui["elements"].contains(name));
        const json& entry = ui["elements"][name];
        CHECK(entry["children"] == json(content.children));
        if (entry.contains("text")) {
            CHECK(entry["text"] == content.text);
        }
    }
    // Spot checks of the flattening: extensions, choices, mixed content, simple content.
    CHECK(table->find("section")->children ==
          std::set<std::string>{"annotation", "cite", "empty-line", "epigraph", "image", "p",
                                "poem", "section", "subtitle", "table", "title"});
    CHECK(table->find("p")->children == std::set<std::string>{"a", "code", "emphasis", "image",
                                                              "strikethrough", "strong", "style",
                                                              "sub", "sup"});
    CHECK(table->find("p")->text);
    CHECK(table->find("a")->text);
    CHECK(table->find("date")->text);
    CHECK(table->find("body")->children ==
          std::set<std::string>{"epigraph", "image", "section", "title"});
    CHECK_FALSE(table->find("section")->text);
    CHECK_FALSE(table->find("title")->text);
    CHECK_FALSE(table->find("empty-line")->text);
    CHECK(table->find("empty-line")->children.empty());
    CHECK(table->find("stanza")->children == std::set<std::string>{"subtitle", "title", "v"});
    CHECK(table->find("chapter") == nullptr);
    // The same table again is the shared one.
    CHECK(schema::content_table().get() == table.get());
    // A folder without the schema: an error, nothing cached.
    test::TempDir empty{"mfbe-schema-missing"};
    const schema::ContentTable missing =
        schema::build_content_table(empty.path() / "FictionBook.xsd");
    CHECK_FALSE(missing.error.empty());
    CHECK(missing.elements.empty());
}

TEST_CASE(
    "fragment reader: blocks and inline content without ids; 1001 positions in the "
    "fragment; whitespace is nothing",
    "[fragment][reader]") {
    // Block content under a section: the reader's nodes, no nodeId anywhere.
    const fb2::FragmentResult blocks = fb2::read_fragment(
        "<p>One</p>\n<p>Two <strong>bold</strong></p>\n<empty-line/>\n"
        "<poem><stanza><v>verse</v></stanza></poem>",
        "section");
    CHECK_FALSE(blocks.is_inline);
    CHECK(blocks.warnings.empty());
    REQUIRE(blocks.nodes.size() == 4);
    CHECK(blocks.nodes[0].type == "p");
    CHECK(blocks.nodes[0].content.at(0).text == "One");
    CHECK(blocks.nodes[1].content.at(1).marks.at(0).type == "strong");
    CHECK(blocks.nodes[2].type == "empty-line");
    CHECK(blocks.nodes[3].content.at(0).content.at(0).type == "v");
    for (const model::Node& node : blocks.nodes) {
        CHECK(without_ids(node));
    }
    // Inline content under a text container, both xlink prefixes.
    const fb2::FragmentResult inl = fb2::read_fragment(
        "Hello <strong>world</strong><a l:href=\"#n1\" type=\"note\">1</a>"
        "<a xlink:href=\"#n2\">2</a><image l:href=\"#i.png\"/>",
        "p");
    CHECK(inl.is_inline);
    REQUIRE(inl.nodes.size() == 5);
    CHECK(inl.nodes[0].text == "Hello ");
    CHECK(inl.nodes[1].marks.at(0).type == "strong");
    CHECK(inl.nodes[2].marks.at(0).attrs["href"] == "#n1");
    CHECK(inl.nodes[3].marks.at(0).attrs["href"] == "#n2");
    CHECK(inl.nodes[4].type == "inline-image");
    CHECK(inl.nodes[4].attr_string("href") == "#i.png");
    CHECK(without_ids(inl.nodes[4]));
    // Every text container is inline, the other parents are not.
    for (const char* name : {"p", "subtitle", "text-author", "v", "td", "th", "date"}) {
        INFO(name);
        CHECK(fb2::is_text_container(name));
        CHECK(fb2::read_fragment("x", name).is_inline);
    }
    for (const char* name : {"body", "section", "title", "epigraph", "annotation", "history",
                             "cite", "poem", "stanza", "table", "tr"}) {
        INFO(name);
        CHECK_FALSE(fb2::is_text_container(name));
        CHECK_FALSE(fb2::read_fragment(" \n ", name).is_inline);
    }
    // Whitespace only: no nodes, no warnings.
    CHECK(fb2::read_fragment("", "section").nodes.empty());
    CHECK(fb2::read_fragment("  \n\t", "p").nodes.empty());
    CHECK(fb2::read_fragment("  \n\t", "p").is_inline);
    // A date holds text only.
    const fb2::FragmentResult date = fb2::read_fragment("1 January", "date");
    REQUIRE(date.nodes.size() == 1);
    CHECK(date.nodes[0].text == "1 January");

    // Not well-formed: positions counted in the fragment itself.
    const fb2::ParseError unclosed = parse_failure_of("<p>never closed", "section");
    CHECK(unclosed.line == 1);
    CHECK(unclosed.column >= 1);
    CHECK(unclosed.column <= 16);
    const fb2::ParseError nbsp = parse_failure_of("<p>a&nbsp;b</p>", "section");
    CHECK(nbsp.line == 1);
    CHECK(nbsp.column >= 5);
    CHECK(nbsp.column <= 11);
    CHECK_THAT(nbsp.message, ContainsSubstring("nbsp"));
    const fb2::ParseError later =
        parse_failure_of("<p>a</p>\n<p>b</p>\n<p>c &nbsp; d</p>", "section");
    CHECK(later.line == 3);
    CHECK(later.column >= 6);
    CHECK(later.column <= 12);
    const fb2::ParseError mismatch = parse_failure_of("<p>a</b>", "section");
    CHECK(mismatch.line == 1);
    CHECK(mismatch.column <= 9);
    // U+00A0 itself is fine; the five predefined entities exist.
    CHECK(fb2::read_fragment("a\xC2\xA0&amp;&lt;&gt;&quot;&apos;b", "p").nodes.at(0).text ==
          "a\xC2\xA0&<>\"'b");
    // An XML declaration inside a fragment is not well-formed (1001), a wrapper is refused
    // by the schema (1201).
    CHECK(parse_failure_of("<?xml version=\"1.0\"?><p>x</p>", "section").line == 1);
    CHECK(refusal_of("<FictionBook><body><section><p>x</p></section></body></FictionBook>",
                     "section") ==
          std::make_pair(std::string("FictionBook"), std::string("section")));
    CHECK(refusal_of("<body><section><p>x</p></section></body>", "section") ==
          std::make_pair(std::string("body"), std::string("section")));
}

TEST_CASE(
    "fragment reader: 1201 for a misplaced, unknown or foreign element and for text in "
    "an element-only container; order is not judged",
    "[fragment][reader]") {
    using Pair = std::pair<std::string, std::string>;
    CHECK(refusal_of("<title><p>t</p></title>", "p") == Pair{"title", "p"});
    CHECK(refusal_of("<section><p>x</p></section>", "p") == Pair{"section", "p"});
    CHECK(refusal_of("<p>in</p>", "p") == Pair{"p", "p"});
    CHECK(refusal_of("<chapter><p>x</p></chapter>", "section") == Pair{"chapter", "section"});
    CHECK(refusal_of("<p>ok</p><x:foo xmlns:x=\"urn:x\"/>", "section") ==
          Pair{"{urn:x}foo", "section"});
    CHECK(refusal_of("<p>ok</p>stray text", "section") == Pair{"#text", "section"});
    CHECK(refusal_of("<p>ok</p><title>no p</title>", "section") == Pair{"#text", "title"});
    CHECK(refusal_of("<empty-line>t</empty-line>", "section") == Pair{"#text", "empty-line"});
    CHECK(refusal_of("<v>verse</v>", "section") == Pair{"v", "section"});
    CHECK(refusal_of("<p><p>nested</p></p>", "section") == Pair{"p", "p"});
    CHECK(refusal_of("<strong>b</strong>", "section") == Pair{"strong", "section"});
    CHECK(refusal_of("<binary id=\"x\" content-type=\"image/png\">AA==</binary>", "section") ==
          Pair{"binary", "section"});
    CHECK(refusal_of("<tr><td>c</td></tr>", "section") == Pair{"tr", "section"});
    // The first offending pair in document order.
    CHECK(refusal_of("<p>a</p><p><section/></p><chapter/>", "section") == Pair{"section", "p"});
    // Admitted although out of order or repeated: the validity hook judges that.
    CHECK(fb2::read_fragment("<p>a</p><title><p>t</p></title>", "section").nodes.size() == 2);
    CHECK(fb2::read_fragment("<title><p>1</p></title><title><p>2</p></title>", "section")
              .nodes.size() == 2);
    CHECK(fb2::read_fragment("<v>a</v>", "stanza").nodes.size() == 1);
    CHECK(fb2::read_fragment("<tr><td>c</td></tr>", "table").nodes.size() == 1);
    CHECK(fb2::read_fragment("<td>c</td><th>h</th>", "tr").nodes.size() == 2);
    CHECK(fb2::read_fragment("<section><p>x</p></section>", "body").nodes.at(0).type == "section");
    CHECK(fb2::read_fragment("<p>h</p>", "history").nodes.size() == 1);
    // Comments and processing instructions are kept as the reader keeps them (raw-xml).
    const fb2::FragmentResult commented = fb2::read_fragment("<!-- c --><p>x</p>", "section");
    REQUIRE(commented.nodes.size() == 2);
    CHECK(commented.nodes[0].type == "raw-xml");
    CHECK(commented.nodes[0].attr_string("xml") == "<!-- c -->");
    // Attribute values are not judged here (the hook's).
    CHECK(fb2::read_fragment("<p id=\"\" style=\"x\" bogus=\"1\">x</p>", "section")
              .nodes.at(0)
              .attrs.count("unknownAttrs") == 1);
}

// The nodes of a list without the raw-xml nodes, at any depth, that hold an element unknown
// to the schema (the reader keeps them, the fragment reader refuses them - 1201); comments
// stay.
std::vector<model::Node> known_only(const std::vector<model::Node>& nodes) {
    std::vector<model::Node> out;
    for (const model::Node& node : nodes) {
        if (node.type == "raw-xml" && node.attr_string("xml").value_or("").rfind("<!--", 0) != 0) {
            continue;
        }
        model::Node copy = node;
        copy.content = known_only(node.content);
        // Text nodes left adjacent by a removal merge, as the reader merges them.
        if (copy.is_text() && !out.empty() && out.back().is_text() &&
            out.back().marks == copy.marks) {
            out.back().text += copy.text;
            continue;
        }
        out.push_back(std::move(copy));
    }
    return out;
}

TEST_CASE("fragment: toXml -> fromXml round trip equals the nodes modulo ids, block and inline",
          "[fragment][reader][writer]") {
    Loaded l;
    const model::Node& section = l.section1();
    const std::vector<model::Node> blocks = known_only(section.content);
    REQUIRE(blocks.size() == section.content.size() - 1);  // the unknown block is out
    // <foo> is out of the paragraph and its neighbours merged into one text node.
    REQUIRE(blocks.at(2).content.size() == section.content.at(2).content.size() - 2);
    const std::string xml = fb2::write_fragment(blocks);
    const fb2::FragmentResult back = fb2::read_fragment(xml, "section");
    CHECK_FALSE(back.is_inline);
    CHECK(back.nodes == strip_ids(blocks));
    CHECK(fb2::write_fragment(back.nodes) == xml);
    // An unknown element in the list is refused as a whole, it never reaches the model: the
    // first pair in document order is the <foo> inside the paragraph, before the unknown block.
    CHECK(refusal_of(fb2::write_fragment(section.content), "section") ==
          std::make_pair(std::string("foo"), std::string("p")));
    const model::Node& p1 = child_of_type(section, "p");
    const std::vector<model::Node> inline_nodes = known_only(p1.content);
    REQUIRE(inline_nodes.size() == p1.content.size() - 2);  // <foo> is out, the comment stays
    const std::string inline_xml = fb2::write_fragment(inline_nodes);
    const fb2::FragmentResult inline_back = fb2::read_fragment(inline_xml, "p");
    CHECK(inline_back.is_inline);
    CHECK(inline_back.nodes == strip_ids(inline_nodes));
    CHECK(fb2::write_fragment(inline_back.nodes) == inline_xml);
    CHECK(refusal_of(fb2::write_fragment(p1.content), "p") ==
          std::make_pair(std::string("foo"), std::string("p")));
    // The second section and the notes body: whole subtrees.
    const model::Node& section2 = l.body().content.at(2);
    const fb2::FragmentResult section_back =
        fb2::read_fragment(fb2::write_fragment({section2}), "body");
    REQUIRE(section_back.nodes.size() == 1);
    CHECK(section_back.nodes[0] == strip_ids(section2));
    const model::Node& notes = l.read.document.bodies.at(1);
    const fb2::FragmentResult body_back =
        fb2::read_fragment(fb2::write_fragment({notes}), "FictionBook");
    REQUIRE(body_back.nodes.size() == 1);
    CHECK(body_back.nodes[0] == strip_ids(notes));
}

/* ----------------------------------------------------------------------------------------- */
/* doc.fragmentFromXml                                                                       */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE(
    "doc.fragmentFromXml: nodes carry no nodeId and the session allocator is untouched; "
    "1001 for malformed XML and &nbsp; with positions in the fragment",
    "[fragment][server]") {
    ServerFixture f;
    auto [doc_id, document] = f.open_book();
    const json& section = document["bodies"][0]["content"][1];
    const std::string section_id = section["attrs"]["nodeId"];
    const std::string p1_id = section["content"][2]["attrs"]["nodeId"];

    const json blocks = f.ws.call("doc.fragmentFromXml",
                                  json{{"docId", doc_id},
                                       {"xml", "<p>One</p>\n<p>Two <emphasis>em</emphasis></p>"},
                                       {"parent", {{"element", "section"}}}});
    REQUIRE(blocks.contains("result"));
    CHECK(blocks["result"]["inline"] == false);
    CHECK(blocks["result"]["warnings"] == json::array());
    REQUIRE(blocks["result"]["nodes"].size() == 2);
    CHECK(blocks["result"]["nodes"][0]["type"] == "p");
    CHECK(blocks["result"]["nodes"][0]["attrs"] == json::object());
    CHECK(blocks["result"]["nodes"][1]["content"][1]["marks"][0]["type"] == "emphasis");
    for (const json& node : blocks["result"]["nodes"]) {
        CHECK(json_without_ids(node));
    }
    // By nodeId: a section is a block parent, a paragraph a text container.
    const json by_section =
        f.ws.call("doc.fragmentFromXml", json{{"docId", doc_id},
                                              {"xml", "<subtitle>S</subtitle>"},
                                              {"parent", {{"nodeId", section_id}}}});
    REQUIRE(by_section.contains("result"));
    CHECK(by_section["result"]["inline"] == false);
    CHECK(by_section["result"]["nodes"][0]["type"] == "subtitle");
    const json by_p =
        f.ws.call("doc.fragmentFromXml",
                  json{{"docId", doc_id},
                       {"xml", "Hello <strong>world</strong><a l:href=\"#n1\" type=\"note\">1</a>"},
                       {"parent", {{"nodeId", p1_id}}}});
    REQUIRE(by_p.contains("result"));
    CHECK(by_p["result"]["inline"] == true);
    REQUIRE(by_p["result"]["nodes"].size() == 3);
    CHECK(by_p["result"]["nodes"][0] == json{{"type", "text"}, {"text", "Hello "}});
    CHECK(by_p["result"]["nodes"][2]["marks"][0]["attrs"]["href"] == "#n1");
    // Whitespace only.
    const json blank =
        f.ws.call("doc.fragmentFromXml",
                  json{{"docId", doc_id}, {"xml", " \n "}, {"parent", {{"element", "p"}}}});
    REQUIRE(blank.contains("result"));
    CHECK(blank["result"] ==
          json{{"nodes", json::array()}, {"inline", true}, {"warnings", json::array()}});

    // 1001 with positions in the fragment.
    const json malformed = f.ws.call(
        "doc.fragmentFromXml",
        json{{"docId", doc_id}, {"xml", "<p>a</p>\n<p>b"}, {"parent", {{"element", "section"}}}});
    REQUIRE(malformed.contains("error"));
    CHECK(malformed["error"]["code"] == 1001);
    CHECK(malformed["error"]["data"]["line"] == 2);
    CHECK(malformed["error"]["data"]["column"].get<int>() <= 5);
    CHECK(malformed["error"]["data"]["message"].is_string());
    const json nbsp =
        f.ws.call("doc.fragmentFromXml",
                  json{{"docId", doc_id}, {"xml", "a&nbsp;b"}, {"parent", {{"element", "p"}}}});
    REQUIRE(nbsp.contains("error"));
    CHECK(nbsp["error"]["code"] == 1001);
    CHECK(nbsp["error"]["data"]["line"] == 1);
    CHECK(nbsp["error"]["data"]["column"].get<int>() >= 2);
    CHECK(nbsp["error"]["data"]["column"].get<int>() <= 8);
    CHECK_THAT(nbsp["error"]["data"]["message"].get<std::string>(), ContainsSubstring("nbsp"));
    const json declaration =
        f.ws.call("doc.fragmentFromXml", json{{"docId", doc_id},
                                              {"xml", "<?xml version=\"1.0\"?><p>x</p>"},
                                              {"parent", {{"element", "section"}}}});
    REQUIRE(declaration.contains("error"));
    CHECK(declaration["error"]["code"] == 1001);
    CHECK(declaration["error"]["data"]["line"] == 1);
    CHECK(declaration["error"]["data"]["column"].get<int>() >= 1);
    CHECK(declaration["error"]["data"]["column"].get<int>() <= 6);  // inside `<?xml `

    // Parameters: parent forms and the admissible elements.
    for (const char* bad : {"FictionBook", "description", "binary", "stylesheet", "chapter",
                            "image", "empty-line", "strong", ""}) {
        INFO(bad);
        const json r =
            f.ws.call("doc.fragmentFromXml",
                      json{{"docId", doc_id}, {"xml", "<p>x</p>"}, {"parent", {{"element", bad}}}});
        REQUIRE(r.contains("error"));
        CHECK(r["error"]["code"] == -32602);
        CHECK(r["error"]["data"]["field"] == "parent.element");
    }
    for (const char* good :
         {"body", "section", "title", "epigraph", "annotation", "history", "cite", "poem", "stanza",
          "table", "tr", "td", "th", "p", "subtitle", "text-author", "v", "date"}) {
        INFO(good);
        const json r =
            f.ws.call("doc.fragmentFromXml",
                      json{{"docId", doc_id}, {"xml", " "}, {"parent", {{"element", good}}}});
        REQUIRE(r.contains("result"));
        CHECK(r["result"]["inline"] == fb2::is_text_container(good));
    }
    const json unknown_node =
        f.ws.call("doc.fragmentFromXml",
                  json{{"docId", doc_id}, {"xml", "<p>x</p>"}, {"parent", {{"nodeId", "n999"}}}});
    REQUIRE(unknown_node.contains("error"));
    CHECK(unknown_node["error"]["data"]["field"] == "parent.nodeId");
    const std::string image_id = json_child_of_type(section, "image")["attrs"]["nodeId"];
    const json image_parent =
        f.ws.call("doc.fragmentFromXml",
                  json{{"docId", doc_id}, {"xml", "<p>x</p>"}, {"parent", {{"nodeId", image_id}}}});
    REQUIRE(image_parent.contains("error"));
    CHECK(image_parent["error"]["data"]["field"] == "parent.nodeId");
    const json both = f.ws.call(
        "doc.fragmentFromXml",
        json{{"docId", doc_id}, {"xml", "x"}, {"parent", {{"nodeId", p1_id}, {"element", "p"}}}});
    REQUIRE(both.contains("error"));
    CHECK(both["error"]["data"]["field"] == "parent");
    const json neither = f.ws.call(
        "doc.fragmentFromXml", json{{"docId", doc_id}, {"xml", "x"}, {"parent", json::object()}});
    REQUIRE(neither.contains("error"));
    CHECK(neither["error"]["data"]["field"] == "parent");
    const json no_xml =
        f.ws.call("doc.fragmentFromXml", json{{"docId", doc_id}, {"parent", {{"element", "p"}}}});
    REQUIRE(no_xml.contains("error"));
    CHECK(no_xml["error"]["data"]["field"] == "xml");
    const json huge = f.ws.call("doc.fragmentFromXml",
                                json{{"docId", doc_id},
                                     {"xml", std::string(16 * 1024 * 1024 + 1, ' ')},
                                     {"parent", {{"element", "p"}}}},
                                60000);
    REQUIRE(huge.contains("error"));
    CHECK(huge["error"]["code"] == -32602);
    CHECK(huge["error"]["data"]["field"] == "xml");
    CHECK(f.ws.call("doc.fragmentFromXml", json{{"docId", "d99"},
                                                {"xml", "x"},
                                                {"parent", {{"element", "p"}}}})["error"]["code"] ==
          1000);

    // The session's allocator was not touched: the next doc.fromXml issues the ids doc.open
    // would have issued next, so the remap of the unchanged text keeps every id.
    const std::string text =
        f.ws.call("doc.toXml", json{{"docId", doc_id}, {"document", document}})["result"]["text"];
    const json reparsed = f.ws.call("doc.fromXml", json{{"docId", doc_id}, {"text", text}});
    REQUIRE(reparsed.contains("result"));
    CHECK(reparsed["result"]["remap"]["unmappedOld"].empty());
    CHECK(reparsed["result"]["remap"]["unmappedNew"].empty());
}

TEST_CASE(
    "doc.fragmentFromXml: 1201 for a misplaced, unknown or foreign element and for text "
    "in an element-only container",
    "[fragment][server]") {
    ServerFixture f;
    auto [doc_id, document] = f.open_book();
    const auto refused = [&](const std::string& xml, const std::string& parent) {
        const json r =
            f.ws.call("doc.fragmentFromXml",
                      json{{"docId", doc_id}, {"xml", xml}, {"parent", {{"element", parent}}}});
        REQUIRE(r.contains("error"));
        CHECK(r["error"]["code"] == 1201);
        CHECK(r["error"]["message"] == "ai.fragmentNotAllowed");
        return std::make_pair(r["error"]["data"]["element"].get<std::string>(),
                              r["error"]["data"]["parent"].get<std::string>());
    };
    using Pair = std::pair<std::string, std::string>;
    CHECK(refused("<title><p>t</p></title>", "p") == Pair{"title", "p"});
    CHECK(refused("<section><p>x</p></section>", "p") == Pair{"section", "p"});
    CHECK(refused("<chapter/>", "section") == Pair{"chapter", "section"});
    CHECK(refused("<x:foo xmlns:x=\"urn:x\"/>", "section") == Pair{"{urn:x}foo", "section"});
    CHECK(refused("text", "section") == Pair{"#text", "section"});
    CHECK(refused("<body><section/></body>", "section") == Pair{"body", "section"});
    CHECK(refused("<FictionBook/>", "body") == Pair{"FictionBook", "body"});
    // Admitted: a title after paragraphs (order is the validity hook's).
    const json late_title =
        f.ws.call("doc.fragmentFromXml", json{{"docId", doc_id},
                                              {"xml", "<p>a</p><title><p>t</p></title>"},
                                              {"parent", {{"element", "section"}}}});
    REQUIRE(late_title.contains("result"));
    CHECK(late_title["result"]["nodes"].size() == 2);
    // The round trip over the wire: toXml -> fromXml equals the nodes modulo ids (the section
    // without its unknown block, which the fragment reader refuses).
    const json& section = document["bodies"][0]["content"][1];
    const std::vector<model::Node> known_nodes = known_only(model::node_from_json(section).content);
    REQUIRE(known_nodes.size() == section["content"].size() - 1);
    json known = json::array();
    for (const model::Node& node : known_nodes) {
        known.push_back(model::to_json(node));
    }
    const std::string xml =
        f.ws.call("doc.fragmentToXml", json{{"docId", doc_id}, {"nodes", known}})["result"]["xml"];
    const std::string whole =
        f.ws.call("doc.fragmentToXml",
                  json{{"docId", doc_id}, {"nodes", section["content"]}})["result"]["xml"];
    CHECK(refused(whole, "section") == Pair{"foo", "p"});
    const json back =
        f.ws.call("doc.fragmentFromXml",
                  json{{"docId", doc_id}, {"xml", xml}, {"parent", {{"element", "section"}}}});
    REQUIRE(back.contains("result"));
    const std::vector<model::Node> expected = strip_ids(known_nodes);
    std::vector<model::Node> got;
    for (const json& node : back["result"]["nodes"]) {
        got.push_back(model::node_from_json(node));
    }
    CHECK(got == expected);
    CHECK(f.ws.call("doc.fragmentToXml",
                    json{{"docId", doc_id}, {"nodes", back["result"]["nodes"]}})["result"]["xml"] ==
          xml);
}
