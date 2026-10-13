// FB2 reader (T041). See mfbe/fb2_reader.hpp for the mapping rules.
#include "xml/validator_internal.hpp"
#include "xml/xml_security.hpp"

#include <mfbe/base64.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/log.hpp>

#include <libxml/SAX2.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/xmlstring.h>

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <set>

namespace mfbe::fb2 {
namespace {

using model::Mark;
using model::Node;
using nlohmann::json;

/* ----------------------------------------------------------------------------------------- */
/* Small helpers                                                                              */
/* ----------------------------------------------------------------------------------------- */

const xmlChar* X(const char* s) {
    return reinterpret_cast<const xmlChar*>(s);
}

std::string str(const xmlChar* s) {
    return s == nullptr ? std::string() : std::string(reinterpret_cast<const char*>(s));
}

// Takes ownership of a libxml2-allocated string.
std::optional<std::string> take(xmlChar* s) {
    if (s == nullptr) {
        return std::nullopt;
    }
    std::string out(reinterpret_cast<const char*>(s));
    xmlFree(s);
    return out;
}

bool is_fb2_element(const xmlNode* node) {
    return node->type == XML_ELEMENT_NODE &&
           (node->ns == nullptr || xmlStrEqual(node->ns->href, X(kFb2Namespace)) != 0);
}

bool is_named(const xmlNode* node, const char* name) {
    return is_fb2_element(node) && xmlStrEqual(node->name, X(name)) != 0;
}

bool is_blank(std::string_view text) {
    return std::all_of(text.begin(), text.end(), [](unsigned char c) {
        return c == ' ' || c == '\n' || c == '\r' || c == '\t';
    });
}

std::string trim(std::string_view s) {
    std::size_t b = 0;
    std::size_t e = s.size();
    while (b < e && std::isspace(static_cast<unsigned char>(s[b])) != 0) {
        ++b;
    }
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1])) != 0) {
        --e;
    }
    return std::string(s.substr(b, e - b));
}

