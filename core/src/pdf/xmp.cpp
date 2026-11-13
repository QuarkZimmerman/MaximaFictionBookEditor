// Feature 014 (D14-D16, DP-10, contracts/pdf-file.md "Metadata"; tasks T034, T035).

#include "pdf/xmp.hpp"

#include "pdf/check.hpp"

#include <nlohmann/json.hpp>

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <initializer_list>
#include <sstream>

namespace mfbe::pdf {
namespace {

void append_utf8(std::string& out, std::uint32_t cp) {
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

// XML 1.0's characters: tab, line feed, carriage return, and U+0020 upwards but the surrogates
// and U+FFFE, U+FFFF.
bool xml_char(std::uint32_t cp) {
    return cp == 0x9 || cp == 0xA || cp == 0xD || (cp >= 0x20 && cp <= 0xD7FF) ||
           (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF);
}

// Spaces squeezed, and the control characters XML forbids left out, so that the Info values and
// the XMP hold the same text (PDF/A-2 6.6.2.3).
std::string squeeze(const std::string& text) {
    std::string out;
    bool space = false;
    for (char c : text) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            space = !out.empty();
            continue;
        }
        if (static_cast<unsigned char>(c) < 0x20)
            continue;
        if (space)
            out.push_back(' ');
        space = false;
        out.push_back(c);
    }
    return out;
}

void collect(const model::Node& node, std::string& out) {
    if (node.is_text()) {
        out += node.text;
        return;
    }
    static const char* kBlocks[] = {"p",    "v",          "subtitle", "text-author",
                                    "date", "empty-line", "title"};
    bool block = false;
    for (const char* name : kBlocks)
        block = block || node.type == name;
    if (block && !out.empty() && out.back() != '\n')
        out.push_back('\n');
    for (const model::Node& child : node.content)
        collect(child, out);
    if (block && !out.empty() && out.back() != '\n')
        out.push_back('\n');
}

std::string li(const std::string& value) {
    return "<rdf:li>" + xml_text(value) + "</rdf:li>";
}

std::string bag(const char* property, const std::vector<std::string>& values,
                const char* kind = "Bag") {
    if (values.empty())
        return {};
    std::string out = std::string("<") + property + "><rdf:" + kind + ">";
    for (const std::string& v : values)
        out += li(v);
    return out + "</rdf:" + kind + "></" + property + ">\n";
}

std::vector<std::string> keywords_of(const std::string& keywords) {
    std::vector<std::string> out;
    std::stringstream in(keywords);
    std::string part;
    while (std::getline(in, part, ',')) {
        part = squeeze(part);
        if (!part.empty())
            out.push_back(part);
    }
    return out;
}

bool is_uuid(const std::string& id) {
    if (id.size() != 36)
        return false;
    for (std::size_t i = 0; i < id.size(); ++i) {
        const bool dash = i == 8 || i == 13 || i == 18 || i == 23;
        if (dash ? id[i] != '-' : !std::isxdigit(static_cast<unsigned char>(id[i])))
            return false;
    }
    return true;
}

}  // namespace

std::string xml_text(const std::string& text) {
    std::string out;
    for (std::size_t i = 0; i < text.size();) {
        const unsigned char c = static_cast<unsigned char>(text[i]);
        const int extra = c < 0x80           ? 0
                          : (c >> 5) == 0x6  ? 1
                          : (c >> 4) == 0xE  ? 2
                          : (c >> 3) == 0x1E ? 3
                                             : -1;
        if (extra < 0 || i + static_cast<std::size_t>(extra) >= text.size()) {
            ++i;  // not UTF-8: left out
            continue;
        }
        std::uint32_t cp = extra == 0 ? c : c & (0x3F >> extra);
        for (int k = 1; k <= extra; ++k)
            cp = (cp << 6) | (static_cast<unsigned char>(text[i + k]) & 0x3F);
        i += static_cast<std::size_t>(extra) + 1;
        if (!xml_char(cp))
            continue;  // D22: characters XML forbids are dropped
        switch (cp) {
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
                append_utf8(out, cp);
        }
    }
    return out;
}

