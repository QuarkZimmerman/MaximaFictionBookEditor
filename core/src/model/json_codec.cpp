// JSON codec for the document model (T016). See mfbe/json_codec.hpp.
#include <mfbe/json_codec.hpp>

#include <string>

namespace mfbe::model {
namespace {

using json = nlohmann::json;

// ------------------------------------------------------------------ reading helpers --------

class Reader {
public:
    Reader(const json& j, std::string path) : j_(j), path_(std::move(path)) {
        if (!j_.is_object()) {
            throw CodecError(path_, "expected an object");
        }
    }

    const json& raw() const { return j_; }
    const std::string& path() const { return path_; }
    std::string child_path(const std::string& key) const { return path_ + "/" + key; }

    bool has(const char* key) const {
        auto it = j_.find(key);
        return it != j_.end() && !it->is_null();
    }

    std::string string(const char* key) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            throw CodecError(child_path(key), "missing required string");
        }
        if (!it->is_string()) {
            throw CodecError(child_path(key), "expected a string");
        }
        return it->get<std::string>();
    }

    std::string string_or(const char* key, const std::string& fallback) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return fallback;
        }
        if (!it->is_string()) {
            throw CodecError(child_path(key), "expected a string");
        }
        return it->get<std::string>();
    }

    std::optional<std::string> opt_string(const char* key) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return std::nullopt;
        }
        if (!it->is_string()) {
            throw CodecError(child_path(key), "expected a string");
        }
        return it->get<std::string>();
    }

    std::optional<int> opt_int(const char* key) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return std::nullopt;
        }
        if (it->is_number_integer()) {
            return it->get<int>();
        }
        if (it->is_number_float()) {
            const double d = it->get<double>();
            if (d == static_cast<double>(static_cast<long long>(d))) {
                return static_cast<int>(d);
            }
        }
        throw CodecError(child_path(key), "expected an integer");
    }

    int int_or(const char* key, int fallback) const { return opt_int(key).value_or(fallback); }

    std::int64_t int64_or(const char* key, std::int64_t fallback) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return fallback;
        }
        if (!it->is_number()) {
            throw CodecError(child_path(key), "expected a number");
        }
        return it->get<std::int64_t>();
    }

    bool bool_or(const char* key, bool fallback) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return fallback;
        }
        if (!it->is_boolean()) {
            throw CodecError(child_path(key), "expected a boolean");
        }
        return it->get<bool>();
    }

    std::vector<std::string> string_array(const char* key) const {
        std::vector<std::string> out;
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return out;
        }
        if (!it->is_array()) {
            throw CodecError(child_path(key), "expected an array");
        }
        std::size_t index = 0;
        for (const auto& item : *it) {
            if (!item.is_string()) {
                throw CodecError(child_path(key) + "/" + std::to_string(index),
                                 "expected a string");
            }
            out.push_back(item.get<std::string>());
            ++index;
        }
        return out;
    }

    template <typename T, typename Fn>
    std::vector<T> array(const char* key, Fn parse) const {
        std::vector<T> out;
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return out;
        }
        if (!it->is_array()) {
            throw CodecError(child_path(key), "expected an array");
        }
        std::size_t index = 0;
        for (const auto& item : *it) {
            out.push_back(parse(item, child_path(key) + "/" + std::to_string(index)));
            ++index;
        }
        return out;
    }

    template <typename T, typename Fn>
    std::optional<T> optional(const char* key, Fn parse) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            return std::nullopt;
        }
        return parse(*it, child_path(key));
    }

    template <typename T, typename Fn>
    T required(const char* key, Fn parse) const {
        auto it = j_.find(key);
        if (it == j_.end() || it->is_null()) {
            throw CodecError(child_path(key), "missing required object");
        }
        return parse(*it, child_path(key));
    }

private:
    const json& j_;
    std::string path_;
};

template <typename T>
void put_opt(json& j, const char* key, const std::optional<T>& value) {
    if (value) {
        j[key] = *value;
    }
}

template <typename T>
json array_to_json(const std::vector<T>& items) {
    json arr = json::array();
    for (const auto& item : items) {
        arr.push_back(to_json(item));
    }
    return arr;
}

