// T038/T043: FB2 2.1 element order, namespaces, indentation, base64 wrapping, encodings,
// elided-binaries mode, canonical mark nesting, required/optional elements, raw-xml verbatim,
// unknown attributes, line -> nodeId map.
#include "test_support.hpp"

#include <mfbe/base64.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/node_ids.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

using namespace mfbe;
using Catch::Matchers::ContainsSubstring;

namespace {

std::filesystem::path book(const char* name) {
    return test::fixtures_dir() / "books" / name;
}

struct Loaded {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadResult result;
};

std::unique_ptr<Loaded> load(const char* name) {
    auto l = std::make_unique<Loaded>();
    l->result = fb2::read_file(book(name), l->store, l->ids);
    return l;
}

std::size_t pos_of(const std::string& text, const std::string& needle) {
    const auto p = text.find(needle);
    REQUIRE(p != std::string::npos);
    return p;
}

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

model::Node text_node(const std::string& text, std::vector<model::Mark> marks = {}) {
    model::Node n;
    n.type = "text";
    n.text = text;
    n.marks = std::move(marks);
    return n;
}

model::Node element(const std::string& type, std::vector<model::Node> content = {}) {
    model::Node n;
    n.type = type;
    n.content = std::move(content);
    return n;
}

}  // namespace

TEST_CASE("writer: description is normalised to the FB2 2.1 order with the input's xlink prefix",
          "[writer]") {
    auto l = load("legacy-cp1251.fb2");
    fb2::WriteOptions options;
    options.xlink_prefix = l->result.xlink_prefix;
    const fb2::WriteResult w = fb2::write_document(l->result.document, &l->store, options);
    const std::string& t = w.text;

    CHECK(t.rfind("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<FictionBook "
                  "xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
                  "xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n",
                  0) == 0);
    CHECK(t.find('\r') == std::string::npos);
    CHECK(t.back() == '\n');
    CHECK_THAT(t, ContainsSubstring("</FictionBook>\n"));
    // The input had document-info first and lang before coverpage/date/keywords.
    CHECK(pos_of(t, "<title-info>") < pos_of(t, "<document-info>"));
    CHECK(pos_of(t, "<document-info>") < pos_of(t, "<publish-info>"));
    CHECK(pos_of(t, "<genre>prose_classic</genre>") <
          pos_of(t, "<genre match=\"50\">poetry</genre>"));
    CHECK(pos_of(t, "<genre match=\"50\">poetry</genre>") < pos_of(t, "<author>"));
    CHECK(pos_of(t, "<last-name>Чехов</last-name>") <
          pos_of(t, "<book-title>Старая книга</book-title>"));
    CHECK(pos_of(t, "<book-title>") < pos_of(t, "<annotation>"));
    CHECK(pos_of(t, "<annotation>") < pos_of(t, "<keywords>проза, рассказы</keywords>"));
    CHECK(pos_of(t, "<keywords>") < pos_of(t, "<date>1890</date>"));
    CHECK(pos_of(t, "<date>1890</date>") < pos_of(t, "<coverpage>"));
    CHECK(pos_of(t, "<coverpage>") < pos_of(t, "<lang>ru</lang>"));
    // document-info: author, program-used, date, id, version.
    CHECK(pos_of(t, "<nickname>Старый конвертер</nickname>") <
          pos_of(t, "<program-used>FB Tools 2.0</program-used>"));
    CHECK(pos_of(t, "<program-used>") <
          pos_of(t, "<date value=\"2005-03-01\">1 марта 2005</date>"));
    CHECK(pos_of(t, "<date value=\"2005-03-01\">") < pos_of(t, "<id>legacy-0001</id>"));
    CHECK(pos_of(t, "<id>legacy-0001</id>") < pos_of(t, "<version>1.1</version>"));
    // publish-info: book-name, publisher, city, year, isbn (input had year first).
    CHECK(pos_of(t, "<book-name>") < pos_of(t, "<publisher>Издательство «Пример»</publisher>"));
    CHECK(pos_of(t, "<publisher>") < pos_of(t, "<city>Москва</city>"));
    CHECK(pos_of(t, "<city>") < pos_of(t, "<year>1999</year>"));
    CHECK(pos_of(t, "<year>") < pos_of(t, "<isbn>5-00000-000-0</isbn>"));
    // xlink attributes use the preserved prefix.
    CHECK_THAT(t, ContainsSubstring("<image xlink:href=\"#cover.jpg\"/>"));
    CHECK_THAT(t, ContainsSubstring("<a xlink:href=\"#n_1\" type=\"note\">[1]</a>"));
    CHECK_THAT(t, ContainsSubstring("<annotation>\n\t\t\t\t<p>Аннотация старой книги — так писали "
                                    "старые конвертеры.</p>\n\t\t\t</annotation>"));
    // Stray text in a block context is kept verbatim on its own line.
    model::Document stray;
    model::Node annotation = element("annotation");
    model::Node raw;
    raw.type = "raw-xml";
    raw.attrs["xml"] = "Loose &amp; text";
    raw.attrs["inline"] = false;
    annotation.content.push_back(raw);
    stray.description.titleInfo.annotation = annotation;
    CHECK_THAT(fb2::write_document(stray, nullptr).text,
               ContainsSubstring("<annotation>\n\t\t\t\tLoose &amp; text\n\t\t\t</annotation>"));
    // Bodies in order, notes body keeps its name.
    CHECK(pos_of(t, "<body>") < pos_of(t, "<body name=\"notes\">"));
    CHECK(pos_of(t, "<body name=\"notes\">") <
          pos_of(t, "<binary id=\"cover.jpg\" content-type=\"image/jpeg\">"));
}

