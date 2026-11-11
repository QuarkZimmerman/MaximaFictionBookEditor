// Feature 012 (T008): opening an EPUB for the import - the versions, the package, the protection,
// the refusals and the limits (D17, D29, contracts/rpc-api.md §1, research DP-14, DP-15).
#include "test_support.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/epub.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <fstream>
#include <optional>
#include <string>

using namespace mfbe;
namespace fs = std::filesystem;

namespace {

fs::path fixture(const std::string& name) {
    return test::fixtures_dir() / "epub" / name;
}

epub::Refusal refusal_of(const fs::path& path, const epub::Limits& limits = {}) {
    std::optional<epub::Refusal> reason;
    try {
        (void)epub::open(path, limits);
    } catch (const epub::Refused& e) {
        reason = e.reason;
    }
    INFO("not refused: " << path.string());
    REQUIRE(reason.has_value());
    return *reason;
}

bool offers(const epub::Source& source, const std::string& name) {
    return std::any_of(source.entries.begin(), source.entries.end(),
                       [&](const epub::Entry& e) { return e.name == name; });
}

}  // namespace

TEST_CASE("epub open: every version gives its package and version", "[epub]") {
    struct Case {
        const char* file;
        const char* version;
        const char* package;
    };
    const Case cases[] = {
        {"epub-2.0.epub", "2.0", "OEBPS/content.opf"},
        {"epub-2.0.1.epub", "2.0", "OEBPS/content.opf"},
        {"epub-no-version.epub", "", "OEBPS/content.opf"},
        {"epub-3.0.epub", "3.0", "EPUB/package.opf"},
        {"epub-3.0.1.epub", "3.0", "EPUB/package.opf"},
        {"epub-3.1.epub", "3.1", "EPUB/package.opf"},
        {"epub-3.2.epub", "3.0", "EPUB/package.opf"},
        {"epub-3.3.epub", "3.0", "EPUB/package.opf"},
        {"dtbook.epub", "2.0", "OEBPS/content.opf"},
    };
    for (const Case& c : cases) {
        INFO(c.file);
        const epub::Source source = epub::open(fixture(c.file));
        CHECK(source.version == c.version);
        CHECK(source.package_path == c.package);
        CHECK(source.protection == epub::Protection::none);
        CHECK(source.mimetype_first);
        CHECK(offers(source, source.package_path));
        CHECK(source.outside.empty());
    }
}

TEST_CASE("epub open: a late mimetype is read, and noted", "[epub]") {
    const epub::Source source = epub::open(fixture("mimetype-late.epub"));
    CHECK_FALSE(source.mimetype_first);
    CHECK(source.package_path == "OEBPS/content.opf");
}

TEST_CASE("epub open: DRM is refused, font obfuscation is not DRM", "[epub]") {
    CHECK(refusal_of(fixture("drm-adept.epub")) == epub::Refusal::drm);
    const epub::Source source = epub::open(fixture("font-obfuscation.epub"));
    CHECK(source.protection == epub::Protection::font_obfuscation);
    CHECK(std::string(epub::refusal_name(epub::Refusal::drm)) == "epub.protected");
    CHECK(std::string(epub::protection_name(source.protection)) == "fontObfuscation");
}

TEST_CASE("epub open: files that are not EPUB books are refused", "[epub]") {
    CHECK(refusal_of(fixture("not-zip.epub")) == epub::Refusal::not_zip);
    const test::TempDir temp("epub-no-package");
    const fs::path dir = temp.path();
    const fs::path path = dir / "no-package.epub";
    {
        const std::string mimetype = "application/epub+zip";
        const std::string page = "<html/>";
        std::ofstream(path, std::ios::binary)
            << archive::zip_entries({{"mimetype", mimetype}, {"page.xhtml", page}});
    }
    CHECK(refusal_of(path) == epub::Refusal::no_package);
}

TEST_CASE("epub open: the limits of DP-15 refuse before anything is offered", "[epub]") {
    CHECK(refusal_of(fixture("zip-bomb.epub")) == epub::Refusal::zip_bomb);
    CHECK(refusal_of(fixture("password-zip.epub")) == epub::Refusal::encrypted_zip);
    epub::Limits few;
    few.max_entries = 5;
    CHECK(refusal_of(fixture("epub-3.3.epub"), few) == epub::Refusal::too_many_entries);
    epub::Limits tiny;
    tiny.max_file_bytes = 100;
    CHECK(refusal_of(fixture("epub-3.3.epub"), tiny) == epub::Refusal::too_large);
    epub::Limits small_unpacked;
    small_unpacked.max_unpacked_bytes = 1000;
    CHECK(refusal_of(fixture("epub-3.3.epub"), small_unpacked) == epub::Refusal::zip_bomb);
}

TEST_CASE("epub open: a name leading outside the container is never offered", "[epub]") {
    const epub::Source source = epub::open(fixture("path-escape.epub"));
    REQUIRE(source.outside.size() == 1);
    CHECK(source.outside[0] == "../../escape.txt");
    CHECK_FALSE(offers(source, "../../escape.txt"));
    CHECK_THROWS_AS(epub::read(source, "../../escape.txt"), std::out_of_range);
}

TEST_CASE("epub read: the bytes of an offered entry", "[epub]") {
    const epub::Source source = epub::open(fixture("epub-3.3.epub"));
    const std::string container = epub::read(source, "META-INF/container.xml");
    CHECK(container.find("EPUB/package.opf") != std::string::npos);
    CHECK(epub::read(source, "EPUB/cover.jpg").size() > 100);
    CHECK_THROWS_AS(epub::read(source, "EPUB/none.xhtml"), std::out_of_range);
}

TEST_CASE("epub is_epub: recognised by content, and by name with a container", "[epub]") {
    CHECK(epub::is_epub(fixture("epub-3.0.epub")));
    CHECK(epub::is_epub(fixture("epub-2.0.epub")));
    CHECK(epub::is_epub(fixture("mimetype-late.epub")));
    CHECK_FALSE(epub::is_epub(fixture("not-zip.epub")));
    CHECK_FALSE(epub::is_epub(test::fixtures_dir() / "archives" / "single.fb2.zip"));
}
