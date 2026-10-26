// Shared helpers for the core Catch2 tests (not a test file itself: no test_ prefix glob hit
// because the extension is .hpp).
#pragma once

#include "xml/xml_security.hpp"

#include <mfbe/rpc.hpp>

#include <libxml/tree.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <optional>
#include <random>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace mfbe::test {

inline std::filesystem::path fixtures_dir() {
    return std::filesystem::path(MFBE_TEST_FIXTURES_DIR);
}

inline std::string read_text(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

inline void write_text(const std::filesystem::path& path, const std::string& text) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
}

// The parts of a minimal valid FB2 2.1 book (feature 006's reader, writer and round-trip
// cases): `body` is the content of its one <body> (normally a <section>), `after_body` follows
// that body (a notes body, binaries), `annotation` is the content of the title-info's
// <annotation> (none when empty) and `book_title` the text of <book-title> (escaped XML).
struct BookParts {
    std::string body;
    std::string after_body;
    std::string annotation;
    std::string book_title = "Book";
};

// The book's text: the FB2 and xlink namespaces (prefix `l`) and the required description
// elements, so that it validates against the bundled schema whenever its parts do.
inline std::string book_text(const BookParts& parts) {
    std::string text =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">"
        "<description><title-info><genre>prose_classic</genre><author><first-name>Ann</first-name>"
        "<last-name>Writer</last-name></author><book-title>" +
        parts.book_title + "</book-title>";
    if (!parts.annotation.empty()) {
        text += "<annotation>" + parts.annotation + "</annotation>";
    }
    text +=
        "<lang>en</lang></title-info><document-info><author><nickname>fixture</nickname>"
        "</author><date>2026</date><id>feature-006-test</id><version>1.0</version>"
        "</document-info></description><body>" +
        parts.body + "</body>" + parts.after_body + "</FictionBook>\n";
    return text;
}

// `book_text` with a body only.
inline std::string minimal_book(const std::string& body, const std::string& after_body = "") {
    BookParts parts;
    parts.body = body;
    parts.after_body = after_body;
    return book_text(parts);
}

/* ----------------------------------------------------------------------------------------- */
/* The XML-level round-trip walker (feature 006; contracts/document-model.md §3.3, R3.3)      */
/* ----------------------------------------------------------------------------------------- */

