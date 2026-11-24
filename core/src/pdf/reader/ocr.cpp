// Feature 020 (T018, T035): Leptonica + Tesseract offline OCR runtime implementation.
#include "pdf/reader/ocr.hpp"

#include "pdf/reader/ocr_lang.hpp"
#include "pdf/reader/reader.hpp"

#include <mfbe/images.hpp>
#include <mfbe/ocr.hpp>
#include <mfbe/utf8_paths.hpp>

#include <PDFDoc.h>
#include <Page.h>
#include <SplashOutputDev.h>
#include <allheaders.h>
#include <splash/SplashBitmap.h>
#include <tesseract/baseapi.h>
#include <tesseract/publictypes.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <condition_variable>
#include <deque>
#include <fstream>
#include <memory>
#include <mutex>
#include <set>
#include <thread>
#ifndef _WIN32
#include <unistd.h>
#endif

namespace mfbe::pdf_reader {

void PixDeleter::operator()(Pix* pix) const noexcept {
    if (pix != nullptr) {
        pixDestroy(&pix);
    }
}

namespace {

namespace fs = std::filesystem;

constexpr int kMinDpi = 180;
constexpr int kDefaultDpi = 220;
constexpr int kMaxDpi = 300;
constexpr int kMaxDimensionPx = 4200;
constexpr long long kMaxPixels = 16'000'000;

std::string lower_ascii(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

std::string trim_whitespace(std::string_view s) {
    std::size_t a = 0;
    std::size_t b = s.size();
    while (a < b && std::isspace(static_cast<unsigned char>(s[a])) != 0) {
        ++a;
    }
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1])) != 0) {
        --b;
    }
    return std::string(s.substr(a, b - a));
}

bool stage_file(const fs::path& src, const fs::path& dst) {
    std::error_code ec;
    if (fs::exists(dst, ec)) {
        return true;
    }
    fs::create_hard_link(src, dst, ec);
    if (!ec) {
        return true;
    }
    ec.clear();
    fs::copy_file(src, dst, fs::copy_options::overwrite_existing, ec);
    return !ec;
}

std::string join_langs(const std::vector<std::string>& langs) {
    std::string out;
    for (std::size_t i = 0; i < langs.size(); ++i) {
        if (i > 0) {
            out += '+';
        }
        out += langs[i];
    }
    return out;
}

std::unique_ptr<tesseract::TessBaseAPI> make_tess_api(const fs::path& tessdata_dir,
                                                      const std::string& lang_spec,
                                                      tesseract::OcrEngineMode oem,
                                                      tesseract::PageSegMode psm) {
    auto api = std::make_unique<tesseract::TessBaseAPI>();
    // Silence Tesseract diagnostic output to stderr.
#ifdef _WIN32
    api->SetVariable("debug_file", "NUL");
#else
    api->SetVariable("debug_file", "/dev/null");
#endif
    const std::string dir = platform::utf8_from_path(tessdata_dir);
    if (api->Init(dir.c_str(), lang_spec.c_str(), oem) != 0) {
        return nullptr;
    }
    api->SetPageSegMode(psm);
    return api;
}

struct OsdInfo {
    int rotate_cw = 0;
    std::string script;
    float orient_conf = 0.0f;
    float script_conf = 0.0f;
    bool ok = false;
};

OsdInfo run_osd(tesseract::TessBaseAPI* osd_api, Pix* gray) {
    OsdInfo out;
    if (osd_api == nullptr || gray == nullptr) {
        return out;
    }
    osd_api->SetImage(gray);
    int orient_deg = 0;
    float orient_conf = 0.0f;
    const char* script_name = nullptr;
    float script_conf = 0.0f;
    if (!osd_api->DetectOrientationScript(&orient_deg, &orient_conf, &script_name, &script_conf)) {
        osd_api->Clear();
        return out;
    }
    // Tesseract's orient_deg is orient_id * 90; clockwise rotation needed to make the image
    // upright is (360 - orient_deg) % 360 (verified against TessBaseAPI::GetOsdText).
    const int norm_deg = ((orient_deg % 360) + 360) % 360;
    const int rot_cw = (360 - norm_deg) % 360;
    out.ok = true;
    out.orient_conf = orient_conf;
    out.script_conf = script_conf;
    if (orient_conf >= 2.0f) {
        out.rotate_cw = rot_cw;
    }
    if (script_name != nullptr && *script_name != '\0') {
        out.script = ocr::normalize_osd_script(script_name);
    }
    osd_api->Clear();
    return out;
}

PixPtr maybe_rotate_and_deskew(Pix* raw_gray, int rotate_cw) {
    if (raw_gray == nullptr) {
        return nullptr;
    }
    PixPtr current;
    const int quads = ((rotate_cw / 90) % 4 + 4) % 4;
    if (quads != 0) {
        current.reset(pixRotateOrth(raw_gray, quads));
    } else {
        current.reset(pixClone(raw_gray));
    }
    if (!current) {
        return nullptr;
    }
    // Mild deskew only when a real tilt (0.6°..10°) is measured with good confidence; crisp
    // upright scans stay untouched so anti-aliased glyph edges are not softened.
    PixPtr bin(pixConvertTo1(current.get(), 140));
    if (bin) {
        l_float32 angle = 0.0f;
        l_float32 conf = 0.0f;
        if (pixFindSkew(bin.get(), &angle, &conf) == 0 && conf >= 2.5f &&
            std::fabs(angle) >= 0.6f && std::fabs(angle) <= 10.0f) {
            constexpr float kDegToRad = 3.14159265358979323846f / 180.0f;
            PixPtr deskewed(
                pixRotate(current.get(), angle * kDegToRad, L_ROTATE_AREA_MAP, L_BRING_IN_WHITE,
                          0, 0));
            if (deskewed) {
                pixSetXRes(deskewed.get(), pixGetXRes(current.get()));
                pixSetYRes(deskewed.get(), pixGetYRes(current.get()));
                current = std::move(deskewed);
            }
        }
    }
    return current;
}

struct PassOutput {
    std::vector<OcrWord> words;
    std::vector<OcrImageRegion> image_regions;
    std::string full_text;
    double mean_conf = 0.0;
    double plain_ratio = 0.0;
    int plain_count = 0;
};

