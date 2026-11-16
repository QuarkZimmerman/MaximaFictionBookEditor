#pragma once
// Feature 016 (contracts/pdf-reader.md, contracts/page-model.md): the parts of mfbe-pdf-reader.
// main.cpp opens the PDF and drives them; each part writes its files into the import's folder.

#include <nlohmann/json.hpp>

#include <filesystem>
#include <memory>
#include <string>
#include <string_view>

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

/// document.json: metadata, the editor's record, outline, forms, encryption (task T016). `ours` is
/// set when the PDF holds the editor's record (014 R10).
bool write_document(PDFDoc& doc, const Options& options, std::string& error, bool* ours = nullptr);

/// How readable a text layer is (DP-9): its tokens, and how many of them are plain words in one
/// script.
struct Readability {
    int tokens = 0;
    int plain = 0;
};

/// A token of a text layer is a plain word: letters of one script, between opening and closing
/// marks.
bool is_plain_word(std::string_view token);

/// The readability of a page's words (page-model words: {"t": ...}).
Readability readability(const nlohmann::json& words);

/// A layer that reads mostly as garbage (DP-9): under 0.6 of its tokens words - a page's with at
/// least 8 tokens (it is counted), the document's with at least 20 (it is refused).
constexpr int kGarbledPageTokens = 8;
constexpr int kGarbledDocumentTokens = 20;
constexpr double kGarbledShare = 0.6;

/// page-<n>.json for page `n` (from 1): words, fonts, links, pictures (tasks T015, T018). Returns
/// the page's kind (DP-8; `garbled` for a layer that reads as garbage) and gives its readability.
std::string write_page(PDFDoc& doc, int n, const Options& options, Readability* readable = nullptr);

/// The pictures page `n` places (ids, boxes, sizes), without writing them (task T018).
nlohmann::json record_pictures(PDFDoc& doc, int n);

/// Writes picture `id` of page `n` into pictures/ and returns its event (contracts/pdf-reader.md).
nlohmann::json write_picture(PDFDoc& doc, int n, const std::string& id, const Options& options);

/// Page `n` drawn at `dpi` (18 to 600) as an RGB PNG in `file` (D20, the render switch); its size
/// in pixels.
bool render_page(PDFDoc& doc, int n, int dpi, const std::filesystem::path& file, int& width,
                 int& height);

/// A PDF text string (document information, a form's value, a structure element's text) as UTF-8.
std::string text_string(std::string_view s);

/// The JSON text of the reader's files and events. Text a PDF holds in an encoding other than UTF-8
/// comes out with U+FFFD for its bad bytes instead of ending the reader (D32's library run: two
/// PDFs ended it so).
inline std::string dumped(const nlohmann::json& value) {
    return value.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
}

/// The page's drawings (DP-7): areas of lines and shapes, [{id, box}]; sets the page's `forms` when
/// its fields stand in labelled rows, else draws them as one more drawing. Needs the page's words
/// and pictures.
nlohmann::json record_drawings(PDFDoc& doc, int n, nlohmann::json& page);

/// Drawings past the 2,000 a book takes (DP-3), left out and counted.
int drawings_left_out();

/// Draws drawing `id` at 200 dpi into pictures/ and returns its event, as write_picture does.
nlohmann::json write_drawing(PDFDoc& doc, const std::string& id, const Options& options);

/// The page's kind from its words and pictures, its look measured when it is only a picture (DP-8).
std::string page_kind(PDFDoc& doc, int n, const nlohmann::json& page);

}  // namespace mfbe::pdf_reader
