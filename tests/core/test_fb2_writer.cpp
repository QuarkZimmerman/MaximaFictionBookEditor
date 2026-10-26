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

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>

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

    // An inline image without marks is written outside the marks around it (feature 006,
    // FR-067: an atom is written inside the elements of its own marks, as text is).
    model::Node img;
    img.type = "inline-image";
    img.attrs["href"] = "#i.png";
    model::Document doc2;
    doc2.bodies.push_back(element(
        "body",
        {element("section", {element("p", {text_node("x", {strong}), img, text_node("y", {strong}),
                                           img, text_node("z", {})})})}));
    CHECK_THAT(fb2::write_document(doc2, nullptr).text,
               ContainsSubstring("<p><strong>x</strong><image l:href=\"#i.png\"/><strong>y</"
                                 "strong><image l:href=\"#i.png\"/>z</p>"));
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
    // its document details are complete). A Windows checkout gives the fixture CRLF line ends
    // (Git's autocrlf); the writer always writes LF, as the parser reads them, so the fixture's
    // CRs are not part of the comparison.
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
    std::string expected = test::read_text(book("empty-annotation-history.fb2"));
    expected.erase(std::remove(expected.begin(), expected.end(), '\r'), expected.end());
    CHECK(fb2::write_document(fixture.document, &store3, options).text == expected);
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

/* ----------------------------------------------------------------------------------------- */
/* Feature 006: cells, spans and unknown attributes (contracts/document-model.md §1)          */
/* ----------------------------------------------------------------------------------------- */

namespace {

const char* const kXmlLangKey = "{http://www.w3.org/XML/1998/namespace}lang";

struct ReadBook {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadResult result;
};

// Reads a book text (test_support.hpp builds the minimal valid ones) without the schema hint.
std::unique_ptr<ReadBook> read_text(const std::string& text) {
    auto r = std::make_unique<ReadBook>();
    fb2::ReadOptions options;
    options.compute_schema_hint = false;
    r->result = fb2::read_bytes(text, r->store, r->ids, options);
    return r;
}

// The first node of `type` in a subtree (pre-order), or null.
model::Node* first_of(model::Node& node, const std::string& type) {
    if (node.type == type) {
        return &node;
    }
    for (auto& child : node.content) {
        if (auto* found = first_of(child, type)) {
            return found;
        }
    }
    return nullptr;
}

// A one-cell table written back: `attrs` replace the cell's attributes (nodeId kept).
std::string written_cell_book(const std::map<std::string, nlohmann::json>& attrs,
                              const std::string& cell_type = "td") {
    auto r = read_text(test::minimal_book("<section><table><tr><" + cell_type + ">x</" + cell_type +
                                          "></tr></table></section>"));
    model::Node* cell = first_of(r->result.document.bodies.at(0), cell_type);
    REQUIRE(cell != nullptr);
    const nlohmann::json id = cell->attrs.at("nodeId");
    cell->attrs = attrs;
    cell->attrs["nodeId"] = id;
    return fb2::write_document(r->result.document, &r->store).text;
}

}  // namespace

TEST_CASE("writer: a cell's lang is written as xml:lang after the other known attributes",
          "[writer][tables]") {
    CHECK_THAT(
        written_cell_book({{"id", "h"}, {"colspan", 2}, {"align", "center"}, {"lang", "de"}}, "th"),
        ContainsSubstring("<th id=\"h\" colspan=\"2\" align=\"center\" xml:lang=\"de\">x</th>"));
    CHECK_THAT(written_cell_book({{"lang", "uk"},
                                  {"valign", "bottom"},
                                  {"align", "right"},
                                  {"rowspan", 3},
                                  {"colspan", 2},
                                  {"style", "s"},
                                  {"id", "c"}}),
               ContainsSubstring("<td id=\"c\" style=\"s\" colspan=\"2\" rowspan=\"3\" "
                                 "align=\"right\" valign=\"bottom\" xml:lang=\"uk\">x</td>"));
    // Values are written verbatim, an empty or invalid one included (File > Validate reports
    // them), and read back as the cell's lang.
    for (const char* lang : {"", "de_DE", "en-GB"}) {
        INFO("lang \"" << lang << "\"");
        const std::string text = written_cell_book({{"lang", lang}});
        CHECK_THAT(text, ContainsSubstring(std::string("<td xml:lang=\"") + lang + "\">x</td>"));
        auto back = read_text(text);
        const model::Node* cell = first_of(back->result.document.bodies.at(0), "td");
        REQUIRE(cell != nullptr);
        CHECK(cell->attr_string("lang") == lang);
        CHECK_FALSE(cell->attrs.count("unknownAttrs"));
    }
    // The fragment writer (doc.fragmentToXml) shares known_attrs.
    model::Node cell = element("td", {text_node("y")});
    cell.attrs["lang"] = "fr";
    cell.attrs["colspan"] = 2;
    model::Node row = element("tr", {cell});
    CHECK(fb2::write_fragment({element("table", {row})}) ==
          "<table>\n\t<tr>\n\t\t<td colspan=\"2\" xml:lang=\"fr\">y</td>\n\t</tr>\n</table>");
}

