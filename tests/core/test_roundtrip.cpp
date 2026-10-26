// T038: open -> save -> re-open equality for every fixture (structure, text, attributes, marks
// as sets, preserved unknown XML, byte-identical binaries), in several output encodings; the
// comparison itself detects real differences.
#include "test_support.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/roundtrip.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <catch2/generators/catch_generators.hpp>
#include <set>

using namespace mfbe;

namespace {

std::filesystem::path book(const char* name) {
    return test::fixtures_dir() / "books" / name;
}

}  // namespace

TEST_CASE("roundtrip: every well-formed fixture is structurally identical after save",
          "[roundtrip]") {
    const std::string name =
        GENERATE(std::string("legacy-cp1251.fb2"), std::string("modern-utf8.fb2"),
                 std::string("utf16-bom.fb2"), std::string("koi8r.fb2"),
                 std::string("unknown-elements.fb2"), std::string("descriptor.fbd"),
                 std::string("mismatched-declaration.fb2"), std::string("no-declaration.fb2"),
                 std::string("tables.fb2"), std::string("tables-invalid.fb2"));
    const std::string encoding =
        GENERATE(std::string("utf-8"), std::string("windows-1251"), std::string("utf-16"));
    INFO(name << " -> " << encoding);
    test::TempDir out{"mfbe-roundtrip"};
    const roundtrip::Report report = roundtrip::run(book(name.c_str()), out.path(), encoding);
    CHECK(report.opened);
    CHECK(report.reopened);
    for (const auto& d : report.comparison.differences) {
        FAIL_CHECK(d.where << ": " << d.what);
    }
    CHECK(report.identical);
    CHECK(report.output_encoding == encoding);
    REQUIRE(report.written_path.has_value());
    CHECK(std::filesystem::exists(*report.written_path));
    CHECK(std::filesystem::path(*report.written_path).extension() ==
          std::filesystem::path(name).extension());
    // The written file declares the chosen encoding and re-reads with it.
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const auto reread = fb2::read_file(*report.written_path, store, ids);
    CHECK(reread.document.sourceEncoding == (encoding == "utf-16" ? "utf-16le" : encoding));
    CHECK(reread.declared_encoding == encoding);
    const nlohmann::json j = report.to_json();
    CHECK(j["identical"] == true);
    CHECK(j["exitCode"] == report.exit_code());
}

TEST_CASE("roundtrip: valid fixtures stay valid; legacy ones report their original problems",
          "[roundtrip]") {
    test::TempDir out{"mfbe-roundtrip"};
    CHECK(roundtrip::run(book("modern-utf8.fb2"), out.path()).exit_code() == 0);
    CHECK(roundtrip::run(book("koi8r.fb2"), out.path()).exit_code() == 0);
    CHECK(roundtrip::run(book("utf16-bom.fb2"), out.path()).exit_code() == 0);
    const roundtrip::Report legacy = roundtrip::run(book("legacy-cp1251.fb2"), out.path());
    CHECK(legacy.identical);
    CHECK(legacy.valid);  // 2.0 order normalised to 2.1 -> validates (acceptance scenario 1)
    CHECK(legacy.exit_code() == 0);
    CHECK(legacy.input_encoding == "windows-1251");
    CHECK(legacy.input_schema_hint == "legacy");
    CHECK(legacy.binary_count == 1);
    CHECK(legacy.non_jpeg_png_ids.empty());
    // US7: the GIF binary is converted on save (same id) so the output holds only JPEG/PNG.
    const roundtrip::Report modern = roundtrip::run(book("modern-utf8.fb2"), out.path());
    CHECK(modern.converted_ids == std::vector<std::string>{"dot.gif"});
    CHECK(modern.non_jpeg_png_ids.empty());
    CHECK(modern.identical);
    CHECK(test::read_text(out / "modern-utf8.fb2").find("content-type=\"image/gif\"") ==
          std::string::npos);
    const roundtrip::Report malformed = roundtrip::run(book("malformed.fb2"), out.path());
    CHECK_FALSE(malformed.opened);
    CHECK(malformed.exit_code() == 4);
    CHECK(malformed.failure_line == 20);
    CHECK(malformed.summary().find("open failed") != std::string::npos);
    const roundtrip::Report missing = roundtrip::run(book("nope.fb2"), out.path());
    CHECK(missing.exit_code() == 4);
}

