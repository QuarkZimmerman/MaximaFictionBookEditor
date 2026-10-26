// FB2 2.1 writer (T043). See mfbe/fb2_writer.hpp for the output rules.
#include "xml/xml_security.hpp"

#include <mfbe/base64.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/position_map.hpp>

#include <algorithm>
#include <map>
#include <set>
#include <vector>

namespace mfbe::fb2 {
namespace {

using model::Mark;
using model::Node;
using nlohmann::json;

/* ----------------------------------------------------------------------------------------- */
/* Text helpers                                                                              */
/* ----------------------------------------------------------------------------------------- */

// Removes characters that XML 1.0 cannot carry (C0 controls other than tab/LF/CR, U+FFFE/F).
std::string sanitize(std::string_view text) {
    bool clean = true;
    for (const char c : text) {
        const auto u = static_cast<unsigned char>(c);
        if (u < 0x20 && c != '\t' && c != '\n' && c != '\r') {
            clean = false;
            break;
        }
    }
    if (clean && text.find("\xEF\xBF\xBE") == std::string_view::npos &&
        text.find("\xEF\xBF\xBF") == std::string_view::npos) {
        return std::string(text);
    }
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); ++i) {
        const auto u = static_cast<unsigned char>(text[i]);
        if (u < 0x20 && text[i] != '\t' && text[i] != '\n' && text[i] != '\r') {
            continue;
        }
        if (u == 0xEF && i + 2 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0xBF &&
            (static_cast<unsigned char>(text[i + 2]) == 0xBE ||
             static_cast<unsigned char>(text[i + 2]) == 0xBF)) {
            i += 2;
            continue;
        }
        out.push_back(text[i]);
    }
    return out;
}

std::string esc_text(std::string_view text) {
    return xml::escape_text(sanitize(text));
}

std::string esc_attr(std::string_view text) {
    return xml::escape_attribute(sanitize(text));
}

std::string json_string(const json& value) {
    if (value.is_string()) {
        return value.get<std::string>();
    }
    if (value.is_number_integer()) {
        return std::to_string(value.get<long long>());
    }
    if (value.is_number()) {
        return std::to_string(value.get<double>());
    }
    if (value.is_boolean()) {
        return value.get<bool>() ? "true" : "false";
    }
    return "";
}

std::optional<std::string> attr_of(const Node& node, const char* name) {
    auto it = node.attrs.find(name);
    if (it == node.attrs.end() || it->second.is_null()) {
        return std::nullopt;
    }
    return json_string(it->second);
}

/* ----------------------------------------------------------------------------------------- */
/* Writer                                                                                    */
/* ----------------------------------------------------------------------------------------- */

// The document a fragment writer stands in for: nothing of it is ever written.
const model::Document& empty_document() {
    static const model::Document kEmpty;
    return kEmpty;
}

class Writer {
public:
    Writer(const model::Document& doc, const BinaryStore* store, const WriteOptions& options)
        : doc_(doc), store_(store), options_(options), record_(options.positions) {
        model::visit_nodes(doc_, [&](const Node& node, const std::string&) {
            collect_foreign_namespaces(node);
            return true;
        });
    }

    // A fragment writer (feature 005): no document, no store, no position map; the foreign
    // namespaces of the fragment's own unknown attributes get the prefixes the document
    // writer would give them.
    Writer(const std::vector<Node>& fragment, const WriteOptions& options)
        : doc_(empty_document()), store_(nullptr), options_(options), record_(false) {
        for (const Node& node : fragment) {
            visit_fragment(node);
        }
    }

    // The fragment's text: block nodes one per line from depth 0, the trailing newline of the
    // last line removed; inline nodes as text-container content.
    std::string run_fragment(const std::vector<Node>& nodes) {
        if (nodes.empty()) {
            return "";
        }
        if (is_inline_node(nodes.front())) {
            write_inline_content(nodes);
            return std::move(out_);
        }
        for (const Node& node : nodes) {
            write_block(node, 0);
        }
        if (!out_.empty() && out_.back() == '\n') {
            out_.pop_back();
        }
        return std::move(out_);
    }

