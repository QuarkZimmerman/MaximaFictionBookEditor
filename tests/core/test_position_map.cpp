// Feature 004 US7 (T055): the position map recorded by the writer (`doc.toXml({positions:
// true})`) and the reader (`doc.fromXml({text, positions: true})`), the inline scanner's
// round-trip property, the `doc.mapPositions` rules of rpc-api.md §3.2 (research R2.2), the
// serial / 1005 handling, the map's lifetime in the document session and the `doc.toXml`
// snapshot refresh (requester decision 2026-10-20, research R2.1).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/position_map.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <memory>
#include <string>
#include <utility>
#include <vector>

using namespace mfbe;
using nlohmann::json;

namespace mfbe::fb2 {
// Catch2 prints a point as `{nodeId, offset}` in a failed comparison.
std::ostream& operator<<(std::ostream& os, const ModelPoint& point) {
    return os << "{" << point.nodeId << ", " << point.offset << "}";
}
}  // namespace mfbe::fb2

namespace {

/* ----------------------------------------------------------------------------------------- */
/* Helpers                                                                                   */
/* ----------------------------------------------------------------------------------------- */

constexpr const char* kProlog =
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
    "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
    "xmlns:l=\"http://www.w3.org/1999/xlink\">\n";

constexpr const char* kDescription =
    "\t<description>\n"
    "\t\t<title-info>\n"
    "\t\t\t<genre>sf</genre>\n"
    "\t\t\t<author><nickname>t</nickname></author>\n"
    "\t\t\t<book-title>Rules</book-title>\n"
    "\t\t\t<annotation>\n"
    "\t\t\t\t<p>Anno one</p>\n"
    "\t\t\t\t<p>Anno two</p>\n"
    "\t\t\t</annotation>\n"
    "\t\t\t<lang>en</lang>\n"
    "\t\t</title-info>\n"
    "\t\t<src-title-info>\n"
    "\t\t\t<genre>sf</genre>\n"
    "\t\t\t<author><nickname>s</nickname></author>\n"
    "\t\t\t<book-title>Src</book-title>\n"
    "\t\t\t<annotation><p>Src anno</p></annotation>\n"
    "\t\t\t<lang>en</lang>\n"
    "\t\t</src-title-info>\n"
    "\t\t<document-info>\n"
    "\t\t\t<author><nickname>t</nickname></author>\n"
    "\t\t\t<date>2026</date>\n"
    "\t\t\t<id>rules</id>\n"
    "\t\t\t<version>1.0</version>\n"
    "\t\t\t<history><p>Hist one</p></history>\n"
    "\t\t</document-info>\n"
    "\t</description>\n";

// The book the `doc.mapPositions` rules are checked on: every rule of R2.2 has a place here.
const std::string kRulesText =
    std::string(kProlog) + kDescription +
    "\t<!-- top comment -->\n"
    "\t<body>\n"
    "\t\t<title>\n"
    "\t\t\t<p>Title text</p>\n"
    "\t\t</title>\n"
    "\t\t<section>\n"
    "\t\t\t<p>First &amp; para</p>\n"
    "\t\t\t<empty-line/>\n"
    "\t\t\t<image l:href=\"#pic\"/>\n"
    "\t\t\t<p>Second <strong>bold</strong> para</p>\n"
    "\t\t</section>\n"
    "\t\t<section/>\n"
    "\t</body>\n"
    "\t<body name=\"notes\">\n"
    "\t\t<section>\n"
    "\t\t\t<p>Note one</p>\n"
    "\t\t</section>\n"
    "\t</body>\n"
    "\t<binary id=\"pic\" content-type=\"image/png\">iVBORw0KGgo=</binary>\n"
    "</FictionBook>\n";

// Paragraphs for the scanner's round-trip property: entities, a numeric reference, nested
// marks, an inline image, CDATA, a comment, CRLF and an astral character.
const std::string kScannerText =
    std::string(kProlog) + kDescription +
    "\t<body>\n"
    "\t\t<section>\n"
    "\t\t\t<p>Tom &amp; Jerry &#x1F600; smile &lt;x&gt; &quot;q&quot; &apos;a&apos; &#65;</p>\n"
    "\t\t\t<p><strong>bold <emphasis>and italic</emphasis></strong> plain <a l:href=\"#n\" "
    "type=\"note\">[1]</a> <style name=\"s\">st</style> <sub>2</sub><sup>3</sup><code>c</code>"
    "<strikethrough>s</strikethrough></p>\n"
    "\t\t\t<p>Image <image l:href=\"#pic\" alt=\"a&amp;b\"/> inside, <!-- a <comment> --> after "
    "<?pi data?> tail</p>\n"
    "\t\t\t<p><![CDATA[literal <b>&amp;</b> text]]> tail</p>\n"
    "\t\t\t<p>line one\r\nline two \xF0\x9F\x98\x80 astral \xD0\xB6 cyrillic</p>\n"
    "\t\t\t<p>Unknown <foo:bar xmlns:foo=\"urn:x\" a=\"1>2\">deep <baz/> text</foo:bar> end "
    "<empty-line/> z</p>\n"
    "\t\t\t<poem><stanza><v>verse</v></stanza><date value=\"1900-01-01\">in <!-- c --> "
    "<x>19</x>00</date></poem>\n"
    "\t\t</section>\n"
    "\t</body>\n"
    "</FictionBook>\n";

std::size_t pos_of(const std::string& text, const std::string& needle, std::size_t from = 0) {
    const auto p = text.find(needle, from);
    REQUIRE(p != std::string::npos);
    return p;
}

// Offset of `needle` counted in UTF-16 units (the texts here are ASCII up to the needle unless
// stated otherwise, but the helper is exact either way).
std::size_t units_at(const std::string& text, const std::string& needle, std::size_t skip = 0) {
    return fb2::utf16_length(std::string_view(text).substr(0, pos_of(text, needle) + skip));
}

struct Parsed {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadResult result;
};

std::unique_ptr<Parsed> parse_with_positions(const std::string& text) {
    auto p = std::make_unique<Parsed>();
    fb2::ReadOptions options;
    options.force_encoding = "utf-8";
    options.compute_schema_hint = false;
    options.record_positions = true;
    p->result = fb2::read_bytes(text, p->store, p->ids, options);
    REQUIRE(p->result.positions.has_value());
    p->result.positions->text = text;
    return p;
}

// Model size of a text container's inline content (UTF-16 units of text plus 1 per atom).
std::size_t model_size(const model::Node& node) {
    std::size_t size = 0;
    for (const auto& child : node.content) {
        size += child.is_text() ? fb2::utf16_length(child.text) : 1;
    }
    return size;
}

// The model offsets a caret can take in a text container: every character and atom boundary
// (never between the two UTF-16 units of an astral character).
std::vector<std::size_t> caret_offsets(const model::Node& node) {
    std::vector<std::size_t> offsets{0};
    std::size_t at = 0;
    for (const auto& child : node.content) {
        if (!child.is_text()) {
            offsets.push_back(++at);
            continue;
        }
        for (std::size_t i = 0; i < child.text.size();) {
            const auto lead = static_cast<unsigned char>(child.text[i]);
            const std::size_t bytes = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
            at += lead >= 0xF0 ? 2 : 1;
            offsets.push_back(at);
            i += bytes;
        }
    }
    return offsets;
}

const model::Node& paragraph(const model::Document& doc, std::size_t index) {
    return doc.bodies.at(0).content.at(0).content.at(index);
}

const char* kind_name(fb2::PositionKind kind) {
    switch (kind) {
        case fb2::PositionKind::text:
            return "text";
        case fb2::PositionKind::date:
            return "date";
        case fb2::PositionKind::inlineAtom:
            return "inlineAtom";
        case fb2::PositionKind::blockAtom:
            return "blockAtom";
        case fb2::PositionKind::container:
            return "container";
    }
    return "?";
}

/* ---- server fixture --------------------------------------------------------------------- */

struct ServerFixture {
    test::TempDir data{"mfbe-positions"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    ServerFixture() {
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    json result_of(const std::string& method, const json& params) {
        json response = ws.call(method, params, 20000);
        INFO(method << " -> " << response.dump());
        REQUIRE(response.contains("result"));
        return response["result"];
    }

    json error_of(const std::string& method, const json& params) {
        json response = ws.call(method, params, 20000);
        INFO(method << " -> " << response.dump());
        REQUIRE(response.contains("error"));
        return response["error"];
    }

    // Calls a MaybeJob method: the direct result or the job's.
    json run_job(const std::string& method, const json& params) {
        json response = ws.call(method, params, 20000);
        REQUIRE(response.contains("result"));
        const json& result = response["result"];
        if (!result.is_object() || !result.contains("jobId")) {
            return result;
        }
        const std::string job_id = result["jobId"];
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
        while (std::chrono::steady_clock::now() < deadline) {
            auto msg = ws.receive_json(60000);
            REQUIRE(msg);
            const std::string name = msg->value("method", "");
            if ((name == "job.done" || name == "job.failed") &&
                (*msg)["params"]["jobId"] == job_id) {
                REQUIRE(name == "job.done");
                return (*msg)["params"]["result"];
            }
            ws.inbox.push_back(*msg);
        }
        throw std::runtime_error("job did not finish: " + job_id);
    }

    // doc.new, then the rules text parsed into it with positions; returns {docId, document,
    // serial}.
    struct Loaded {
        std::string doc_id;
        json document;
        std::uint64_t serial = 0;
    };
    Loaded load_text(const std::string& text) {
        Loaded l;
        l.doc_id = result_of("doc.new", json::object())["docId"];
        const json parsed = result_of(
            "doc.fromXml", json{{"docId", l.doc_id}, {"text", text}, {"positions", true}});
        l.document = parsed["document"];
        REQUIRE(parsed["serial"].is_number_integer());
        l.serial = parsed["serial"].get<std::uint64_t>();
        return l;
    }

    json to_model(const Loaded& l, std::vector<std::size_t> offsets) {
        return result_of(
            "doc.mapPositions",
            json{{"docId", l.doc_id}, {"serial", l.serial}, {"toModel", offsets}})["toModel"];
    }

    json to_source(const Loaded& l, json points) {
        return result_of("doc.mapPositions", json{{"docId", l.doc_id},
                                                  {"serial", l.serial},
                                                  {"toSource", std::move(points)}})["toSource"];
    }
};

std::string id_of(const json& node) {
    return node["attrs"]["nodeId"].get<std::string>();
}

const json& child(const json& node, std::size_t index) {
    return node["content"].at(index);
}

json point(const std::string& id, std::size_t offset) {
    return json{{"nodeId", id}, {"offset", offset}};
}

// Every nodeId of the mapped roots of a document JSON in pre-order (bodies, then the
// title-info / src-title-info annotations, then the history), as `visit_nodes` orders them.
void collect_ids(const json& node, std::vector<std::string>& out) {
    if (!node.is_object() || node.value("type", "") == "text") {
        return;
    }
    if (node.contains("attrs") && node["attrs"].contains("nodeId")) {
        out.push_back(id_of(node));
    }
    if (node.contains("content")) {
        for (const auto& c : node["content"]) {
            collect_ids(c, out);
        }
    }
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Writer and reader record the same map                                                     */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("position map: the writer's map of a book equals the reader's map of its text",
          "[positions]") {
    // modern-utf8.fb2 has an annotation, a history, a notes body, a poem with a date, a table,
    // a cite, inline and block images, empty lines and unknown elements.
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const fb2::ReadResult book =
        fb2::read_file(test::fixtures_dir() / "books" / "modern-utf8.fb2", store, ids);
    fb2::WriteOptions options;
    options.elide_binaries = true;
    options.positions = true;
    fb2::WriteResult written = fb2::write_document(book.document, &store, options);
    REQUIRE(written.positions.has_value());
    const fb2::PositionMap& writer_map = *written.positions;
    REQUIRE_FALSE(writer_map.entries.empty());
    CHECK(writer_map.length16 == fb2::utf16_length(written.text));

    auto parsed = parse_with_positions(written.text);
    const fb2::PositionMap& reader_map = *parsed->result.positions;
    REQUIRE(reader_map.entries.size() == writer_map.entries.size());
    CHECK(reader_map.length16 == writer_map.length16);
    CHECK(reader_map.prefix == 0);

    // Pre-order: tagBegin never decreases; the ids are the written document's in that order.
    std::vector<std::string> written_ids;
    for (const auto& body : book.document.bodies) {
        collect_ids(model::to_json(body), written_ids);
    }
    if (book.document.description.titleInfo.annotation) {
        collect_ids(model::to_json(*book.document.description.titleInfo.annotation), written_ids);
    }
    if (book.document.description.documentInfo.history) {
        collect_ids(model::to_json(*book.document.description.documentInfo.history), written_ids);
    }
    std::vector<std::string> map_ids;
    for (const auto& e : writer_map.entries) {
        map_ids.push_back(e.nodeId);
    }
    std::sort(written_ids.begin(), written_ids.end());
    std::sort(map_ids.begin(), map_ids.end());
    CHECK(map_ids == written_ids);

    bool saw_empty_element = false;
    bool saw_annotation = false;
    bool saw_history = false;
    for (std::size_t i = 0; i < writer_map.entries.size(); ++i) {
        const fb2::PositionEntry& w = writer_map.entries[i];
        const fb2::PositionEntry& r = reader_map.entries[i];
        INFO("entry " << i << " (" << w.nodeId << " / " << r.nodeId << ", " << kind_name(w.kind)
                      << " / " << kind_name(r.kind) << ") at " << w.tagBegin << " / "
                      << r.tagBegin);
        CHECK(w.kind == r.kind);
        CHECK(w.tagBegin == r.tagBegin);
        CHECK(w.contentBegin == r.contentBegin);
        CHECK(w.contentEnd == r.contentEnd);
        CHECK(w.end == r.end);
        CHECK(w.tagBegin16 == r.tagBegin16);
        CHECK(w.parent == r.parent);
        CHECK(written.text[w.tagBegin] == '<');
        CHECK(w.end <= written.text.size());
        CHECK(written.text[w.end - 1] == '>');
        if (i > 0) {
            CHECK(w.tagBegin >= writer_map.entries[i - 1].tagBegin);
        }
        if (w.parent >= 0) {
            CHECK(static_cast<std::size_t>(w.parent) < i);
            CHECK(writer_map.entries[static_cast<std::size_t>(w.parent)].end >= w.end);
        }
        if (w.contentBegin == w.contentEnd && w.end == w.contentEnd) {
            saw_empty_element = true;  // <x/>: contentBegin == contentEnd (== end)
        } else {
            CHECK(written.text[w.contentBegin - 1] == '>');
            CHECK(written.text[w.contentEnd] == '<');
        }
        CHECK(reader_map.byId.at(r.nodeId) == i);
        CHECK(writer_map.byId.at(w.nodeId) == i);
        const std::string_view tag(written.text.data() + w.tagBegin, 12);
        if (tag.rfind("<annotation", 0) == 0 && w.parent == -1) {
            saw_annotation = true;
        }
        if (tag.rfind("<history", 0) == 0) {
            saw_history = true;
        }
    }
    CHECK(saw_empty_element);
    CHECK(saw_annotation);
    CHECK(saw_history);
    // The UTF-16 offsets are what a JavaScript string would count.
    const fb2::PositionEntry& last = writer_map.entries.back();
    CHECK(last.tagBegin16 ==
          fb2::utf16_length(std::string_view(written.text).substr(0, last.tagBegin)));
}

TEST_CASE("position map: a present-but-empty element is recorded as <x/>", "[positions]") {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const fb2::ReadResult book =
        fb2::read_file(test::fixtures_dir() / "books" / "empty-annotation-history.fb2", store, ids);
    fb2::WriteOptions options;
    options.positions = true;
    const fb2::WriteResult written = fb2::write_document(book.document, &store, options);
    REQUIRE(written.positions);
    const fb2::PositionEntry* annotation =
        written.positions->find(book.document.description.titleInfo.annotation->node_id());
    REQUIRE(annotation != nullptr);
    CHECK(annotation->kind == fb2::PositionKind::container);
    CHECK(written.text.substr(annotation->tagBegin, 13) == "<annotation/>");
    CHECK(annotation->contentBegin == annotation->contentEnd);
    CHECK(annotation->contentEnd == annotation->end);
    CHECK(annotation->parent == -1);
    const fb2::PositionEntry* history =
        written.positions->find(book.document.description.documentInfo.history->node_id());
    REQUIRE(history != nullptr);
    const std::string history_tag = "<history xml:lang=\"ru\"/>";
    CHECK(written.text.substr(history->tagBegin, history_tag.size()) == history_tag);
    CHECK(history->contentBegin == history->end);
}

/* ----------------------------------------------------------------------------------------- */
/* The inline scanner                                                                        */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("position map: toModel(toSource(p)) == p for every text position of a paragraph",
          "[positions]") {
    auto parsed = parse_with_positions(kScannerText);
    const fb2::PositionMap& map = *parsed->result.positions;
    const model::Document& doc = parsed->result.document;
    const std::vector<std::size_t> expected_sizes = {
        fb2::utf16_length("Tom & Jerry \xF0\x9F\x98\x80 smile <x> \"q\" 'a' A"),
        fb2::utf16_length("bold and italic plain [1] st 23cs"),
        fb2::utf16_length("Image ") + 1 + fb2::utf16_length(" inside, ") + 1 +
            fb2::utf16_length(" after ") + 1 + fb2::utf16_length(" tail"),
        fb2::utf16_length("literal <b>&amp;</b> text tail"),
        fb2::utf16_length("line one\nline two \xF0\x9F\x98\x80 astral \xD0\xB6 cyrillic"),
        fb2::utf16_length("Unknown ") + 1 + fb2::utf16_length(" end ") + 1 +
            fb2::utf16_length(" z"),
    };
    for (std::size_t i = 0; i < expected_sizes.size(); ++i) {
        const model::Node& p = paragraph(doc, i);
        INFO("paragraph " << i << " " << p.node_id());
        REQUIRE(p.type == "p");
        CHECK(model_size(p) == expected_sizes[i]);
        const fb2::PositionEntry* entry = map.find(p.node_id());
        REQUIRE(entry != nullptr);
        CHECK(entry->kind == fb2::PositionKind::text);
        CHECK(fb2::inline_content_length(map.text, entry->contentBegin, entry->contentEnd,
                                         entry->kind) == expected_sizes[i]);
        std::size_t previous = 0;
        const std::vector<std::size_t> offsets = caret_offsets(p);
        CHECK(offsets.back() == expected_sizes[i]);
        for (const std::size_t offset : offsets) {
            INFO("offset " << offset);
            const auto source = fb2::resolve_to_source(map, {p.node_id(), offset});
            REQUIRE(source);
            CHECK(*source >= entry->tagBegin16);
            if (offset > 0) {
                CHECK(*source > previous);
            }
            previous = *source;
            const auto back = fb2::resolve_to_model(map, *source);
            REQUIRE(back);
            CHECK(back->nodeId == p.node_id());
            CHECK(back->offset == offset);
        }
        // Beyond the content: clamped to the position before the end tag, which maps back to
        // the content's length.
        const auto clamped = fb2::resolve_to_source(map, {p.node_id(), expected_sizes[i] + 50});
        REQUIRE(clamped);
        CHECK(*clamped ==
              entry->tagBegin16 + fb2::utf16_length(std::string_view(map.text).substr(
                                      entry->tagBegin, entry->contentEnd - entry->tagBegin)));
        CHECK(fb2::resolve_to_model(map, *clamped) ==
              fb2::ModelPoint{p.node_id(), expected_sizes[i]});
    }

    // Offset 0 is the position after the start tag, before any markup.
    const model::Node& marked = paragraph(doc, 1);
    const fb2::PositionEntry* marked_entry = map.find(marked.node_id());
    const std::size_t content_begin16 = units_at(map.text, "<p><strong>bold", 3);
    CHECK(fb2::resolve_to_source(map, {marked.node_id(), 0}) == content_begin16);
    CHECK(marked_entry->contentBegin == pos_of(map.text, "<p><strong>bold") + 3);
    // "bold " (5 units) ends before <emphasis>: the answer lies before that markup.
    CHECK(fb2::resolve_to_source(map, {marked.node_id(), 5}) == units_at(map.text, "<emphasis>"));
    // ... and a caret inside the <emphasis> tag lands where the emphasised text starts.
    CHECK(fb2::resolve_to_model(map, units_at(map.text, "<emphasis>", 4)) ==
          fb2::ModelPoint{marked.node_id(), 5});
    // An entity counts as its one character: the caret inside `&amp;` lies before it.
    const model::Node& first = paragraph(doc, 0);
    CHECK(fb2::resolve_to_model(map, units_at(map.text, "&amp; Jerry", 2)) ==
          fb2::ModelPoint{first.node_id(), 4});
    CHECK(fb2::resolve_to_source(map, {first.node_id(), 5}) ==
          units_at(map.text, "&amp; Jerry", 5));
    // The second UTF-16 unit of an astral character counts as before it.
    const std::size_t astral16 = units_at(map.text, "&#x1F600;", 0);
    CHECK(fb2::resolve_to_source(map, {first.node_id(), 12}) == astral16);
    CHECK(fb2::resolve_to_source(map, {first.node_id(), 14}) == astral16 + 9);
    CHECK(fb2::resolve_to_model(map, astral16 + 4) == fb2::ModelPoint{first.node_id(), 12});
    // The inline image is one unit: its tag maps to the position before it.
    const model::Node& with_image = paragraph(doc, 2);
    const std::size_t image16 = units_at(map.text, "<image l:href=\"#pic\" alt");
    CHECK(fb2::resolve_to_model(map, image16 + 7) == fb2::ModelPoint{with_image.node_id(), 6});
    CHECK(fb2::resolve_to_source(map, {with_image.node_id(), 6}) == image16);
    const model::Node& image_node = with_image.content.at(1);
    REQUIRE(image_node.type == "inline-image");
    const fb2::PositionEntry* image_entry = map.find(image_node.node_id());
    REQUIRE(image_entry != nullptr);
    CHECK(image_entry->kind == fb2::PositionKind::inlineAtom);
    CHECK(image_entry->parent == static_cast<int>(map.byId.at(with_image.node_id())));
    CHECK(fb2::resolve_to_source(map, {image_node.node_id(), 3}) == image16);
    // A literal astral character (4 bytes, 2 units) in the middle of a paragraph.
    const model::Node& crlf = paragraph(doc, 4);
    const std::size_t smile16 = units_at(map.text, "\xF0\x9F\x98\x80 astral");
    CHECK(fb2::resolve_to_model(map, smile16 + 1) ==
          fb2::ModelPoint{crlf.node_id(), fb2::utf16_length("line one\nline two ")});
    // CRLF is one model unit (libxml2 normalises it); a caret between the two bytes lies before.
    const std::size_t crlf16 = units_at(map.text, "\r\nline two");
    CHECK(fb2::resolve_to_model(map, crlf16 + 1) == fb2::ModelPoint{crlf.node_id(), 8});
    CHECK(fb2::resolve_to_model(map, crlf16 + 2) == fb2::ModelPoint{crlf.node_id(), 9});
    // Inside `date` every element is transparent and comments count nothing.
    const model::Node& poem = paragraph(doc, 6);
    REQUIRE(poem.type == "poem");
    const model::Node& date = poem.content.at(1);
    REQUIRE(date.type == "date");
    const fb2::PositionEntry* date_entry = map.find(date.node_id());
    REQUIRE(date_entry != nullptr);
    CHECK(date_entry->kind == fb2::PositionKind::date);
    CHECK(model_size(date) == fb2::utf16_length("in  1900"));
    CHECK(fb2::inline_content_length(map.text, date_entry->contentBegin, date_entry->contentEnd,
                                     date_entry->kind) == model_size(date));
    for (std::size_t offset = 0; offset <= model_size(date); ++offset) {
        INFO("date offset " << offset);
        const auto source = fb2::resolve_to_source(map, {date.node_id(), offset});
        REQUIRE(source);
        CHECK(fb2::resolve_to_model(map, *source) == fb2::ModelPoint{date.node_id(), offset});
    }
}

TEST_CASE("position map: a text with a BOM keeps the prefix in its offsets", "[positions]") {
    const std::string text = "\xEF\xBB\xBF" + kRulesText;
    auto parsed = parse_with_positions(text);
    const fb2::PositionMap& map = *parsed->result.positions;
    CHECK(map.prefix == 3);
    CHECK(parsed->result.bom);
    CHECK(map.length16 == fb2::utf16_length(text));
    // body[1]/section[1]/p[1] ("First &amp; para"): the body's first child is its title.
    const model::Node& first = parsed->result.document.bodies.at(0).content.at(1).content.at(0);
    REQUIRE(first.type == "p");
    const fb2::PositionEntry* entry = map.find(first.node_id());
    REQUIRE(entry != nullptr);
    CHECK(entry->tagBegin == pos_of(text, "<p>First"));
    CHECK(text[entry->tagBegin] == '<');
    CHECK(entry->tagBegin16 == units_at(text, "<p>First"));  // the BOM is one unit
    CHECK(fb2::resolve_to_source(map, {first.node_id(), 0}) == units_at(text, "<p>First", 3));
    CHECK(fb2::resolve_to_model(map, units_at(text, "First &amp;", 5)) ==
          fb2::ModelPoint{first.node_id(), 5});
    // The BOM itself is outside every node.
    CHECK_FALSE(fb2::resolve_to_model(map, 0));
    CHECK_FALSE(fb2::resolve_to_model(map, 1));
}

/* ----------------------------------------------------------------------------------------- */
/* doc.mapPositions                                                                          */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("doc.mapPositions: the Source -> Body rules", "[server][positions]") {
    ServerFixture f;
    const auto l = f.load_text(kRulesText);
    const std::string& text = kRulesText;
    const json& body1 = l.document["bodies"][0];
    const json& body2 = l.document["bodies"][1];
    const json& title_p = child(child(body1, 0), 0);
    const json& section1 = child(body1, 1);
    const json& section2 = child(body1, 2);
    const json& p1 = child(section1, 0);
    const json& empty_line = child(section1, 1);
    const json& image = child(section1, 2);
    const json& p2 = child(section1, 3);
    const json& note_p = child(child(body2, 0), 0);
    const json& annotation = l.document["description"]["titleInfo"]["annotation"];
    const json& anno_p2 = child(annotation, 1);
    const json& src_p = child(l.document["description"]["srcTitleInfo"]["annotation"], 0);
    const json& hist_p = child(l.document["description"]["documentInfo"]["history"], 0);
    REQUIRE(empty_line["type"] == "empty-line");
    REQUIRE(image["type"] == "image");
    REQUIRE(section2["type"] == "section");

    const auto u = [&](const char* needle, std::size_t skip = 0) {
        return units_at(text, needle, skip);
    };
    const std::vector<std::pair<std::size_t, json>> cases = {
        // inside a start tag -> {N, 0}; inside an end tag -> {N, length}
        {u("<p>First", 1), point(id_of(p1), 0)},
        {u("</p>\n\t\t\t<empty-line/>", 2), point(id_of(p1), 12)},
        // inside an entity: the count before it; after it: the entity counted as one
        {u("&amp; para", 2), point(id_of(p1), 6)},
        {u("&amp; para", 5), point(id_of(p1), 7)},
        // inside a mark's start tag: where the marked text starts
        {u("<strong>bold", 3), point(id_of(p2), 7)},
        {u("<strong>bold", 10), point(id_of(p2), 9)},
        // a container's end tag -> the end of its last text container
        {u("</section>"), point(id_of(p2), 16)},
        {u("</body>"), point(id_of(p2), 16)},
        // whitespace between children -> {next child, 0}; after the last child -> its end
        {u("\t\t\t<image", 1), point(id_of(image), 0)},
        {u("\t\t</section>", 1), point(id_of(p2), 16)},
        {u("\t\t\t<p>First", 0), point(id_of(p1), 0)},
        // block atoms -> {N, 0}
        {u("<image l:href", 8), point(id_of(image), 0)},
        {u("<empty-line/>", 5), point(id_of(empty_line), 0)},
        // an empty container's tag -> {N, 0}; a container's start tag -> {N, 0}
        {u("<section/>", 4), point(id_of(section2), 0)},
        {u("<body>", 2), point(id_of(body1), 0)},
        {u("<title>", 3), point(id_of(child(body1, 0)), 0)},
        {u("Title text", 5), point(id_of(title_p), 5)},
        // the second body and the description blocks map like any node
        {u("Note one", 4), point(id_of(note_p), 4)},
        {u("<annotation>", 5), point(id_of(annotation), 0)},
        {u("\t\t\t\t<p>Anno two", 2), point(id_of(anno_p2), 0)},
        {u("Anno two", 8), point(id_of(anno_p2), 8)},
        {u("Src anno", 3), point(id_of(src_p), 3)},
        {u("Hist one", 2), point(id_of(hist_p), 2)},
        // nothing maps: the prolog, description elements, the top comment, top-level
        // whitespace (between the bodies included), <binary>, the end of the text
        {0, nullptr},
        {u("<?xml", 3), nullptr},
        {u("<book-title>Rules", 14), nullptr},
        {u("<!-- top comment -->", 6), nullptr},
        {u("\t<body>", 0), nullptr},
        {u("\t<body name=\"notes\">", 0), nullptr},
        {u("iVBORw0KGgo=", 3), nullptr},
        {u("</FictionBook>", 3), nullptr},
        {fb2::utf16_length(text), nullptr},
    };
    std::vector<std::size_t> offsets;
    for (const auto& [offset, expected] : cases) {
        offsets.push_back(offset);
    }
    const json answers = f.to_model(l, offsets);
    REQUIRE(answers.size() == cases.size());
    for (std::size_t i = 0; i < cases.size(); ++i) {
        INFO("case " << i << " at UTF-16 offset " << cases[i].first);
        CHECK(answers[i] == cases[i].second);
    }
}

TEST_CASE("doc.mapPositions: the Body -> Source rules", "[server][positions]") {
    ServerFixture f;
    const auto l = f.load_text(kRulesText);
    const std::string& text = kRulesText;
    const json& body1 = l.document["bodies"][0];
    const json& body2 = l.document["bodies"][1];
    const json& section1 = child(body1, 1);
    const json& p1 = child(section1, 0);
    const json& image = child(section1, 2);
    const json& p2 = child(section1, 3);
    const json& section2 = child(body1, 2);
    const json& annotation = l.document["description"]["titleInfo"]["annotation"];
    const json& hist_p = child(l.document["description"]["documentInfo"]["history"], 0);
    const auto u = [&](const char* needle, std::size_t skip = 0) {
        return units_at(text, needle, skip);
    };
    const json answers = f.to_source(
        l, json::array({point(id_of(p1), 0), point(id_of(p1), 6), point(id_of(p1), 7),
                        point(id_of(p1), 100), point(id_of(p2), 7), point(id_of(p2), 8),
                        point(id_of(p2), 11), point(id_of(image), 5), point(id_of(section2), 0),
                        point(id_of(annotation), 0), point(id_of(body2), 0),
                        point(id_of(hist_p), 4), point("nope", 0), point(id_of(section1), 3)}));
    const json expected = json::array({
        u("<p>First", 3),                // offset 0 -> after the start tag
        u("&amp; para"),                 // before the entity
        u("&amp; para", 5),              // after the entity: one character
        u("</p>\n\t\t\t<empty-line/>"),  // clamped to the position before the end tag
        u("<strong>bold"),               // before the markup that follows
        u("<strong>bold", 9),            // after "b"
        u("</strong> para"),             // after "bold", before the closing tag
        u("<image l:href"),              // a block atom: its start tag
        u("<section/>"),                 // an empty container: its tag
        u("<annotation>"),               // the annotation node
        u("<body name=\"notes\">"),      // the notes body
        u("Hist one", 4),                // the history paragraph
        nullptr,                         // unknown nodeId
        u("<section>\n\t\t\t<p>First"),  // a container: its start tag, offset ignored
    });
    REQUIRE(answers.size() == expected.size());
    for (std::size_t i = 0; i < expected.size(); ++i) {
        INFO("case " << i);
        CHECK(answers[i] == expected[i]);
    }
}

TEST_CASE("doc.mapPositions: toXml and fromXml maps agree, serials increase, 1005 when stale",
          "[server][positions]") {
    ServerFixture f;
    const json created = f.result_of("doc.new", json::object());
    const std::string doc_id = created["docId"];

    // A toXml without the flag records nothing: no serial, and nothing to map against.
    const json plain = f.result_of("doc.toXml", json{{"docId", doc_id}, {"document", created}});
    CHECK_FALSE(plain.contains("serial"));
    json stale = f.error_of("doc.mapPositions",
                            json{{"docId", doc_id}, {"serial", 1}, {"toModel", json::array({0})}});
    CHECK(stale["code"] == 1005);
    CHECK(stale["message"] == "doc.positionsStale");
    CHECK(stale["data"] == json{{"docId", doc_id}, {"serial", 1}});

    const json written = f.result_of("doc.toXml", json{{"docId", doc_id},
                                                       {"document", created},
                                                       {"elideBinaries", true},
                                                       {"positions", true}});
    REQUIRE(written["serial"] == 1);
    const std::string text = written["text"];
    const json parsed =
        f.result_of("doc.fromXml", json{{"docId", doc_id}, {"text", text}, {"positions", true}});
    REQUIRE(parsed["serial"] == 2);

    // The serial of the toXml map is stale now ...
    stale = f.error_of("doc.mapPositions",
                       json{{"docId", doc_id}, {"serial", 1}, {"toModel", json::array({0})}});
    CHECK(stale["code"] == 1005);
    CHECK(stale["data"]["serial"] == 1);
    // ... and the current one answers; durationMs is reported.
    // The body's paragraph of the blank template (the annotation's comes first in the text);
    // one Cyrillic letter (two bytes) into its text.
    const json mapped = f.result_of(
        "doc.mapPositions",
        json{{"docId", doc_id},
             {"serial", 2},
             {"toModel",
              json::array({units_at(text, "<p>\xD0\xA7\xD1\x82\xD0\xBE\xD0\xB1\xD1\x8B", 5)})}});
    CHECK(mapped["durationMs"].is_number());
    CHECK(mapped["toSource"] == json::array());
    const json& new_p = child(child(parsed["document"]["bodies"][0], 0), 0);
    REQUIRE(new_p["type"] == "p");
    CHECK(mapped["toModel"][0] == point(id_of(new_p), 1));

    // Both maps describe the same text: the old ids through the toXml map (recorded again)
    // and the new ids through the fromXml map resolve to the same source offsets.
    const json again = f.result_of("doc.toXml", json{{"docId", doc_id},
                                                     {"document", created},
                                                     {"elideBinaries", true},
                                                     {"positions", true}});
    REQUIRE(again["serial"] == 3);
    REQUIRE(again["text"] == text);
    std::vector<std::string> old_ids;
    std::vector<std::string> new_ids;
    collect_ids(created["bodies"][0], old_ids);
    collect_ids(parsed["document"]["bodies"][0], new_ids);
    collect_ids(created["description"]["titleInfo"]["annotation"], old_ids);
    collect_ids(parsed["document"]["description"]["titleInfo"]["annotation"], new_ids);
    collect_ids(created["description"]["documentInfo"]["history"], old_ids);
    collect_ids(parsed["document"]["description"]["documentInfo"]["history"], new_ids);
    REQUIRE(old_ids.size() == new_ids.size());
    REQUIRE(old_ids.size() >= 6);
    json old_points = json::array();
    for (const auto& id : old_ids) {
        old_points.push_back(point(id, 3));
    }
    const json via_writer = f.result_of(
        "doc.mapPositions", json{{"docId", doc_id}, {"serial", 3}, {"toSource", old_points}});
    // The fromXml map is gone (superseded); re-record it to compare.
    const json reparsed =
        f.result_of("doc.fromXml", json{{"docId", doc_id}, {"text", text}, {"positions", true}});
    REQUIRE(reparsed["serial"] == 4);
    new_ids.clear();
    collect_ids(reparsed["document"]["bodies"][0], new_ids);
    collect_ids(reparsed["document"]["description"]["titleInfo"]["annotation"], new_ids);
    collect_ids(reparsed["document"]["description"]["documentInfo"]["history"], new_ids);
    json new_points = json::array();
    for (const auto& id : new_ids) {
        new_points.push_back(point(id, 3));
    }
    const json via_reader = f.result_of(
        "doc.mapPositions", json{{"docId", doc_id}, {"serial", 4}, {"toSource", new_points}});
    CHECK(via_writer["toSource"] == via_reader["toSource"]);
    for (const auto& offset : via_writer["toSource"]) {
        CHECK(offset.is_number_integer());
    }

    // Parameter validation.
    const auto invalid = [&](json params) {
        params["docId"] = doc_id;
        const json error = f.error_of("doc.mapPositions", params);
        CHECK(error["code"] == -32602);
        return error["data"]["field"].get<std::string>();
    };
    CHECK(invalid(json{{"serial", 4}}) == "toSource");                // neither list
    CHECK(invalid(json{{"toModel", json::array({0})}}) == "serial");  // missing serial
    CHECK(invalid(json{{"serial", "4"}, {"toModel", json::array({0})}}) == "serial");
    CHECK(invalid(json{{"serial", 4}, {"toModel", json::array({-1})}}) == "toModel");
    CHECK(invalid(json{{"serial", 4}, {"toModel", json::array({fb2::utf16_length(text) + 1})}}) ==
          "toModel");
    CHECK(invalid(json{{"serial", 4}, {"toModel", json::array({"x"})}}) == "toModel");
    CHECK(invalid(json{{"serial", 4}, {"toModel", 5}}) == "toModel");
    CHECK(invalid(json{{"serial", 4}, {"toSource", json::array({"n1"})}}) == "toSource");
    CHECK(invalid(json{{"serial", 4}, {"toSource", json::array({json{{"nodeId", 5}}})}}) ==
          "toSource");
    CHECK(invalid(json{{"serial", 4},
                       {"toSource", json::array({json{{"nodeId", "n1"}, {"offset", -1}}})}}) ==
          "toSource");
    CHECK(invalid(json{{"serial", 4},
                       {"toSource", json::array({json{{"nodeId", "n1"}, {"offset", "1"}}})}}) ==
          "toSource");
    // The end of the text is a valid offset; a missing offset means 0.
    const json edge = f.result_of(
        "doc.mapPositions", json{{"docId", doc_id},
                                 {"serial", 4},
                                 {"toModel", json::array({fb2::utf16_length(text)})},
                                 {"toSource", json::array({json{{"nodeId", new_ids.front()}}})}});
    CHECK(edge["toModel"] == json::array({nullptr}));
    CHECK(edge["toSource"][0].is_number_integer());
    // A stale serial is checked before the offsets are.
    CHECK(f.error_of("doc.mapPositions", json{{"docId", doc_id},
                                              {"serial", 1},
                                              {"toModel", json::array({0})}})["code"] == 1005);
    // An unknown document.
    CHECK(f.error_of("doc.mapPositions", json{{"docId", "d99"},
                                              {"serial", 4},
                                              {"toModel", json::array({0})}})["code"] == 1000);
}

TEST_CASE("doc.mapPositions: the map's lifetime in the session", "[server][positions]") {
    ServerFixture f;
    const auto stale = [&](const std::string& doc_id, std::uint64_t serial) {
        const json error =
            f.error_of("doc.mapPositions",
                       json{{"docId", doc_id}, {"serial", serial}, {"toModel", json::array({0})}});
        return error["code"] == 1005;
    };
    const auto alive = [&](const std::string& doc_id, std::uint64_t serial) {
        const json response =
            f.ws.call("doc.mapPositions",
                      json{{"docId", doc_id}, {"serial", serial}, {"toModel", json::array({0})}});
        return response.contains("result");
    };

    // Absent after doc.open and doc.new.
    const json opened = f.run_job(
        "doc.open", json{{"path", (test::fixtures_dir() / "books" / "modern-utf8.fb2").string()}});
    const std::string opened_id = opened["document"]["docId"];
    CHECK(stale(opened_id, 1));
    const json created = f.result_of("doc.new", json::object());
    const std::string doc_id = created["docId"];
    CHECK(stale(doc_id, 1));

    // Recorded by toXml; kept by doc.save and doc.validate.
    const json written = f.result_of("doc.toXml", json{{"docId", doc_id},
                                                       {"document", created},
                                                       {"elideBinaries", true},
                                                       {"positions", true}});
    REQUIRE(written["serial"] == 1);
    CHECK(alive(doc_id, 1));
    const std::string target = (f.data / "positions.fb2").string();
    const json saved = f.run_job(
        "doc.save",
        json{{"docId", doc_id}, {"document", created}, {"path", target}, {"force", true}});
    CHECK(saved["path"] == target);
    CHECK(alive(doc_id, 1));
    f.run_job("doc.validate", json{{"docId", doc_id}, {"document", created}});
    f.run_job("doc.validate", json{{"docId", doc_id}, {"text", written["text"]}});
    CHECK(alive(doc_id, 1));

    // Left in place by a failed parse.
    const json bad = f.error_of("doc.fromXml", json{{"docId", doc_id},
                                                    {"text", "<FictionBook><body></FictionBook>"},
                                                    {"positions", true}});
    CHECK(bad["code"] == 1001);
    CHECK(alive(doc_id, 1));

    // Dropped by a successful fromXml without the flag (its node ids are reissued).
    const json parsed =
        f.result_of("doc.fromXml", json{{"docId", doc_id}, {"text", written["text"]}});
    CHECK_FALSE(parsed.contains("serial"));
    CHECK(stale(doc_id, 1));
    CHECK(stale(doc_id, 2));

    // Recorded again by fromXml with the flag (the serial goes on counting), gone with the
    // session.
    const json again = f.result_of(
        "doc.fromXml", json{{"docId", doc_id}, {"text", written["text"]}, {"positions", true}});
    CHECK(again["serial"] == 2);
    CHECK(alive(doc_id, 2));
    f.result_of("doc.close", json{{"docId", doc_id}});
    CHECK(f.error_of("doc.mapPositions", json{{"docId", doc_id},
                                              {"serial", 2},
                                              {"toModel", json::array({0})}})["code"] == 1000);
}

/* ----------------------------------------------------------------------------------------- */
/* doc.toXml refreshes the session snapshot                                                   */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE(
    "doc.toXml: the received document becomes the snapshot the next remap, save and "
    "validate use",
    "[server][positions]") {
    ServerFixture f;
    const json created = f.result_of("doc.new", json::object());
    const std::string doc_id = created["docId"];
    const json& first_p = child(child(created["bodies"][0], 0), 0);
    REQUIRE(first_p["type"] == "p");
    const std::string first_id = id_of(first_p);

    // A Body edit before the switch: a paragraph with a dangling link inserted before the
    // template's paragraph (a UI id, as the editor issues them).
    json edited = created;
    json inserted =
        json{{"type", "p"},
             {"attrs", json{{"nodeId", "ui_1"}}},
             {"content",
              json::array(
                  {json{{"type", "text"}, {"text", "Inserted "}, {"marks", json::array()}},
                   json{{"type", "text"},
                        {"text", "link"},
                        {"marks", json::array({json{{"type", "link"},
                                                    {"attrs", json{{"href", "#missing"}}}}})}}})}};
    json& section_content = edited["bodies"][0]["content"][0]["content"];
    section_content.insert(section_content.begin(), inserted);

    const json written = f.result_of(
        "doc.toXml", json{{"docId", doc_id}, {"document", edited}, {"elideBinaries", true}});
    const std::string text = written["text"];
    REQUIRE(text.find("<p>Inserted <a l:href=\"#missing\">link</a></p>") != std::string::npos);

    // The remap of the parse follows the edited model: the template's paragraph is p[2] now.
    const json parsed = f.result_of("doc.fromXml", json{{"docId", doc_id}, {"text", text}});
    const json& new_section = child(parsed["document"]["bodies"][0], 0);
    const json& remap = parsed["remap"]["map"];
    CHECK(remap[first_id] == id_of(child(new_section, 1)));
    CHECK(remap["ui_1"] == id_of(child(new_section, 0)));
    CHECK(parsed["remap"]["unmappedOld"] == json::array());

    // doc.save and doc.validate without a document work on the received one.
    const json toxml_again = f.result_of(
        "doc.toXml", json{{"docId", doc_id}, {"document", edited}, {"elideBinaries", true}});
    REQUIRE(toxml_again["text"] == text);
    const std::string target = (f.data / "snapshot.fb2").string();
    const json saved =
        f.run_job("doc.save", json{{"docId", doc_id}, {"path", target}, {"force", true}});
    CHECK(saved["path"] == target);
    CHECK(test::read_text(target).find("<p>Inserted <a l:href=\"#missing\">link</a></p>") !=
          std::string::npos);
    const json validated_snapshot = f.run_job("doc.validate", json{{"docId", doc_id}});
    const json validated_edited =
        f.run_job("doc.validate", json{{"docId", doc_id}, {"document", edited}});
    const json validated_created =
        f.run_job("doc.validate", json{{"docId", doc_id}, {"document", created}});
    CHECK(validated_snapshot["issues"] == validated_edited["issues"]);
    CHECK(validated_snapshot["warningCount"] == validated_edited["warningCount"]);
    CHECK(validated_edited["warningCount"].get<int>() >
          validated_created["warningCount"].get<int>());
}
