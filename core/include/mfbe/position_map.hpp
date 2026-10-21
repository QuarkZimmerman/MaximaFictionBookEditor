// Position map of a serialised or parsed document (feature 004 US7, research R2; rpc-api
// `doc.toXml` / `doc.fromXml` `positions`, `doc.mapPositions`).
//
// The writer (`fb2::write_document` with `WriteOptions::positions`) and the reader
// (`fb2::read_bytes` with `ReadOptions::record_positions`) record, for every node with a
// nodeId under the bodies, the title-info and src-title-info annotations and the
// document-info history, where its start tag, its content and its end lie in the text - byte
// offsets into the UTF-8 text plus the UTF-16 offset of the start tag, so the UTF-8 <-> UTF-16
// conversion stays local to one element. The document session keeps one map with the text it
// describes and a serial; `resolve_to_source` / `resolve_to_model` answer `doc.mapPositions`
// in UTF-16 code units (CodeMirror's unit) and model offsets (ProseMirror's `parentOffset`:
// UTF-16 units of text plus 1 per inline atom, marks of no width).
#pragma once

#include <mfbe/document.hpp>

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace mfbe::fb2 {

enum class PositionKind {
    text,        // p, subtitle, text-author, v, td, th: inline content with a model offset
    date,        // date: text content, every descendant element transparent
    inlineAtom,  // inline image, inline raw-xml: one model unit inside a text container
    blockAtom,   // image, empty-line, block raw-xml: no inline content
    container,   // body, section, title, epigraph, annotation, poem, stanza, cite, table, tr
};

// The kind a model node is recorded as.
PositionKind position_kind(const model::Node& node);

struct PositionEntry {
    std::string nodeId;
    PositionKind kind = PositionKind::container;
    std::size_t tagBegin = 0;      // the `<` of the start tag (bytes into the text)
    std::size_t contentBegin = 0;  // after the `>` of the start tag; = end for `<x/>`
    std::size_t contentEnd = 0;    // the `<` of the end tag; = end for `<x/>`
    std::size_t end = 0;           // after the end tag (or after `/>`)
    std::size_t tagBegin16 = 0;    // UTF-16 offset of tagBegin
    int parent = -1;               // index of the parent entry; -1 for a root
};

struct PositionMap {
    std::vector<PositionEntry> entries;  // document order (by tagBegin)
    std::unordered_map<std::string, std::size_t> byId;
    std::size_t prefix = 0;    // bytes of a stripped BOM, already added to the offsets
    std::size_t length16 = 0;  // UTF-16 length of `text`
    std::uint64_t serial = 0;  // issued by the document session
    std::string text;          // the UTF-8 text the offsets index (set by the session)

    const PositionEntry* find(const std::string& node_id) const;
};

// Puts a freshly recorded map in order: sorts the entries by tagBegin (stable), rewrites the
// parent indices, fills `byId` and - when `compute_utf16` - computes every `tagBegin16` and
// `length16` from `text` in one pass (the writer counts while it emits and passes false).
void finalize_position_map(PositionMap& map, std::string_view text, bool compute_utf16);

struct ModelPoint {
    std::string nodeId;
    std::size_t offset = 0;

    bool operator==(const ModelPoint&) const = default;
};

// Body -> Source: the UTF-16 offset of a model point (rpc-api `toSource`); nullopt when the
// node is not in the map.
std::optional<std::size_t> resolve_to_source(const PositionMap& map, const ModelPoint& point);

// Source -> Body: the model point of a UTF-16 offset (rpc-api `toModel`); nullopt when the
// offset lies outside every mapped node (the UI goes to the document's start).
std::optional<ModelPoint> resolve_to_model(const PositionMap& map, std::size_t offset16);

// UTF-16 code units of a UTF-8 string (a lead byte >= 0xF0 counts two).
std::size_t utf16_length(std::string_view utf8);

// Model units of the inline content `[begin, end)` of `text` as the reader counts them
// (entities as their one character, mark tags nothing, an inline image or raw fragment one).
std::size_t inline_content_length(std::string_view text, std::size_t begin, std::size_t end,
                                  PositionKind kind);

}  // namespace mfbe::fb2