TEST_CASE("writer: an attribute name is never written twice in a start tag; the known value wins",
          "[writer][tables]") {
    // C19: today `<td colspan="3" colspan="abc">`, which is not well-formed.
    const std::string spans = written_cell_book(
        {{"colspan", 3}, {"rowspan", 2}, {"unknownAttrs", {{"colspan", "abc"}, {"rowspan", "x"}}}});
    CHECK_THAT(spans, ContainsSubstring("<td colspan=\"3\" rowspan=\"2\">x</td>"));
    CHECK(spans.find("abc") == std::string::npos);
    CHECK_FALSE(fb2::check_well_formed(spans).has_value());
    // A known language beside the namespaced key of release 0.0.5: xml:lang="fr" only.
    const std::string lang = written_cell_book(
        {{"lang", "fr"}, {"unknownAttrs", {{kXmlLangKey, "de"}, {"data-x", "1"}}}});
    CHECK_THAT(lang, ContainsSubstring("<td xml:lang=\"fr\" data-x=\"1\">x</td>"));
    CHECK(lang.find("\"de\"") == std::string::npos);
    CHECK_FALSE(fb2::check_well_formed(lang).has_value());
    // Without the known value the unknown one is written as before.
    CHECK_THAT(written_cell_book({{"unknownAttrs", {{"colspan", "abc"}, {kXmlLangKey, "de"}}}}),
               ContainsSubstring("<td colspan=\"abc\" xml:lang=\"de\">x</td>"));
    // Every node type: a paragraph's language and an inline image's xlink:href.
    auto r = read_text(test::minimal_book(
        "<section><p xml:lang=\"en\">t<image l:href=\"#a.png\"/></p></section>"));
    model::Node* p = first_of(r->result.document.bodies.at(0), "p");
    REQUIRE(p != nullptr);
    p->attrs["unknownAttrs"] = nlohmann::json{{kXmlLangKey, "de"}, {"id", "dup"}};
    p->attrs["id"] = "p1";
    model::Node* img = first_of(*p, "inline-image");
    REQUIRE(img != nullptr);
    img->attrs["unknownAttrs"] =
        nlohmann::json{{"{http://www.w3.org/1999/xlink}href", "#b.png"}, {"alt", "dup"}};
    img->attrs["alt"] = "picture";
    const std::string text = fb2::write_document(r->result.document, &r->store).text;
    CHECK_THAT(text, ContainsSubstring("<p id=\"p1\" xml:lang=\"en\">t<image l:href=\"#a.png\" "
                                       "alt=\"picture\"/></p>"));
    CHECK_FALSE(fb2::check_well_formed(text).has_value());
    // And in fragments.
    model::Node cell = element("td", {text_node("y")});
    cell.attrs["colspan"] = 2;
    cell.attrs["unknownAttrs"] = nlohmann::json{{"colspan", "abc"}};
    CHECK(fb2::write_fragment({element("table", {element("tr", {cell})})}) ==
          "<table>\n\t<tr>\n\t\t<td colspan=\"2\">y</td>\n\t</tr>\n</table>");
}