PassOutput run_tesseract_pass(tesseract::TessBaseAPI& api, Pix* gray, int dpi,
                              const std::string& default_fb2_lang, bool collect_images) {
    PassOutput out;
    if (gray == nullptr || dpi <= 0) {
        return out;
    }
    api.SetImage(gray);
    api.SetSourceResolution(dpi);
    if (api.Recognize(nullptr) != 0) {
        api.Clear();
        return out;
    }

    const double px_to_pt = 72.0 / static_cast<double>(dpi);
    const int img_w = pixGetWidth(gray);
    const int img_h = pixGetHeight(gray);
    std::unique_ptr<tesseract::ResultIterator> ri(api.GetIterator());
    if (!ri) {
        api.Clear();
        return out;
    }

    int block_id = 0;
    int para_id = 0;
    int line_id = 0;
    double conf_sum = 0.0;
    int token_count = 0;
    std::set<std::array<int, 4>> seen_image_boxes;

    do {
        if (ri->IsAtBeginningOf(tesseract::RIL_BLOCK)) {
            ++block_id;
            const tesseract::PolyBlockType bt = ri->BlockType();
            if (collect_images &&
                (bt == tesseract::PT_FLOWING_IMAGE || bt == tesseract::PT_HEADING_IMAGE ||
                 bt == tesseract::PT_PULLOUT_IMAGE)) {
                int bx1 = 0, by1 = 0, bx2 = 0, by2 = 0;
                if (ri->BoundingBox(tesseract::RIL_BLOCK, &bx1, &by1, &bx2, &by2)) {
                    bx1 = std::clamp(bx1, 0, img_w);
                    by1 = std::clamp(by1, 0, img_h);
                    bx2 = std::clamp(bx2, 0, img_w);
                    by2 = std::clamp(by2, 0, img_h);
                    const int bw = bx2 - bx1;
                    const int bh = by2 - by1;
                    if (bw >= 40 && bh >= 40) {
                        const std::array<int, 4> key{bx1, by1, bw, bh};
                        if (seen_image_boxes.insert(key).second) {
                            OcrImageRegion reg;
                            reg.px_box = key;
                            reg.pt_box = {bx1 * px_to_pt, by1 * px_to_pt, bw * px_to_pt,
                                          bh * px_to_pt};
                            out.image_regions.push_back(reg);
                        }
                    }
                }
            }
        }
        if (ri->IsAtBeginningOf(tesseract::RIL_PARA)) {
            ++para_id;
        }
        if (ri->IsAtBeginningOf(tesseract::RIL_TEXTLINE)) {
            ++line_id;
        }

        const tesseract::PolyBlockType bt = ri->BlockType();
        if (bt == tesseract::PT_FLOWING_IMAGE || bt == tesseract::PT_HEADING_IMAGE ||
            bt == tesseract::PT_PULLOUT_IMAGE || bt == tesseract::PT_HORZ_LINE ||
            bt == tesseract::PT_VERT_LINE || bt == tesseract::PT_NOISE) {
            continue;
        }

        char* raw_word = ri->GetUTF8Text(tesseract::RIL_WORD);
        if (raw_word == nullptr) {
            continue;
        }
        std::string text = trim_whitespace(raw_word);
        delete[] raw_word;
        if (text.empty()) {
            continue;
        }

        int x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        if (!ri->BoundingBox(tesseract::RIL_WORD, &x1, &y1, &x2, &y2)) {
            continue;
        }
        const double conf =
            static_cast<double>(std::clamp(ri->Confidence(tesseract::RIL_WORD), 0.0f, 100.0f));
        bool is_bold = false;
        bool is_italic = false;
        bool is_underlined = false;
        bool is_monospace = false;
        bool is_serif = false;
        bool is_smallcaps = false;
        int pointsize = 0;
        int font_id = 0;
        ri->WordFontAttributes(&is_bold, &is_italic, &is_underlined, &is_monospace, &is_serif,
                               &is_smallcaps, &pointsize, &font_id);

        const double w_pt = std::max(1.0, (x2 - x1) * px_to_pt);
        const double h_pt = std::max(1.0, (y2 - y1) * px_to_pt);
        const double fsize =
            (pointsize >= 6 && pointsize <= 72) ? static_cast<double>(pointsize)
                                                : std::clamp(h_pt * 0.85, 7.0, 48.0);

        OcrWord word;
        word.text = std::move(text);
        word.box = {x1 * px_to_pt, y1 * px_to_pt, w_pt, h_pt};
        word.font_size = fsize;
        word.bold = is_bold;
        word.italic = is_italic;
        word.conf = conf;
        word.lang = default_fb2_lang;
        word.block_id = block_id;
        word.para_id = para_id;
        word.line_id = line_id;

        if (!out.full_text.empty()) {
            out.full_text.push_back(' ');
        }
        out.full_text += word.text;
        ++token_count;
        conf_sum += conf;
        if (is_plain_word(word.text)) {
            ++out.plain_count;
        }
        out.words.push_back(std::move(word));
    } while (ri->Next(tesseract::RIL_WORD));

    if (token_count > 0) {
        out.mean_conf = conf_sum / static_cast<double>(token_count);
        out.plain_ratio = static_cast<double>(out.plain_count) / static_cast<double>(token_count);
    }
    api.Clear();
    return out;
}

tesseract::TessBaseAPI* get_or_create_api(const fs::path& tessdata_dir,
                                          const std::string& lang_spec,
                                          std::map<std::string, void*>& cache) {
    auto it = cache.find(lang_spec);
    if (it != cache.end()) {
        return static_cast<tesseract::TessBaseAPI*>(it->second);
    }
    auto api = make_tess_api(tessdata_dir, lang_spec, tesseract::OEM_LSTM_ONLY,
                             tesseract::PSM_AUTO);
    if (!api) {
        api = make_tess_api(tessdata_dir, lang_spec, tesseract::OEM_DEFAULT, tesseract::PSM_AUTO);
    }
    tesseract::TessBaseAPI* raw = api.release();
    cache.emplace(lang_spec, raw);
    return raw;
}

void destroy_api_cache(std::map<std::string, void*>& cache) {
    for (auto& [_, ptr] : cache) {
        delete static_cast<tesseract::TessBaseAPI*>(ptr);
    }
    cache.clear();
}

}  // namespace

OcrRuntime::OcrRuntime(const OcrOptions& options, fs::path out_folder)
    : options_(options),
      out_folder_(std::move(out_folder)),
      tessdata_dir_(out_folder_ / "tessdata") {}

OcrRuntime::~OcrRuntime() = default;

