// Feature 014 (research R3, tasks T025, T027): finishing the printed file.

#include "pdf/finish.hpp"

#include "pdf/document.hpp"
#include "pdf/tounicode.hpp"
#include "pdf/xmp.hpp"

#include <Array.h>
#include <Catalog.h>
#include <Dict.h>
#include <Object.h>
#include <Page.h>
#include <Stream.h>
#include <XRef.h>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <goo/GooString.h>
#include <lcms2.h>
#include <random>
#include <set>
#include <stdexcept>
#include <string_view>

namespace mfbe::pdf {
namespace {

// A PDF text string: as it is when plain ASCII, else UTF-16BE with its byte order mark.
std::string text_string(const std::string& utf8) {
    bool ascii = true;
    for (unsigned char c : utf8) {
        if (c >= 0x80 || c < 0x20)
            ascii = false;
    }
    if (ascii)
        return utf8;
    std::string out = "\xFE\xFF";
    for (std::size_t i = 0; i < utf8.size();) {
        unsigned char c = static_cast<unsigned char>(utf8[i]);
        std::uint32_t cp = 0;
        int extra = 0;
        if (c < 0x80)
            cp = c;
        else if ((c >> 5) == 0x6)
            cp = c & 0x1F, extra = 1;
        else if ((c >> 4) == 0xE)
            cp = c & 0x0F, extra = 2;
        else
            cp = c & 0x07, extra = 3;
        ++i;
        for (int k = 0; k < extra && i < utf8.size(); ++k, ++i) {
            cp = (cp << 6) | (static_cast<unsigned char>(utf8[i]) & 0x3F);
        }
        auto unit = [&out](std::uint32_t u) {
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

struct Stamp {
    std::string pdf;  // D:YYYYMMDDHHmmSSZ
    std::string xmp;  // YYYY-MM-DDTHH:mm:SSZ
};

Stamp now() {
    const std::time_t t = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char pdf[32];
    char xmp[32];
    std::strftime(pdf, sizeof pdf, "D:%Y%m%d%H%M%SZ", &tm);
    std::strftime(xmp, sizeof xmp, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return {pdf, xmp};
}

Ref add_stream(XRef* xref, std::string data, std::unique_ptr<Dict> dict) {
    dict->set("Length", Object(static_cast<int>(data.size())));
    auto stream = std::make_unique<AutoFreeMemStream>(std::vector<char>(data.begin(), data.end()),
                                                      Object(std::move(dict)));
    return xref->addIndirectObject(Object(std::move(stream)));
}

std::string srgb_profile() {
    cmsHPROFILE profile = cmsCreate_sRGBProfile();
    if (profile == nullptr)
        throw std::runtime_error("no sRGB profile");
    cmsUInt32Number size = 0;
    cmsSaveProfileToMem(profile, nullptr, &size);
    std::string bytes(size, '\0');
    const bool ok = cmsSaveProfileToMem(profile, bytes.data(), &size) != 0;
    cmsCloseProfile(profile);
    if (!ok || size == 0)
        throw std::runtime_error("the sRGB profile could not be written");
    bytes.resize(size);
    return bytes;
}

// Every ToUnicode map of the pages' fonts, with the ligatures as their letters (D5).
void mend_ligatures(PDFDoc& doc) {
    XRef* xref = doc.getXRef();
    std::set<int> done;
    for (int n = 1; n <= doc.getNumPages(); ++n) {
        Page* page = doc.getPage(n);
        Dict* resources = page ? page->getResourceDict() : nullptr;
        if (!resources)
            continue;
        const Object fonts = resources->lookup("Font");
        if (!fonts.isDict())
            continue;
        for (int i = 0; i < fonts.dictGetLength(); ++i) {
            const Object font = fonts.dictGetVal(i);
            if (!font.isDict())
                continue;
            const Object& map = font.dictLookupNF("ToUnicode");
            if (!map.isRef() || !done.insert(map.getRef().num).second)
                continue;
            Object stream = xref->fetch(map.getRef());
            if (!stream.isStream())
                continue;
            Stream* s = stream.getStream();
            if (!s->rewind())
                continue;
            const std::vector<unsigned char> raw = s->toUnsignedChars();
            s->close();
            const std::string cmap(raw.begin(), raw.end());
            const std::string mended = decompose_ligatures(cmap);
            if (mended == cmap)
                continue;
            auto dict = std::make_unique<Dict>(xref);
            dict->set("Length", Object(static_cast<int>(mended.size())));
            Object replacement(std::make_unique<AutoFreeMemStream>(
                std::vector<char>(mended.begin(), mended.end()), Object(std::move(dict))));
            xref->setModifiedObject(&replacement, map.getRef());
        }
    }
}

// Sets the Print flag (F 4) on every annotation of every page, as PDF/A asks (ISO 19005-2, 6.3.2).
void print_annotations(PDFDoc& doc) {
    XRef* xref = doc.getXRef();
    for (int n = 1; n <= doc.getNumPages(); ++n) {
        const Ref* ref = doc.getCatalog()->getPageRef(n);
        if (ref == nullptr)
            continue;
        const Object page = xref->fetch(*ref);
        const Object& annots = page.dictLookupNF("Annots");
        const Object list = annots.isRef() ? xref->fetch(annots.getRef()) : annots.copy();
        if (!list.isArray())
            continue;
        for (int i = 0; i < list.arrayGetLength(); ++i) {
            const Object& entry = list.arrayGetNF(i);
            if (!entry.isRef())
                continue;
            Object annot = xref->fetch(entry.getRef());
            if (!annot.isDict())
                continue;
            annot.dictSet("F", Object(4));
            xref->setModifiedObject(&annot, entry.getRef());
        }
    }
}

// A random UUID (version 4), for this export's xmpMM:InstanceID.
std::string random_uuid() {
    std::random_device rd;
    std::uniform_int_distribution<int> nibble(0, 15);
    static const char* kHex = "0123456789abcdef";
    std::string out;
    for (int i = 0; i < 32; ++i) {
        int v = nibble(rd);
        if (i == 12)
            v = 4;
        if (i == 16)
            v = 8 + (v & 3);
        out.push_back(kHex[v]);
        if (i == 7 || i == 11 || i == 15 || i == 19)
            out.push_back('-');
    }
    return out;
}

}  // namespace

std::vector<char> finish(std::vector<char> printed, const FinishInput& input,
                         FinishReport* report) {
    std::string error;
    auto document = Document::open_bytes(std::move(printed), &error);
    if (!document)
        throw std::runtime_error("the printed file is not readable: " + error);
    if (document->encrypted())
        throw std::runtime_error("the printed file is encrypted");
    PDFDoc& doc = *document->impl().doc;
    XRef* xref = doc.getXRef();

    // R3 step 2: every page at the exact size of D3 (Chromium rounds it to whole CSS pixels).
    for (int i = 0; i < document->page_count(); ++i) {
        document->set_page_size(i, input.width_pt, input.height_pt);
    }
    // R4: the pictures, from the book's own bytes, into the boxes the paginator left.
    const DrawnPictures drawn = draw_pictures(*document, input.pictures, input.binaries);
    // T028: every picture box is filled, unless its binary was left out (and listed).
    if (drawn.drawn + drawn.skipped != static_cast<int>(input.pictures.size())) {
        throw std::runtime_error("a picture box was not filled");
    }
    if (report)
        report->pictures_left_out = drawn.left_out;
    // R3 step 3: ligatures read as their letters (D5).
    mend_ligatures(doc);
    // D18, PDF/A-2 6.3.2: every annotation (the engine's links) printed and shown.
    print_annotations(doc);

    const Stamp stamp = now();
    // R3 step 5: the output intent, an sRGB profile made by Little CMS.
    auto icc = std::make_unique<Dict>(xref);
    icc->set("N", Object(3));
    const Ref profile = add_stream(xref, srgb_profile(), std::move(icc));
    auto intent = std::make_unique<Dict>(xref);
    intent->set("Type", Object(objName, "OutputIntent"));
    intent->set("S", Object(objName, "GTS_PDFA1"));
    intent->set("OutputConditionIdentifier", Object(std::string("sRGB IEC61966-2.1")));
    intent->set("Info", Object(std::string("sRGB IEC61966-2.1")));
    intent->set("DestOutputProfile", Object(profile));
    const Ref intent_ref = xref->addIndirectObject(Object(std::move(intent)));

    // R3 step 4: the XMP metadata with the PDF/A declaration, and the Info dictionary matching it.
    // D14-D16: the description's values (contracts/pdf-file.md), with the editor's record (DP-10).
    XmpInput xmp;
    if (input.description) {
        xmp.description = *input.description;
    } else {
        xmp.description.titleInfo.bookTitle = input.title;
        xmp.description.titleInfo.lang = input.lang;
    }
    xmp.description_xml = input.description_xml;
    xmp.genre_names = input.genre_names;
    xmp.hints = input.hints;
    xmp.creator_tool = input.creator_tool;
    xmp.instance_id = "uuid:" + random_uuid();
    xmp.date = stamp.xmp;
    auto meta = std::make_unique<Dict>(xref);
    meta->set("Type", Object(objName, "Metadata"));
    meta->set("Subtype", Object(objName, "XML"));
    // DP-10: compressed; Poppler compresses a stream held in memory itself under /FlateDecode.
    meta->set("Filter", Object(objName, "FlateDecode"));
    const Ref metadata = add_stream(xref, xmp_packet(xmp), std::move(meta));
    const InfoValues info = info_values(xmp.description);
    doc.setDocInfoTitle(std::make_unique<GooString>(text_string(info.title)));
    if (!info.author.empty())
        doc.setDocInfoAuthor(std::make_unique<GooString>(text_string(info.author)));
    if (!info.subject.empty())
        doc.setDocInfoSubject(std::make_unique<GooString>(text_string(info.subject)));
    if (!info.keywords.empty())
        doc.setDocInfoKeywords(std::make_unique<GooString>(text_string(info.keywords)));
    doc.setDocInfoCreator(std::make_unique<GooString>(text_string(input.creator_tool)));
    doc.setDocInfoProducer(std::make_unique<GooString>(text_string(input.creator_tool)));
    doc.setDocInfoCreatDate(std::make_unique<GooString>(stamp.pdf));
    doc.setDocInfoModDate(std::make_unique<GooString>(stamp.pdf));

    Object catalog = xref->getCatalog();
    if (!catalog.isDict())
        throw std::runtime_error("the printed file has no catalog");
    catalog.dictSet("Metadata", Object(metadata));
    auto intents = std::make_unique<Array>(xref);
    intents->add(Object(intent_ref));
    catalog.dictSet("OutputIntents", Object(std::move(intents)));
    catalog.dictSet("Lang", Object(std::string(input.lang)));
    auto preferences = std::make_unique<Dict>(xref);
    preferences->set("DisplayDocTitle", Object(true));
    catalog.dictSet("ViewerPreferences", Object(std::move(preferences)));
    // contracts/pdf-file.md: a PDF 1.7 file, as PDF/A-2 builds on ISO 32000-1 (PDF 1.7).
    catalog.dictSet("Version", Object(objName, "1.7"));
    xref->setModifiedObject(&catalog, xref->getRoot());

    std::vector<char> finished = document->save();
    if (finished.empty())
        throw std::runtime_error("the finished file could not be written");
    // Poppler writes the header the file was opened with (Chromium's %PDF-1.4); the version is
    // one digit at byte 7, so it is set in place without moving anything after it.
    if (finished.size() > 8 && std::string_view(finished.data(), 7) == "%PDF-1." &&
        finished[7] < '7') {
        finished[7] = '7';
    }
    return finished;
}

}  // namespace mfbe::pdf
