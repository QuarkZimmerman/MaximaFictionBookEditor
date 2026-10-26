// The table grid (feature 006; contracts/document-model.md §4, normative; data-model §2, §3.7):
// how the cells of a model table occupy positions, when a table is irregular, and its summary -
// the C++ twin of the UI's ui/src/editor/table/grid.ts (I19); the shared vectors
// tests/fixtures/tables/grid-vectors.json pin both (the parity rule of §4.14, I21).
//
// - Input (rule 1): the rows are the table's `tr` children in order, a row's cells its `td` and
//   `th` children; every other child (raw XML kept from an invalid book) is ignored. Only the
//   spans matter, not the cell kind or any other attribute.
// - Effective spans (rule 2): the attribute's model value counts when it is a JSON number whose
//   value is finite and an integer from 1 to 1,000,000,000 (the reader's parse_int range) -
//   integer or float, so 2.0 counts 2 and 1e21 counts 1 - capped at kMaxColspan / kMaxRowspan;
//   anything else counts 1 (absent, null, 0, negative, fractional, a string, a boolean); a value
//   kept in `unknownAttrs` is not the attribute.
// - Placement (rule 3, the HTML table model): a cell of row r starts at the first column, at or
//   after the end of the previous cell of its row, that no earlier cell covers in row r, and
//   covers `[column, column + colspan)` of the rows `[r, r + rows_in)`,
//   `rows_in = min(rowspan, R - r)`. W is the largest end (0 without cells).
// - Problems (rule 6): a short row covers fewer than W positions of `[0, W)`; an overlap is a
//   cell covering a position an earlier cell covers (once per cell); past end is a cell whose
//   effective rowspan exceeds `R - r`. Regular (rule 7): none of them.
// - Bounds (rule 10, C22): the analysis never allocates per column or per position - the
//   columns covered from the rows above are kept as intervals in a segment tree whose nodes are
//   made on demand - so its memory and its time, O((cells + R) · log W), grow with the cells and
//   rows only, whatever the spans; every counter is 64-bit. It never throws on any model input.
//
// Users: the validation warning `table.irregular` (mfbe/validator.hpp; rpc-api.md §3.2), whose
// params are `irregularity_params` - the TableSummary of document-model §4.8.
#pragma once

#include <mfbe/document.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace mfbe::tables {

// The HTML table model's limits (MAX_COLSPAN and MAX_ROWSPAN of ui/src/editor/table/grid.ts).
inline constexpr std::int64_t kMaxColspan = 1000;
inline constexpr std::int64_t kMaxRowspan = 65534;

// The spans the grid counts for a cell (rule 2).
std::int64_t effective_colspan(const model::Node& cell);
std::int64_t effective_rowspan(const model::Node& cell);

// One cell in reading order; positions counted from 0.
struct CellPlace {
    std::int64_t row = 0;      // the row it stands in, also its top row
    std::int64_t column = 0;   // its first column
    std::int64_t colspan = 1;  // the effective colspan
    std::int64_t rows_in = 1;  // min(effective rowspan, R - row)
    bool overlaps = false;     // it covers a position an earlier cell covers
    bool past_end = false;     // its effective rowspan exceeds R - row
};

struct GridAnalysis {
    std::int64_t rows = 0;              // R
    std::int64_t columns = 0;           // W
    std::vector<std::int64_t> covered;  // covered(r): the positions of [0, W) covered at row r
    std::vector<CellPlace> cells;       // reading order
    std::int64_t overlaps = 0;          // overlapping cells
    std::int64_t past_end = 0;          // cells whose rowspan reaches past the last row

    // The short rows, counted from 1.
    std::vector<std::int64_t> short_rows() const;
    // No problem of any kind.
    bool regular() const;
};

GridAnalysis analyse(const model::Node& table);

// The TableSummary of document-model §4.8 as the flat params of a ValidationIssue: `rows`,
// `columns`, `shortRows`, `overlaps` and `pastEnd` always; `row` (the first short row, from 1)
// and `covered` (its coverage) only with a short row; `id` only when the table's `id` is a
// non-empty string. Every value is a number except `id`.
std::map<std::string, nlohmann::json> irregularity_params(const GridAnalysis& grid,
                                                          const model::Node& table);

}  // namespace mfbe::tables