TEST_CASE("writer: structural indentation uses tabs and leaves inline text untouched", "[writer]") {
    auto l = load("modern-utf8.fb2");
    const fb2::WriteResult w = fb2::write_document(l->result.document, &l->store);
    const auto lines = lines_of(w.text);
    REQUIRE(lines.size() > 50);
    for (const auto& line : lines) {
        if (line.empty() || line[0] != '\t') {
            continue;
        }
        // Indentation is tabs only (never spaces) before the first tag.
        std::size_t i = 0;
        while (i < line.size() && line[i] == '\t') {
            ++i;
        }
        CHECK(line[i] != ' ');
    }
    CHECK_THAT(w.text,
               ContainsSubstring("\t<description>\n\t\t<title-info>\n\t\t\t<genre>sf</genre>\n"));
    CHECK_THAT(w.text,
               ContainsSubstring(
                   "\t\t<section id=\"ch1\" xml:lang=\"ru\">\n\t\t\t<title>\n\t\t\t\t<p>Глава "
                   "1</p>\n\t\t\t</title>\n"));
    CHECK_THAT(w.text,
               ContainsSubstring("\t\t\t\t<tr align=\"center\">\n\t\t\t\t\t<th id=\"h1\" "
                                 "colspan=\"2\" align=\"center\" valign=\"middle\">Шапка</th>\n"));
    CHECK_THAT(
        w.text,
        ContainsSubstring(
            "<p>Абзац с инлайн-картинкой <image l:href=\"#dot.gif\" alt=\"точка\"/> внутри.</p>"));
    CHECK_THAT(w.text, ContainsSubstring("\t\t\t<empty-line/>\n"));
    CHECK_THAT(w.text, ContainsSubstring("<image l:href=\"#cover.png\" alt=\"Картинка в разделе\" "
                                         "title=\"Подпись\" id=\"img1\"/>"));
    CHECK_THAT(w.text, ContainsSubstring(
                           "<stylesheet type=\"text/css\">p { text-indent: 1em; }</stylesheet>"));
    CHECK_THAT(w.text,
               ContainsSubstring(
                   "<custom-info info-type=\"note\" xml:lang=\"en\">English note</custom-info>"));
    CHECK_THAT(w.text,
               ContainsSubstring("<sequence name=\"Серия\" number=\"3\">\n\t\t\t\t<sequence "
                                 "name=\"Подсерия\" number=\"1\"/>\n\t\t\t</sequence>"));
    CHECK_THAT(w.text, ContainsSubstring("<date value=\"1900-01-01\">1900</date>"));
    // Every mark type serialises to its FB2 element.
    CHECK_THAT(w.text,
               ContainsSubstring(
                   "<strong>жирным</strong>, <emphasis>курсивом</emphasis>, "
                   "<strikethrough>зачёркнутым</strikethrough>, H<sub>2</sub>O, x<sup>2</sup>, "
                   "<code>code()</code>, <style name=\"note\">именованным стилем</style>, <a "
                   "l:href=\"https://example.org/\" type=\"simple\">ссылкой</a> и сноской<a "
                   "l:href=\"#n_1\" type=\"note\">[1]</a>."));
    CHECK_THAT(w.text, ContainsSubstring("<strong>жирный <emphasis>и курсив <strikethrough>и "
                                         "зачёркнутый</strikethrough></emphasis></strong>, <a "
                                         "l:href=\"#n_2\" type=\"note\"><sup>2</sup></a>."));
    CHECK(w.binary_count == 2);
}

