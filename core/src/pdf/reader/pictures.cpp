// Feature 016 (DP-6, contracts/page-model.md; tasks T018): the pictures a page places. The page
// model lists them with their boxes; a picture's file is written only when the import asks for it
// (scans place a picture on every page that the import never takes), by drawing that page again and
// catching it.
#include "mfbe/images.hpp"
#include "pdf/reader/reader.hpp"

#include <nlohmann/json.hpp>

#include <GfxState.h>
#include <OutputDev.h>
#include <PDFDoc.h>
#include <Stream.h>
#include <algorithm>
#include <fstream>
#include <set>

namespace mfbe::pdf_reader {

namespace {

constexpr long long kMaxPixels = 100'000'000;  // D27, DP-3

class PictureRecorder : public OutputDev {
public:
    PictureRecorder(int page, const Options* options, std::string capture)
        : page_(page), options_(options), capture_(std::move(capture)) {}

    nlohmann::json list = nlohmann::json::array();
    nlohmann::json captured;

    bool upsideDown() override { return true; }
    bool useDrawChar() override { return false; }
    bool interpretType3Chars() override { return false; }
    bool needNonText() override { return true; }

    void drawImage(GfxState* state, Object* ref, Stream* str, int width, int height,
                   GfxImageColorMap* map, bool, const int*, bool) override {
        handle(state, ref, str, width, height, map, nullptr, 0, 0, nullptr, false);
    }
    void drawMaskedImage(GfxState* state, Object* ref, Stream* str, int width, int height,
                         GfxImageColorMap* map, bool, Stream* mask, int mask_width, int mask_height,
                         bool invert, bool) override {
        handle(state, ref, str, width, height, map, mask, mask_width, mask_height, nullptr, invert);
    }
    void drawSoftMaskedImage(GfxState* state, Object* ref, Stream* str, int width, int height,
                             GfxImageColorMap* map, bool, Stream* mask, int mask_width,
                             int mask_height, GfxImageColorMap* mask_map, bool) override {
        handle(state, ref, str, width, height, map, mask, mask_width, mask_height, mask_map, false);
    }

private:
    void handle(GfxState* state, Object* ref, Stream* str, int width, int height,
                GfxImageColorMap* map, Stream* mask, int mask_width, int mask_height,
                GfxImageColorMap* mask_map, bool mask_invert) {
        const std::string id =
            (ref != nullptr && ref->isRef())
                ? "x" + std::to_string(ref->getRefNum()) + "-" + std::to_string(ref->getRefGen())
                : "i" + std::to_string(page_) + "-" + std::to_string(++inline_count_);
        double xs[4], ys[4];
        const double corners[4][2] = {{0, 0}, {1, 0}, {0, 1}, {1, 1}};
        for (int i = 0; i < 4; ++i) {
            state->transform(corners[i][0], corners[i][1], &xs[i], &ys[i]);
        }
        const double x0 = *std::min_element(xs, xs + 4), x1 = *std::max_element(xs, xs + 4);
        const double y0 = *std::min_element(ys, ys + 4), y1 = *std::max_element(ys, ys + 4);
        const bool jpeg = mask == nullptr && str->getKind() == strDCT &&
                          dynamic_cast<BaseStream*>(str->getNextStream()) != nullptr;
        list.push_back({{"id", id},
                        {"box", {x0, y0, x1 - x0, y1 - y0}},
                        {"w", width},
                        {"h", height},
                        {"jpeg", jpeg}});
        if (id == capture_ && captured.is_null()) {
            captured = write(id, str, width, height, map, mask, mask_width, mask_height, mask_map,
                             mask_invert, jpeg);
        }
    }