// Forward declarations of path-aware parsers.
Mark parse_mark(const json& j, const std::string& path);
Node parse_node(const json& j, const std::string& path);
Person parse_person(const json& j, const std::string& path);
Sequence parse_sequence(const json& j, const std::string& path);
DateValue parse_date(const json& j, const std::string& path);
GenreRef parse_genre(const json& j, const std::string& path);
ImageRef parse_image_ref(const json& j, const std::string& path);
TitleInfo parse_title_info(const json& j, const std::string& path);
DocumentInfo parse_document_info(const json& j, const std::string& path);
PublishInfo parse_publish_info(const json& j, const std::string& path);
CustomInfo parse_custom_info(const json& j, const std::string& path);
Description parse_description(const json& j, const std::string& path);
BinaryMeta parse_binary_meta(const json& j, const std::string& path);
ValidationIssue parse_validation_issue(const json& j, const std::string& path);
ValidationReport parse_validation_report(const json& j, const std::string& path);
Stylesheet parse_stylesheet(const json& j, const std::string& path);
Document parse_document(const json& j, const std::string& path);

// The nodes besides text whose `marks` the codec carries: the inline atoms, an inline image
// and inline raw XML (feature 006, FR-067; a block raw-xml node never has any).
bool carries_marks(const Node& node) {
    return node.type == "inline-image" || node.type == "raw-xml";
}

Mark parse_mark(const json& j, const std::string& path) {
    Reader r(j, path);
    Mark mark;
    mark.type = r.string("type");
    auto it = j.find("attrs");
    if (it != j.end() && !it->is_null()) {
        if (!it->is_object()) {
            throw CodecError(r.child_path("attrs"), "expected an object");
        }
        mark.attrs = *it;
    }
    return mark;
}

Node parse_node(const json& j, const std::string& path) {
    Reader r(j, path);
    Node node;
    node.type = r.string("type");
    if (node.type.empty()) {
        throw CodecError(r.child_path("type"), "empty node type");
    }
    if (node.is_text()) {
        node.text = r.string("text");
        node.marks = r.array<Mark>("marks", parse_mark);
        return node;
    }
    auto attrs = j.find("attrs");
    if (attrs != j.end() && !attrs->is_null()) {
        if (!attrs->is_object()) {
            throw CodecError(r.child_path("attrs"), "expected an object");
        }
        for (auto it = attrs->begin(); it != attrs->end(); ++it) {
            node.attrs[it.key()] = it.value();
        }
    }
    node.content = r.array<Node>("content", parse_node);
    if (carries_marks(node)) {
        node.marks = r.array<Mark>("marks", parse_mark);  // inline atoms (feature 006, FR-067)
    }
    return node;
}

Person parse_person(const json& j, const std::string& path) {
    Reader r(j, path);
    Person p;
    p.firstName = r.opt_string("firstName");
    p.middleName = r.opt_string("middleName");
    p.lastName = r.opt_string("lastName");
    p.nickname = r.opt_string("nickname");
    p.homePages = r.string_array("homePages");
    p.emails = r.string_array("emails");
    p.id = r.opt_string("id");
    return p;
}

Sequence parse_sequence(const json& j, const std::string& path) {
    Reader r(j, path);
    Sequence s;
    s.name = r.string("name");
    s.number = r.opt_int("number");
    s.lang = r.opt_string("lang");
    s.children = r.array<Sequence>("children", parse_sequence);
    return s;
}

DateValue parse_date(const json& j, const std::string& path) {
    Reader r(j, path);
    DateValue d;
    d.text = r.string_or("text", "");
    d.value = r.opt_string("value");
    d.lang = r.opt_string("lang");
    return d;
}

GenreRef parse_genre(const json& j, const std::string& path) {
    Reader r(j, path);
    GenreRef g;
    g.code = r.string("code");
    g.match = r.opt_int("match");
    return g;
}

ImageRef parse_image_ref(const json& j, const std::string& path) {
    Reader r(j, path);
    ImageRef i;
    i.href = r.string("href");
    i.alt = r.opt_string("alt");
    i.title = r.opt_string("title");
    i.id = r.opt_string("id");
    return i;
}

TitleInfo parse_title_info(const json& j, const std::string& path) {
    Reader r(j, path);
    TitleInfo t;
    t.genres = r.array<GenreRef>("genres", parse_genre);
    t.authors = r.array<Person>("authors", parse_person);
    t.bookTitle = r.string_or("bookTitle", "");
    t.annotation = r.optional<Node>("annotation", parse_node);
    t.keywords = r.opt_string("keywords");
    t.date = r.optional<DateValue>("date", parse_date);
    t.coverpage = r.array<ImageRef>("coverpage", parse_image_ref);
    t.lang = r.string_or("lang", "");
    t.srcLang = r.opt_string("srcLang");
    t.translators = r.array<Person>("translators", parse_person);
    t.sequences = r.array<Sequence>("sequences", parse_sequence);
    return t;
}

