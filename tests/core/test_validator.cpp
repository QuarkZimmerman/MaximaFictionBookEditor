// T044: XSD validation with line/column + nodeId mapping, consistency checks (dangling links,
// missing/unreferenced binaries, image formats), genre hook, required-value warnings, report
// counts, Source-view text validation (placeholders accepted, malformed text reported).
#include "test_support.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/validator.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <set>

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

std::vector<const model::ValidationIssue*> with_code(const model::ValidationReport& r,
                                                     const std::string& code) {
    std::vector<const model::ValidationIssue*> out;
    for (const auto& i : r.issues) {
        if (i.code == code) {
            out.push_back(&i);
        }
    }
    return out;
}

std::string param(const model::ValidationIssue& issue, const char* key) {
    auto it = issue.params.find(key);
    return it == issue.params.end() || !it->second.is_string() ? "" : it->second.get<std::string>();
}

model::Node element(const std::string& type, std::vector<model::Node> content = {}) {
    model::Node n;
    n.type = type;
    n.content = std::move(content);
    return n;
}

model::Node text(const std::string& t, std::vector<model::Mark> marks = {}) {
    model::Node n;
    n.type = "text";
    n.text = t;
    n.marks = std::move(marks);
    return n;
}

}  // namespace

TEST_CASE("validator: schema loads once and enumerates the 186 genre codes", "[validator]") {
    std::string error;
    REQUIRE(validation::schema_ready(&error));
    CHECK(error.empty());
    CHECK(std::filesystem::exists(validation::schema_dir() / "FictionBook.xsd"));
    const auto& genres = validation::schema_genres();
    CHECK(genres.size() >= 180);
    CHECK(std::binary_search(genres.begin(), genres.end(), std::string("sf")));
    CHECK(std::binary_search(genres.begin(), genres.end(), std::string("prose_classic")));
    CHECK_FALSE(
        std::binary_search(genres.begin(), genres.end(), std::string("prose_contemporary")));
    CHECK(validation::is_known_genre("detective"));
    CHECK_FALSE(validation::is_known_genre("prose_contemporary"));
}

TEST_CASE("validator: a valid 2.1 document reports no errors, only conversion warnings",
          "[validator]") {
    auto l = load("modern-utf8.fb2");
    const auto report =
        validation::validate_document(l->result.document, &l->store, l->result.xlink_prefix);
    CHECK(report.errorCount == 0);
    CHECK(report.warningCount == 1);
    REQUIRE(with_code(report, "binary.willConvert").size() == 1);
    CHECK(param(*with_code(report, "binary.willConvert")[0], "id") == "dot.gif");
    CHECK(report.durationMs >= 0);
    // Bodies that are valid never raise; the text form validates too.
    const auto written = fb2::write_document(l->result.document, &l->store);
    const auto text_report = validation::validate_xml_text(written.text);
    CHECK(text_report.errorCount == 0);
}

TEST_CASE("validator: schema errors carry line, column-less element info and map to nodeIds",
          "[validator]") {
    auto l = load("modern-utf8.fb2");
    model::Document doc = l->result.document;
    // Break the structure: a <p> directly under <body> (not allowed) and an epigraph after a
    // section (wrong order).
    model::Node& body = doc.bodies[0];
    body.content.insert(body.content.begin(), element("p", {text("stray paragraph")}));
    body.content.push_back(element("epigraph", {element("p", {text("late")})}));
    model::NodeIdAllocator ids = l->ids;
    model::assign_node_ids(doc, ids);
    const std::string stray_id = body.content.front().node_id();
    REQUIRE_FALSE(stray_id.empty());

    const auto report = validation::validate_document(doc, &l->store, l->result.xlink_prefix);
    CHECK(report.errorCount >= 1);
    const auto errors = with_code(report, "schema.invalid");
    REQUIRE_FALSE(errors.empty());
    const model::ValidationIssue& first = *errors.front();
    CHECK(first.severity == model::Severity::error);
    REQUIRE(first.line.has_value());
    CHECK(*first.line > 1);
    CHECK(param(first, "element") == "p");
    CHECK_THAT(param(first, "message"), ContainsSubstring("not expected"));
    CHECK(first.nodeId == stray_id);
    CHECK(first.path == "body[1]/p[1]");
    // Issues are ordered by line.
    for (std::size_t i = 1; i < report.issues.size(); ++i) {
        if (report.issues[i - 1].line && report.issues[i].line) {
            CHECK(*report.issues[i - 1].line <= *report.issues[i].line);
        }
    }
}

