#pragma once
// Feature 014 (D14-D16, DP-10, contracts/pdf-file.md "Metadata"; tasks T034, T035): the PDF's
// metadata from the book's description - the XMP packet, with the editor's own record, and the
// Info dictionary's values, which must equal it (PDF/A-2, ISO 19005-2 6.6.2.3).

#include <mfbe/document.hpp>

#include <string>
#include <vector>

namespace mfbe::pdf {

/// The editor's namespace for its record (DP-10).
inline constexpr const char* kMfbeNamespace =
    "https://github.com/QuarkZimmerman/MaximaFictionBookEditor/ns/pdf/1/";
/// Calibre's namespaces for the series (DP-11; calibre/ebooks/metadata/xmp.py, NS_MAP).
inline constexpr const char* kCalibreNamespace = "http://calibre-ebook.com/xmp-namespace";
inline constexpr const char* kCalibreSeriesIndexNamespace =
    "http://calibre-ebook.com/xmp-namespace-series-index";

struct XmpInput {
    model::Description description;
    std::string description_xml;           // the <description> element as FB2 XML (D15)
    std::vector<std::string> genre_names;  // the genres, named in the book's language (012 D6)
    std::string hints;                     // mfbe:fb2Hints, JSON (R10); empty: none
    std::string creator_tool;              // the editor's name and version
    std::string instance_id;               // this export's own uuid: id
    std::string date;                      // the export's time, YYYY-MM-DDTHH:MM:SSZ
};

struct InfoValues {
    std::string title;
    std::string author;   // the authors, joined by ", "
    std::string subject;  // the annotation as plain text
    std::string keywords;
};

/// The whole XMP packet (UTF-8).
std::string xmp_packet(const XmpInput& input);

/// The Info dictionary's values, as the XMP holds them.
InfoValues info_values(const model::Description& description);

/// A person as the metadata name them: "First Middle Last", else the nickname.
std::string person_name(const model::Person& person);

/// The text of a node and its children, blocks on lines of their own, spaces squeezed.
std::string plain_text(const model::Node& node);

/// xmpMM:DocumentID for the FB2 id: "uuid:" and the UUID when it is one, else the id as it is.
std::string document_id(const std::string& fb2_id);

/// `text` escaped for XML, without the characters XML forbids (D22).
std::string xml_text(const std::string& text);

}  // namespace mfbe::pdf
