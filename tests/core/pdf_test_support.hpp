#pragma once
// Feature 014: reading back what the PDF export wrote, for the core tests.

#include "pdf/document.hpp"

#include <mfbe/pdf.hpp>

#include <Dict.h>
#include <Object.h>
#include <PDFDoc.h>
#include <Stream.h>
#include <XRef.h>
#include <string>
#include <vector>

namespace mfbe::test {

/// The decoded XMP packet of a PDF file ("" when it has none).
inline std::string pdf_xmp(const std::vector<char>& file) {
    std::string error;
    auto doc = pdf::Document::open_bytes(file, &error);
    if (!doc)
        return {};
    Object catalog = doc->impl().doc->getXRef()->getCatalog();
    Object metadata = catalog.dictLookup("Metadata");
    if (!metadata.isStream() || !metadata.getStream()->rewind())
        return {};
    const auto bytes = metadata.getStream()->toUnsignedChars();
    metadata.getStream()->close();
    return std::string(bytes.begin(), bytes.end());
}

inline std::string pdf_xmp(const std::string& file) {
    return pdf_xmp(std::vector<char>(file.begin(), file.end()));
}

}  // namespace mfbe::test
