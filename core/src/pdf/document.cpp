// Feature 014 (plan PD2, research R2, tasks T010): mfbe::pdf::Document on Poppler's core
// interface (the vcpkg port's private-api headers, poppler 26.4.0).

#include "pdf/document.hpp"

#include <Array.h>
#include <Dict.h>
#include <Error.h>
#include <GlobalParams.h>
#include <Object.h>
#include <Page.h>
#include <Stream.h>
#include <TextOutputDev.h>
#include <XRef.h>
#include <cstdarg>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <mutex>
#include <span>

namespace mfbe::pdf {

namespace {

/// Poppler writes through an OutStream; this one fills a vector, so that the file itself is
/// written by the editor's own atomic writer, with its own path handling.
class VectorOutStream final : public OutStream {
public:
    std::vector<char> data;

    void close() override {}
    Goffset getPos() override { return static_cast<Goffset>(data.size()); }
    void put(char c) override { data.push_back(c); }
    size_t write(std::span<const unsigned char> bytes) override {
        data.insert(data.end(), bytes.begin(), bytes.end());
        return bytes.size();
    }
    void printf(const char* format, ...) override {
        va_list args;
        va_start(args, format);
        va_list measure;
        va_copy(measure, args);
        const int length = std::vsnprintf(nullptr, 0, format, measure);
        va_end(measure);
        if (length > 0) {
            const size_t at = data.size();
            data.resize(at + static_cast<size_t>(length) + 1);
            std::vsnprintf(data.data() + at, static_cast<size_t>(length) + 1, format, args);
            data.resize(at + static_cast<size_t>(length));
        }
        va_end(args);
    }
};

void append_text(void* stream, const char* text, int length) {
    if (length > 0)
        static_cast<std::string*>(stream)->append(text, static_cast<size_t>(length));
}

std::string name_or_string(const Object& object) {
    if (object.isName())
        return object.getNameString();
    if (object.isString())
        return object.getString();
    return {};
}

bool has_font_program(const Object& descriptor) {
    if (!descriptor.isDict())
        return false;
    for (const char* key : {"FontFile", "FontFile2", "FontFile3"}) {
        if (!descriptor.dictLookupNF(key).isNull())
            return true;
    }
    return false;
}

FontInfo font_info(const std::string& resource, const Object& font) {
    FontInfo info;
    info.resource = resource;
    info.subtype = name_or_string(font.dictLookup("Subtype"));
    info.base_font = name_or_string(font.dictLookup("BaseFont"));
    info.to_unicode = !font.dictLookupNF("ToUnicode").isNull();
    if (info.subtype == "Type3") {
        info.embedded = true;  // its glyphs are content streams of the file
    } else if (info.subtype == "Type0") {
        const Object descendants = font.dictLookup("DescendantFonts");
        if (descendants.isArray() && descendants.arrayGetLength() > 0) {
            const Object descendant = descendants.arrayGet(0, 0);
            info.descendant = name_or_string(descendant.dictLookup("Subtype"));
            info.embedded = has_font_program(descendant.dictLookup("FontDescriptor"));
        }
    } else {
        info.embedded = has_font_program(font.dictLookup("FontDescriptor"));
    }
    return info;
}

Page* page_at(PDFDoc& doc, int index) {
    if (index < 0 || index >= doc.getNumPages())
        return nullptr;
    return doc.getPage(index + 1);
}

}  // namespace

void init_poppler() {
    static std::once_flag once;
    std::call_once(once, [] {
        if (!globalParams)
            globalParams = std::make_unique<GlobalParams>();
        setErrorCallback([](ErrorCategory, Goffset, const char*) {});
    });
}

Document::Document(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
Document::~Document() = default;

std::unique_ptr<Document> Document::open_bytes(std::vector<char> bytes, std::string* error) {
    init_poppler();
    if (bytes.empty()) {
        if (error)
            *error = "the file is empty";
        return nullptr;
    }
    auto stream = std::make_unique<AutoFreeMemStream>(std::move(bytes), Object::null());
    auto doc = std::make_unique<PDFDoc>(std::move(stream));
    if (!doc->isOk()) {
        if (error)
            *error =
                "not a readable PDF (Poppler error " + std::to_string(doc->getErrorCode()) + ")";
        return nullptr;
    }
    auto impl = std::make_unique<Impl>();
    impl->doc = std::move(doc);
    return std::unique_ptr<Document>(new Document(std::move(impl)));
}

std::unique_ptr<Document> Document::open_file(const std::filesystem::path& path,
                                              std::string* error) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        if (error)
            *error = "the file cannot be opened";
        return nullptr;
    }
    std::vector<char> bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    return open_bytes(std::move(bytes), error);
}