namespace xml_walk {

inline const char* const kFb2Uri = "http://www.gribuser.ru/xml/fictionbook/2.0";
inline const char* const kXlinkUri = "http://www.w3.org/1999/xlink";
inline const char* const kXmlUri = "http://www.w3.org/XML/1998/namespace";

inline std::string text_of(const xmlChar* s) {
    return s == nullptr ? std::string() : std::string(reinterpret_cast<const char*>(s));
}

inline std::string uri_of(const xmlNode* node) {
    return node->ns == nullptr ? std::string() : text_of(node->ns->href);
}

inline bool is_fb2(const xmlNode* node) {
    return node->type == XML_ELEMENT_NODE && uri_of(node) == kFb2Uri;
}

inline std::optional<std::string> attribute(const xmlNode* node, const char* name,
                                            const char* uri) {
    xmlChar* value = uri == nullptr ? xmlGetNoNsProp(node, reinterpret_cast<const xmlChar*>(name))
                                    : xmlGetNsProp(node, reinterpret_cast<const xmlChar*>(name),
                                                   reinterpret_cast<const xmlChar*>(uri));
    if (value == nullptr) {
        return std::nullopt;
    }
    std::string out = text_of(value);
    xmlFree(value);
    return out;
}

// The attributes as a set: (namespace URI, local name) -> value; prefixes and order ignored.
inline std::map<std::pair<std::string, std::string>, std::string> attributes(const xmlNode* node) {
    std::map<std::pair<std::string, std::string>, std::string> out;
    for (const xmlAttr* a = node->properties; a != nullptr; a = a->next) {
        xmlChar* value = xmlNodeListGetString(node->doc, a->children, 1);
        out[{a->ns == nullptr ? std::string() : text_of(a->ns->href), text_of(a->name)}] =
            text_of(value);
        xmlFree(value);
    }
    return out;
}

// A span's text as the reader's parse_int reads it: trimmed, base 10, -10^9 .. 10^9.
inline std::optional<long long> whole_number(const std::string& text) {
    std::size_t b = text.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) {
        return std::nullopt;
    }
    const std::size_t e = text.find_last_not_of(" \t\r\n");
    const std::string t = text.substr(b, e - b + 1);
    std::size_t used = 0;
    try {
        const long long v = std::stoll(t, &used, 10);
        if (used != t.size() || v > 1000000000LL || v < -1000000000LL) {
            return std::nullopt;
        }
        return v;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

inline std::string describe(const std::map<std::pair<std::string, std::string>, std::string>& set) {
    std::string out;
    for (const auto& [key, value] : set) {
        out += " {" + key.first + "}" + key.second + "=\"" + value + "\"";
    }
    return out;
}

// Attributes compared as sets; colspan and rowspan of a cell by integer value where the input's
// text reads as a whole number of 1 or more (the recorded respelling), exactly otherwise.
inline std::optional<std::string> compare_attributes(const xmlNode* a, const xmlNode* b,
                                                     const std::string& path) {
    auto as = attributes(a);
    auto bs = attributes(b);
    const std::string name = text_of(a->name);
    if (is_fb2(a) && (name == "td" || name == "th")) {
        for (const char* span : {"colspan", "rowspan"}) {
            const auto ai = as.find({"", span});
            const auto bi = bs.find({"", span});
            if (ai == as.end() || bi == bs.end()) {
                continue;
            }
            const auto value = whole_number(ai->second);
            if (value && *value >= 1) {
                if (whole_number(bi->second) != value) {
                    return path + ": " + span + " \"" + ai->second + "\" became \"" + bi->second +
                           "\"";
                }
                bi->second = ai->second;
            }
        }
    }
    if (as != bs) {
        return path + ": attributes" + describe(as) + " became" + describe(bs);
    }
    return std::nullopt;
}

inline bool is_formatting(const std::string& name) {
    return name == "strong" || name == "emphasis" || name == "strikethrough" || name == "sub" ||
           name == "sup" || name == "code" || name == "style";
}

inline bool is_mixed_content(const xmlNode* node) {
    const std::string name = text_of(node->name);
    return is_fb2(node) && (name == "p" || name == "subtitle" || name == "text-author" ||
                            name == "v" || name == "td" || name == "th");
}

// A mark with its schema attributes: xml:lang on formatting, name (absent = "") and xml:lang
// on a style, xlink:href, xlink:type and a non-empty type on a link.
inline std::string mark_key(const xmlNode* element) {
    const std::string name = text_of(element->name);
    std::string key = name;
    if (name == "a") {
        auto href = attribute(element, "href", kXlinkUri);
        if (!href) {
            href = attribute(element, "href", nullptr);
        }
        key += " href=" + href.value_or("");
        if (auto xlink_type = attribute(element, "type", kXlinkUri)) {
            key += " xlink:type=" + *xlink_type;
        }
        if (auto type = attribute(element, "type", nullptr); type && !type->empty()) {
            key += " type=" + *type;
        }
        return key;
    }
    if (name == "style") {
        key += " name=" + attribute(element, "name", nullptr).value_or("");
    }
    if (auto lang = attribute(element, "lang", kXmlUri)) {
        key += " lang=" + *lang;
    }
    return key;
}

// The open marks: per kind, outer first; an equal nested mark collapses; one link, the outer.
struct MarkSet {
    std::map<std::string, std::vector<std::string>> kinds;
    std::string text() const {
        std::string out;
        for (const auto& [kind, marks] : kinds) {
            for (const auto& mark : marks) {
                out += "[" + mark + "]";
            }
        }
        return out.empty() ? "[]" : out;
    }
};

struct Run {
    bool is_text = true;
    std::string chars;
    std::string marks;
    const xmlNode* atom = nullptr;
};

inline void add_text(std::vector<Run>& runs, const std::string& chars, const MarkSet& marks) {
    if (chars.empty()) {
        return;
    }
    const std::string key = marks.text();
    if (!runs.empty() && runs.back().is_text && runs.back().marks == key) {
        runs.back().chars += chars;  // adjacent text with equal sets joined
        return;
    }
    runs.push_back(Run{true, chars, key, nullptr});
}

inline void collect_runs(const xmlNode* parent, MarkSet& marks, std::vector<Run>& runs) {
    for (const xmlNode* c = parent->children; c != nullptr; c = c->next) {
        if (c->type == XML_TEXT_NODE || c->type == XML_CDATA_SECTION_NODE) {
            add_text(runs, text_of(c->content), marks);
        } else if (c->type == XML_ENTITY_REF_NODE) {
            xmlChar* content = xmlNodeGetContent(c);
            add_text(runs, text_of(content), marks);
            xmlFree(content);
        } else if (c->type == XML_ELEMENT_NODE && is_fb2(c) &&
                   (is_formatting(text_of(c->name)) || text_of(c->name) == "a")) {
            const std::string kind = text_of(c->name);
            const std::string key = mark_key(c);
            std::vector<std::string>& open = marks.kinds[kind];
            const bool collapsed = kind == "a"
                                       ? !open.empty()
                                       : std::find(open.begin(), open.end(), key) != open.end();
            if (!collapsed) {
                open.push_back(key);
            }
            collect_runs(c, marks, runs);
            if (!collapsed) {
                marks.kinds[kind].pop_back();
            }
            if (marks.kinds[kind].empty()) {
                marks.kinds.erase(kind);
            }
        } else if (c->type == XML_ELEMENT_NODE || c->type == XML_COMMENT_NODE ||
                   c->type == XML_PI_NODE) {
            runs.push_back(Run{false, "", marks.text(), c});  // an inline atom
        }
    }
}

inline std::string excerpt(const std::string& text) {
    std::string out;
    for (const char ch : text.substr(0, 60)) {
        if (ch == '\r') {
            out += "\\r";
        } else if (ch == '\n') {
            out += "\\n";
        } else {
            out += ch;
        }
    }
    return out;
}

// Two nodes compared exactly as subtrees (an inline atom, foreign content).
inline std::optional<std::string> compare_subtree(const xmlNode* a, const xmlNode* b,
                                                  const std::string& path) {
    if (a->type != b->type) {
        return path + ": node kind changed";
    }
    if (a->type == XML_TEXT_NODE || a->type == XML_CDATA_SECTION_NODE ||
        a->type == XML_COMMENT_NODE || a->type == XML_PI_NODE) {
        if (text_of(a->name) != text_of(b->name) || text_of(a->content) != text_of(b->content)) {
            return path + ": \"" + excerpt(text_of(a->content)) + "\" became \"" +
                   excerpt(text_of(b->content)) + "\"";
        }
        return std::nullopt;
    }
    if (a->type != XML_ELEMENT_NODE) {
        return std::nullopt;
    }
    if (uri_of(a) != uri_of(b) || text_of(a->name) != text_of(b->name)) {
        return path + ": element {" + uri_of(a) + "}" + text_of(a->name) + " became {" + uri_of(b) +
               "}" + text_of(b->name);
    }
    if (auto d = compare_attributes(a, b, path)) {
        return d;
    }
    const xmlNode* ca = a->children;
    const xmlNode* cb = b->children;
    for (int i = 1; ca != nullptr || cb != nullptr; ++i) {
        if (ca == nullptr || cb == nullptr) {
            return path + ": the content of " + text_of(a->name) + " differs in length";
        }
        if (auto d = compare_subtree(ca, cb, path + "/node()[" + std::to_string(i) + "]")) {
            return d;
        }
        ca = ca->next;
        cb = cb->next;
    }
    return std::nullopt;
}

// Mixed content: one sequence of runs, text with its mark set and atoms with theirs.
inline std::optional<std::string> compare_mixed(const xmlNode* a, const xmlNode* b,
                                                const std::string& path) {
    std::vector<Run> ra;
    std::vector<Run> rb;
    MarkSet ma;
    MarkSet mb;
    collect_runs(a, ma, ra);
    collect_runs(b, mb, rb);
    for (std::size_t i = 0; i < std::max(ra.size(), rb.size()); ++i) {
        const std::string where = path + " run " + std::to_string(i + 1);
        if (i >= ra.size() || i >= rb.size()) {
            return where + ": " + std::to_string(ra.size()) + " runs became " +
                   std::to_string(rb.size());
        }
        const Run& x = ra[i];
        const Run& y = rb[i];
        if (x.is_text != y.is_text) {
            return where + ": " + (x.is_text ? "text \"" + excerpt(x.chars) + "\"" : "an atom") +
                   " became " + (y.is_text ? "text \"" + excerpt(y.chars) + "\"" : "an atom");
        }
        if (x.is_text && x.chars != y.chars) {
            return where + ": text \"" + excerpt(x.chars) + "\" became \"" + excerpt(y.chars) +
                   "\"";
        }
        if (x.marks != y.marks) {
            return where + " (" + (x.is_text ? "\"" + excerpt(x.chars) + "\"" : "an atom") +
                   "): marks " + x.marks + " became " + y.marks;
        }
        if (!x.is_text) {
            if (auto d = compare_subtree(x.atom, y.atom, where)) {
                return d;
            }
        }
    }
    return std::nullopt;
}

inline bool is_blank(const std::string& text) {
    return text.find_first_not_of(" \t\r\n") == std::string::npos;
}

// The children that count in structural content: elements, comments, processing
// instructions and text that is not white space between elements.
inline std::vector<const xmlNode*> structural_children(const xmlNode* node) {
    std::vector<const xmlNode*> out;
    for (const xmlNode* c = node->children; c != nullptr; c = c->next) {
        if (c->type == XML_ELEMENT_NODE || c->type == XML_COMMENT_NODE || c->type == XML_PI_NODE ||
            ((c->type == XML_TEXT_NODE || c->type == XML_CDATA_SECTION_NODE) &&
             !is_blank(text_of(c->content)))) {
            out.push_back(c);
        }
    }
    return out;
}

inline std::string trimmed(const std::string& text) {
    const std::size_t b = text.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) {
        return "";
    }
    return text.substr(b, text.find_last_not_of(" \t\r\n") - b + 1);
}

inline std::optional<std::string> compare_element(const xmlNode* a, const xmlNode* b,
                                                  const std::string& path) {
    if (uri_of(a) != uri_of(b) || text_of(a->name) != text_of(b->name)) {
        return path + ": element {" + uri_of(a) + "}" + text_of(a->name) + " became {" + uri_of(b) +
               "}" + text_of(b->name);
    }
    if (!is_fb2(a)) {
        return compare_subtree(a, b, path);
    }
    if (auto d = compare_attributes(a, b, path)) {
        return d;
    }
    if (is_mixed_content(a)) {
        return compare_mixed(a, b, path);
    }
    const auto ca = structural_children(a);
    const auto cb = structural_children(b);
    if (ca.size() != cb.size()) {
        return path + ": " + std::to_string(ca.size()) + " children became " +
               std::to_string(cb.size());
    }
    std::map<std::string, int> counters;
    for (std::size_t i = 0; i < ca.size(); ++i) {
        const xmlNode* x = ca[i];
        const xmlNode* y = cb[i];
        const std::string name = x->type == XML_ELEMENT_NODE ? text_of(x->name) : "node()";
        const std::string where = path + "/" + name + "[" + std::to_string(++counters[name]) + "]";
        if (x->type == XML_ELEMENT_NODE && y->type == XML_ELEMENT_NODE) {
            if (auto d = compare_element(x, y, where)) {
                return d;
            }
        } else if ((x->type == XML_TEXT_NODE || x->type == XML_CDATA_SECTION_NODE) &&
                   (y->type == XML_TEXT_NODE || y->type == XML_CDATA_SECTION_NODE)) {
            if (trimmed(text_of(x->content)) != trimmed(text_of(y->content))) {
                return where + ": text \"" + excerpt(trimmed(text_of(x->content))) +
                       "\" became \"" + excerpt(trimmed(text_of(y->content))) + "\"";
            }
        } else if (auto d = compare_subtree(x, y, where)) {
            return d;
        }
    }
    return std::nullopt;
}

inline const xmlNode* fb2_child(const xmlNode* parent, const char* name) {
    if (parent == nullptr) {
        return nullptr;
    }
    for (const xmlNode* c = parent->children; c != nullptr; c = c->next) {
        if (is_fb2(c) && text_of(c->name) == name) {
            return c;
        }
    }
    return nullptr;
}

// The walked roots of a book: its bodies, the two annotations and the history.
inline std::vector<std::pair<std::string, const xmlNode*>> walked_roots(const xmlNode* root) {
    std::vector<std::pair<std::string, const xmlNode*>> out;
    const xmlNode* description = fb2_child(root, "description");
    out.emplace_back("/FictionBook/description/title-info/annotation",
                     fb2_child(fb2_child(description, "title-info"), "annotation"));
    out.emplace_back("/FictionBook/description/src-title-info/annotation",
                     fb2_child(fb2_child(description, "src-title-info"), "annotation"));
    out.emplace_back("/FictionBook/description/document-info/history",
                     fb2_child(fb2_child(description, "document-info"), "history"));
    int index = 0;
    for (const xmlNode* c = root->children; c != nullptr; c = c->next) {
        if (is_fb2(c) && text_of(c->name) == "body") {
            out.emplace_back("/FictionBook/body[" + std::to_string(++index) + "]", c);
        }
    }
    return out;
}

}  // namespace xml_walk

