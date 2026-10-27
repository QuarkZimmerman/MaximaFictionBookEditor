// Feature 006 (T124; FR-062; SC-011; C1, C22; I19, I21; contracts/document-model.md §4, normative,
// and its Tests): the core's table grid, mfbe::tables (core/include/mfbe/table_grid.hpp). Every
// case of the shared vectors tests/fixtures/tables/grid-vectors.json gives its placement, width,
// coverage, problems and params - the parity rule of §4.14, whose TypeScript half is
// ui/tests/unit/editor/table/grid-vectors.test.ts; hostile spans stay bounded (§4.10); the
// params are the members of TableSummary (§4.8).
#include "test_support.hpp"

#include <mfbe/json_codec.hpp>
#include <mfbe/table_grid.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cmath>
#include <limits>
#include <string>
#include <vector>

using namespace mfbe;
using nlohmann::json;

namespace {

json read_vectors() {
    const std::string text = test::read_text(test::fixtures_dir() / "tables" / "grid-vectors.json");
    json vectors = json::parse(text, nullptr, false);
    REQUIRE_FALSE(vectors.is_discarded());
    return vectors;
}

// A child that is neither a row nor a cell, as the reader keeps it from an invalid book.
json raw_xml_child(const std::string& node_id) {
    return json{
        {"type", "raw-xml"},
        {"attrs", json{{"nodeId", node_id}, {"xml", "<caption>raw</caption>"}, {"inline", false}}}};
}

// A vectors table (§4.14: `{attrs?, rows: (Cell[] | {type: "raw-xml"})[]}`) as the model JSON of
// a table with synthetic node ids, read with model::node_from_json.
model::Node model_table(const json& table) {
    int counter = 0;
    const auto next_id = [&counter] { return "v" + std::to_string(++counter); };
    json node{{"type", "table"},
              {"attrs", table.value("attrs", json::object())},
              {"content", json::array()}};
    node["attrs"]["nodeId"] = next_id();
    for (const json& row : table.at("rows")) {
        if (row.is_object()) {
            node["content"].push_back(raw_xml_child(next_id()));
            continue;
        }
        json tr{{"type", "tr"}, {"attrs", json{{"nodeId", next_id()}}}, {"content", json::array()}};
        for (const json& cell : row) {
            const std::string type = cell.value("type", "td");
            if (type == "raw-xml") {
                tr["content"].push_back(raw_xml_child(next_id()));
                continue;
            }
            json td{{"type", type},
                    {"attrs", cell.value("attrs", json::object())},
                    {"content", json::array({json{{"type", "text"}, {"text", "x"}}})}};
            td["attrs"]["nodeId"] = next_id();
            tr["content"].push_back(std::move(td));
        }
        node["content"].push_back(std::move(tr));
    }
    return model::node_from_json(node);
}

// A cell with the given attributes (the model's values, kept as JSON).
model::Node cell(std::map<std::string, json> attrs = {}, const std::string& type = "td") {
    model::Node node;
    node.type = type;
    node.attrs = std::move(attrs);
    return node;
}

model::Node row(std::vector<model::Node> cells) {
    model::Node node;
    node.type = "tr";
    node.content = std::move(cells);
    return node;
}

model::Node table(std::vector<model::Node> rows, std::map<std::string, json> attrs = {}) {
    model::Node node;
    node.type = "table";
    node.attrs = std::move(attrs);
    node.content = std::move(rows);
    return node;
}

json cells_json(const tables::GridAnalysis& grid) {
    json out = json::array();
    for (const tables::CellPlace& place : grid.cells) {
        out.push_back(json::array({place.row, place.column, place.colspan, place.rows_in}));
    }
    return out;
}

json params_json(const tables::GridAnalysis& grid, const model::Node& node) {
    json out = json::object();
    for (const auto& [key, value] : tables::irregularity_params(grid, node)) {
        out[key] = value;
    }
    return out;
}

double elapsed_ms(std::chrono::steady_clock::time_point since) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - since)
        .count();
}

}  // namespace

