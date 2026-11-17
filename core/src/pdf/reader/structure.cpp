// Feature 016 (DP-5, contracts/page-model.md; tasks T017): a tagged PDF's structure tree, each
// element with its type, attributes, alternative and replacement text, language, and its marked
// content's text.
#include "pdf/reader/reader.hpp"

#include <nlohmann/json.hpp>

#include <Dict.h>
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
#include <cstring>
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
/// The text ends with a hyphen or a dash after a character that is no space ("Jakka-", "10–"): a
/// line may break after it with no space to mark (D32's library run).
bool ends_with_dash(const std::string& out) {
    // A soft hyphen the book put after it is no letter (D32: "кто-\u00adто").
    std::size_t size = out.size();
    while (size >= 2 && out.compare(size - 2, 2, "\xC2\xAD") == 0) {
        size -= 2;
    }
    static const char* const dashes[] = {"-", "\xE2\x80\x90", "\xE2\x80\x92", "\xE2\x80\x93",
                                         "\xE2\x80\x94"};
    for (const char* dash : dashes) {
        const std::size_t n = std::strlen(dash);
        if (size <= n || out.compare(size - n, n, dash) != 0) {
            continue;
        }
        // The character before it, decoded: a space of any kind (a no-break space before a dash, as
        // typography sets it) makes the dash no part of a word.
        std::size_t at = size - n - 1;
        while (at > 0 && (static_cast<unsigned char>(out[at]) & 0xC0) == 0x80) {
            --at;
        }
        const auto lead = static_cast<unsigned char>(out[at]);
        const int extra = lead < 0x80             ? 0
                          : (lead & 0xE0) == 0xC0 ? 1
                          : (lead & 0xF0) == 0xE0 ? 2
                                                  : 3;
        char32_t code = extra == 0 ? lead : lead & (0x3F >> extra);
        for (int k = 1; k <= extra && at + k < size - n; ++k) {
            code = (code << 6) | (static_cast<unsigned char>(out[at + k]) & 0x3F);
        }
        const bool space = code == 0x20 || code == 0xA0 || code == 0x1680 ||
                           (code >= 0x2000 && code <= 0x200A) || code == 0x202F || code == 0x205F ||
                           code == 0x3000;
        return !space;
    }
    return false;
}

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
        // Its first character's place and its last one's end (D32: a paragraph's first-line indent
        // and its last line's length, which its box hides when it runs over several lines).
        double start_left = 0, start_top = 0, end_right = 0, end_top = 0;
    };
    std::map<int, Style> styles;
    /// A gap between letters wider than a sixth of their size is read as a space - not in a PDF
    /// that draws its spaces (the editor's own).
    bool gaps = true;

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
        // A space drawn with no advance stands for a character no glyph shows: the engine's shaping
        // prints a book's direction marks and other invisible characters so (D32's library run) -
        // it is no space.
        if (uLen == 1 && u[0] == 0x20 && std::abs(tdx) + std::abs(tdy) < size * 0.05) {
            return;
        }
        auto& last = last_[mcid];
        // A space whose next glyph begins where the space began took no room: the engine draws a
        // book's invisible characters (a direction mark) so, its width taken back by the glyphs'
        // places (D32).
        if (last.space_x >= 0 && std::abs(tx - last.space_x) < size * 0.05 && !out.empty() &&
            out.back() == ' ') {
            out.pop_back();
        }
        const bool new_line = std::abs(ty - last.y) > size * 0.5;
        // A word's own hyphen at a line's end goes on with the next line's letters
        // ("Jakka-Mongolen"): a line breaks after a hyphen with no space to mark (D32's library
        // run).
        const bool hyphen = new_line && ends_with_dash(out);
        if (!out.empty() && out.back() != ' ' &&
            ((new_line && !hyphen) || (gaps && !new_line && tx - last.x_end > size * 0.15))) {
            out += ' ';
        }
        // A plain hyphen that ends a line, marked (U+2063, invisible): a word broken there is
        // joined by the interface when a dictionary knows it, as the layout's words are (D12; D32's
        // library run kept "огром-ный").
        if (hyphen && !out.empty() && out.back() == '-') {
            out += "\xE2\x81\xA3";
        }
        for (int i = 0; i < uLen; ++i) {
            append_utf8(out, u[i]);
        }
        last = {tx + tdx, ty, uLen == 1 && u[0] == 0x20 ? tx : -1};
        // The font's flags, or its name where a subset font carries none
        // ("ABCDEF+Serif-BoldItalic").
        if (const auto& font = state->getFont()) {
            const std::string name = font->getName().value_or("");
            const auto has = [&name](const char* part) {
                return name.find(part) != std::string::npos;
            };
            Style& style = styles[mcid];
            if (style.all == 0) {
                style.start_left = tx;
                style.start_top = ty - size;
            }
            style.end_right = tx + tdx;
            style.end_top = ty - size;
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
        double space_x = -1;  // where the last character, a space, began (-1: it was no space)
    };
    std::vector<int> stack_;
    std::map<int, Last> last_;
};

