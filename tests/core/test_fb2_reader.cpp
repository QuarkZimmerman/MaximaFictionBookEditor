// T037/T041: every fixture in tests/fixtures/books parses (or reports line/column), binaries
// are decoded with the right size and content type, unknown content is preserved as raw-xml,
// nodeIds are assigned, schemaHint/sourceEncoding/description fields are right.
#include "test_support.hpp"

#include <mfbe/base64.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/validator.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <set>

using namespace mfbe;
using Catch::Matchers::ContainsSubstring;

namespace {

std::filesystem::path book(const char* name) {
    return test::fixtures_dir() / "books" / name;
}

std::filesystem::path image(const char* name) {
    return test::fixtures_dir() / "images" / name;
}

fb2::ReadOptions no_hint() {
    fb2::ReadOptions options;
    options.compute_schema_hint = false;
    return options;
}

struct Loaded {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadResult result;
};

std::unique_ptr<Loaded> load(const char* name, fb2::ReadOptions options = {}) {
    auto l = std::make_unique<Loaded>();
    l->result = fb2::read_file(book(name), l->store, l->ids, options);
    return l;
}

bool has_warning(const fb2::ReadResult& r, const std::string& code) {
    for (const auto& w : r.warnings) {
        if (w.code == code) {
            return true;
        }
    }
    return false;
}

// Collects every text of a node subtree (ignoring marks).
std::string all_text(const model::Node& node) {
    if (node.is_text()) {
        return node.text;
    }
    std::string out;
    for (const auto& c : node.content) {
        out += all_text(c);
    }
    return out;
}

const model::Node* find_type(const model::Node& node, const std::string& type) {
    if (node.type == type) {
        return &node;
    }
    for (const auto& c : node.content) {
        if (const auto* found = find_type(c, type)) {
            return found;
        }
    }
    return nullptr;
}

std::vector<const model::Node*> find_all(const model::Node& node, const std::string& type) {
    std::vector<const model::Node*> out;
    if (node.type == type) {
        out.push_back(&node);
    }
    for (const auto& c : node.content) {
        auto sub = find_all(c, type);
        out.insert(out.end(), sub.begin(), sub.end());
    }
    return out;
}

}  // namespace

