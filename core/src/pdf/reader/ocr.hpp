// Feature 020 (T018, contracts/pdf-reader.md): Leptonica + Tesseract offline OCR runtime
// for mfbe-pdf-reader. Keeps Leptonica/Tesseract headers isolated inside ocr.cpp.
#pragma once

#include <nlohmann/json.hpp>

#include <array>
#include <atomic>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

class PDFDoc;
struct Pix;

namespace mfbe::pdf_reader {

struct PixDeleter {
    void operator()(Pix* pix) const noexcept;
};
using PixPtr = std::unique_ptr<Pix, PixDeleter>;

struct OcrOptions {
    bool enabled = false;
    bool auto_detect = true;
    std::vector<std::string> languages;            // enabled Tesseract pack codes
    std::vector<std::filesystem::path> ocr_dirs;   // descending priority (settings > user > bundled)
    int threads = 1;                               // 1..8
};

struct OcrWord {
    std::string text;
    std::array<double, 4> box{};  // [x, y, w, h] in upright PDF page points (top-down y)
    double font_size = 11.0;
    bool bold = false;
    bool italic = false;
    double conf = 0.0;            // 0..100
    std::string lang;             // FB2 ISO language code (e.g. "en", "ru")
    int block_id = 0;
    int para_id = 0;
    int line_id = 0;
};

struct OcrImageRegion {
    std::array<int, 4> px_box{};  // [x, y, w, h] in upright rendered pixels
    std::array<double, 4> pt_box{};  // [x, y, w, h] in upright PDF page points
};

struct OcrPageResult {
    int page = 0;
    bool usable = false;
    int rotation_cw = 0;          // clockwise rotation applied to make page upright (0/90/180/270)
    int dpi = 200;
    double page_width_pts = 0.0;
    double page_height_pts = 0.0;
    double mean_conf = 0.0;
    double plain_ratio = 0.0;
    bool low_confidence = false;
    std::string primary_pack;     // Tesseract pack code (e.g. "rus")
    std::string primary_lang;     // FB2 ISO code (e.g. "ru")
    std::vector<std::string> languages;  // distinct FB2 ISO codes across blocks
    std::string osd_script;       // normalized OSD script if detected
    float osd_script_conf = 0.0f;
    std::vector<OcrWord> words;
    std::vector<OcrImageRegion> image_regions;  // non-text PT_*_IMAGE regions
};

struct OcrTextBlockResult {
    bool usable = false;
    std::string pack_code;
    std::string fb2_lang;
    double mean_conf = 0.0;
    double plain_ratio = 0.0;
    std::vector<OcrWord> words;
};

struct OcrDiagnosis {
    std::string primary_pack;
    std::string primary_lang;
    std::string dominant_osd_script;
    float dominant_osd_script_conf = 0.0f;
};

// Manages lazy staging of resolved .traineddata files into <out>/tessdata/ and tracks all
// installed packs (including disabled ones) for refusal diagnostics.
class OcrRuntime {
public:
    OcrRuntime(const OcrOptions& options, std::filesystem::path out_folder);
    ~OcrRuntime();
    OcrRuntime(const OcrRuntime&) = delete;
    OcrRuntime& operator=(const OcrRuntime&) = delete;

    // Resolves enabled packs and osd across ocr_dirs, and hardlinks/copies them into
    // <out>/tessdata/. Safe to call only once OCR is actually needed (zero-OCR fast path).
    bool initialize();

    bool initialized() const { return initialized_; }
    bool osd_available() const { return osd_available_; }
    const std::vector<std::string>& active_packs() const { return active_packs_; }
    const std::filesystem::path& tessdata_dir() const { return tessdata_dir_; }
    const OcrOptions& options() const { return options_; }

    // All valid installed pack codes discovered across ocr_dirs for a given normalized script,
    // excluding currently active packs (used for ocrLanguageDisabled suggestions).
    std::vector<std::string> disabled_packs_for_script(const std::string& script) const;

    // True if ANY valid pack (active or disabled) exists in ocr_dirs for `script`.
    bool any_installed_for_script(const std::string& script) const;

    // Computes an optimal clamped render DPI (180..300) for a PDF page from its page model.
    static int compute_render_dpi(PDFDoc& doc, int page_num, const nlohmann::json& page_json);

    // Renders PDF page `page_num` directly into an 8-bit grayscale Leptonica Pix via Poppler Splash.
    static PixPtr render_page_gray(PDFDoc& doc, int page_num, int dpi);

    // Renders PDF page `page_num` directly into a 32-bit RGB Leptonica Pix (for inline art crops
    // and fallback page pictures).
    static PixPtr render_page_rgb(PDFDoc& doc, int page_num, int dpi);

    // Renders a rectangular region (in top-down PDF page points) of a page into an 8-bit gray Pix.
    static PixPtr render_region_gray(PDFDoc& doc, int page_num,
                                     const std::array<double, 4>& box_pts, int dpi);

    // Saves a cropped rectangle of a 32-bit RGB Pix (rotated by `rotation_cw`) to JPEG or PNG.
    static bool save_pix_crop(Pix* rgb_pix, int rotation_cw, const std::array<int, 4>& px_box,
                              int jpeg_quality, const std::filesystem::path& out_file,
                              std::string& content_type, int& out_w, int& out_h);

    // Saves a full 32-bit RGB Pix (rotated by `rotation_cw`) as a fallback page picture.
    static bool save_pix_full(Pix* rgb_pix, int rotation_cw, int jpeg_quality,
                              const std::filesystem::path& out_file, std::string& content_type,
                              int& out_w, int& out_h);

    // Pass 2: probes up to 3 sample pages to determine the document's primary language pack
    // (when auto_detect is true). Emits progress via `on_sample(done, total)`.
    OcrDiagnosis detect_document_language(
        PDFDoc& doc, const std::vector<int>& sample_pages,
        const std::map<int, nlohmann::json>& page_models,
        const std::function<void(int, int)>& on_sample);

    // Pass 3: runs sequential Poppler rendering into a bounded PIX* queue feeding 1..N
    // std::thread Tesseract workers. Invokes `on_page(OcrPageResult)` on a mutex-protected path.
    void recognize_pages_parallel(
        PDFDoc& doc, const std::vector<int>& target_pages,
        const std::map<int, nlohmann::json>& page_models,
        const std::string& doc_primary_pack,
        const std::function<void(OcrPageResult&&)>& on_page,
        std::atomic<bool>& cancelled);

    // Recognizes a single cropped embedded raster image region on a searchable page.
    OcrTextBlockResult recognize_embedded_region(Pix* gray_region, int dpi,
                                                 const std::array<double, 4>& box_pts,
                                                 const std::string& preferred_pack);

private:
    OcrPageResult recognize_single_pix(int page_num, Pix* raw_gray, int dpi,
                                       const std::string& doc_primary_pack,
                                       void* osd_api_ptr,
                                       std::map<std::string, void*>& api_cache) const;

    OcrOptions options_;
    std::filesystem::path out_folder_;
    std::filesystem::path tessdata_dir_;
    bool initialized_ = false;
    bool osd_available_ = false;
    std::vector<std::string> active_packs_;
    std::map<std::string, std::filesystem::path> resolved_active_;
    std::map<std::string, std::vector<std::string>> all_installed_by_script_;
};

}  // namespace mfbe::pdf_reader
