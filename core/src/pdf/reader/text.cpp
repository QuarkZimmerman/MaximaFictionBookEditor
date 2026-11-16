// Feature 016 (DP-5, contracts/page-model.md; tasks T015): a page's words with their places and
// fonts.
#include "pdf/reader/reader.hpp"

#include <nlohmann/json.hpp>

#include <GlobalParams.h>
#include <Link.h>
#include <PDFDoc.h>
#include <Page.h>
#include <TextOutputDev.h>
#include <fstream>
#include <map>

namespace mfbe::pdf_reader {

nlohmann::json target_of(PDFDoc& doc, const LinkAction* action);

std::string write_page(PDFDoc& doc, int n, const Options& options, Readability* readable) {
    TextOutputDev device(nullptr, false, 0, false, false);
    doc.displayPage(&device, n, 72, 72, 0, true, false, false);
    std::unique_ptr<TextPage> text = device.takeText();
    const double height = doc.getPageCropHeight(n);
    nlohmann::json page{{"n", n},
                        {"width", doc.getPageCropWidth(n)},
                        {"height", height},
                        {"rotation", doc.getPageRotate(n)}};
    nlohmann::json words = nlohmann::json::array();
    nlohmann::json fonts = nlohmann::json::array();
    std::map<std::string, std::string> font_ids;
    if (text) {
        TextWordList list(text.get(), false);
        for (const TextWord* word : list.getWords()) {
            double x0, y0, x1, y1, r, g, b;
            word->getBBox(&x0, &y0, &x1, &y1);
            word->getColor(&r, &g, &b);
            const TextFontInfo* info = word->getLength() > 0 ? word->getFontInfo(0) : nullptr;
            const std::string name =
                info && info->getFontName() ? info->getFontName()->toStr() : "";
            auto [it, added] = font_ids.emplace(name, "f" + std::to_string(font_ids.size() + 1));
            if (added) {
                fonts.push_back({{"id", it->second},
                                 {"name", name},
                                 {"bold", info && info->isBold()},
                                 {"italic", info && info->isItalic()},
                                 {"mono", info && info->isFixedWidth()}});
            }
            char colour[8];
            std::snprintf(colour, sizeof colour, "#%02x%02x%02x", static_cast<int>(r * 255),
                          static_cast<int>(g * 255), static_cast<int>(b * 255));
            words.push_back({{"t", *word->getText()},
                             {"box", {x0, y0, x1 - x0, y1 - y0}},
                             {"f", it->second},
                             {"s", word->getFontSize()},
                             {"c", colour},
                             {"base", word->getBaseline()}});
        }
    }
    nlohmann::json links = nlohmann::json::array();
    if (Page* p = doc.getPage(n)) {
        if (auto found = p->getLinks()) {
            for (const auto& link : found->getLinks()) {
                double x1, y1, x2, y2;
                link->getRect(&x1, &y1, &x2, &y2);
                nlohmann::json entry = target_of(doc, link->getAction());
                entry["box"] = {x1, height - y2, x2 - x1, y2 - y1};
                links.push_back(std::move(entry));
            }
        }
    }
    page["links"] = std::move(links);
    page["fonts"] = std::move(fonts);
    page["words"] = std::move(words);
    page["pictures"] = record_pictures(doc, n);
    std::string kind = page_kind(doc, n, page);
    const Readability r = readability(page["words"]);
    if ((kind == "text" || kind == "pictureWithLayer") && r.tokens >= kGarbledPageTokens &&
        r.plain < kGarbledShare * r.tokens) {
        kind = "garbled";
    }
    if (readable != nullptr) {
        *readable = r;
    }
    page["kind"] = kind;
    std::ofstream(options.out / ("page-" + std::to_string(n) + ".json")) << page.dump();
    return kind;
}

}  // namespace mfbe::pdf_reader