bool OcrRuntime::initialize() {
    if (initialized_) {
        return !active_packs_.empty();
    }
    setMsgSeverity(L_SEVERITY_NONE);

    // Scan all ocr_dirs in descending priority order to map every valid installed pack (for
    // refusal diagnostics) and resolve requested active packs + osd.traineddata.
    std::map<std::string, std::pair<std::string, fs::path>> all_installed;
    fs::path osd_src;
    for (const fs::path& dir : options_.ocr_dirs) {
        std::error_code ec;
        if (!fs::is_directory(dir, ec)) {
            continue;
        }
        for (fs::directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
            if (!it->is_regular_file(ec)) {
                continue;
            }
            const std::string ext = lower_ascii(platform::utf8_from_path(it->path().extension()));
            if (ext != ".traineddata") {
                continue;
            }
            const std::string stem = platform::utf8_from_path(it->path().stem());
            if (!ocr::is_valid_traineddata_stem(stem)) {
                continue;
            }
            if (!ocr::validate_traineddata_file(it->path()).empty()) {
                continue;
            }
            const std::string key = lower_ascii(stem);
            if (key == "osd") {
                if (osd_src.empty()) {
                    osd_src = it->path();
                }
                continue;
            }
            if (!all_installed.contains(key)) {
                all_installed.emplace(key, std::make_pair(stem, it->path()));
            }
        }
    }

    all_installed_by_script_.clear();
    for (const auto& [_, pair] : all_installed) {
        const auto info = ocr::language_info_for_code(pair.first);
        all_installed_by_script_[info.script].push_back(pair.first);
    }

    active_packs_.clear();
    resolved_active_.clear();
    for (const std::string& req : options_.languages) {
        const std::string key = lower_ascii(req);
        const auto it = all_installed.find(key);
        if (it != all_installed.end() && !resolved_active_.contains(it->second.first)) {
            active_packs_.push_back(it->second.first);
            resolved_active_.emplace(it->second.first, it->second.second);
        }
    }
    if (active_packs_.empty()) {
        return false;
    }

    std::error_code ec;
    fs::create_directories(tessdata_dir_, ec);
    if (ec) {
        return false;
    }
    for (const auto& [code, src] : resolved_active_) {
        if (!stage_file(src, tessdata_dir_ / (code + ".traineddata"))) {
            return false;
        }
    }
    if (!osd_src.empty()) {
        osd_available_ = stage_file(osd_src, tessdata_dir_ / "osd.traineddata");
    }
    initialized_ = true;
    return true;
}

std::vector<std::string> OcrRuntime::disabled_packs_for_script(const std::string& script) const {
    std::vector<std::string> out;
    const auto it = all_installed_by_script_.find(script);
    if (it == all_installed_by_script_.end()) {
        return out;
    }
    for (const std::string& code : it->second) {
        if (!resolved_active_.contains(code)) {
            out.push_back(code);
        }
    }
    return out;
}

bool OcrRuntime::any_installed_for_script(const std::string& script) const {
    const auto it = all_installed_by_script_.find(script);
    return it != all_installed_by_script_.end() && !it->second.empty();
}

int OcrRuntime::compute_render_dpi(PDFDoc& doc, int page_num, const nlohmann::json& page_json) {
    int chosen = kDefaultDpi;
    const double page_w = page_json.value("width", 0.0);
    const double page_h = page_json.value("height", 0.0);
    const double area = page_w * page_h;
    if (area > 1.0 && page_json.contains("pictures") && page_json["pictures"].is_array()) {
        for (const auto& pic : page_json["pictures"]) {
            const auto& box = pic["box"];
            if (box.size() != 4) {
                continue;
            }
            const double bw = box[2].get<double>();
            const double bh = box[3].get<double>();
            if (bw * bh > area * 0.5 && bw > 1.0 && bh > 1.0) {
                const int pw = pic.value("w", 0);
                const int ph = pic.value("h", 0);
                if (pw > 0 && ph > 0) {
                    const double dpi_x = static_cast<double>(pw) * 72.0 / bw;
                    const double dpi_y = static_cast<double>(ph) * 72.0 / bh;
                    const int native_dpi = static_cast<int>(std::lround(std::max(dpi_x, dpi_y)));
                    chosen = std::clamp(native_dpi, kMinDpi, kMaxDpi);
                    break;
                }
            }
        }
    }
    // Clamp DPI so rendered pixel dimensions stay within memory bounds on oversized poster pages.
    if (page_num >= 1 && page_num <= doc.getNumPages()) {
        const double w_in = doc.getPageCropWidth(page_num) / 72.0;
        const double h_in = doc.getPageCropHeight(page_num) / 72.0;
        if (w_in > 0.1 && h_in > 0.1) {
            const double max_dim = std::max(w_in, h_in);
            const int dim_cap = static_cast<int>(std::floor(kMaxDimensionPx / max_dim));
            const int px_cap =
                static_cast<int>(std::floor(std::sqrt(static_cast<double>(kMaxPixels) / (w_in * h_in))));
            chosen = std::clamp(chosen, 120, std::max(120, std::min({kMaxDpi, dim_cap, px_cap})));
        }
    }
    return chosen;
}

PixPtr OcrRuntime::render_page_gray(PDFDoc& doc, int page_num, int dpi) {
    if (page_num < 1 || page_num > doc.getNumPages() || dpi < 72 || dpi > 600) {
        return nullptr;
    }
    SplashColor white = {255, 255, 255, 0};
    SplashOutputDev device(splashModeMono8, 4, white);
    device.startDoc(&doc);
    doc.displayPage(&device, page_num, dpi, dpi, 0, false, true, false);
    SplashBitmap* bmp = device.getBitmap();
    if (bmp == nullptr || bmp->getWidth() <= 0 || bmp->getHeight() <= 0) {
        return nullptr;
    }
    const int w = bmp->getWidth();
    const int h = bmp->getHeight();
    PixPtr pix(pixCreate(w, h, 8));
    if (!pix) {
        return nullptr;
    }
    pixSetXRes(pix.get(), dpi);
    pixSetYRes(pix.get(), dpi);
    l_uint32* dst_data = pixGetData(pix.get());
    const int dst_wpl = pixGetWpl(pix.get());
    const unsigned char* src_data = bmp->getDataPtr();
    const int src_stride = bmp->getRowSize();
    for (int y = 0; y < h; ++y) {
        const unsigned char* src_row = src_data + static_cast<std::size_t>(y) * src_stride;
        l_uint32* dst_row = dst_data + static_cast<std::size_t>(y) * dst_wpl;
        for (int x = 0; x < w; ++x) {
            SET_DATA_BYTE(dst_row, x, src_row[x]);
        }
    }
    return pix;
}