std::string person_name(const model::Person& person) {
    std::string name;
    for (const auto* part : {&person.firstName, &person.middleName, &person.lastName}) {
        if (*part && !squeeze(**part).empty())
            name += (name.empty() ? "" : " ") + squeeze(**part);
    }
    if (name.empty() && person.nickname)
        name = squeeze(*person.nickname);
    return name;
}

std::string plain_text(const model::Node& node) {
    std::string text;
    collect(node, text);
    std::string out;
    std::stringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
        line = squeeze(line);
        if (!line.empty())
            out += (out.empty() ? "" : "\n") + line;
    }
    return out;
}

std::string document_id(const std::string& fb2_id) {
    const std::string id = squeeze(fb2_id);
    return is_uuid(id) ? "uuid:" + id : id;
}

InfoValues info_values(const model::Description& description) {
    const model::TitleInfo& t = description.titleInfo;
    InfoValues info;
    info.title = squeeze(t.bookTitle);
    for (const model::Person& author : t.authors) {
        const std::string name = person_name(author);
        if (!name.empty())
            info.author += (info.author.empty() ? "" : ", ") + name;
    }
    if (t.annotation)
        info.subject = plain_text(*t.annotation);
    if (t.keywords)
        info.keywords = squeeze(*t.keywords);
    return info;
}

