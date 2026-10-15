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
                 std::string("mismatched-declaration.fb2"), std::string("no-declaration.fb2"));
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
