// Feature 016 (D19, D20, DP-8; tasks T047): each page's kind. A page that is only a picture is
// drawn at 50 dpi in grey: rows of dark pixels at a steady spacing (at least six) mean printed text
// without a text layer; almost no dark pixels, a blank page. Nothing is read: the picture is
// measured.
#include "pdf/reader/reader.hpp"

#include <PDFDoc.h>
#include <SplashOutputDev.h>
#include <algorithm>
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
    std::vector<int> rows(static_cast<std::size_t>(height), 0);
    long dark = 0;
    for (int y = 0; y < height; ++y) {
        const unsigned char* row = data + static_cast<std::size_t>(y) * bitmap->getRowSize();
        for (int x = 0; x < width; ++x) {
            if (row[x] < 128) {
                ++rows[static_cast<std::size_t>(y)];
            }
        }
        dark += rows[static_cast<std::size_t>(y)];
    }
    if (dark < static_cast<long>(width) * height / 200) {
        return Look::blank;
    }
    // Bands of rows with ink, separated by rows without: lines of print repeat at a steady spacing.
    std::vector<int> starts;
    bool inside = false;
    const int threshold = std::max(1, width / 200);
    for (int y = 0; y < height; ++y) {
        const bool inked = rows[static_cast<std::size_t>(y)] > threshold;
        if (inked && !inside) {
            starts.push_back(y);
        }
        inside = inked;
    }
    if (starts.size() < 6) {
        return Look::picture;
    }
    std::vector<int> gaps;
    for (std::size_t i = 1; i < starts.size(); ++i) {
        gaps.push_back(starts[i] - starts[i - 1]);
    }
    std::vector<int> sorted = gaps;
    std::sort(sorted.begin(), sorted.end());
    const int median = sorted[sorted.size() / 2];
    int steady = 0;
    for (int gap : gaps) {
        if (median > 0 && gap >= median * 0.7 && gap <= median * 1.3) {
            ++steady;
        }
    }
    return steady >= 5 && median >= 4 ? Look::text : Look::picture;
}

}  // namespace

std::string page_kind(PDFDoc& doc, int n, const nlohmann::json& page) {
    const bool words = !page.value("words", nlohmann::json::array()).empty();
    const double area = page.value("width", 0.0) * page.value("height", 0.0);
    bool large = false;
    for (const auto& picture : page.value("pictures", nlohmann::json::array())) {
        const auto& box = picture["box"];
        if (box.size() == 4 && box[2].get<double>() * box[3].get<double>() > area * 0.6) {
            large = true;
        }
    }
    if (words) {
        return large ? "pictureWithLayer" : "text";
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
