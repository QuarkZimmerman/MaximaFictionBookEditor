// Feature 020 (T036): Embedded text-bearing raster image detection/OCR on searchable pages and
// scanned-page inline illustration cropping (`ocrCrop: true`).
#pragma once

#include "pdf/reader/ocr.hpp"

#include <nlohmann/json.hpp>

#include <array>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

class PDFDoc;

namespace mfbe::pdf_reader {

struct EmbeddedImageCandidate {
    int page = 0;
    std::string picture_id;
    std::array<double, 4> box_pts{};
};

// Inspects a searchable `kind == "text"` page model and returns embedded raster images that pass
// conservative geometric exclusion (non-cover, non-background, non-tiny-ornament, not overlapped by
// valid searchable text) AND a fast zero-Tesseract stroke-transition pre-check.
std::vector<EmbeddedImageCandidate> find_embedded_ocr_candidates(PDFDoc& doc, int page_num,
                                                                 const nlohmann::json& page_json);

// Converts an `OcrTextBlockResult` from `OcrRuntime::recognize_embedded_region` into a
// `PdfOcrImageBlock` JSON object (`data-model.md` §3.3).
nlohmann::json build_ocr_image_block_json(const EmbeddedImageCandidate& candidate,
                                          const OcrTextBlockResult& block);

// Fast pre-check that avoids retaining OCR results or rendering full-page RGB bitmaps for
// text-only scanned pages that have no candidate inline illustration regions.
bool may_have_inline_illustration(const OcrPageResult& res);

// Crops distinct non-text inline illustrations from a usable scanned page (`res.image_regions`,
// plus a conservative color/non-text gap check if Tesseract merged artwork cleanly between text
// blocks), writes JPEG files to `<out_dir>/pictures/ocr-p<n>-<i>.jpg`, registers their metadata in
// `prewritten_pictures`, and returns the `pictures[]` JSON array (`ocrCrop: true`).
nlohmann::json crop_scanned_inline_illustrations(
    PDFDoc& doc, const OcrPageResult& res, int jpeg_quality, const std::filesystem::path& out_dir,
    std::map<std::string, nlohmann::json>& prewritten_pictures);

}  // namespace mfbe::pdf_reader