// Compares a book's text with the text the writer made of it, at XML level (feature 006,
// document-model §3.3): nullopt when equivalent, else the first difference with its element
// path. Every element of the FB2 namespace under the bodies, the two annotations and the
// history is walked; elements by namespace URI and local name; attributes as sets (spans by
// integer value where the input reads as a whole number of 1 or more, exactly otherwise); the
// content of p, subtitle, text-author, v, td and th as one sequence of runs - text with its
// mark set (the enclosing inline elements with their schema attributes; the marks of each kind
// in nesting order, an equal nested one collapsed; one link, the outer one) and inline atoms
// compared as subtrees with theirs, adjacent text with equal sets joined. White space inside
// mixed content counts; white space between structural elements, attribute order, the
// declared encoding and namespace prefixes do not.
inline std::optional<std::string> xml_equivalent(const std::string& input_text,
                                                 const std::string& output_text) {
    std::vector<xml::CollectedError> input_errors;
    std::vector<xml::CollectedError> output_errors;
    xmlDocPtr input = xml::parse_memory(input_text, nullptr, nullptr, input_errors);
    xmlDocPtr output = xml::parse_memory(output_text, nullptr, nullptr, output_errors);
    struct Docs {
        xmlDocPtr a;
        xmlDocPtr b;
        ~Docs() {
            if (a != nullptr) {
                xmlFreeDoc(a);
            }
            if (b != nullptr) {
                xmlFreeDoc(b);
            }
        }
    } docs{input, output};
    if (input == nullptr) {
        return "the input is not well-formed: " + xml::primary_error(input_errors).message;
    }
    if (output == nullptr) {
        return "the output is not well-formed: " + xml::primary_error(output_errors).message;
    }
    const auto a = xml_walk::walked_roots(xmlDocGetRootElement(input));
    const auto b = xml_walk::walked_roots(xmlDocGetRootElement(output));
    if (a.size() != b.size()) {
        return std::to_string(a.size() - 3) + " bodies became " + std::to_string(b.size() - 3);
    }
    for (std::size_t i = 0; i < a.size(); ++i) {
        if ((a[i].second == nullptr) != (b[i].second == nullptr)) {
            return a[i].first + (a[i].second == nullptr ? ": appeared" : ": disappeared");
        }
        if (a[i].second != nullptr) {
            if (auto d = xml_walk::compare_element(a[i].second, b[i].second, a[i].first)) {
                return d;
            }
        }
    }
    return std::nullopt;
}