    WriteResult run() {
        emit("<?xml version=\"1.0\" encoding=\"" + options_.encoding + "\"?>\n");
        emit("<FictionBook xmlns=\"");
        emit(kFb2Namespace);
        emit("\" xmlns:" + options_.xlink_prefix + "=\"");
        emit(kXlinkNamespace);
        emit("\"");
        for (const auto& [uri, prefix] : foreign_ns_) {
            emit(" xmlns:" + prefix + "=\"" + esc_attr(uri) + "\"");
        }
        emit(">\n");
        for (const auto& sheet : doc_.stylesheets) {
            line_start(1);
            emit("<stylesheet type=\"" + esc_attr(sheet.type) + "\">" + esc_text(sheet.content) +
                 "</stylesheet>\n");
        }
        write_description();
        for (const auto& body : doc_.bodies) {
            write_mapped_block(body, 1);
        }
        write_extras("FictionBook", 1);
        write_binaries();
        emit("</FictionBook>\n");
        std::sort(result_.lines.entries.begin(), result_.lines.entries.end());
        if (record_) {
            // Emission order is text order and the parents are indices already: nothing to
            // sort, the UTF-16 offsets were counted on the way.
            map_.length16 = units16_;
            finalize_position_map(map_, out_, false);
            result_.positions = std::move(map_);
        }
        result_.text = std::move(out_);
        return std::move(result_);
    }

private:
    // ---- low level -------------------------------------------------------------------------
    void emit(std::string_view s) {
        if (record_) {
            // One pass for the line count and the UTF-16 length: every non-continuation byte
            // starts a code unit, a lead byte >= 0xF0 (an astral character) two.
            for (const char c : s) {
                const auto u = static_cast<unsigned char>(c);
                line_ += (c == '\n') ? 1 : 0;
                if ((u & 0xC0) != 0x80) {
                    units16_ += (u >= 0xF0) ? 2 : 1;
                }
            }
        } else {
            line_ += static_cast<int>(std::count(s.begin(), s.end(), '\n'));
        }
        out_.append(s);
    }

    void line_start(int depth) {
        out_.append(static_cast<std::size_t>(depth), '\t');
        units16_ += static_cast<std::size_t>(depth);  // one code unit per tab
    }

    void note_node(const Node& node) {
        const std::string id = node.node_id();
        if (!id.empty()) {
            result_.lines.entries.emplace_back(line_, id);
        }
    }

    // ---- position map (feature 004 US7) ----------------------------------------------------
    // Call right before the `<` of a node's start tag (or the first byte of a raw fragment):
    // opens the node's entry while a mapped root is being written. -1 when nothing is recorded.
    int begin_entry(const Node& node, PositionKind kind) {
        if (!record_ || mapping_depth_ == 0) {
            return -1;
        }
        const std::string id = node.node_id();
        if (id.empty()) {
            return -1;
        }
        PositionEntry entry;
        entry.nodeId = id;
        entry.kind = kind;
        entry.tagBegin = out_.size();
        entry.tagBegin16 = units16_;
        entry.parent = open_.empty() ? -1 : open_.back();
        map_.entries.push_back(std::move(entry));
        return static_cast<int>(map_.entries.size() - 1);
    }

    // After the `>` of the start tag.
    void content_begin(int entry) {
        if (entry >= 0) {
            map_.entries[static_cast<std::size_t>(entry)].contentBegin = out_.size();
        }
    }

    // Before the `<` of the end tag.
    void content_end(int entry) {
        if (entry >= 0) {
            map_.entries[static_cast<std::size_t>(entry)].contentEnd = out_.size();
        }
    }

    // After the `>` of the end tag or of `/>` (`empty`: no content of its own).
    void end_entry(int entry, bool empty) {
        if (entry < 0) {
            return;
        }
        PositionEntry& e = map_.entries[static_cast<std::size_t>(entry)];
        e.end = out_.size();
        if (empty) {
            e.contentBegin = e.contentEnd = e.end;
        }
    }

    // Children written while an entry is open get it as their parent.
    void open_entry(int entry) {
        if (entry >= 0) {
            open_.push_back(entry);
        }
    }

    void close_entry(int entry) {
        if (entry >= 0 && !open_.empty() && open_.back() == entry) {
            open_.pop_back();
        }
    }

    // A mapped root (a body, the annotation or the history): everything below it is recorded.
    void write_mapped_block(const Node& node, int depth, const char* xml_name = nullptr) {
        ++mapping_depth_;
        write_block(node, depth, xml_name);
        --mapping_depth_;
    }

