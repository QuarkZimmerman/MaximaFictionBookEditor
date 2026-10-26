// JSON (de)serialisation of the document model (T016), `modelVersion: 1`.
//
// Emission rules (so that fixtures and the UI round-trip exactly):
//   - optional scalars are omitted when absent; arrays are always present (possibly empty);
//   - a text node is {type:"text", text, marks?} (marks only when non-empty);
//   - any other node is {type, attrs, content?} - `content` is omitted for leaf types
//     (empty-line, image, inline-image, raw-xml) and present (possibly []) otherwise; an
//     inline-image or raw-xml node also carries `marks` when it has any (feature 006, FR-067);
//   - a mark is {type} or {type, attrs} when it has attributes.
#pragma once

#include <mfbe/document.hpp>

#include <nlohmann/json.hpp>

#include <stdexcept>
#include <string>

namespace mfbe::model {

struct CodecError : std::runtime_error {
    CodecError(std::string path_, std::string what_)
        : std::runtime_error(path_.empty() ? what_ : path_ + ": " + what_),
          path(std::move(path_)),
          detail(std::move(what_)) {}
    std::string path;    // JSON pointer-like location, e.g. "/description/titleInfo/genres/0"
    std::string detail;  // what was wrong
};

nlohmann::json to_json(const Mark& mark);
nlohmann::json to_json(const Node& node);
nlohmann::json to_json(const Person& person);
nlohmann::json to_json(const Sequence& sequence);
nlohmann::json to_json(const DateValue& date);
nlohmann::json to_json(const GenreRef& genre);
nlohmann::json to_json(const ImageRef& image);
nlohmann::json to_json(const TitleInfo& info);
nlohmann::json to_json(const DocumentInfo& info);
nlohmann::json to_json(const PublishInfo& info);
nlohmann::json to_json(const CustomInfo& info);
nlohmann::json to_json(const Description& description);
nlohmann::json to_json(const BinaryMeta& meta);
nlohmann::json to_json(const ValidationIssue& issue);
nlohmann::json to_json(const ValidationReport& report);
nlohmann::json to_json(const Stylesheet& stylesheet);
nlohmann::json to_json(const Document& document);

// All parsers throw CodecError on malformed input (wrong type, missing required field,
// unsupported modelVersion). Unknown keys are ignored.
Mark mark_from_json(const nlohmann::json& j);
Node node_from_json(const nlohmann::json& j);
Person person_from_json(const nlohmann::json& j);
Sequence sequence_from_json(const nlohmann::json& j);
DateValue date_from_json(const nlohmann::json& j);
GenreRef genre_from_json(const nlohmann::json& j);
ImageRef image_ref_from_json(const nlohmann::json& j);
TitleInfo title_info_from_json(const nlohmann::json& j);
DocumentInfo document_info_from_json(const nlohmann::json& j);
PublishInfo publish_info_from_json(const nlohmann::json& j);
CustomInfo custom_info_from_json(const nlohmann::json& j);
Description description_from_json(const nlohmann::json& j);
BinaryMeta binary_meta_from_json(const nlohmann::json& j);
ValidationIssue validation_issue_from_json(const nlohmann::json& j);
ValidationReport validation_report_from_json(const nlohmann::json& j);
Stylesheet stylesheet_from_json(const nlohmann::json& j);
Document document_from_json(const nlohmann::json& j);

// Convenience: text <-> Document.
std::string document_to_string(const Document& document, int indent = -1);
Document document_from_string(const std::string& text);

}  // namespace mfbe::model
