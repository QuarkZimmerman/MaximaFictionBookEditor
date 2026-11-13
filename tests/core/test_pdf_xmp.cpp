// Feature 014 (D14-D16, DP-10, contracts/pdf-file.md "Metadata"; tasks T033): the PDF's metadata
// from the book's description, and the Info dictionary equal to it.

#include "pdf/document.hpp"
#include "pdf/finish.hpp"
#include "pdf/xmp.hpp"
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/pdf.hpp>

#include <libxml/parser.h>

#include <Dict.h>
#include <Object.h>
#include <PDFDoc.h>
#include <Stream.h>
#include <XRef.h>
#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

model::Description description() {
    model::Description d;
    d.titleInfo.bookTitle = "Война и мир";
    d.titleInfo.lang = "ru";
    model::Person tolstoy;
    tolstoy.firstName = "Лев";
    tolstoy.middleName = "Николаевич";
    tolstoy.lastName = "Толстой";
    model::Person nick;
    nick.nickname = "Аноним";
    d.titleInfo.authors = {tolstoy, nick};
    model::Node annotation;
    annotation.type = "annotation";
    model::Node p;
    p.type = "p";
    model::Node text;
    text.type = "text";
    text.text = "Роман-эпопея \x01 о войне & мире.";
    p.content = {text};
    annotation.content = {p};
    d.titleInfo.annotation = annotation;
    d.titleInfo.keywords = "война, мир";
    d.titleInfo.date = model::DateValue{"1869", std::string("1869-01-01"), std::nullopt};
    model::Person translator;
    translator.firstName = "Louise";
    translator.lastName = "Maude";
    d.titleInfo.translators = {translator};
    d.documentInfo.id = "8b2f8a7e-3c1d-4e5f-9a0b-1c2d3e4f5a6b";
    model::PublishInfo publish;
    publish.publisher = "Русский вестник";
    publish.isbn = "978-5-00000-000-0";
    d.publishInfo = publish;
    return d;
}

std::vector<char> sample() {
    const std::string bytes =
        atomic_file::read_file(test::fixtures_dir() / "pdf" / "chromium-sample.pdf");
    return std::vector<char>(bytes.begin(), bytes.end());
}

std::string info_text(const Object& info, const char* key) {
    const Object value = info.dictLookup(key);
    if (!value.isString())
        return {};
    const std::string& raw = value.getString();
    if (raw.size() < 2 || raw[0] != '\xFE' || raw[1] != '\xFF')
        return raw;
    std::string out;  // UTF-16BE to UTF-8 (BMP only, enough here)
    for (std::size_t i = 2; i + 1 < raw.size(); i += 2) {
        const unsigned cp =
            (static_cast<unsigned char>(raw[i]) << 8) | static_cast<unsigned char>(raw[i + 1]);
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    return out;
}

}  // namespace