    // Raw fragments carry the namespace declarations they need to stand alone; the one for
    // the document's own xlink prefix is redundant inside the written file.
    std::string raw_xml_of(const Node& node) {
        std::string xml = node.attr_string("xml").value_or("");
        const std::string decl =
            " xmlns:" + options_.xlink_prefix + "=\"" + std::string(kXlinkNamespace) + "\"";
        const std::size_t tag_end = xml.find('>');
        const std::size_t pos = xml.find(decl);
        if (pos != std::string::npos && tag_end != std::string::npos && pos < tag_end) {
            xml.erase(pos, decl.size());
        }
        return xml;
    }

    std::string attr(const char* name, std::string_view value) {
        return std::string(" ") + name + "=\"" + esc_attr(value) + "\"";
    }

    // Registers the foreign namespaces of one node's unknown attributes (ns1, ns2, ... in the
    // order met).
    void collect_foreign_namespaces(const Node& node) {
        auto it = node.attrs.find("unknownAttrs");
        if (it == node.attrs.end() || !it->second.is_object()) {
            return;
        }
        for (const auto& [key, value] : it->second.items()) {
            if (key.size() > 2 && key.front() == '{') {
                const auto close = key.find('}');
                if (close == std::string::npos) {
                    continue;
                }
                const std::string uri = key.substr(1, close - 1);
                if (uri == kXlinkNamespace || uri == kXmlNamespace || foreign_ns_.count(uri)) {
                    continue;
                }
                foreign_ns_[uri] = "ns" + std::to_string(foreign_ns_.size() + 1);
            }
        }
    }

    // Pre-order over a fragment node and its descendants (the document walk of
    // model::visit_nodes, for nodes that belong to no document).
    void visit_fragment(const Node& node) {
        if (!node.is_text()) {
            collect_foreign_namespaces(node);
        }
        for (const Node& child : node.content) {
            visit_fragment(child);
        }
    }

    // The unknown attributes after the known ones. `written` holds the XML names already in the
    // start tag: an entry whose name, after the namespace mapping, is among them is skipped, so
    // an attribute name is never written twice and the known value wins (feature 006, C19:
    // `colspan: 3` beside `unknownAttrs.colspan "abc"` gives `colspan="3"`). No log line: the
    // clash is the expected state after a user edit.
    std::string unknown_attrs(const Node& node, std::set<std::string>& written) {
        auto it = node.attrs.find("unknownAttrs");
        if (it == node.attrs.end() || !it->second.is_object()) {
            return "";
        }
        std::string out;
        for (const auto& [key, value] : it->second.items()) {
            std::string name = key;
            if (!key.empty() && key.front() == '{') {
                const auto close = key.find('}');
                if (close == std::string::npos) {
                    continue;
                }
                const std::string uri = key.substr(1, close - 1);
                const std::string local = key.substr(close + 1);
                if (uri == kXlinkNamespace) {
                    name = options_.xlink_prefix + ":" + local;
                } else if (uri == kXmlNamespace) {
                    name = "xml:" + local;
                } else {
                    auto ns = foreign_ns_.find(uri);
                    if (ns == foreign_ns_.end()) {
                        continue;
                    }
                    name = ns->second + ":" + local;
                }
            }
            if (name.empty() || !written.insert(name).second) {
                continue;
            }
            out += attr(name.c_str(), json_string(value));
        }
        return out;
    }

    // ---- description -----------------------------------------------------------------------
    void text_element(int depth, const char* name, std::string_view text,
                      const std::string& attrs = "") {
        line_start(depth);
        if (text.empty()) {
            emit(std::string("<") + name + attrs + "/>\n");
        } else {
            emit(std::string("<") + name + attrs + ">" + esc_text(text) + "</" + name + ">\n");
        }
    }

    void opt_text_element(int depth, const char* name, const std::optional<std::string>& text) {
        if (text && !text->empty()) {
            text_element(depth, name, *text);
        }
    }

    static bool person_empty(const model::Person& p) {
        return !p.firstName && !p.middleName && !p.lastName && !p.nickname && p.homePages.empty() &&
               p.emails.empty() && !p.id;
    }