// Trims ASCII whitespace (not NBSP) around stray block-level text.
std::string trim_block_text(const std::string& text) {
    std::size_t b = 0;
    std::size_t e = text.size();
    const auto ws = [](char ch) { return ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t'; };
    while (b < e && ws(text[b])) {
        ++b;
    }
    while (e > b && ws(text[e - 1])) {
        --e;
    }
    return text.substr(b, e - b);
}

std::optional<int> parse_int(const std::string& text) {
    const std::string t = trim(text);
    if (t.empty()) {
        return std::nullopt;
    }
    char* end = nullptr;
    errno = 0;
    const long v = std::strtol(t.c_str(), &end, 10);
    if (errno != 0 || end == nullptr || *end != '\0' || v > 1000000000L || v < -1000000000L) {
        return std::nullopt;
    }
    return static_cast<int>(v);
}

std::string text_content(const xmlNode* node) {
    return take(xmlNodeGetContent(node)).value_or("");
}

std::optional<std::string> plain_attr(const xmlNode* node, const char* name) {
    return take(xmlGetNoNsProp(node, X(name)));
}

std::optional<std::string> ns_attr(const xmlNode* node, const char* name, const char* ns) {
    return take(xmlGetNsProp(node, X(name), X(ns)));
}

std::optional<std::string> xlink_href(const xmlNode* node) {
    auto href = ns_attr(node, "href", kXlinkNamespace);
    if (!href) {
        href = plain_attr(node, "href");  // sloppy files without the xlink namespace
    }
    return href;
}

std::optional<std::string> xml_lang(const xmlNode* node) {
    return ns_attr(node, "lang", kXmlNamespace);
}

// Empty optional text fields are treated as absent (FR-052: empty optionals are omitted).
std::optional<std::string> opt_text(const xmlNode* node) {
    std::string t = text_content(node);
    if (t.empty()) {
        return std::nullopt;
    }
    return t;
}

/* ----------------------------------------------------------------------------------------- */
/* Conversion context                                                                        */
/* ----------------------------------------------------------------------------------------- */

struct Ctx {
    model::Document* doc = nullptr;
    std::vector<model::ValidationIssue>* warnings = nullptr;

    void warn(const std::string& code, std::map<std::string, json> params) {
        model::ValidationIssue issue;
        issue.severity = model::Severity::warning;
        issue.code = code;
        issue.params = std::move(params);
        warnings->push_back(std::move(issue));
    }
};

Node make_raw(const std::string& xml, bool inline_, const char* slot = nullptr) {
    Node n;
    n.type = "raw-xml";
    n.attrs["xml"] = xml;
    n.attrs["inline"] = inline_;
    if (slot != nullptr) {
        n.attrs["slot"] = slot;
    }
    return n;
}

// Drops the default-namespace declaration a detached copy picks up when the element is in
// the FB2 namespace: the writer always declares it on the root, so the fragment stays
// equivalent and the Source view does not show the noise. Foreign namespaces stay declared.
std::string strip_default_fb2_ns(std::string xml) {
    static const std::string kDecl = std::string(" xmlns=\"") + kFb2Namespace + "\"";
    const std::size_t tag_end = xml.find('>');
    const std::size_t pos = xml.find(kDecl);
    if (pos != std::string::npos && tag_end != std::string::npos && pos < tag_end) {
        xml.erase(pos, kDecl.size());
    }
    return xml;
}

Node raw_of(xmlNodePtr node, bool inline_, const char* slot = nullptr) {
    return make_raw(strip_default_fb2_ns(xml::dump_node(node)), inline_, slot);
}

// Known attributes of an element kind: plain names plus whether xml:lang / xlink:href belong.
struct AttrSpec {
    std::vector<const char*> plain;
    bool lang = false;
    bool href = false;
};

const AttrSpec& attr_spec(const std::string& type) {
    static const std::map<std::string, AttrSpec> kSpecs = {
        {"body", {{"name"}, true, false}},
        {"section", {{"id"}, true, false}},
        {"title", {{}, true, false}},
        {"epigraph", {{"id"}, false, false}},
        {"annotation", {{"id"}, true, false}},
        {"poem", {{"id"}, true, false}},
        {"stanza", {{}, true, false}},
        {"cite", {{"id"}, true, false}},
        {"table", {{"id", "style"}, false, false}},
        {"tr", {{"align"}, false, false}},
        {"td", {{"id", "style", "colspan", "rowspan", "align", "valign"}, false, false}},
        {"th", {{"id", "style", "colspan", "rowspan", "align", "valign"}, false, false}},
        {"p", {{"id", "style"}, true, false}},
        {"subtitle", {{"id", "style"}, true, false}},
        {"text-author", {{"id", "style"}, true, false}},
        {"v", {{"id", "style"}, true, false}},
        {"date", {{"value"}, true, false}},
        {"empty-line", {{}, false, false}},
        {"image", {{"alt", "title", "id"}, false, true}},
        {"inline-image", {{"alt"}, false, true}},
    };
    static const AttrSpec kNone;
    auto it = kSpecs.find(type);
    return it == kSpecs.end() ? kNone : it->second;
}

// Copies known attributes into `node.attrs` and everything else into attrs.unknownAttrs.
void collect_attrs(xmlNodePtr el, Node& node, const std::string& type) {
    const AttrSpec& spec = attr_spec(type);
    json unknown = json::object();
    for (xmlAttrPtr a = el->properties; a != nullptr; a = a->next) {
        const std::string name = str(a->name);
        std::string value = take(xmlNodeListGetString(el->doc, a->children, 1)).value_or("");
        if (a->ns == nullptr) {
            const bool known =
                std::find_if(spec.plain.begin(), spec.plain.end(),
                             [&](const char* p) { return name == p; }) != spec.plain.end();
            if (known) {
                if (name == "colspan" || name == "rowspan") {
                    if (auto n = parse_int(value)) {
                        node.attrs[name] = *n;
                    } else {
                        unknown[name] = value;
                    }
                } else {
                    node.attrs[name] = value;
                }
                continue;
            }
            // A plain href on an image/link is accepted as the xlink one (sloppy files).
            if (spec.href && name == "href" && !node.attrs.count("href")) {
                node.attrs["href"] = value;
                continue;
            }
            unknown[name] = value;
            continue;
        }
        const std::string uri = str(a->ns->href);
        if (uri == kXmlNamespace && name == "lang" && spec.lang) {
            node.attrs["lang"] = value;
            continue;
        }
        if (uri == kXlinkNamespace && name == "href" && spec.href) {
            node.attrs["href"] = value;
            continue;
        }
        unknown["{" + uri + "}" + name] = value;
    }
    if (spec.href && !node.attrs.count("href")) {
        node.attrs["href"] = "";  // required by the model
    }
    if (!unknown.empty()) {
        node.attrs["unknownAttrs"] = std::move(unknown);
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Body tree                                                                                 */
/* ----------------------------------------------------------------------------------------- */

void convert_block_children(xmlNodePtr parent, Node& out, Ctx& ctx);

void append_text(std::vector<Node>& out, const std::string& text, const std::vector<Mark>& marks) {
    if (text.empty()) {
        return;
    }
    if (!out.empty() && out.back().is_text() && out.back().marks == marks) {
        out.back().text += text;
        return;
    }
    Node t;
    t.type = "text";
    t.text = text;
    t.marks = marks;
    out.push_back(std::move(t));
}

bool has_mark(const std::vector<Mark>& marks, const std::string& type) {
    return std::any_of(marks.begin(), marks.end(), [&](const Mark& m) { return m.type == type; });
}

void convert_inline_children(xmlNodePtr parent, std::vector<Node>& out, std::vector<Mark>& marks,
                             Ctx& ctx) {
    for (xmlNodePtr c = parent->children; c != nullptr; c = c->next) {
        switch (c->type) {
            case XML_TEXT_NODE:
            case XML_CDATA_SECTION_NODE:
                append_text(out, str(c->content), marks);
                break;
            case XML_ENTITY_REF_NODE:
                append_text(out, text_content(c), marks);
                break;
            case XML_COMMENT_NODE:
            case XML_PI_NODE:
                out.push_back(raw_of(c, true));
                break;
            case XML_ELEMENT_NODE: {
                if (!is_fb2_element(c)) {
                    out.push_back(raw_of(c, true));
                    break;
                }
                const std::string name = str(c->name);
                std::optional<Mark> mark;
                if (name == "strong" || name == "emphasis" || name == "strikethrough" ||
                    name == "sub" || name == "sup" || name == "code") {
                    mark = Mark{name, nullptr};
                } else if (name == "style") {
                    mark = Mark{"style", json{{"name", plain_attr(c, "name").value_or("")}}};
                } else if (name == "a") {
                    json attrs{{"href", xlink_href(c).value_or("")}};
                    if (auto type = plain_attr(c, "type")) {
                        attrs["type"] = *type;
                    }
                    mark = Mark{"link", attrs};
                } else if (name == "image") {
                    Node img;
                    img.type = "inline-image";
                    collect_attrs(c, img, "inline-image");
                    out.push_back(std::move(img));
                    break;
                } else {
                    out.push_back(raw_of(c, true));  // block element or unknown inline element
                    break;
                }
                // ProseMirror allows one mark of a type: an inner duplicate keeps the outer.
                const bool duplicate = has_mark(marks, mark->type);
                if (!duplicate) {
                    marks.push_back(*mark);
                }
                convert_inline_children(c, out, marks, ctx);
                if (!duplicate) {
                    marks.pop_back();
                }
                break;
            }
            default:
                break;
        }
    }
}

Node convert_inline_container(xmlNodePtr el, const std::string& type, Ctx& ctx) {
    Node n;
    n.type = type;
    collect_attrs(el, n, type);
    std::vector<Mark> marks;
    convert_inline_children(el, n.content, marks, ctx);
    return n;
}

Node convert_date_node(xmlNodePtr el) {
    Node n;
    n.type = "date";
    collect_attrs(el, n, "date");
    const std::string text = text_content(el);
    if (!text.empty()) {
        Node t;
        t.type = "text";
        t.text = text;
        n.content.push_back(std::move(t));
    }
    return n;
}

Node convert_block_element(xmlNodePtr el, Ctx& ctx) {
    const std::string name = str(el->name);
    if (name == "p" || name == "subtitle" || name == "text-author" || name == "v" || name == "td" ||
        name == "th") {
        return convert_inline_container(el, name, ctx);
    }
    if (name == "empty-line") {
        Node n;
        n.type = "empty-line";
        collect_attrs(el, n, "empty-line");
        return n;
    }
    if (name == "image") {
        Node n;
        n.type = "image";
        collect_attrs(el, n, "image");
        return n;
    }
    if (name == "date") {
        return convert_date_node(el);
    }
    Node n;
    n.type = name;  // body, section, title, epigraph, annotation, poem, stanza, cite, table, tr
    collect_attrs(el, n, name);
    convert_block_children(el, n, ctx);
    return n;
}

bool is_block_name(const std::string& name) {
    static const std::set<std::string> kBlocks = {
        "body",        "section", "title",      "epigraph", "annotation", "poem", "stanza",
        "cite",        "table",   "tr",         "td",       "th",         "p",    "subtitle",
        "text-author", "v",       "empty-line", "image",    "date"};
    return kBlocks.count(name) != 0;
}

void convert_block_children(xmlNodePtr parent, Node& out, Ctx& ctx) {
    for (xmlNodePtr c = parent->children; c != nullptr; c = c->next) {
        switch (c->type) {
            case XML_TEXT_NODE:
            case XML_CDATA_SECTION_NODE:
            case XML_ENTITY_REF_NODE: {
                const std::string text =
                    c->type == XML_ENTITY_REF_NODE ? text_content(c) : str(c->content);
                if (!is_blank(text)) {
                    // Stray text in a block context: preserved (escaped) so nothing is lost;
                    // validation reports it as not allowed. The surrounding whitespace is the
                    // indentation of its (invalid) position, so it is trimmed like
                    // inter-element whitespace.
                    out.content.push_back(make_raw(xml::escape_text(trim_block_text(text)), false));
                }
                break;
            }
            case XML_COMMENT_NODE:
            case XML_PI_NODE:
                out.content.push_back(raw_of(c, false));
                break;
            case XML_ELEMENT_NODE:
                if (is_fb2_element(c) && is_block_name(str(c->name))) {
                    out.content.push_back(convert_block_element(c, ctx));
                } else {
                    out.content.push_back(raw_of(c, false));
                }
                break;
            default:
                break;
        }
    }
}

Node convert_annotation(xmlNodePtr el, Ctx& ctx) {
    Node n;
    n.type = "annotation";
    collect_attrs(el, n, "annotation");
    convert_block_children(el, n, ctx);
    return n;
}

/* ----------------------------------------------------------------------------------------- */
/* Description                                                                               */
/* ----------------------------------------------------------------------------------------- */

void add_extra(Ctx& ctx, xmlNodePtr node, const char* slot) {
    ctx.doc->extras.push_back(raw_of(node, false, slot));
}

model::Person convert_person(xmlNodePtr el, Ctx& ctx, const char* slot) {
    model::Person p;
    for (xmlNodePtr c = el->children; c != nullptr; c = c->next) {
        if (c->type != XML_ELEMENT_NODE) {
            continue;
        }
        if (!is_fb2_element(c)) {
            add_extra(ctx, c, slot);
            continue;
        }
        const std::string name = str(c->name);
        if (name == "first-name") {
            p.firstName = text_content(c);
        } else if (name == "middle-name") {
            p.middleName = text_content(c);
        } else if (name == "last-name") {
            p.lastName = text_content(c);
        } else if (name == "nickname") {
            p.nickname = text_content(c);
        } else if (name == "home-page") {
            p.homePages.push_back(text_content(c));
        } else if (name == "email") {
            p.emails.push_back(text_content(c));
        } else if (name == "id") {
            p.id = text_content(c);
        } else {
            add_extra(ctx, c, slot);
        }
    }
    return p;
}

model::DateValue convert_date(xmlNodePtr el) {
    model::DateValue d;
    d.text = text_content(el);
    if (auto v = plain_attr(el, "value"); v && !v->empty()) {
        d.value = *v;
    }
    if (auto l = xml_lang(el); l && !l->empty()) {
        d.lang = *l;
    }
    return d;
}

model::Sequence convert_sequence(xmlNodePtr el, Ctx& ctx, const char* slot) {
    model::Sequence s;
    s.name = plain_attr(el, "name").value_or("");
    if (auto n = plain_attr(el, "number")) {
        s.number = parse_int(*n);
    }
    if (auto l = xml_lang(el); l && !l->empty()) {
        s.lang = *l;
    }
    for (xmlNodePtr c = el->children; c != nullptr; c = c->next) {
        if (c->type != XML_ELEMENT_NODE) {
            continue;
        }
        if (is_named(c, "sequence")) {
            s.children.push_back(convert_sequence(c, ctx, slot));
        } else {
            add_extra(ctx, c, slot);
        }
    }
    return s;
}

model::ImageRef convert_image_ref(xmlNodePtr el) {
    model::ImageRef ref;
    ref.href = xlink_href(el).value_or("");
    if (auto a = plain_attr(el, "alt")) {
        ref.alt = *a;
    }
    if (auto t = plain_attr(el, "title")) {
        ref.title = *t;
    }
    if (auto i = plain_attr(el, "id")) {
        ref.id = *i;
    }
    return ref;
}

model::TitleInfo convert_title_info(xmlNodePtr el, Ctx& ctx, const char* slot) {
    model::TitleInfo info;
    bool have_title = false;
    bool have_lang = false;
    for (xmlNodePtr c = el->children; c != nullptr; c = c->next) {
        if (c->type == XML_COMMENT_NODE || c->type == XML_PI_NODE) {
            add_extra(ctx, c, slot);
            continue;
        }
        if (c->type != XML_ELEMENT_NODE) {
            continue;
        }
        if (!is_fb2_element(c)) {
            add_extra(ctx, c, slot);
            continue;
        }
        const std::string name = str(c->name);
        if (name == "genre") {
            model::GenreRef g;
            g.code = trim(text_content(c));
            if (auto m = plain_attr(c, "match")) {
                if (auto v = parse_int(*m); v && *v != 100) {
                    g.match = *v;
                }
            }
            info.genres.push_back(std::move(g));
        } else if (name == "author") {
            info.authors.push_back(convert_person(c, ctx, slot));
        } else if (name == "book-title" && !have_title) {
            info.bookTitle = text_content(c);
            have_title = true;
        } else if (name == "annotation" && !info.annotation) {
            info.annotation = convert_annotation(c, ctx);
        } else if (name == "keywords" && !info.keywords) {
            info.keywords = opt_text(c);
        } else if (name == "date" && !info.date) {
            info.date = convert_date(c);
        } else if (name == "coverpage") {
            for (xmlNodePtr img = c->children; img != nullptr; img = img->next) {
                if (img->type != XML_ELEMENT_NODE) {
                    continue;
                }
                if (is_named(img, "image")) {
                    info.coverpage.push_back(convert_image_ref(img));
                } else {
                    add_extra(ctx, img, slot);
                }
            }
        } else if (name == "lang" && !have_lang) {
            info.lang = trim(text_content(c));
            have_lang = true;
        } else if (name == "src-lang" && !info.srcLang) {
            info.srcLang = opt_text(c);
        } else if (name == "translator") {
            info.translators.push_back(convert_person(c, ctx, slot));
        } else if (name == "sequence") {
            info.sequences.push_back(convert_sequence(c, ctx, slot));
        } else {
            add_extra(ctx, c, slot);  // unknown or duplicate single-valued element
        }
    }
    return info;
}

model::DocumentInfo convert_document_info(xmlNodePtr el, Ctx& ctx) {
    static const char* slot = "document-info";
    model::DocumentInfo info;
    bool have_date = false;
    bool have_id = false;
    bool have_version = false;
    for (xmlNodePtr c = el->children; c != nullptr; c = c->next) {
        if (c->type == XML_COMMENT_NODE || c->type == XML_PI_NODE) {
            add_extra(ctx, c, slot);
            continue;
        }
        if (c->type != XML_ELEMENT_NODE) {
            continue;
        }
        if (!is_fb2_element(c)) {
            add_extra(ctx, c, slot);
            continue;
        }
        const std::string name = str(c->name);
        if (name == "author") {
            info.authors.push_back(convert_person(c, ctx, slot));
        } else if (name == "program-used" && !info.programUsed) {
            info.programUsed = opt_text(c);
        } else if (name == "date" && !have_date) {
            info.date = convert_date(c);
            have_date = true;
        } else if (name == "src-url") {
            info.srcUrls.push_back(text_content(c));
        } else if (name == "src-ocr" && !info.srcOcr) {
            info.srcOcr = opt_text(c);
        } else if (name == "id" && !have_id) {
            info.id = trim(text_content(c));
            have_id = true;
        } else if (name == "version" && !have_version) {
            info.version = trim(text_content(c));
            have_version = true;
        } else if (name == "history" && !info.history) {
            info.history = convert_annotation(c, ctx);
        } else if (name == "publisher") {
            info.publishers.push_back(convert_person(c, ctx, slot));
        } else {
            add_extra(ctx, c, slot);
        }
    }
    return info;
}

model::PublishInfo convert_publish_info(xmlNodePtr el, Ctx& ctx) {
    static const char* slot = "publish-info";
    model::PublishInfo info;
    for (xmlNodePtr c = el->children; c != nullptr; c = c->next) {
        if (c->type == XML_COMMENT_NODE || c->type == XML_PI_NODE) {
            add_extra(ctx, c, slot);
            continue;
        }
        if (c->type != XML_ELEMENT_NODE) {
            continue;
        }
        if (!is_fb2_element(c)) {
            add_extra(ctx, c, slot);
            continue;
        }
        const std::string name = str(c->name);
        if (name == "book-name" && !info.bookName) {
            info.bookName = opt_text(c);
        } else if (name == "publisher" && !info.publisher) {
            info.publisher = opt_text(c);
        } else if (name == "city" && !info.city) {
            info.city = opt_text(c);
        } else if (name == "year" && !info.year) {
            info.year = opt_text(c);
        } else if (name == "isbn" && !info.isbn) {
            info.isbn = opt_text(c);
        } else if (name == "sequence") {
            info.sequences.push_back(convert_sequence(c, ctx, slot));
        } else {
            add_extra(ctx, c, slot);
        }
    }
    return info;
}

void convert_description(xmlNodePtr el, Ctx& ctx) {
    static const char* slot = "description";
    model::Description& d = ctx.doc->description;
    bool have_title = false;
    bool have_doc = false;
    for (xmlNodePtr c = el->children; c != nullptr; c = c->next) {
        if (c->type == XML_COMMENT_NODE || c->type == XML_PI_NODE) {
            add_extra(ctx, c, slot);
            continue;
        }
        if (c->type != XML_ELEMENT_NODE) {
            continue;
        }
        if (!is_fb2_element(c)) {
            add_extra(ctx, c, slot);
            continue;
        }
        const std::string name = str(c->name);
        if (name == "title-info" && !have_title) {
            d.titleInfo = convert_title_info(c, ctx, "title-info");
            have_title = true;
        } else if (name == "src-title-info" && !d.srcTitleInfo) {
            d.srcTitleInfo = convert_title_info(c, ctx, "src-title-info");
        } else if (name == "document-info" && !have_doc) {
            d.documentInfo = convert_document_info(c, ctx);
            have_doc = true;
        } else if (name == "publish-info" && !d.publishInfo) {
            d.publishInfo = convert_publish_info(c, ctx);
        } else if (name == "custom-info") {
            model::CustomInfo ci;
            ci.infoType = plain_attr(c, "info-type").value_or("");
            ci.text = text_content(c);
            if (auto l = xml_lang(c); l && !l->empty()) {
                ci.lang = *l;
            }
            d.customInfo.push_back(std::move(ci));
        } else if (name == "output") {
            d.outputs.push_back(raw_of(c, false));
        } else {
            add_extra(ctx, c, slot);
        }
    }
}

/* ----------------------------------------------------------------------------------------- */
/* SAX interception of <binary> payloads                                                     */
/* ----------------------------------------------------------------------------------------- */

struct BinaryCapture {
    bool active = false;
    int depth = 0;  // nested elements inside <binary> (invalid, but tolerated)
    std::string id;
    std::string content_type;
    base64::Decoder decoder;
    std::string raw;  // original text, kept until the payload decodes cleanly
};

struct SaxState {
    xmlSAXHandler base{};  // libxml2's SAX2 DOM builders
    BinaryStore* store = nullptr;
    const BinaryStore* placeholder_source = nullptr;
    std::vector<model::ValidationIssue>* warnings = nullptr;
    BinaryCapture capture;
    int anonymous_counter = 0;
    std::vector<std::string> order;  // ids in document order
};

SaxState* state_of(void* ctx) {
    return static_cast<SaxState*>(xmlCtxtGetPrivate(static_cast<xmlParserCtxtPtr>(ctx)));
}

void warn(SaxState& st, const std::string& code, std::map<std::string, json> params) {
    model::ValidationIssue issue;
    issue.severity = model::Severity::warning;
    issue.code = code;
    issue.params = std::move(params);
    st.warnings->push_back(std::move(issue));
}

// `…1234 bytes…` placeholder written by the Source view serialisation (elideBinaries).
std::optional<std::int64_t> placeholder_size(const std::string& raw) {
    const std::string t = trim(raw);
    static const std::string kEllipsis = "\xE2\x80\xA6";
    static const std::string kSuffix = " bytes\xE2\x80\xA6";
    if (t.size() < kEllipsis.size() + kSuffix.size() + 1 ||
        t.compare(0, kEllipsis.size(), kEllipsis) != 0 ||
        t.compare(t.size() - kSuffix.size(), kSuffix.size(), kSuffix) != 0) {
        return std::nullopt;
    }
    const std::string digits =
        t.substr(kEllipsis.size(), t.size() - kEllipsis.size() - kSuffix.size());
    if (digits.empty() || !std::all_of(digits.begin(), digits.end(),
                                       [](unsigned char c) { return std::isdigit(c) != 0; })) {
        return std::nullopt;
    }
    return std::stoll(digits);
}

void finish_binary(SaxState& st) {
    BinaryCapture& cap = st.capture;
    std::string id = cap.id;
    if (id.empty()) {
        id = "binary_" + std::to_string(++st.anonymous_counter);
        while (st.store->contains(id)) {
            id = "binary_" + std::to_string(++st.anonymous_counter);
        }
        warn(st, "binary.missingId", {{"assigned", id}});
    } else if (st.store->contains(id)) {
        const std::string renamed = st.store->unique_id(id);
        warn(st, "binary.duplicateId", {{"id", id}, {"renamed", renamed}});
        id = renamed;
    }
    const bool decoded = !cap.decoder.failed() && cap.decoder.finish();
    if (decoded) {
        st.store->put(id, cap.content_type, cap.decoder.take());
    } else if (const auto size = placeholder_size(cap.raw)) {
        std::optional<std::string> bytes;
        if (st.placeholder_source != nullptr) {
            bytes = st.placeholder_source->bytes(cap.id);
        }
        if (bytes) {
            st.store->put(id, cap.content_type, std::move(*bytes),
                          st.placeholder_source->is_raw_text(cap.id));
        } else {
            warn(st, "binary.placeholderMissing", {{"id", cap.id}, {"size", *size}});
        }
    } else {
        // Keep the original text so nothing is lost; reported, never dropped (FR-111).
        warn(st, "binary.invalidBase64", {{"id", id}});
        st.store->put(id, cap.content_type, std::move(cap.raw), true);
    }
    cap = BinaryCapture{};
}

void sax_start_element(void* ctx, const xmlChar* localname, const xmlChar* prefix,
                       const xmlChar* URI, int nb_namespaces, const xmlChar** namespaces,
                       int nb_attributes, int nb_defaulted, const xmlChar** attributes) {
    SaxState* st = state_of(ctx);
    if (st->capture.active) {
        ++st->capture.depth;
    } else if (xmlStrEqual(localname, X("binary")) != 0 &&
               (URI == nullptr || xmlStrEqual(URI, X(kFb2Namespace)) != 0)) {
        st->capture.active = true;
        st->capture.depth = 0;
        for (int i = 0; i < nb_attributes; ++i) {
            const xmlChar** a = attributes + i * 5;
            const std::string name = str(a[0]);
            const std::string value(reinterpret_cast<const char*>(a[3]),
                                    static_cast<std::size_t>(a[4] - a[3]));
            if (a[2] == nullptr && name == "id") {
                st->capture.id = value;
            } else if (a[2] == nullptr && name == "content-type") {
                st->capture.content_type = value;
            }
        }
    }
    if (st->base.startElementNs != nullptr) {
        st->base.startElementNs(ctx, localname, prefix, URI, nb_namespaces, namespaces,
                                nb_attributes, nb_defaulted, attributes);
    }
}

void sax_end_element(void* ctx, const xmlChar* localname, const xmlChar* prefix,
                     const xmlChar* URI) {
    SaxState* st = state_of(ctx);
    if (st->capture.active) {
        if (st->capture.depth > 0) {
            --st->capture.depth;
        } else {
            finish_binary(*st);
        }
    }
    if (st->base.endElementNs != nullptr) {
        st->base.endElementNs(ctx, localname, prefix, URI);
    }
}

void sax_characters(void* ctx, const xmlChar* ch, int len) {
    SaxState* st = state_of(ctx);
    if (st->capture.active) {
        const std::string_view chunk(reinterpret_cast<const char*>(ch),
                                     static_cast<std::size_t>(len));
        st->capture.raw.append(chunk);
        if (!st->capture.decoder.failed()) {
            st->capture.decoder.feed(chunk);
        }
        return;  // never becomes a DOM text node
    }
    if (st->base.characters != nullptr) {
        st->base.characters(ctx, ch, len);
    }
}

void sax_cdata(void* ctx, const xmlChar* value, int len) {
    SaxState* st = state_of(ctx);
    if (st->capture.active) {
        sax_characters(ctx, value, len);
        return;
    }
    if (st->base.cdataBlock != nullptr) {
        st->base.cdataBlock(ctx, value, len);
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Root                                                                                      */
/* ----------------------------------------------------------------------------------------- */

std::string find_xlink_prefix(xmlNodePtr root) {
    std::string first;
    for (xmlNsPtr ns = root->nsDef; ns != nullptr; ns = ns->next) {
        if (ns->href != nullptr && xmlStrEqual(ns->href, X(kXlinkNamespace)) != 0 &&
            ns->prefix != nullptr) {
            const std::string prefix = str(ns->prefix);
            if (prefix == kDefaultXlinkPrefix) {
                return prefix;
            }
            if (first.empty()) {
                first = prefix;
            }
        }
    }
    return first.empty() ? kDefaultXlinkPrefix : first;
}

void convert_root(xmlNodePtr root, Ctx& ctx) {
    bool have_description = false;
    for (xmlNodePtr c = root->children; c != nullptr; c = c->next) {
        if (c->type == XML_COMMENT_NODE || c->type == XML_PI_NODE) {
            add_extra(ctx, c, "FictionBook");
            continue;
        }
        if (c->type != XML_ELEMENT_NODE) {
            continue;  // inter-element whitespace
        }
        if (!is_fb2_element(c)) {
            add_extra(ctx, c, "FictionBook");
            continue;
        }
        const std::string name = str(c->name);
        if (name == "stylesheet") {
            model::Stylesheet s;
            s.type = plain_attr(c, "type").value_or("");
            s.content = text_content(c);
            ctx.doc->stylesheets.push_back(std::move(s));
        } else if (name == "description" && !have_description) {
            convert_description(c, ctx);
            have_description = true;
        } else if (name == "body") {
            ctx.doc->bodies.push_back(convert_block_element(c, ctx));
        } else if (name == "binary") {
            // Payload already lives in the store (SAX capture); nothing to keep in the tree.
        } else {
            add_extra(ctx, c, "FictionBook");
        }
    }
}

model::FileKind kind_from_path(const std::string& path) {
    return model::file_kind_from_extension(std::filesystem::path(path).extension().string());
}

ParseError to_parse_error(const xml::CollectedError& e) {
    return ParseError{e.line, e.column, e.message};
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Public API                                                                                */
/* ----------------------------------------------------------------------------------------- */

std::string read_file_bytes(const std::filesystem::path& path) {
    std::error_code ec;
    if (!std::filesystem::exists(path, ec)) {
        throw IoFailure(path.string(), "file not found");
    }
    if (std::filesystem::is_directory(path, ec)) {
        throw IoFailure(path.string(), "is a directory");
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw IoFailure(path.string(), "cannot open file for reading");
    }
    in.seekg(0, std::ios::end);
    const std::streamoff size = in.tellg();
    if (size < 0) {
        throw IoFailure(path.string(), "cannot determine file size");
    }
    if (static_cast<std::size_t>(size) > xml::kMaxDocumentBytes) {
        throw IoFailure(path.string(), "file is larger than the supported maximum (512 MB)");
    }
    in.seekg(0, std::ios::beg);
    std::string data(static_cast<std::size_t>(size), '\0');
    in.read(data.data(), size);
    if (!in && size > 0) {
        throw IoFailure(path.string(), "read error");
    }
    return data;
}

ReadResult read_bytes(std::string_view bytes, BinaryStore& store, model::NodeIdAllocator& ids,
                      const ReadOptions& options, const std::string& display_path) {
    ReadResult result;
    model::Document& doc = result.document;
    Ctx ctx;
    ctx.doc = &doc;
    ctx.warnings = &result.warnings;

    // 1. Encoding.
    std::string encoding;
    if (!options.force_encoding.empty()) {
        encoding =
            encoding::normalize_name(options.force_encoding).value_or(options.force_encoding);
        const auto bom = encoding::detect_bom(bytes);
        if (!bom.encoding.empty()) {
            bytes.remove_prefix(bom.length);
            result.bom = true;
        }
        result.declared_encoding = encoding::declared_encoding(bytes);
    } else {
        const encoding::Detection detection = encoding::detect_encoding(bytes);
        encoding = detection.detected;
        result.declared_encoding = detection.declared;
        result.bom = detection.bom;
        if (detection.bom) {
            bytes.remove_prefix(encoding::detect_bom(bytes).length);
        }
        if (detection.mismatch) {
            ctx.warn("encoding.mismatch", {{"declared", detection.declared},
                                           {"detected", detection.detected},
                                           {"reason", detection.reason}});
        }
    }
    doc.sourceEncoding = encoding;

    // 2. Parse (binaries stripped into the store on the fly).
    SaxState sax_state;
    std::memset(&sax_state.base, 0, sizeof(sax_state.base));
    xml::ensure_libxml_initialised();
    xmlSAXVersion(&sax_state.base, 2);
    sax_state.store = &store;
    sax_state.placeholder_source = options.placeholder_source;
    sax_state.warnings = &result.warnings;
    xmlSAXHandler sax = sax_state.base;
    sax.startElementNs = sax_start_element;
    sax.endElementNs = sax_end_element;
    sax.characters = sax_characters;
    sax.ignorableWhitespace = sax_characters;
    sax.cdataBlock = sax_cdata;

    std::vector<xml::CollectedError> errors;
    const char* libxml_encoding = encoding.c_str();
    // libxml2 has its own (identical) converters for these; passing the canonical name keeps
    // its BOM handling and declaration checks on the normal path.
    xmlDocPtr xml_doc =
        xml::parse_memory(bytes, display_path.empty() ? nullptr : display_path.c_str(),
                          libxml_encoding, errors, &sax, &sax_state);
    if (xml_doc == nullptr) {
        // Malformed XML opens in Source-only mode only when it is at least a FictionBook file.
        if (const auto reason = not_fictionbook_reason(bytes)) {
            throw NotFictionBookFailure(*reason);
        }
        throw ParseFailure(to_parse_error(xml::primary_error(errors)));
    }
    struct DocGuard {
        xmlDocPtr d;
        ~DocGuard() { xmlFreeDoc(d); }
    } guard{xml_doc};

    xmlNodePtr root = xmlDocGetRootElement(xml_doc);
    if (root == nullptr || xmlStrEqual(root->name, X("FictionBook")) == 0) {
        throw NotFictionBookFailure("rootNotFictionBook",
                                    root == nullptr ? 1 : static_cast<int>(xmlGetLineNo(root)));
    }
    if (root->ns == nullptr || xmlStrEqual(root->ns->href, X(kFb2Namespace)) == 0) {
        ctx.warn("xml.namespaceMissing", {{"expected", kFb2Namespace}});
    }

    // 3. schemaHint: does the input validate as-is?
    if (options.compute_schema_hint) {
        const auto schema_errors = validation::schema_validate(xml_doc);
        result.schema_issues = validation::to_issues(schema_errors);
        doc.schemaHint = schema_errors.empty() ? model::SchemaHint::v21 : model::SchemaHint::legacy;
    } else {
        doc.schemaHint = model::SchemaHint::unknown;
    }

    // 4. Model.
    result.xlink_prefix = find_xlink_prefix(root);
    convert_root(root, ctx);
    if (!display_path.empty()) {
        std::error_code ec;
        const auto abs = std::filesystem::absolute(display_path, ec);
        doc.path = ec ? display_path : abs.string();
    }
    doc.fileKind = options.file_kind.value_or(kind_from_path(display_path));
    model::assign_node_ids(doc, ids);
    update_reference_counts(doc, store);
    sync_binaries(doc, store);
    return result;
}

ReadResult read_file(const std::filesystem::path& path, BinaryStore& store,
                     model::NodeIdAllocator& ids, const ReadOptions& options) {
    const std::string bytes = read_file_bytes(path);
    return read_bytes(bytes, store, ids, options, path.string());
}

std::optional<ParseError> check_well_formed(std::string_view utf8_text) {
    std::vector<xml::CollectedError> errors;
    xmlDocPtr doc = xml::parse_memory(utf8_text, nullptr, "UTF-8", errors);
    if (doc == nullptr) {
        return to_parse_error(xml::primary_error(errors));
    }
    xmlFreeDoc(doc);
    return std::nullopt;
}

std::optional<std::string> not_fictionbook_reason(std::string_view bytes) {
    const encoding::Detection detection = encoding::detect_encoding(bytes);
    const bool utf16 = detection.detected.rfind("utf-16", 0) == 0;
    if (!utf16) {
        const std::size_t probe = std::min<std::size_t>(bytes.size(), 8192);
        if (bytes.substr(0, probe).find('\0') != std::string_view::npos) {
            return "binary";
        }
    }
    const encoding::DecodeResult decoded = encoding::decode_to_utf8(bytes, detection.detected);
    std::string_view text = decoded.utf8;
    if (text.rfind("\xEF\xBB\xBF", 0) == 0) {
        text.remove_prefix(3);
    }
    const std::size_t first = text.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos || text[first] != '<') {
        return "notXml";
    }
    // `<FictionBook` or `<prefix:FictionBook`, followed by whitespace, '>' or '/'.
    static constexpr std::string_view kName = "FictionBook";
    for (std::size_t pos = text.find(kName); pos != std::string_view::npos;
         pos = text.find(kName, pos + 1)) {
        const std::size_t end = pos + kName.size();
        const bool terminated = end >= text.size() || text[end] == '>' || text[end] == '/' ||
                                std::isspace(static_cast<unsigned char>(text[end])) != 0;
        if (!terminated || pos == 0) {
            continue;
        }
        std::size_t start = pos;
        if (start > 0 && text[start - 1] == ':') {  // namespace prefix: <fb:FictionBook
            --start;
            const auto is_name_char = [](char c) {
                return std::isalnum(static_cast<unsigned char>(c)) != 0 || c == '_' || c == '-' ||
                       c == '.';
            };
            while (start > 0 && is_name_char(text[start - 1])) {
                --start;
            }
        }
        if (start > 0 && text[start - 1] == '<') {
            return std::nullopt;
        }
    }
    return "notXml";
}

SourceText read_source(const std::filesystem::path& path) {
    const std::string bytes = read_file_bytes(path);
    if (const auto reason = not_fictionbook_reason(bytes)) {
        throw NotFictionBookFailure(*reason);
    }
    SourceText out;
    const encoding::Detection detection = encoding::detect_encoding(bytes);
    out.encoding = detection.detected;
    if (detection.mismatch) {
        model::ValidationIssue issue;
        issue.severity = model::Severity::warning;
        issue.code = "encoding.mismatch";
        issue.params = {{"declared", detection.declared},
                        {"detected", detection.detected},
                        {"reason", detection.reason}};
        out.warnings.push_back(std::move(issue));
    }
    encoding::DecodeResult decoded = encoding::decode_to_utf8(bytes, detection.detected);
    out.text = std::move(decoded.utf8);
    out.error = check_well_formed(out.text);
    return out;
}

}  // namespace mfbe::fb2
