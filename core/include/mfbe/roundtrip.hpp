// Round-trip support (T046, FR-005, Constitution IV): structural comparison of two documents
// and the open -> save -> re-open -> compare -> validate procedure used by `mfbe-core roundtrip`
// and the corpus gate.
//
// "Structurally identical" means: same text, same body structure and order, same attributes
// (nodeIds excluded, marks compared as sets), same stylesheets, same preserved unknown XML,
// byte-identical binaries, and an equal description after the writer's normalisation (2.1
// order; empty optional elements omitted; empty persons/annotations dropped).
#pragma once

#include <mfbe/binary_store.hpp>
#include <mfbe/document.hpp>
#include <mfbe/images.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::roundtrip {

struct Difference {
    std::string where;  // e.g. "body[1]/section[2]/p[3]", "description/titleInfo/bookTitle"
    std::string what;   // human-readable
};

struct Comparison {
    std::vector<Difference> differences;
    std::size_t nodes_compared = 0;
    std::size_t binaries_compared = 0;
    bool truncated = false;  // more differences than reported
    bool identical() const { return differences.empty(); }
};

Comparison compare(const model::Document& a, const BinaryStore& store_a, const model::Document& b,
                   const BinaryStore& store_b, std::size_t max_differences = 50);

struct Report {
    std::string path;
    std::optional<std::string> written_path;
    bool opened = false;
    bool reopened = false;
    bool identical = false;
    bool valid = false;
    std::optional<std::string> failure;  // parse/io error text when a step failed
    std::optional<int> failure_line, failure_column;
    std::string input_encoding;
    std::string output_encoding;
    std::string input_schema_hint;
    std::vector<std::string> warnings;  // reader warning codes (first pass)
    Comparison comparison;
    model::ValidationReport validation;  // of the written file (model-based)
    std::size_t binary_count = 0;
    std::vector<std::string> converted_ids;     // image binaries converted to JPEG/PNG on save
    std::vector<std::string> non_jpeg_png_ids;  // image binaries that are not JPEG/PNG after save
    std::vector<std::string> undecodable_ids;
    std::int64_t input_bytes = 0;
    std::int64_t output_bytes = 0;
    std::int64_t open_ms = 0, convert_ms = 0, write_ms = 0, reopen_ms = 0, validate_ms = 0,
                 total_ms = 0;

    // 0 identical and valid; 1 identical but invalid; 3 differences; 4 could not open.
    int exit_code() const;
    nlohmann::json to_json(std::size_t max_issues = 25) const;
    // Multi-line human-readable summary.
    std::string summary(std::size_t max_issues = 10) const;
};

// Opens `input`, converts non-JPEG/PNG image binaries exactly as a save does (FR-110, same
// ids), writes the otherwise unchanged document to `out_dir/<name>` in `encoding`, re-opens
// the copy and compares. Never throws for document problems (they land in the report).
Report run(const std::filesystem::path& input, const std::filesystem::path& out_dir,
           const std::string& encoding = "utf-8", const images::ConversionPolicy& policy = {});

}  // namespace mfbe::roundtrip