TEST_CASE("pdf xmp: the description's values, the editor's record and its schema", "[pdf]") {
    pdf::XmpInput input;
    input.description = description();
    input.description_xml =
        "<description><title-info><book-title>Война и мир</book-title></title-info></description>";
    input.genre_names = {"Классическая проза"};
    input.hints = "{\"v\":1}";
    input.creator_tool = "Maxima Fiction Book Editor test";
    input.instance_id = "uuid:00000000-0000-4000-8000-000000000000";
    input.date = "2026-11-13T00:00:00Z";
    const std::string xmp = pdf::xmp_packet(input);

    // Well formed (libxml2), and the values of contracts/pdf-file.md's table.
    xmlDocPtr doc = xmlReadMemory(xmp.data(), static_cast<int>(xmp.size()), "xmp.xml", nullptr,
                                  XML_PARSE_NONET);
    REQUIRE(doc != nullptr);
    xmlFreeDoc(doc);
    CHECK(xmp.find("<pdfaid:part>2</pdfaid:part><pdfaid:conformance>U</pdfaid:conformance>") !=
          std::string::npos);
    CHECK(xmp.find("<rdf:li xml:lang=\"x-default\">Война и мир</rdf:li><rdf:li "
                   "xml:lang=\"ru\">Война и мир</rdf:li>") != std::string::npos);
    CHECK(xmp.find("<dc:creator><rdf:Seq><rdf:li>Лев Николаевич "
                   "Толстой</rdf:li><rdf:li>Аноним</rdf:li></rdf:Seq></dc:creator>") !=
          std::string::npos);
    // The control character XML forbids is dropped and the spaces around it squeezed (D22), as in
    // the Info dictionary.
    CHECK(xmp.find("Роман-эпопея о войне &amp; мире.") != std::string::npos);
    CHECK(xmp.find(
              "<dc:subject><rdf:Bag><rdf:li>Классическая "
              "проза</rdf:li><rdf:li>война</rdf:li><rdf:li>мир</rdf:li></rdf:Bag></dc:subject>") !=
          std::string::npos);
    CHECK(xmp.find("<dc:date><rdf:Seq><rdf:li>1869-01-01</rdf:li></rdf:Seq></dc:date>") !=
          std::string::npos);
    CHECK(xmp.find(
              "<dc:publisher><rdf:Bag><rdf:li>Русский вестник</rdf:li></rdf:Bag></dc:publisher>") !=
          std::string::npos);
    CHECK(
        xmp.find(
            "<dc:contributor><rdf:Bag><rdf:li>Louise Maude</rdf:li></rdf:Bag></dc:contributor>") !=
        std::string::npos);
    CHECK(xmp.find(
              "<xmpMM:DocumentID>uuid:8b2f8a7e-3c1d-4e5f-9a0b-1c2d3e4f5a6b</xmpMM:DocumentID>") !=
          std::string::npos);
    CHECK(xmp.find("<xmpidq:Scheme>ISBN</xmpidq:Scheme><rdf:value>978-5-00000-000-0</rdf:value>") !=
          std::string::npos);
    CHECK(xmp.find("<pdf:Keywords>война, мир</pdf:Keywords>") != std::string::npos);
    CHECK(xmp.find("<mfbe:recordVersion>1</mfbe:recordVersion>") != std::string::npos);
    CHECK(xmp.find("<mfbe:fb2Description>&lt;description&gt;") != std::string::npos);
    CHECK(xmp.find("<mfbe:fb2Hints>{&quot;v&quot;:1}</mfbe:fb2Hints>") != std::string::npos);
    for (const char* name : {"recordVersion", "fb2Description", "fb2Hints"}) {
        CHECK(xmp.find(std::string("<pdfaProperty:name>") + name + "</pdfaProperty:name>") !=
              std::string::npos);
    }
    CHECK(xmp.find("<pdfaProperty:category>internal</pdfaProperty:category>") != std::string::npos);
    CHECK(pdf::document_id("not-a-uuid") == "not-a-uuid");
    CHECK(pdf::xml_text("a\x01"
                        "b\x0B"
                        "c<") == "abc&lt;");
}

TEST_CASE("pdf xmp: the finished file's Info equals its XMP, which is compressed", "[pdf]") {
    pdf::FinishInput input;
    input.width_pt = 420;
    input.height_pt = 595;
    input.title = "ignored when a description is given";
    input.lang = "ru";
    input.creator_tool = "Maxima Fiction Book Editor test";
    input.description = description();
    const std::vector<char> finished = pdf::finish(sample(), input);
    std::string error;
    auto doc = pdf::Document::open_bytes(finished, &error);
    REQUIRE(doc);
    PDFDoc& d = *doc->impl().doc;
    const Object info = d.getDocInfo();
    REQUIRE(info.isDict());
    CHECK(info_text(info, "Title") == "Война и мир");
    CHECK(info_text(info, "Author") == "Лев Николаевич Толстой, Аноним");
    CHECK(info_text(info, "Subject") == "Роман-эпопея о войне & мире.");
    CHECK(info_text(info, "Keywords") == "война, мир");
    const Object catalog = d.getXRef()->getCatalog();
    Object metadata = catalog.dictLookup("Metadata");
    REQUIRE(metadata.isStream());
    CHECK(metadata.streamGetDict()->lookup("Filter").isName("FlateDecode"));
    REQUIRE(metadata.getStream()->rewind());
    const auto decoded = metadata.getStream()->toUnsignedChars();
    const std::string xmp(decoded.begin(), decoded.end());
    CHECK(xmp.find("<rdf:li>Лев Николаевич Толстой</rdf:li>") != std::string::npos);
    CHECK(xmp.find("<xmpMM:InstanceID>uuid:") != std::string::npos);
}