    void write_person(int depth, const char* name, const model::Person& p) {
        if (person_empty(p)) {
            return;
        }
        line_start(depth);
        emit(std::string("<") + name + ">\n");
        if (p.firstName) {
            text_element(depth + 1, "first-name", *p.firstName);
        }
        if (p.middleName) {
            text_element(depth + 1, "middle-name", *p.middleName);
        }
        if (p.lastName) {
            text_element(depth + 1, "last-name", *p.lastName);
        }
        if (p.nickname) {
            text_element(depth + 1, "nickname", *p.nickname);
        }
        for (const auto& hp : p.homePages) {
            text_element(depth + 1, "home-page", hp);
        }
        for (const auto& em : p.emails) {
            text_element(depth + 1, "email", em);
        }
        if (p.id) {
            text_element(depth + 1, "id", *p.id);
        }
        line_start(depth);
        emit(std::string("</") + name + ">\n");
    }

    void write_persons(int depth, const char* name, const std::vector<model::Person>& list,
                       bool required) {
        std::size_t written = 0;
        for (const auto& p : list) {
            if (!person_empty(p)) {
                write_person(depth, name, p);
                ++written;
            }
        }
        if (written == 0 && required) {
            line_start(depth);
            emit(std::string("<") + name + "/>\n");
        }
    }

    void write_date(int depth, const char* name, const model::DateValue& d, bool required) {
        std::string attrs;
        if (d.value && !d.value->empty()) {
            attrs += attr("value", *d.value);
        }
        if (d.lang && !d.lang->empty()) {
            attrs += attr("xml:lang", *d.lang);
        }
        if (d.text.empty() && attrs.empty() && !required) {
            return;
        }
        text_element(depth, name, d.text, attrs);
    }

    void write_sequence(int depth, const model::Sequence& s) {
        std::string attrs = attr("name", s.name);
        if (s.number) {
            attrs += attr("number", std::to_string(*s.number));
        }
        if (s.lang && !s.lang->empty()) {
            attrs += attr("xml:lang", *s.lang);
        }
        line_start(depth);
        if (s.children.empty()) {
            emit("<sequence" + attrs + "/>\n");
            return;
        }
        emit("<sequence" + attrs + ">\n");
        for (const auto& child : s.children) {
            write_sequence(depth + 1, child);
        }
        line_start(depth);
        emit("</sequence>\n");
    }

    void write_image_ref(int depth, const model::ImageRef& ref) {
        std::string attrs = attr((options_.xlink_prefix + ":href").c_str(), ref.href);
        if (ref.alt) {
            attrs += attr("alt", *ref.alt);
        }
        if (ref.title) {
            attrs += attr("title", *ref.title);
        }
        if (ref.id) {
            attrs += attr("id", *ref.id);
        }
        line_start(depth);
        emit("<image" + attrs + "/>\n");
    }

    // A present node is written whatever its content - an element that was present and empty
    // in the file comes back as <annotation/> / <history/> with its attributes (feature 004,
    // FR-010/FR-015: kept as read until an editor of it is edited; the UI turns a node the user
    // emptied into an absent one). Release 0.0.3 omitted a node with empty content and no
    // id / lang.
    static bool annotation_present(const std::optional<Node>& node) { return node.has_value(); }

    void write_title_info(int depth, const char* name, const model::TitleInfo& info,
                          const char* slot) {
        line_start(depth);
        emit(std::string("<") + name + ">\n");
        const int d = depth + 1;
        if (info.genres.empty()) {
            text_element(d, "genre", "");
        }
        for (const auto& g : info.genres) {
            std::string attrs;
            if (g.match && *g.match != 100) {
                attrs = attr("match", std::to_string(*g.match));
            }
            text_element(d, "genre", g.code, attrs);
        }
        write_persons(d, "author", info.authors, true);
        text_element(d, "book-title", info.bookTitle);
        if (annotation_present(info.annotation)) {
            write_mapped_block(*info.annotation, d, "annotation");
        }
        opt_text_element(d, "keywords", info.keywords);
        if (info.date) {
            write_date(d, "date", *info.date, false);
        }
        if (!info.coverpage.empty()) {
            line_start(d);
            emit("<coverpage>\n");
            for (const auto& ref : info.coverpage) {
                write_image_ref(d + 1, ref);
            }
            line_start(d);
            emit("</coverpage>\n");
        }
        text_element(d, "lang", info.lang);
        opt_text_element(d, "src-lang", info.srcLang);
        write_persons(d, "translator", info.translators, false);
        for (const auto& s : info.sequences) {
            write_sequence(d, s);
        }
        write_extras(slot, d);
        line_start(depth);
        emit(std::string("</") + name + ">\n");
    }