TEST_CASE("reader: legacy windows-1251 2.0 file loads as legacy with cover and notes", "[reader]") {
    auto l = load("legacy-cp1251.fb2");
    const model::Document& doc = l->result.document;
    CHECK(doc.sourceEncoding == "windows-1251");
    CHECK(doc.schemaHint == model::SchemaHint::legacy);  // old element order fails the XSD
    CHECK_FALSE(l->result.schema_issues.empty());
    CHECK(doc.fileKind == model::FileKind::fb2);
    CHECK(l->result.xlink_prefix == "xlink");
    CHECK(l->result.declared_encoding == "windows-1251");
    CHECK_FALSE(has_warning(l->result, "encoding.mismatch"));

    const auto& ti = doc.description.titleInfo;
    REQUIRE(ti.genres.size() == 2);
    CHECK(ti.genres[0].code == "prose_classic");
    CHECK_FALSE(ti.genres[0].match.has_value());
    CHECK(ti.genres[1].code == "poetry");
    CHECK(ti.genres[1].match == 50);
    REQUIRE(ti.authors.size() == 1);
    CHECK(ti.authors[0].firstName == "Антон");
    CHECK(ti.authors[0].middleName == "Павлович");
    CHECK(ti.authors[0].lastName == "Чехов");
    CHECK(ti.bookTitle == "Старая книга");
    CHECK(ti.lang == "ru");
    CHECK(ti.keywords == "проза, рассказы");
    REQUIRE(ti.date.has_value());
    CHECK(ti.date->text == "1890");
    REQUIRE(ti.coverpage.size() == 1);
    CHECK(ti.coverpage[0].href == "#cover.jpg");
    REQUIRE(ti.annotation.has_value());
    REQUIRE(ti.annotation->content.size() == 1);
    CHECK(ti.annotation->content[0].type == "p");
    CHECK_THAT(all_text(*ti.annotation), ContainsSubstring("Аннотация старой книги"));

    const auto& di = doc.description.documentInfo;
    REQUIRE(di.authors.size() == 1);
    CHECK(di.authors[0].nickname == "Старый конвертер");
    CHECK(di.programUsed == "FB Tools 2.0");
    CHECK(di.date.value == "2005-03-01");
    CHECK(di.date.text == "1 марта 2005");
    CHECK(di.id == "legacy-0001");
    CHECK(di.version == "1.1");
    REQUIRE(doc.description.publishInfo.has_value());
    CHECK(doc.description.publishInfo->year == "1999");
    CHECK(doc.description.publishInfo->city == "Москва");
    CHECK(doc.description.publishInfo->isbn == "5-00000-000-0");

    REQUIRE(doc.bodies.size() == 2);
    CHECK(doc.bodies[1].attr_string("name") == "notes");
    const auto sections = find_all(doc.bodies[0], "section");
    CHECK(sections.size() == 3);  // two chapters + one nested
    CHECK(sections[0]->attr_string("id") == "s1");
    // Footnote link mark and external link mark.
    const auto paragraphs = find_all(doc.bodies[0], "p");
    REQUIRE(paragraphs.size() >= 4);
    bool note_link = false;
    bool strong = false;
    for (const auto* p : paragraphs) {
        for (const auto& t : p->content) {
            for (const auto& m : t.marks) {
                if (m.type == "link" && m.attrs["href"] == "#n_1" && m.attrs["type"] == "note") {
                    note_link = true;
                }
                if (m.type == "strong") {
                    strong = true;
                }
            }
        }
    }
    CHECK(note_link);
    CHECK(strong);
    bool quotes = false;
    for (const auto* p : paragraphs) {
        if (all_text(*p).find("«ёлка», «Ёж», тире —") != std::string::npos) {
            quotes = true;
        }
    }
    CHECK(quotes);
    CHECK(find_type(doc.bodies[1], "section")->attr_string("id") == "n_1");

    // Binary decoded from base64 into the store, byte-identical to the fixture image.
    REQUIRE(l->store.size() == 1);
    const auto meta = l->store.meta("cover.jpg");
    REQUIRE(meta.has_value());
    CHECK(meta->contentType == "image/jpeg");
    CHECK(meta->decodable);
    CHECK_FALSE(meta->willConvert);
    CHECK(meta->width == 8);
    CHECK(meta->height == 6);
    CHECK(meta->referenceCount == 1);
    CHECK(l->store.bytes("cover.jpg") == test::read_text(image("tiny.jpg")));
    CHECK(meta->size == static_cast<std::int64_t>(test::read_text(image("tiny.jpg")).size()));
    REQUIRE(doc.binaries.size() == 1);
    CHECK(doc.binaries[0] == *meta);

    // Every structural node has a nodeId; text nodes do not.
    std::size_t structural = 0;
    model::visit_nodes(doc, [&](const model::Node& n, const std::string&) {
        CHECK_FALSE(n.node_id().empty());
        ++structural;
        return true;
    });
    CHECK(structural > 15);
    CHECK(l->ids.next_counter() == structural + 1);
}