PixPtr OcrRuntime::render_page_rgb(PDFDoc& doc, int page_num, int dpi) {
    if (page_num < 1 || page_num > doc.getNumPages() || dpi < 72 || dpi > 600) {
        return nullptr;
    }
    SplashColor white = {255, 255, 255, 0};
    SplashOutputDev device(splashModeRGB8, 4, white);
    device.startDoc(&doc);
    doc.displayPage(&device, page_num, dpi, dpi, 0, false, true, false);
    SplashBitmap* bmp = device.getBitmap();
    if (bmp == nullptr || bmp->getWidth() <= 0 || bmp->getHeight() <= 0) {
        return nullptr;
    }
    const int w = bmp->getWidth();
    const int h = bmp->getHeight();
    PixPtr pix(pixCreate(w, h, 32));
    if (!pix) {
        return nullptr;
    }
    pixSetXRes(pix.get(), dpi);
    pixSetYRes(pix.get(), dpi);
    l_uint32* dst_data = pixGetData(pix.get());
    const int dst_wpl = pixGetWpl(pix.get());
    const unsigned char* src_data = bmp->getDataPtr();
    const int src_stride = bmp->getRowSize();
    for (int y = 0; y < h; ++y) {
        const unsigned char* src_row = src_data + static_cast<std::size_t>(y) * src_stride;
        l_uint32* dst_row = dst_data + static_cast<std::size_t>(y) * dst_wpl;
        for (int x = 0; x < w; ++x) {
            l_uint32 pixel = 0;
            composeRGBPixel(src_row[x * 3], src_row[x * 3 + 1], src_row[x * 3 + 2], &pixel);
            dst_row[x] = pixel;
        }
    }
    return pix;
}

PixPtr OcrRuntime::render_region_gray(PDFDoc& doc, int page_num,
                                      const std::array<double, 4>& box_pts, int dpi) {
    if (page_num < 1 || page_num > doc.getNumPages() || dpi < 72 || dpi > 600) {
        return nullptr;
    }
    const double scale = static_cast<double>(dpi) / 72.0;
    const int sx = std::max(0, static_cast<int>(std::floor(box_pts[0] * scale)));
    const int sy = std::max(0, static_cast<int>(std::floor(box_pts[1] * scale)));
    const int sw = std::max(1, static_cast<int>(std::ceil(box_pts[2] * scale)));
    const int sh = std::max(1, static_cast<int>(std::ceil(box_pts[3] * scale)));
    if (static_cast<long long>(sw) * sh > kMaxPixels) {
        return nullptr;
    }
    SplashColor white = {255, 255, 255, 0};
    SplashOutputDev device(splashModeMono8, 4, white);
    device.startDoc(&doc);
    doc.displayPageSlice(&device, page_num, dpi, dpi, 0, false, true, false, sx, sy, sw, sh);
    SplashBitmap* bmp = device.getBitmap();
    if (bmp == nullptr || bmp->getWidth() <= 0 || bmp->getHeight() <= 0) {
        return nullptr;
    }
    const int w = bmp->getWidth();
    const int h = bmp->getHeight();
    PixPtr pix(pixCreate(w, h, 8));
    if (!pix) {
        return nullptr;
    }
    pixSetXRes(pix.get(), dpi);
    pixSetYRes(pix.get(), dpi);
    l_uint32* dst_data = pixGetData(pix.get());
    const int dst_wpl = pixGetWpl(pix.get());
    const unsigned char* src_data = bmp->getDataPtr();
    const int src_stride = bmp->getRowSize();
    for (int y = 0; y < h; ++y) {
        const unsigned char* src_row = src_data + static_cast<std::size_t>(y) * src_stride;
        l_uint32* dst_row = dst_data + static_cast<std::size_t>(y) * dst_wpl;
        for (int x = 0; x < w; ++x) {
            SET_DATA_BYTE(dst_row, x, src_row[x]);
        }
    }
    return pix;
}

bool OcrRuntime::save_pix_crop(Pix* rgb_pix, int rotation_cw, const std::array<int, 4>& px_box,
                               int jpeg_quality, const fs::path& out_file,
                               std::string& content_type, int& out_w, int& out_h) {
    if (rgb_pix == nullptr) {
        return false;
    }
    PixPtr upright;
    const int quads = ((rotation_cw / 90) % 4 + 4) % 4;
    if (quads != 0) {
        upright.reset(pixRotateOrth(rgb_pix, quads));
    } else {
        upright.reset(pixClone(rgb_pix));
    }
    if (!upright) {
        return false;
    }
    const int uw = pixGetWidth(upright.get());
    const int uh = pixGetHeight(upright.get());
    const int x = std::clamp(px_box[0], 0, std::max(0, uw - 1));
    const int y = std::clamp(px_box[1], 0, std::max(0, uh - 1));
    const int w = std::clamp(px_box[2], 1, uw - x);
    const int h = std::clamp(px_box[3], 1, uh - y);

    BOX* box = boxCreate(x, y, w, h);
    PixPtr cropped(pixClipRectangle(upright.get(), box, nullptr));
    boxDestroy(&box);
    if (!cropped) {
        return false;
    }
    return save_pix_full(cropped.get(), 0, jpeg_quality, out_file, content_type, out_w, out_h);
}

bool OcrRuntime::save_pix_full(Pix* rgb_pix, int rotation_cw, int jpeg_quality,
                               const fs::path& out_file, std::string& content_type, int& out_w,
                               int& out_h) {
    if (rgb_pix == nullptr) {
        return false;
    }
    PixPtr upright;
    const int quads = ((rotation_cw / 90) % 4 + 4) % 4;
    if (quads != 0) {
        upright.reset(pixRotateOrth(rgb_pix, quads));
    } else {
        upright.reset(pixClone(rgb_pix));
    }
    if (!upright) {
        return false;
    }
    const int w = pixGetWidth(upright.get());
    const int h = pixGetHeight(upright.get());
    images::Bitmap bitmap;
    bitmap.width = out_w = w;
    bitmap.height = out_h = h;
    bitmap.rgba.resize(static_cast<std::size_t>(w) * h * 4);
    l_uint32* data = pixGetData(upright.get());
    const int wpl = pixGetWpl(upright.get());
    for (int y = 0; y < h; ++y) {
        const l_uint32* row = data + static_cast<std::size_t>(y) * wpl;
        for (int x = 0; x < w; ++x) {
            l_int32 r = 0, g = 0, b = 0;
            extractRGBValues(row[x], &r, &g, &b);
            std::uint8_t* px = &bitmap.rgba[(static_cast<std::size_t>(y) * w + x) * 4];
            px[0] = static_cast<std::uint8_t>(r);
            px[1] = static_cast<std::uint8_t>(g);
            px[2] = static_cast<std::uint8_t>(b);
            px[3] = 255;
        }
    }
    const std::string bytes = images::encode_jpeg(bitmap, std::clamp(jpeg_quality, 1, 100));
    if (bytes.empty()) {
        return false;
    }
    content_type = "image/jpeg";
    std::error_code ec;
    fs::create_directories(out_file.parent_path(), ec);
    std::ofstream out(out_file, std::ios::binary);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    return static_cast<bool>(out);
}

