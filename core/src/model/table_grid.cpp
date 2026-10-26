// The table grid (feature 006; contracts/document-model.md §4, normative). See
// mfbe/table_grid.hpp; the TypeScript twin is ui/src/editor/table/grid.ts.
#include <mfbe/table_grid.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <queue>
#include <utility>

namespace mfbe::tables {
namespace {

// The range of the reader's parse_int (core/src/xml/fb2_reader.cpp): spans above it are kept
// verbatim in unknownAttrs; as model numbers they count 1.
constexpr std::int64_t kMaxReadValue = 1000000000;

bool is_cell(const model::Node& node) {
    return node.type == "td" || node.type == "th";
}

// Rule 2: the value decides, not the JSON type - 2 and 2.0 count 2, 1e21 counts 1.
std::int64_t effective_span(const model::Node& cell, const char* name, std::int64_t limit) {
    const auto it = cell.attrs.find(name);
    if (it == cell.attrs.end()) {
        return 1;
    }
    const nlohmann::json& value = it->second;
    std::int64_t span = 0;
    if (value.is_number_unsigned()) {
        const auto v = value.get<std::uint64_t>();
        if (v > static_cast<std::uint64_t>(kMaxReadValue)) {
            return 1;
        }
        span = static_cast<std::int64_t>(v);
    } else if (value.is_number_integer()) {
        span = value.get<std::int64_t>();
    } else if (value.is_number_float()) {
        const double v = value.get<double>();
        if (!std::isfinite(v) || v != std::floor(v) || v < 1.0 ||
            v > static_cast<double>(kMaxReadValue)) {
            return 1;
        }
        span = static_cast<std::int64_t>(v);
    } else {
        return 1;  // absent, null, a string, a boolean, an object
    }
    if (span < 1 || span > kMaxReadValue) {
        return 1;
    }
    return std::min(span, limit);
}

// A segment tree over the columns [0, size) with nodes made on demand: a cover count per
// canonical node (never pushed down) and the covered length below each node, the structure of
// the union-of-rectangles sweep. Its memory grows with the intervals added, never with the
// columns; every operation is O(log size).
class CoverTree {
public:
    explicit CoverTree(std::int64_t size) : size_(size) { nodes_.emplace_back(); }

    // The covered length of the whole range.
    std::int64_t total() const { return nodes_[0].length; }

    void add(std::int64_t from, std::int64_t to, std::int64_t delta) {
        if (from < to) {
            update(0, 0, size_, from, to, delta);
        }
    }

    // The first column at or after `from` that no interval covers (`size` when there is none).
    std::int64_t first_free(std::int64_t from) const {
        const std::int64_t found = find_free(0, 0, size_, from);
        return found < 0 ? size_ : found;
    }

    // The covered length within [from, to).
    std::int64_t covered_in(std::int64_t from, std::int64_t to) const {
        return from < to ? covered_below(0, 0, size_, from, to) : 0;
    }

private:
    struct Node {
        std::int64_t count = 0;   // intervals covering this node's whole range
        std::int64_t length = 0;  // the covered length within this node's range
        std::size_t lower = 0;    // child indices; 0 = not made yet (the root is no child)
        std::size_t upper = 0;
    };

    // Indices only: making a child may move the nodes.
    std::size_t child(std::size_t node, bool upper) {
        std::size_t next = upper ? nodes_[node].upper : nodes_[node].lower;
        if (next == 0) {
            next = nodes_.size();
            nodes_.emplace_back();
            (upper ? nodes_[node].upper : nodes_[node].lower) = next;
        }
        return next;
    }

    void pull(std::size_t node, std::int64_t lo, std::int64_t hi) {
        Node& n = nodes_[node];
        if (n.count > 0) {
            n.length = hi - lo;
            return;
        }
        n.length = (n.lower != 0 ? nodes_[n.lower].length : 0) +
                   (n.upper != 0 ? nodes_[n.upper].length : 0);
    }

    void update(std::size_t node, std::int64_t lo, std::int64_t hi, std::int64_t from,
                std::int64_t to, std::int64_t delta) {
        if (from <= lo && hi <= to) {
            nodes_[node].count += delta;
            pull(node, lo, hi);
            return;
        }
        const std::int64_t mid = lo + (hi - lo) / 2;
        if (from < mid) {
            update(child(node, false), lo, mid, from, to, delta);
        }
        if (to > mid) {
            update(child(node, true), mid, hi, from, to, delta);
        }
        pull(node, lo, hi);
    }

    std::int64_t find_free(std::size_t node, std::int64_t lo, std::int64_t hi,
                           std::int64_t from) const {
        if (hi <= from) {
            return -1;
        }
        const Node& n = nodes_[node];
        if (n.count > 0 || n.length == hi - lo) {
            return -1;
        }
        if (n.length == 0) {
            return std::max(lo, from);
        }
        const std::int64_t mid = lo + (hi - lo) / 2;
        const std::int64_t in_lower = n.lower == 0 ? (mid > from ? std::max(lo, from) : -1)
                                                   : find_free(n.lower, lo, mid, from);
        if (in_lower >= 0) {
            return in_lower;
        }
        return n.upper == 0 ? std::max(mid, from) : find_free(n.upper, mid, hi, from);
    }

    std::int64_t covered_below(std::size_t node, std::int64_t lo, std::int64_t hi,
                               std::int64_t from, std::int64_t to) const {
        if (to <= lo || hi <= from) {
            return 0;
        }
        const Node& n = nodes_[node];
        if (n.count > 0) {
            return std::min(to, hi) - std::max(from, lo);
        }
        if (from <= lo && hi <= to) {
            return n.length;
        }
        const std::int64_t mid = lo + (hi - lo) / 2;
        return (n.lower != 0 ? covered_below(n.lower, lo, mid, from, to) : 0) +
               (n.upper != 0 ? covered_below(n.upper, mid, hi, from, to) : 0);
    }