TEST_CASE("reader: modern UTF-8 2.1 file validates as-is and maps every construct", "[reader]") {
    auto l = load("modern-utf8.fb2");
    const model::Document& doc = l->result.document;
    CHECK(doc.schemaHint == model::SchemaHint::v21);
    CHECK(l->result.schema_issues.empty());
    CHECK(doc.sourceEncoding == "utf-8");
    CHECK(l->result.xlink_prefix == "l");
    CHECK(l->result.warnings.empty());
    REQUIRE(doc.stylesheets.size() == 1);
    CHECK(doc.stylesheets[0].type == "text/css");
    CHECK(doc.stylesheets[0].content == "p { text-indent: 1em; }");

    const auto& d = doc.description;
    CHECK(d.titleInfo.authors.size() == 2);
    CHECK(d.titleInfo.authors[0].homePages == std::vector<std::string>{"https://example.org/anna"});
    CHECK(d.titleInfo.authors[0].emails == std::vector<std::string>{"anna@example.org"});
    CHECK(d.titleInfo.authors[0].id == "author-1");
    CHECK(d.titleInfo.authors[1].nickname == "Соавтор");
    CHECK(d.titleInfo.srcLang == "en");
    CHECK(d.titleInfo.translators.size() == 1);
    REQUIRE(d.titleInfo.sequences.size() == 1);
    CHECK(d.titleInfo.sequences[0].name == "Серия");
    CHECK(d.titleInfo.sequences[0].number == 3);
    REQUIRE(d.titleInfo.sequences[0].children.size() == 1);
    CHECK(d.titleInfo.sequences[0].children[0].name == "Подсерия");
    REQUIRE(d.titleInfo.annotation.has_value());
    CHECK(d.titleInfo.annotation->content.size() == 3);
    CHECK(d.titleInfo.annotation->content[1].type == "empty-line");
    CHECK(d.titleInfo.date->value == "2020-05-17");
    REQUIRE(d.srcTitleInfo.has_value());
    CHECK(d.srcTitleInfo->bookTitle == "A Modern Book");
    CHECK(d.documentInfo.srcUrls == std::vector<std::string>{"https://example.org/source"});
    CHECK(d.documentInfo.srcOcr == "OCR by hand");
    REQUIRE(d.documentInfo.history.has_value());
    CHECK(d.documentInfo.history->content.size() == 2);
    CHECK(d.documentInfo.publishers.size() == 1);
    REQUIRE(d.publishInfo.has_value());
    CHECK(d.publishInfo->sequences.size() == 1);
    REQUIRE(d.customInfo.size() == 2);
    CHECK(d.customInfo[0].infoType == "source");
    CHECK(d.customInfo[1].lang == "en");

    REQUIRE(doc.bodies.size() == 2);
    const model::Node& body = doc.bodies[0];
    REQUIRE(body.content.size() >= 4);
    CHECK(body.content[0].type == "image");
    CHECK(body.content[0].attr_string("title") == "Титул");
    CHECK(body.content[1].type == "title");
    CHECK(body.content[2].type == "epigraph");
    CHECK(body.content[2].attr_string("id") == "epi1");
    const model::Node& ch1 = body.content[3];
    CHECK(ch1.type == "section");
    CHECK(ch1.attr_string("lang") == "ru");
    CHECK(find_type(ch1, "annotation") != nullptr);
    CHECK(find_type(ch1, "poem") != nullptr);
    CHECK(find_type(ch1, "stanza") != nullptr);
    CHECK(find_type(ch1, "cite") != nullptr);
    CHECK(find_type(ch1, "subtitle") != nullptr);
    CHECK(find_type(ch1, "text-author") != nullptr);
    CHECK(find_type(ch1, "empty-line") != nullptr);
    CHECK(find_type(ch1, "date") != nullptr);
    CHECK(find_type(ch1, "inline-image") != nullptr);
    CHECK(find_type(ch1, "inline-image")->attr_string("href") == "#dot.gif");
    const model::Node* table = nullptr;
    for (const auto* t : find_all(ch1, "table")) {
        if (t->attr_string("id") == "t1") {
            table = t;
        }
    }
    REQUIRE(table != nullptr);
    CHECK(table->attr_string("style") == "grid");
    REQUIRE(table->content.size() == 3);
    CHECK(table->content[0].attr_string("align") == "center");
    const model::Node& th = table->content[0].content[0];
    CHECK(th.type == "th");
    CHECK(th.attrs.at("colspan") == 2);
    CHECK(th.attr_string("valign") == "middle");
    CHECK(table->content[1].content[1].attrs.at("rowspan") == 2);

    // Paragraph p1 carries every mark type.
    const model::Node* p1 = nullptr;
    for (const auto* p : find_all(ch1, "p")) {
        if (p->attr_string("id") == "p1") {
            p1 = p;
        }
    }
    REQUIRE(p1 != nullptr);
    CHECK(p1->attr_string("style") == "lead");
    std::set<std::string> marks;
    for (const auto& t : p1->content) {
        for (const auto& m : t.marks) {
            marks.insert(m.type);
            if (m.type == "style") {
                CHECK(m.attrs["name"] == "note");
            }
            if (m.type == "link" && m.attrs["href"] == "https://example.org/") {
                CHECK(m.attrs["type"] == "simple");
            }
        }
    }
    CHECK(marks == std::set<std::string>{"strong", "emphasis", "strikethrough", "sub", "sup",
                                         "code", "style", "link"});
    // Nested marks accumulate on the innermost text.
    bool triple = false;
    for (const auto* p : find_all(ch1, "p")) {
        if (all_text(*p).rfind("Вложенные стили", 0) != 0) {
            continue;
        }
        for (const auto& t : p->content) {
            if (t.marks.size() == 3 && t.text == "и зачёркнутый") {
                triple = true;
            }
        }
    }
    CHECK(triple);

    REQUIRE(l->store.size() == 2);
    CHECK(l->store.ids() == std::vector<std::string>{"cover.png", "dot.gif"});
    const auto png = *l->store.meta("cover.png");
    CHECK(png.contentType == "image/png");
    CHECK(png.decodable);
    CHECK_FALSE(png.willConvert);
    CHECK(png.width == 8);
    CHECK(png.height == 6);
    CHECK(png.referenceCount == 3);  // coverpage + body image + section image
    const auto gif = *l->store.meta("dot.gif");
    CHECK(gif.contentType == "image/gif");
    CHECK(gif.decodable);
    CHECK(gif.willConvert);
    CHECK(gif.referenceCount == 2);
    CHECK(l->store.bytes("cover.png") == test::read_text(image("tiny.png")));
    CHECK(l->store.bytes("dot.gif") == test::read_text(image("tiny.gif")));

    // The model survives the JSON codec unchanged.
    const auto json = model::to_json(doc);
    CHECK(model::document_from_json(json) == doc);
}