DocumentInfo parse_document_info(const json& j, const std::string& path) {
    Reader r(j, path);
    DocumentInfo d;
    d.authors = r.array<Person>("authors", parse_person);
    d.programUsed = r.opt_string("programUsed");
    d.date = r.has("date") ? r.required<DateValue>("date", parse_date) : DateValue{};
    d.srcUrls = r.string_array("srcUrls");
    d.srcOcr = r.opt_string("srcOcr");
    d.id = r.string_or("id", "");
    d.version = r.string_or("version", "");
    d.history = r.optional<Node>("history", parse_node);
    d.publishers = r.array<Person>("publishers", parse_person);
    return d;
}

PublishInfo parse_publish_info(const json& j, const std::string& path) {
    Reader r(j, path);
    PublishInfo p;
    p.bookName = r.opt_string("bookName");
    p.publisher = r.opt_string("publisher");
    p.city = r.opt_string("city");
    p.year = r.opt_string("year");
    p.isbn = r.opt_string("isbn");
    p.sequences = r.array<Sequence>("sequences", parse_sequence);
    return p;
}

CustomInfo parse_custom_info(const json& j, const std::string& path) {
    Reader r(j, path);
    CustomInfo c;
    c.infoType = r.string("infoType");
    c.text = r.string_or("text", "");
    c.lang = r.opt_string("lang");
    return c;
}

Description parse_description(const json& j, const std::string& path) {
    Reader r(j, path);
    Description d;
    d.titleInfo = r.required<TitleInfo>("titleInfo", parse_title_info);
    d.srcTitleInfo = r.optional<TitleInfo>("srcTitleInfo", parse_title_info);
    d.documentInfo = r.required<DocumentInfo>("documentInfo", parse_document_info);
    d.publishInfo = r.optional<PublishInfo>("publishInfo", parse_publish_info);
    d.customInfo = r.array<CustomInfo>("customInfo", parse_custom_info);
    d.outputs = r.array<Node>("outputs", parse_node);
    return d;
}

BinaryMeta parse_binary_meta(const json& j, const std::string& path) {
    Reader r(j, path);
    BinaryMeta b;
    b.id = r.string("id");
    b.contentType = r.string_or("contentType", "");
    b.size = r.int64_or("size", 0);
    b.width = r.opt_int("width");
    b.height = r.opt_int("height");
    b.decodable = r.bool_or("decodable", false);
    b.willConvert = r.bool_or("willConvert", false);
    b.referenceCount = r.int_or("referenceCount", 0);
    return b;
}

ValidationIssue parse_validation_issue(const json& j, const std::string& path) {
    Reader r(j, path);
    ValidationIssue v;
    const auto severity = severity_from_string(r.string("severity"));
    if (!severity) {
        throw CodecError(r.child_path("severity"), "expected 'error' or 'warning'");
    }
    v.severity = *severity;
    v.code = r.string("code");
    auto params = j.find("params");
    if (params != j.end() && !params->is_null()) {
        if (!params->is_object()) {
            throw CodecError(r.child_path("params"), "expected an object");
        }
        for (auto it = params->begin(); it != params->end(); ++it) {
            v.params[it.key()] = it.value();
        }
    }
    v.line = r.opt_int("line");
    v.column = r.opt_int("column");
    v.nodeId = r.opt_string("nodeId");
    v.path = r.opt_string("path");
    return v;
}

ValidationReport parse_validation_report(const json& j, const std::string& path) {
    Reader r(j, path);
    ValidationReport report;
    report.issues = r.array<ValidationIssue>("issues", parse_validation_issue);
    report.errorCount = r.int_or("errorCount", 0);
    report.warningCount = r.int_or("warningCount", 0);
    report.durationMs = r.int64_or("durationMs", 0);
    return report;
}

Stylesheet parse_stylesheet(const json& j, const std::string& path) {
    Reader r(j, path);
    Stylesheet s;
    s.type = r.string_or("type", "");
    s.content = r.string_or("content", "");
    return s;
}

