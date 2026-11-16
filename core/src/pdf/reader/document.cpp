// Feature 016 (DP-5, contracts/page-model.md; tasks T016): document.json - metadata, the editor's
// record, encryption. Outline, links and forms come with the rest of T016.
#include "pdf/reader/reader.hpp"

#include <nlohmann/json.hpp>

#include <Annot.h>
#include <Catalog.h>
#include <Form.h>
#include <GlobalParams.h>
#include <Link.h>
#include <Outline.h>
#include <PDFDoc.h>
#include <Page.h>
#include <UTF.h>
#include <cstdlib>
#include <fstream>
#include <regex>

namespace mfbe::pdf_reader {

nlohmann::json structure_of(PDFDoc& doc, nlohmann::json& orphans);

namespace {

/// The text of an XMP element, its XML entities read: the record keeps FB2 XML and JSON as text.
std::string xmp_value(const std::string& xmp, const std::string& name) {
    const std::regex re("<" + name + ">([\\s\\S]*?)</" + name + ">");
    std::smatch m;
    if (!std::regex_search(xmp, m, re)) {
        return {};
    }
    const std::string raw = m[1].str();
    std::string out;
    out.reserve(raw.size());
    for (std::size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] != '&') {
            out += raw[i];
            continue;
        }
        const std::size_t end = raw.find(';', i);
        if (end == std::string::npos || end - i > 10) {
            out += raw[i];
            continue;
        }
        const std::string entity = raw.substr(i + 1, end - i - 1);
        unsigned long code = 0;
        if (entity == "lt") {
            code = '<';
        } else if (entity == "gt") {
            code = '>';
        } else if (entity == "amp") {
            code = '&';
        } else if (entity == "quot") {
            code = '"';
        } else if (entity == "apos") {
            code = '\'';
        } else if (entity.size() > 1 && entity[0] == '#') {
            code = entity[1] == 'x' || entity[1] == 'X'
                       ? std::strtoul(entity.c_str() + 2, nullptr, 16)
                       : std::strtoul(entity.c_str() + 1, nullptr, 10);
        }
        if (code == 0 || code > 0x10FFFF) {
            out += raw[i];
            continue;
        }
        if (code < 0x80) {
            out += static_cast<char>(code);
        } else if (code < 0x800) {
            out += static_cast<char>(0xC0 | (code >> 6));
            out += static_cast<char>(0x80 | (code & 0x3F));
        } else if (code < 0x10000) {
            out += static_cast<char>(0xE0 | (code >> 12));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (code >> 18));
            out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
        i = end;
    }
    return out;
}

std::string utf8_of(const std::vector<Unicode>& text) {
    std::string out;
    for (Unicode u : text) {
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
    return out;
}

}  // namespace

/// Where a link action leads: page (from 1) and the top of the target (points from the page's top),
/// or the address. Shared with text.cpp's links.
nlohmann::json target_of(PDFDoc& doc, const LinkAction* action) {
    nlohmann::json out = nlohmann::json::object();
    if (action == nullptr) {
        return out;
    }
    if (action->getKind() == actionURI) {
        out["uri"] = static_cast<const LinkURI*>(action)->getURI();
        return out;
    }
    if (action->getKind() != actionGoTo) {
        return out;
    }
    const auto* go = static_cast<const LinkGoTo*>(action);
    std::unique_ptr<LinkDest> found;
    const LinkDest* dest = go->getDest();
    if (dest == nullptr && go->getNamedDest() != nullptr) {
        out["dest"] = go->getNamedDest()->toStr();
        found = doc.findDest(go->getNamedDest());
        dest = found.get();
    }
    if (dest == nullptr || !dest->isOk()) {
        return out;
    }
    const int page = dest->isPageRef() ? doc.findPage(dest->getPageRef()) : dest->getPageNum();
    if (page >= 1 && page <= doc.getNumPages()) {
        out["page"] = page;
        if (dest->getChangeTop()) {
            out["y"] = doc.getPageCropHeight(page) - dest->getTop();
        }
    }
    return out;
}

namespace {

nlohmann::json outline_of(PDFDoc& doc, const std::vector<OutlineItem*>* items, int depth) {
    nlohmann::json out = nlohmann::json::array();
    if (items == nullptr || depth > 64) {
        return out;
    }
    for (OutlineItem* item : *items) {
        nlohmann::json node = target_of(doc, item->getAction());
        node["title"] = utf8_of(item->getTitle());
        item->open();
        node["kids"] =
            item->hasKids() ? outline_of(doc, item->getKids(), depth + 1) : nlohmann::json::array();
        out.push_back(std::move(node));
    }
    return out;
}

}  // namespace