TEST_CASE("reader: UTF-16 with BOM and KOI8-R decode to the same text", "[reader]") {
    auto utf16 = load("utf16-bom.fb2");
    CHECK(utf16->result.bom);
    CHECK(utf16->result.document.sourceEncoding == "utf-16le");
    CHECK(utf16->result.document.schemaHint == model::SchemaHint::v21);
    CHECK_FALSE(has_warning(utf16->result, "encoding.mismatch"));
    CHECK(utf16->result.document.description.titleInfo.bookTitle == "Книга в UTF-16");
    CHECK_THAT(all_text(utf16->result.document.bodies[0]), ContainsSubstring("ёж, Ёлка, Ω нет"));

    auto koi = load("koi8r.fb2");
    CHECK(koi->result.document.sourceEncoding == "koi8-r");
    CHECK(koi->result.document.schemaHint == model::SchemaHint::v21);
    CHECK(koi->result.warnings.empty());
    CHECK(koi->result.document.description.titleInfo.bookTitle == "Книга в KOI8-R");
    CHECK_THAT(all_text(koi->result.document.bodies[0]), ContainsSubstring("линия ─ и ©"));
    CHECK_THAT(all_text(koi->result.document.bodies[0]),
               ContainsSubstring("Съешь же ещё этих мягких французских булок"));
}

TEST_CASE("reader: malformed XML reports line and column and does not crash", "[reader]") {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    try {
        fb2::read_file(book("malformed.fb2"), store, ids);
        FAIL("expected ParseFailure");
    } catch (const fb2::ParseFailure& e) {
        CHECK(e.error.line == 20);
        CHECK(e.error.column == 13);
        CHECK_THAT(e.error.message, ContainsSubstring("Opening and ending tag mismatch"));
        CHECK_THAT(e.error.message, ContainsSubstring("p line 19"));
    }
    CHECK(store.size() == 0);

    // Source-only mode still delivers the text and the same error.
    const fb2::SourceText source = fb2::read_source(book("malformed.fb2"));
    CHECK(source.encoding == "utf-8");
    REQUIRE(source.error.has_value());
    CHECK(source.error->line == 20);
    CHECK_THAT(source.text, ContainsSubstring("This paragraph is never closed"));
    CHECK(fb2::check_well_formed("<a><b></a>").has_value());
    CHECK_FALSE(fb2::check_well_formed("<a><b/></a>").has_value());

    // Hostile input: entity expansion and external entities are refused, not expanded.
    const std::string laughs =
        "<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY a \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\">"
        "<!ENTITY b \"&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;\"><!ENTITY c "
        "\"&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;\">"
        "<!ENTITY d \"&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;\"><!ENTITY e "
        "\"&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;\">"
        "<!ENTITY ext SYSTEM \"file:///etc/passwd\">]>"
        "<FictionBook "
        "xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\"><body><section><p>&e;&ext;</p>"
        "</section></body></FictionBook>";
    try {
        const auto r = fb2::read_bytes(laughs, store, ids, no_hint());
        const std::string text = all_text(r.document.bodies[0]);
        CHECK(text.find("root:") == std::string::npos);  // external entity never loaded
    } catch (const fb2::ParseFailure&) {
        SUCCEED("hostile entity document rejected");
    }
}

