// Feature 014 (research R3 step 9, plan DP-18, tasks T028): the export's own check.

#include "pdf/check.hpp"

#include "pdf/document.hpp"

#include <mfbe/pdf.hpp>

#include <Catalog.h>
#include <GfxState.h>
#include <Link.h>
#include <Object.h>
#include <OutputDev.h>
#include <PDFDoc.h>
#include <XRef.h>
#include <algorithm>
#include <cctype>
#include <goo/GooString.h>
#include <map>

namespace mfbe::pdf {

namespace {

// R3 step 9: every link of a page leads to a destination the file has (a named one in its
// dictionary, or one of its pages). Links to addresses outside the file are not checked.
void check_links(PDFDoc& doc, int page, std::vector<std::string>& faults) {
    Catalog* catalog = doc.getCatalog();
    const Ref* ref = catalog->getPageRef(page);
    if (ref == nullptr)
        return;
    const Object page_dict = doc.getXRef()->fetch(*ref);
    const Object annots = page_dict.dictLookup("Annots");
    if (!annots.isArray())
        return;
    for (int i = 0; i < annots.arrayGetLength(); ++i) {
        const Object annot = annots.arrayGet(i);
        if (!annot.isDict() || !annot.dictLookup("Subtype").isName("Link"))
            continue;
        Object dest = annot.dictLookup("Dest");
        if (dest.isNull()) {
            const Object action = annot.dictLookup("A");
            if (!action.isDict() || !action.dictLookup("S").isName("GoTo"))
                continue;
            dest = action.dictLookup("D");
        }
        bool found = false;
        std::string name;
        if (dest.isName() || dest.isString()) {
            name = dest.isName() ? std::string(dest.getName()) : dest.getString();
            const GooString key(name);
            found = catalog->findDest(&key) != nullptr;
        } else if (dest.isArray() && dest.arrayGetLength() > 0 && dest.arrayGetNF(0).isRef()) {
            found = catalog->findPage(dest.arrayGetNF(0).getRef()) > 0;
        }
        if (!found) {
            faults.push_back("page " + std::to_string(page) + ": a link leads nowhere" +
                             (name.empty() ? std::string() : " (" + name + ")"));
        }
    }
}

}  // namespace

std::string comparable(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); ++i) {
        const unsigned char c = static_cast<unsigned char>(text[i]);
        if (std::isspace(c))
            continue;
        // Bidirectional formatting marks, which Poppler wraps around right-to-left text (U+200E,
        // U+200F, U+202A to U+202E, U+2066 to U+2069) and the Arabic letter mark (U+061C), are
        // not text of the page.
        if (c == 0xE2 && i + 2 < text.size()) {
            const unsigned char b1 = static_cast<unsigned char>(text[i + 1]);
            const unsigned char b2 = static_cast<unsigned char>(text[i + 2]);
            if ((b1 == 0x80 && (b2 == 0x8E || b2 == 0x8F || (b2 >= 0xAA && b2 <= 0xAE))) ||
                (b1 == 0x81 && b2 >= 0xA6 && b2 <= 0xA9)) {
                i += 2;
                continue;
            }
        }
        if (c == 0xD8 && i + 1 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0x9C) {
            ++i;
            continue;
        }
        // The other Unicode spaces count as whitespace (U+1680, U+2000 to U+200B, U+202F, U+205F,
        // U+3000, U+FEFF), as tests/pdf/text-compare.mjs counts them.
        if (c == 0xE2 && i + 2 < text.size()) {
            const unsigned char b1 = static_cast<unsigned char>(text[i + 1]);
            const unsigned char b2 = static_cast<unsigned char>(text[i + 2]);
            if ((b1 == 0x80 && (b2 <= 0x8B || b2 == 0xAF)) || (b1 == 0x81 && b2 == 0x9F)) {
                i += 2;
                continue;
            }
        }
        if ((c == 0xE1 && i + 2 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0x9A &&
             static_cast<unsigned char>(text[i + 2]) == 0x80) ||
            (c == 0xE3 && i + 2 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0x80 &&
             static_cast<unsigned char>(text[i + 2]) == 0x80) ||
            (c == 0xEF && i + 2 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0xBB &&
             static_cast<unsigned char>(text[i + 2]) == 0xBF)) {
            i += 2;
            continue;
        }
        // No-break spaces (U+00A0) and the soft hyphen (U+00AD) count as whitespace too.
        if (c == 0xC2 && i + 1 < text.size() &&
            (static_cast<unsigned char>(text[i + 1]) == 0xA0 ||
             static_cast<unsigned char>(text[i + 1]) == 0xAD)) {
            ++i;
            continue;
        }
        out.push_back(text[i]);
    }
    return out;
}