int Document::page_count() const {
    return impl_->doc->getNumPages();
}

PageInfo Document::page_info(int index) const {
    PageInfo info;
    Page* page = page_at(*impl_->doc, index);
    if (!page)
        return info;
    const PDFRectangle* box = page->getMediaBox();
    info.width_pt = box->x2 - box->x1;
    info.height_pt = box->y2 - box->y1;
    if (Dict* resources = page->getResourceDict()) {
        const Object fonts = resources->lookup("Font");
        if (fonts.isDict()) {
            for (int i = 0; i < fonts.dictGetLength(); ++i) {
                const Object font = fonts.dictGetVal(i);
                if (font.isDict())
                    info.fonts.push_back(font_info(fonts.dictGetKey(i), font));
            }
        }
    }
    const Object annots = page->getAnnotsObject();
    if (annots.isArray()) {
        for (int i = 0; i < annots.arrayGetLength(); ++i) {
            const Object annot = annots.arrayGet(i, 0);
            if (!annot.isDict())
                continue;
            AnnotInfo a;
            a.subtype = name_or_string(annot.dictLookup("Subtype"));
            const Object flags = annot.dictLookup("F");
            a.flags = flags.isInt() ? flags.getInt() : 0;
            a.dest = name_or_string(annot.dictLookup("Dest"));
            const Object action = annot.dictLookup("A");
            if (action.isDict() && name_or_string(action.dictLookup("S")) == "URI") {
                a.uri = name_or_string(action.dictLookup("URI"));
            }
            info.annots.push_back(std::move(a));
        }
    }
    return info;
}

std::string Document::page_text(int index) const {
    std::string text;
    if (index < 0 || index >= page_count())
        return text;
    TextOutputDev device(&append_text, &text, /*physLayoutA=*/false, /*fixedPitchA=*/0,
                         /*rawOrderA=*/false);
    if (!device.isOk())
        return text;
    impl_->doc->displayPage(&device, index + 1, 72, 72, 0, /*useMediaBox=*/true, /*crop=*/false,
                            /*printing=*/false);
    return text;
}

std::string Document::header_version() const {
    return std::to_string(impl_->doc->getPDFMajorVersion()) + "." +
           std::to_string(impl_->doc->getPDFMinorVersion());
}

bool Document::encrypted() const {
    return impl_->doc->isEncrypted();
}

void Document::set_page_size(int index, double width_pt, double height_pt) {
    Page* page = page_at(*impl_->doc, index);
    if (!page)
        return;
    XRef* xref = impl_->doc->getXRef();
    const Ref ref = page->getRef();
    Object page_dict = xref->fetch(ref);
    if (!page_dict.isDict())
        return;
    for (const char* key : {"MediaBox", "CropBox"}) {
        auto box = std::make_unique<Array>(xref);
        box->add(Object(0));
        box->add(Object(0));
        box->add(Object(width_pt));
        box->add(Object(height_pt));
        page_dict.dictSet(key, Object(std::move(box)));
    }
    xref->setModifiedObject(&page_dict, ref);
}

std::vector<char> Document::save() const {
    VectorOutStream out;
    if (impl_->doc->saveAs(&out, writeForceRewrite) != errNone)
        return {};
    return std::move(out.data);
}

}  // namespace mfbe::pdf