    void write_document_info(int depth, const model::DocumentInfo& info) {
        line_start(depth);
        emit("<document-info>\n");
        const int d = depth + 1;
        write_persons(d, "author", info.authors, true);
        opt_text_element(d, "program-used", info.programUsed);
        write_date(d, "date", info.date, true);
        for (const auto& url : info.srcUrls) {
            text_element(d, "src-url", url);
        }
        opt_text_element(d, "src-ocr", info.srcOcr);
        text_element(d, "id", info.id);
        text_element(d, "version", info.version);
        if (annotation_present(info.history)) {
            write_mapped_block(*info.history, d, "history");
        }
        write_persons(d, "publisher", info.publishers, false);
        write_extras("document-info", d);
        line_start(depth);
        emit("</document-info>\n");
    }

    static bool publish_info_empty(const model::PublishInfo& p) {
        const auto empty = [](const std::optional<std::string>& s) { return !s || s->empty(); };
        return empty(p.bookName) && empty(p.publisher) && empty(p.city) && empty(p.year) &&
               empty(p.isbn) && p.sequences.empty();
    }

    void write_publish_info(int depth, const model::PublishInfo& info) {
        const bool has_extras = has_extras_for("publish-info");
        if (publish_info_empty(info) && !has_extras) {
            return;
        }
        line_start(depth);
        emit("<publish-info>\n");
        const int d = depth + 1;
        opt_text_element(d, "book-name", info.bookName);
        opt_text_element(d, "publisher", info.publisher);
        opt_text_element(d, "city", info.city);
        opt_text_element(d, "year", info.year);
        opt_text_element(d, "isbn", info.isbn);
        for (const auto& s : info.sequences) {
            write_sequence(d, s);
        }
        write_extras("publish-info", d);
        line_start(depth);
        emit("</publish-info>\n");
    }

    void write_description() {
        const model::Description& desc = doc_.description;
        line_start(1);
        emit("<description>\n");
        write_title_info(2, "title-info", desc.titleInfo, "title-info");
        if (desc.srcTitleInfo) {
            write_title_info(2, "src-title-info", *desc.srcTitleInfo, "src-title-info");
        }
        write_document_info(2, desc.documentInfo);
        if (desc.publishInfo) {
            write_publish_info(2, *desc.publishInfo);
        } else if (has_extras_for("publish-info")) {
            write_publish_info(2, model::PublishInfo{});
        }
        for (const auto& ci : desc.customInfo) {
            std::string attrs = attr("info-type", ci.infoType);
            if (ci.lang && !ci.lang->empty()) {
                attrs += attr("xml:lang", *ci.lang);
            }
            text_element(3, "custom-info", ci.text, attrs);
        }
        for (const auto& output : desc.outputs) {
            write_block(output, 2);
        }
        write_extras("description", 2);
        // Extras whose container was not written (e.g. the UI dropped src-title-info) are
        // kept at description level rather than lost.
        for (const Node& n : doc_.extras) {
            const std::string slot = n.attr_string("slot").value_or("FictionBook");
            if (slot != "FictionBook" && !written_slots_.count(slot)) {
                write_block(n, 2);
            }
        }
        line_start(1);
        emit("</description>\n");
    }

    bool has_extras_for(const char* slot) const {
        return std::any_of(doc_.extras.begin(), doc_.extras.end(), [&](const Node& n) {
            return n.attr_string("slot").value_or("FictionBook") == slot;
        });
    }

    void write_extras(const char* slot, int depth) {
        written_slots_.insert(slot);
        for (const Node& n : doc_.extras) {
            if (n.attr_string("slot").value_or("FictionBook") == slot) {
                write_block(n, depth);
            }
        }
    }

