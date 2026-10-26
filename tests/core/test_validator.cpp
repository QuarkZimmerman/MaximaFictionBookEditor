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

TEST_CASE(
    "validator: a dangling link on an inline image or inline raw XML alone gives link.dangling",
    "[validator][marks]") {
    // Feature 006 (FR-067; rpc-api §3.2): the link marks of inline atoms are checked as those of
    // text, one warning per node, with the container's nodeId and path.
    model::Document doc;
    model::Node section = element("section");
    section.attrs["id"] = "s1";
    model::Node picture;
    picture.type = "inline-image";
    picture.attrs["href"] = "#pic.png";
    picture.marks = {model::Mark{"link", nlohmann::json{{"href", "#gone"}}}};
    model::Node raw;
    raw.type = "raw-xml";
    raw.attrs["xml"] = "<x:mark xmlns:x=\"urn:example:x\">r</x:mark>";
    raw.attrs["inline"] = true;
    raw.marks = {model::Mark{"link", nlohmann::json{{"href", "#lost"}, {"type", "note"}}}};
    model::Node linked_ok = picture;
    linked_ok.marks = {model::Mark{"link", nlohmann::json{{"href", "#s1"}}}};
    section.content.push_back(element("p", {picture}));
    section.content.push_back(element("p", {text("x "), raw}));
    section.content.push_back(element("p", {linked_ok}));
    model::Node cell = element("td", {picture});
    section.content.push_back(element("table", {element("tr", {cell})}));
    doc.bodies.push_back(element("body", {section}));
    model::NodeIdAllocator ids;
    model::assign_node_ids(doc, ids);

    model::ValidationReport report;
    report.issues = validation::consistency_issues(doc, nullptr);
    const auto dangling = with_code(report, "link.dangling");
    REQUIRE(dangling.size() == 3);
    const model::Node& s = doc.bodies[0].content[0];
    CHECK(param(*dangling[0], "href") == "#gone");
    CHECK(dangling[0]->nodeId == s.content[0].node_id());
    CHECK(dangling[0]->path == "body[1]/section[1]/p[1]");
    CHECK(param(*dangling[1], "href") == "#lost");
    CHECK(dangling[1]->nodeId == s.content[1].node_id());
    CHECK(dangling[1]->path == "body[1]/section[1]/p[2]");
    CHECK(param(*dangling[2], "href") == "#gone");
    CHECK(dangling[2]->nodeId == s.content[3].content[0].content[0].node_id());
    CHECK(dangling[2]->path == "body[1]/section[1]/table[1]/tr[1]/td[1]");
    // Both report forms run the check: the document form here, the text form through
    // doc.validate {text} (validate_text_with_model) on the same reader.
    const auto full = validation::validate_document(doc, nullptr);
    CHECK(with_code(full, "link.dangling").size() == 3);
}

