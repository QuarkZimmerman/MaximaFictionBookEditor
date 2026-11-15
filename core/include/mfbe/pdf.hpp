#pragma once
// Feature 014 (plan PD2, tasks T010): the editor's PDF interface. Poppler, the library the
// requester chose, stays behind it in core/src/pdf/; no other part of the editor includes a Poppler
// header, so a later version of Poppler's core interface (marked unstable) touches that folder
// only.

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace mfbe::pdf {

/// One font a page uses, as its resource dictionary declares it.
struct FontInfo {
    std::string resource;     // the resource name, e.g. "F5"
    std::string base_font;    // BaseFont, subset tag included ("AAAAAA+NotoSerif-Regular")
    std::string subtype;      // Type0, TrueType, Type1, Type3...
    std::string descendant;   // a Type0 font's descendant subtype (CIDFontType2...), else empty
    bool embedded = false;    // its program is in the file (Type3 glyphs always are)
    bool to_unicode = false;  // it carries a ToUnicode map
};

/// One annotation of a page.
struct AnnotInfo {
    std::string subtype;  // Link, ...
    int flags = 0;        // F
    std::string dest;     // a named destination (name or string), else empty
    std::string uri;      // a URI action's address, else empty
};

/// A page's size (its MediaBox, in points) with its fonts and annotations.
struct PageInfo {
    double width_pt = 0;
    double height_pt = 0;
    std::vector<FontInfo> fonts;
    std::vector<AnnotInfo> annots;
};

/// An opened PDF, held in memory. Pages are counted from 0.
class Document {
public:
    /// Opens the PDF in `bytes`; nullptr, with `error` set, when Poppler cannot read it.
    static std::unique_ptr<Document> open_bytes(std::vector<char> bytes, std::string* error);
    /// Reads the file through the standard library (any path the platform layer gives), then
    /// opens it as open_bytes does.
    static std::unique_ptr<Document> open_file(const std::filesystem::path& path,
                                               std::string* error);
    ~Document();
    Document(const Document&) = delete;
    Document& operator=(const Document&) = delete;

    int page_count() const;
    PageInfo page_info(int index) const;
    /// The page's text in reading order, UTF-8, as Poppler's text output gives it.
    std::string page_text(int index) const;
    /// The header's version, "1.4".
    std::string header_version() const;
    bool encrypted() const;

    /// Sets the page's MediaBox and CropBox to [0 0 width height].
    void set_page_size(int index, double width_pt, double height_pt);
    /// Writes the whole document anew (no incremental update); empty when Poppler fails.
    std::vector<char> save() const;

    /// The Poppler side, for the other modules of core/src/pdf/ only (document.hpp).
    struct Impl;
    Impl& impl() { return *impl_; }
    const Impl& impl() const { return *impl_; }

private:
    explicit Document(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> impl_;
};

}  // namespace mfbe::pdf