TEST_CASE("reader: unknown elements and attributes are preserved as raw-xml", "[reader]") {
    auto l = load("unknown-elements.fb2");
    const model::Document& doc = l->result.document;
    CHECK(doc.schemaHint == model::SchemaHint::legacy);

    // Top-level foreign element and the foreign element inside title-info go to extras.
    REQUIRE(doc.extras.size() == 2);
    CHECK(doc.extras[0].type == "raw-xml");
    CHECK(doc.extras[0].attr_string("slot") == "title-info");
    CHECK_THAT(doc.extras[0].attr_string("xml").value(), ContainsSubstring("<x:rating"));
    CHECK_THAT(doc.extras[0].attr_string("xml").value(),
               ContainsSubstring("xmlns:x=\"urn:example:extension\""));
    CHECK(doc.extras[1].attr_string("slot") == "FictionBook");
    const std::string meta = doc.extras[1].attr_string("xml").value();
    CHECK_THAT(meta, ContainsSubstring("<x:metadata"));
    CHECK_THAT(meta, ContainsSubstring("<!-- comment inside -->"));
    CHECK_THAT(meta, ContainsSubstring("<x:item key=\"b\"/>"));
    CHECK_FALSE(doc.extras[1].node_id().empty());

    const model::Node& section = doc.bodies[0].content[0];
    REQUIRE(section.type == "section");
    CHECK(section.attr_string("id") == "s1");
    REQUIRE(section.attrs.count("unknownAttrs") == 1);
    const auto& unknown = section.attrs.at("unknownAttrs");
    CHECK(unknown["{urn:example:extension}kind"] == "chapter");
    CHECK(unknown["data-foo"] == "bar");

    REQUIRE(section.content.size() == 4);
    const model::Node& p = section.content[1];
    REQUIRE(p.type == "p");
    bool inline_raw = false;
    for (const auto& child : p.content) {
        if (child.type == "raw-xml") {
            inline_raw = true;
            CHECK(child.attrs.at("inline") == true);
            CHECK_THAT(child.attr_string("xml").value(), ContainsSubstring("<x:marker"));
            CHECK_THAT(child.attr_string("xml").value(), ContainsSubstring("unknown inline"));
        }
    }
    CHECK(inline_raw);
    const model::Node& block_raw = section.content[2];
    CHECK(block_raw.type == "raw-xml");
    CHECK(block_raw.attrs.at("inline") == false);
    CHECK_THAT(block_raw.attr_string("xml").value(), ContainsSubstring("<footnote-ref"));
    CHECK_THAT(block_raw.attr_string("xml").value(), ContainsSubstring("l:href=\"#n_1\""));
    CHECK_FALSE(block_raw.node_id().empty());
    CHECK(section.content[3].type == "p");
}

TEST_CASE("reader: .fbd descriptor without body loads", "[reader]") {
    auto l = load("descriptor.fbd");
    const model::Document& doc = l->result.document;
    CHECK(doc.fileKind == model::FileKind::fbd);
    CHECK(doc.bodies.empty());
    CHECK(doc.schemaHint == model::SchemaHint::legacy);  // the XSD requires a body
    CHECK(doc.description.titleInfo.bookTitle == "Только описание");
    CHECK(doc.description.documentInfo.programUsed == "fixture generator");
    CHECK(doc.description.publishInfo->bookName == "Бумажное издание");
    CHECK(doc.description.customInfo.size() == 1);
    CHECK(l->store.size() == 0);
    CHECK(doc.binaries.empty());
}

TEST_CASE("reader: wrong or missing encoding declaration is detected and reported", "[reader]") {
    auto mismatch = load("mismatched-declaration.fb2");
    CHECK(mismatch->result.declared_encoding == "utf-8");
    CHECK(mismatch->result.document.sourceEncoding == "windows-1251");
    REQUIRE(has_warning(mismatch->result, "encoding.mismatch"));
    for (const auto& w : mismatch->result.warnings) {
        if (w.code == "encoding.mismatch") {
            CHECK(w.params.at("declared") == "utf-8");
            CHECK(w.params.at("detected") == "windows-1251");
            CHECK(w.severity == model::Severity::warning);
        }
    }
    CHECK(mismatch->result.document.description.titleInfo.bookTitle == "Неверная декларация");
    CHECK(mismatch->result.document.description.titleInfo.authors[0].firstName == "Иван");

    auto none = load("no-declaration.fb2");
    CHECK(none->result.declared_encoding.empty());
    CHECK(none->result.document.sourceEncoding == "utf-8");
    CHECK_FALSE(has_warning(none->result, "encoding.mismatch"));
    CHECK(none->result.document.schemaHint == model::SchemaHint::v21);
    CHECK(none->result.document.description.titleInfo.bookTitle == "Без декларации");
}

