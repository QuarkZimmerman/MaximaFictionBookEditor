// Feature 014 (research R3 step 9, plan DP-18, tasks T028): the export's own check.

#include "pdf/check.hpp"

#include "pdf/document.hpp"

#include <mfbe/pdf.hpp>

#include <Catalog.h>
#include <Link.h>
#include <Object.h>
#include <PDFDoc.h>
#include <XRef.h>
#include <cctype>
#include <goo/GooString.h>

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
        std::string read = comparable(doc->page_text(i));
        // The page number at the foot is drawn but is not the page map's text; Poppler reads it in
        // wherever its position falls in the page's reading order, so it is accepted once there.
        const std::string number = std::to_string(i + 1);
        if (read != expected && read.size() == expected.size() + number.size()) {
            std::size_t at = 0;
            while (at < expected.size() && read[at] == expected[at])
                ++at;
            if (read.compare(at, number.size(), number) == 0 &&
                read.compare(at + number.size(), std::string::npos, expected, at) == 0) {
                read = expected;
            }
        }
        if (read != expected) {
            std::size_t at = 0;
            while (at < read.size() && at < expected.size() && read[at] == expected[at])
                ++at;
            // Back to the start of a UTF-8 character, then a short stretch of each.
            while (at > 0 && (static_cast<unsigned char>(expected[at]) & 0xC0) == 0x80)
                --at;
            faults.push_back("page " + std::to_string(i + 1) +
                             ": its text differs from the page at \"" + expected.substr(at, 80) +
                             "\" (read: \"" + read.substr(at, 80) + "\")");
        }
        if (progress) {
            progress(i + 1, doc->page_count());
        }
        if (faults.size() > 20)
            break;
    }
    return faults;
}

}  // namespace mfbe::pdf