bool write_document(PDFDoc& doc, const Options& options, std::string& error, bool* ours) {
    nlohmann::json out{{"v", 1},
                       {"pages", doc.getNumPages()},
                       {"version", std::to_string(doc.getPDFMajorVersion()) + "." +
                                       std::to_string(doc.getPDFMinorVersion())},
                       {"encrypted", doc.isEncrypted()},
                       {"copyAllowed", doc.okToCopy()}};
    std::string xmp;
    if (Catalog* catalog = doc.getCatalog()) {
        if (auto metadata = catalog->readMetadata()) {
            xmp = metadata->toStr();
        }
    }
    nlohmann::json info = nlohmann::json::object();
    for (const char* key : {"Title", "Author", "Subject", "Keywords", "Creator", "Producer"}) {
        if (auto value = doc.getDocInfoStringEntry(key)) {
            std::string text = TextStringToUtf8(value->toStr());
            while (!text.empty() && text.back() == '\0') {
                text.pop_back();
            }
            info[key] = text;
        }
    }
    out["metadata"] = {{"info", info}, {"xmp", xmp}};
    Outline* outline = doc.getOutline();
    out["outline"] = outline ? outline_of(doc, outline->getItems(), 0) : nlohmann::json::array();
    nlohmann::json forms = nlohmann::json::array();
    int comments = 0, media = 0;
    for (int n = 1; n <= doc.getNumPages(); ++n) {
        Page* page = doc.getPage(n);
        Annots* annots = page ? page->getAnnots() : nullptr;
        if (annots == nullptr) {
            continue;
        }
        const double height = doc.getPageCropHeight(n);
        for (const auto& shared : annots->getAnnots()) {
            Annot* annot = shared.get();
            switch (annot->getType()) {
                case Annot::typeLink:
                    break;
                case Annot::typeWidget: {
                    double x1, y1, x2, y2;
                    annot->getRect(&x1, &y1, &x2, &y2);
                    std::string value;
                    Form* form = doc.getCatalog() ? doc.getCatalog()->getForm() : nullptr;
                    FormWidget* field = form ? form->findWidgetByRef(annot->getRef()) : nullptr;
                    if (field && field->getType() == formText) {
                        if (const GooString* content =
                                static_cast<FormWidgetText*>(field)->getContent()) {
                            value = TextStringToUtf8(content->toStr());
                            while (!value.empty() && value.back() == '\0') {
                                value.pop_back();
                            }
                        }
                    }
                    forms.push_back({{"page", n},
                                     {"box", {x1, height - y2, x2 - x1, y2 - y1}},
                                     {"value", value}});
                    break;
                }
                case Annot::typeSound:
                case Annot::typeMovie:
                case Annot::typeScreen:
                case Annot::typeRichMedia:
                    ++media;
                    break;
                default:
                    ++comments;
            }
        }
    }
    out["forms"] = std::move(forms);
    nlohmann::json orphans;
    if (nlohmann::json structure = structure_of(doc, orphans); !structure.is_null()) {
        out["structure"] = std::move(structure);
        out["orphans"] = std::move(orphans);
    }
    Catalog* catalog = doc.getCatalog();
    // D23: the first page's largest picture, its size in pixels and kind - the cover the editor's
    // own PDF gives back, for the comparison with an FBD's cover before the pages are read
    // (FR-045).
    if (doc.getNumPages() >= 1) {
        const nlohmann::json first = record_pictures(doc, 1);
        const nlohmann::json* largest = nullptr;
        for (const auto& picture : first) {
            if (!largest || picture.value("w", 0) * picture.value("h", 0) >
                                (*largest).value("w", 0) * (*largest).value("h", 0)) {
                largest = &picture;
            }
        }
        if (largest) {
            out["cover"] = {{"w", largest->value("w", 0)},
                            {"h", largest->value("h", 0)},
                            {"jpeg", largest->value("jpeg", false)}};
        }
    }
    out["dropped"] = {{"comments", comments},
                      {"attachments", catalog ? catalog->numEmbeddedFiles() : 0},
                      {"media", media},
                      {"scripts", catalog ? catalog->numJS() : 0}};
    const std::string version = xmp_value(xmp, "mfbe:recordVersion");
    if (ours != nullptr) {
        *ours = !version.empty();
    }
    if (!version.empty()) {
        out["record"] = {{"version", std::atoi(version.c_str())},
                         {"description", xmp_value(xmp, "mfbe:fb2Description")},
                         {"hints", xmp_value(xmp, "mfbe:fb2Hints")}};
    }
    std::ofstream file(options.out / "document.json");
    if (!file) {
        error = "ioError";
        return false;
    }
    file << out.dump();
    return true;
}

}  // namespace mfbe::pdf_reader