TEST_CASE("reader: binaries - invalid base64 is kept verbatim, placeholders re-attach bytes",
          "[reader]") {
    const std::string head =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\"><description><title-info><genre>sf</genre>"
        "<author><nickname>a</nickname></author><book-title>t</book-title><lang>en</lang>"
        "</title-info><document-info><author><nickname>a</nickname></author><date>2026</date>"
        "<id>x</id><version>1.0</version></document-info></description><body><section><p>"
        "<image l:href=\"#good.png\"/></p></section></body>";
    const std::string png = test::read_text(image("tiny.png"));

    SECTION("invalid base64") {
        const std::string text =
            head +
            "<binary id=\"bad.jpg\" content-type=\"image/jpeg\">not*base64!</binary>"
            "<binary id=\"good.png\" content-type=\"image/png\">" +
            base64::encode(png) + "</binary></FictionBook>";
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        const auto r = fb2::read_bytes(text, store, ids, no_hint());
        REQUIRE(has_warning(r, "binary.invalidBase64"));
        REQUIRE(store.size() == 2);
        CHECK(store.is_raw_text("bad.jpg"));
        CHECK(store.bytes("bad.jpg") == std::string("not*base64!"));
        const auto bad = *store.meta("bad.jpg");
        CHECK_FALSE(bad.decodable);
        CHECK_FALSE(bad.willConvert);
        CHECK(bad.referenceCount == 0);
        CHECK(store.bytes("good.png") == png);
        CHECK(store.meta("good.png")->referenceCount == 1);
    }
    SECTION("placeholder re-attachment from the previous store") {
        MemoryBinaryStore previous;
        previous.put("good.png", "image/png", png);
        const std::string text = head +
                                 "<binary id=\"good.png\" content-type=\"image/png\">\xE2\x80\xA6" +
                                 std::to_string(png.size()) +
                                 " bytes\xE2\x80\xA6</binary>"
                                 "<binary id=\"gone.png\" content-type=\"image/png\">\xE2\x80\xA6"
                                 "5 bytes\xE2\x80\xA6</binary>"
                                 "</FictionBook>";
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        fb2::ReadOptions options;
        options.compute_schema_hint = false;
        options.placeholder_source = &previous;
        const auto r = fb2::read_bytes(text, store, ids, options);
        CHECK(store.bytes("good.png") == png);
        CHECK_FALSE(store.contains("gone.png"));
        CHECK(has_warning(r, "binary.placeholderMissing"));
    }
    SECTION("duplicate and missing ids") {
        const std::string text =
            head + "<binary id=\"good.png\" content-type=\"image/png\">" + base64::encode(png) +
            "</binary><binary id=\"good.png\" content-type=\"image/png\">" + base64::encode(png) +
            "</binary><binary content-type=\"image/png\">" + base64::encode(png) +
            "</binary></FictionBook>";
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        const auto r = fb2::read_bytes(text, store, ids, no_hint());
        CHECK(has_warning(r, "binary.duplicateId"));
        CHECK(has_warning(r, "binary.missingId"));
        CHECK(store.ids() == std::vector<std::string>{"good.png", "good_2.png", "binary_1"});
    }
    SECTION("missing content type is sniffed") {
        const std::string text =
            head + "<binary id=\"good.png\">" + base64::encode(png) + "</binary></FictionBook>";
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        fb2::read_bytes(text, store, ids, no_hint());
        CHECK(store.meta("good.png")->contentType == "image/png");
    }
}