    // ---- body tree -------------------------------------------------------------------------
    std::string known_attrs(const Node& node, const std::string& type) {
        std::string out;
        std::set<std::string> written;  // the XML names in the start tag, for unknown_attrs
        const auto add = [&](const char* model_name, const char* xml_name) {
            if (auto v = attr_of(node, model_name)) {
                if (written.insert(xml_name).second) {
                    out += attr(xml_name, *v);
                }
            }
        };
        const std::string href_name = options_.xlink_prefix + ":href";
        if (type == "body") {
            add("name", "name");
            add("lang", "xml:lang");
        } else if (type == "section" || type == "annotation" || type == "poem" || type == "cite") {
            add("id", "id");
            add("lang", "xml:lang");
        } else if (type == "title" || type == "stanza") {
            add("lang", "xml:lang");
        } else if (type == "epigraph") {
            add("id", "id");
        } else if (type == "table") {
            add("id", "id");
            add("style", "style");
        } else if (type == "tr") {
            add("align", "align");
        } else if (type == "td" || type == "th") {
            add("id", "id");
            add("style", "style");
            add("colspan", "colspan");
            add("rowspan", "rowspan");
            add("align", "align");
            add("valign", "valign");
            add("lang", "xml:lang");  // feature 006 (FR-020): last, as on paragraphs
        } else if (type == "p" || type == "subtitle" || type == "text-author" || type == "v") {
            add("id", "id");
            add("style", "style");
            add("lang", "xml:lang");
        } else if (type == "date") {
            add("value", "value");
            add("lang", "xml:lang");
        } else if (type == "image") {
            add("href", href_name.c_str());
            add("alt", "alt");
            add("title", "title");
            add("id", "id");
        } else if (type == "inline-image") {
            add("href", href_name.c_str());
            add("alt", "alt");
        } else {
            // Unknown node type (should not happen): write string attributes generically.
            for (const auto& [k, v] : node.attrs) {
                if (k != "nodeId" && k != "unknownAttrs" && v.is_string() &&
                    written.insert(k).second) {
                    out += attr(k.c_str(), v.get<std::string>());
                }
            }
        }
        out += unknown_attrs(node, written);
        return out;
    }

    static bool is_inline_container(const std::string& type) {
        return type == "p" || type == "subtitle" || type == "text-author" || type == "v" ||
               type == "td" || type == "th";
    }

    // `xml_name` overrides the element name (annotation node written as <history>).
    void write_block(const Node& node, int depth, const char* xml_name = nullptr) {
        const std::string& type = node.type;
        if (type == "text") {
            line_start(depth);
            emit(esc_text(node.text) + "\n");
            return;
        }
        if (type == "raw-xml") {
            note_node(node);
            line_start(depth);
            const int entry = begin_entry(node, PositionKind::blockAtom);
            emit(raw_xml_of(node));
            end_entry(entry, true);
            emit("\n");
            return;
        }
        const std::string name = xml_name != nullptr ? xml_name : type;
        note_node(node);
        line_start(depth);
        const std::string attrs = known_attrs(node, type);
        if (type == "empty-line" || type == "image" || type == "inline-image") {
            const int entry = begin_entry(node, PositionKind::blockAtom);
            emit("<" + std::string(type == "inline-image" ? "image" : name) + attrs + "/>");
            end_entry(entry, true);
            emit("\n");
            return;
        }
        if (is_inline_container(type) || type == "date") {
            const int entry =
                begin_entry(node, type == "date" ? PositionKind::date : PositionKind::text);
            emit("<" + name + attrs + ">");
            content_begin(entry);
            open_entry(entry);
            write_inline_content(node.content);
            close_entry(entry);
            content_end(entry);
            emit("</" + name + ">");
            end_entry(entry, false);
            emit("\n");
            return;
        }
        const int entry = begin_entry(node, PositionKind::container);
        if (node.content.empty()) {
            emit("<" + name + attrs + "/>");
            end_entry(entry, true);
            emit("\n");
            return;
        }
        emit("<" + name + attrs + ">");
        content_begin(entry);
        emit("\n");
        open_entry(entry);
        for (const Node& child : node.content) {
            write_block(child, depth + 1);
        }
        close_entry(entry);
        line_start(depth);
        content_end(entry);
        emit("</" + name + ">");
        end_entry(entry, false);
        emit("\n");
    }