// The build tree (CMAKE_BINARY_DIR): where the tests keep generated inputs that are worth
// reusing between runs (the 10 MB book of the memory checks, as the @perf journeys do).
inline std::filesystem::path build_dir() {
    return std::filesystem::path(MFBE_TEST_BUILD_DIR);
}

// Resets the process's peak resident set size to its current value, so that the growth of the
// next operation can be read from platform::peak_resident_memory_bytes() (Linux: "5" written to
// /proc/self/clear_refs). False where the kernel offers no reset: the caller then compares peaks
// that only ever grow.
inline bool reset_peak_resident_memory() {
#ifdef __linux__
    std::ofstream out("/proc/self/clear_refs");
    if (!out) {
        return false;
    }
    out << "5";
    return static_cast<bool>(out);
#else
    return false;
#endif
}

// Unique temporary directory removed on destruction.
class TempDir {
public:
    explicit TempDir(const std::string& prefix = "mfbe-test") {
        std::random_device rd;
        const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
        path_ = std::filesystem::temp_directory_path() /
                (prefix + "-" + std::to_string(stamp) + "-" + std::to_string(rd() % 100000));
        std::filesystem::create_directories(path_);
    }
    ~TempDir() {
        std::error_code ec;
        std::filesystem::remove_all(path_, ec);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    const std::filesystem::path& path() const { return path_; }
    std::filesystem::path operator/(const std::string& name) const { return path_ / name; }

private:
    std::filesystem::path path_;
};

// Sets an environment variable (or unsets it with nullopt) for the lifetime of the guard and
// restores the previous state afterwards. Feature 005: the HTTP client reads proxies and the
// CA bundle override from the environment, libcurl itself reads `http_proxy` & co.
class EnvGuard {
public:
    EnvGuard(std::string name, std::optional<std::string> value) : name_(std::move(name)) {
        if (const char* current = std::getenv(name_.c_str())) {
            previous_ = std::string(current);
        }
        apply(name_, value);
    }
    ~EnvGuard() { apply(name_, previous_); }
    EnvGuard(const EnvGuard&) = delete;
    EnvGuard& operator=(const EnvGuard&) = delete;

private:
    static void apply(const std::string& name, const std::optional<std::string>& value) {
#ifdef _WIN32
        _putenv_s(name.c_str(), value ? value->c_str() : "");
#else
        if (value) {
            ::setenv(name.c_str(), value->c_str(), 1);
        } else {
            ::unsetenv(name.c_str());
        }
#endif
    }