std::string utf8_text(const GooString* s) {
    if (s == nullptr) {
        return {};
    }
    std::string out = text_string(s->toStr());
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
        std::string text = text_string(value->getString());
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
    if (style.all > 0) {
        leaf["startLeft"] = std::round(style.start_left * 10) / 10;
        leaf["startTop"] = std::round(style.start_top * 10) / 10;
        leaf["endRight"] = std::round(style.end_right * 10) / 10;
        leaf["endTop"] = std::round(style.end_top * 10) / 10;
    }
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
            out["dest"] = text_string(d.getString());
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

void map_newer_types(PDFDoc& doc) {
    // PDF 2.0's standard structure types Poppler does not know: it drops such an element with all
    // it holds (the engine writes Strong and Em for bold and italic - D32's library run lost every
    // bold title). Each is mapped, through the structure tree's role map (ISO 32000-2, 14.8.6), to
    // the PDF 1.7 type it refines, unless the file maps it already.
    static const std::pair<const char*, const char*> newer[] = {{"Strong", "Span"},
                                                                {"Em", "Span"},
                                                                {"Sub", "Span"},
                                                                {"Title", "H"},
                                                                {"FENote", "Note"},
                                                                {"Aside", "Div"},
                                                                {"DocumentFragment", "Div"}};
    XRef* xref = doc.getXRef();
    Object catalog = xref->getCatalog();
    if (!catalog.isDict()) {
        return;
    }
    const Object& link = catalog.dictLookupNF("StructTreeRoot");
    if (!link.isRef()) {
        return;
    }
    const Ref ref = link.getRef();
    Object root = xref->fetch(ref);
    if (!root.isDict()) {
        return;
    }
    Object roles = root.dictLookup("RoleMap");
    std::unique_ptr<Dict> map =
        roles.isDict() ? roles.getDict()->copy(xref) : std::make_unique<Dict>(xref);
    bool changed = false;
    for (const auto& [from, to] : newer) {
        if (!map->hasKey(from)) {
            map->add(from, Object(objName, to));
            changed = true;
        }
    }
    if (!changed) {
        return;
    }
    std::unique_ptr<Dict> copy = root.getDict()->copy(xref);
    copy->set("RoleMap", Object(std::move(map)));
    const Object modified(std::move(copy));
    xref->setModifiedObject(&modified, ref);
}

nlohmann::json structure_of(PDFDoc& doc, nlohmann::json& orphans, bool drawn_spaces) {
    const StructTreeRoot* root = doc.getStructTreeRoot();
    if (root == nullptr || root->getNumChildren() == 0) {
        return nullptr;
    }
    std::map<std::pair<int, int>, std::string> texts;
    std::map<std::pair<int, int>, McidText::Style> styles;
    for (int n = 1; n <= doc.getNumPages(); ++n) {
        emit("{\"event\":\"structure\",\"n\":" + std::to_string(n) + "}");
        McidText device;
        device.gaps = !drawn_spaces;
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
