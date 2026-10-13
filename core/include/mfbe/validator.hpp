// Validation (T044, FR-010/FR-012/FR-054): XSD validation against the bundled FB2 2.1 schema
// plus consistency checks that the schema cannot express.
//
// The schema set (resources/schema/*.xsd) is parsed once per process and shared; validation
// contexts are per call, so validation is safe from worker threads.
//
// Issue codes (ValidationIssue.code; `params` named in brackets):
//   xml.notWellFormed [message]              parse error of the text (error)
//   schema.invalid [message, element]        XSD violation (error)
//   schema.unavailable [reason]              schema files missing/unreadable (error)
//   genre.unknown [code]                     genre not in the effective list (error, FR-054)
//   link.dangling [href]                     href="#id" without a target (warning)
//   image.missingBinary [href]               image/cover href without a <binary> (warning)
//   image.emptyHref                          image without a target (warning)
//   image.externalHref [href]                image pointing outside the document (warning)
//   binary.unreferenced [id]                 binary nobody points at (warning)
//   binary.notImage [id, contentType]        binary that is not a decodable image (warning)
//   binary.willConvert [id, contentType]     decodable but not JPEG/PNG -> converted on save
//   binary.invalidBase64 [id]                payload kept verbatim (warning)
//   description.emptyRequired [element]      required field left empty (warning, FR-052)
// Line/column refer to the validated XML text; nodeId/path are attached when the text was
// produced by the writer (LineMap) or when the check ran on the model.
#pragma once

#include <mfbe/binary_store.hpp>
#include <mfbe/document.hpp>
#include <mfbe/fb2_writer.hpp>

#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::validation {

using GenreCheck = std::function<bool(const std::string& code)>;

// Schema folder (process-wide). Default: <exe>/../share/mfbe/resources/schema,
// <exe>/resources/schema, then the source tree (MFBE_RESOURCES_SOURCE_DIR/schema).
void set_schema_dir(const std::filesystem::path& dir);
std::filesystem::path schema_dir();
// Loads the schema on first use; false (with `error`) when it cannot be used.
bool schema_ready(std::string* error = nullptr);

// Genre codes enumerated by FictionBookGenres.xsd (sorted).
const std::vector<std::string>& schema_genres();
// Hook for the effective genre list (bundled + user); nullptr restores the schema enumeration.
void set_genre_validator(GenreCheck check);
bool is_known_genre(const std::string& code);

// Well-formedness + XSD validation of UTF-8 XML text (Source view text, or a serialisation
// produced by the writer when `lines` maps lines to nodeIds).
model::ValidationReport validate_xml_text(std::string_view utf8_xml,
                                          const fb2::LineMap* lines = nullptr);

// Full validation of a model: serialise with binaries elided (fast even for 150 MB books),
// XSD-validate, then run the consistency checks. `store` may be null.
model::ValidationReport validate_document(const model::Document& document, const BinaryStore* store,
                                          const std::string& xlink_prefix = "l");

// Consistency checks alone (links, binaries, image formats, genres, required values).
std::vector<model::ValidationIssue> consistency_issues(const model::Document& document,
                                                       const BinaryStore* store);

// Fills errorCount/warningCount from `issues` (and sorts by line when lines are known).
void finalize_report(model::ValidationReport& report);

}  // namespace mfbe::validation