TEST_CASE(
    "table grid: the shared vectors give their placement, width, coverage, problems and params",
    "[table-grid]") {
    const json vectors = read_vectors();
    REQUIRE(vectors.at("version") == 1);
    CHECK(vectors.at("maxColspan") == tables::kMaxColspan);
    CHECK(vectors.at("maxRowspan") == tables::kMaxRowspan);
    const json& cases = vectors.at("cases");
    REQUIRE(cases.size() >= 30);
    std::size_t irregular = 0;
    for (const json& c : cases) {
        const std::string name = c.at("name");
        INFO("case " << name);
        const json& expect = c.at("expect");
        const model::Node node = model_table(c.at("table"));
        const tables::GridAnalysis grid = tables::analyse(node);
        CHECK(grid.rows == expect.at("rows").get<std::int64_t>());
        CHECK(grid.columns == expect.at("columns").get<std::int64_t>());
        CHECK(json(grid.covered).dump() == expect.at("covered").dump());
        CHECK(json(grid.short_rows()).dump() == expect.at("shortRows").dump());
        CHECK(grid.overlaps == expect.at("overlaps").get<std::int64_t>());
        CHECK(grid.past_end == expect.at("pastEnd").get<std::int64_t>());
        CHECK(grid.regular() == expect.at("regular").get<bool>());
        CHECK(cells_json(grid).dump() == expect.at("cells").dump());
        // The flags of each cell agree with the totals (rule 6: once per cell).
        std::int64_t overlapping = 0;
        std::int64_t past_end = 0;
        for (const tables::CellPlace& place : grid.cells) {
            overlapping += place.overlaps ? 1 : 0;
            past_end += place.past_end ? 1 : 0;
        }
        CHECK(overlapping == grid.overlaps);
        CHECK(past_end == grid.past_end);
        CHECK(params_json(grid, node).dump() == expect.at("params").dump());
        irregular += grid.regular() ? 0 : 1;
    }
    // The vectors hold both kinds (§4.14, "Cases, at least").
    CHECK(irregular > 0);
    CHECK(irregular < cases.size());
}

