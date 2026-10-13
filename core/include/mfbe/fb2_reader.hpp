// FB2 reader (T041): file / bytes / Source-view text -> document model (mfbe/document.hpp).
//
// - Encoding: BOM, XML declaration and a decoded sample decide the real encoding
//   (mfbe/encodings.hpp); a wrong declaration yields warning `encoding.mismatch` and the file
//   is still opened.
// - Parsing: hardened libxml2 DOM (xml_security.cpp). <binary> payloads are base64-decoded
//   straight into the BinaryStore from SAX character chunks and never become text nodes, so a
//   120 MB image-heavy book costs roughly file size + decoded images, not 3x the base64.
//   Invalid base64 is kept verbatim (BinaryMeta.decodable = false, warning
//   `binary.invalidBase64`). The Source-view placeholder form
//   `<binary id="x" content-type="t">…N bytes…</binary>` re-attaches bytes from
//   `ReadOptions::placeholder_source`.
// - Model mapping: description elements -> form structs (unknown description children and
//   duplicates -> `extras` raw-xml with attrs.slot naming the container; <output> ->
//   `outputs`); bodies -> node tree with session-stable nodeIds; inline elements -> marks
//   (strong, emphasis, strikethrough, sub, sup, code, style{name}, link{href,type}); unknown
//   elements, comments and stray text -> `raw-xml` nodes serialised verbatim (`inline` flag);
//   unknown attributes on known elements -> attrs.unknownAttrs {name or {uri}name: value}.
// - schemaHint: "2.1" when the input validates against the bundled XSD as-is, else "legacy".
// Not well-formed input -> ParseFailure {line, column, message} (RPC 1001 doc.parseError).
#pragma once

#include <mfbe/binary_store.hpp>
#include <mfbe/document.hpp>
#include <mfbe/node_ids.hpp>

#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::fb2 {

inline constexpr const char* kFb2Namespace = "http://www.gribuser.ru/xml/fictionbook/2.0";
inline constexpr const char* kXlinkNamespace = "http://www.w3.org/1999/xlink";
inline constexpr const char* kXmlNamespace = "http://www.w3.org/XML/1998/namespace";
inline constexpr const char* kDefaultXlinkPrefix = "l";

struct ParseError {
    int line = 0;
    int column = 0;
    std::string message;
};

struct ParseFailure : std::runtime_error {
    explicit ParseFailure(ParseError e)
        : std::runtime_error(e.message + " (line " + std::to_string(e.line) + ", column " +
                             std::to_string(e.column) + ")"),
          error(std::move(e)) {}
    ParseError error;
};

struct IoFailure : std::runtime_error {
    IoFailure(std::string path_, std::string reason_)
        : std::runtime_error(reason_), path(std::move(path_)), reason(std::move(reason_)) {}
    std::string path;
    std::string reason;
};

// The file is not a FictionBook document at all: binary content, text that does not start
// like XML, or well-formed XML with another root element. Such files are refused outright
// (FR-021 Source-only mode is for *malformed* FictionBook files, which still carry a
// `<FictionBook` tag). `reason` is "binary", "notXml" or "rootNotFictionBook".
struct NotFictionBookFailure : ParseFailure {
    NotFictionBookFailure(std::string reason_, int line = 1)
        : ParseFailure(ParseError{line, 1, "not a FictionBook document (" + reason_ + ")"}),
          reason(std::move(reason_)) {}
    std::string reason;
};

// Cheap gate run before parsing: decoded text must look like XML (first non-blank character
// is '<' after an optional BOM) and contain a `<FictionBook` start tag (with or without a
// namespace prefix); binary content (NUL bytes outside UTF-16) is rejected. Returns the
// failure reason or nullopt when the bytes may be a (possibly malformed) FictionBook file.
std::optional<std::string> not_fictionbook_reason(std::string_view bytes);

struct ReadOptions {
    // XSD-validate the parsed input to set schemaHint (false -> "unknown").
    bool compute_schema_hint = true;
    // Decode with this encoding regardless of BOM/declaration (in-memory UTF-8 text).
    std::string force_encoding;
    // Overrides the kind derived from the file extension.
    std::optional<model::FileKind> file_kind;
    // Store that holds the bytes for `…N bytes…` placeholders (Source view round trips).
    const BinaryStore* placeholder_source = nullptr;
};

struct ReadResult {
    model::Document document;
    std::vector<model::ValidationIssue> warnings;    // encoding.mismatch, binary.* ...
    std::string xlink_prefix = kDefaultXlinkPrefix;  // the input's prefix for the xlink namespace
    std::string declared_encoding;                   // "" when the file had no declaration
    bool bom = false;
    // Issues from the schemaHint validation of the input (informational; empty for "2.1").
    std::vector<model::ValidationIssue> schema_issues;
};

// Reads and parses a file. Throws IoFailure / ParseFailure.
ReadResult read_file(const std::filesystem::path& path, BinaryStore& store,
                     model::NodeIdAllocator& ids, const ReadOptions& options = {});

// Parses in-memory bytes (`display_path` only feeds fileKind/path and error messages).
ReadResult read_bytes(std::string_view bytes, BinaryStore& store, model::NodeIdAllocator& ids,
                      const ReadOptions& options = {}, const std::string& display_path = "");

struct SourceText {
    std::string text;                 // UTF-8, BOM removed
    std::string encoding;             // detected encoding of the file
    std::optional<ParseError> error;  // set when the text is not well-formed
    std::vector<model::ValidationIssue> warnings;
};

// Decodes a file for Source-only mode (FR-021): the text is returned even when malformed.
// Throws IoFailure, or NotFictionBookFailure when the file is not a FictionBook document.
SourceText read_source(const std::filesystem::path& path);

// Well-formedness check of UTF-8 text; nullopt when it parses.
std::optional<ParseError> check_well_formed(std::string_view utf8_text);

// Reads a whole file (binary). Throws IoFailure.
std::string read_file_bytes(const std::filesystem::path& path);

}  // namespace mfbe::fb2
