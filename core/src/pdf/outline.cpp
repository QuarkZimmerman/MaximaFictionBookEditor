// Feature 014 (D17, tasks T040): the bookmarks.

#include "pdf/outline.hpp"

#include "pdf/document.hpp"

#include <Array.h>
#include <Catalog.h>
#include <Dict.h>
#include <Object.h>
#include <XRef.h>

namespace mfbe::pdf {
namespace {

// A PDF text string: as it is when plain ASCII, else UTF-16BE with its byte order mark.
std::string text_string(const std::string& utf8) {
    bool ascii = true;
    for (unsigned char c : utf8)
        ascii = ascii && c >= 0x20 && c < 0x80;
    if (ascii)
        return utf8;
    std::string out = "\xFE\xFF";
    for (std::size_t i = 0; i < utf8.size();) {
        const unsigned char c = static_cast<unsigned char>(utf8[i]);
        const int extra = c < 0x80 ? 0 : (c >> 5) == 0x6 ? 1 : (c >> 4) == 0xE ? 2 : 3;
        std::uint32_t cp = extra == 0 ? c : c & (0x3F >> extra);
        for (int k = 1; k <= extra && i + k < utf8.size(); ++k) {
            cp = (cp << 6) | (static_cast<unsigned char>(utf8[i + k]) & 0x3F);
        }
        i += static_cast<std::size_t>(extra) + 1;
        const auto unit = [&out](std::uint32_t u) {
            out.push_back(static_cast<char>((u >> 8) & 0xFF));
            out.push_back(static_cast<char>(u & 0xFF));
        };
        if (cp >= 0x10000) {
            cp -= 0x10000;
            unit(0xD800 + (cp >> 10));
            unit(0xDC00 + (cp & 0x3FF));
        } else {
            unit(cp);
        }
    }
    return out;
}

struct Writer {
    PDFDoc& doc;
    XRef* xref;
    double page_height;

    // The items of `marks` under `parent`; returns their count (open items and all below them).
    int write(const std::vector<Bookmark>& marks, Ref parent, Object& parent_dict) {
        std::vector<Ref> refs;
        for (std::size_t i = 0; i < marks.size(); ++i) {
            refs.push_back(xref->addIndirectObject(Object::null()));
        }
        int count = 0;
        for (std::size_t i = 0; i < marks.size(); ++i) {
            const Bookmark& mark = marks[i];
            Object item(std::make_unique<Dict>(xref));
            item.dictSet("Title", Object(text_string(mark.title)));
            item.dictSet("Parent", Object(parent));
            if (i > 0)
                item.dictSet("Prev", Object(refs[i - 1]));
            if (i + 1 < marks.size())
                item.dictSet("Next", Object(refs[i + 1]));
            const int page_count = doc.getNumPages();
            const int page_number = std::clamp(mark.page + 1, 1, std::max(1, page_count));
            if (const Ref* page = doc.getCatalog()->getPageRef(page_number)) {
                const double top = page_height - mark.y;
                auto dest = std::make_unique<Array>(xref);
                dest->add(Object(*page));
                dest->add(Object(objName, "XYZ"));
                dest->add(Object::null());
                dest->add(Object(top));
                dest->add(Object::null());
                item.dictSet("Dest", Object(std::move(dest)));
            }
            int below = 0;
            if (!mark.children.empty())
                below = write(mark.children, refs[i], item);
            // Shown open, as a book's contents are read (positive Count).
            if (below > 0)
                item.dictSet("Count", Object(below));
            count += 1 + below;
            xref->setModifiedObject(&item, refs[i]);
        }
        if (!refs.empty()) {
            parent_dict.dictSet("First", Object(refs.front()));
            parent_dict.dictSet("Last", Object(refs.back()));
        }
        return count;
    }
};

}  // namespace

void write_outline(Document& document, const std::vector<Bookmark>& bookmarks,
                   double page_height_pt) {
    PDFDoc& doc = *document.impl().doc;
    XRef* xref = doc.getXRef();
    Object catalog = xref->getCatalog();
    if (!catalog.isDict())
        return;
    catalog.dictRemove("Outlines");
    if (!bookmarks.empty()) {
        const Ref root = xref->addIndirectObject(Object::null());
        Object outlines(std::make_unique<Dict>(xref));
        outlines.dictSet("Type", Object(objName, "Outlines"));
        Writer writer{doc, xref, page_height_pt};
        const int count = writer.write(bookmarks, root, outlines);
        outlines.dictSet("Count", Object(count));
        xref->setModifiedObject(&outlines, root);
        catalog.dictSet("Outlines", Object(root));
        catalog.dictSet("PageMode", Object(objName, "UseOutlines"));
    }
    xref->setModifiedObject(&catalog, xref->getRoot());
}

}  // namespace mfbe::pdf
