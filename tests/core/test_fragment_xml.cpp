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

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
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