TEST_CASE("validator: consistency checks - links, binaries, image formats, required values",
          "[validator]") {
    model::Document doc;
    doc.description.titleInfo.genres.push_back(model::GenreRef{"sf", std::nullopt});
    model::Person author;
    author.nickname = "nick";
    doc.description.titleInfo.authors.push_back(author);
    doc.description.titleInfo.bookTitle = "";  // required but empty
    doc.description.titleInfo.lang = "ru";
    doc.description.titleInfo.coverpage.push_back(
        model::ImageRef{"#missing-cover.jpg", std::nullopt, std::nullopt, std::nullopt});
    doc.description.documentInfo.authors.push_back(author);
    doc.description.documentInfo.id = "";
    doc.description.documentInfo.version = "1.0";
    doc.description.documentInfo.date = model::DateValue{"", std::nullopt, std::nullopt};

    model::Node img;
    img.type = "image";
    img.attrs["href"] = "#present.png";
    model::Node ext;
    ext.type = "image";
    ext.attrs["href"] = "http://example.org/x.png";
    model::Node empty_img;
    empty_img.type = "inline-image";
    empty_img.attrs["href"] = "";
    model::Node section = element("section");
    section.attrs["id"] = "s1";
    section.content.push_back(element(
        "p",
        {text("link to "), text("section", {model::Mark{"link", nlohmann::json{{"href", "#s1"}}}}),
         text(" and "),
         text("nowhere",
              {model::Mark{"link", nlohmann::json{{"href", "#nowhere"}, {"type", "note"}}}}),
         empty_img}));
    section.content.push_back(img);
    section.content.push_back(ext);
    doc.bodies.push_back(element("body", {section}));
    model::NodeIdAllocator ids;
    model::assign_node_ids(doc, ids);

    MemoryBinaryStore store;
    store.put("present.png", "image/png",
              test::read_text(test::fixtures_dir() / "images" / "tiny.png"));
    store.put("unused.gif", "image/gif",
              test::read_text(test::fixtures_dir() / "images" / "tiny.gif"));
    store.put("blob.bin", "application/octet-stream", "not an image at all");
    store.put("broken.jpg", "image/jpeg", "###", true);
    update_reference_counts(doc, store);

    const auto issues = validation::consistency_issues(doc, &store);
    model::ValidationReport report;
    report.issues = issues;
    validation::finalize_report(report);
    CHECK(report.errorCount == 0);  // consistency problems are warnings (the user decides)

    REQUIRE(with_code(report, "link.dangling").size() == 1);
    CHECK(param(*with_code(report, "link.dangling")[0], "href") == "#nowhere");
    const model::Node& placed = doc.bodies[0].content[0];
    CHECK(with_code(report, "link.dangling")[0]->nodeId == placed.content[0].node_id());
    CHECK(with_code(report, "link.dangling")[0]->path == "body[1]/section[1]/p[1]");
    REQUIRE(with_code(report, "image.missingBinary").size() == 1);
    CHECK(param(*with_code(report, "image.missingBinary")[0], "href") == "#missing-cover.jpg");
    REQUIRE(with_code(report, "image.externalHref").size() == 1);
    CHECK(with_code(report, "image.externalHref")[0]->nodeId == placed.content[2].node_id());
    CHECK(with_code(report, "image.emptyHref").size() == 1);
    std::set<std::string> unreferenced;
    for (const auto* i : with_code(report, "binary.unreferenced")) {
        unreferenced.insert(param(*i, "id"));
    }
    CHECK(unreferenced == std::set<std::string>{"unused.gif", "blob.bin", "broken.jpg"});
    REQUIRE(with_code(report, "binary.notImage").size() == 1);
    CHECK(param(*with_code(report, "binary.notImage")[0], "id") == "blob.bin");
    REQUIRE(with_code(report, "binary.willConvert").size() == 1);
    CHECK(param(*with_code(report, "binary.willConvert")[0], "id") == "unused.gif");
    REQUIRE(with_code(report, "binary.invalidBase64").size() == 1);
    CHECK(param(*with_code(report, "binary.invalidBase64")[0], "id") == "broken.jpg");
    std::set<std::string> required;
    for (const auto* i : with_code(report, "description.emptyRequired")) {
        required.insert(param(*i, "element"));
    }
    CHECK(required == std::set<std::string>{"book-title", "id", "date"});

    // The full validation adds the schema view of the same document (which happens to be
    // schema-valid: empty required elements are allowed by the XSD, hence the warnings above).
    const auto full = validation::validate_document(doc, &store);
    CHECK(full.warningCount >= report.warningCount);
    CHECK(full.errorCount == 0);
}