TEST_CASE("table grid: hostile spans stay bounded", "[table-grid]") {
    // Effective spans decide by value (rule 2): an integer from 1 to 10⁹, integer or float,
    // capped; everything else counts 1.
    CHECK(tables::effective_colspan(cell({{"colspan", 1000000000}})) == 1000);
    CHECK(tables::effective_rowspan(cell({{"rowspan", 1000000000}})) == tables::kMaxRowspan);
    CHECK(tables::effective_colspan(cell({{"colspan", 1000000001}})) == 1);
    CHECK(tables::effective_rowspan(cell({{"rowspan", 3000000000LL}})) == 1);
    CHECK(tables::effective_rowspan(cell({{"rowspan", 3000000000ULL}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", 5000}})) == 1000);
    CHECK(tables::effective_rowspan(cell({{"rowspan", 70000}})) == tables::kMaxRowspan);
    CHECK(tables::effective_colspan(cell({{"colspan", 2.0}})) == 2);
    CHECK(tables::effective_rowspan(cell({{"rowspan", 3.0}})) == 3);
    CHECK(tables::effective_colspan(cell({{"colspan", 1e21}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", 2.5}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", -2.0}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", 0}})) == 1);
    CHECK(tables::effective_rowspan(cell({{"rowspan", -1}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", "2"}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", true}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", nullptr}})) == 1);
    CHECK(tables::effective_colspan(cell({{"colspan", std::numeric_limits<double>::infinity()}})) ==
          1);
    CHECK(tables::effective_colspan(cell({{"colspan", std::nan("")}})) == 1);
    CHECK(tables::effective_colspan(cell()) == 1);
    CHECK(tables::effective_colspan(cell({{"unknownAttrs", json{{"colspan", 4}}}})) == 1);

    // colspan 10⁹ counts 1000.
    const tables::GridAnalysis wide =
        tables::analyse(table({row({cell({{"colspan", 1000000000}})})}));
    CHECK(wide.columns == 1000);
    CHECK(wide.regular());

    // 50 cells of colspan 1000: W = 50,000, regular (vR3:66).
    std::vector<model::Node> fifty;
    for (int i = 0; i < 50; ++i) {
        fifty.push_back(cell({{"colspan", 1000}}));
    }
    const tables::GridAnalysis broad = tables::analyse(table({row(fifty)}));
    CHECK(broad.columns == 50000);
    REQUIRE(broad.covered.size() == 1);
    CHECK(broad.covered[0] == 50000);
    CHECK(broad.cells.back().column == 49000);
    CHECK(broad.regular());

    // A rowspan of 3,000,000,000, above INT_MAX, as a script could set it, counts 1.
    const tables::GridAnalysis tall = tables::analyse(
        table({row({cell({{"rowspan", 3000000000LL}}), cell()}), row({cell(), cell()})}));
    REQUIRE(tall.cells.size() == 4);
    CHECK(tall.cells[0].rows_in == 1);
    CHECK_FALSE(tall.cells[0].past_end);
    CHECK(tall.regular());

    // A regular 1000 × 20 table within a coarse bound in the Debug build.
    std::vector<model::Node> rows;
    for (int r = 0; r < 1000; ++r) {
        rows.push_back(row(std::vector<model::Node>(20, cell())));
    }
    const model::Node large = table(std::move(rows));
    auto started = std::chrono::steady_clock::now();
    const tables::GridAnalysis big = tables::analyse(large);
    CHECK(elapsed_ms(started) < 2000.0);
    CHECK(big.rows == 1000);
    CHECK(big.columns == 20);
    CHECK(big.cells.size() == 20000);
    CHECK(big.regular());

    // A first row of 1000 cells of rowspan 65534 over 2000 rows: every later row's cell starts
    // after the tall ones (open point 4).
    std::vector<model::Node> hostile_rows;
    hostile_rows.push_back(row(std::vector<model::Node>(1000, cell({{"rowspan", 65534}}))));
    for (int r = 1; r < 2000; ++r) {
        hostile_rows.push_back(row({cell()}));
    }
    const model::Node hostile = table(std::move(hostile_rows));
    started = std::chrono::steady_clock::now();
    const tables::GridAnalysis skipped = tables::analyse(hostile);
    CHECK(elapsed_ms(started) < 2000.0);
    CHECK(skipped.rows == 2000);
    CHECK(skipped.columns == 1001);
    REQUIRE(skipped.cells.size() == 2999);
    CHECK(skipped.cells[999].rows_in == 2000);
    CHECK(skipped.cells[1000].column == 1000);
    CHECK(skipped.cells[2998].column == 1000);
    CHECK(skipped.past_end == 1000);
    CHECK(skipped.overlaps == 0);
    // The first row ends before the column the later rows reach: the one short row.
    CHECK(skipped.short_rows() == std::vector<std::int64_t>{1});
    CHECK(skipped.covered[0] == 1000);
    CHECK(skipped.covered[1] == 1001);
    CHECK(skipped.covered[1999] == 1001);
}

TEST_CASE(
    "table grid: irregularity_params give the members of TableSummary, row and covered only with "
    "a short row, id only when non-empty",
    "[table-grid]") {
    // [a, b, c] / [d, e]: one short row (US8 sc.1's shape).
    const auto short_row = [](std::map<std::string, json> attrs) {
        return table({row({cell(), cell(), cell()}), row({cell(), cell()})}, std::move(attrs));
    };
    const model::Node named = short_row({{"id", "t2"}});
    const json with_id = params_json(tables::analyse(named), named);
    CHECK(with_id == json{{"rows", 2},
                          {"columns", 3},
                          {"shortRows", 1},
                          {"row", 2},
                          {"covered", 2},
                          {"overlaps", 0},
                          {"pastEnd", 0},
                          {"id", "t2"}});
    for (const auto& [key, value] : with_id.items()) {
        INFO(key);
        CHECK((key == "id" ? value.is_string() : value.is_number_integer()));
    }
    // A missing, an empty and a non-string id give none.
    for (const auto& attrs : std::vector<std::map<std::string, json>>{
             {}, {{"id", ""}}, {{"id", 7}}, {{"id", nullptr}}}) {
        const model::Node anonymous = short_row(attrs);
        const json params = params_json(tables::analyse(anonymous), anonymous);
        CHECK(params == json{{"rows", 2},
                             {"columns", 3},
                             {"shortRows", 1},
                             {"row", 2},
                             {"covered", 2},
                             {"overlaps", 0},
                             {"pastEnd", 0}});
    }
    // Without a short row: no row and no covered; the counts are always there.
    const model::Node overlap = table(
        {row({cell(), cell({{"rowspan", 2}})}), row({cell({{"colspan", 2}})})}, {{"id", "o1"}});
    CHECK(params_json(tables::analyse(overlap), overlap) == json{{"rows", 2},
                                                                 {"columns", 2},
                                                                 {"shortRows", 0},
                                                                 {"overlaps", 1},
                                                                 {"pastEnd", 0},
                                                                 {"id", "o1"}});
    const model::Node regular = table({row({cell(), cell()}), row({cell(), cell()})});
    const tables::GridAnalysis grid = tables::analyse(regular);
    CHECK(grid.regular());
    CHECK(params_json(grid, regular) ==
          json{{"rows", 2}, {"columns", 2}, {"shortRows", 0}, {"overlaps", 0}, {"pastEnd", 0}});
    // Several short rows: `row` and `covered` name the first one, `shortRows` counts them.
    const model::Node several = table({row({cell(), cell(), cell()}), row({cell()}),
                                       row({cell(), cell()}), row({cell(), cell(), cell()})});
    CHECK(params_json(tables::analyse(several), several) == json{{"rows", 4},
                                                                 {"columns", 3},
                                                                 {"shortRows", 2},
                                                                 {"row", 2},
                                                                 {"covered", 1},
                                                                 {"overlaps", 0},
                                                                 {"pastEnd", 0}});
    // A table without rows: all counts 0, regular.
    const model::Node empty = table({});
    const tables::GridAnalysis none = tables::analyse(empty);
    CHECK(none.regular());
    CHECK(params_json(none, empty) ==
          json{{"rows", 0}, {"columns", 0}, {"shortRows", 0}, {"overlaps", 0}, {"pastEnd", 0}});
}
