// Feature 016 (D19, D20, DP-8; tasks T047, T062): each page's kind, and a page drawn as a picture.
// A page that is only a picture is drawn at 72 dpi in grey: rows of dark pixels at a steady spacing
// (at least six) mean printed text without a text layer; almost no dark pixels, a blank page.
// Nothing is read: the picture is measured.
#include "pdf/reader/reader.hpp"

#include <mfbe/images.hpp>

#include <PDFDoc.h>
#include <SplashOutputDev.h>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <splash/SplashBitmap.h>
#include <vector>

namespace mfbe::pdf_reader {

namespace {

enum class Look { blank, text, picture };

Look look_of(PDFDoc& doc, int n) {
    SplashColor white = {255, 255, 255, 0};
    SplashOutputDev device(splashModeMono8, 4, white);
    device.startDoc(&doc);
    doc.displayPage(&device, n, 72, 72, 0, false, true, false);
    SplashBitmap* bitmap = device.getBitmap();
    if (bitmap == nullptr || bitmap->getWidth() <= 0 || bitmap->getHeight() <= 0) {
        return Look::blank;
    }
    const int width = bitmap->getWidth();
    const int height = bitmap->getHeight();
    const unsigned char* data = bitmap->getDataPtr();
    // The page's edges - a scan's shadows, a frame - are left out of the measure.
    const int left = width / 20;
    const int right = width - width / 20;
    std::vector<int> rows(static_cast<std::size_t>(height), 0);
    long dark = 0;
    long bright = 0;
    for (int y = 0; y < height; ++y) {
        const unsigned char* row = data + static_cast<std::size_t>(y) * bitmap->getRowSize();
        for (int x = left; x < right; ++x) {
            if (row[x] < 128) {
                ++rows[static_cast<std::size_t>(y)];
            } else if (row[x] > 200) {
                ++bright;
            }
        }
        dark += rows[static_cast<std::size_t>(y)];
    }
    if (dark < static_cast<long>(width) * height / 200) {
        return Look::blank;
    }
    const long inner_pixels = static_cast<long>(std::max(1, right - left)) * height;
    const bool white_paper = bright * 100 >= inner_pixels * 65 && dark * 100 <= inner_pixels * 20;
    struct Band {
        int top = 0;
        int bottom = 0;
        int from = 0;
        int to = 0;
    };
    auto count_text_lines = [white_paper](const std::vector<Band>& bands,
                                          int span_limit) -> std::size_t {
        // Printed text: at least six lines one after another at a steady spacing, most of them
        // reaching as far as the longest - a column of text.
        std::size_t best = 0;
        for (std::size_t first = 0; first + 1 < bands.size(); ++first) {
            std::size_t last = first + 1;
            while (last + 1 < bands.size()) {
                const int gap = bands[last].top - bands[last - 1].top;
                const int next = bands[last + 1].top - bands[last].top;
                if (gap < 4 || std::abs(next - gap) > 0.3 * std::max(next, gap)) {
                    break;
                }
                ++last;
            }
            const std::size_t lines = last - first + 1;
            if (lines < 6 || lines <= best) {
                continue;
            }
            int longest = 0;
            for (std::size_t i = first; i <= last; ++i) {
                longest = std::max(longest, bands[i].to - bands[i].from);
            }
            std::size_t full = 0;
            for (std::size_t i = first; i <= last; ++i) {
                full += bands[i].to - bands[i].from >= longest * 0.7 ? 1 : 0;
            }
            if (full * 10 >= lines * 6) {
                best = lines;
            }
        }
        if (best >= 6 || !white_paper) {
            return best;
        }
        // On a white-paper page split into short paragraphs (or separated by an inline
        // illustration), aggregate thin text-line runs (>= 2 lines) using band midpoints (immune
        // to ascender/descender jitter) that share a consistent body line leading.
        auto mid = [](const Band& b) { return (b.top + b.bottom) / 2; };
        struct RunInfo {
            std::size_t first = 0;
            std::size_t last = 0;
            int leading = 0;
        };
        std::vector<RunInfo> para_runs;
        for (std::size_t first = 0; first + 1 < bands.size(); ++first) {
            if (bands[first].bottom - bands[first].top + 1 > 28) {
                continue;
            }
            std::size_t last = first;
            int gap_sum = 0;
            int gap_cnt = 0;
            while (last + 1 < bands.size()) {
                if (bands[last + 1].bottom - bands[last + 1].top + 1 > 28) {
                    break;
                }
                const int next_gap = mid(bands[last + 1]) - mid(bands[last]);
                if (next_gap < 5 || next_gap > 36) {
                    break;
                }
                if (gap_cnt > 0) {
                    const int avg = gap_sum / gap_cnt;
                    if (std::abs(next_gap - avg) > 0.35 * std::max(next_gap, avg)) {
                        break;
                    }
                }
                gap_sum += next_gap;
                ++gap_cnt;
                ++last;
            }
            if (last > first && gap_cnt > 0) {
                int run_longest = 0;
                for (std::size_t i = first; i <= last; ++i) {
                    run_longest = std::max(run_longest, bands[i].to - bands[i].from);
                }
                if (run_longest >= span_limit / 3) {
                    para_runs.push_back({first, last, gap_sum / gap_cnt});
                    first = last;
                }
            }
        }
        for (std::size_t i = 0; i < para_runs.size(); ++i) {
            std::size_t total_lines = 0;
            int longest = 0;
            for (std::size_t j = 0; j < para_runs.size(); ++j) {
                const int a = para_runs[i].leading;
                const int b = para_runs[j].leading;
                if (std::abs(a - b) <= 0.30 * std::max(a, b)) {
                    total_lines += para_runs[j].last - para_runs[j].first + 1;
                    for (std::size_t k = para_runs[j].first; k <= para_runs[j].last; ++k) {
                        longest = std::max(longest, bands[k].to - bands[k].from);
                    }
                }
            }
            if (total_lines < 4 || longest < span_limit / 3) {
                continue;
            }
            std::size_t full = 0;
            for (std::size_t j = 0; j < para_runs.size(); ++j) {
                const int a = para_runs[i].leading;
                const int b = para_runs[j].leading;
                if (std::abs(a - b) <= 0.30 * std::max(a, b)) {
                    for (std::size_t k = para_runs[j].first; k <= para_runs[j].last; ++k) {
                        if (bands[k].to - bands[k].from >= longest * 0.6) {
                            ++full;
                        }
                    }
                }
            }
            if (full * 10 >= total_lines * 5) {
                best = std::max<std::size_t>(best, 6);
            }
        }
        return best;
    };

    // Horizontal bands (normal 0° / 180° scans).
    std::vector<Band> hbands;
    bool inside = false;
    const int h_threshold = std::max(1, width / 200);
    for (int y = 0; y < height; ++y) {
        const bool inked = rows[static_cast<std::size_t>(y)] > h_threshold;
        if (inked && !inside) {
            hbands.push_back({y, y, right, left});
        }
        if (inked) {
            const unsigned char* row = data + static_cast<std::size_t>(y) * bitmap->getRowSize();
            Band& band = hbands.back();
            band.bottom = y;
            for (int x = left; x < right; ++x) {
                if (row[x] < 128) {
                    band.from = std::min(band.from, x);
                    band.to = std::max(band.to, x);
                }
            }
        }
        inside = inked;
    }
    if (count_text_lines(hbands, right - left) >= 6) {
        return Look::text;
    }

    // Vertical bands: catches 90°/270° rotated text scans whose printed lines run vertically.
    const int top = height / 20;
    const int bottom = height - height / 20;
    const int v_threshold = std::max(1, height / 200);
    std::vector<Band> vbands;
    inside = false;
    for (int x = 0; x < width; ++x) {
        int col_dark = 0;
        int col_from = bottom;
        int col_to = top;
        for (int y = top; y < bottom; ++y) {
            const unsigned char* row = data + static_cast<std::size_t>(y) * bitmap->getRowSize();
            if (row[x] < 128) {
                ++col_dark;
                col_from = std::min(col_from, y);
                col_to = std::max(col_to, y);
            }
        }
        const bool inked = col_dark > v_threshold;
        if (inked && !inside) {
            vbands.push_back({x, x, col_from, col_to});
        } else if (inked) {
            Band& band = vbands.back();
            band.bottom = x;
            band.from = std::min(band.from, col_from);
            band.to = std::max(band.to, col_to);
        }
        inside = inked;
    }
    return count_text_lines(vbands, bottom - top) >= 6 ? Look::text : Look::picture;
}

}  // namespace

std::string page_kind(PDFDoc& doc, int n, const nlohmann::json& page) {
    const auto words = page.value("words", nlohmann::json::array());
    const bool has_words = !words.empty();
    const double page_w = page.value("width", 0.0);
    const double page_h = page.value("height", 0.0);
    const double area = page_w * page_h;
    bool large = false;
    for (const auto& picture : page.value("pictures", nlohmann::json::array())) {
        const auto& box = picture["box"];
        if (box.size() == 4 && box[2].get<double>() * box[3].get<double>() > area * 0.6) {
            large = true;
        }
    }
    if (has_words) {
        if (!large) {
            return "text";
        }
        // Feature 020 (T034, research.md R4): a scanned page carrying ONLY stray searchable
        // furniture (e.g. a lone page number or running header: <= 15 tokens or < 15% vertical
        // span) while its raster image shows printed body text classifies as `pictureShowingText`.
        // Garbled layers stay `pictureWithLayer` here so text.cpp's readability check marks them
        // `garbled`, and clean ABBYY-style OCR layers (> 15 tokens and >= 15% span) stay untouched.
        const Readability r = readability(words);
        const bool is_garbled =
            r.tokens >= kGarbledPageTokens && r.plain < kGarbledShare * r.tokens;
        if (!is_garbled) {
            double min_y = page_h;
            double max_y = 0.0;
            for (const auto& w : words) {
                if (w.contains("box") && w["box"].size() == 4) {
                    const double y0 = w["box"][1].get<double>();
                    const double h = w["box"][3].get<double>();
                    min_y = std::min(min_y, y0);
                    max_y = std::max(max_y, y0 + h);
                }
            }
            const double v_coverage =
                (page_h > 1.0 && max_y > min_y) ? (max_y - min_y) / page_h : 0.0;
            if ((words.size() <= 15 || v_coverage < 0.15) && look_of(doc, n) == Look::text) {
                return "pictureShowingText";
            }
        }
        return "pictureWithLayer";
    }
    if (!large && page.value("pictures", nlohmann::json::array()).empty()) {
        return "blank";
    }
    switch (look_of(doc, n)) {
        case Look::blank:
            return "blank";
        case Look::text:
            return "pictureShowingText";
        default:
            return "pictureWithoutText";
    }
}

}  // namespace mfbe::pdf_reader

