#pragma once
// Feature 014 (tasks T010): the Poppler side of mfbe::pdf::Document, shared by the modules of
// core/src/pdf/ only. Nothing outside this folder includes it (plan PD2).

#include "mfbe/pdf.hpp"

#include <PDFDoc.h>
#include <memory>

namespace mfbe::pdf {

struct Document::Impl {
    std::unique_ptr<PDFDoc> doc;
};

/// Initialises Poppler's global parameters once per process and keeps its error messages out
/// of the editor's output (the export reports its own faults).
void init_poppler();

}  // namespace mfbe::pdf
