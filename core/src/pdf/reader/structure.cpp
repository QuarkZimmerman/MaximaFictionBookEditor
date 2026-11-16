// Feature 016 (DP-5, contracts/page-model.md; tasks T017): a tagged PDF's structure tree, each
// element with its type, attributes, alternative and replacement text, language, and its marked
// content's text.
#include "pdf/reader/reader.hpp"

#include <nlohmann/json.hpp>

#include <GfxState.h>
#include <OutputDev.h>
#include <PDFDoc.h>
#include <StructElement.h>
#include <StructTreeRoot.h>
#include <UTF.h>
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

    bool upsideDown() override { return true; }
    bool useDrawChar() override { return true; }
    bool interpretType3Chars() override { return false; }
    bool needCharCount() override { return false; }

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

struct Walker {
    PDFDoc& doc;
    std::map<std::pair<int, int>, std::string>& texts;
    std::set<std::pair<int, int>> referenced;
    int count = 0;

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
                return {{"objr", true}, {"page", page}};
            }
            referenced.insert({page, e->getMCID()});
            const auto it = texts.find({page, e->getMCID()});
            return {{"page", page},
                    {"mcid", e->getMCID()},
                    {"text", it == texts.end() ? "" : it->second}};
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
    for (int n = 1; n <= doc.getNumPages(); ++n) {
        McidText device;
        doc.displayPage(&device, n, 72, 72, 0, true, false, false);
        for (auto& [mcid, text] : device.text) {
            texts[{n, mcid}] = std::move(text);
        }
    }
    Walker walker{doc, texts, {}, 0};
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
            orphans.push_back({{"page", key.first}, {"mcid", key.second}, {"text", text}});
        }
    }
    return out;
}

}  // namespace mfbe::pdf_reader