Document parse_document(const json& j, const std::string& path) {
    Reader r(j, path);
    Document d;
    d.modelVersion = r.int_or("modelVersion", kModelVersion);
    if (d.modelVersion != kModelVersion) {
        throw CodecError(r.child_path("modelVersion"),
                         "unsupported model version " + std::to_string(d.modelVersion));
    }
    d.docId = r.string_or("docId", "");
    d.path = r.opt_string("path");
    const auto kind = file_kind_from_string(r.string_or("fileKind", "fb2"));
    if (!kind) {
        throw CodecError(r.child_path("fileKind"), "expected 'fb2', 'fbd' or 'xml'");
    }
    d.fileKind = *kind;
    d.sourceEncoding = r.string_or("sourceEncoding", "utf-8");
    const auto hint = schema_hint_from_string(r.string_or("schemaHint", "unknown"));
    if (!hint) {
        throw CodecError(r.child_path("schemaHint"), "expected '2.1', 'legacy' or 'unknown'");
    }
    d.schemaHint = *hint;
    d.stylesheets = r.array<Stylesheet>("stylesheets", parse_stylesheet);
    d.description = r.required<Description>("description", parse_description);
    d.bodies = r.array<Node>("bodies", parse_node);
    d.binaries = r.array<BinaryMeta>("binaries", parse_binary_meta);
    d.extras = r.array<Node>("extras", parse_node);
    return d;
}

}  // namespace

// ------------------------------------------------------------------ writers ----------------

json to_json(const Mark& mark) {
    json j;
    j["type"] = mark.type;
    if (mark.attrs.is_object() && !mark.attrs.empty()) {
        j["attrs"] = mark.attrs;
    }
    return j;
}

json to_json(const Node& node) {
    json j;
    j["type"] = node.type;
    if (node.is_text()) {
        j["text"] = node.text;
        if (!node.marks.empty()) {
            j["marks"] = array_to_json(node.marks);
        }
        return j;
    }
    json attrs = json::object();
    for (const auto& [key, value] : node.attrs) {
        attrs[key] = value;
    }
    j["attrs"] = std::move(attrs);
    if (!node.content.empty() || !is_leaf_type(node.type)) {
        j["content"] = array_to_json(node.content);
    }
    if (carries_marks(node) && !node.marks.empty()) {
        j["marks"] = array_to_json(node.marks);
    }
    return j;
}

json to_json(const Person& person) {
    json j = json::object();
    put_opt(j, "firstName", person.firstName);
    put_opt(j, "middleName", person.middleName);
    put_opt(j, "lastName", person.lastName);
    put_opt(j, "nickname", person.nickname);
    j["homePages"] = person.homePages;
    j["emails"] = person.emails;
    put_opt(j, "id", person.id);
    return j;
}

json to_json(const Sequence& sequence) {
    json j;
    j["name"] = sequence.name;
    put_opt(j, "number", sequence.number);
    put_opt(j, "lang", sequence.lang);
    j["children"] = array_to_json(sequence.children);
    return j;
}

json to_json(const DateValue& date) {
    json j;
    j["text"] = date.text;
    put_opt(j, "value", date.value);
    put_opt(j, "lang", date.lang);
    return j;
}

json to_json(const GenreRef& genre) {
    json j;
    j["code"] = genre.code;
    put_opt(j, "match", genre.match);
    return j;
}

json to_json(const ImageRef& image) {
    json j;
    j["href"] = image.href;
    put_opt(j, "alt", image.alt);
    put_opt(j, "title", image.title);
    put_opt(j, "id", image.id);
    return j;
}

json to_json(const TitleInfo& info) {
    json j;
    j["genres"] = array_to_json(info.genres);
    j["authors"] = array_to_json(info.authors);
    j["bookTitle"] = info.bookTitle;
    if (info.annotation) {
        j["annotation"] = to_json(*info.annotation);
    }
    put_opt(j, "keywords", info.keywords);
    if (info.date) {
        j["date"] = to_json(*info.date);
    }
    j["coverpage"] = array_to_json(info.coverpage);
    j["lang"] = info.lang;
    put_opt(j, "srcLang", info.srcLang);
    j["translators"] = array_to_json(info.translators);
    j["sequences"] = array_to_json(info.sequences);
    return j;
}

json to_json(const DocumentInfo& info) {
    json j;
    j["authors"] = array_to_json(info.authors);
    put_opt(j, "programUsed", info.programUsed);
    j["date"] = to_json(info.date);
    j["srcUrls"] = info.srcUrls;
    put_opt(j, "srcOcr", info.srcOcr);
    j["id"] = info.id;
    j["version"] = info.version;
    if (info.history) {
        j["history"] = to_json(*info.history);
    }
    j["publishers"] = array_to_json(info.publishers);
    return j;
}

json to_json(const PublishInfo& info) {
    json j = json::object();
    put_opt(j, "bookName", info.bookName);
    put_opt(j, "publisher", info.publisher);
    put_opt(j, "city", info.city);
    put_opt(j, "year", info.year);
    put_opt(j, "isbn", info.isbn);
    j["sequences"] = array_to_json(info.sequences);
    return j;
}

