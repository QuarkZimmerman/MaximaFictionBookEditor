// Feature 014 (D12, research R4, tasks T026): the pictures, drawn by the core.

#include "pdf/pictures.hpp"

#include "pdf/document.hpp"

#include <mfbe/images.hpp>

#include <Array.h>
#include <Dict.h>
#include <Object.h>
#include <Page.h>
#include <Stream.h>
#include <XRef.h>
#include <cstdio>
#include <optional>

namespace mfbe::pdf {
namespace {

constexpr std::uint64_t kMaxPixels = 100'000'000;  // DP-19

struct JpegInfo {
    int width = 0;
    int height = 0;
    int components = 0;
};

// The frame header of a JPEG (SOF0, SOF1 or SOF2): its size and number of components.
std::optional<JpegInfo> jpeg_info(const std::string& b) {
    if (b.size() < 4 || static_cast<unsigned char>(b[0]) != 0xFF ||
        static_cast<unsigned char>(b[1]) != 0xD8) {
        return std::nullopt;
    }
    std::size_t at = 2;
    while (at + 4 <= b.size()) {
        if (static_cast<unsigned char>(b[at]) != 0xFF)
            return std::nullopt;
        const unsigned char marker = static_cast<unsigned char>(b[at + 1]);
        if (marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
            at += 2;
            continue;
        }
        const std::size_t length =
            (static_cast<unsigned char>(b[at + 2]) << 8) | static_cast<unsigned char>(b[at + 3]);
        if (marker == 0xC0 || marker == 0xC1 || marker == 0xC2) {
            if (at + 2 + length > b.size() || length < 8)
                return std::nullopt;
            JpegInfo info;
            info.height = (static_cast<unsigned char>(b[at + 5]) << 8) |
                          static_cast<unsigned char>(b[at + 6]);
            info.width = (static_cast<unsigned char>(b[at + 7]) << 8) |
                         static_cast<unsigned char>(b[at + 8]);
            info.components = static_cast<unsigned char>(b[at + 9]);
            return info;
        }
        if (marker == 0xDA || length < 2)
            return std::nullopt;
        at += 2 + length;
    }
    return std::nullopt;
}

// Poppler writes a stream held in memory unencoded (PDFDoc::writeObject): under /FlateDecode it
// compresses the bytes itself, and any other filter it drops unless the stream forbids that. So
// pixels go in decoded under /FlateDecode, and a JPEG goes in as it is with its /DCTDecode kept.
Ref add_stream(XRef* xref, std::vector<char> data, std::unique_ptr<Dict> dict, bool keep_filter) {
    dict->set("Length", Object(static_cast<int>(data.size())));
    auto stream = std::make_unique<AutoFreeMemStream>(std::move(data), Object(std::move(dict)));
    stream->setFilterRemovalForbidden(keep_filter);
    return xref->addIndirectObject(Object(std::move(stream)));
}

std::unique_ptr<Dict> image_dict(XRef* xref, int width, int height, const char* space,
                                 const char* filter) {
    auto dict = std::make_unique<Dict>(xref);
    dict->set("Type", Object(objName, "XObject"));
    dict->set("Subtype", Object(objName, "Image"));
    dict->set("Width", Object(width));
    dict->set("Height", Object(height));
    dict->set("ColorSpace", Object(objName, space));
    dict->set("BitsPerComponent", Object(8));
    dict->set("Filter", Object(objName, filter));
    return dict;
}

// One image object for `bytes`: a colour or greyscale JPEG as it is, anything else with its exact
// pixels (RGB, and the alpha as a soft mask when a pixel is not opaque).
std::optional<Ref> image_object(XRef* xref, const std::string& bytes) {
    if (const auto jpeg = jpeg_info(bytes);
        jpeg && (jpeg->components == 1 || jpeg->components == 3)) {
        if (static_cast<std::uint64_t>(jpeg->width) * jpeg->height > kMaxPixels) {
            return std::nullopt;
        }
        return add_stream(
            xref, std::vector<char>(bytes.begin(), bytes.end()),
            image_dict(xref, jpeg->width, jpeg->height,
                       jpeg->components == 1 ? "DeviceGray" : "DeviceRGB", "DCTDecode"),
            true);
    }
    const auto bitmap = images::try_decode(bytes);
    if (!bitmap || bitmap->width <= 0 || bitmap->height <= 0 ||
        static_cast<std::uint64_t>(bitmap->width) * bitmap->height > kMaxPixels) {
        return std::nullopt;
    }
    const std::size_t pixels = static_cast<std::size_t>(bitmap->width) * bitmap->height;
    std::vector<char> rgb(pixels * 3);
    std::vector<char> alpha(pixels);
    bool transparent = false;
    for (std::size_t i = 0; i < pixels; ++i) {
        rgb[i * 3] = static_cast<char>(bitmap->rgba[i * 4]);
        rgb[i * 3 + 1] = static_cast<char>(bitmap->rgba[i * 4 + 1]);
        rgb[i * 3 + 2] = static_cast<char>(bitmap->rgba[i * 4 + 2]);
        alpha[i] = static_cast<char>(bitmap->rgba[i * 4 + 3]);
        transparent = transparent || bitmap->rgba[i * 4 + 3] != 255;
    }
    auto dict = image_dict(xref, bitmap->width, bitmap->height, "DeviceRGB", "FlateDecode");
    if (transparent) {
        const Ref mask = add_stream(
            xref, std::move(alpha),
            image_dict(xref, bitmap->width, bitmap->height, "DeviceGray", "FlateDecode"), false);
        dict->set("SMask", Object(mask));
    }
    return add_stream(xref, std::move(rgb), std::move(dict), false);
}

// The object a page entry stands for, and the reference to write it back to (none: direct).
struct Holder {
    Object object;
    std::optional<Ref> ref;
};

Holder resolve(XRef* xref, const Object& entry) {
    Holder h;
    if (entry.isRef()) {
        h.ref = entry.getRef();
        h.object = xref->fetch(entry.getRef());
    } else {
        h.object = entry.copy();
    }
    return h;
}

}  // namespace

DrawnPictures draw_pictures(Document& document, const std::vector<PlacedPicture>& pictures,
                            const std::map<std::string, std::string>& binaries) {
    DrawnPictures result;
    PDFDoc& doc = *document.impl().doc;
    XRef* xref = doc.getXRef();
    std::map<std::string, std::optional<Ref>> objects;
    std::map<int, std::vector<const PlacedPicture*>> by_page;
    for (const PlacedPicture& p : pictures)
        by_page[p.page].push_back(&p);

    for (const auto& [index, placed] : by_page) {
        Page* page = (index >= 0 && index < doc.getNumPages()) ? doc.getPage(index + 1) : nullptr;
        if (!page)
            continue;
        const double page_height = page->getMediaBox()->y2 - page->getMediaBox()->y1;
        std::string content;
        std::map<std::string, Ref> names;
        for (const PlacedPicture* p : placed) {
            auto found = objects.find(p->binary_id);
            if (found == objects.end()) {
                const auto bytes = binaries.find(p->binary_id);
                std::optional<Ref> ref;
                if (bytes != binaries.end())
                    ref = image_object(xref, bytes->second);
                if (!ref)
                    result.left_out.push_back(p->binary_id);
                found = objects.emplace(p->binary_id, ref).first;
            }
            if (!found->second) {
                ++result.skipped;
                continue;
            }
            ++result.drawn;
            const std::string name = "MfbeIm" + std::to_string(found->second->num);
            names.emplace(name, *found->second);
            char line[256];
            std::snprintf(line, sizeof line, "q %.4f 0 0 %.4f %.4f %.4f cm /%s Do Q\n", p->width,
                          p->height, p->x, page_height - p->y - p->height, name.c_str());
            content += line;
        }
        if (content.empty())
            continue;

        const Ref page_ref = page->getRef();
        Object page_dict = xref->fetch(page_ref);
        // The drawing goes after the page's own content.
        const Ref drawing = add_stream(xref, std::vector<char>(content.begin(), content.end()),
                                       std::make_unique<Dict>(xref), false);
        auto contents = std::make_unique<Array>(xref);
        const Object& old = page_dict.dictLookupNF("Contents");
        if (old.isArray()) {
            for (int i = 0; i < old.arrayGetLength(); ++i)
                contents->add(old.arrayGetNF(i).copy());
        } else if (old.isRef()) {
            contents->add(old.copy());
        }
        contents->add(Object(drawing));
        page_dict.dictSet("Contents", Object(std::move(contents)));

        // The image objects in the page's resources (indirect ones written back as such).
        Holder resources = resolve(xref, page_dict.dictLookupNF("Resources"));
        if (!resources.object.isDict())
            resources.object = Object(std::make_unique<Dict>(xref));
        Holder xobjects = resolve(xref, resources.object.dictLookupNF("XObject"));
        if (!xobjects.object.isDict())
            xobjects.object = Object(std::make_unique<Dict>(xref));
        for (const auto& [name, ref] : names)
            xobjects.object.dictSet(name, Object(ref));
        if (xobjects.ref) {
            xref->setModifiedObject(&xobjects.object, *xobjects.ref);
        } else {
            resources.object.dictSet("XObject", std::move(xobjects.object));
        }
        if (resources.ref) {
            xref->setModifiedObject(&resources.object, *resources.ref);
        } else {
            page_dict.dictSet("Resources", std::move(resources.object));
        }
        xref->setModifiedObject(&page_dict, page_ref);
    }
    return result;
}

}  // namespace mfbe::pdf