OcrDiagnosis OcrRuntime::detect_document_language(
    PDFDoc& doc, const std::vector<int>& sample_pages,
    const std::map<int, nlohmann::json>& page_models,
    const std::function<void(int, int)>& on_sample) {
    OcrDiagnosis diag;
    if (!initialized_ || active_packs_.empty()) {
        return diag;
    }
    if (!options_.auto_detect || active_packs_.size() == 1) {
        diag.primary_pack = active_packs_.front();
        diag.primary_lang = ocr::language_info_for_code(diag.primary_pack).fb2_lang;
        return diag;
    }

    const auto by_script = group_packs_by_script(active_packs_);
    std::unique_ptr<tesseract::TessBaseAPI> osd_api;
    if (osd_available_) {
        osd_api = make_tess_api(tessdata_dir_, "osd", tesseract::OEM_DEFAULT,
                                tesseract::PSM_OSD_ONLY);
    }

    struct SamplePix {
        int page = 0;
        int dpi = kDefaultDpi;
        PixPtr upright;
        OsdInfo osd;
    };
    std::vector<SamplePix> samples;
    const int total = static_cast<int>(sample_pages.size());
    std::map<std::string, float> script_votes;

    for (int idx = 0; idx < total; ++idx) {
        const int p = sample_pages[static_cast<std::size_t>(idx)];
        const auto mit = page_models.find(p);
        const nlohmann::json empty = nlohmann::json::object();
        const int dpi = compute_render_dpi(doc, p, mit != page_models.end() ? mit->second : empty);
        PixPtr raw = render_page_gray(doc, p, dpi);
        if (on_sample) {
            on_sample(idx + 1, total);
        }
        if (!raw) {
            continue;
        }
        OsdInfo osd = run_osd(osd_api.get(), raw.get());
        if (osd.ok && !osd.script.empty() && osd.script_conf >= 1.5f) {
            script_votes[osd.script] += osd.script_conf;
        }
        PixPtr upright = maybe_rotate_and_deskew(raw.get(), osd.rotate_cw);
        if (upright) {
            samples.push_back(SamplePix{p, dpi, std::move(upright), std::move(osd)});
        }
    }

    std::string best_script;
    float best_script_votes = 0.0f;
    for (const auto& [script, votes] : script_votes) {
        if (votes > best_script_votes) {
            best_script = script;
            best_script_votes = votes;
        }
    }
    diag.dominant_osd_script = best_script;
    diag.dominant_osd_script_conf = best_script_votes;

    // Fast path (PD3): OSD identified a script that maps to exactly ONE enabled pack -> zero
    // extra language probes needed!
    if (!best_script.empty()) {
        if (const auto sit = by_script.find(best_script); sit != by_script.end()) {
            if (sit->second.size() == 1) {
                diag.primary_pack = sit->second.front();
                diag.primary_lang = ocr::language_info_for_code(diag.primary_pack).fb2_lang;
                return diag;
            }
        }
    }

    // Determine candidate packs to probe: all packs matching the OSD script when known and
    // enabled, otherwise all enabled packs.
    std::vector<std::string> candidates;
    if (!best_script.empty()) {
        if (const auto sit = by_script.find(best_script); sit != by_script.end()) {
            candidates = sit->second;
        }
    }
    if (candidates.empty()) {
        candidates = active_packs_;
    }

    std::map<std::string, double> score_sum;
    for (const std::string& code : candidates) {
        auto api = make_tess_api(tessdata_dir_, code, tesseract::OEM_LSTM_ONLY, tesseract::PSM_AUTO);
        if (!api) {
            api = make_tess_api(tessdata_dir_, code, tesseract::OEM_DEFAULT, tesseract::PSM_AUTO);
        }
        if (!api) {
            continue;
        }
        const std::string fb2_lang = ocr::language_info_for_code(code).fb2_lang;
        for (const SamplePix& s : samples) {
            const PassOutput pass = run_tesseract_pass(*api, s.upright.get(), s.dpi, fb2_lang, false);
            const auto scored = evaluate_ocr_candidate(pass.full_text, code, pass.mean_conf,
                                                       pass.plain_ratio,
                                                       static_cast<int>(pass.words.size()));
            score_sum[code] += scored.total_score;
        }
    }

    std::vector<OcrCandidateScore> aggregate;
    for (const std::string& code : candidates) {
        const auto info = ocr::language_info_for_code(code);
        OcrCandidateScore c;
        c.code = code;
        c.fb2_lang = info.fb2_lang;
        c.script = info.script;
        c.total_score = score_sum[code];
        aggregate.push_back(std::move(c));
    }
    diag.primary_pack = pick_best_candidate(aggregate);
    if (diag.primary_pack.empty()) {
        diag.primary_pack = active_packs_.front();
    }
    diag.primary_lang = ocr::language_info_for_code(diag.primary_pack).fb2_lang;
    return diag;
}