std::string xmp_packet(const XmpInput& input) {
    const model::Description& d = input.description;
    const model::TitleInfo& t = d.titleInfo;
    const InfoValues info = info_values(d);
    const std::string lang = squeeze(t.lang);
    std::string out = "<?xpacket begin=\"\xEF\xBB\xBF\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n";
    out +=
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF "
        "xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n";
    out +=
        "<rdf:Description rdf:about=\"\" xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\" "
        "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" "
        "xmlns:xmpMM=\"http://ns.adobe.com/xap/1.0/mm/\" "
        "xmlns:xmpidq=\"http://ns.adobe.com/xmp/Identifier/qual/1.0/\" "
        "xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\" "
        "xmlns:pdfaExtension=\"http://www.aiim.org/pdfa/ns/extension/\" "
        "xmlns:pdfaSchema=\"http://www.aiim.org/pdfa/ns/schema#\" "
        "xmlns:pdfaProperty=\"http://www.aiim.org/pdfa/ns/property#\" "
        "xmlns:calibre=\"" +
        std::string(kCalibreNamespace) + "\" xmlns:calibreSI=\"" +
        std::string(kCalibreSeriesIndexNamespace) + "\" xmlns:mfbe=\"" +
        std::string(kMfbeNamespace) + "\">\n";
    out += "<pdfaid:part>2</pdfaid:part><pdfaid:conformance>U</pdfaid:conformance>\n";
    out += "<dc:format>application/pdf</dc:format>\n";
    // D14: the title, in the default language and the book's own.
    out +=
        "<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">" + xml_text(info.title) + "</rdf:li>";
    if (!lang.empty()) {
        out += "<rdf:li xml:lang=\"" + xml_text(lang) + "\">" + xml_text(info.title) + "</rdf:li>";
    }
    out += "</rdf:Alt></dc:title>\n";
    std::vector<std::string> creators;
    for (const model::Person& a : t.authors) {
        if (const std::string n = person_name(a); !n.empty())
            creators.push_back(n);
    }
    out += bag("dc:creator", creators, "Seq");
    if (!info.subject.empty()) {
        out += "<dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">" + xml_text(info.subject) +
               "</rdf:li></rdf:Alt></dc:description>\n";
    }
    std::vector<std::string> subjects = input.genre_names;
    for (const std::string& k : keywords_of(info.keywords))
        subjects.push_back(k);
    out += bag("dc:subject", subjects);
    if (!lang.empty())
        out += bag("dc:language", {lang});
    if (t.date) {
        const std::string date =
            t.date->value && !t.date->value->empty() ? *t.date->value : squeeze(t.date->text);
        if (!date.empty())
            out += bag("dc:date", {date}, "Seq");
    }
    if (d.publishInfo && d.publishInfo->publisher && !squeeze(*d.publishInfo->publisher).empty()) {
        out += bag("dc:publisher", {squeeze(*d.publishInfo->publisher)});
    }
    std::vector<std::string> translators;
    for (const model::Person& p : t.translators) {
        if (const std::string n = person_name(p); !n.empty())
            translators.push_back(n);
    }
    out += bag("dc:contributor", translators);
    const std::string id = document_id(d.documentInfo.id);
    if (!id.empty()) {
        out += "<dc:identifier>" + xml_text(id) + "</dc:identifier>\n";
        out += "<xmpMM:DocumentID>" + xml_text(id) + "</xmpMM:DocumentID>\n";
    }
    out += "<xmpMM:InstanceID>" + xml_text(input.instance_id) + "</xmpMM:InstanceID>\n";
    if (d.publishInfo && d.publishInfo->isbn && !squeeze(*d.publishInfo->isbn).empty()) {
        out +=
            "<xmp:Identifier><rdf:Bag><rdf:li rdf:parseType=\"Resource\"><xmpidq:Scheme>ISBN"
            "</xmpidq:Scheme><rdf:value>" +
            xml_text(squeeze(*d.publishInfo->isbn)) +
            "</rdf:value></rdf:li></rdf:Bag></xmp:Identifier>\n";
    }
    if (!info.keywords.empty())
        out += "<pdf:Keywords>" + xml_text(info.keywords) + "</pdf:Keywords>\n";
    out += "<xmp:CreatorTool>" + xml_text(input.creator_tool) + "</xmp:CreatorTool>\n";
    out += "<xmp:CreateDate>" + input.date + "</xmp:CreateDate><xmp:ModifyDate>" + input.date +
           "</xmp:ModifyDate><xmp:MetadataDate>" + input.date + "</xmp:MetadataDate>\n";
    out += "<pdf:Producer>" + xml_text(input.creator_tool) + "</pdf:Producer>\n";
    // DP-10: the editor's record, under its own schema, declared as PDF/A asks.
    out += "<mfbe:recordVersion>1</mfbe:recordVersion>\n";
    if (!input.description_xml.empty()) {
        out +=
            "<mfbe:fb2Description>" + xml_text(input.description_xml) + "</mfbe:fb2Description>\n";
    }
    if (!input.hints.empty())
        out += "<mfbe:fb2Hints>" + xml_text(input.hints) + "</mfbe:fb2Hints>\n";
    // DP-11: the series as Calibre reads it from a PDF's XMP (calibre/ebooks/metadata/xmp.py,
    // read_series: calibre:series, its rdf:value and its calibreSI:series_index qualifier).
    const model::Sequence* series = t.sequences.empty() ? nullptr : &t.sequences.front();
    if (series != nullptr && squeeze(series->name).empty())
        series = nullptr;
    if (series != nullptr) {
        char index[32];
        std::snprintf(index, sizeof index, "%.2f", series->number ? double(*series->number) : 1.0);
        out += "<calibre:series rdf:parseType=\"Resource\"><rdf:value>" +
               xml_text(squeeze(series->name)) + "</rdf:value><calibreSI:series_index>" + index +
               "</calibreSI:series_index></calibre:series>\n";
    }
    // PDF/A declares every schema outside its predefined ones (ISO 19005-2, 6.6.2.3).
    struct Property {
        const char* name;
        const char* type;
        const char* category;
        const char* description;
    };
    const auto schema = [](const char* title, const char* uri, const char* prefix,
                           std::initializer_list<Property> properties) {
        std::string entry = std::string("<rdf:li rdf:parseType=\"Resource\"><pdfaSchema:schema>") +
                            title + "</pdfaSchema:schema><pdfaSchema:namespaceURI>" + uri +
                            "</pdfaSchema:namespaceURI><pdfaSchema:prefix>" + prefix +
                            "</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>";
        for (const Property& p : properties) {
            entry += std::string("<rdf:li rdf:parseType=\"Resource\"><pdfaProperty:name>") +
                     p.name + "</pdfaProperty:name><pdfaProperty:valueType>" + p.type +
                     "</pdfaProperty:valueType><pdfaProperty:category>" + p.category +
                     "</pdfaProperty:category><pdfaProperty:description>" + p.description +
                     "</pdfaProperty:description></rdf:li>";
        }
        return entry + "</rdf:Seq></pdfaSchema:property></rdf:li>";
    };
    out += "<pdfaExtension:schemas><rdf:Bag>";
    out += schema("Maxima Fiction Book Editor record", kMfbeNamespace, "mfbe",
                  {{"recordVersion", "Integer", "internal",
                    "Version of the editor's record; marks a PDF the editor wrote"},
                   {"fb2Description", "Text", "internal",
                    "The book's FictionBook description element, as FB2 XML"},
                   {"fb2Hints", "Text", "internal",
                    "What the PDF cannot give back of the FictionBook structure, as JSON"}});
    if (series != nullptr) {
        out += schema("calibre", kCalibreNamespace, "calibre",
                      {{"series", "Text", "external", "The series the book belongs to"}});
        out += schema("calibre series index", kCalibreSeriesIndexNamespace, "calibreSI",
                      {{"series_index", "Real", "external", "The book's number in its series"}});
    }
    out += "</rdf:Bag></pdfaExtension:schemas>\n";
    out += "</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end=\"w\"?>";
    return out;
}

