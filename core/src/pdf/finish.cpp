// Feature 014 (research R3, tasks T025, T027): finishing the printed file.

#include "pdf/finish.hpp"

#include "pdf/document.hpp"
#include "pdf/tounicode.hpp"

#include <Array.h>
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
#include <set>
#include <stdexcept>

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

std::string xml_escape(const std::string& text) {
    std::string out;
    for (char c : text) {
        switch (c) {
            case '<':
                out += "&lt;";
                break;
            case '>':
                out += "&gt;";
                break;
            case '&':
                out += "&amp;";
                break;
            case '"':
                out += "&quot;";
                break;
            default:
                // Characters XML forbids are left out (D22).
                if (static_cast<unsigned char>(c) >= 0x20 || c == '\t' || c == '\n')
                    out += c;
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

std::string xmp_packet(const FinishInput& input, const Stamp& stamp) {
    const std::string lang = input.lang.empty() ? "x-default" : xml_escape(input.lang);
    std::string out = "<?xpacket begin=\"\xEF\xBB\xBF\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n";
    out +=
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF "
        "xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n";
    out +=
        "<rdf:Description rdf:about=\"\" xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\" "
        "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" "
        "xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\">\n";
    out += "<pdfaid:part>2</pdfaid:part><pdfaid:conformance>U</pdfaid:conformance>\n";
    out += "<dc:format>application/pdf</dc:format>\n";
    out += "<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">" + xml_escape(input.title) +
           "</rdf:li>";
    if (!input.lang.empty()) {
        out += "<rdf:li xml:lang=\"" + lang + "\">" + xml_escape(input.title) + "</rdf:li>";
    }
    out += "</rdf:Alt></dc:title>\n";
    if (!input.lang.empty()) {
        out += "<dc:language><rdf:Bag><rdf:li>" + lang + "</rdf:li></rdf:Bag></dc:language>\n";
    }
    out += "<xmp:CreatorTool>" + xml_escape(input.creator_tool) + "</xmp:CreatorTool>\n";
    out += "<xmp:CreateDate>" + stamp.xmp + "</xmp:CreateDate><xmp:ModifyDate>" + stamp.xmp +
           "</xmp:ModifyDate><xmp:MetadataDate>" + stamp.xmp + "</xmp:MetadataDate>\n";
    out += "<pdf:Producer>" + xml_escape(input.creator_tool) + "</pdf:Producer>\n";
    out += "</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end=\"w\"?>";
    return out;
}

}  // namespace

std::vector<char> finish(std::vector<char> printed, const FinishInput& input) {
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
    draw_pictures(*document, input.pictures, input.binaries);
    // R3 step 3: ligatures read as their letters (D5).
    mend_ligatures(doc);

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
    auto meta = std::make_unique<Dict>(xref);
    meta->set("Type", Object(objName, "Metadata"));
    meta->set("Subtype", Object(objName, "XML"));
    const Ref metadata = add_stream(xref, xmp_packet(input, stamp), std::move(meta));
    doc.setDocInfoTitle(std::make_unique<GooString>(text_string(input.title)));
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
    xref->setModifiedObject(&catalog, xref->getRoot());

    std::vector<char> finished = document->save();
    if (finished.empty())
        throw std::runtime_error("the finished file could not be written");
    return finished;
}

}  // namespace mfbe::pdf