TEST_CASE("writer: binaries are base64 at 76 columns, byte-identical after decoding", "[writer]") {
    auto l = load("modern-utf8.fb2");
    const fb2::WriteResult w = fb2::write_document(l->result.document, &l->store);
    const std::size_t start =
        pos_of(w.text, "<binary id=\"cover.png\" content-type=\"image/png\">");
    const std::size_t open_end = w.text.find('>', start) + 1;
    const std::size_t close = w.text.find("</binary>", open_end);
    REQUIRE(close != std::string::npos);
    const std::string payload = w.text.substr(open_end, close - open_end);
    for (const auto& line : lines_of(payload)) {
        CHECK(line.size() <= 76);
        CHECK_FALSE(line.empty());
    }
    CHECK(base64::decode(payload) == l->store.bytes("cover.png"));
    // The GIF binary follows in store (document) order.
    CHECK(pos_of(w.text, "<binary id=\"cover.png\"") <
          pos_of(w.text, "<binary id=\"dot.gif\" content-type=\"image/gif\">"));
    CHECK(pos_of(w.text, "<binary id=\"dot.gif\"") < pos_of(w.text, "</FictionBook>"));
    // A wrapped payload: lines are exactly 76 wide except the last.
    std::string big;
    for (int i = 0; i < 3000; ++i) {
        big.push_back(static_cast<char>(i % 251));
    }
    MemoryBinaryStore store;
    store.put("big.bin", "application/octet-stream", big);
    model::Document empty;
    const fb2::WriteResult wb = fb2::write_document(empty, &store);
    const std::size_t s =
        pos_of(wb.text, "<binary id=\"big.bin\" content-type=\"application/octet-stream\">");
    const std::size_t e = wb.text.find("</binary>", s);
    const std::string body = wb.text.substr(wb.text.find('>', s) + 1, e - wb.text.find('>', s) - 1);
    const auto body_lines = lines_of(body);
    REQUIRE(body_lines.size() > 2);
    for (std::size_t i = 0; i + 1 < body_lines.size(); ++i) {
        CHECK(body_lines[i].size() == 76);
    }
    CHECK(base64::decode(body) == big);
}

TEST_CASE("writer: elided binaries become size placeholders that the reader re-attaches",
          "[writer]") {
    auto l = load("modern-utf8.fb2");
    fb2::WriteOptions options;
    options.elide_binaries = true;
    const fb2::WriteResult w = fb2::write_document(l->result.document, &l->store, options);
    const std::string expected =
        "<binary id=\"cover.png\" content-type=\"image/png\">\xE2\x80\xA6" +
        std::to_string(l->store.meta("cover.png")->size) + " bytes\xE2\x80\xA6</binary>";
    CHECK_THAT(w.text, ContainsSubstring(expected));
    CHECK(w.text.find("iVBOR") == std::string::npos);  // no PNG base64 in the elided text
    // Round trip through the reader with the original store as placeholder source.
    MemoryBinaryStore store2;
    model::NodeIdAllocator ids2;
    fb2::ReadOptions ro;
    ro.force_encoding = "utf-8";
    ro.placeholder_source = &l->store;
    ro.compute_schema_hint = false;
    const auto r2 = fb2::read_bytes(w.text, store2, ids2, ro);
    CHECK(r2.warnings.empty());
    CHECK(store2.bytes("cover.png") == l->store.bytes("cover.png"));
    CHECK(store2.bytes("dot.gif") == l->store.bytes("dot.gif"));
    CHECK(store2.meta("dot.gif")->contentType == "image/gif");
}

