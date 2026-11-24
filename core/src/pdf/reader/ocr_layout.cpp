// Feature 020 (T036): Implementation of embedded raster image OCR candidate filtering and
// scanned-page inline illustration cropping.
#include "pdf/reader/ocr_layout.hpp"

#include <PDFDoc.h>
#include <algorithm>
#include <allheaders.h>
#include <cmath>
#include <map>

namespace mfbe::pdf_reader {

namespace {

bool box_contains_point(const std::array<double, 4>& box, double px, double py, double pad) {
    return px >= box[0] - pad && px <= box[0] + box[2] + pad && py >= box[1] - pad &&
           py <= box[1] + box[3] + pad;
}

double boxes_overlap_ratio(const std::array<double, 4>& a, const std::array<double, 4>& b) {
    const double x0 = std::max(a[0], b[0]);
    const double y0 = std::max(a[1], b[1]);
    const double x1 = std::min(a[0] + a[2], b[0] + b[2]);
    const double y1 = std::min(a[1] + a[3], b[1] + b[3]);
    if (x1 <= x0 || y1 <= y0) {
        return 0.0;
    }
    const double inter = (x1 - x0) * (y1 - y0);
    const double a_area = std::max(1.0, a[2] * a[3]);
    return inter / a_area;
}

// Fast zero-Tesseract stroke-transition pre-check on an 8-bit grayscale crop: printed text lines
// create dense sharp horizontal intensity transitions across glyph stems, whereas landscapes,
// smooth gradients, and solid geometric figures have far fewer transitions per scanline.
bool gray_pix_may_contain_text(Pix* gray) {
    if (gray == nullptr) {
        return false;
    }
    const int w = pixGetWidth(gray);
    const int h = pixGetHeight(gray);
    if (w < 64 || h < 24) {
        return false;
    }
    const int left = std::max(2, w / 25);
    const int right = std::min(w - 2, w - w / 25);
    const int top = std::max(1, h / 25);
    const int bottom = std::min(h - 1, h - h / 25);
    if (right - left < 40 || bottom - top < 16) {
        return false;
    }
    l_uint32* data = pixGetData(gray);
    const int wpl = pixGetWpl(gray);

    int text_rows = 0;
    int max_run = 0;
    int cur_run = 0;
    for (int y = top; y < bottom; ++y) {
        const l_uint32* row = data + static_cast<std::size_t>(y) * wpl;
        int transitions = 0;
        bool in_edge = false;
        for (int x = left + 2; x < right; ++x) {
            const int v0 = static_cast<int>(GET_DATA_BYTE(row, x - 2));
            const int v1 = static_cast<int>(GET_DATA_BYTE(row, x));
            const int diff = std::abs(v1 - v0);
            if (diff >= 55) {
                if (!in_edge) {
                    ++transitions;
                    in_edge = true;
                }
            } else if (diff <= 20) {
                in_edge = false;
            }
        }
        if (transitions >= 12) {
            ++text_rows;
            ++cur_run;
            max_run = std::max(max_run, cur_run);
        } else {
            cur_run = 0;
        }
    }
    return max_run >= 5 || text_rows >= 12;
}

// Verifies that an upright 32-bit RGB region has substantive non-white visual content (rejects
// blank margins, thin borders, and solid monochrome rectangles).
bool rgb_region_has_artwork(Pix* upright_rgb, const std::array<int, 4>& px_box) {
    if (upright_rgb == nullptr) {
        return false;
    }
    const int uw = pixGetWidth(upright_rgb);
    const int uh = pixGetHeight(upright_rgb);
    const int x0 = std::clamp(px_box[0], 0, std::max(0, uw - 1));
    const int y0 = std::clamp(px_box[1], 0, std::max(0, uh - 1));
    const int x1 = std::clamp(px_box[0] + px_box[2], x0 + 1, uw);
    const int y1 = std::clamp(px_box[1] + px_box[3], y0 + 1, uh);
    const int w = x1 - x0;
    const int h = y1 - y0;
    if (w < 60 || h < 45) {
        return false;
    }
    l_uint32* data = pixGetData(upright_rgb);
    const int wpl = pixGetWpl(upright_rgb);
    long total = 0;
    long non_white = 0;
    long saturated = 0;
    const int step = std::max(1, std::min(w, h) / 120);
    for (int y = y0; y < y1; y += step) {
        const l_uint32* row = data + static_cast<std::size_t>(y) * wpl;
        for (int x = x0; x < x1; x += step) {
            l_int32 r = 0, g = 0, b = 0;
            extractRGBValues(row[x], &r, &g, &b);
            ++total;
            if (r < 238 || g < 238 || b < 238) {
                ++non_white;
            }
            const int mx = std::max({r, g, b});
            const int mn = std::min({r, g, b});
            if (mx - mn >= 24) {
                ++saturated;
            }
        }
    }
    if (total <= 0) {
        return false;
    }
    const double ink_ratio = static_cast<double>(non_white) / static_cast<double>(total);
    const double color_ratio = static_cast<double>(saturated) / static_cast<double>(total);
    return ink_ratio >= 0.12 && (ink_ratio <= 0.99 || color_ratio >= 0.15);
}

// Fallback artwork locator for scanned pages when Tesseract's grayscale layout analyzer did not
// emit a PT_*_IMAGE block around a colored/halftone inline illustration standing cleanly outside
// all recognized word boxes.
std::vector<OcrImageRegion> find_nontext_artwork_bands(Pix* upright_rgb, const OcrPageResult& res) {
    std::vector<OcrImageRegion> out;
    if (upright_rgb == nullptr || res.dpi <= 0) {
        return out;
    }
    const int uw = pixGetWidth(upright_rgb);
    const int uh = pixGetHeight(upright_rgb);
    const double scale = static_cast<double>(res.dpi) / 72.0;
    const double px_to_pt = 72.0 / static_cast<double>(res.dpi);

    // Mark vertical rows covered by recognized text words (with small vertical padding).
    std::vector<bool> text_row(static_cast<std::size_t>(uh), false);
    for (const OcrWord& w : res.words) {
        const int y0 = std::max(0, static_cast<int>(std::floor(w.box[1] * scale)) - 8);
        const int y1 = std::min(uh, static_cast<int>(std::ceil((w.box[1] + w.box[3]) * scale)) + 8);
        for (int y = y0; y < y1; ++y) {
            text_row[static_cast<std::size_t>(y)] = true;
        }
    }

    const int margin_x = std::max(8, uw / 25);
    const int left = margin_x;
    const int right = std::max(left + 1, uw - margin_x);
    l_uint32* data = pixGetData(upright_rgb);
    const int wpl = pixGetWpl(upright_rgb);

    // Find horizontal bands outside text rows with dense non-white content.
    struct RowSpan {
        int y0 = 0;
        int y1 = 0;
        int min_x = 0;
        int max_x = 0;
    };
    std::vector<RowSpan> spans;
    bool in_span = false;
    const int min_row_ink = std::max(24, (right - left) / 10);
    for (int y = 8; y < uh - 8; ++y) {
        if (text_row[static_cast<std::size_t>(y)]) {
            in_span = false;
            continue;
        }
        const l_uint32* row = data + static_cast<std::size_t>(y) * wpl;
        int ink = 0;
        int rmin = right;
        int rmax = left;
        for (int x = left; x < right; x += 2) {
            l_int32 r = 0, g = 0, b = 0;
            extractRGBValues(row[x], &r, &g, &b);
            if (r < 236 || g < 236 || b < 236) {
                ink += 2;
                rmin = std::min(rmin, x);
                rmax = std::max(rmax, x);
            }
        }
        if (ink >= min_row_ink) {
            if (!in_span) {
                spans.push_back({y, y, rmin, rmax});
                in_span = true;
            } else {
                RowSpan& cur = spans.back();
                cur.y1 = y;
                cur.min_x = std::min(cur.min_x, rmin);
                cur.max_x = std::max(cur.max_x, rmax);
            }
        } else if (in_span && y - spans.back().y1 > 12) {
            in_span = false;
        }
    }

    const double page_area = std::max(1.0, res.page_width_pts * res.page_height_pts);
    for (const RowSpan& s : spans) {
        const int bw = s.max_x - s.min_x + 1;
        const int bh = s.y1 - s.y0 + 1;
        const double pt_w = bw * px_to_pt;
        const double pt_h = bh * px_to_pt;
        const double frac = (pt_w * pt_h) / page_area;
        if (pt_w >= 72.0 && pt_h >= 54.0 && frac >= 0.03 && frac <= 0.65) {
            OcrImageRegion reg;
            reg.px_box = {s.min_x, s.y0, bw, bh};
            reg.pt_box = {s.min_x * px_to_pt, s.y0 * px_to_pt, pt_w, pt_h};
            if (rgb_region_has_artwork(upright_rgb, reg.px_box)) {
                out.push_back(reg);
            }
        }
    }
    return out;
}

}  // namespace

std::vector<EmbeddedImageCandidate> find_embedded_ocr_candidates(PDFDoc& doc, int page_num,
                                                                 const nlohmann::json& page_json) {
    std::vector<EmbeddedImageCandidate> out;
    if (page_json.value("kind", "") != "text") {
        return out;
    }
    const double page_w = page_json.value("width", 0.0);
    const double page_h = page_json.value("height", 0.0);
    const double page_area = page_w * page_h;
    if (page_area <= 1.0 || !page_json.contains("pictures") || !page_json["pictures"].is_array()) {
        return out;
    }
    const auto& words = page_json.contains("words") && page_json["words"].is_array()
                            ? page_json["words"]
                            : nlohmann::json::array();

    for (const auto& pic : page_json["pictures"]) {
        if (!pic.is_object() || !pic.contains("box") || pic["box"].size() != 4) {
            continue;
        }
        const std::array<double, 4> box = {pic["box"][0].get<double>(), pic["box"][1].get<double>(),
                                           pic["box"][2].get<double>(),
                                           pic["box"][3].get<double>()};
        const int pw = pic.value("w", 0);
        const int ph = pic.value("h", 0);
        // Exclude tiny ornaments/icons and low-resolution decorative assets.
        if (box[2] < 72.0 || box[3] < 28.0 || pw < 120 || ph < 48) {
            continue;
        }
        // Exclude full-page backgrounds and page-1 large cover inserts.
        const double area = box[2] * box[3];
        if (area > page_area * 0.60) {
            continue;
        }
        if (page_num == 1 && area > page_area * 0.45) {
            continue;
        }
        // Exclude images already overlaid by valid searchable text (e.g. shaded callout frames).
        int overlapped_words = 0;
        for (const auto& w : words) {
            if (!w.contains("box") || w["box"].size() != 4) {
                continue;
            }
            const double cx = w["box"][0].get<double>() + w["box"][2].get<double>() * 0.5;
            const double cy = w["box"][1].get<double>() + w["box"][3].get<double>() * 0.5;
            if (box_contains_point(box, cx, cy, 2.0)) {
                ++overlapped_words;
                if (overlapped_words >= 3) {
                    break;
                }
            }
        }
        if (overlapped_words >= 3) {
            continue;
        }

        // Fast zero-Tesseract stroke pre-check so pure illustrations / charts never trigger
        // Tesseract startup on searchable books.
        PixPtr preview = OcrRuntime::render_region_gray(doc, page_num, box, 144);
        if (!gray_pix_may_contain_text(preview.get())) {
            continue;
        }

        out.push_back(EmbeddedImageCandidate{page_num, pic.value("id", ""), box});
    }
    return out;
}

nlohmann::json build_ocr_image_block_json(const EmbeddedImageCandidate& candidate,
                                          const OcrTextBlockResult& block) {
    // Group recognized words into paragraphs preserving Tesseract's para_id order.
    std::vector<int> para_order;
    std::map<int, std::vector<const OcrWord*>> by_para;
    for (const OcrWord& w : block.words) {
        if (!by_para.contains(w.para_id)) {
            para_order.push_back(w.para_id);
        }
        by_para[w.para_id].push_back(&w);
    }

    nlohmann::json paragraphs = nlohmann::json::array();
    for (int pid : para_order) {
        std::string text;
        nlohmann::json words_json = nlohmann::json::array();
        std::string para_lang = block.fb2_lang;
        for (const OcrWord* w : by_para[pid]) {
            if (!text.empty()) {
                text.push_back(' ');
            }
            text += w->text;
            if (!w->lang.empty()) {
                para_lang = w->lang;
            }
            words_json.push_back({{"t", w->text},
                                  {"box", {w->box[0], w->box[1], w->box[2], w->box[3]}},
                                  {"f", "ocr"},
                                  {"s", w->font_size},
                                  {"c", "#000000"},
                                  {"base", w->box[1] + w->box[3] * 0.85},
                                  {"lang", w->lang},
                                  {"conf", static_cast<int>(std::lround(w->conf))}});
        }
        if (!text.empty()) {
            paragraphs.push_back(
                {{"text", text}, {"lang", para_lang}, {"words", std::move(words_json)}});
        }
    }

    return nlohmann::json{
        {"pictureId", candidate.picture_id},
        {"box",
         {candidate.box_pts[0], candidate.box_pts[1], candidate.box_pts[2], candidate.box_pts[3]}},
        {"lang", block.fb2_lang},
        {"meanConf", std::round(block.mean_conf * 10.0) / 10.0},
        {"paragraphs", std::move(paragraphs)},
    };
}

nlohmann::json crop_scanned_inline_illustrations(
    PDFDoc& doc, const OcrPageResult& res, int jpeg_quality, const std::filesystem::path& out_dir,
    std::map<std::string, nlohmann::json>& prewritten_pictures) {
    nlohmann::json pictures = nlohmann::json::array();
    if (!res.usable || res.page_width_pts <= 1.0 || res.page_height_pts <= 1.0) {
        return pictures;
    }

    const double page_area = res.page_width_pts * res.page_height_pts;
    auto is_valid_region = [&](const OcrImageRegion& reg) -> bool {
        const double area = reg.pt_box[2] * reg.pt_box[3];
        if (reg.pt_box[2] < 72.0 || reg.pt_box[3] < 54.0) {
            return false;
        }
        if (area < page_area * 0.03 || area > page_area * 0.65) {
            return false;
        }
        // Reject regions significantly overlapping recognized OCR text words.
        int overlapped = 0;
        for (const OcrWord& w : res.words) {
            const double cx = w.box[0] + w.box[2] * 0.5;
            const double cy = w.box[1] + w.box[3] * 0.5;
            if (box_contains_point(reg.pt_box, cx, cy, 1.0)) {
                ++overlapped;
                if (overlapped >= 3) {
                    return false;
                }
            }
        }
        return true;
    };

    std::vector<OcrImageRegion> candidates;
    for (const OcrImageRegion& reg : res.image_regions) {
        if (is_valid_region(reg)) {
            candidates.push_back(reg);
        }
    }

    PixPtr rgb = OcrRuntime::render_page_rgb(doc, res.page, res.dpi);
    if (!rgb) {
        return pictures;
    }
    PixPtr upright;
    const int quads = ((res.rotation_cw / 90) % 4 + 4) % 4;
    if (quads != 0) {
        upright.reset(pixRotateOrth(rgb.get(), quads));
    } else {
        upright.reset(pixClone(rgb.get()));
    }
    if (!upright) {
        return pictures;
    }

    // Filter Tesseract candidates by real artwork content, and add fallback non-text artwork bands
    // if Tesseract's grayscale segmentation missed a colorful inline illustration.
    std::vector<OcrImageRegion> kept;
    for (const OcrImageRegion& reg : candidates) {
        if (rgb_region_has_artwork(upright.get(), reg.px_box)) {
            kept.push_back(reg);
        }
    }
    if (kept.empty()) {
        for (const OcrImageRegion& fb : find_nontext_artwork_bands(upright.get(), res)) {
            if (is_valid_region(fb)) {
                kept.push_back(fb);
            }
        }
    }
    if (kept.empty()) {
        return pictures;
    }

    // Deduplicate overlapping boxes and sort top-to-bottom.
    std::sort(kept.begin(), kept.end(), [](const OcrImageRegion& a, const OcrImageRegion& b) {
        return a.pt_box[1] < b.pt_box[1];
    });
    std::vector<OcrImageRegion> deduped;
    for (const OcrImageRegion& reg : kept) {
        bool dup = false;
        for (const OcrImageRegion& prev : deduped) {
            if (boxes_overlap_ratio(reg.pt_box, prev.pt_box) > 0.5) {
                dup = true;
                break;
            }
        }
        if (!dup) {
            deduped.push_back(reg);
        }
    }

    int crop_index = 0;
    for (const OcrImageRegion& reg : deduped) {
        const std::string pic_id =
            "ocr-p" + std::to_string(res.page) + "-" + std::to_string(++crop_index);
        const std::string rel_file = "pictures/" + pic_id + ".jpg";
        std::string content_type;
        int out_w = 0;
        int out_h = 0;
        if (OcrRuntime::save_pix_crop(upright.get(), 0, reg.px_box, jpeg_quality,
                                      out_dir / rel_file, content_type, out_w, out_h)) {
            pictures.push_back(
                {{"id", pic_id},
                 {"box", {reg.pt_box[0], reg.pt_box[1], reg.pt_box[2], reg.pt_box[3]}},
                 {"w", out_w},
                 {"h", out_h},
                 {"jpeg", true},
                 {"ocrCrop", true}});
            prewritten_pictures.emplace(pic_id, nlohmann::json{{"event", "picture"},
                                                               {"id", pic_id},
                                                               {"file", rel_file},
                                                               {"contentType", content_type},
                                                               {"width", out_w},
                                                               {"height", out_h}});
        }
    }
    return pictures;
}

}  // namespace mfbe::pdf_reader