TEST_CASE("validator: genre hook replaces the schema enumeration", "[validator]") {
    auto l = load("unknown-elements.fb2");  // genre prose_contemporary (legacy extension code)
    const auto before = validation::validate_document(l->result.document, &l->store);
    REQUIRE(with_code(before, "genre.unknown").size() == 1);
    CHECK(param(*with_code(before, "genre.unknown")[0], "code") == "prose_contemporary");
    CHECK(with_code(before, "genre.unknown")[0]->severity == model::Severity::error);
    CHECK(with_code(before, "genre.unknown")[0]->line == 5);
    // No duplicate schema enumeration error for the same genre.
    for (const auto* e : with_code(before, "schema.invalid")) {
        CHECK(param(*e, "element") != "genre");
    }

    validation::set_genre_validator([](const std::string& code) {
        return code == "prose_contemporary" ||
               validation::schema_genres().end() != std::find(validation::schema_genres().begin(),
                                                              validation::schema_genres().end(),
                                                              code);
    });
    const auto after = validation::validate_document(l->result.document, &l->store);
    CHECK(with_code(after, "genre.unknown").empty());
    CHECK(after.errorCount == before.errorCount - 1);
    validation::set_genre_validator(nullptr);
    CHECK_FALSE(validation::is_known_genre("prose_contemporary"));
}

TEST_CASE("validator: Source view text - malformed text, placeholders, line numbers",
          "[validator]") {
    const auto malformed =
        validation::validate_xml_text("<FictionBook><body><p>oops</body></FictionBook>");
    REQUIRE(malformed.errorCount == 1);
    CHECK(malformed.issues[0].code == "xml.notWellFormed");
    CHECK(malformed.issues[0].line == 1);
    CHECK(malformed.issues[0].column > 0);
    CHECK_THAT(param(malformed.issues[0], "message"), ContainsSubstring("mismatch"));

    auto l = load("modern-utf8.fb2");
    fb2::WriteOptions options;
    options.elide_binaries = true;
    const auto elided = fb2::write_document(l->result.document, &l->store, options);
    const auto report = validation::validate_xml_text(elided.text, &elided.lines);
    CHECK(report.errorCount == 0);  // `…N bytes…` placeholders are accepted

    // A broken fragment typed into the Source view: error at the right line, nodeId attached.
    std::string text = elided.text;
    const std::size_t pos = text.find("<p id=\"p1\"");
    REQUIRE(pos != std::string::npos);
    text.insert(pos, "<v>stray verse</v>\n");
    const auto broken = validation::validate_xml_text(text, &elided.lines);
    REQUIRE(broken.errorCount >= 1);
    const model::ValidationIssue& issue = broken.issues[0];
    CHECK(issue.code == "schema.invalid");
    CHECK(param(issue, "element") == "v");
    const int expected_line =
        static_cast<int>(
            std::count(text.begin(), text.begin() + static_cast<std::ptrdiff_t>(pos), '\n')) +
        1;
    CHECK(issue.line == expected_line);
    CHECK(issue.nodeId.has_value());  // the nearest preceding node of the original map
}

TEST_CASE("validator: descriptor without body and legacy order are reported, not fatal",
          "[validator]") {
    auto fbd = load("descriptor.fbd");
    const auto r1 = validation::validate_document(fbd->result.document, &fbd->store);
    REQUIRE(r1.errorCount == 1);
    CHECK_THAT(param(r1.issues[0], "message"), ContainsSubstring("body"));
    auto legacy = load("legacy-cp1251.fb2");
    const auto r2 = validation::validate_document(legacy->result.document, &legacy->store,
                                                  legacy->result.xlink_prefix);
    // The 2.0-era element order is invalid as-is but valid once normalised by the writer.
    CHECK(legacy->result.document.schemaHint == model::SchemaHint::legacy);
    CHECK(r2.errorCount == 0);
    // Stray text inside an element-only container is reported and mapped to that node.
    model::Document doc = legacy->result.document;
    model::Node raw;
    raw.type = "raw-xml";
    raw.attrs["xml"] = "Loose text";
    raw.attrs["inline"] = false;
    doc.description.titleInfo.annotation->content.insert(
        doc.description.titleInfo.annotation->content.begin(), raw);
    const auto r3 = validation::validate_document(doc, &legacy->store, legacy->result.xlink_prefix);
    REQUIRE(r3.errorCount == 1);
    CHECK(param(r3.issues[0], "element") == "annotation");
    CHECK(r3.issues[0].nodeId == doc.description.titleInfo.annotation->node_id());
}