    // ---- inline content --------------------------------------------------------------------
    static std::vector<Mark> sorted_marks(const std::vector<Mark>& marks) {
        std::vector<Mark> sorted = marks;
        std::stable_sort(sorted.begin(), sorted.end(), [](const Mark& a, const Mark& b) {
            return mark_rank(a.type) < mark_rank(b.type);
        });
        return sorted;
    }

    // A string member of a mark's attributes (nullopt when absent or not a string).
    static std::optional<std::string> mark_attr(const Mark& mark, const char* name) {
        if (!mark.attrs.is_object()) {
            return std::nullopt;
        }
        auto it = mark.attrs.find(name);
        if (it == mark.attrs.end() || !it->is_string()) {
            return std::nullopt;
        }
        return it->get<std::string>();
    }

    // A mark's start tag with its schema attributes (feature 006, FR-064): `xml:lang` on
    // formatting, `name` then `xml:lang` on a style, and `xlink:href`, `xlink:type` (the
    // document's xlink prefix on both) then `type` on a link.
    std::string mark_open(const Mark& mark) {
        if (mark.type == "link") {
            const std::string prefix = options_.xlink_prefix;
            std::string out =
                "<a" + attr((prefix + ":href").c_str(), mark_attr(mark, "href").value_or(""));
            if (auto xlink_type = mark_attr(mark, "xlinkType")) {
                out += attr((prefix + ":type").c_str(), *xlink_type);
            }
            if (auto type = mark_attr(mark, "type"); type && !type->empty()) {
                out += attr("type", *type);
            }
            return out + ">";
        }
        std::string out = "<" + mark.type;
        if (mark.type == "style") {
            // The schema requires `name` outside links; an empty one is written `name=""`.
            out += attr("name", mark_attr(mark, "name").value_or(""));
        }
        if (auto lang = mark_attr(mark, "lang")) {
            out += attr("xml:lang", *lang);
        }
        return out + ">";
    }

    static std::string mark_close(const Mark& mark) {
        if (mark.type == "link") {
            return "</a>";
        }
        return "</" + mark.type + ">";
    }

    static std::size_t common_prefix(const std::vector<Mark>& a, const std::vector<Mark>& b) {
        std::size_t n = 0;
        while (n < a.size() && n < b.size() && a[n] == b[n]) {
            ++n;
        }
        return n;
    }

    // An image (written as an inline `<image/>`) or a raw XML node of inline content, with
    // its position entry; the elements of its marks are open already.
    void write_inline_atom(const Node& node) {
        note_node(node);
        const int entry = begin_entry(node, PositionKind::inlineAtom);
        if (node.type == "raw-xml") {
            emit(raw_xml_of(node));
        } else {
            emit("<image" + known_attrs(node, "inline-image") + "/>");
        }
        end_entry(entry, true);
    }

    void write_inline_content(const std::vector<Node>& content) {
        std::vector<Mark> open;
        const auto close_to = [&](std::size_t keep) {
            while (open.size() > keep) {
                emit(mark_close(open.back()));
                open.pop_back();
            }
        };
        for (std::size_t i = 0; i < content.size(); ++i) {
            const Node& node = content[i];
            // Text and inline atoms (an inline image, inline raw XML) are written inside the
            // elements of their own marks: the open elements they do not continue are closed,
            // the missing ones opened (feature 006, FR-067).
            if (node.is_text() || is_inline_node(node)) {
                const std::vector<Mark> marks = sorted_marks(node.marks);
                close_to(common_prefix(open, marks));
                for (std::size_t k = open.size(); k < marks.size(); ++k) {
                    emit(mark_open(marks[k]));
                    open.push_back(marks[k]);
                }
                if (node.is_text()) {
                    emit(esc_text(node.text));
                } else {
                    write_inline_atom(node);
                }
                continue;
            }
            // An empty-line, a block image or another block node left in inline content: keep
            // the marks that the next text node continues.
            std::vector<Mark> next;
            for (std::size_t j = i + 1; j < content.size(); ++j) {
                if (content[j].is_text()) {
                    next = sorted_marks(content[j].marks);
                    break;
                }
            }
            close_to(common_prefix(open, next));
            if (node.type == "image" || node.type == "raw-xml") {
                write_inline_atom(node);
            } else if (node.type == "empty-line") {
                const int entry = begin_entry(node, PositionKind::inlineAtom);
                emit("<empty-line/>");
                end_entry(entry, true);
            } else {
                // A block node inside inline content (UI bug): write it inline anyway.
                note_node(node);
                const int entry = begin_entry(node, position_kind(node));
                emit("<" + node.type + known_attrs(node, node.type) + ">");
                content_begin(entry);
                open_entry(entry);
                write_inline_content(node.content);
                close_entry(entry);
                content_end(entry);
                emit("</" + node.type + ">");
                end_entry(entry, false);
            }
        }
        close_to(0);
    }