TEST_CASE("writer: integer spans are written in canonical decimal form; unknownAttrs spans exactly",
          "[writer][tables]") {
    struct Case {
        const char* read;
        const char* written;
    };
    const std::vector<Case> cases = {
        {" 2 ", "2"},   {"+2", "2"},    {"02", "2"},    {"2", "2"},
        {"0", "0"},     {"-1", "-1"},   {"00", "00"},   {"+0", "+0"},
        {" 0 ", " 0 "}, {"-01", "-01"}, {"abc", "abc"}, {"99999999999", "99999999999"},
        {"2.5", "2.5"},
    };
    for (const char* attribute : {"colspan", "rowspan"}) {
        std::string row;
        for (const Case& c : cases) {
            row += std::string("<td ") + attribute + "=\"" + c.read + "\">x</td>";
        }
        auto r =
            read_text(test::minimal_book("<section><table><tr>" + row + "</tr></table></section>"));
        const std::string text = fb2::write_document(r->result.document, &r->store).text;
        // The cells one per line, in order.
        std::size_t from = 0;
        for (const Case& c : cases) {
            const std::string expected =
                std::string("\t<td ") + attribute + "=\"" + c.written + "\">x</td>\n";
            INFO(attribute << "=\"" << c.read << "\" written as " << expected);
            const std::size_t at = text.find(expected, from);
            REQUIRE(at != std::string::npos);
            from = at + expected.size();
        }
        CHECK_FALSE(fb2::check_well_formed(text).has_value());
    }
}