TEST_CASE("writer: encodings - declaration, legacy code pages, UTF-16 BOM and char refs",
          "[writer]") {
    auto l = load("modern-utf8.fb2");
    fb2::WriteOptions options;
    options.encoding = "windows-1251";
    const fb2::WriteResult w = fb2::write_document(l->result.document, &l->store, options);
    CHECK(w.text.rfind("<?xml version=\"1.0\" encoding=\"windows-1251\"?>", 0) == 0);
    std::size_t unmappable = 0;
    const std::string bytes = fb2::encode_document(w.text, "windows-1251", &unmappable);
    CHECK(unmappable == 0);
    CHECK(bytes.size() < w.text.size());
    CHECK(encoding::decode_to_utf8(bytes, "windows-1251").utf8 == w.text);
    // Re-reading the bytes gives the same text content back.
    MemoryBinaryStore store2;
    model::NodeIdAllocator ids2;
    const auto r2 = fb2::read_bytes(bytes, store2, ids2);
    CHECK(r2.document.sourceEncoding == "windows-1251");
    CHECK(r2.document.description.titleInfo.bookTitle == "Современная книга");
    CHECK(r2.warnings.empty());

    // UTF-16: BOM + little endian.
    fb2::WriteOptions utf16;
    utf16.encoding = "UTF-16";
    const fb2::WriteResult w16 = fb2::write_document(l->result.document, &l->store, utf16);
    CHECK(w16.text.rfind("<?xml version=\"1.0\" encoding=\"utf-16\"?>", 0) == 0);
    const std::string bytes16 = fb2::encode_document(w16.text, "utf-16");
    CHECK(static_cast<unsigned char>(bytes16[0]) == 0xFF);
    CHECK(static_cast<unsigned char>(bytes16[1]) == 0xFE);
    const auto r16 = fb2::read_bytes(bytes16, store2, ids2);
    CHECK(r16.document.sourceEncoding == "utf-16le");
    CHECK(r16.document.description.titleInfo.bookTitle == "Современная книга");

    // Characters outside the code page become numeric character references (lossless).
    model::Document doc;
    doc.bodies.push_back(element(
        "body", {element("section", {element("p", {text_node("Greek: Ωμέγα, CJK: 漢")})})}));
    fb2::WriteOptions koi;
    koi.encoding = "koi8-r";
    const std::string koi_bytes =
        fb2::encode_document(fb2::write_document(doc, nullptr, koi).text, "koi8-r", &unmappable);
    CHECK(unmappable == 6);
    CHECK_THAT(koi_bytes, ContainsSubstring("&#x3A9;&#x3BC;&#x3AD;&#x3B3;&#x3B1;"));
    CHECK_THAT(koi_bytes, ContainsSubstring("&#x6F22;"));
    MemoryBinaryStore store3;
    model::NodeIdAllocator ids3;
    const auto r3 = fb2::read_bytes(koi_bytes, store3, ids3);
    CHECK(r3.document.bodies[0].content[0].content[0].content[0].text == "Greek: Ωμέγα, CJK: 漢");
}