    // ---- binaries --------------------------------------------------------------------------
    void write_binaries() {
        if (store_ == nullptr) {
            return;
        }
        for (const std::string& id : store_->ids()) {
            const auto meta = store_->meta(id);
            if (!meta) {
                continue;
            }
            ++result_.binary_count;
            line_start(1);
            emit("<binary" + attr("id", id) + attr("content-type", meta->contentType) + ">");
            if (options_.elide_binaries) {
                emit("\xE2\x80\xA6" + std::to_string(meta->size) + " bytes\xE2\x80\xA6");
            } else if (store_->is_raw_text(id)) {
                emit(store_->bytes(id).value_or(""));
            } else {
                const auto bytes = store_->bytes(id);
                emit(base64::encode_wrapped(bytes.value_or(""), 76, "\n"));
            }
            emit("</binary>\n");
        }
    }

    const model::Document& doc_;
    const BinaryStore* store_;
    const WriteOptions& options_;
    std::map<std::string, std::string> foreign_ns_;  // uri -> prefix
    std::set<std::string> written_slots_;
    std::string out_;
    int line_ = 1;
    WriteResult result_;
    // Position map (feature 004 US7), recorded while a mapped root is written.
    const bool record_;
    std::size_t units16_ = 0;  // UTF-16 length of out_
    int mapping_depth_ = 0;    // > 0 inside a body, the annotation or the history
    std::vector<int> open_;    // entries whose content is being written (parents)
    PositionMap map_;
};

}  // namespace

int mark_rank(const std::string& type) {
    static const std::map<std::string, int> kRanks = {
        {"link", 0},          {"style", 1}, {"strong", 2}, {"emphasis", 3},
        {"strikethrough", 4}, {"sub", 5},   {"sup", 6},    {"code", 7}};
    auto it = kRanks.find(type);
    return it == kRanks.end() ? 100 : it->second;
}

std::optional<std::string> LineMap::node_at(int line) const {
    if (entries.empty()) {
        return std::nullopt;
    }
    auto it =
        std::upper_bound(entries.begin(), entries.end(), line,
                         [](int l, const std::pair<int, std::string>& e) { return l < e.first; });
    if (it == entries.begin()) {
        return std::nullopt;
    }
    --it;
    return it->second;
}

WriteResult write_document(const model::Document& document, const BinaryStore* store,
                           const WriteOptions& options) {
    WriteOptions effective = options;
    if (effective.encoding.empty()) {
        effective.encoding = "utf-8";
    }
    if (auto canonical = encoding::normalize_name(effective.encoding)) {
        effective.encoding = *canonical;
    }
    if (effective.xlink_prefix.empty()) {
        effective.xlink_prefix = kDefaultXlinkPrefix;
    }
    Writer writer(document, store, effective);
    return writer.run();
}

std::string encode_document(const std::string& utf8_text, const std::string& encoding,
                            std::size_t* unmappable) {
    encoding::EncodeResult result = encoding::encode_from_utf8(utf8_text, encoding, true);
    if (unmappable != nullptr) {
        *unmappable = result.unmappable;
    }
    return std::move(result.bytes);
}

bool is_inline_node(const Node& node) {
    if (node.is_text() || node.type == "inline-image") {
        return true;
    }
    if (node.type == "raw-xml") {
        auto it = node.attrs.find("inline");
        return it != node.attrs.end() && it->second.is_boolean() && it->second.get<bool>();
    }
    return false;
}

std::string write_fragment(const std::vector<Node>& nodes, const FragmentOptions& options) {
    WriteOptions effective;
    effective.xlink_prefix =
        options.xlink_prefix.empty() ? std::string(kDefaultXlinkPrefix) : options.xlink_prefix;
    Writer writer(nodes, effective);
    return writer.run_fragment(nodes);
}

}  // namespace mfbe::fb2