TEST_CASE("roundtrip: the comparison reports real differences", "[roundtrip]") {
    MemoryBinaryStore store_a;
    MemoryBinaryStore store_b;
    model::NodeIdAllocator ids_a;
    model::NodeIdAllocator ids_b;
    const auto a = fb2::read_file(book("modern-utf8.fb2"), store_a, ids_a);
    auto b = fb2::read_file(book("modern-utf8.fb2"), store_b, ids_b);
    CHECK(roundtrip::compare(a.document, store_a, b.document, store_b)
              .identical());  // nodeIds differ, nothing else

    b.document.description.titleInfo.bookTitle += "!";
    b.document.bodies[0].content[3].content[0].content[0].content[0].text =
        "Changed";  // ch1/title/p/text
    b.document.bodies[0].content[3].attrs["id"] = "renamed";
    b.document.bodies[1].content.pop_back();  // drop a footnote section
    store_b.put("dot.gif", "image/gif", "different bytes");
    const roundtrip::Comparison c = roundtrip::compare(a.document, store_a, b.document, store_b);
    REQUIRE_FALSE(c.identical());
    std::set<std::string> where;
    for (const auto& d : c.differences) {
        where.insert(d.where);
    }
    CHECK(where.count("description/titleInfo/bookTitle") == 1);
    CHECK(where.count("body[1]/section[1]/title[1]/p[1]/text()[1]") == 1);
    CHECK(where.count("body[1]/section[1]") == 1);
    CHECK(where.count("body[2]") == 1);
    CHECK(where.count("binary[dot.gif]") == 1);

    // Marks compare as sets: order inside a text node is irrelevant.
    auto c2 = fb2::read_file(book("modern-utf8.fb2"), store_b, ids_b);
    for (auto& node : c2.document.bodies[0].content[3].content) {
        for (auto& t : node.content) {
            std::reverse(t.marks.begin(), t.marks.end());
        }
    }
    CHECK(roundtrip::compare(a.document, store_a, c2.document, store_a).identical());
}

TEST_CASE("roundtrip: the Maxima Library role entries are written verbatim in their order",
          "[roundtrip]") {
    // Feature 004 US3 (FR-021, FR-023; research R3.1): the role list is a projection the UI
    // derives from the custom-info rows - the core reads and writes rows only, every text
    // character for character (leading / trailing / double spaces, `_`, an empty text, a type in
    // another letter case, five parts), in file order. This case pins that nothing in the core
    // changes it.
    const std::string name =
        GENERATE(std::string("maxlib-roles.fbd"), std::string("maxlib-roles-edge.fbd"));
    INFO(name);
    test::TempDir out{"mfbe-roundtrip-roles"};
    const roundtrip::Report report = roundtrip::run(book(name.c_str()), out.path());
    CHECK(report.opened);
    CHECK(report.reopened);
    for (const auto& d : report.comparison.differences) {
        FAIL_CHECK(d.where << ": " << d.what);
    }
    CHECK(report.identical);
    REQUIRE(report.written_path.has_value());

    MemoryBinaryStore store_in;
    MemoryBinaryStore store_out;
    model::NodeIdAllocator ids_in;
    model::NodeIdAllocator ids_out;
    const auto original = fb2::read_file(book(name.c_str()), store_in, ids_in);
    const auto written = fb2::read_file(*report.written_path, store_out, ids_out);
    const auto& rows_in = original.document.description.customInfo;
    const auto& rows_out = written.document.description.customInfo;
    REQUIRE(rows_in.size() == (name == "maxlib-roles.fbd" ? 9U : 11U));
    REQUIRE(rows_out.size() == rows_in.size());
    for (std::size_t i = 0; i < rows_in.size(); ++i) {
        INFO("row " << i << ": " << rows_in[i].infoType << " = '" << rows_in[i].text << "'");
        CHECK(rows_out[i].infoType == rows_in[i].infoType);
        CHECK(rows_out[i].text == rows_in[i].text);
        CHECK(rows_out[i].lang == rows_in[i].lang);
    }
    if (name == "maxlib-roles.fbd") {
        CHECK(rows_in[0].infoType == "mlillustrator");
        CHECK(rows_in[0].text == "Илюстраторов Илья Ильич");
        CHECK(rows_in[8].infoType == "mlseriesid");
        CHECK(rows_in[8].text == "99 Какая-то серия");
    } else {
        // The texts the library's edge cases rely on survive untouched.
        CHECK(rows_in[3].infoType == "mlcommentator");
        CHECK(rows_in[3].text.empty());
        CHECK(rows_in[4].text == "Первый Второй Третий Четвёртый Пятый");
        CHECK(rows_in[7].text == "Де_Голль Шарль");
        CHECK(rows_in[8].text == "Дизайнеров  Данилович");
        CHECK(rows_in[9].text == "  Пробелов Пётр Петрович ");
        CHECK(rows_in[10].infoType == "MlEditor");
        CHECK(rows_in[10].text == "Регистров Р Р");
        const std::string text = test::read_text(*report.written_path);
        CHECK(text.find(
                  "<custom-info info-type=\"mleditor\">  Пробелов Пётр Петрович </custom-info>") !=
              std::string::npos);
        CHECK(text.find("<custom-info info-type=\"MlEditor\">Регистров Р Р</custom-info>") !=
              std::string::npos);
    }
}