    nlohmann::json write(const std::string& id, Stream* str, int width, int height,
                         GfxImageColorMap* map, Stream* mask, int mask_width, int mask_height,
                         GfxImageColorMap* mask_map, bool mask_invert, bool jpeg) {
        if (width <= 0 || height <= 0 || static_cast<long long>(width) * height > kMaxPixels ||
            map == nullptr) {
            return {{"event", "picture-failed"}, {"id", id}, {"reason", "tooLarge"}};
        }
        std::string bytes;
        std::string type;
        if (jpeg) {
            Stream* raw = str->getNextStream();
            if (!raw->rewind()) {
                return {{"event", "picture-failed"}, {"id", id}};
            }
            for (int c; (c = raw->getChar()) != EOF;) {
                bytes.push_back(static_cast<char>(c));
            }
            raw->close();
            type = "image/jpeg";
        } else {
            images::Bitmap bitmap;
            bitmap.width = width;
            bitmap.height = height;
            bitmap.rgba.assign(static_cast<std::size_t>(width) * height * 4, 255);
            ImageStream image(str, width, map->getNumPixelComps(), map->getBits());
            if (!image.rewind()) {
                return {{"event", "picture-failed"}, {"id", id}};
            }
            std::set<std::uint32_t> colours;
            for (int y = 0; y < height; ++y) {
                const unsigned char* line = image.getLine();
                for (int x = 0; x < width && line != nullptr; ++x) {
                    GfxRGB rgb;
                    map->getRGB(line + static_cast<std::size_t>(x) * map->getNumPixelComps(), &rgb);
                    std::uint8_t* px = &bitmap.rgba[(static_cast<std::size_t>(y) * width + x) * 4];
                    px[0] = colToByte(rgb.r);
                    px[1] = colToByte(rgb.g);
                    px[2] = colToByte(rgb.b);
                    if (colours.size() <= 256) {
                        colours.insert((px[0] << 16) | (px[1] << 8) | px[2]);
                    }
                }
            }
            image.close();
            if (mask != nullptr && mask_width > 0 && mask_height > 0) {
                const int comps = mask_map ? mask_map->getNumPixelComps() : 1;
                const int bits = mask_map ? mask_map->getBits() : 1;
                ImageStream alpha(mask, mask_width, comps, bits);
                if (alpha.rewind()) {
                    std::vector<std::uint8_t> values(static_cast<std::size_t>(mask_width) *
                                                     mask_height);
                    for (int y = 0; y < mask_height; ++y) {
                        const unsigned char* line = alpha.getLine();
                        for (int x = 0; x < mask_width && line != nullptr; ++x) {
                            std::uint8_t v;
                            if (mask_map) {
                                GfxGray gray;
                                mask_map->getGray(line + static_cast<std::size_t>(x) * comps,
                                                  &gray);
                                v = colToByte(gray);
                            } else {
                                // A stencil mask: sample 1 marks what is masked out, unless
                                // inverted.
                                v = ((line[x] != 0) != mask_invert) ? 0 : 255;
                            }
                            values[static_cast<std::size_t>(y) * mask_width + x] = v;
                        }
                    }
                    alpha.close();
                    for (int y = 0; y < height; ++y) {
                        const int my =
                            static_cast<int>(static_cast<long long>(y) * mask_height / height);
                        for (int x = 0; x < width; ++x) {
                            const int mx =
                                static_cast<int>(static_cast<long long>(x) * mask_width / width);
                            bitmap.rgba[(static_cast<std::size_t>(y) * width + x) * 4 + 3] =
                                values[static_cast<std::size_t>(my) * mask_width + mx];
                        }
                    }
                }
            }
            bitmap.update_alpha_flag();
            if (bitmap.has_alpha || colours.size() <= 256) {
                bytes = images::encode_png(bitmap);
                type = "image/png";
            } else {
                bytes = images::encode_jpeg(bitmap, options_->quality);
                type = "image/jpeg";
            }
        }
        const std::string file = "pictures/" + id + (type == "image/png" ? ".png" : ".jpg");
        std::filesystem::create_directories(options_->out / "pictures");
        std::ofstream(options_->out / file, std::ios::binary) << bytes;
        return {{"event", "picture"},  {"id", id},       {"file", file},
                {"contentType", type}, {"width", width}, {"height", height}};
    }

    int page_;
    const Options* options_;
    std::string capture_;
    int inline_count_ = 0;
};

}  // namespace

nlohmann::json record_pictures(PDFDoc& doc, int n) {
    PictureRecorder recorder(n, nullptr, "");
    doc.displayPage(&recorder, n, 72, 72, 0, true, false, false);
    return std::move(recorder.list);
}

nlohmann::json write_picture(PDFDoc& doc, int n, const std::string& id, const Options& options) {
    if (n < 1 || n > doc.getNumPages()) {
        return {{"event", "picture-failed"}, {"id", id}};
    }
    PictureRecorder recorder(n, &options, id);
    doc.displayPage(&recorder, n, 72, 72, 0, true, false, false);
    if (recorder.captured.is_null()) {
        return {{"event", "picture-failed"}, {"id", id}};
    }
    return std::move(recorder.captured);
}

}  // namespace mfbe::pdf_reader