std::string validate_hints(const std::string& hints, const std::vector<std::string>& page_texts) {
    const nlohmann::json j = nlohmann::json::parse(hints, nullptr, false);
    if (j.is_discarded() || !j.is_object())
        return "not JSON";
    if (j.value("v", 0) != 1)
        return "not version 1";
    if (!j.contains("blocks") || !j["blocks"].is_number_integer())
        return "no block count";
    const auto blocks = j["blocks"].get<long long>();
    for (const char* list : {"sections", "kinds", "styles", "marks", "langs", "ids", "tables"}) {
        if (!j.contains(list))
            continue;
        if (!j[list].is_array())
            return std::string(list) + " is not a list";
        for (const auto& entry : j[list]) {
            if (!entry.is_array() || entry.empty() || !entry[0].is_number_integer()) {
                return std::string(list) + " has an entry without its block";
            }
            const auto b = entry[0].get<long long>();
            if (b < 0 || b >= blocks)
                return std::string(list) + " names block " + std::to_string(b);
        }
    }
    // The anchors are the blocks' own text: each is found in the pages (whitespace aside).
    std::string paged;
    for (const std::string& page : page_texts)
        paged += comparable(page);
    if (j.contains("anchors") && j["anchors"].is_object()) {
        for (const auto& [b, anchor] : j["anchors"].items()) {
            if (!anchor.is_string())
                return "anchor " + b + " is not text";
            const std::string wanted = comparable(anchor.get<std::string>());
            if (!wanted.empty() && paged.find(wanted) == std::string::npos) {
                return "anchor " + b + " is not in the pages";
            }
        }
    }
    // No picture data: the pictures are in the file already (R4).
    std::string data_found;
    const std::function<void(const nlohmann::json&)> scan = [&](const nlohmann::json& v) {
        if (v.is_string() && v.get<std::string>().rfind("data:", 0) == 0)
            data_found = "picture data";
        if (v.is_structured()) {
            for (const auto& item : v)
                scan(item);
        }
    };
    scan(j);
    return data_found;
}

}  // namespace mfbe::pdf
