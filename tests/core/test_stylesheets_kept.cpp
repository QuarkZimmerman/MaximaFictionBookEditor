// Guard G13 (feature 011, research 2.3; FR-020d, D31): a stylesheet the user did not edit in the
// Styles view keeps its text - comments, spacing, rule order - whatever else of the book changes,
// and a stylesheet of another type is kept as read.
#include "test_support.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/node_ids.hpp>

#include <catch2/catch_test_macros.hpp>
#include <string>

using namespace mfbe;

namespace {

const std::string kCss =
    "\n  p   {text-indent:1.5em}   /* a comment, odd spacing */\n"
    ".letter{ font-style : italic ;}\n\n  section title p{text-align:center}\n";
const std::string kOther = "@page { margin: 1cm } -- some other stylesheet language";

std::string book_with_stylesheets() {
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
           "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
           "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
           "<stylesheet type=\"text/css\">" +
           kCss + "</stylesheet>\n<stylesheet type=\"text/x-other\">" + kOther +
           "</stylesheet>\n"
           "<description><title-info><genre>prose</genre><author><first-name>A</first-name>"
           "<last-name>B</last-name></author><book-title>T</book-title><lang>en</lang>"
           "</title-info><document-info><author><nickname>n</nickname></author><date>2024</date>"
           "<id>x</id><version>1.0</version></document-info></description>\n"
           "<body><section><p>One</p><p>Two</p></section></body>\n</FictionBook>\n";
}

std::string stylesheets_part(const std::string& text) {
    const auto from = text.find("<stylesheet");
    const auto to = text.rfind("</stylesheet>");
    REQUIRE(from != std::string::npos);
    REQUIRE(to != std::string::npos);
    return text.substr(from, to + 13 - from);
}

}  // namespace

TEST_CASE("stylesheets: kept as read when the book is edited elsewhere (guard G13)",
          "[stylesheets][guard]") {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    fb2::ReadResult read = fb2::read_bytes(book_with_stylesheets(), store, ids);
    REQUIRE(read.document.stylesheets.size() == 2);
    CHECK(read.document.stylesheets[0].type == "text/css");
    CHECK(read.document.stylesheets[0].content == kCss);
    CHECK(read.document.stylesheets[1].type == "text/x-other");
    CHECK(read.document.stylesheets[1].content == kOther);

    fb2::WriteOptions options;
    options.xlink_prefix = read.xlink_prefix;
    const std::string before = fb2::write_document(read.document, &store, options).text;

    // Edits elsewhere: the description and the text.
    read.document.description.titleInfo.bookTitle = "Another title";
    REQUIRE(!read.document.bodies.empty());
    read.document.bodies[0].content.clear();
    const std::string after = fb2::write_document(read.document, &store, options).text;

    CHECK(stylesheets_part(after) == stylesheets_part(before));
    MemoryBinaryStore store2;
    model::NodeIdAllocator ids2;
    const fb2::ReadResult again = fb2::read_bytes(after, store2, ids2);
    REQUIRE(again.document.stylesheets.size() == 2);
    CHECK(again.document.stylesheets[0].content == kCss);
    CHECK(again.document.stylesheets[1].content == kOther);
}