std::vector<std::string> check_finished(const std::vector<char>& finished,
                                        const std::vector<std::string>& page_texts,
                                        const std::function<void(int done, int total)>& progress) {
    std::vector<std::string> faults;
    std::string error;
    auto doc = Document::open_bytes(finished, &error);
    if (!doc)
        return {"the finished file cannot be read back: " + error};
    if (doc->encrypted())
        faults.emplace_back("the finished file is encrypted");
    if (!page_texts.empty() && doc->page_count() != static_cast<int>(page_texts.size())) {
        faults.push_back("the file has " + std::to_string(doc->page_count()) +
                         " pages, the page map " + std::to_string(page_texts.size()));
    }
    for (int i = 0; i < doc->page_count(); ++i) {
        check_links(*doc->impl().doc, i + 1, faults);
        for (const FontInfo& font : doc->page_info(i).fonts) {
            if (!font.embedded || !font.to_unicode) {
                faults.push_back("page " + std::to_string(i + 1) + ": font " + font.base_font +
                                 (font.embedded ? " has no ToUnicode map" : " is not embedded"));
            }
        }
        if (i >= static_cast<int>(page_texts.size()))
            continue;
        // The page number at the foot is drawn but is not page map text: it may follow.
        const std::string expected = comparable(page_texts[static_cast<std::size_t>(i)]);
        const std::string read = comparable(doc->page_text(i));
        // Every character the page shows, in any order: Poppler reads a page in the order of
        // its layout (a table beside the footnotes, the page number wherever it falls), so the
        // check is that no character is lost or added - only the page number's digits may be.
        std::map<std::string, long> count;
        const auto each = [](const std::string& text, auto&& visit) {
            for (std::size_t k = 0; k < text.size();) {
                std::size_t n = 1;
                const unsigned char c = static_cast<unsigned char>(text[k]);
                if (c >= 0xF0)
                    n = 4;
                else if (c >= 0xE0)
                    n = 3;
                else if (c >= 0xC0)
                    n = 2;
                visit(text.substr(k, n));
                k += n;
            }
        };
        each(expected, [&count](const std::string& ch) { ++count[ch]; });
        each(read, [&count](const std::string& ch) { --count[ch]; });
        each(std::to_string(i + 1), [&count](const std::string& digit) {
            if (count[digit] < 0)
                ++count[digit];
        });
        std::string missing;
        std::string extra;
        for (const auto& [ch, n] : count) {
            // Hyphens either way are no fault: the engine adds one where it breaks a word at a
            // line's end (macOS hyphenates, plan DP-17), and Poppler's text drops a line-final
            // hyphen when it joins the word broken there.
            const bool hyphen = ch == "-" || ch == "\xE2\x80\x90";
            if (n > 0 && !hyphen && missing.size() < 80)
                missing += ch;
            if (n < 0 && !hyphen && extra.size() < 80)
                extra += ch;
        }
        if (!missing.empty() || !extra.empty()) {
            faults.push_back("page " + std::to_string(i + 1) + ": its text differs from the page" +
                             (missing.empty() ? "" : ", missing \"" + missing + "\"") +
                             (extra.empty() ? "" : ", added \"" + extra + "\""));
        }
        if (progress) {
            progress(i + 1, doc->page_count());
        }
        if (faults.size() > 20)
            break;
    }
    return faults;
}

namespace {

// The boxes the page's images are drawn in, in points from the page's top left.
class ImageBoxes : public OutputDev {
public:
    struct Box {
        double x0, y0, x1, y1;
    };
    std::vector<Box> boxes;
    bool upsideDown() override { return true; }
    bool useDrawChar() override { return false; }
    bool interpretType3Chars() override { return false; }
    void drawImage(GfxState* state, Object*, Stream*, int, int, GfxImageColorMap*, bool, const int*,
                   bool) override {
        record(state);
    }
    void drawMaskedImage(GfxState* state, Object*, Stream*, int, int, GfxImageColorMap*, bool,
                         Stream*, int, int, bool, bool) override {
        record(state);
    }
    void drawSoftMaskedImage(GfxState* state, Object*, Stream*, int, int, GfxImageColorMap*, bool,
                             Stream*, int, int, GfxImageColorMap*, bool) override {
        record(state);
    }

private:
    void record(GfxState* state) {
        // The image's unit square through the current transformation, at 72 dpi.
        Box box{1e9, 1e9, -1e9, -1e9};
        const std::pair<double, double> corners[] = {
            {0.0, 0.0}, {1.0, 0.0}, {0.0, 1.0}, {1.0, 1.0}};
        for (const auto& [ux, uy] : corners) {
            double x = 0;
            double y = 0;
            state->transform(ux, uy, &x, &y);
            box = {std::min(box.x0, x), std::min(box.y0, y), std::max(box.x1, x),
                   std::max(box.y1, y)};
        }
        boxes.push_back(box);
    }
};

}  // namespace

std::vector<std::string> check_pictures(const std::vector<char>& finished,
                                        const std::vector<PlacedPicture>& pictures) {
    std::vector<std::string> faults;
    if (pictures.empty())
        return faults;
    std::string error;
    auto doc = Document::open_bytes(finished, &error);
    if (!doc)
        return {"the finished file is not readable: " + error};
    PDFDoc& d = *doc->impl().doc;
    std::map<int, ImageBoxes> drawn;
    for (const PlacedPicture& picture : pictures) {
        if (picture.page < 0 || picture.page >= d.getNumPages())
            continue;
        auto [it, first] = drawn.try_emplace(picture.page);
        if (first)
            d.displayPage(&it->second, picture.page + 1, 72, 72, 0, true, false, false);
        // (Not "near": Windows headers define near and far as empty macros.)
        const auto close_to = [](double a, double b) { return std::abs(a - b) <= 1.5; };
        const bool found = std::any_of(
            it->second.boxes.begin(), it->second.boxes.end(), [&](const ImageBoxes::Box& b) {
                return close_to(b.x0, picture.x) && close_to(b.y0, picture.y) &&
                       close_to(b.x1 - b.x0, picture.width) &&
                       close_to(b.y1 - b.y0, picture.height);
            });
        if (!found) {
            faults.push_back("page " + std::to_string(picture.page + 1) + ": the picture " +
                             picture.binary_id + " is not drawn in its box");
        }
    }
    return faults;
}

}  // namespace mfbe::pdf
