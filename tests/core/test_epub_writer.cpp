// Feature 012 (T009): writing an EPUB for the export - mimetype first, stored, without an extra
// field; the names under EPUB 3.3's rules and distinct without regard to case; an atomic replace
// that leaves nothing behind on failure (D3, D4, D13, contracts/rpc-api.md §3, research R3).
#include "test_support.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/epub.hpp>

#include <catch2/catch_test_macros.hpp>
#include <fstream>
#include <iterator>
#include <string>

using namespace mfbe;
namespace fs = std::filesystem;

namespace {

std::string slurp(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

unsigned u16(const std::string& s, std::size_t at) {
    return static_cast<unsigned char>(s[at]) | (static_cast<unsigned char>(s[at + 1]) << 8);
}

}  // namespace

TEST_CASE("epub writer: mimetype first, stored, without an extra field", "[epub]") {
    const test::TempDir temp("epub-writer");
    const fs::path dir = temp.path();
    const fs::path target = dir / "book.epub";
    epub::Writer writer(target);
    writer.add("META-INF/container.xml", "<container/>");
    writer.add("EPUB/package.opf", std::string(5000, 'x'));
    CHECK(writer.commit() > 0);

    const std::string zip = slurp(target);
    REQUIRE(zip.size() > 60);
    CHECK(zip.compare(0, 4, "PK\x03\x04") == 0);
    CHECK(u16(zip, 8) == 0);   // method: stored
    CHECK(u16(zip, 26) == 8);  // name length
    CHECK(u16(zip, 28) == 0);  // extra field length
    CHECK(zip.compare(30, 8, "mimetype") == 0);
    CHECK(zip.compare(38, 20, "application/epub+zip") == 0);

    const archive::Listing listing = archive::list(target);
    REQUIRE(listing.entries.size() == 3);
    CHECK(listing.entries[0].name == "mimetype");
    CHECK(listing.entries[1].name == "META-INF/container.xml");
    CHECK(listing.entries[2].method == 8);  // deflated
    CHECK(epub::is_epub(target));
}

TEST_CASE("epub writer: names follow EPUB 3.3's rules", "[epub]") {
    CHECK(epub::valid_name("EPUB/text/0001.xhtml"));
    CHECK(epub::valid_name("EPUB/images/пример.png"));
    CHECK_FALSE(epub::valid_name(""));
    CHECK_FALSE(epub::valid_name("/EPUB/a.xhtml"));
    CHECK_FALSE(epub::valid_name("EPUB/../a.xhtml"));
    CHECK_FALSE(epub::valid_name("EPUB/a:b.xhtml"));
    CHECK_FALSE(epub::valid_name("EPUB\\a.xhtml"));
    CHECK_FALSE(epub::valid_name("EPUB/a.xhtml."));
    CHECK_FALSE(epub::valid_name("EPUB/a\x01.xhtml"));
    CHECK_FALSE(epub::valid_name("EPUB/" + std::string(256, 'a')));
    CHECK(epub::folded_name("EPUB/Пример.XHTML") == epub::folded_name("epub/пример.xhtml"));
}

TEST_CASE("epub writer: a bad or duplicate name is refused", "[epub]") {
    const test::TempDir temp("epub-writer-names");
    epub::Writer writer(temp.path() / "book.epub");
    writer.add("EPUB/A.xhtml", "a");
    CHECK_THROWS_AS(writer.add("EPUB/a.xhtml", "b"), std::invalid_argument);
    CHECK_THROWS_AS(writer.add("mimetype", "c"), std::invalid_argument);
    CHECK_THROWS_AS(writer.add("EPUB/a?.xhtml", "d"), std::invalid_argument);
    CHECK(writer.files() == 1);
}

TEST_CASE("epub writer: a failed or abandoned export leaves no file", "[epub]") {
    const test::TempDir temp("epub-writer-fail");
    const fs::path dir = temp.path();
    {
        epub::Writer abandoned(dir / "abandoned.epub");
        abandoned.add("EPUB/a.xhtml", "a");
    }
    CHECK_FALSE(fs::exists(dir / "abandoned.epub"));
    epub::Writer failing(dir / "missing-folder" / "book.epub");
    failing.add("EPUB/a.xhtml", "a");
    CHECK_THROWS(failing.commit());
    CHECK_FALSE(fs::exists(dir / "missing-folder" / "book.epub"));
}