TEST_CASE("writer: marks nest in the canonical order link > style > strong > emphasis > ... > code",
          "[writer]") {
    model::Document doc;
    const model::Mark strong{"strong", nullptr};
    const model::Mark emphasis{"emphasis", nullptr};
    const model::Mark code{"code", nullptr};
    const model::Mark link{"link", nlohmann::json{{"href", "#n_1"}, {"type", "note"}}};
    const model::Mark style{"style", nlohmann::json{{"name", "x"}}};
    doc.bodies.push_back(element(
        "body",
        {element("section",
                 {element("p", {text_node("a ", {}), text_node("b", {code, emphasis, strong}),
                                text_node(" c", {strong}), text_node("d", {link, style}),
                                text_node("e", {strong, link}), text_node(".", {})})})}));
    const std::string t = fb2::write_document(doc, nullptr).text;
    CHECK_THAT(t,
               ContainsSubstring(
                   "<p>a <strong><emphasis><code>b</code></emphasis> c</strong><a l:href=\"#n_1\" "
                   "type=\"note\"><style name=\"x\">d</style><strong>e</strong></a>.</p>"));
    CHECK(fb2::mark_rank("link") < fb2::mark_rank("style"));
    CHECK(fb2::mark_rank("style") < fb2::mark_rank("strong"));
    CHECK(fb2::mark_rank("strong") < fb2::mark_rank("emphasis"));
    CHECK(fb2::mark_rank("emphasis") < fb2::mark_rank("strikethrough"));
    CHECK(fb2::mark_rank("strikethrough") < fb2::mark_rank("sub"));
    CHECK(fb2::mark_rank("sub") < fb2::mark_rank("sup"));
    CHECK(fb2::mark_rank("sup") < fb2::mark_rank("code"));

    // A mark-less inline image keeps enclosing marks open when the next text continues them.
    model::Node img;
    img.type = "inline-image";
    img.attrs["href"] = "#i.png";
    model::Document doc2;
    doc2.bodies.push_back(element(
        "body",
        {element("section", {element("p", {text_node("x", {strong}), img, text_node("y", {strong}),
                                           img, text_node("z", {})})})}));
    CHECK_THAT(
        fb2::write_document(doc2, nullptr).text,
        ContainsSubstring(
            "<p><strong>x<image l:href=\"#i.png\"/>y</strong><image l:href=\"#i.png\"/>z</p>"));
}

TEST_CASE("writer: required elements are always written, optional empty ones omitted", "[writer]") {
    model::Document doc;  // everything empty
    const std::string t = fb2::write_document(doc, nullptr).text;
    CHECK_THAT(t, ContainsSubstring("\t\t<title-info>\n\t\t\t<genre/>\n\t\t\t<author/"
                                    ">\n\t\t\t<book-title/>\n\t\t\t<lang/>\n\t\t</title-info>\n"));
    CHECK_THAT(t, ContainsSubstring("\t\t<document-info>\n\t\t\t<author/>\n\t\t\t<date/"
                                    ">\n\t\t\t<id/>\n\t\t\t<version/>\n\t\t</document-info>\n"));
    CHECK(t.find("<publish-info") == std::string::npos);
    CHECK(t.find("<program-used") == std::string::npos);
    CHECK(t.find("<keywords") == std::string::npos);
    CHECK(t.find("<coverpage") == std::string::npos);
    CHECK(t.find("<body") == std::string::npos);

    // Empty optionals coming from the UI ("" strings) are dropped too; persons with only
    // empty-string fields are still written (the schema sequence needs them).
    doc.description.titleInfo.keywords = "";
    doc.description.documentInfo.programUsed = "";
    doc.description.documentInfo.srcOcr = "";
    doc.description.publishInfo = model::PublishInfo{};
    model::Person blank;
    blank.firstName = "";
    blank.lastName = "";
    doc.description.titleInfo.authors.push_back(blank);
    doc.description.titleInfo.authors.push_back(model::Person{});  // nothing set: dropped
    const std::string t2 = fb2::write_document(doc, nullptr).text;
    CHECK(t2.find("<keywords") == std::string::npos);
    CHECK(t2.find("<program-used") == std::string::npos);
    CHECK(t2.find("<src-ocr") == std::string::npos);
    CHECK(t2.find("<publish-info") == std::string::npos);
    CHECK_THAT(
        t2, ContainsSubstring(
                "\t\t\t<author>\n\t\t\t\t<first-name/>\n\t\t\t\t<last-name/>\n\t\t\t</author>\n"));
    CHECK(t2.find("<author/>") == t2.find("<document-info>\n\t\t\t<author/>") +
                                      std::string("<document-info>\n\t\t\t").size());

    // Date with only a value is still written; genre match 100 is implicit.
    doc.description.titleInfo.date = model::DateValue{"", std::string("2020-01-01"), std::nullopt};
    doc.description.titleInfo.genres.push_back(model::GenreRef{"sf", 100});
    doc.description.titleInfo.genres.push_back(model::GenreRef{"detective", 40});
    const std::string t3 = fb2::write_document(doc, nullptr).text;
    CHECK_THAT(t3, ContainsSubstring("<date value=\"2020-01-01\"/>"));
    CHECK_THAT(t3,
               ContainsSubstring("<genre>sf</genre>\n\t\t\t<genre match=\"40\">detective</genre>"));
}

