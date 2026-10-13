// Internal: schema validation of an already parsed libxml2 document (shared by the reader's
// schemaHint computation and the validator). See mfbe/validator.hpp for the public API.
#pragma once

#include <mfbe/document.hpp>

#include <libxml/tree.h>

#include <string>
#include <vector>

namespace mfbe::validation {

struct SchemaError {
    int line = 0;
    int column = 0;
    int code = 0;
    std::string message;
    std::string element;  // local name of the offending element ("" when unknown)
};

// XSD-validates `doc` against the bundled FictionBook schema. Returns the structured errors
// (empty = valid). When the schema cannot be loaded a single error describes why.
std::vector<SchemaError> schema_validate(xmlDocPtr doc);

// Converts schema errors to issues (code "schema.invalid" or "schema.unavailable").
std::vector<model::ValidationIssue> to_issues(const std::vector<SchemaError>& errors);

}  // namespace mfbe::validation