namespace mfbe::pdf_reader {

// Feature 016 (D20, FR-060; tasks T062): a page drawn as a picture, for a later OCR - the editor's
// own PDF library draws it, nothing reads it.
bool render_page(PDFDoc& doc, int n, int dpi, const std::filesystem::path& file, int& width,
                 int& height) {
    if (n < 1 || n > doc.getNumPages() || dpi < 18 || dpi > 600) {
        return false;
    }
    SplashColor white = {255, 255, 255, 0};
    SplashOutputDev device(splashModeRGB8, 4, white);
    device.startDoc(&doc);
    doc.displayPage(&device, n, dpi, dpi, 0, false, true, false);
    SplashBitmap* splash = device.getBitmap();
    if (splash == nullptr || splash->getWidth() <= 0 || splash->getHeight() <= 0) {
        return false;
    }
    images::Bitmap bitmap;
    bitmap.width = width = splash->getWidth();
    bitmap.height = height = splash->getHeight();
    bitmap.rgba.resize(bitmap.pixel_count() * 4);
    const unsigned char* data = splash->getDataPtr();
    for (int y = 0; y < height; ++y) {
        const unsigned char* row = data + static_cast<std::size_t>(y) * splash->getRowSize();
        for (int x = 0; x < width; ++x) {
            std::uint8_t* px = &bitmap.rgba[(static_cast<std::size_t>(y) * width + x) * 4];
            px[0] = row[x * 3];
            px[1] = row[x * 3 + 1];
            px[2] = row[x * 3 + 2];
            px[3] = 255;
        }
    }
    const std::string bytes = images::encode_png(bitmap);
    std::ofstream out(file, std::ios::binary);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    return static_cast<bool>(out);
}

bool render_cover_jpeg(PDFDoc& doc, int target_width, int quality,
                       const std::filesystem::path& file, int& width, int& height) {
    if (doc.getNumPages() < 1 || target_width < 64 || target_width > 4096) {
        return false;
    }
    double page_w_pt = doc.getPageCropWidth(1);
    double page_h_pt = doc.getPageCropHeight(1);
    if (page_w_pt <= 0.0 || page_h_pt <= 0.0) {
        page_w_pt = doc.getPageMediaWidth(1);
        page_h_pt = doc.getPageMediaHeight(1);
    }
    if (page_w_pt <= 0.0 || page_h_pt <= 0.0) {
        return false;
    }
    int rot = doc.getPageRotate(1) % 360;
    if (rot < 0) {
        rot += 360;
    }
    if (rot == 90 || rot == 270) {
        std::swap(page_w_pt, page_h_pt);
    }
    // Match Maxima Library's PdfFilePictures.php (1024 px wide JPEG of page 1 over white), while
    // capping extreme strip heights so hostile page boxes cannot exhaust memory.
    constexpr double kMaxCoverHeight = 4096.0;
    double dpi = 72.0 * (static_cast<double>(target_width) + 0.5) / page_w_pt;
    const double max_dpi_for_height = 72.0 * kMaxCoverHeight / page_h_pt;
    dpi = std::min(dpi, max_dpi_for_height);
    dpi = std::clamp(dpi, 18.0, 600.0);

    SplashColor white = {255, 255, 255, 0};
    SplashOutputDev device(splashModeRGB8, 4, white);
    device.startDoc(&doc);
    doc.displayPage(&device, 1, dpi, dpi, 0, false, true, false);
    SplashBitmap* splash = device.getBitmap();
    if (splash == nullptr || splash->getWidth() <= 0 || splash->getHeight() <= 0) {
        return false;
    }
    images::Bitmap bitmap;
    bitmap.width = splash->getWidth();
    bitmap.height = splash->getHeight();
    bitmap.rgba.resize(bitmap.pixel_count() * 4);
    const unsigned char* data = splash->getDataPtr();
    for (int y = 0; y < bitmap.height; ++y) {
        const unsigned char* row = data + static_cast<std::size_t>(y) * splash->getRowSize();
        for (int x = 0; x < bitmap.width; ++x) {
            std::uint8_t* px = &bitmap.rgba[(static_cast<std::size_t>(y) * bitmap.width + x) * 4];
            px[0] = row[x * 3];
            px[1] = row[x * 3 + 1];
            px[2] = row[x * 3 + 2];
            px[3] = 255;
        }
    }
    if (bitmap.width > target_width || bitmap.height > static_cast<int>(kMaxCoverHeight)) {
        bitmap = images::scale_to_fit(bitmap, target_width, static_cast<int>(kMaxCoverHeight));
    }
    width = bitmap.width;
    height = bitmap.height;
    const std::string bytes = images::encode_jpeg(bitmap, std::clamp(quality, 1, 100));
    std::ofstream out(file, std::ios::binary);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    return static_cast<bool>(out);
}

}  // namespace mfbe::pdf_reader