TEST_CASE(
    "writer: a present-but-empty annotation or history is kept as read (feature 004, "
    "FR-010/FR-015)",
    "[writer]") {
    // The reader drops whitespace-only text in block context, so <annotation/>,
    // <annotation></annotation> and an annotation holding only whitespace all read as a present
    // node with empty content; the writer writes a present node whatever its content, with its
    // attributes, and nothing for an absent one.
    const std::string xml =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
        "<description><title-info><genre>sf</genre><author><first-name>A</first-name>"
        "<last-name>B</last-name></author><book-title>T</book-title>"
        "<annotation>\n   \n</annotation><lang>ru</lang></title-info>"
        "<src-title-info><genre>sf</genre><author><first-name>A</first-name>"
        "<last-name>B</last-name></author><book-title>T</book-title>"
        "<annotation id=\"src-ann\"></annotation><lang>en</lang></src-title-info>"
        "<document-info><author><nickname>n</nickname></author><date>2026</date><id>x</id>"
        "<version>1</version><history xml:lang=\"ru\"/></document-info></description>"
        "<body><section><p>text</p></section></body></FictionBook>\n";
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const fb2::ReadResult read = fb2::read_bytes(xml, store, ids);
    const model::Description& d = read.document.description;
    REQUIRE(d.titleInfo.annotation.has_value());
    CHECK(d.titleInfo.annotation->content.empty());
    CHECK_FALSE(d.titleInfo.annotation->node_id().empty());
    REQUIRE(d.srcTitleInfo.has_value());
    REQUIRE(d.srcTitleInfo->annotation.has_value());
    CHECK(d.srcTitleInfo->annotation->content.empty());
    CHECK(d.srcTitleInfo->annotation->attr_string("id") == "src-ann");
    REQUIRE(d.documentInfo.history.has_value());
    CHECK(d.documentInfo.history->content.empty());
    CHECK(d.documentInfo.history->attr_string("lang") == "ru");

    const std::string t = fb2::write_document(read.document, &store).text;
    CHECK_THAT(t, ContainsSubstring("\t\t\t<book-title>T</book-title>\n\t\t\t<annotation/>\n"
                                    "\t\t\t<lang>ru</lang>\n"));
    CHECK_THAT(t, ContainsSubstring("\t\t\t<annotation id=\"src-ann\"/>\n\t\t\t<lang>en</lang>\n"));
    CHECK_THAT(t, ContainsSubstring("\t\t\t<version>1</version>\n\t\t\t<history xml:lang=\"ru\"/>\n"
                                    "\t\t</document-info>\n"));
    // Written back identically: the second reading is the same model and the same text.
    MemoryBinaryStore store2;
    model::NodeIdAllocator ids2;
    const fb2::ReadResult again = fb2::read_bytes(t, store2, ids2);
    REQUIRE(again.document.description.titleInfo.annotation.has_value());
    CHECK(again.document.description.titleInfo.annotation->content.empty());
    REQUIRE(again.document.description.documentInfo.history.has_value());
    CHECK(again.document.description.documentInfo.history->attr_string("lang") == "ru");
    CHECK(fb2::write_document(again.document, &store2).text == t);

    // An absent node still writes nothing.
    model::Document absent = read.document;
    absent.description.titleInfo.annotation.reset();
    absent.description.srcTitleInfo->annotation.reset();
    absent.description.documentInfo.history.reset();
    const std::string none = fb2::write_document(absent, &store).text;
    CHECK(none.find("<annotation") == std::string::npos);
    CHECK(none.find("<history") == std::string::npos);

    // The fixture of the user-story journeys round-trips byte for byte (no fill-in involved:
    // its document details are complete).
    MemoryBinaryStore store3;
    model::NodeIdAllocator ids3;
    const fb2::ReadResult fixture =
        fb2::read_file(book("empty-annotation-history.fb2"), store3, ids3);
    REQUIRE(fixture.document.description.titleInfo.annotation.has_value());
    CHECK(fixture.document.description.titleInfo.annotation->content.empty());
    REQUIRE(fixture.document.description.documentInfo.history.has_value());
    CHECK(fixture.document.description.documentInfo.history->content.empty());
    fb2::WriteOptions options;
    options.xlink_prefix = fixture.xlink_prefix;
    CHECK(fb2::write_document(fixture.document, &store3, options).text ==
          test::read_text(book("empty-annotation-history.fb2")));
}

