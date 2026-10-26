// FB2 reader (T041). See mfbe/fb2_reader.hpp for the mapping rules.
#include "xml/validator_internal.hpp"
#include "xml/xml_security.hpp"

#include <mfbe/base64.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/log.hpp>
#include <mfbe/schema_table.hpp>
#include <mfbe/utf8_paths.hpp>

#include <libxml/SAX2.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/xmlstring.h>

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <set>
#include <utility>

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

// Byte range of a DOM node in the parsed bytes (feature 004 US7), recorded by the SAX
// callbacks; the node's `_private` holds its 1-based index into the range list.
struct NodeRange {
    std::size_t tagBegin = 0;
    std::size_t contentBegin = 0;
    std::size_t contentEnd = 0;
    std::size_t end = 0;
    bool selfClosing = false;
};

// Name of the attribute that carries a node's range from the DOM to the model until the node
// ids are assigned; stripped again before the document leaves the reader.
constexpr const char* kPositionAttr = "$pos";

struct Ctx {
    model::Document* doc = nullptr;
    std::vector<model::ValidationIssue>* warnings = nullptr;
    // Ranges of the DOM nodes when positions are recorded (null otherwise).
    const std::vector<NodeRange>* ranges = nullptr;

    void warn(const std::string& code, std::map<std::string, json> params) {
        model::ValidationIssue issue;
        issue.severity = model::Severity::warning;
        issue.code = code;
        issue.params = std::move(params);
        warnings->push_back(std::move(issue));
    }
};

const NodeRange* range_of(const Ctx& ctx, const xmlNode* node) {
    if (ctx.ranges == nullptr || node == nullptr || node->_private == nullptr) {
        return nullptr;
    }
    const auto index = reinterpret_cast<std::uintptr_t>(node->_private);
    if (index == 0 || index > ctx.ranges->size()) {
        return nullptr;
    }
    return &(*ctx.ranges)[index - 1];
}