    std::string name_;
    std::optional<std::string> previous_;
};

// `auto guard = with_env("SSL_CERT_FILE", path);` - the variable is restored when the guard
// goes out of scope; nullopt unsets it for the scope.
[[nodiscard]] inline EnvGuard with_env(std::string name, std::optional<std::string> value) {
    return EnvGuard(std::move(name), std::move(value));
}

// A JobControl for calling a job function directly on the test thread: `cancel()` raises the
// flag the function polls; progress reports are recorded.
class ManualJobControl : public rpc::JobControl {
public:
    struct Progress {
        std::string phase;
        std::int64_t done = 0;
        std::int64_t total = 0;
    };

    explicit ManualJobControl(std::string id = "j-test") : id_(std::move(id)) {}

    const std::string& id() const override { return id_; }
    bool cancelled() const override { return cancelled_.load(); }
    void progress(const std::string& phase, std::int64_t done, std::int64_t total) override {
        std::lock_guard<std::mutex> lock(mutex_);
        reports_.push_back(Progress{phase, done, total});
    }

    void cancel() { cancelled_.store(true); }
    std::vector<Progress> reports() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return reports_;
    }
    std::vector<std::string> phases() const {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<std::string> out;
        for (const auto& report : reports_) {
            out.push_back(report.phase);
        }
        return out;
    }

private:
    std::string id_;
    std::atomic<bool> cancelled_{false};
    mutable std::mutex mutex_;
    std::vector<Progress> reports_;
};

}  // namespace mfbe::test
