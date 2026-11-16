#pragma once
// Feature 016 (contracts/pdf-reader.md, contracts/page-model.md): the parts of mfbe-pdf-reader.
// main.cpp opens the PDF and drives them; each part writes its files into the import's folder.

#include <nlohmann/json.hpp>

#include <filesystem>
#include <memory>
#include <string>

class PDFDoc;

namespace mfbe::pdf_reader {

struct Options {
    std::filesystem::path pdf;
    std::filesystem::path out;
    std::filesystem::path fonts;
    int quality = 85;
};

/// One JSON event line on standard output (contracts/pdf-reader.md), flushed at once.
void emit(const std::string& json);

/// document.json: metadata, the editor's record, outline, forms, encryption (task T016).
bool write_document(PDFDoc& doc, const Options& options, std::string& error);

/// page-<n>.json for page `n` (from 1): words, fonts, links (task T015); pictures and drawings come
/// with tasks T018 and T037. Returns the page's kind.
std::string write_page(PDFDoc& doc, int n, const Options& options);

/// The pictures page `n` places (ids, boxes, sizes), without writing them (task T018).
nlohmann::json record_pictures(PDFDoc& doc, int n);

/// Writes picture `id` of page `n` into pictures/ and returns its event (contracts/pdf-reader.md).
nlohmann::json write_picture(PDFDoc& doc, int n, const std::string& id, const Options& options);

}  // namespace mfbe::pdf_reader