json to_json(const CustomInfo& info) {
    json j;
    j["infoType"] = info.infoType;
    j["text"] = info.text;
    put_opt(j, "lang", info.lang);
    return j;
}

json to_json(const Description& description) {
    json j;
    j["titleInfo"] = to_json(description.titleInfo);
    if (description.srcTitleInfo) {
        j["srcTitleInfo"] = to_json(*description.srcTitleInfo);
    }
    j["documentInfo"] = to_json(description.documentInfo);
    if (description.publishInfo) {
        j["publishInfo"] = to_json(*description.publishInfo);
    }
    j["customInfo"] = array_to_json(description.customInfo);
    j["outputs"] = array_to_json(description.outputs);
    return j;
}

json to_json(const BinaryMeta& meta) {
    json j;
    j["id"] = meta.id;
    j["contentType"] = meta.contentType;
    j["size"] = meta.size;
    put_opt(j, "width", meta.width);
    put_opt(j, "height", meta.height);
    j["decodable"] = meta.decodable;
    j["willConvert"] = meta.willConvert;
    j["referenceCount"] = meta.referenceCount;
    return j;
}

json to_json(const ValidationIssue& issue) {
    json j;
    j["severity"] = to_string(issue.severity);
    j["code"] = issue.code;
    json params = json::object();
    for (const auto& [key, value] : issue.params) {
        params[key] = value;
    }
    j["params"] = std::move(params);
    put_opt(j, "line", issue.line);
    put_opt(j, "column", issue.column);
    put_opt(j, "nodeId", issue.nodeId);
    put_opt(j, "path", issue.path);
    return j;
}

json to_json(const ValidationReport& report) {
    json j;
    j["issues"] = array_to_json(report.issues);
    j["errorCount"] = report.errorCount;
    j["warningCount"] = report.warningCount;
    j["durationMs"] = report.durationMs;
    return j;
}

json to_json(const Stylesheet& stylesheet) {
    json j;
    j["type"] = stylesheet.type;
    j["content"] = stylesheet.content;
    return j;
}

json to_json(const Document& document) {
    json j;
    j["modelVersion"] = kModelVersion;
    j["docId"] = document.docId;
    put_opt(j, "path", document.path);
    j["fileKind"] = to_string(document.fileKind);
    j["sourceEncoding"] = document.sourceEncoding;
    j["schemaHint"] = to_string(document.schemaHint);
    j["stylesheets"] = array_to_json(document.stylesheets);
    j["description"] = to_json(document.description);
    j["bodies"] = array_to_json(document.bodies);
    j["binaries"] = array_to_json(document.binaries);
    j["extras"] = array_to_json(document.extras);
    return j;
}

// ------------------------------------------------------------------ public parsers ---------

Mark mark_from_json(const json& j) {
    return parse_mark(j, "");
}
Node node_from_json(const json& j) {
    return parse_node(j, "");
}
Person person_from_json(const json& j) {
    return parse_person(j, "");
}
Sequence sequence_from_json(const json& j) {
    return parse_sequence(j, "");
}
DateValue date_from_json(const json& j) {
    return parse_date(j, "");
}
GenreRef genre_from_json(const json& j) {
    return parse_genre(j, "");
}
ImageRef image_ref_from_json(const json& j) {
    return parse_image_ref(j, "");
}
TitleInfo title_info_from_json(const json& j) {
    return parse_title_info(j, "");
}
DocumentInfo document_info_from_json(const json& j) {
    return parse_document_info(j, "");
}
PublishInfo publish_info_from_json(const json& j) {
    return parse_publish_info(j, "");
}
CustomInfo custom_info_from_json(const json& j) {
    return parse_custom_info(j, "");
}
Description description_from_json(const json& j) {
    return parse_description(j, "");
}
BinaryMeta binary_meta_from_json(const json& j) {
    return parse_binary_meta(j, "");
}
ValidationIssue validation_issue_from_json(const json& j) {
    return parse_validation_issue(j, "");
}
ValidationReport validation_report_from_json(const json& j) {
    return parse_validation_report(j, "");
}
Stylesheet stylesheet_from_json(const json& j) {
    return parse_stylesheet(j, "");
}
Document document_from_json(const json& j) {
    return parse_document(j, "");
}

std::string document_to_string(const Document& document, int indent) {
    return to_json(document).dump(indent);
}

Document document_from_string(const std::string& text) {
    json j = json::parse(text, nullptr, false);
    if (j.is_discarded()) {
        throw CodecError("", "invalid JSON");
    }
    return document_from_json(j);
}

}  // namespace mfbe::model