OcrPageResult OcrRuntime::recognize_single_pix(int page_num, Pix* raw_gray, int dpi,
                                               const std::string& doc_primary_pack,
                                               void* osd_api_ptr,
                                               std::map<std::string, void*>& api_cache) const {
    OcrPageResult res;
    res.page = page_num;
    res.dpi = dpi;
    if (raw_gray == nullptr || active_packs_.empty()) {
        return res;
    }

    auto* osd_api = static_cast<tesseract::TessBaseAPI*>(osd_api_ptr);
    const OsdInfo osd = run_osd(osd_api, raw_gray);
    res.rotation_cw = osd.rotate_cw;
    res.osd_script = osd.script;
    res.osd_script_conf = osd.script_conf;

    PixPtr upright = maybe_rotate_and_deskew(raw_gray, osd.rotate_cw);
    if (!upright) {
        return res;
    }
    const int up_w = pixGetWidth(upright.get());
    const int up_h = pixGetHeight(upright.get());
    const double px_to_pt = 72.0 / static_cast<double>(dpi);
    res.page_width_pts = up_w * px_to_pt;
    res.page_height_pts = up_h * px_to_pt;

    const auto by_script = group_packs_by_script(active_packs_);
    std::string chosen_spec;
    std::string page_primary_pack =
        doc_primary_pack.empty() ? active_packs_.front() : doc_primary_pack;

    if (!options_.auto_detect) {
        // Manual mode: pass all enabled packs directly.
        chosen_spec = join_langs(active_packs_);
    } else {
        // Per-page script check: if OSD confidently sees a different enabled script on this page
        // than the document's primary script, switch to that script's candidate pack(s).
        const std::string doc_script = ocr::language_info_for_code(page_primary_pack).script;
        if (!osd.script.empty() && osd.script_conf >= 2.0f && osd.script != doc_script) {
            if (const auto sit = by_script.find(osd.script); sit != by_script.end()) {
                if (sit->second.size() == 1) {
                    page_primary_pack = sit->second.front();
                } else {
                    // Pick best pack among that script's enabled candidates on this page.
                    std::vector<OcrCandidateScore> scores;
                    for (const std::string& cand : sit->second) {
                        if (auto* api = get_or_create_api(tessdata_dir_, cand, api_cache)) {
                            const auto pass = run_tesseract_pass(
                                *api, upright.get(), dpi, ocr::language_info_for_code(cand).fb2_lang,
                                false);
                            scores.push_back(evaluate_ocr_candidate(
                                pass.full_text, cand, pass.mean_conf, pass.plain_ratio,
                                static_cast<int>(pass.words.size())));
                        }
                    }
                    if (const std::string best = pick_best_candidate(scores); !best.empty()) {
                        page_primary_pack = best;
                    }
                }
            }
        }
        chosen_spec = page_primary_pack;
    }

    auto* primary_api = get_or_create_api(tessdata_dir_, chosen_spec, api_cache);
    if (primary_api == nullptr) {
        return res;
    }
    const std::string primary_fb2 = ocr::language_info_for_code(page_primary_pack).fb2_lang;
    PassOutput pass = run_tesseract_pass(*primary_api, upright.get(), dpi, primary_fb2, true);

    // If auto-detect is on and multiple enabled packs exist, check:
    // (a) Page-level fallback: if primary pass yielded poor results (< 60% conf or < 0.55 plain
    //     ratio or < 3 plain words) and other enabled packs exist, try them and keep the winner!
    // (b) Per-block multilingual re-scoring (T035): for distinct blocks (>= 5 words) where a
    //     foreign script or alternate same-script enabled pack scores significantly better,
    //     re-recognize that cropped block with the alternate pack so bilingual pages (EN+RU,
    //     DE+EN, etc.) get crisp words tagged with their exact FB2 xml:lang.
    if (options_.auto_detect && active_packs_.size() > 1) {
        const auto primary_eval = evaluate_ocr_candidate(
            pass.full_text, page_primary_pack, pass.mean_conf, pass.plain_ratio,
            static_cast<int>(pass.words.size()));
        const bool weak_page =
            pass.plain_count < 3 || pass.mean_conf < 62.0 || pass.plain_ratio < 0.58 ||
            primary_eval.text_score < 0.28;
        if (weak_page) {
            OcrCandidateScore best_eval = primary_eval;
            PassOutput best_pass = pass;
            std::string best_pack = page_primary_pack;
            for (const std::string& cand : active_packs_) {
                if (cand == page_primary_pack) {
                    continue;
                }
                if (auto* api = get_or_create_api(tessdata_dir_, cand, api_cache)) {
                    const std::string fb2 = ocr::language_info_for_code(cand).fb2_lang;
                    PassOutput alt = run_tesseract_pass(*api, upright.get(), dpi, fb2, true);
                    const auto ev = evaluate_ocr_candidate(alt.full_text, cand, alt.mean_conf,
                                                           alt.plain_ratio,
                                                           static_cast<int>(alt.words.size()));
                    if (ev.total_score > best_eval.total_score + 0.04) {
                        best_eval = ev;
                        best_pass = std::move(alt);
                        best_pack = cand;
                    }
                }
            }
            if (best_pack != page_primary_pack) {
                page_primary_pack = best_pack;
                pass = std::move(best_pass);
            }
        }

        // Per-block multilingual check across distinct paragraphs/blocks (>= 5 words).
        std::map<int, std::vector<std::size_t>> blocks;
        for (std::size_t i = 0; i < pass.words.size(); ++i) {
            blocks[pass.words[i].para_id].push_back(i);
        }
        const std::string page_script = ocr::language_info_for_code(page_primary_pack).script;
        std::vector<OcrWord> refined_words;
        refined_words.reserve(pass.words.size());
        std::map<int, std::vector<OcrWord>> replacements;

        for (const auto& [pid, indices] : blocks) {
            if (indices.size() < 5) {
                continue;
            }
            std::string block_text;
            double conf_sum = 0.0;
            int plain_cnt = 0;
            double min_x = 1e9, min_y = 1e9, max_x = 0.0, max_y = 0.0;
            for (std::size_t idx : indices) {
                const OcrWord& w = pass.words[idx];
                if (!block_text.empty()) {
                    block_text.push_back(' ');
                }
                block_text += w.text;
                conf_sum += w.conf;
                if (is_plain_word(w.text)) {
                    ++plain_cnt;
                }
                min_x = std::min(min_x, w.box[0]);
                min_y = std::min(min_y, w.box[1]);
                max_x = std::max(max_x, w.box[0] + w.box[2]);
                max_y = std::max(max_y, w.box[1] + w.box[3]);
            }
            const double b_conf = conf_sum / static_cast<double>(indices.size());
            const double b_plain =
                static_cast<double>(plain_cnt) / static_cast<double>(indices.size());
            const auto base_eval = evaluate_ocr_candidate(
                block_text, page_primary_pack, b_conf, b_plain, static_cast<int>(indices.size()));

            // Re-probe the cropped block when either:
            // 1) Confidence/plain-ratio is weak (classic sign of another script like Cyrillic read
            //    with an English pack), OR
            // 2) Same-script enabled alternatives score better on text trigrams.
            bool should_reprobe = b_conf < 76.0 || b_plain < 0.72 || base_eval.text_score < 0.32;
            std::vector<std::string> alt_packs;
            if (should_reprobe) {
                for (const std::string& p : active_packs_) {
                    if (p != page_primary_pack) {
                        alt_packs.push_back(p);
                    }
                }
            } else if (const auto sit = by_script.find(page_script);
                       sit != by_script.end() && sit->second.size() > 1) {
                const std::string best_same = detect_same_script_pack(block_text, sit->second);
                if (!best_same.empty() && best_same != page_primary_pack) {
                    const double alt_text = score_text_for_language(block_text, best_same);
                    if (alt_text > base_eval.text_score + 0.14) {
                        alt_packs.push_back(best_same);
                    }
                }
            }

            if (alt_packs.empty()) {
                continue;
            }
            const double scale = static_cast<double>(dpi) / 72.0;
            const int pad = 10;
            const int cx = std::max(0, static_cast<int>(std::floor(min_x * scale)) - pad);
            const int cy = std::max(0, static_cast<int>(std::floor(min_y * scale)) - pad);
            const int cw =
                std::min(up_w - cx, static_cast<int>(std::ceil((max_x - min_x) * scale)) + 2 * pad);
            const int ch =
                std::min(up_h - cy, static_cast<int>(std::ceil((max_y - min_y) * scale)) + 2 * pad);
            if (cw < 20 || ch < 12) {
                continue;
            }
            BOX* crop_box = boxCreate(cx, cy, cw, ch);
            PixPtr block_pix(pixClipRectangle(upright.get(), crop_box, nullptr));
            boxDestroy(&crop_box);
            if (!block_pix) {
                continue;
            }

            OcrCandidateScore best_blk = base_eval;
            std::vector<OcrWord> best_blk_words;
            const double off_x_pt = cx * px_to_pt;
            const double off_y_pt = cy * px_to_pt;

            for (const std::string& cand : alt_packs) {
                auto* api = get_or_create_api(tessdata_dir_, cand, api_cache);
                if (api == nullptr) {
                    continue;
                }
                const std::string fb2 = ocr::language_info_for_code(cand).fb2_lang;
                PassOutput alt = run_tesseract_pass(*api, block_pix.get(), dpi, fb2, false);
                if (alt.words.empty()) {
                    continue;
                }
                const auto ev = evaluate_ocr_candidate(alt.full_text, cand, alt.mean_conf,
                                                       alt.plain_ratio,
                                                       static_cast<int>(alt.words.size()));
                if (ev.total_score > best_blk.total_score + 0.08 && alt.plain_count >= 3) {
                    best_blk = ev;
                    best_blk_words = std::move(alt.words);
                    for (OcrWord& w : best_blk_words) {
                        w.box[0] += off_x_pt;
                        w.box[1] += off_y_pt;
                        w.para_id = pid;
                        w.block_id = pass.words[indices.front()].block_id;
                        w.lang = fb2;
                    }
                }
            }
            if (!best_blk_words.empty()) {
                replacements.emplace(pid, std::move(best_blk_words));
            }
        }

        if (!replacements.empty()) {
            std::set<int> emitted;
            double conf_sum = 0.0;
            int plain_cnt = 0;
            for (const OcrWord& w : pass.words) {
                const auto rit = replacements.find(w.para_id);
                if (rit != replacements.end()) {
                    if (emitted.insert(w.para_id).second) {
                        for (const OcrWord& rw : rit->second) {
                            conf_sum += rw.conf;
                            if (is_plain_word(rw.text)) {
                                ++plain_cnt;
                            }
                            refined_words.push_back(rw);
                        }
                    }
                } else {
                    conf_sum += w.conf;
                    if (is_plain_word(w.text)) {
                        ++plain_cnt;
                    }
                    refined_words.push_back(w);
                }
            }
            pass.words = std::move(refined_words);
            pass.plain_count = plain_cnt;
            if (!pass.words.empty()) {
                pass.mean_conf = conf_sum / static_cast<double>(pass.words.size());
                pass.plain_ratio =
                    static_cast<double>(plain_cnt) / static_cast<double>(pass.words.size());
            }
        }
    } else if (!options_.auto_detect && active_packs_.size() > 1) {
        // Manual mode with multiple packs (e.g. eng+rus): tag each paragraph with its detected
        // language so FB2 xml:lang stays accurate.
        std::map<int, std::vector<std::size_t>> paras;
        for (std::size_t i = 0; i < pass.words.size(); ++i) {
            paras[pass.words[i].para_id].push_back(i);
        }
        for (const auto& [_, indices] : paras) {
            std::string ptext;
            for (std::size_t idx : indices) {
                if (!ptext.empty()) {
                    ptext.push_back(' ');
                }
                ptext += pass.words[idx].text;
            }
            const std::string dom = dominant_text_script(ptext);
            std::vector<std::string> matching;
            if (!dom.empty()) {
                if (const auto sit = by_script.find(dom); sit != by_script.end()) {
                    matching = sit->second;
                }
            }
            if (matching.empty()) {
                matching = active_packs_;
            }
            const std::string best = detect_same_script_pack(ptext, matching);
            const std::string fb2 = ocr::language_info_for_code(best).fb2_lang;
            for (std::size_t idx : indices) {
                pass.words[idx].lang = fb2;
            }
        }
    }

    // Determine usability: require at least a minimal number of plain words and reasonable
    // confidence so pure random noise or unreadable scans cleanly fall back or refuse.
    // When OSD confidently identified a script that NO active pack supports (e.g. Cyrillic text
    // fed to English-only Tesseract, where visual homoglyphs can fool low confidence thresholds),
    // demand strong in-language evidence before accepting the output as usable.
    bool has_usable_text =
        (pass.plain_count >= 3 && pass.mean_conf >= 32.0 && pass.plain_ratio >= 0.35) ||
        (pass.plain_count >= 1 && pass.words.size() <= 4 && pass.mean_conf >= 55.0);
    if (has_usable_text && osd.ok && !osd.script.empty() && osd.script_conf >= 2.0f &&
        !by_script.contains(osd.script)) {
        std::string all_text;
        for (const OcrWord& w : pass.words) {
            if (!all_text.empty()) {
                all_text.push_back(' ');
            }
            all_text += w.text;
        }
        const double lang_score = score_text_for_language(all_text, page_primary_pack);
        if (pass.mean_conf < 82.0 || pass.plain_ratio < 0.85 || lang_score < 0.45) {
            has_usable_text = false;
        }
    }

    res.usable = has_usable_text;
    res.mean_conf = pass.mean_conf;
    res.plain_ratio = pass.plain_ratio;
    res.low_confidence = has_usable_text && (pass.mean_conf < 60.0 || pass.plain_ratio < 0.65);
    res.primary_pack = page_primary_pack;
    res.primary_lang = ocr::language_info_for_code(page_primary_pack).fb2_lang;
    res.words = std::move(pass.words);
    res.image_regions = std::move(pass.image_regions);

    // Collect distinct FB2 languages ordered by word frequency.
    std::map<std::string, int> lang_counts;
    for (const OcrWord& w : res.words) {
        if (!w.lang.empty()) {
            lang_counts[w.lang]++;
        }
    }
    std::vector<std::pair<std::string, int>> ordered(lang_counts.begin(), lang_counts.end());
    std::sort(ordered.begin(), ordered.end(), [](const auto& a, const auto& b) {
        if (a.second != b.second) {
            return a.second > b.second;
        }
        return a.first < b.first;
    });
    for (const auto& [lang, _] : ordered) {
        res.languages.push_back(lang);
    }
    if (!res.languages.empty()) {
        res.primary_lang = res.languages.front();
    }
    return res;
}

