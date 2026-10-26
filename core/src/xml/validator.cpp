// FB2 validation: XSD + consistency checks (T044). See mfbe/validator.hpp.
#include "xml/validator_internal.hpp"
#include "xml/xml_security.hpp"

#include <mfbe/fb2_reader.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/log.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/validator.hpp>

#include <climits>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/xmlerror.h>
#include <libxml/xmlschemas.h>
#include <libxml/xmlstring.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <functional>
#include <mutex>
#include <set>
#include <system_error>

namespace mfbe::validation {
namespace {

namespace fs = std::filesystem;
using model::Severity;
using model::ValidationIssue;
using model::ValidationReport;
using nlohmann::json;

/* ----------------------------------------------------------------------------------------- */
/* Schema cache                                                                               */
/* ----------------------------------------------------------------------------------------- */

struct SchemaCache {
    std::mutex mutex;
    fs::path dir;
    bool loaded = false;
    xmlSchemaPtr schema = nullptr;
    std::string error;
    std::vector<std::string> genres;
    GenreCheck genre_check;

    ~SchemaCache() {
        if (schema != nullptr) {
            xmlSchemaFree(schema);
        }
    }
};

SchemaCache& cache() {
    static SchemaCache c;
    return c;
}

bool is_dir(const fs::path& p) {
    std::error_code ec;
    return !p.empty() && fs::is_directory(p, ec);
}

fs::path default_schema_dir() {
    const fs::path exe_dir = platform::executable_dir();
    const fs::path source_dir = platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR) / "schema";
    for (const fs::path& candidate : {exe_dir / ".." / "share" / "mfbe" / "resources" / "schema",
                                      exe_dir / "resources" / "schema", source_dir}) {
        if (is_dir(candidate)) {
            std::error_code ec;
            auto canonical = fs::weakly_canonical(candidate, ec);
            return ec ? candidate : canonical;
        }
    }
    return source_dir;
}

void collect_schema_error(void* user_data, const xmlError* error) {
    auto* out = static_cast<std::vector<SchemaError>*>(user_data);
    if (out == nullptr || error == nullptr || error->level == XML_ERR_WARNING) {
        return;
    }
    SchemaError e;
    e.line = error->line;
    e.column = error->int2;
    e.code = error->code;
    if (error->message != nullptr) {
        e.message = error->message;
        while (!e.message.empty() && (e.message.back() == '\n' || e.message.back() == ' ')) {
            e.message.pop_back();
        }
    }
    if (error->node != nullptr) {
        auto* node = static_cast<xmlNodePtr>(error->node);
        if (node->type == XML_ELEMENT_NODE) {
            e.element = reinterpret_cast<const char*>(node->name);
            const long line = xmlGetLineNo(node);
            if (line > 0) {
                e.line = static_cast<int>(line);
            }
        } else if (node->type == XML_ATTRIBUTE_NODE && node->parent != nullptr) {
            e.element = reinterpret_cast<const char*>(node->parent->name);
            const long line = xmlGetLineNo(node->parent);
            if (line > 0) {
                e.line = static_cast<int>(line);
            }
        }
    }
    if (out->size() < 1000) {
        out->push_back(std::move(e));
    }
}

void collect_parser_error(void* user_data, const xmlError* error) {
    collect_schema_error(user_data, error);
}

void load_genres_locked(SchemaCache& c) {
    const fs::path file = c.dir / "FictionBookGenres.xsd";
    std::vector<xml::CollectedError> errors;
    std::string bytes;
    try {
        bytes = fb2::read_file_bytes(file);
    } catch (const fb2::IoFailure&) {
        return;
    }
    xmlDocPtr doc =
        xml::parse_memory(bytes, platform::utf8_from_path(file).c_str(), nullptr, errors);
    if (doc == nullptr) {
        return;
    }
    std::set<std::string> codes;
    std::function<void(xmlNodePtr)> walk = [&](xmlNodePtr node) {
        for (xmlNodePtr el = node; el != nullptr; el = el->next) {
            if (el->type == XML_ELEMENT_NODE) {
                if (xmlStrEqual(el->name, reinterpret_cast<const xmlChar*>("enumeration")) != 0) {
                    xmlChar* value = xmlGetNoNsProp(el, reinterpret_cast<const xmlChar*>("value"));
                    if (value != nullptr) {
                        codes.insert(reinterpret_cast<const char*>(value));
                        xmlFree(value);
                    }
                }
                walk(el->children);
            }
        }
    };
    walk(xmlDocGetRootElement(doc));
    xmlFreeDoc(doc);
    c.genres.assign(codes.begin(), codes.end());
}

// Requires c.mutex held.
void load_locked(SchemaCache& c) {
    if (c.loaded) {
        return;
    }
    c.loaded = true;
    xml::ensure_libxml_initialised();
    if (c.dir.empty()) {
        c.dir = default_schema_dir();
    }
    const fs::path main = c.dir / "FictionBook.xsd";
    std::error_code ec;
    if (!fs::is_regular_file(main, ec)) {
        c.error = "schema not found: " + platform::utf8_from_path(main);
        log::error("core", "validation.schemaMissing", "FictionBook.xsd not found",
                   log::extras({{"path", platform::utf8_from_path(main)}}));
        return;
    }
    std::vector<SchemaError> errors;
    // libxml2 reads file names as UTF-8 (wide API on Windows).
    xmlSchemaParserCtxtPtr pctxt = xmlSchemaNewParserCtxt(platform::utf8_from_path(main).c_str());
    if (pctxt == nullptr) {
        c.error = "cannot create schema parser";
        return;
    }
    xmlSchemaSetParserStructuredErrors(pctxt, collect_parser_error, &errors);
    c.schema = xmlSchemaParse(pctxt);
    xmlSchemaFreeParserCtxt(pctxt);
    if (c.schema == nullptr) {
        c.error = errors.empty() ? "schema could not be compiled" : errors.front().message;
        log::error("core", "validation.schemaInvalid", "FictionBook.xsd could not be compiled",
                   log::extras({{"path", platform::utf8_from_path(main)}, {"reason", c.error}}));
        return;
    }
    load_genres_locked(c);
}

std::string trim_message(std::string message) {
    // libxml2 messages look like "Element '{ns}name': ..."; the namespace URI is noise here.
    const std::string ns = std::string("{") + fb2::kFb2Namespace + "}";
    for (std::size_t pos = message.find(ns); pos != std::string::npos; pos = message.find(ns)) {
        message.erase(pos, ns.size());
    }
    return message;
}

ValidationIssue make_issue(Severity severity, std::string code,
                           std::map<std::string, json> params) {
    ValidationIssue issue;
    issue.severity = severity;
    issue.code = std::move(code);
    issue.params = std::move(params);
    return issue;
}

// Genre check on the parsed XML (title-info / src-title-info children named genre).
void check_genres_in_doc(xmlDocPtr doc, const fb2::LineMap* lines,
                         std::vector<ValidationIssue>& out) {
    xmlNodePtr root = xmlDocGetRootElement(doc);
    if (root == nullptr) {
        return;
    }
    const auto named = [](xmlNodePtr n, const char* name) {
        return n->type == XML_ELEMENT_NODE &&
               xmlStrEqual(n->name, reinterpret_cast<const xmlChar*>(name)) != 0;
    };
    for (xmlNodePtr desc = root->children; desc != nullptr; desc = desc->next) {
        if (!named(desc, "description")) {
            continue;
        }
        for (xmlNodePtr info = desc->children; info != nullptr; info = info->next) {
            if (!named(info, "title-info") && !named(info, "src-title-info")) {
                continue;
            }
            for (xmlNodePtr g = info->children; g != nullptr; g = g->next) {
                if (!named(g, "genre")) {
                    continue;
                }
                xmlChar* content = xmlNodeGetContent(g);
                std::string code = content == nullptr ? "" : reinterpret_cast<const char*>(content);
                xmlFree(content);
                code.erase(code.begin(),
                           std::find_if(code.begin(), code.end(),
                                        [](unsigned char ch) { return std::isspace(ch) == 0; }));
                code.erase(std::find_if(code.rbegin(), code.rend(),
                                        [](unsigned char ch) { return std::isspace(ch) == 0; })
                               .base(),
                           code.end());
                if (!is_known_genre(code)) {
                    ValidationIssue issue =
                        make_issue(Severity::error, "genre.unknown", {{"code", code}});
                    const long line = xmlGetLineNo(g);
                    if (line > 0) {
                        issue.line = static_cast<int>(line);
                        if (lines != nullptr) {
                            issue.nodeId = lines->node_at(static_cast<int>(line));
                        }
                    }
                    out.push_back(std::move(issue));
                }
            }
        }
    }
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Internal API (validator_internal.hpp)                                                     */
/* ----------------------------------------------------------------------------------------- */

std::vector<SchemaError> schema_validate(xmlDocPtr doc) {
    SchemaCache& c = cache();
    std::lock_guard<std::mutex> lock(c.mutex);
    load_locked(c);
    std::vector<SchemaError> errors;
    if (c.schema == nullptr) {
        errors.push_back(SchemaError{0, 0, 0, c.error, ""});
        return errors;
    }
    xmlSchemaValidCtxtPtr vctxt = xmlSchemaNewValidCtxt(c.schema);
    if (vctxt == nullptr) {
        errors.push_back(SchemaError{0, 0, 0, "cannot create validation context", ""});
        return errors;
    }
    xmlSchemaSetValidStructuredErrors(vctxt, collect_schema_error, &errors);
    const int rc = xmlSchemaValidateDoc(vctxt, doc);
    xmlSchemaFreeValidCtxt(vctxt);
    if (rc != 0 && errors.empty()) {
        errors.push_back(SchemaError{0, 0, rc, "document is not valid", ""});
    }
    return errors;
}

std::vector<ValidationIssue> to_issues(const std::vector<SchemaError>& errors) {
    std::vector<ValidationIssue> out;
    out.reserve(errors.size());
    for (const auto& e : errors) {
        ValidationIssue issue;
        issue.severity = Severity::error;
        if (e.code == 0 && e.element.empty() && e.line == 0) {
            issue.code = "schema.unavailable";
            issue.params["reason"] = e.message;
        } else {
            issue.code = "schema.invalid";
            issue.params["message"] = trim_message(e.message);
            if (!e.element.empty()) {
                issue.params["element"] = e.element;
            }
            if (e.line > 0) {
                issue.line = e.line;
            }
            if (e.column > 0) {
                issue.column = e.column;
            }
        }
        out.push_back(std::move(issue));
    }
    return out;
}

/* ----------------------------------------------------------------------------------------- */
/* Public API                                                                                */
/* ----------------------------------------------------------------------------------------- */

void set_schema_dir(const fs::path& dir) {
    SchemaCache& c = cache();
    std::lock_guard<std::mutex> lock(c.mutex);
    if (c.loaded && c.dir == dir) {
        return;
    }
    if (c.schema != nullptr) {
        xmlSchemaFree(c.schema);
        c.schema = nullptr;
    }
    c.loaded = false;
    c.error.clear();
    c.genres.clear();
    c.dir = dir;
}

fs::path schema_dir() {
    SchemaCache& c = cache();
    std::lock_guard<std::mutex> lock(c.mutex);
    if (c.dir.empty()) {
        c.dir = default_schema_dir();
    }
    return c.dir;
}

bool schema_ready(std::string* error) {
    SchemaCache& c = cache();
    std::lock_guard<std::mutex> lock(c.mutex);
    load_locked(c);
    if (error != nullptr) {
        *error = c.error;
    }
    return c.schema != nullptr;
}

const std::vector<std::string>& schema_genres() {
    SchemaCache& c = cache();
    std::lock_guard<std::mutex> lock(c.mutex);
    load_locked(c);
    return c.genres;
}

void set_genre_validator(GenreCheck check) {
    SchemaCache& c = cache();
    std::lock_guard<std::mutex> lock(c.mutex);
    c.genre_check = std::move(check);
}

bool is_known_genre(const std::string& code) {
    SchemaCache& c = cache();
    GenreCheck check;
    {
        std::lock_guard<std::mutex> lock(c.mutex);
        load_locked(c);
        check = c.genre_check;
        if (!check) {
            return std::binary_search(c.genres.begin(), c.genres.end(), code);
        }
    }
    return check(code);
}

void finalize_report(ValidationReport& report) {
    std::stable_sort(report.issues.begin(), report.issues.end(),
                     [](const ValidationIssue& a, const ValidationIssue& b) {
                         return a.line.value_or(INT_MAX) < b.line.value_or(INT_MAX);
                     });
    report.errorCount = 0;
    report.warningCount = 0;
    for (const auto& issue : report.issues) {
        if (issue.severity == Severity::error) {
            ++report.errorCount;
        } else {
            ++report.warningCount;
        }
    }
}

// `…N bytes…` placeholders (Source view / elided serialisation) are not base64: validate the
// element as if it were empty, which xs:base64Binary accepts.
void blank_binary_placeholders(xmlDocPtr doc) {
    xmlNodePtr root = xmlDocGetRootElement(doc);
    if (root == nullptr) {
        return;
    }
    static const std::string kEllipsis = "\xE2\x80\xA6";
    for (xmlNodePtr c = root->children; c != nullptr; c = c->next) {
        if (c->type != XML_ELEMENT_NODE ||
            xmlStrEqual(c->name, reinterpret_cast<const xmlChar*>("binary")) == 0) {
            continue;
        }
        xmlChar* content = xmlNodeGetContent(c);
        if (content == nullptr) {
            continue;
        }
        std::string text(reinterpret_cast<const char*>(content));
        xmlFree(content);
        const std::size_t first = text.find_first_not_of(" \t\r\n");
        if (first != std::string::npos && text.compare(first, kEllipsis.size(), kEllipsis) == 0 &&
            text.find(" bytes" + kEllipsis, first) != std::string::npos) {
            xmlNodeSetContent(c, reinterpret_cast<const xmlChar*>(""));
        }
    }
}

ValidationReport validate_xml_text(std::string_view utf8_xml, const fb2::LineMap* lines) {
    const auto started = std::chrono::steady_clock::now();
    ValidationReport report;
    std::vector<xml::CollectedError> parse_errors;
    xmlDocPtr doc = xml::parse_memory(utf8_xml, nullptr, "UTF-8", parse_errors);
    if (doc != nullptr) {
        blank_binary_placeholders(doc);
    }
    if (doc == nullptr) {
        const xml::CollectedError e = xml::primary_error(parse_errors);
        ValidationIssue issue =
            make_issue(Severity::error, "xml.notWellFormed", {{"message", e.message}});
        if (e.line > 0) {
            issue.line = e.line;
        }
        if (e.column > 0) {
            issue.column = e.column;
        }
        report.issues.push_back(std::move(issue));
    } else {
        for (const auto& e : schema_validate(doc)) {
            // Genre enumeration violations are replaced by the effective-list check below.
            if (e.element == "genre" && e.code == XML_SCHEMAV_CVC_ENUMERATION_VALID) {
                continue;
            }
            std::vector<ValidationIssue> converted = to_issues({e});
            for (auto& issue : converted) {
                if (issue.line && lines != nullptr) {
                    issue.nodeId = lines->node_at(*issue.line);
                }
                report.issues.push_back(std::move(issue));
            }
        }
        check_genres_in_doc(doc, lines, report.issues);
        xmlFreeDoc(doc);
    }
    finalize_report(report);
    report.durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - started)
                            .count();
    return report;
}

std::vector<ValidationIssue> consistency_issues(const model::Document& document,
                                                const BinaryStore* store) {
    std::vector<ValidationIssue> out;
    std::set<std::string> ids;
    if (store != nullptr) {
        for (const auto& id : store->ids()) {
            ids.insert(id);
        }
    }
    const auto collect_cover_ids = [&](const model::TitleInfo& info) {
        for (const auto& ref : info.coverpage) {
            if (ref.id && !ref.id->empty()) {
                ids.insert(*ref.id);
            }
        }
    };
    collect_cover_ids(document.description.titleInfo);
    if (document.description.srcTitleInfo) {
        collect_cover_ids(*document.description.srcTitleInfo);
    }
    model::visit_nodes(document, [&](const model::Node& node, const std::string&) {
        if (auto id = node.attr_string("id"); id && !id->empty()) {
            ids.insert(*id);
        }
        return true;
    });

    const auto image_issue = [&](const std::string& href, const std::optional<std::string>& node_id,
                                 const std::optional<std::string>& path) {
        std::optional<ValidationIssue> issue;
        if (href.empty()) {
            issue = make_issue(Severity::warning, "image.emptyHref", {});
        } else if (href[0] == '#') {
            const std::string id = href.substr(1);
            if (store == nullptr || !store->contains(id)) {
                issue = make_issue(Severity::warning, "image.missingBinary", {{"href", href}});
            }
        } else {
            issue = make_issue(Severity::warning, "image.externalHref", {{"href", href}});
        }
        if (issue) {
            issue->nodeId = node_id;
            issue->path = path;
            out.push_back(std::move(*issue));
        }
    };

    const auto cover_issues = [&](const model::TitleInfo& info, const char* where) {
        for (const auto& ref : info.coverpage) {
            image_issue(ref.href, std::nullopt, std::string(where) + "/coverpage");
        }
    };
    cover_issues(document.description.titleInfo, "title-info");
    if (document.description.srcTitleInfo) {
        cover_issues(*document.description.srcTitleInfo, "src-title-info");
    }

    model::visit_nodes(document, [&](const model::Node& node, const std::string& path) {
        if (node.type == "image" || node.type == "inline-image") {
            image_issue(node.attr_string("href").value_or(""), node.node_id(), path);
        }
        // The link marks of every inline child: text, inline images and inline raw XML
        // (feature 006, FR-067), one warning per such node.
        for (const model::Node& child : node.content) {
            for (const model::Mark& mark : child.marks) {
                if (mark.type != "link" || !mark.attrs.is_object() ||
                    !mark.attrs.contains("href") || !mark.attrs["href"].is_string()) {
                    continue;
                }
                const std::string href = mark.attrs["href"].get<std::string>();
                if (href.size() > 1 && href[0] == '#' && !ids.count(href.substr(1))) {
                    ValidationIssue issue =
                        make_issue(Severity::warning, "link.dangling", {{"href", href}});
                    issue.nodeId = node.node_id();
                    issue.path = path;
                    out.push_back(std::move(issue));
                }
            }
        }
        return true;
    });

    if (store != nullptr) {
        for (const auto& meta : store->list()) {
            if (meta.referenceCount == 0) {
                out.push_back(
                    make_issue(Severity::warning, "binary.unreferenced", {{"id", meta.id}}));
            }
            if (store->is_raw_text(meta.id)) {
                out.push_back(
                    make_issue(Severity::warning, "binary.invalidBase64", {{"id", meta.id}}));
            } else if (!meta.decodable) {
                out.push_back(make_issue(Severity::warning, "binary.notImage",
                                         {{"id", meta.id}, {"contentType", meta.contentType}}));
            } else if (meta.willConvert) {
                out.push_back(make_issue(Severity::warning, "binary.willConvert",
                                         {{"id", meta.id}, {"contentType", meta.contentType}}));
            }
        }
    }

    const auto required = [&](bool empty, const char* element) {
        if (empty) {
            out.push_back(
                make_issue(Severity::warning, "description.emptyRequired", {{"element", element}}));
        }
    };
    const model::Description& d = document.description;
    required(d.titleInfo.bookTitle.empty(), "book-title");
    required(d.titleInfo.lang.empty(), "lang");
    required(d.documentInfo.id.empty(), "id");
    required(d.documentInfo.version.empty(), "version");
    required(d.documentInfo.date.text.empty() &&
                 !(d.documentInfo.date.value && !d.documentInfo.date.value->empty()),
             "date");
    return out;
}

ValidationReport validate_document(const model::Document& document, const BinaryStore* store,
                                   const std::string& xlink_prefix) {
    const auto started = std::chrono::steady_clock::now();
    fb2::WriteOptions options;
    options.elide_binaries = true;
    options.xlink_prefix = xlink_prefix;
    const fb2::WriteResult written = fb2::write_document(document, store, options);
    ValidationReport report = validate_xml_text(written.text, &written.lines);
    for (auto& issue : report.issues) {
        if (issue.nodeId && !issue.path) {
            const std::string path = model::node_path(document, *issue.nodeId);
            if (!path.empty()) {
                issue.path = path;
            }
        }
    }
    auto extra = consistency_issues(document, store);
    report.issues.insert(report.issues.end(), std::make_move_iterator(extra.begin()),
                         std::make_move_iterator(extra.end()));
    finalize_report(report);
    report.durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - started)
                            .count();
    return report;
}

}  // namespace mfbe::validation
