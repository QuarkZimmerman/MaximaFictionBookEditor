// Feature 016 (D16, DP-7; tasks T037): drawings and form fields. The lines and shapes a page paints
// are boxed; those that only rule, frame or underline text are left out - thin lines alone, and
// frames or backgrounds that hold words; the rest are joined into areas when they lie within 12
// points of each other, and each area of at least 36 x 36 points becomes a drawing, drawn at 200
// dpi as PNG when the import takes it. Form fields stand in labelled rows - each with the text
// before it on its line - and are given as such; any other form is drawn like a drawing, with the
// values it shows.
#include "pdf/reader/reader.hpp"

#include <mfbe/images.hpp>

#include <Annot.h>
#include <Form.h>
#include <GfxState.h>
#include <OutputDev.h>
#include <PDFDoc.h>
#include <Page.h>
#include <SplashOutputDev.h>
#include <UTF.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <map>
#include <splash/SplashBitmap.h>
#include <string>
#include <vector>

namespace mfbe::pdf_reader {

namespace {

struct Box {
    double x0, y0, x1, y1;
    double width() const { return x1 - x0; }
    double height() const { return y1 - y0; }
    bool near(const Box& o, double by) const {
        return x0 - by <= o.x1 && o.x0 - by <= x1 && y0 - by <= o.y1 && o.y0 - by <= y1;
    }
    void join(const Box& o) {
        x0 = std::min(x0, o.x0);
        y0 = std::min(y0, o.y0);
        x1 = std::max(x1, o.x1);
        y1 = std::max(y1, o.y1);
    }
    bool holds(double x, double y) const { return x >= x0 && x <= x1 && y >= y0 && y <= y1; }
};

constexpr double kThin = 1.5;      // a line this thin or less rules, frames or underlines
constexpr double kJoin = 12.0;     // shapes this close belong to one drawing
constexpr double kMinSide = 36.0;  // a drawing's least width and height
constexpr double kMargin = 10.0;   // around a drawing: its labels
constexpr int kMaxDrawings = 2000;

// The drawings found so far, by id, for the requests after the read (contracts/pdf-reader.md).
std::map<std::string, std::pair<int, Box>> g_drawings;
int g_count = 0;
int g_left_out = 0;

class PathBoxes : public OutputDev {
public:
    std::vector<Box> solid;
    std::vector<Box> thin;
    bool upsideDown() override { return true; }
    bool useDrawChar() override { return false; }
    bool interpretType3Chars() override { return false; }
    bool needNonText() override { return true; }
    void stroke(GfxState* state) override { add(state, false); }
    void fill(GfxState* state) override { add(state, true); }
    void eoFill(GfxState* state) override { add(state, true); }

private:
    void add(GfxState* state, bool filled) {
        const GfxPath* path = state->getPath();
        Box box{1e9, 1e9, -1e9, -1e9};
        for (int i = 0; i < path->getNumSubpaths(); ++i) {
            const GfxSubpath* sub = path->getSubpath(i);
            for (int j = 0; j < sub->getNumPoints(); ++j) {
                double x, y;
                state->transform(sub->getX(j), sub->getY(j), &x, &y);
                box.join({x, y, x, y});
            }
        }
        if (box.x1 < box.x0) {
            return;
        }
        if (!filled) {
            const double half = state->getTransformedLineWidth() / 2;
            box = {box.x0 - half, box.y0 - half, box.x1 + half, box.y1 + half};
        }
        (box.width() <= kThin || box.height() <= kThin ? thin : solid).push_back(box);
    }
};

/// The page's words as boxes, from page-<n>.json's words.
std::vector<Box> word_boxes(const nlohmann::json& words) {
    std::vector<Box> out;
    for (const auto& w : words) {
        const auto& b = w["box"];
        out.push_back({b[0].get<double>(), b[1].get<double>(),
                       b[0].get<double>() + b[2].get<double>(),
                       b[1].get<double>() + b[3].get<double>()});
    }
    return out;
}

/// Joins the boxes that lie within `by` of each other, until none do.
std::vector<Box> joined(std::vector<Box> boxes, double by) {
    for (bool changed = true; changed;) {
        changed = false;
        for (std::size_t i = 0; i < boxes.size() && !changed; ++i) {
            for (std::size_t j = i + 1; j < boxes.size(); ++j) {
                if (boxes[i].near(boxes[j], by)) {
                    boxes[i].join(boxes[j]);
                    boxes.erase(boxes.begin() + static_cast<std::ptrdiff_t>(j));
                    changed = true;
                    break;
                }
            }
        }
    }
    return boxes;
}

}  // namespace

nlohmann::json record_drawings(PDFDoc& doc, int n, nlohmann::json& page) {
    const std::vector<Box> words = word_boxes(page["words"]);
    const double page_area = page.value("width", 0.0) * page.value("height", 0.0);
    PathBoxes paths;
    doc.displayPage(&paths, n, 72, 72, 0, true, false, false);
    // A frame or a background holds words (a border, a shaded box, a table's cells): it is not a
    // drawing.
    const auto holds_words = [&words](const Box& b) {
        return std::any_of(words.begin(), words.end(), [&b](const Box& w) {
            return b.holds((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2) &&
                   b.width() * b.height() > 4 * (w.width() * w.height());
        });
    };
    std::vector<Box> shapes;
    for (const Box& b : paths.solid) {
        if (!holds_words(b) && b.width() * b.height() < page_area * 0.9) {
            shapes.push_back(b);
        }
    }
    std::vector<Box> areas = joined(shapes, kJoin);
    // Thin lines next to a drawing are its own (a chart's axes); alone they rule or underline text.
    for (Box& area : areas) {
        for (const Box& line : paths.thin) {
            if (area.near(line, kJoin)) {
                area.join(line);
            }
        }
    }
    areas = joined(areas, 0);
    // Form fields (D16): each with its label, the words before it on its line.
    nlohmann::json fields = nlohmann::json::array();
    if (Page* p = doc.getPage(n); p != nullptr && p->getAnnots() != nullptr) {
        Form* form = doc.getCatalog() ? doc.getCatalog()->getForm() : nullptr;
        const double height = doc.getPageCropHeight(n);
        for (const auto& shared : p->getAnnots()->getAnnots()) {
            if (shared->getType() != Annot::typeWidget) {
                continue;
            }
            double x1, y1, x2, y2;
            shared->getRect(&x1, &y1, &x2, &y2);
            const Box box{x1, height - y2, x2, height - y1};
            std::string value;
            FormWidget* field = form ? form->findWidgetByRef(shared->getRef()) : nullptr;
            if (field && field->getType() == formText) {
                if (const GooString* content = static_cast<FormWidgetText*>(field)->getContent()) {
                    value = TextStringToUtf8(content->toStr());
                    while (!value.empty() && value.back() == '\0') {
                        value.pop_back();
                    }
                }
            }
            std::string label;
            Box label_box{1e9, 1e9, -1e9, -1e9};
            for (std::size_t i = 0; i < words.size(); ++i) {
                const Box& w = words[i];
                const double middle = (w.y0 + w.y1) / 2;
                if (w.x1 <= box.x0 + 1 && middle >= box.y0 && middle <= box.y1) {
                    label += (label.empty() ? "" : " ") + page["words"][i].value("t", "");
                    label_box.join(w);
                }
            }
            fields.push_back(
                {{"box", {box.x0, box.y0, box.width(), box.height()}},
                 {"label", label},
                 {"value", value},
                 {"labelBox", label_box.x1 < label_box.x0
                                  ? nlohmann::json::array()
                                  : nlohmann::json{label_box.x0, label_box.y0, label_box.width(),
                                                   label_box.height()}}});
        }
    }
    // Labelled rows: every field has a label, and no two stand on one line.
    bool rows = !fields.empty();
    for (std::size_t i = 0; i < fields.size() && rows; ++i) {
        rows = !fields[i]["label"].get<std::string>().empty();
        for (std::size_t j = i + 1; j < fields.size() && rows; ++j) {
            const double a = fields[i]["box"][1].get<double>(),
                         b = fields[j]["box"][1].get<double>();
            rows = std::abs(a - b) > fields[i]["box"][3].get<double>() / 2;
        }
    }
    if (rows) {
        page["forms"] = fields;
    } else if (!fields.empty()) {
        Box area{1e9, 1e9, -1e9, -1e9};
        for (const auto& f : fields) {
            const auto& b = f["box"];
            area.join({b[0].get<double>(), b[1].get<double>(),
                       b[0].get<double>() + b[2].get<double>(),
                       b[1].get<double>() + b[3].get<double>()});
            if (!f["labelBox"].empty()) {
                const auto& l = f["labelBox"];
                area.join({l[0].get<double>(), l[1].get<double>(),
                           l[0].get<double>() + l[2].get<double>(),
                           l[1].get<double>() + l[3].get<double>()});
            }
        }
        areas.push_back(area);
        page["forms"] = nlohmann::json::array();
    }
    nlohmann::json out = nlohmann::json::array();
    const nlohmann::json pictures = page.value("pictures", nlohmann::json::array());
    int k = 0;
    for (const Box& area : areas) {
        if (area.width() < kMinSide || area.height() < kMinSide) {
            continue;
        }
        if (g_count >= kMaxDrawings) {
            ++g_left_out;
            continue;
        }
        // Lines framing a picture belong to the picture.
        bool framed = false;
        for (const auto& pic : pictures) {
            const auto& b = pic["box"];
            const Box p{b[0].get<double>(), b[1].get<double>(),
                        b[0].get<double>() + b[2].get<double>(),
                        b[1].get<double>() + b[3].get<double>()};
            const double ix = std::max(0.0, std::min(p.x1, area.x1) - std::max(p.x0, area.x0));
            const double iy = std::max(0.0, std::min(p.y1, area.y1) - std::max(p.y0, area.y0));
            framed = framed || ix * iy > 0.5 * area.width() * area.height();
        }
        if (framed) {
            continue;
        }
        const Box with{std::max(0.0, area.x0 - kMargin), std::max(0.0, area.y0 - kMargin),
                       std::min(page.value("width", area.x1), area.x1 + kMargin),
                       std::min(page.value("height", area.y1), area.y1 + kMargin)};
        const std::string id = "d" + std::to_string(n) + "-" + std::to_string(++k);
        g_drawings[id] = {n, with};
        ++g_count;
        out.push_back(
            {{"id", id},
             {"box",
              {std::round(with.x0 * 10) / 10, std::round(with.y0 * 10) / 10,
               std::round(with.width() * 10) / 10, std::round(with.height() * 10) / 10}}});
    }
    return out;
}

int drawings_left_out() {
    return g_left_out;
}

nlohmann::json write_drawing(PDFDoc& doc, const std::string& id, const Options& options) {
    const auto it = g_drawings.find(id);
    if (it == g_drawings.end()) {
        return {{"event", "picture-failed"}, {"id", id}};
    }
    const int n = it->second.first;
    const Box& box = it->second.second;
    constexpr double kDpi = 200.0;
    const double scale = kDpi / 72.0;
    SplashColor white = {255, 255, 255, 0};
    SplashOutputDev device(splashModeRGB8, 4, white);
    device.startDoc(&doc);
    doc.displayPageSlice(&device, n, kDpi, kDpi, 0, true, false, false,
                         static_cast<int>(box.x0 * scale), static_cast<int>(box.y0 * scale),
                         static_cast<int>(std::ceil(box.width() * scale)),
                         static_cast<int>(std::ceil(box.height() * scale)));
    SplashBitmap* splash = device.getBitmap();
    if (splash == nullptr || splash->getWidth() <= 0 || splash->getHeight() <= 0) {
        return {{"event", "picture-failed"}, {"id", id}};
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
    const std::string file = "pictures/" + id + ".png";
    std::filesystem::create_directories(options.out / "pictures");
    const std::string bytes = images::encode_png(bitmap);
    std::ofstream(options.out / file, std::ios::binary)
        .write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    return {{"event", "picture"},    {"id", id},
            {"file", file},          {"contentType", "image/png"},
            {"width", bitmap.width}, {"height", bitmap.height}};
}

}  // namespace mfbe::pdf_reader
