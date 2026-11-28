// Feature 023 (T009; contracts/docx-file.md §1–§3): pre-write self-checked OOXML `.docx` writer
// and optional `<stem>.zip` (`<stem>.docx` stored + `<stem>.fbd` deflated) atomic writer.
#include "xml/xml_security.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/docx.hpp>
#include <mfbe/utf8_paths.hpp>

#include <libxml/tree.h>

#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace mfbe::docx {
namespace {

namespace fs = std::filesystem;

bool ends_with_ci(std::string_view s, std::string_view suffix) {
    if (s.size() < suffix.size()) {
        return false;
    }
    const std::string_view tail = s.substr(s.size() - suffix.size());
    for (std::size_t i = 0; i < suffix.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(tail[i])) !=
            std::tolower(static_cast<unsigned char>(suffix[i]))) {
            return false;
        }
    }
    return true;
}

void collect_media_targets(xmlNodePtr node, std::vector<std::string>& out) {
    for (xmlNodePtr cur = node; cur != nullptr; cur = cur->next) {
        if (cur->type == XML_ELEMENT_NODE) {
            const char* name = reinterpret_cast<const char*>(cur->name);
            if (name != nullptr && std::string_view(name) == "Relationship") {
                xmlChar* target_mode =
                    xmlGetProp(cur, reinterpret_cast<const xmlChar*>("TargetMode"));
                const bool is_external =
                    target_mode != nullptr &&
                    std::string_view(reinterpret_cast<const char*>(target_mode)) == "External";
                if (target_mode != nullptr) {
                    xmlFree(target_mode);
                }
                if (!is_external) {
                    xmlChar* target = xmlGetProp(cur, reinterpret_cast<const xmlChar*>("Target"));
                    if (target != nullptr) {
                        std::string t(reinterpret_cast<const char*>(target));
                        xmlFree(target);
                        if (t.rfind("media/", 0) == 0) {
                            out.push_back("word/" + t);
                        } else if (t.rfind("/word/media/", 0) == 0) {
                            out.push_back(t.substr(1));
                        }
                    }
                }
            }
            collect_media_targets(cur->children, out);
        }
    }
}

std::string zip_entry_stem(const fs::path& target) {
    std::string stem = platform::utf8_from_path(target.stem());
    if (stem.empty()) {
        stem = "book";
    }
    return stem;
}

}  // namespace

DocxPackageWriter::DocxPackageWriter(fs::path target, bool zip_with_fbd)
    : target_(std::move(target)), zip_with_fbd_(zip_with_fbd) {}

void DocxPackageWriter::add_xml_part(const std::string& name, std::string bytes) {
    if (!valid_docx_entry_name(name)) {
        throw std::invalid_argument("invalid OOXML part name: " + name);
    }
    const std::string folded = fold_docx_entry_name(name);
    if (!seen_folded_.emplace(folded, true).second) {
        throw std::invalid_argument("duplicate OOXML part name: " + name);
    }
    xml_parts_.emplace_back(name, std::move(bytes));
}

void DocxPackageWriter::add_media_part(const std::string& name, std::string bytes) {
    if (!valid_docx_entry_name(name)) {
        throw std::invalid_argument("invalid OOXML media name: " + name);
    }
    const std::string folded = fold_docx_entry_name(name);
    if (!seen_folded_.emplace(folded, true).second) {
        throw std::invalid_argument("duplicate OOXML media name: " + name);
    }
    media_parts_.emplace_back(name, std::move(bytes));
}

std::uint64_t DocxPackageWriter::commit(std::string_view fbd_bytes) {
    // Pre-write self-check (contracts/docx-file.md §2): verify required OOXML entries exist,
    // every `.xml` and `.rels` part parses cleanly under hardened libxml2, and every internal
    // `word/media/*` relationship target exists in the staged media table.
    static constexpr const char* kRequiredParts[] = {
        "[content_types].xml",          "_rels/.rels",     "word/document.xml",
        "word/_rels/document.xml.rels", "word/styles.xml", "docprops/core.xml",
    };

    std::unordered_set<std::string> present_xml;
    present_xml.reserve(xml_parts_.size());
    for (const auto& [name, _] : xml_parts_) {
        present_xml.insert(fold_docx_entry_name(name));
    }
    for (const char* req : kRequiredParts) {
        if (present_xml.count(req) == 0) {
            throw std::runtime_error(std::string("missing required OOXML part: ") + req);
        }
    }

    std::unordered_set<std::string> present_media;
    present_media.reserve(media_parts_.size());
    for (const auto& [name, _] : media_parts_) {
        present_media.insert(fold_docx_entry_name(name));
    }

    std::vector<std::string> referenced_media;
    for (const auto& [name, bytes] : xml_parts_) {
        if (!ends_with_ci(name, ".xml") && !ends_with_ci(name, ".rels")) {
            continue;
        }
        std::vector<xml::CollectedError> errors;
        xmlDocPtr doc = xml::parse_memory(bytes, name.c_str(), "UTF-8", errors);
        if (doc == nullptr) {
            const xml::CollectedError err = xml::primary_error(errors);
            throw std::runtime_error("malformed OOXML part " + name + ": " + err.message);
        }
        if (ends_with_ci(name, ".rels")) {
            collect_media_targets(xmlDocGetRootElement(doc), referenced_media);
        }
        xmlFreeDoc(doc);
    }

    for (const std::string& media_target : referenced_media) {
        if (present_media.count(fold_docx_entry_name(media_target)) == 0) {
            throw std::runtime_error("missing staged DOCX media target: " + media_target);
        }
    }

    // Build `.docx` ZIP bytes: deflate XML parts, store already-compressed JPEG/PNG media.
    std::vector<archive::ZipEntry> docx_entries;
    docx_entries.reserve(xml_parts_.size() + media_parts_.size());
    for (const auto& [name, bytes] : xml_parts_) {
        docx_entries.push_back(archive::ZipEntry{name, bytes, /*stored=*/false, /*untimed=*/false});
    }
    for (const auto& [name, bytes] : media_parts_) {
        docx_entries.push_back(archive::ZipEntry{name, bytes, /*stored=*/true, /*untimed=*/false});
    }
    const std::string docx_bytes = archive::zip_entries(docx_entries);

    if (!zip_with_fbd_) {
        atomic_file::write_atomic(target_, docx_bytes);
        return docx_bytes.size();
    }

    if (fbd_bytes.empty()) {
        throw std::runtime_error("companion FBD bytes missing for DOCX ZIP export");
    }
    const std::string stem = zip_entry_stem(target_);
    std::vector<archive::ZipEntry> outer_entries;
    // Store `.docx` without redundant re-compression; deflate `.fbd` (contracts/docx-file.md §3).
    outer_entries.push_back(
        archive::ZipEntry{stem + ".docx", docx_bytes, /*stored=*/true, /*untimed=*/false});
    outer_entries.push_back(
        archive::ZipEntry{stem + ".fbd", fbd_bytes, /*stored=*/false, /*untimed=*/false});
    const std::string zip_bytes = archive::zip_entries(outer_entries);
    atomic_file::write_atomic(target_, zip_bytes);
    return zip_bytes.size();
}

}  // namespace mfbe::docx