TEST_CASE("validator: a valid book with formatting with a name around a link validates",
          "[validator][marks]") {
    // Feature 006 (FR-068, decision 21; probe p01): the document form validates the writer's
    // text, which kept a named style around a link inside the link before - two
    // schema.invalid errors for a valid file.
    const std::string text = test::minimal_book(
        "<section><p><style name=\"2\">Are you sure<a l:href=\"#n_5\" type=\"note\">[5]</a>?"
        "</style></p><p><style name=\"x\"><a l:href=\"#s1\">t</a></style></p></section>",
        "<body name=\"notes\"><section id=\"n_5\"><p>5</p></section>"
        "<section id=\"s1\"><p>s</p></section></body>");
    // The input file is valid.
    REQUIRE(validation::validate_xml_text(text).errorCount == 0);
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    const auto read = fb2::read_bytes(text, store, ids);
    const auto report = validation::validate_document(read.document, &store);
    CHECK(with_code(report, "schema.invalid").empty());
    CHECK(report.errorCount == 0);
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 006: the warning table.irregular (T124; FR-062; SC-011; C66; I19, I20; U41;        */
/* contracts/rpc-api.md §3.2, contracts/document-model.md §4, data-model §3.7)                */
/* ----------------------------------------------------------------------------------------- */

namespace {

nlohmann::json grid_vectors() {
    const std::string vectors_text =
        test::read_text(test::fixtures_dir() / "tables" / "grid-vectors.json");
    nlohmann::json vectors = nlohmann::json::parse(vectors_text, nullptr, false);
    REQUIRE_FALSE(vectors.is_discarded());
    return vectors;
}

// The params of the irregular vector cases that make-fixtures.py wrote into `fixture` (T012),
// each as its JSON text (keys sorted), in a sorted list: a multiset.
std::vector<std::string> irregular_case_params(const nlohmann::json& vectors,
                                               const std::string& fixture) {
    std::vector<std::string> out;
    for (const auto& c : vectors.at("cases")) {
        if (c.value("fixture", "") == fixture && !c.at("expect").at("regular").get<bool>()) {
            out.push_back(c.at("expect").at("params").dump());
        }
    }
    std::sort(out.begin(), out.end());
    return out;
}

std::string params_text(const model::ValidationIssue& issue) {
    return nlohmann::json(issue.params).dump();
}

std::vector<const model::ValidationIssue*> irregular_of(
    const std::vector<model::ValidationIssue>& issues) {
    std::vector<const model::ValidationIssue*> out;
    for (const auto& issue : issues) {
        if (issue.code == "table.irregular") {
            out.push_back(&issue);
        }
    }
    return out;
}

std::string plain_text(const model::Node& node) {
    std::string out;
    for (const auto& child : node.content) {
        if (child.is_text()) {
            out += child.text;
        }
    }
    return out;
}

// Each vector table of a fixture book by its node id: the table right after the paragraph
// "Case <name> (<spec>)" that make-fixtures.py writes before it (T012).
void collect_case_tables(const model::Node& node, std::map<std::string, std::string>& out) {
    for (std::size_t i = 0; i < node.content.size(); ++i) {
        const model::Node& child = node.content[i];
        if (child.type == "table" && i > 0 && node.content[i - 1].type == "p") {
            const std::string caption = plain_text(node.content[i - 1]);
            if (caption.rfind("Case ", 0) == 0) {
                const std::size_t end = caption.find(' ', 5);
                out[child.node_id()] =
                    caption.substr(5, end == std::string::npos ? std::string::npos : end - 5);
            }
        }
        if (!child.is_text()) {
            collect_case_tables(child, out);
        }
    }
}

std::map<std::string, std::string> case_tables(const model::Document& document) {
    std::map<std::string, std::string> out;
    for (const auto& body : document.bodies) {
        collect_case_tables(body, out);
    }
    const model::Description& d = document.description;
    if (d.titleInfo.annotation) {
        collect_case_tables(*d.titleInfo.annotation, out);
    }
    if (d.srcTitleInfo && d.srcTitleInfo->annotation) {
        collect_case_tables(*d.srcTitleInfo->annotation, out);
    }
    if (d.documentInfo.history) {
        collect_case_tables(*d.documentInfo.history, out);
    }
    return out;
}

// The text form's model-level checks as doc.validate {text} runs them (validate_text_with_model,
// core/src/server/handlers/doc_handlers.cpp): a scratch read of the text that records the tags'
// positions, the consistency checks, then the line and column of each table.irregular.
std::vector<model::ValidationIssue> text_form_issues(const std::string& given,
                                                     const BinaryStore* placeholders = nullptr) {
    MemoryBinaryStore scratch;
    model::NodeIdAllocator ids;
    fb2::ReadOptions options;
    options.force_encoding = "utf-8";
    options.compute_schema_hint = false;
    options.placeholder_source = placeholders;
    options.record_positions = true;
    const fb2::ReadResult read = fb2::read_bytes(given, scratch, ids, options);
    REQUIRE(read.positions.has_value());
    std::vector<model::ValidationIssue> issues =
        validation::consistency_issues(read.document, &scratch);
    validation::attach_table_positions(issues, *read.positions, given);
    return issues;
}

// The 1-based line of byte `offset` of `str`.
int line_of(const std::string& str, std::size_t offset) {
    return 1 + static_cast<int>(std::count(
                   str.begin(), str.begin() + static_cast<std::ptrdiff_t>(offset), '\n'));
}

// Line `line` (1-based) of `str`, without its line feed ("" past the end).
std::string line_text(const std::string& str, int line) {
    std::size_t begin = 0;
    for (int l = 1; l < line; ++l) {
        begin = str.find('\n', begin);
        if (begin == std::string::npos) {
            return "";
        }
        ++begin;
    }
    const std::size_t end = str.find('\n', begin);
    return str.substr(begin, end == std::string::npos ? std::string::npos : end - begin);
}

// Whether `line` holds a start tag `<table` after the writer's tabs.
bool starts_with_table(const std::string& line) {
    const std::size_t first = line.find_first_not_of('\t');
    return first != std::string::npos && line.compare(first, 6, "<table") == 0;
}

// [a, b] / [c]: row 2 covers 1 of 2 columns.
model::Node short_row_table() {
    return element("table",
                   {element("tr", {element("td", {text("a")}), element("td", {text("b")})}),
                    element("tr", {element("td", {text("c")})})});
}

const nlohmann::json kShortRowParams = {{"rows", 2},   {"columns", 2}, {"shortRows", 1},
                                        {"row", 2},    {"covered", 1}, {"overlaps", 0},
                                        {"pastEnd", 0}};

}  // namespace

TEST_CASE(
    "validator: one table.irregular warning per irregular table of tables.fb2, none for a regular "
    "table; errorCount unchanged",
    "[validator][tables]") {
    auto l = load("tables.fb2");
    const model::Document& doc = l->result.document;
    const auto report = validation::validate_document(doc, &l->store, l->result.xlink_prefix);
    const auto irregular = with_code(report, "table.irregular");
    const nlohmann::json vectors = grid_vectors();
    const std::vector<std::string> expected = irregular_case_params(vectors, "tables.fb2");
    REQUIRE(expected.size() == 13);
    std::vector<std::string> actual;
    for (const auto* issue : irregular) {
        INFO(params_text(*issue));
        CHECK(issue->severity == model::Severity::warning);
        REQUIRE(issue->nodeId.has_value());
        REQUIRE(issue->path.has_value());
        const model::Node* table = model::find_node(doc, *issue->nodeId);
        REQUIRE(table != nullptr);
        CHECK(table->type == "table");
        CHECK(*issue->path == model::node_path(doc, *issue->nodeId));
        CHECK(issue->line.has_value());
        actual.push_back(params_text(*issue));
    }
    std::sort(actual.begin(), actual.end());
    CHECK(actual == expected);
    // The book is valid and has no other warning: the warning counts among the warnings only.
    CHECK(report.errorCount == 0);
    CHECK(report.warningCount == static_cast<int>(irregular.size()));
    CHECK(report.issues.size() == irregular.size());

    // Exactly the irregular vector tables carry it, each with its own case's params; no regular
    // table does (T012: every other table of the book is regular).
    std::map<std::string, nlohmann::json> cases;
    for (const auto& c : vectors.at("cases")) {
        cases[c.at("name").get<std::string>()] = c;
    }
    const std::map<std::string, std::string> found = case_tables(doc);
    std::set<std::string> irregular_tables;
    std::size_t regular_tables = 0;
    for (const auto& [node_id, name] : found) {
        INFO(name);
        REQUIRE(cases.count(name) == 1);
        if (cases[name].at("expect").at("regular").get<bool>()) {
            ++regular_tables;
        } else {
            irregular_tables.insert(node_id);
        }
    }
    CHECK(regular_tables > 0);
    CHECK(irregular_tables.size() == expected.size());
    std::set<std::string> warned;
    for (const auto* issue : irregular) {
        warned.insert(*issue->nodeId);
        const auto it = found.find(*issue->nodeId);
        REQUIRE(it != found.end());
        INFO(it->second);
        CHECK(params_text(*issue) == cases[it->second].at("expect").at("params").dump());
    }
    CHECK(warned == irregular_tables);
}

TEST_CASE(
    "validator: table.irregular carries the line of <table> in the writer's text (document "
    "form), and its line and UTF-16 column in the given text (text form)",
    "[validator][tables]") {
    // Document form: the line of the table's `<table` in the writer's text with binaries elided
    // (the text the Source view shows for the model), and no column.
    auto l = load("tables.fb2");
    const model::Document& doc = l->result.document;
    fb2::WriteOptions options;
    options.elide_binaries = true;
    options.xlink_prefix = l->result.xlink_prefix;
    const fb2::WriteResult elided = fb2::write_document(doc, &l->store, options);
    options.positions = true;
    const fb2::WriteResult mapped = fb2::write_document(doc, &l->store, options);
    REQUIRE(mapped.text == elided.text);
    REQUIRE(mapped.positions.has_value());
    const auto report = validation::validate_document(doc, &l->store, l->result.xlink_prefix);
    const auto irregular = with_code(report, "table.irregular");
    REQUIRE(irregular.size() == 13);
    for (const auto* issue : irregular) {
        INFO(issue->path.value_or("?"));
        REQUIRE(issue->nodeId.has_value());
        const fb2::PositionEntry* entry = mapped.positions->find(*issue->nodeId);
        REQUIRE(entry != nullptr);
        REQUIRE(elided.text.compare(entry->tagBegin, 6, "<table") == 0);
        CHECK(issue->line == line_of(elided.text, entry->tagBegin));
        CHECK_FALSE(issue->column.has_value());
        CHECK(starts_with_table(line_text(elided.text, issue->line.value_or(0))));
    }
    // The report stays sorted by line (finalize_report): the warnings stand at their lines.
    std::vector<int> lines;
    for (const auto& issue : report.issues) {
        if (issue.line) {
            lines.push_back(*issue.line);
        }
    }
    CHECK(std::is_sorted(lines.begin(), lines.end()));

    // Text form: a text indented by hand, in which a `<table>` does not start its line - a
    // comment with Cyrillic and an astral character (U+1F600, two UTF-16 units) before it, a
    // paragraph before another - read as validate_text_with_model reads it.
    const std::string given = test::minimal_book(
        "<section>\n"
        "<p>Before the tables</p>\n"
        "\t<!-- Таблица \xF0\x9F\x98\x80 --> "
        "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>\n"
        "<p>Between</p><table id=\"t9\"><tr><td colspan=\"2\">x</td></tr><tr><td>y</td></tr>"
        "</table>\n"
        "</section>");
    REQUIRE(validation::validate_xml_text(given).errorCount == 0);
    const auto issues = text_form_issues(given);
    const auto found = irregular_of(issues);
    REQUIRE(found.size() == 2);
    std::map<std::string, const model::ValidationIssue*> by_path;
    for (const auto* issue : found) {
        REQUIRE(issue->path.has_value());
        by_path[*issue->path] = issue;
    }
    REQUIRE(by_path.count("body[1]/section[1]/table[1]") == 1);
    REQUIRE(by_path.count("body[1]/section[1]/table[2]") == 1);
    const model::ValidationIssue& commented = *by_path["body[1]/section[1]/table[1]"];
    CHECK(commented.line == line_of(given, given.find("<table>")));
    // "\t<!-- Таблица 😀 --> " is 21 UTF-16 units (1 + 5 + 7 + 1 + 2 + 4 + 1), 30 bytes and 20
    // code points: the column is 1 + its UTF-16 length.
    CHECK(commented.column == 22);
    CHECK(nlohmann::json(commented.params) == kShortRowParams);
    CHECK(commented.nodeId.has_value());
    const model::ValidationIssue& named = *by_path["body[1]/section[1]/table[2]"];
    CHECK(named.line == line_of(given, given.find("<table id=\"t9\">")));
    CHECK(named.line == commented.line.value_or(0) + 1);
    CHECK(named.column == 15);  // after "<p>Between</p>"
    CHECK(nlohmann::json(named.params) == nlohmann::json{{"rows", 2},
                                                         {"columns", 2},
                                                         {"shortRows", 1},
                                                         {"row", 2},
                                                         {"covered", 1},
                                                         {"overlaps", 0},
                                                         {"pastEnd", 0},
                                                         {"id", "t9"}});
}

TEST_CASE("validator: both forms give the same path for the same table", "[validator][tables]") {
    // C66, U41: the assistant compares a document-form baseline with text-form changes by path
    // and params. The text form runs on the text the Source view shows for the model: the
    // writer's text with binaries elided, whose placeholders re-attach the store's bytes.
    auto l = load("tables.fb2");
    const model::Document& doc = l->result.document;
    fb2::WriteOptions options;
    options.elide_binaries = true;
    options.xlink_prefix = l->result.xlink_prefix;
    const std::string source = fb2::write_document(doc, &l->store, options).text;
    const auto document_form =
        validation::validate_document(doc, &l->store, l->result.xlink_prefix);
    const auto text_issues = text_form_issues(source, &l->store);
    std::map<std::string, const model::ValidationIssue*> in_document;
    std::map<std::string, const model::ValidationIssue*> in_text;
    for (const auto* issue : with_code(document_form, "table.irregular")) {
        REQUIRE(issue->path.has_value());
        CHECK(in_document.emplace(*issue->path, issue).second);  // one per table
    }
    for (const auto* issue : irregular_of(text_issues)) {
        REQUIRE(issue->path.has_value());
        CHECK(in_text.emplace(*issue->path, issue).second);
    }
    REQUIRE(in_document.size() == 13);
    REQUIRE(in_text.size() == in_document.size());
    for (const auto& [path, issue] : in_document) {
        INFO(path);
        const auto it = in_text.find(path);
        REQUIRE(it != in_text.end());
        const model::ValidationIssue& text_issue = *it->second;
        CHECK(text_issue.params == issue->params);
        // The same text, so the same line; the text form adds the column of `<`, after the
        // writer's tabs (one UTF-16 unit each).
        CHECK(text_issue.line == issue->line);
        const std::string line = line_text(source, text_issue.line.value_or(0));
        REQUIRE(starts_with_table(line));
        CHECK(text_issue.column == static_cast<int>(line.find_first_not_of('\t')) + 1);
        CHECK(text_issue.nodeId.has_value());
    }
}

TEST_CASE(
    "validator: tables in a cite, a section annotation, the book's and the source book's "
    "annotations and the history are analysed",
    "[validator][tables]") {
    model::Document doc;
    model::Node regular =
        element("table", {element("tr", {element("td", {text("a")}), element("td", {text("b")})}),
                          element("tr", {element("td", {text("c")}), element("td", {text("d")})})});
    doc.bodies.push_back(element(
        "body",
        {element("section",
                 {element("p", {text("one")}),
                  element("cite", {element("p", {text("quoted")}), short_row_table()}), regular}),
         element("section",
                 {element("annotation", {element("p", {text("about")}), short_row_table()}),
                  element("p", {text("two")})})}));
    doc.description.titleInfo.annotation = element("annotation", {short_row_table()});
    model::TitleInfo source;
    source.annotation = element("annotation", {element("p", {text("source")}), short_row_table()});
    doc.description.srcTitleInfo = source;
    doc.description.documentInfo.history = element("annotation", {short_row_table(), regular});
    model::NodeIdAllocator ids;
    model::assign_node_ids(doc, ids);

    const auto check_tables = [&](const std::vector<const model::ValidationIssue*>& irregular) {
        std::set<std::string> paths;
        for (const auto* issue : irregular) {
            INFO(issue->path.value_or("?"));
            CHECK(issue->severity == model::Severity::warning);
            REQUIRE(issue->nodeId.has_value());
            REQUIRE(issue->path.has_value());
            CHECK(model::node_path(doc, *issue->nodeId) == *issue->path);
            CHECK(nlohmann::json(issue->params) == kShortRowParams);
            paths.insert(*issue->path);
        }
        CHECK(irregular.size() == 5);
        CHECK(paths == std::set<std::string>{"body[1]/section[1]/cite[1]/table[1]",
                                             "body[1]/section[2]/annotation[1]/table[1]",
                                             "title-info/annotation[1]/table[1]",
                                             "src-title-info/annotation[1]/table[1]",
                                             "document-info/history[1]/table[1]"});
    };
    const auto issues = validation::consistency_issues(doc, nullptr);
    check_tables(irregular_of(issues));

    // The document form reports the same tables, each at the line of its `<table`.
    const auto report = validation::validate_document(doc, nullptr);
    const auto irregular = with_code(report, "table.irregular");
    check_tables(irregular);
    fb2::WriteOptions options;
    options.elide_binaries = true;
    const std::string written = fb2::write_document(doc, nullptr, options).text;
    for (const auto* issue : irregular) {
        INFO(issue->path.value_or("?"));
        REQUIRE(issue->line.has_value());
        CHECK(starts_with_table(line_text(written, *issue->line)));
    }
}

TEST_CASE("validator: malformed text gives no table.irregular", "[validator][tables]") {
    // The text form adds the model-level checks only to a well-formed text (rpc-api.md,
    // Definitions): a malformed one has no model, so its irregular table is not reported.
    const std::string malformed = test::minimal_book(
        "<section><table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>"
        "<p>never closed</section>");
    const auto report = validation::validate_xml_text(malformed);
    REQUIRE(report.errorCount == 1);
    REQUIRE(report.issues.size() == 1);
    CHECK(report.issues[0].code == "xml.notWellFormed");
    CHECK(with_code(report, "table.irregular").empty());
    MemoryBinaryStore scratch;
    model::NodeIdAllocator ids;
    fb2::ReadOptions options;
    options.force_encoding = "utf-8";
    options.compute_schema_hint = false;
    options.record_positions = true;
    CHECK_THROWS_AS(fb2::read_bytes(malformed, scratch, ids, options), fb2::ParseFailure);
}