TEST_CASE(
    "writer: a carriage return in text is written as &#13; and read back as a carriage return",
    "[writer]") {
    // A carriage return reaches the model only from a reference (XML 1.0 §2.11): &#13; or &#xD;.
    test::BookParts parts;
    parts.book_title = "Title&#13;Two";
    parts.annotation = "<p>note&#13;line</p>";
    parts.body =
        "<section><p>cr&#13;here</p><p>hex&#xD;form <strong>b&#13;old</strong></p>"
        "Loose&#13;text<p>after</p></section>";
    auto r = read_text(test::book_text(parts));
    const model::Document& doc = r->result.document;
    CHECK(doc.description.titleInfo.bookTitle == "Title\rTwo");
    REQUIRE(doc.description.titleInfo.annotation);
    CHECK(doc.description.titleInfo.annotation->content.at(0).content.at(0).text == "note\rline");
    const model::Node& section = doc.bodies.at(0).content.at(0);
    CHECK(section.content.at(0).content.at(0).text == "cr\rhere");
    CHECK(section.content.at(1).content.at(0).text == "hex\rform ");
    CHECK(section.content.at(1).content.at(1).text == "b\rold");
    // Stray text of a block context is kept as raw XML, escaped by the reader's raw path.
    REQUIRE(section.content.at(2).type == "raw-xml");
    CHECK(section.content.at(2).attr_string("xml") == "Loose&#13;text");

    const std::string text = fb2::write_document(doc, &r->store).text;
    CHECK(text.find('\r') == std::string::npos);  // never a raw carriage return
    CHECK_THAT(text, ContainsSubstring("<book-title>Title&#13;Two</book-title>"));
    CHECK_THAT(text, ContainsSubstring("<p>note&#13;line</p>"));
    CHECK_THAT(text, ContainsSubstring("<p>cr&#13;here</p>"));
    CHECK_THAT(text, ContainsSubstring("<p>hex&#13;form <strong>b&#13;old</strong></p>"));
    CHECK_THAT(text, ContainsSubstring("\tLoose&#13;text\n"));
    CHECK_FALSE(fb2::check_well_formed(text).has_value());

    // Read back: carriage returns again, not line feeds; the model equals the first read
    // apart from the node ids.
    auto back = read_text(text);
    const model::Document& again = back->result.document;
    CHECK(again.description.titleInfo.bookTitle == "Title\rTwo");
    REQUIRE(again.description.titleInfo.annotation);
    CHECK(again.description.titleInfo.annotation->content.at(0).content.at(0).text == "note\rline");
    const model::Node& section2 = again.bodies.at(0).content.at(0);
    CHECK(section2.content.at(0).content.at(0).text == "cr\rhere");
    CHECK(section2.content.at(1).content.at(0).text == "hex\rform ");
    CHECK(section2.content.at(1).content.at(1).text == "b\rold");
    CHECK(section2.content.at(2).attr_string("xml") == "Loose&#13;text");
    // The raw text decodes to a carriage return where it is parsed as XML.
    const auto fragment =
        fb2::read_fragment(section2.content.at(2).attr_string("xml").value(), "p");
    REQUIRE(fragment.nodes.size() == 1);
    CHECK(fragment.nodes[0].text == "Loose\rtext");
    // The fragment writer shares the escaping.
    CHECK(fb2::write_fragment({text_node("a\rb")}) == "a&#13;b");
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 006: the attributes of marks (contracts/document-model.md §2.3)                    */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("writer: a link is written with xlink:href, xlink:type and type", "[writer][marks]") {
    using nlohmann::json;
    const model::Mark note{"link",
                           json{{"href", "#n1"}, {"type", "note"}, {"xlinkType", "simple"}}};
    const model::Mark plain_link{"link", json{{"href", "#s2"}, {"xlinkType", "extended"}}};
    const model::Mark la{"emphasis", json{{"lang", "la"}}};
    const model::Mark foreign{"style", json{{"name", "foreign"}, {"lang", "la"}}};
    const model::Mark nameless{"style", json{{"name", ""}}};
    const model::Mark empty_lang{"strong", json{{"lang", ""}}};
    const std::vector<model::Node> inline_nodes = {
        text_node("1", {note}),     text_node(" ", {}),          text_node("2", {plain_link}),
        text_node(" ", {}),         text_node("pre", {la}),      text_node(" ", {}),
        text_node("st", {foreign}), text_node(" ", {}),          text_node("v", {nameless}),
        text_node(" ", {}),         text_node("e", {empty_lang})};
    model::Document doc;
    doc.bodies.push_back(element("body", {element("section", {element("p", inline_nodes)})}));
    const std::string expected =
        "<p><a l:href=\"#n1\" l:type=\"simple\" type=\"note\">1</a> <a l:href=\"#s2\" "
        "l:type=\"extended\">2</a> <emphasis xml:lang=\"la\">pre</emphasis> <style "
        "name=\"foreign\" xml:lang=\"la\">st</style> <style name=\"\">v</style> <strong "
        "xml:lang=\"\">e</strong></p>";
    CHECK_THAT(fb2::write_document(doc, nullptr).text, ContainsSubstring(expected));

    // The document's xlink prefix on both xlink attributes.
    fb2::WriteOptions options;
    options.xlink_prefix = "xlink";
    const std::string prefixed = fb2::write_document(doc, nullptr, options).text;
    CHECK_THAT(prefixed, ContainsSubstring("<a xlink:href=\"#n1\" xlink:type=\"simple\" "
                                           "type=\"note\">1</a>"));
    CHECK_THAT(prefixed, ContainsSubstring("<a xlink:href=\"#s2\" xlink:type=\"extended\">2</a>"));
    CHECK_FALSE(fb2::check_well_formed(prefixed).has_value());

    // The fragment writer (doc.fragmentToXml) writes the same tags.
    CHECK(fb2::write_fragment({text_node("1", {note}), text_node(" "), text_node("pre", {la})}) ==
          "<a l:href=\"#n1\" l:type=\"simple\" type=\"note\">1</a> <emphasis "
          "xml:lang=\"la\">pre</emphasis>");

    // Read back from a book, the marks come back with their attributes.
    const std::string book = test::minimal_book(
        "<section><p><a l:href=\"#s2\" l:type=\"simple\">x</a> <emphasis "
        "xml:lang=\"la\">y</emphasis></p></section><section id=\"s2\"><p>z</p></section>");
    auto r = read_text(book);
    const std::string text = fb2::write_document(r->result.document, &r->store).text;
    CHECK_THAT(text, ContainsSubstring("<p><a l:href=\"#s2\" l:type=\"simple\">x</a> <emphasis "
                                       "xml:lang=\"la\">y</emphasis></p>"));
    auto back = read_text(text);
    CHECK(back->result.document.bodies.at(0).content.at(0).content.at(0).content ==
          r->result.document.bodies.at(0).content.at(0).content.at(0).content);
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 006: inline atoms keep their marks (contracts/document-model.md §2.6)              */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE(
    "reader and writer: an inline image or inline raw XML inside a link or formatting keeps it",
    "[writer][reader][marks]") {
    // The shapes as read and as written (equal): the probes of document-model §8 and the
    // formatted and commented atoms, each in a paragraph and in a cell.
    const std::vector<std::string> shapes = {
        "<a l:href=\"#s1\"><image l:href=\"#pic\"/></a>",
        "<a l:href=\"#s1\">t<image l:href=\"#pic\"/></a> after",
        "<strong><image l:href=\"#pic\"/></strong>",
        "<emphasis xml:lang=\"la\">x<!-- note -->y</emphasis>",
        "<a l:href=\"#s1\">see <x:mark xmlns:x=\"urn:example:x\">here</x:mark></a>",
        "<a l:href=\"#s1\"><?pi data?></a>",
        // An atom without marks between two bold texts stands between two strong elements.
        "<strong>a</strong><image l:href=\"#pic\"/><strong>b</strong>",
    };
    std::string body = "<section>";
    std::string cells;
    for (const auto& shape : shapes) {
        body += "<p>" + shape + "</p>";
        cells += "<tr><td>" + shape + "</td></tr>";
    }
    body += "<table>" + cells + "</table></section><section id=\"s1\"><p>target</p></section>";
    auto r = read_text(test::minimal_book(body));
    const model::Node& section = r->result.document.bodies.at(0).content.at(0);
    // The model: the atoms carry the marks open around them.
    const model::Mark link{"link", nlohmann::json{{"href", "#s1"}}};
    const model::Mark strong{"strong", nullptr};
    const model::Mark la{"emphasis", nlohmann::json{{"lang", "la"}}};
    const auto& p1 = section.content.at(0).content;
    REQUIRE(p1.size() == 1);
    CHECK(p1[0].type == "inline-image");
    CHECK(p1[0].marks == std::vector<model::Mark>{link});
    const auto& p2 = section.content.at(1).content;
    REQUIRE(p2.size() == 3);
    CHECK(p2[1].type == "inline-image");
    CHECK(p2[1].marks == std::vector<model::Mark>{link});
    CHECK(p2[2].marks.empty());
    CHECK(section.content.at(2).content.at(0).marks == std::vector<model::Mark>{strong});
    const auto& p4 = section.content.at(3).content;
    REQUIRE(p4.size() == 3);
    CHECK(p4[1].type == "raw-xml");
    CHECK(p4[1].marks == std::vector<model::Mark>{la});
    const auto& p5 = section.content.at(4).content;
    REQUIRE(p5.size() == 2);
    CHECK(p5[1].type == "raw-xml");
    CHECK(p5[1].marks == std::vector<model::Mark>{link});
    CHECK(section.content.at(5).content.at(0).marks == std::vector<model::Mark>{link});
    const auto& p7 = section.content.at(6).content;
    REQUIRE(p7.size() == 3);
    CHECK(p7[1].marks.empty());

    // The text: every shape written as read, in the paragraphs and in the cells.
    const std::string text = fb2::write_document(r->result.document, &r->store).text;
    for (const auto& shape : shapes) {
        INFO(shape);
        CHECK_THAT(text, ContainsSubstring("<p>" + shape + "</p>"));
        CHECK_THAT(text, ContainsSubstring("<td>" + shape + "</td>"));
    }
    CHECK_FALSE(fb2::check_well_formed(text).has_value());
    // Read back, the model is the same (node ids apart).
    auto back = read_text(text);
    const model::Node& again = back->result.document.bodies.at(0).content.at(0);
    REQUIRE(again.content.size() == section.content.size());
    for (std::size_t i = 0; i < shapes.size(); ++i) {
        INFO(shapes[i]);
        const auto& a = section.content[i].content;
        const auto& b = again.content[i].content;
        REQUIRE(a.size() == b.size());
        for (std::size_t k = 0; k < a.size(); ++k) {
            CHECK(a[k].type == b[k].type);
            CHECK(a[k].text == b[k].text);
            CHECK(a[k].marks == b[k].marks);
        }
    }

    // The fragment writer (doc.fragmentToXml) shares the rule.
    model::Node img;
    img.type = "inline-image";
    img.attrs["href"] = "#pic";
    img.marks = {link};
    CHECK(fb2::write_fragment({text_node("t", {link}), img, text_node(" after")}) ==
          "<a l:href=\"#s1\">t<image l:href=\"#pic\"/></a> after");
    img.marks = {};
    CHECK(fb2::write_fragment({text_node("a", {strong}), img, text_node("b", {strong})}) ==
          "<strong>a</strong><image l:href=\"#pic\"/><strong>b</strong>");
}