TEST_CASE("reader: stray text, comments and misplaced elements survive as raw-xml", "[reader]") {
    const std::string text =
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\">"
        "<description><title-info><book-title>t</book-title><book-title>dup</book-title></"
        "title-info>"
        "<document-info/></description>"
        "<body><p>Paragraph directly in body</p><section>Loose text<!-- note --><p>a &amp; b "
        "<p>nested</p></p>"
        "<strong>misplaced</strong></section></body></FictionBook>";
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const auto r = fb2::read_bytes(text, store, ids, no_hint());
    const model::Document& doc = r.document;
    CHECK(doc.description.titleInfo.bookTitle == "t");
    REQUIRE(doc.extras.size() == 1);  // the duplicate book-title
    CHECK_THAT(doc.extras[0].attr_string("xml").value(), ContainsSubstring("dup"));
    CHECK(doc.extras[0].attr_string("slot") == "title-info");
    REQUIRE(doc.bodies.size() == 1);
    REQUIRE(doc.bodies[0].content.size() == 2);
    CHECK(doc.bodies[0].content[0].type == "p");  // known element kept even where not allowed
    const model::Node& section = doc.bodies[0].content[1];
    REQUIRE(section.content.size() == 4);
    CHECK(section.content[0].type == "raw-xml");
    CHECK(section.content[0].attr_string("xml") == "Loose text");
    CHECK(section.content[1].type == "raw-xml");
    CHECK(section.content[1].attr_string("xml") == "<!-- note -->");
    const model::Node& p = section.content[2];
    REQUIRE(p.content.size() == 2);
    CHECK(p.content[0].text == "a & b ");
    CHECK(p.content[1].type == "raw-xml");
    CHECK(p.content[1].attr_string("xml") == "<p>nested</p>");
    CHECK(section.content[3].type == "raw-xml");
    CHECK_THAT(section.content[3].attr_string("xml").value(), ContainsSubstring("<strong"));
}

TEST_CASE("reader: a non-FictionBook root is refused as not a FictionBook document", "[reader]") {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    try {
        fb2::read_bytes("<html><body/></html>", store, ids);
        FAIL("expected NotFictionBookFailure");
    } catch (const fb2::NotFictionBookFailure& e) {
        CHECK(e.reason == "rootNotFictionBook");
        CHECK_THAT(e.error.message, ContainsSubstring("FictionBook"));
    }
    CHECK_THROWS_AS(fb2::read_file(book("does-not-exist.fb2"), store, ids), fb2::IoFailure);
}

TEST_CASE("reader: files that are not FictionBook at all are refused while malformed books open",
          "[reader]") {
    using fb2::not_fictionbook_reason;
    // Plain text, JSON, HTML and binary content: refused outright.
    CHECK(not_fictionbook_reason("Just some notes.\nSecond line.") == "notXml");
    CHECK(not_fictionbook_reason("{\"title\": \"not xml\"}") == "notXml");
    CHECK(not_fictionbook_reason("<!DOCTYPE html><html><body>FictionBook</body></html>") ==
          "notXml");
    CHECK(not_fictionbook_reason(std::string("MZ\x90\0\x03\0\0\0", 8)) == "binary");
    CHECK(not_fictionbook_reason("") == "notXml");
    // Anything carrying a <FictionBook start tag may open (malformed ones in Source-only mode).
    CHECK_FALSE(
        not_fictionbook_reason("<?xml version=\"1.0\"?>\n<FictionBook><description>").has_value());
    CHECK_FALSE(not_fictionbook_reason("\xEF\xBB\xBF<FictionBook xmlns=\"x\">").has_value());
    CHECK_FALSE(not_fictionbook_reason("<fb:FictionBook xmlns:fb=\"x\"/>").has_value());
    CHECK_FALSE(not_fictionbook_reason("  \n<FictionBook>").has_value());
    // UTF-16 with BOM is text, not binary.
    std::string utf16 = "\xFF\xFE";
    for (char c : std::string("<FictionBook>")) {
        utf16.push_back(c);
        utf16.push_back('\0');
    }
    CHECK_FALSE(not_fictionbook_reason(utf16).has_value());
    // The word alone (not as a tag) does not count.
    CHECK(not_fictionbook_reason("<note>FictionBook is a format</note>") == "notXml");

    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    try {
        fb2::read_bytes("hello world", store, ids);
        FAIL("expected NotFictionBookFailure");
    } catch (const fb2::NotFictionBookFailure& e) {
        CHECK(e.reason == "notXml");
    }
    // Malformed FictionBook: still a ParseFailure (Source-only mode), not a refusal.
    CHECK_THROWS_AS(fb2::read_bytes("<FictionBook><body><p>never closed", store, ids),
                    fb2::ParseFailure);
    try {
        fb2::read_bytes("<FictionBook><body><p>never closed", store, ids);
    } catch (const fb2::NotFictionBookFailure&) {
        FAIL("a malformed FictionBook file must not be refused");
    } catch (const fb2::ParseFailure&) {
    }
}