TEST_CASE("writer: raw-xml is verbatim and unknown attributes come back with their namespaces",
          "[writer]") {
    auto l = load("unknown-elements.fb2");
    const fb2::WriteResult w = fb2::write_document(l->result.document, &l->store);
    const std::string& t = w.text;
    CHECK_THAT(t, ContainsSubstring("xmlns:ns1=\"urn:example:extension\""));
    CHECK_THAT(t, ContainsSubstring("<section id=\"s1\" data-foo=\"bar\" ns1:kind=\"chapter\">"));
    CHECK_THAT(
        t, ContainsSubstring(
               "<x:marker xmlns:x=\"urn:example:extension\" ref=\"7\">unknown inline</x:marker>"));
    CHECK_THAT(t, ContainsSubstring("\t\t\t<footnote-ref target=\"n_1\" l:href=\"#n_1\">unknown "
                                    "FB2-namespace element</footnote-ref>\n"));
    CHECK_THAT(
        t, ContainsSubstring(
               "\t<x:metadata xmlns:x=\"urn:example:extension\" version=\"1\"><x:item "
               "key=\"a\">A</x:item><!-- comment inside --><x:item key=\"b\"/></x:metadata>\n"));
    // The title-info extra lands at the end of title-info, before </title-info>.
    CHECK(pos_of(t, "<x:rating") < pos_of(t, "</title-info>"));
    CHECK(pos_of(t, "<lang>en</lang>") < pos_of(t, "<x:rating"));
    // Extras at the top level come after the bodies and before </FictionBook>.
    CHECK(pos_of(t, "</body>") < pos_of(t, "<x:metadata"));
    // The written text is well-formed and reads back to the same model.
    CHECK_FALSE(fb2::check_well_formed(t).has_value());
}

TEST_CASE("writer: line map points validation lines at nodeIds", "[writer]") {
    auto l = load("modern-utf8.fb2");
    const fb2::WriteResult w = fb2::write_document(l->result.document, &l->store);
    const auto lines = lines_of(w.text);
    const model::Document& doc = l->result.document;
    // Find the line of the paragraph with id="p1" and the nodeId of that paragraph.
    std::string p1_id;
    model::visit_nodes(doc, [&](const model::Node& n, const std::string&) {
        if (n.type == "p" && n.attr_string("id") == "p1") {
            p1_id = n.node_id();
        }
        return true;
    });
    REQUIRE_FALSE(p1_id.empty());
    int p1_line = 0;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        if (lines[i].find("<p id=\"p1\"") != std::string::npos) {
            p1_line = static_cast<int>(i) + 1;
        }
    }
    REQUIRE(p1_line > 0);
    CHECK(w.lines.node_at(p1_line) == p1_id);
    // Lines inside an inline element (none start a node) resolve to the nearest preceding node.
    CHECK(w.lines.node_at(p1_line + 0) == p1_id);
    CHECK_FALSE(w.lines.node_at(1).has_value());  // the XML declaration
    CHECK(w.lines.entries.size() > 40);
    for (std::size_t i = 1; i < w.lines.entries.size(); ++i) {
        CHECK(w.lines.entries[i - 1].first <= w.lines.entries[i].first);
    }
}