    std::int64_t size_;
    std::vector<Node> nodes_;
};

// The columns a tall cell covers in the rows below its own, until the row `until`.
struct Span {
    std::int64_t until = 0;
    std::int64_t left = 0;
    std::int64_t right = 0;
};

struct EndsLater {
    bool operator()(const Span& a, const Span& b) const { return a.until > b.until; }
};

}  // namespace

std::int64_t effective_colspan(const model::Node& cell) {
    return effective_span(cell, "colspan", kMaxColspan);
}

std::int64_t effective_rowspan(const model::Node& cell) {
    return effective_span(cell, "rowspan", kMaxRowspan);
}

std::vector<std::int64_t> GridAnalysis::short_rows() const {
    std::vector<std::int64_t> out;
    for (std::size_t r = 0; r < covered.size(); ++r) {
        if (covered[r] < columns) {
            out.push_back(static_cast<std::int64_t>(r) + 1);
        }
    }
    return out;
}

bool GridAnalysis::regular() const {
    return overlaps == 0 && past_end == 0 &&
           std::none_of(covered.begin(), covered.end(),
                        [this](std::int64_t c) { return c < columns; });
}

GridAnalysis analyse(const model::Node& table) {
    GridAnalysis out;
    // Rule 1: the rows are the `tr` children; every other child is ignored.
    std::vector<const model::Node*> rows;
    // The tree's range: every start column lies below the sum of the colspans (a cell starts at
    // the end of its predecessor or at a column an earlier cell covers).
    std::int64_t colspan_sum = 1;
    std::size_t cell_count = 0;
    for (const model::Node& child : table.content) {
        if (child.type != "tr") {
            continue;
        }
        rows.push_back(&child);
        for (const model::Node& cell : child.content) {
            if (is_cell(cell)) {
                colspan_sum += effective_colspan(cell);
                ++cell_count;
            }
        }
    }
    const auto height = static_cast<std::int64_t>(rows.size());
    out.rows = height;
    out.covered.reserve(rows.size());
    out.cells.reserve(cell_count);
    std::int64_t size = 1;
    while (size < colspan_sum) {
        size *= 2;
    }
    CoverTree from_above(size);
    std::priority_queue<Span, std::vector<Span>, EndsLater> expiring;
    std::vector<Span> tall;
    for (std::int64_t r = 0; r < height; ++r) {
        // The spans that no longer reach row r leave the tree.
        while (!expiring.empty() && expiring.top().until <= r) {
            from_above.add(expiring.top().left, expiring.top().right, -1);
            expiring.pop();
        }
        const bool spans_above = from_above.total() > 0;
        tall.clear();
        // Rule 3: each cell starts at the first column, at or after the end of the previous
        // cell of its row, that no cell from above covers.
        std::int64_t end = 0;
        for (const model::Node& cell : rows[static_cast<std::size_t>(r)]->content) {
            if (!is_cell(cell)) {
                continue;
            }
            const std::int64_t colspan = effective_colspan(cell);
            const std::int64_t rowspan = effective_rowspan(cell);
            CellPlace place;
            place.row = r;
            place.column = spans_above ? from_above.first_free(end) : end;
            place.colspan = colspan;
            place.rows_in = std::min(rowspan, height - r);
            // Rule 6: the cells of one row never share a position, so an overlap is always the
            // later cell's colspan running into a span from above (§4.6).
            place.overlaps =
                spans_above && from_above.covered_in(place.column, place.column + colspan) > 0;
            place.past_end = rowspan > height - r;
            out.overlaps += place.overlaps ? 1 : 0;
            out.past_end += place.past_end ? 1 : 0;
            end = place.column + colspan;
            out.columns = std::max(out.columns, end);
            if (place.rows_in > 1) {
                tall.push_back(Span{r + place.rows_in, place.column, end});
            }
            out.cells.push_back(place);
        }
        // The own cells and the spans from above cover [0, end) without a gap; beyond it only
        // spans from above cover positions (rule 5).
        out.covered.push_back(spans_above ? end + from_above.total() - from_above.covered_in(0, end)
                                          : end);
        for (const Span& span : tall) {
            from_above.add(span.left, span.right, 1);
            if (span.until < height) {
                expiring.push(span);
            }
        }
    }
    return out;
}

std::map<std::string, nlohmann::json> irregularity_params(const GridAnalysis& grid,
                                                          const model::Node& table) {
    std::map<std::string, nlohmann::json> params;
    params["rows"] = grid.rows;
    params["columns"] = grid.columns;
    std::int64_t short_rows = 0;
    std::size_t first_short = grid.covered.size();
    for (std::size_t r = 0; r < grid.covered.size(); ++r) {
        if (grid.covered[r] < grid.columns) {
            ++short_rows;
            first_short = std::min(first_short, r);
        }
    }
    params["shortRows"] = short_rows;
    if (first_short < grid.covered.size()) {
        params["row"] = static_cast<std::int64_t>(first_short) + 1;
        params["covered"] = grid.covered[first_short];
    }
    params["overlaps"] = grid.overlaps;
    params["pastEnd"] = grid.past_end;
    if (const auto id = table.attr_string("id"); id && !id->empty()) {
        params["id"] = *id;
    }
    return params;
}

}  // namespace mfbe::tables