void OcrRuntime::recognize_pages_parallel(
    PDFDoc& doc, const std::vector<int>& target_pages,
    const std::map<int, nlohmann::json>& page_models, const std::string& doc_primary_pack,
    const std::function<void(OcrPageResult&&)>& on_page, std::atomic<bool>& cancelled) {
    if (!initialized_ || target_pages.empty()) {
        return;
    }

    const int worker_count = std::clamp(
        std::min<int>(options_.threads, static_cast<int>(target_pages.size())), 1, 8);

    if (worker_count == 1) {
        std::unique_ptr<tesseract::TessBaseAPI> osd_api;
        if (osd_available_) {
            osd_api = make_tess_api(tessdata_dir_, "osd", tesseract::OEM_DEFAULT,
                                    tesseract::PSM_OSD_ONLY);
        }
        std::map<std::string, void*> cache;
        for (int p : target_pages) {
            if (cancelled.load()) {
                break;
            }
#ifndef _WIN32
            if (getppid() == 1) {
                cancelled.store(true);
                break;
            }
#endif
            const auto mit = page_models.find(p);
            const nlohmann::json empty = nlohmann::json::object();
            const int dpi =
                compute_render_dpi(doc, p, mit != page_models.end() ? mit->second : empty);
            PixPtr raw = render_page_gray(doc, p, dpi);
            OcrPageResult r = recognize_single_pix(p, raw.get(), dpi, doc_primary_pack,
                                                   osd_api.get(), cache);
            on_page(std::move(r));
        }
        destroy_api_cache(cache);
        return;
    }

    struct WorkItem {
        int page = 0;
        int dpi = kDefaultDpi;
        PixPtr gray;
    };

    const std::size_t capacity = static_cast<std::size_t>(worker_count) * 2;
    std::mutex q_mutex;
    std::condition_variable q_not_full;
    std::condition_variable q_not_empty;
    std::deque<WorkItem> queue;
    bool producer_done = false;
    std::mutex callback_mutex;

    auto worker_fn = [&]() {
        std::unique_ptr<tesseract::TessBaseAPI> osd_api;
        if (osd_available_) {
            osd_api = make_tess_api(tessdata_dir_, "osd", tesseract::OEM_DEFAULT,
                                    tesseract::PSM_OSD_ONLY);
        }
        std::map<std::string, void*> cache;
        for (;;) {
            WorkItem item;
            {
                std::unique_lock<std::mutex> lock(q_mutex);
                q_not_empty.wait(lock, [&] {
                    return !queue.empty() || producer_done || cancelled.load();
                });
                if (cancelled.load() || (queue.empty() && producer_done)) {
                    break;
                }
                item = std::move(queue.front());
                queue.pop_front();
                q_not_full.notify_one();
            }
            OcrPageResult res = recognize_single_pix(item.page, item.gray.get(), item.dpi,
                                                     doc_primary_pack, osd_api.get(), cache);
            item.gray.reset();
            {
                std::lock_guard<std::mutex> lock(callback_mutex);
                on_page(std::move(res));
            }
        }
        destroy_api_cache(cache);
    };

    std::vector<std::thread> workers;
    workers.reserve(static_cast<std::size_t>(worker_count));
    for (int i = 0; i < worker_count; ++i) {
        workers.emplace_back(worker_fn);
    }

    // Producer runs sequentially on the caller thread because Poppler PDFDoc is not thread-safe.
    for (int p : target_pages) {
        if (cancelled.load()) {
            break;
        }
#ifndef _WIN32
        if (getppid() == 1) {
            cancelled.store(true);
            break;
        }
#endif
        const auto mit = page_models.find(p);
        const nlohmann::json empty = nlohmann::json::object();
        const int dpi = compute_render_dpi(doc, p, mit != page_models.end() ? mit->second : empty);
        PixPtr raw = render_page_gray(doc, p, dpi);
        {
            std::unique_lock<std::mutex> lock(q_mutex);
            q_not_full.wait(lock, [&] { return queue.size() < capacity || cancelled.load(); });
            if (cancelled.load()) {
                break;
            }
            queue.push_back(WorkItem{p, dpi, std::move(raw)});
            q_not_empty.notify_one();
        }
    }

    {
        std::lock_guard<std::mutex> lock(q_mutex);
        producer_done = true;
    }
    q_not_empty.notify_all();
    for (auto& t : workers) {
        if (t.joinable()) {
            t.join();
        }
    }
}

