// FB2 writer (T043): document model -> FB2 2.1 XML (contracts/resource-formats.md §11).
//
// Output rules
//   - `<?xml version="1.0" encoding="<name>"?>`, root `<FictionBook xmlns=FB2 xmlns:<p>=xlink>`
//     where <p> is the input's xlink prefix (default "l"); foreign namespaces needed by
//     preserved unknown attributes are declared on the root as ns1, ns2, ...
//   - description in FB2 2.1 element order; required elements (genre, author, book-title,
//     lang, document author, date, id, version) are always written - empty when missing - so
//     validation can flag them (FR-052); optional empty elements are omitted.
//   - structural elements one per line, indented with one tab per level, "\n" line endings;
//     inline content (p, subtitle, v, text-author, td/th, date) is written untouched;
//   - marks nest in the canonical order link > style > strong > emphasis > strikethrough >
//     sub > sup > code (outermost first); marks of one type keep the model's order, outer
//     first, so nested formatting of one kind is written back as read (feature 006, FR-069);
//     formatting with a name or a language goes around a link it covers, and is extended over a
//     link it covers in part (normalise_link_formatting below; FR-068), and inside a link
//     formatting is written without attributes, as the schema requires;
//   - raw-xml nodes are emitted verbatim (block ones on their own line);
//   - binaries come from the BinaryStore in document order: base64 wrapped at 76 columns, or
//     the `…N bytes…` placeholder in elide mode; invalid base64 kept verbatim is written back.
// The result is UTF-8 text plus a line -> nodeId map used to attach validation errors to
// body nodes and, on request, the position map of feature 004 US7 (mfbe/position_map.hpp: the
// byte and UTF-16 offsets of every mapped node's tags, for `doc.mapPositions`);
// encode_document() turns the text into the declared encoding (BOM for UTF-16, numeric
// character references for characters the legacy code page lacks).
#pragma once

#include <mfbe/binary_store.hpp>
#include <mfbe/document.hpp>
#include <mfbe/position_map.hpp>

#include <cstddef>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace mfbe::fb2 {

struct WriteOptions {
    std::string encoding = "utf-8";  // canonical name written into the declaration
    std::string xlink_prefix = "l";
    bool elide_binaries = false;
    // Record the position map of the bodies, annotations and history (`WriteResult::positions`).
    bool positions = false;
};

// Sorted (line -> nodeId) pairs: the line where each structural node's start tag begins.
struct LineMap {
    std::vector<std::pair<int, std::string>> entries;
    // nodeId of the node starting at `line`, else the closest node starting before it.
    std::optional<std::string> node_at(int line) const;
};

struct WriteResult {
    std::string text;  // UTF-8
    LineMap lines;
    std::size_t binary_count = 0;
    // With `WriteOptions::positions`: the map of `text` (its `text` member left empty, its
    // `serial` 0 - the document session fills both in).
    std::optional<PositionMap> positions;
};

// `store` may be null (no binaries written).
WriteResult write_document(const model::Document& document, const BinaryStore* store,
                           const WriteOptions& options = {});

// Converts the UTF-8 text into `encoding` (see mfbe/encodings.hpp); `unmappable` receives the
// number of characters written as character references.
std::string encode_document(const std::string& utf8_text, const std::string& encoding,
                            std::size_t* unmappable = nullptr);

/* ----------------------------------------------------------------------------------------- */
/* Fragments (feature 005, doc.fragmentToXml - contracts/rpc-api.md §3.2 of the feature)     */
/* ----------------------------------------------------------------------------------------- */

struct FragmentOptions {
    std::string xlink_prefix = "l";  // the session's prefix for xlink:href
};

// Whether a node is inline content (a text node, an inline image or an inline raw-xml node)
// as opposed to a block / structural node. A fragment is one or the other, never a mix.
bool is_inline_node(const model::Node& node);

// The FictionBook XML text of `nodes` exactly as write_document writes them inside a book:
// the same element and attribute names, escaping and xlink prefix; structural elements one
// per line with one tab per level, re-based so that the first node's start tag is at column
// 0; nodes separated by "\n" (no trailing newline); no declaration, no namespace
// declarations, no nodeId; an image is its tag only; a raw-xml node its stored text. Inline
// nodes (decided by the first node) are written as the content of a text container, marks as
// inline elements, without a wrapping element. Siblings are written in the given order.
std::string write_fragment(const std::vector<model::Node>& nodes,
                           const FragmentOptions& options = {});

// Canonical order of marks when nesting inline elements (outermost first).
int mark_rank(const std::string& mark_type);

// Formatting with a name or a language and links (feature 006, FR-068; contracts/
// document-model.md §2.4, step 1), on an inline content list: for each link run - a maximal
// stretch of consecutive inline nodes, atoms included, carrying one and the same link mark -
// and each formatting kind, formatting that covers the run stays; attributed formatting (a
// `lang`, or a style with a non-empty name) that covers only part of it is extended over the
// run, and of several such marks of a kind the one on the first node that carries any (the
// outer one there) wins while the others are dropped inside the run; plain formatting stays
// beside it. Every node of a run then lists a kind's attributed marks in the run's order (the
// first node's), its plain ones after. Idempotent; only the marks of link-run nodes change.
// The writer applies it to a copy of each inline content list it writes (never to the model)
// and writes a run's attributed formatting around the link and its plain formatting inside it,
// without attributes; `mfbe-core roundtrip`'s comparison applies it to both sides.
void normalise_link_formatting(std::vector<model::Node>& content);

}  // namespace mfbe::fb2
