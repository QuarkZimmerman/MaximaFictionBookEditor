// Feature 016 (DP-5, contracts/page-model.md; tasks T017): a tagged PDF's structure tree, each
// element with its type, attributes, alternative and replacement text, language, and its marked
// content's text.
#include "pdf/reader/reader.hpp"

#include <nlohmann/json.hpp>

#include <GfxFont.h>
#include <GfxState.h>
#include <OutputDev.h>
#include <PDFDoc.h>
#include <StructElement.h>
#include <StructTreeRoot.h>
#include <UTF.h>
#include <XRef.h>
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <vector>

namespace mfbe::pdf_reader {

namespace {

void append_utf8(std::string& out, Unicode u) {
    if (u < 0x80) {
        out += static_cast<char>(u);
    } else if (u < 0x800) {
        out += static_cast<char>(0xC0 | (u >> 6));
        out += static_cast<char>(0x80 | (u & 0x3F));
    } else if (u < 0x10000) {
        out += static_cast<char>(0xE0 | (u >> 12));
        out += static_cast<char>(0x80 | ((u >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (u & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (u >> 18));
        out += static_cast<char>(0x80 | ((u >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((u >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (u & 0x3F));
    }
}

/// One pass over a page: the text drawn inside each marked-content id, words spaced by their gaps.
class McidText : public OutputDev {
public:
    std::map<int, std::string> text;
    /// Per marked-content id: characters drawn bold, italic, monospaced, and all characters.
    struct Style {
        int bold = 0, italic = 0, mono = 0, all = 0;
        double size = 0;    // the sum of the characters' sizes, for their mean
        double top = 1e9;   // the highest character's top, in points from the page's top
        double left = 1e9;  // where the run begins and ends on its line, in points
        double right = -1e9;
        bool image = false;  // a picture drawn inside it (an inline figure)
    };
    std::map<int, Style> styles;

    bool upsideDown() override { return true; }
    bool useDrawChar() override { return true; }
    bool interpretType3Chars() override { return false; }
    bool needCharCount() override { return false; }
    bool needNonText() override { return true; }

    void beginMarkedContent(const char*, Dict* properties) override {
        int mcid = stack_.empty() ? -1 : stack_.back();
        if (properties != nullptr) {
            Object value = properties->lookup("MCID");
            if (value.isInt()) {
                mcid = value.getInt();
            }
        }
        stack_.push_back(mcid);
    }
    // A picture drawn inside a marked-content run (an inline figure): its box, for the spaces
    // around it.
    void drawImage(GfxState* state, Object*, Stream*, int, int, GfxImageColorMap*, bool, const int*,
                   bool) override {
        picture(state);
    }
    void drawSoftMaskedImage(GfxState* state, Object*, Stream*, int, int, GfxImageColorMap*, bool,
                             Stream*, int, int, GfxImageColorMap*, bool) override {
        picture(state);
    }
    void drawMaskedImage(GfxState* state, Object*, Stream*, int, int, GfxImageColorMap*, bool,
                         Stream*, int, int, bool, bool) override {
        picture(state);
    }
    void picture(GfxState* state) {
        if (stack_.empty() || stack_.back() < 0) {
            return;
        }
        double xs[4], ys[4];
        const double corners[4][2] = {{0, 0}, {1, 0}, {0, 1}, {1, 1}};
        for (int i = 0; i < 4; ++i) {
            state->transform(corners[i][0], corners[i][1], &xs[i], &ys[i]);
        }
        Style& style = styles[stack_.back()];
        style.image = true;
        style.left = std::min(style.left, *std::min_element(xs, xs + 4));
        style.right = std::max(style.right, *std::max_element(xs, xs + 4));
        style.top = std::min(style.top, *std::min_element(ys, ys + 4));
    }
    void endMarkedContent(GfxState*) override {
        if (!stack_.empty()) {
            stack_.pop_back();
        }
    }
    void drawChar(GfxState* state, double x, double y, double dx, double dy, double, double,
                  CharCode, int, const Unicode* u, int uLen) override {
        if (stack_.empty() || stack_.back() < 0 || uLen <= 0) {
            return;
        }
        const int mcid = stack_.back();
        std::string& out = text[mcid];
        const double size = std::max(1.0, state->getTransformedFontSize());
        double tx, ty, tdx, tdy;
        state->transform(x, y, &tx, &ty);
        state->transformDelta(dx, dy, &tdx, &tdy);
        auto& last = last_[mcid];
        if (!out.empty() && out.back() != ' ' &&
            (std::abs(ty - last.y) > size * 0.5 || tx - last.x_end > size * 0.15)) {
            out += ' ';
        }
        for (int i = 0; i < uLen; ++i) {
            append_utf8(out, u[i]);
        }
        last = {tx + tdx, ty};
        // The font's flags, or its name where a subset font carries none
        // ("ABCDEF+Serif-BoldItalic").
        if (const auto& font = state->getFont()) {
            const std::string name = font->getName().value_or("");
            const auto has = [&name](const char* part) {
                return name.find(part) != std::string::npos;
            };
            Style& style = styles[mcid];
            style.all += 1;
            style.size += size;
            style.top = std::min(style.top, ty - size);
            style.left = std::min(style.left, tx);
            style.right = std::max(style.right, tx + tdx);
            style.bold += font->isBold() || has("Bold") || has("Black") || has("Heavy") ? 1 : 0;
            style.italic += font->isItalic() || has("Italic") || has("Oblique") ? 1 : 0;
            style.mono += font->isFixedWidth() || has("Mono") || has("Courier") ? 1 : 0;
        }
    }

private:
    struct Last {
        double x_end = 0;
        double y = 0;
    };
    std::vector<int> stack_;
    std::map<int, Last> last_;
};

std::string utf8_text(const GooString* s) {
    if (s == nullptr) {
        return {};
    }
    std::string out = TextStringToUtf8(s->toStr());
    while (!out.empty() && out.back() == '\0') {
        out.pop_back();
    }
    return out;
}

nlohmann::json value_of(const Object* value) {
    if (value->isInt()) {
        return value->getInt();
    }
    if (value->isReal() || value->isNum()) {
        return value->getNum();
    }
    if (value->isName()) {
        return value->getName();
    }
    if (value->isString()) {
        std::string text = TextStringToUtf8(value->getString());
        while (!text.empty() && text.back() == '\0') {
            text.pop_back();
        }
        return text;
    }
    if (value->isBool()) {
        return value->getBool();
    }
    return nullptr;
}

/// Most of a run's characters bold, italic or monospaced: the run is (DP-5).
void mark_style(nlohmann::json& leaf, const McidText::Style& style) {
    if (style.all == 0 && !style.image) {
        return;
    }
    leaf["top"] = std::round(style.top * 10) / 10;
    leaf["left"] = std::round(style.left * 10) / 10;
    leaf["right"] = std::round(style.right * 10) / 10;
    if (style.all == 0) {
        return;
    }
    leaf["size"] = std::round(style.size / style.all * 10) / 10;
    if (style.bold * 2 > style.all) {
        leaf["bold"] = true;
    }
    if (style.italic * 2 > style.all) {
        leaf["italic"] = true;
    }
    if (style.mono * 2 > style.all) {
        leaf["mono"] = true;
    }
}

struct Walker {
    PDFDoc& doc;
    std::map<std::pair<int, int>, std::string>& texts;
    std::map<std::pair<int, int>, McidText::Style>& styles;
    std::set<std::pair<int, int>> referenced;
    int count = 0;

    /// A link annotation's target, for the Link element that refers to it: an address, or a named
    /// destination or a page of the document.
    void link_target(nlohmann::json& out, Ref ref) {
        Object annot = doc.getXRef()->fetch(ref);
        if (!annot.isDict()) {
            return;
        }
        Object action = annot.dictLookup("A");
        if (action.isDict()) {
            Object kind = action.dictLookup("S");
            if (kind.isName("URI")) {
                Object uri = action.dictLookup("URI");
                if (uri.isString()) {
                    out["uri"] = uri.getString();
                }
                return;
            }
            if (kind.isName("GoTo")) {
                Object d = action.dictLookup("D");
                dest_of(out, d);
            }
            return;
        }
        Object d = annot.dictLookup("Dest");
        dest_of(out, d);
    }
    void dest_of(nlohmann::json& out, const Object& d) {
        if (d.isName()) {
            out["dest"] = d.getName();
        } else if (d.isString()) {
            out["dest"] = TextStringToUtf8(d.getString());
        } else if (d.isArray() && d.arrayGetLength() > 0) {
            const Object target = d.arrayGetNF(0).copy();
            if (target.isRef()) {
                out["destPage"] = doc.findPage(target.getRef());
            }
        }
    }

    nlohmann::json element(const StructElement* e, int depth, int inherited_page) {
        if (++count > 2'000'000 || depth > 64) {
            return nullptr;
        }
        if (e->isContent()) {
            Ref ref;
            int page = inherited_page;
            if (e->getPageRef(ref) && doc.findPage(ref) > 0) {
                page = doc.findPage(ref);
            }
            if (e->isObjectRef()) {
                nlohmann::json objr{{"objr", true}, {"page", page}};
                link_target(objr, e->getObjectRef());
                return objr;
            }
            referenced.insert({page, e->getMCID()});
            const auto it = texts.find({page, e->getMCID()});
            nlohmann::json leaf{{"page", page},
                                {"mcid", e->getMCID()},
                                {"text", it == texts.end() ? "" : it->second}};
            mark_style(leaf, styles[{page, e->getMCID()}]);
            return leaf;
        }
        nlohmann::json out{{"type", e->getTypeName()}};
        int page = inherited_page;
        if (Ref ref; e->getPageRef(ref) && doc.findPage(ref) > 0) {
            page = doc.findPage(ref);
        }
        if (const GooString* lang = e->getLanguage()) {
            out["lang"] = utf8_text(lang);
        }
        if (const GooString* alt = e->getAltText()) {
            out["alt"] = utf8_text(alt);
        }
        if (const GooString* actual = e->getActualText()) {
            out["actualText"] = utf8_text(actual);
        }
        nlohmann::json attributes = nlohmann::json::object();
        for (unsigned i = 0; i < e->getNumAttributes(); ++i) {
            const Attribute* a = e->getAttribute(static_cast<int>(i));
            attributes[a->getName()] = value_of(a->getValue());
        }
        if (!attributes.empty()) {
            out["attributes"] = std::move(attributes);
        }
        nlohmann::json kids = nlohmann::json::array();
        for (unsigned i = 0; i < e->getNumChildren(); ++i) {
            nlohmann::json kid = element(e->getChild(static_cast<int>(i)), depth + 1, page);
            if (!kid.is_null()) {
                kids.push_back(std::move(kid));
            }
        }
        out["kids"] = std::move(kids);
        return out;
    }
};

}  // namespace

nlohmann::json structure_of(PDFDoc& doc, nlohmann::json& orphans) {
    const StructTreeRoot* root = doc.getStructTreeRoot();
    if (root == nullptr || root->getNumChildren() == 0) {
        return nullptr;
    }
    std::map<std::pair<int, int>, std::string> texts;
    std::map<std::pair<int, int>, McidText::Style> styles;
    for (int n = 1; n <= doc.getNumPages(); ++n) {
        emit("{\"event\":\"structure\",\"n\":" + std::to_string(n) + "}");
        McidText device;
        doc.displayPage(&device, n, 72, 72, 0, true, false, false);
        for (auto& [mcid, text] : device.text) {
            texts[{n, mcid}] = std::move(text);
        }
        for (const auto& [mcid, style] : device.styles) {
            styles[{n, mcid}] = style;
        }
    }
    Walker walker{doc, texts, styles, {}, 0};
    nlohmann::json out = nlohmann::json::array();
    for (unsigned i = 0; i < root->getNumChildren(); ++i) {
        nlohmann::json e = walker.element(root->getChild(static_cast<int>(i)), 0, 0);
        if (!e.is_null()) {
            out.push_back(std::move(e));
        }
    }
    // Marked content no element refers to (Chromium leaves bold and italic runs out of its tree):
    // given apart, in content order, so the interface can put each back between its neighbours.
    orphans = nlohmann::json::array();
    for (const auto& [key, text] : texts) {
        if (!text.empty() && !walker.referenced.count(key)) {
            nlohmann::json orphan{{"page", key.first}, {"mcid", key.second}, {"text", text}};
            mark_style(orphan, styles[key]);
            orphans.push_back(std::move(orphan));
        }
    }
    return out;
}

}  // namespace mfbe::pdf_reader
