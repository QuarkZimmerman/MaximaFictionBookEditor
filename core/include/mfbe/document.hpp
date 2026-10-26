// C++ mirror of contracts/document-model.d.ts (document model version 1) - T016.
//
// The body tree is a generic ProseMirror-compatible `Node {type, attrs, content, text, marks}`;
// structural nodes carry `attrs["nodeId"]`. The description is form-shaped. Binary payloads
// never appear here (BinaryMeta only). JSON (de)serialisation lives in mfbe/json_codec.hpp.
#pragma once

#include <nlohmann/json.hpp>

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::model {

inline constexpr int kModelVersion = 1;

/* ----------------------------------------------------------------------------------------- */
/* Body tree                                                                                  */
/* ----------------------------------------------------------------------------------------- */

struct Mark {
    std::string type;  // strong | emphasis | strikethrough | sub | sup | code | style | link
    // An object only with a member, null otherwise: {lang?} on strong ... code,
    // style{name, lang?}, link{href, type?, xlinkType?} (feature 006, FR-064: lang is the
    // element's xml:lang and xlinkType a link's xlink:type, both verbatim).
    nlohmann::json attrs;

    bool operator==(const Mark&) const = default;
};

struct Node {
    std::string type;                             // "body", "section", "p", "text", ...
    std::map<std::string, nlohmann::json> attrs;  // includes "nodeId" for structural nodes
    std::vector<Node> content;                    // child nodes (empty for leaves/text)
    std::string text;                             // only for type == "text"
    // Text, inline-image and inline raw-xml (feature 006, FR-067).
    std::vector<Mark> marks;

    bool is_text() const { return type == "text"; }
    // attrs["nodeId"] as a string ("" when absent).
    std::string node_id() const;
    void set_node_id(const std::string& id) { attrs["nodeId"] = id; }
    // String attribute helper ("" / nullopt when absent or not a string).
    std::optional<std::string> attr_string(const std::string& name) const;

    bool operator==(const Node&) const = default;
};

// Node types that never carry `content` in the JSON form.
bool is_leaf_type(const std::string& type);
// Node types that carry a nodeId (everything but "text").
bool is_structural_type(const std::string& type);

/* ----------------------------------------------------------------------------------------- */
/* Description (form-shaped)                                                                   */
/* ----------------------------------------------------------------------------------------- */

struct Person {
    std::optional<std::string> firstName;
    std::optional<std::string> middleName;
    std::optional<std::string> lastName;
    std::optional<std::string> nickname;
    std::vector<std::string> homePages;
    std::vector<std::string> emails;
    std::optional<std::string> id;

    bool operator==(const Person&) const = default;
};

struct Sequence {
    std::string name;
    std::optional<int> number;
    std::optional<std::string> lang;
    std::vector<Sequence> children;

    bool operator==(const Sequence&) const = default;
};

struct DateValue {
    std::string text;
    std::optional<std::string> value;  // ISO YYYY-MM-DD
    std::optional<std::string> lang;

    bool operator==(const DateValue&) const = default;
};

struct GenreRef {
    std::string code;
    std::optional<int> match;  // 1..100; omitted == 100

    bool operator==(const GenreRef&) const = default;
};

struct ImageRef {
    std::string href;  // "#binaryId" or external URL
    std::optional<std::string> alt;
    std::optional<std::string> title;
    std::optional<std::string> id;

    bool operator==(const ImageRef&) const = default;
};

struct TitleInfo {
    std::vector<GenreRef> genres;
    std::vector<Person> authors;
    std::string bookTitle;
    std::optional<Node> annotation;  // type "annotation"
    std::optional<std::string> keywords;
    std::optional<DateValue> date;
    std::vector<ImageRef> coverpage;
    std::string lang;
    std::optional<std::string> srcLang;
    std::vector<Person> translators;
    std::vector<Sequence> sequences;

    bool operator==(const TitleInfo&) const = default;
};

struct DocumentInfo {
    std::vector<Person> authors;
    std::optional<std::string> programUsed;
    DateValue date;
    std::vector<std::string> srcUrls;
    std::optional<std::string> srcOcr;
    std::string id;
    std::string version;
    std::optional<Node> history;  // type "annotation"
    std::vector<Person> publishers;

    bool operator==(const DocumentInfo&) const = default;
};

struct PublishInfo {
    std::optional<std::string> bookName;
    std::optional<std::string> publisher;
    std::optional<std::string> city;
    std::optional<std::string> year;
    std::optional<std::string> isbn;
    std::vector<Sequence> sequences;

    bool operator==(const PublishInfo&) const = default;
};

struct CustomInfo {
    std::string infoType;
    std::string text;
    std::optional<std::string> lang;

    bool operator==(const CustomInfo&) const = default;
};

struct Description {
    TitleInfo titleInfo;
    std::optional<TitleInfo> srcTitleInfo;
    DocumentInfo documentInfo;
    std::optional<PublishInfo> publishInfo;
    std::vector<CustomInfo> customInfo;
    std::vector<Node> outputs;  // raw-xml nodes

    bool operator==(const Description&) const = default;
};

/* ----------------------------------------------------------------------------------------- */
/* Binaries, validation                                                                       */
/* ----------------------------------------------------------------------------------------- */

struct BinaryMeta {
    std::string id;
    std::string contentType;
    std::int64_t size = 0;
    std::optional<int> width;
    std::optional<int> height;
    bool decodable = false;
    bool willConvert = false;
    int referenceCount = 0;

    bool operator==(const BinaryMeta&) const = default;
};

enum class Severity { error, warning };

struct ValidationIssue {
    Severity severity = Severity::error;
    std::string code;
    std::map<std::string, nlohmann::json> params;  // string | number values
    std::optional<int> line;
    std::optional<int> column;
    std::optional<std::string> nodeId;
    std::optional<std::string> path;  // e.g. "body[1]/section[3]/p[12]"

    bool operator==(const ValidationIssue&) const = default;
};

struct ValidationReport {
    std::vector<ValidationIssue> issues;
    int errorCount = 0;
    int warningCount = 0;
    std::int64_t durationMs = 0;

    bool operator==(const ValidationReport&) const = default;
};

/* ----------------------------------------------------------------------------------------- */
/* Document                                                                                   */
/* ----------------------------------------------------------------------------------------- */

struct Stylesheet {
    std::string type;  // e.g. "text/css"
    std::string content;

    bool operator==(const Stylesheet&) const = default;
};

enum class FileKind { fb2, fbd, xml };
enum class SchemaHint { v21, legacy, unknown };

struct Document {
    int modelVersion = kModelVersion;
    std::string docId;
    std::optional<std::string> path;
    FileKind fileKind = FileKind::fb2;
    std::string sourceEncoding = "utf-8";
    SchemaHint schemaHint = SchemaHint::unknown;
    std::vector<Stylesheet> stylesheets;
    Description description;
    std::vector<Node> bodies;  // type "body"
    std::vector<BinaryMeta> binaries;
    std::vector<Node> extras;  // raw-xml nodes (unknown top-level elements)

    bool operator==(const Document&) const = default;
};

const char* to_string(FileKind kind);
const char* to_string(SchemaHint hint);
const char* to_string(Severity severity);
std::optional<FileKind> file_kind_from_string(std::string_view text);
std::optional<SchemaHint> schema_hint_from_string(std::string_view text);
std::optional<Severity> severity_from_string(std::string_view text);
// ".fb2" -> fb2, ".fbd" -> fbd, anything else -> xml (case-insensitive).
FileKind file_kind_from_extension(std::string_view extension);

}  // namespace mfbe::model

namespace mfbe {
// Library version string (from the generated version header).
const char* core_version();
}  // namespace mfbe