// Carries the DOM node's range onto the model node (body-tree contexts only).
void attach_position(Node& out, const xmlNode* el, const Ctx& ctx) {
    if (const NodeRange* r = range_of(ctx, el)) {
        out.attrs[kPositionAttr] =
            json::array({r->tagBegin, r->contentBegin, r->contentEnd, r->end});
    }
}

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
        // A cell's xml:lang is its `lang` (feature 006, FR-020; tdType extends styleType); the
        // schema gives table and tr none, so theirs stays an unknown attribute.
        {"td", {{"id", "style", "colspan", "rowspan", "align", "valign"}, true, false}},
        {"th", {{"id", "style", "colspan", "rowspan", "align", "valign"}, true, false}},
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
                    // The integer value as read (feature 006, FR-047): a value of 1 or more in
                    // any spelling (the writer respells " 2 ", "+2" and "02" as "2", a recorded
                    // normalisation), and a smaller one only in its canonical decimal form
                    // ("0", "-1"); any other text ("00", "+0", "-01", "abc", "2.5", a number
                    // out of range) travels verbatim in unknownAttrs and is written back
                    // exactly.
                    const auto n = parse_int(value);
                    if (n && (*n >= 1 || std::to_string(*n) == value)) {
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

// An inline atom (an inline image or inline raw XML: an unknown or misplaced element, a
// comment, a processing instruction) takes the marks open at its place, as text does
// (feature 006, FR-067).
void append_atom(std::vector<Node>& out, Node atom, const std::vector<Mark>& marks) {
    atom.marks = marks;
    out.push_back(std::move(atom));
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
                append_atom(out, raw_of(c, true), marks);
                attach_position(out.back(), c, ctx);
                break;
            case XML_ELEMENT_NODE: {
                if (!is_fb2_element(c)) {
                    append_atom(out, raw_of(c, true), marks);
                    attach_position(out.back(), c, ctx);
                    break;
                }
                const std::string name = str(c->name);
                // Marks keep the attributes the schema gives them (feature 006, FR-064):
                // xml:lang on formatting (any value, "" included), name and xml:lang on style,
                // xlink:href, type and xlink:type on links. Every other attribute of a mark is
                // dropped without a report (decision 10, a recorded exception); `attrs` is an
                // object only with a member, so a mark read here equals one decoded from JSON.
                std::optional<Mark> mark;
                if (name == "strong" || name == "emphasis" || name == "strikethrough" ||
                    name == "sub" || name == "sup" || name == "code") {
                    json attrs = nullptr;
                    if (auto lang = xml_lang(c)) {
                        attrs = json{{"lang", *lang}};
                    }
                    mark = Mark{name, attrs};
                } else if (name == "style") {
                    json attrs{{"name", plain_attr(c, "name").value_or("")}};
                    if (auto lang = xml_lang(c)) {
                        attrs["lang"] = *lang;
                    }
                    mark = Mark{"style", attrs};
                } else if (name == "a") {
                    json attrs{{"href", xlink_href(c).value_or("")}};
                    if (auto type = plain_attr(c, "type")) {
                        attrs["type"] = *type;
                    }
                    if (auto xlink_type = ns_attr(c, "type", kXlinkNamespace)) {
                        attrs["xlinkType"] = *xlink_type;
                    }
                    mark = Mark{"link", attrs};
                } else if (name == "image") {
                    Node img;
                    img.type = "inline-image";
                    collect_attrs(c, img, "inline-image");
                    attach_position(img, c, ctx);
                    append_atom(out, std::move(img), marks);
                    break;
                } else {
                    // A block element or an unknown inline element.
                    append_atom(out, raw_of(c, true), marks);
                    attach_position(out.back(), c, ctx);
                    break;
                }
                // Nested formatting of one kind with other attributes is a mark of its own,
                // outer first (feature 006, FR-069; every formatting type): only an equal open
                // mark - same type, name and language - collapses. Links keep the outer one:
                // the schema holds no `a` inside `a`.
                const bool duplicate = mark->type == "link" ? has_mark(marks, "link")
                                                            : std::find(marks.begin(), marks.end(),
                                                                        *mark) != marks.end();
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
    attach_position(n, el, ctx);
    std::vector<Mark> marks;
    convert_inline_children(el, n.content, marks, ctx);
    return n;
}

Node convert_date_node(xmlNodePtr el, const Ctx& ctx) {
    Node n;
    n.type = "date";
    collect_attrs(el, n, "date");
    attach_position(n, el, ctx);
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
        attach_position(n, el, ctx);
        return n;
    }
    if (name == "image") {
        Node n;
        n.type = "image";
        collect_attrs(el, n, "image");
        attach_position(n, el, ctx);
        return n;
    }
    if (name == "date") {
        return convert_date_node(el, ctx);
    }
    Node n;
    n.type = name;  // body, section, title, epigraph, annotation, poem, stanza, cite, table, tr
    collect_attrs(el, n, name);
    attach_position(n, el, ctx);
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
                attach_position(out.content.back(), c, ctx);
                break;
            case XML_ELEMENT_NODE:
                if (is_fb2_element(c) && is_block_name(str(c->name))) {
                    out.content.push_back(convert_block_element(c, ctx));
                } else {
                    out.content.push_back(raw_of(c, false));
                    attach_position(out.content.back(), c, ctx);
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
    attach_position(n, el, ctx);
    convert_block_children(el, n, ctx);
    return n;
}

/* ----------------------------------------------------------------------------------------- */
/* Position map (feature 004 US7)                                                            */
/* ----------------------------------------------------------------------------------------- */

// Moves the ranges carried in `$pos` attributes of `node`'s subtree into `map` (pre-order,
// parents before children) and strips the attribute. `prefix`: bytes stripped before parsing
// (a BOM), added back so the offsets index the given bytes.
void collect_positions(Node& node, int parent, std::size_t prefix, PositionMap& map) {
    int self = parent;
    auto it = node.attrs.find(kPositionAttr);
    if (it != node.attrs.end()) {
        const json& r = it->second;
        if (r.is_array() && r.size() == 4 && !node.node_id().empty()) {
            PositionEntry entry;
            entry.nodeId = node.node_id();
            entry.kind = position_kind(node);
            entry.tagBegin = r[0].get<std::size_t>() + prefix;
            entry.contentBegin = r[1].get<std::size_t>() + prefix;
            entry.contentEnd = r[2].get<std::size_t>() + prefix;
            entry.end = r[3].get<std::size_t>() + prefix;
            entry.parent = parent;
            map.entries.push_back(std::move(entry));
            self = static_cast<int>(map.entries.size() - 1);
        }
        node.attrs.erase(it);
    }
    for (Node& child : node.content) {
        if (!child.is_text()) {
            collect_positions(child, self, prefix, map);
        }
    }
}

// Strips the `$pos` attributes of a subtree whose positions are not mapped (defensive: the
// body-tree conversion is the only one that attaches them, and only under the mapped roots).
void strip_positions(Node& node) {
    node.attrs.erase(kPositionAttr);
    for (Node& child : node.content) {
        strip_positions(child);
    }
}

// The map of a converted document: the bodies, the title-info and src-title-info annotations
// and the history, in text order with the UTF-16 offsets computed over `full_text`.
PositionMap collect_position_map(model::Document& doc, std::size_t prefix,
                                 std::string_view full_text) {
    PositionMap map;
    map.prefix = prefix;
    for (Node& body : doc.bodies) {
        collect_positions(body, -1, prefix, map);
    }
    if (doc.description.titleInfo.annotation) {
        collect_positions(*doc.description.titleInfo.annotation, -1, prefix, map);
    }
    if (doc.description.srcTitleInfo && doc.description.srcTitleInfo->annotation) {
        collect_positions(*doc.description.srcTitleInfo->annotation, -1, prefix, map);
    }
    if (doc.description.documentInfo.history) {
        collect_positions(*doc.description.documentInfo.history, -1, prefix, map);
    }
    for (Node& output : doc.description.outputs) {
        strip_positions(output);
    }
    for (Node& extra : doc.extras) {
        strip_positions(extra);
    }
    finalize_position_map(map, full_text, true);
    return map;
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
    // Position map (feature 004 US7): the parsed bytes and the ranges of the DOM nodes.
    bool record_positions = false;
    std::string_view text;
    std::vector<NodeRange> ranges;
};

SaxState* state_of(void* ctx) {
    return static_cast<SaxState*>(xmlCtxtGetPrivate(static_cast<xmlParserCtxtPtr>(ctx)));
}

// The parser's position in the parsed bytes: the bytes consumed so far (libxml2 2.15,
// "counted in possibly decoded UTF-8 bytes" - the input is UTF-8 when positions are recorded).
std::size_t input_position(void* ctx) {
    unsigned long consumed = 0;
    if (xmlCtxtGetInputPosition(static_cast<xmlParserCtxtPtr>(ctx), 0, nullptr, nullptr, nullptr,
                                &consumed) != 0) {
        return 0;
    }
    return static_cast<std::size_t>(consumed);
}

// Index of the `<` that opens the tag or construct ending before `pos` (0 when none): a `<`
// cannot occur inside a tag, so the previous one is the tag's own.
std::size_t previous_lt(std::string_view text, std::size_t pos) {
    const std::size_t from = std::min(pos, text.size());
    if (from == 0) {
        return 0;
    }
    const std::size_t found = text.rfind('<', from - 1);
    return found == std::string_view::npos ? 0 : found;
}

std::size_t previous_marker(std::string_view text, std::size_t pos, const char* marker) {
    const std::size_t from = std::min(pos, text.size());
    if (from == 0) {
        return 0;
    }
    const std::size_t found = text.rfind(marker, from - 1);
    return found == std::string_view::npos ? 0 : found;
}

void attach_range(xmlNodePtr node, SaxState& st, NodeRange range) {
    st.ranges.push_back(range);
    node->_private = reinterpret_cast<void*>(static_cast<std::uintptr_t>(st.ranges.size()));
}

NodeRange* range_of_node(xmlNodePtr node, SaxState& st) {
    if (node == nullptr || node->_private == nullptr) {
        return nullptr;
    }
    const auto index = reinterpret_cast<std::uintptr_t>(node->_private);
    if (index == 0 || index > st.ranges.size()) {
        return nullptr;
    }
    return &st.ranges[index - 1];
}

// After the SAX2 start-element builder ran: the cursor sits on the `>` (or the `/` of `/>`)
// of the start tag and the new element is the context node.
void record_start(void* ctx, SaxState& st) {
    xmlNodePtr node = xmlCtxtGetNode(static_cast<xmlParserCtxtPtr>(ctx));
    if (node == nullptr || node->type != XML_ELEMENT_NODE) {
        return;
    }
    const std::size_t pos = input_position(ctx);
    NodeRange range;
    range.tagBegin = previous_lt(st.text, pos);
    range.selfClosing = pos < st.text.size() && st.text[pos] == '/';
    range.contentBegin = pos + 1;
    attach_range(node, st, range);
}

// Before the SAX2 end-element builder pops the element: the cursor is past the `>` of the end
// tag (or of `/>`).
void record_end(void* ctx, SaxState& st) {
    xmlNodePtr node = xmlCtxtGetNode(static_cast<xmlParserCtxtPtr>(ctx));
    NodeRange* range = range_of_node(node, st);
    if (range == nullptr) {
        return;
    }
    range->end = input_position(ctx);
    if (range->selfClosing) {
        range->contentBegin = range->contentEnd = range->end;
    } else {
        range->contentEnd = previous_lt(st.text, range->end);
    }
}

// After the SAX2 comment / PI builder added the node as the last child of the context node:
// the cursor is past `-->` / `?>`.
void record_atom(void* ctx, SaxState& st, const char* opener) {
    xmlNodePtr parent = xmlCtxtGetNode(static_cast<xmlParserCtxtPtr>(ctx));
    if (parent == nullptr || parent->last == nullptr) {
        return;
    }
    xmlNodePtr node = parent->last;
    if (node->type != XML_COMMENT_NODE && node->type != XML_PI_NODE) {
        return;
    }
    NodeRange range;
    range.end = input_position(ctx);
    range.tagBegin = previous_marker(st.text, range.end, opener);
    range.contentBegin = range.contentEnd = range.end;
    range.selfClosing = true;
    attach_range(node, st, range);
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
    if (st->record_positions) {
        record_start(ctx, *st);
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
    if (st->record_positions) {
        record_end(ctx, *st);
    }
    if (st->base.endElementNs != nullptr) {
        st->base.endElementNs(ctx, localname, prefix, URI);
    }
}

void sax_comment(void* ctx, const xmlChar* value) {
    SaxState* st = state_of(ctx);
    if (st->base.comment != nullptr) {
        st->base.comment(ctx, value);
    }
    if (st->record_positions) {
        record_atom(ctx, *st, "<!--");
    }
}

void sax_processing_instruction(void* ctx, const xmlChar* target, const xmlChar* data) {
    SaxState* st = state_of(ctx);
    if (st->base.processingInstruction != nullptr) {
        st->base.processingInstruction(ctx, target, data);
    }
    if (st->record_positions) {
        record_atom(ctx, *st, "<?");
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
    return model::file_kind_from_extension(
        platform::utf8_from_path(platform::path_from_utf8(path).extension()));
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
        throw IoFailure(platform::utf8_from_path(path), "file not found");
    }
    if (std::filesystem::is_directory(path, ec)) {
        throw IoFailure(platform::utf8_from_path(path), "is a directory");
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw IoFailure(platform::utf8_from_path(path), "cannot open file for reading");
    }
    in.seekg(0, std::ios::end);
    const std::streamoff size = in.tellg();
    if (size < 0) {
        throw IoFailure(platform::utf8_from_path(path), "cannot determine file size");
    }
    if (static_cast<std::size_t>(size) > xml::kMaxDocumentBytes) {
        throw IoFailure(platform::utf8_from_path(path),
                        "file is larger than the supported maximum (512 MB)");
    }
    in.seekg(0, std::ios::beg);
    std::string data(static_cast<std::size_t>(size), '\0');
    in.read(data.data(), size);
    if (!in && size > 0) {
        throw IoFailure(platform::utf8_from_path(path), "read error");
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
    const std::string_view full_text = bytes;  // the given bytes, BOM included (positions)

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
    sax_state.record_positions = options.record_positions;
    sax_state.text = bytes;
    xmlSAXHandler sax = sax_state.base;
    sax.startElementNs = sax_start_element;
    sax.endElementNs = sax_end_element;
    sax.characters = sax_characters;
    sax.ignorableWhitespace = sax_characters;
    sax.cdataBlock = sax_cdata;
    if (options.record_positions) {
        sax.comment = sax_comment;
        sax.processingInstruction = sax_processing_instruction;
        ctx.ranges = &sax_state.ranges;
    }

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
        const auto abs = std::filesystem::absolute(platform::path_from_utf8(display_path), ec);
        doc.path = ec ? display_path : platform::utf8_from_path(abs);
    }
    doc.fileKind = options.file_kind.value_or(kind_from_path(display_path));
    model::assign_node_ids(doc, ids);
    if (options.record_positions) {
        // The ranges rode along on the model nodes; now that the ids exist they become the
        // map, offsets counted in the given bytes (the stripped BOM added back).
        result.positions = collect_position_map(doc, full_text.size() - bytes.size(), full_text);
    }
    update_reference_counts(doc, store);
    sync_binaries(doc, store);
    return result;
}

ReadResult read_file(const std::filesystem::path& path, BinaryStore& store,
                     model::NodeIdAllocator& ids, const ReadOptions& options) {
    const std::string bytes = read_file_bytes(path);
    return read_bytes(bytes, store, ids, options, platform::utf8_from_path(path));
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

/* ----------------------------------------------------------------------------------------- */
/* Fragments (feature 005)                                                                   */
/* ----------------------------------------------------------------------------------------- */

namespace {

// Walks the parsed fragment below `parent_el` (named `parent`) against the content table and
// throws FragmentNotAllowed for the first pair the schema does not admit, in document order.
void admit_fragment(const xmlNode* parent_el, const std::string& parent,
                    const schema::ContentTable& table) {
    static const schema::ElementContent kNothing;
    const schema::ElementContent* content = table.find(parent);
    if (content == nullptr) {
        content = &kNothing;
    }
    for (const xmlNode* c = parent_el->children; c != nullptr; c = c->next) {
        switch (c->type) {
            case XML_TEXT_NODE:
            case XML_CDATA_SECTION_NODE:
            case XML_ENTITY_REF_NODE:
                if (!content->text && !is_blank(str(c->content))) {
                    throw FragmentNotAllowed("#text", parent);
                }
                break;
            case XML_ELEMENT_NODE: {
                const std::string name = str(c->name);
                if (!is_fb2_element(c)) {
                    throw FragmentNotAllowed("{" + str(c->ns->href) + "}" + name, parent);
                }
                if (content->children.count(name) == 0) {
                    throw FragmentNotAllowed(name, parent);
                }
                admit_fragment(c, name, table);
                break;
            }
            default:
                break;  // comments and processing instructions: kept as raw-xml by the reader
        }
    }
}

// Lines of a text and the length of its last line (in bytes; the fragment's positions).
std::pair<int, int> text_extent(std::string_view text) {
    int lines = 1;
    std::size_t last_start = 0;
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '\n') {
            ++lines;
            last_start = i + 1;
        }
    }
    return {lines, static_cast<int>(text.size() - last_start)};
}

}  // namespace

bool is_text_container(std::string_view element) {
    return element == "p" || element == "subtitle" || element == "text-author" || element == "v" ||
           element == "td" || element == "th" || element == "date";
}

FragmentResult read_fragment(std::string_view xml, const std::string& parent_element) {
    FragmentResult result;
    result.is_inline = is_text_container(parent_element);
    if (is_blank(xml)) {
        return result;
    }
    const std::shared_ptr<const schema::ContentTable> table = schema::content_table();
    if (!table->error.empty()) {
        throw IoFailure(table->error_path, table->error);
    }

    // The wrapper: one line of ASCII before the fragment, so that the parser's line numbers
    // are the fragment's and only a column on line 1 needs the prefix subtracted.
    const std::string prefix = std::string("<FictionBook xmlns=\"") + kFb2Namespace +
                               "\" xmlns:l=\"" + kXlinkNamespace + "\" xmlns:xlink=\"" +
                               kXlinkNamespace + "\"><" + parent_element + ">";
    std::string wrapped;
    wrapped.reserve(prefix.size() + xml.size() + parent_element.size() + 32);
    wrapped += prefix;
    wrapped += xml;
    wrapped += "</" + parent_element + "></FictionBook>";

    std::vector<xml::CollectedError> errors;
    xmlDocPtr doc = xml::parse_memory(wrapped, nullptr, "UTF-8", errors);
    if (doc == nullptr) {
        ParseError e = to_parse_error(xml::primary_error(errors));
        const auto [lines, last_length] = text_extent(xml);
        if (e.line <= 1) {
            e.line = 1;
            e.column = e.column > static_cast<int>(prefix.size())
                           ? e.column - static_cast<int>(prefix.size())
                           : 1;
        }
        if (e.line > lines || (e.line == lines && e.column > last_length + 1)) {
            // Reported inside the closing wrapper: the fragment ended too early.
            e.line = lines;
            e.column = last_length + 1;
        }
        throw ParseFailure(std::move(e));
    }
    struct DocGuard {
        xmlDocPtr d;
        ~DocGuard() { xmlFreeDoc(d); }
    } guard{doc};

    xmlNodePtr root = xmlDocGetRootElement(doc);
    xmlNodePtr parent = root != nullptr ? root->children : nullptr;
    while (parent != nullptr && parent->type != XML_ELEMENT_NODE) {
        parent = parent->next;
    }
    if (parent == nullptr) {
        return result;
    }
    admit_fragment(parent, parent_element, *table);

    model::Document scratch;
    Ctx ctx;
    ctx.doc = &scratch;
    ctx.warnings = &result.warnings;
    if (result.is_inline) {
        std::vector<Mark> marks;
        convert_inline_children(parent, result.nodes, marks, ctx);
    } else {
        Node holder;
        convert_block_children(parent, holder, ctx);
        result.nodes = std::move(holder.content);
    }
    return result;
}

}  // namespace mfbe::fb2