OcrTextBlockResult OcrRuntime::recognize_embedded_region(Pix* gray_region, int dpi,
                                                         const std::array<double, 4>& box_pts,
                                                         const std::string& preferred_pack) {
    OcrTextBlockResult out;
    if (!initialized_ || gray_region == nullptr || active_packs_.empty()) {
        return out;
    }
    std::vector<std::string> candidates;
    if (!options_.auto_detect) {
        candidates.push_back(join_langs(active_packs_));
    } else {
        if (!preferred_pack.empty() && resolved_active_.contains(preferred_pack)) {
            candidates.push_back(preferred_pack);
        }
        for (const std::string& p : active_packs_) {
            if (std::find(candidates.begin(), candidates.end(), p) == candidates.end()) {
                candidates.push_back(p);
            }
        }
    }

    OcrCandidateScore best_eval;
    PassOutput best_pass;
    std::string best_pack;

    for (const std::string& spec : candidates) {
        auto api = make_tess_api(tessdata_dir_, spec, tesseract::OEM_LSTM_ONLY, tesseract::PSM_AUTO);
        if (!api) {
            api = make_tess_api(tessdata_dir_, spec, tesseract::OEM_DEFAULT, tesseract::PSM_AUTO);
        }
        if (!api) {
            continue;
        }
        const std::string pack_for_lang =
            options_.auto_detect ? spec : active_packs_.front();
        const std::string fb2 = ocr::language_info_for_code(pack_for_lang).fb2_lang;
        PassOutput pass = run_tesseract_pass(*api, gray_region, dpi, fb2, false);
        if (pass.plain_count < 3) {
            continue;
        }
        const auto ev = evaluate_ocr_candidate(pass.full_text, pack_for_lang, pass.mean_conf,
                                               pass.plain_ratio,
                                               static_cast<int>(pass.words.size()));
        if (best_pack.empty() || ev.total_score > best_eval.total_score + 0.04) {
            best_eval = ev;
            best_pass = std::move(pass);
            best_pack = pack_for_lang;
        }
        // Short-circuit if the preferred pack already produced high-confidence clean text with
        // strong in-language trigram match.
        if (options_.auto_detect && spec == preferred_pack && best_eval.mean_conf >= 82.0 &&
            best_eval.plain_ratio >= 0.80 && best_eval.text_score >= 0.45) {
            break;
        }
    }

    // Strict filter for embedded images on searchable pages so pure illustrations / charts /
    // decorative stamps never produce spurious OCR paragraphs.
    const bool usable = !best_pack.empty() && best_pass.plain_count >= 4 &&
                        best_pass.mean_conf >= 62.0 && best_pass.plain_ratio >= 0.65;
    if (!usable) {
        return out;
    }

    const std::string fb2 = ocr::language_info_for_code(best_pack).fb2_lang;
    for (OcrWord& w : best_pass.words) {
        w.box[0] += box_pts[0];
        w.box[1] += box_pts[1];
        w.lang = fb2;
    }
    out.usable = true;
    out.pack_code = best_pack;
    out.fb2_lang = fb2;
    out.mean_conf = best_pass.mean_conf;
    out.plain_ratio = best_pass.plain_ratio;
    out.words = std::move(best_pass.words);
    return out;
}

}  // namespace mfbe::pdf_reader