TEST_CASE("roundtrip: the document details filled in on load are written and not compared",
          "[roundtrip]") {
    // Feature 002: open and save fill in the id, version, program used and date as the
    // original did; the comparison leaves exactly those fields out.
    test::TempDir tmp{"mfbe-roundtrip-details"};
    const std::filesystem::path input = tmp / "details.fb2";
    test::write_text(input,
                     "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
                     "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
                     "xmlns:l=\"http://www.w3.org/1999/xlink\"><description><title-info>"
                     "<genre>sf</genre><book-title>Details</book-title><lang>en</lang>"
                     "</title-info><document-info><program-used>FB Tools</program-used>"
                     "<date/><id/><version/></document-info></description><body><section>"
                     "<p>Text.</p></section></body></FictionBook>");
    test::TempDir out{"mfbe-roundtrip-details-out"};
    const roundtrip::Report report = roundtrip::run(input, out.path());
    CHECK(report.comparison.identical());
    const std::string written = test::read_text(out / "details.fb2");
    CHECK(written.find("<program-used>FB Tools, Maxima Fiction Book Editor ") != std::string::npos);
    CHECK(written.find("<version>1.0</version>") != std::string::npos);
    CHECK(written.find("<id></id>") == std::string::npos);

    // Anything else in document-info still counts.
    MemoryBinaryStore store_a;
    MemoryBinaryStore store_b;
    model::NodeIdAllocator ids_a;
    model::NodeIdAllocator ids_b;
    const auto a = fb2::read_file(input, store_a, ids_a);
    auto b = fb2::read_file(input, store_b, ids_b);
    b.document.description.documentInfo.version = "7.0";
    b.document.description.documentInfo.srcOcr = "scanned";
    const roundtrip::Comparison c = roundtrip::compare(a.document, store_a, b.document, store_b);
    REQUIRE(c.differences.size() == 1);
    CHECK(c.differences[0].where == "description/documentInfo/srcOcr");
}

TEST_CASE("roundtrip: the comparison reports an inline atom whose marks differ", "[roundtrip]") {
    // Feature 006 (FR-067): a lost link or formatting around a picture or inline raw XML is a
    // structural difference (cli.md roundtrip, exit code 3).
    MemoryBinaryStore store;
    model::NodeIdAllocator ids_a;
    model::NodeIdAllocator ids_b;
    const std::string text = test::minimal_book(
        "<section><p>see <a l:href=\"#s2\"><image l:href=\"#pic\"/></a></p>"
        "<p><strong>x<x:mark xmlns:x=\"urn:example:x\">r</x:mark></strong></p></section>"
        "<section id=\"s2\"><p>t</p></section>");
    const auto a = fb2::read_bytes(text, store, ids_a);
    auto b = fb2::read_bytes(text, store, ids_b);
    CHECK(roundtrip::compare(a.document, store, b.document, store).identical());

    model::Node& picture = b.document.bodies[0].content[0].content[0].content[1];
    REQUIRE(picture.type == "inline-image");
    REQUIRE(picture.marks.size() == 1);
    picture.marks.clear();  // the link around the picture lost
    model::Node& raw = b.document.bodies[0].content[0].content[1].content[1];
    REQUIRE(raw.type == "raw-xml");
    REQUIRE(raw.marks.size() == 1);
    raw.marks.clear();  // the bold around the raw XML lost
    const roundtrip::Comparison c = roundtrip::compare(a.document, store, b.document, store);
    REQUIRE(c.differences.size() == 2);
    CHECK(c.differences[0].where == "body[1]/section[1]/p[1]/inline-image[1]");
    CHECK(c.differences[0].what == "marks differ");
    CHECK(c.differences[1].where == "body[1]/section[1]/p[2]/raw-xml[1]");
    CHECK(c.differences[1].what == "marks differ");
}

TEST_CASE("roundtrip: the order of marks of one kind counts; the order across kinds does not",
          "[roundtrip]") {
    // Feature 006 (FR-069; document-model §3.3): nested formatting of one kind is kept in its
    // order, so [style a, style b] against [style b, style a] is a difference.
    MemoryBinaryStore store;
    model::NodeIdAllocator ids_a;
    model::NodeIdAllocator ids_b;
    const std::string text = test::minimal_book(
        "<section><p><style name=\"a\"><style name=\"b\">x</style></style></p>"
        "<p><emphasis xml:lang=\"la\"><emphasis xml:lang=\"de\">y</emphasis></emphasis></p>"
        "<p><strong><emphasis>z</emphasis></strong></p></section>");
    const auto a = fb2::read_bytes(text, store, ids_a);
    auto b = fb2::read_bytes(text, store, ids_b);
    CHECK(roundtrip::compare(a.document, store, b.document, store).identical());
    auto& paragraphs = b.document.bodies[0].content[0].content;
    REQUIRE(paragraphs[0].content.at(0).marks.size() == 2);
    REQUIRE(paragraphs[1].content.at(0).marks.size() == 2);
    REQUIRE(paragraphs[2].content.at(0).marks.size() == 2);
    // Across kinds: [strong, emphasis] and [emphasis, strong] are one set.
    std::reverse(paragraphs[2].content[0].marks.begin(), paragraphs[2].content[0].marks.end());
    CHECK(roundtrip::compare(a.document, store, b.document, store).identical());
    // Within a kind: the reversed styles, and the reversed languages, are differences.
    std::reverse(paragraphs[0].content[0].marks.begin(), paragraphs[0].content[0].marks.end());
    std::reverse(paragraphs[1].content[0].marks.begin(), paragraphs[1].content[0].marks.end());
    const roundtrip::Comparison c = roundtrip::compare(a.document, store, b.document, store);
    REQUIRE(c.differences.size() == 2);
    CHECK(c.differences[0].where == "body[1]/section[1]/p[1]/text()[1]");
    CHECK(c.differences[0].what == "marks differ");
    CHECK(c.differences[1].where == "body[1]/section[1]/p[2]/text()[1]");
    CHECK(c.differences[1].what == "marks differ");
}

TEST_CASE(
    "roundtrip: the comparison allows the writer's joining and the link rule, and nothing else",
    "[roundtrip]") {
    // Feature 006 (document-model §3.3): both sides' children are brought into the writer's
    // form - FR-068's link rule, then adjacent text with equal marks joined - before they are
    // compared.
    test::TempDir out{"mfbe-roundtrip-links"};
    const std::string text = test::minimal_book(
        // p14: equal mark sets in two nesting orders side by side, written as one run.
        "<section><p><strong><emphasis>a</emphasis></strong><emphasis><strong>b</strong>"
        "</emphasis></p>"
        // p04 as read: a style over part of a link, extended over the whole link.
        "<p><a l:href=\"#n_1\"><style name=\"city\">Moscow</style> today</a></p></section>",
        "<body name=\"notes\"><section id=\"n_1\"><p>1</p></section></body>");
    test::write_text(out / "in" / "links.fb2", text);
    const roundtrip::Report report = roundtrip::run(out / "in" / "links.fb2", out / "out");
    for (const auto& d : report.comparison.differences) {
        FAIL_CHECK(d.where << ": " << d.what);
    }
    CHECK(report.identical);
    CHECK(report.valid);  // the input's style inside a link is written around it
    CHECK(report.exit_code() == 0);

    // Anything else is still a difference: a style dropped outside a link, a changed text.
    MemoryBinaryStore store;
    model::NodeIdAllocator ids_a;
    model::NodeIdAllocator ids_b;
    const std::string other = test::minimal_book(
        "<section><p><style name=\"a\">x</style> <a l:href=\"#s2\">y</a></p></section>"
        "<section id=\"s2\"><p>t</p></section>");
    const auto a = fb2::read_bytes(other, store, ids_a);
    auto b = fb2::read_bytes(other, store, ids_b);
    REQUIRE(roundtrip::compare(a.document, store, b.document, store).identical());
    auto changed_text = b;
    model::Node& p = b.document.bodies[0].content[0].content[0];
    REQUIRE(p.content.size() == 3);
    p.content[0].marks.clear();  // the style outside the link lost
    const roundtrip::Comparison dropped = roundtrip::compare(a.document, store, b.document, store);
    REQUIRE(dropped.differences.size() == 1);
    CHECK(dropped.differences[0].where == "body[1]/section[1]/p[1]");
    CHECK(dropped.differences[0].what == "child count 3 became 2");  // "x" now joins " "
    model::Node& q = changed_text.document.bodies[0].content[0].content[0];
    q.content[2].text = "z";  // the link's text changed
    const roundtrip::Comparison text_change =
        roundtrip::compare(a.document, store, changed_text.document, store);
    REQUIRE(text_change.differences.size() == 1);
    CHECK(text_change.differences[0].where == "body[1]/section[1]/p[1]/text()[3]");
    CHECK(text_change.differences[0].what == "text \"y\" became \"z\"");
}

TEST_CASE("roundtrip: tables are written back attribute for attribute", "[roundtrip][tables]") {
    // Feature 006 (SC-004; document-model §3.3, "Tests to write"): the XML-level walker of
    // test_support.hpp over the feature's fixture books - every table, cell language, span,
    // mark attribute, linked or formatted picture, named style around a whole link, nested
    // style, nested emphasis with two languages and &#13; must come back.
    for (const char* name : {"tables.fb2", "tables-invalid.fb2", "tables-images.fb2"}) {
        INFO(name);
        const std::string input = test::read_text(book(name));
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        const auto read = fb2::read_bytes(input, store, ids);
        fb2::WriteOptions options;
        options.xlink_prefix = read.xlink_prefix;
        const std::string output = fb2::write_document(read.document, &store, options).text;
        const auto difference = test::xml_equivalent(input, output);
        CHECK_FALSE(difference.has_value());
        if (difference) {
            FAIL_CHECK(*difference);
        }
    }

    // The walker itself: what the recorded normalisations change is allowed...
    const auto equivalent = [](const std::string& in, const std::string& out) {
        return test::xml_equivalent(test::minimal_book("<section>" + in + "</section>"),
                                    test::minimal_book("<section>\n\t" + out + "\n</section>"));
    };
    CHECK_FALSE(equivalent("<table><tr><td colspan=\" 2 \">x</td></tr></table>",
                           "<table>\n<tr><td colspan=\"2\">x</td></tr></table>"));
    CHECK_FALSE(
        equivalent("<p><strong><emphasis>a</emphasis></strong><emphasis><strong>b"
                   "</strong></emphasis></p>",
                   "<p><strong><emphasis>ab</emphasis></strong></p>"));
    CHECK_FALSE(equivalent("<p><style name=\"x\">a<style name=\"x\">b</style></style></p>",
                           "<p><style name=\"x\">ab</style></p>"));
    CHECK_FALSE(equivalent("<p><a l:href=\"#s\">x</a><a l:href=\"#s\">y</a></p>",
                           "<p><a l:href=\"#s\">xy</a></p>"));
    // ...and what the writer must not change is a difference.
    struct Pair {
        const char* what;
        const char* in;
        const char* out;
    };
    for (const Pair& pair : {
             Pair{"a dropped attribute",
                  "<table><tr><td colspan=\"2\" align=\"center\">x</td>"
                  "</tr></table>",
                  "<table><tr><td colspan=\"2\">x</td></tr></table>"},
             Pair{"00 written 0", "<table><tr><td rowspan=\"00\">x</td></tr></table>",
                  "<table><tr><td rowspan=\"0\">x</td></tr></table>"},
             Pair{"a picture outside its link",
                  "<p><a l:href=\"#s\">t<image l:href=\"#p\"/></a></p>",
                  "<p><a l:href=\"#s\">t</a><image l:href=\"#p\"/></p>"},
             Pair{"a lost inner style",
                  "<p><style name=\"a\">x<style name=\"b\">y</style></style></p>",
                  "<p><style name=\"a\">xy</style></p>"},
             Pair{"a lost inner language of nested emphasis",
                  "<p><emphasis xml:lang=\"la\">a <emphasis xml:lang=\"de\">b</emphasis>"
                  "</emphasis></p>",
                  "<p><emphasis xml:lang=\"la\">a b</emphasis></p>"},
             Pair{"a carriage return turned into a line feed", "<p>a&#13;b</p>", "<p>a&#10;b</p>"},
             Pair{"a lost cell language", "<table><tr><td xml:lang=\"de\">x</td></tr></table>",
                  "<table><tr><td>x</td></tr></table>"},
             Pair{"a lost link type", "<p><a l:href=\"#s\" l:type=\"simple\">x</a></p>",
                  "<p><a l:href=\"#s\">x</a></p>"},
         }) {
        INFO(pair.what);
        const auto difference = equivalent(pair.in, pair.out);
        CHECK(difference.has_value());
        if (difference) {
            CHECK_FALSE(difference->empty());
        }
    }
    // The element path names the place.
    const auto where = equivalent("<table><tr><td>a</td><td rowspan=\"-01\">b</td></tr></table>",
                                  "<table><tr><td>a</td><td rowspan=\"-1\">b</td></tr></table>");
    REQUIRE(where.has_value());
    CHECK(where->rfind("/FictionBook/body[1]/section[1]/table[1]/tr[1]/td[2]", 0) == 0);
}
