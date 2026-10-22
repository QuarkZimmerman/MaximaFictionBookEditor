// The flattened content table of the FB2 2.1 schema (feature 005). See mfbe/schema_table.hpp.
//
// The walk mirrors tools/fb2-schema-elements.py step by step (the generated UI table and this
// one are pinned equal by a test): a schema document is parsed as plain XML with the hardened
// parser - no dependency on libxml2's compiled-schema structures - and the particles of
// every element declaration are flattened to child names.
#include "xml/xml_security.hpp"

#include <mfbe/fb2_reader.hpp>
#include <mfbe/schema_table.hpp>
#include <mfbe/utf8_paths.hpp>
#include <mfbe/validator.hpp>

#include <libxml/tree.h>

#include <mutex>
#include <optional>
#include <utility>
#include <vector>

namespace mfbe::schema {
namespace {

namespace fs = std::filesystem;

constexpr const char* kXsNamespace = "http://www.w3.org/2001/XMLSchema";

const xmlChar* X(const char* s) {
    return reinterpret_cast<const xmlChar*>(s);
}

std::string str(const xmlChar* s) {
    return s == nullptr ? std::string() : std::string(reinterpret_cast<const char*>(s));
}

bool is_xs(const xmlNode* node, const char* local) {
    return node != nullptr && node->type == XML_ELEMENT_NODE && node->ns != nullptr &&
           xmlStrEqual(node->ns->href, X(kXsNamespace)) != 0 &&
           xmlStrEqual(node->name, X(local)) != 0;
}

std::optional<std::string> attr(const xmlNode* node, const char* name) {
    xmlChar* value = xmlGetNoNsProp(const_cast<xmlNodePtr>(node), X(name));
    if (value == nullptr) {
        return std::nullopt;
    }
    std::string out(reinterpret_cast<const char*>(value));
    xmlFree(value);
    return out;
}

// (namespace, local name): the key of a named schema component.
using Key = std::pair<std::string, std::string>;

struct SchemaDocument {
    fs::path path;
    xmlDocPtr doc = nullptr;
    std::string target_namespace;

    // (namespace, local name) of a QName attribute value as written at `at`: the prefix is
    // resolved in scope, an unprefixed name through the default namespace when the document
    // declares one.
    Key qname(const xmlNode* at, const std::string& value) const {
        const std::size_t colon = value.find(':');
        const std::string prefix = colon == std::string::npos ? "" : value.substr(0, colon);
        const std::string local = colon == std::string::npos ? value : value.substr(colon + 1);
        xmlNsPtr ns = xmlSearchNs(doc, const_cast<xmlNodePtr>(at),
                                  prefix.empty() ? nullptr : X(prefix.c_str()));
        return {ns != nullptr ? str(ns->href) : std::string(), local};
    }
};

struct Component {
    const SchemaDocument* doc = nullptr;
    xmlNodePtr node = nullptr;
};

class Builder {
public:
    explicit Builder(ContentTable& table) : table_(table) {}
    ~Builder() {
        for (auto& d : documents_) {
            if (d->doc != nullptr) {
                xmlFreeDoc(d->doc);
            }
        }
    }
    Builder(const Builder&) = delete;
    Builder& operator=(const Builder&) = delete;

    void run(const fs::path& main_xsd) {
        load(main_xsd);
        if (!table_.error.empty()) {
            return;
        }
        // Every element declaration of every document, the name's entries merged.
        for (const auto& d : documents_) {
            collect_declarations(*d, xmlDocGetRootElement(d->doc));
        }
        // The one global element of the main document.
        for (const auto& [key, component] : global_elements_) {
            if (component.doc == documents_.front().get()) {
                table_.root = key.second;
            }
        }
    }

private:
    void fail(const fs::path& path, const std::string& reason) {
        if (table_.error.empty()) {
            table_.error = reason;
            table_.error_path = platform::utf8_from_path(path);
        }
    }

    void load(const fs::path& given) {
        std::error_code ec;
        fs::path path = fs::weakly_canonical(given, ec);
        if (ec) {
            path = given;
        }
        if (!loaded_.insert(path).second) {
            return;
        }
        std::string bytes;
        try {
            bytes = fb2::read_file_bytes(path);
        } catch (const fb2::IoFailure& e) {
            fail(path, e.reason);
            return;
        }
        std::vector<xml::CollectedError> errors;
        xmlDocPtr doc =
            xml::parse_memory(bytes, platform::utf8_from_path(path).c_str(), nullptr, errors);
        if (doc == nullptr) {
            fail(path, "not well-formed: " + xml::primary_error(errors).message);
            return;
        }
        auto document = std::make_unique<SchemaDocument>();
        document->path = path;
        document->doc = doc;
        documents_.push_back(std::move(document));
        SchemaDocument& d = *documents_.back();
        xmlNodePtr root = xmlDocGetRootElement(doc);
        if (!is_xs(root, "schema")) {
            fail(path, "not an XML Schema document");
            return;
        }
        d.target_namespace = attr(root, "targetNamespace").value_or("");
        for (xmlNodePtr child = root->children; child != nullptr; child = child->next) {
            if (child->type != XML_ELEMENT_NODE) {
                continue;
            }
            const std::optional<std::string> name = attr(child, "name");
            if ((is_xs(child, "complexType") || is_xs(child, "simpleType")) && name) {
                types_[{d.target_namespace, *name}] = Component{&d, child};
            } else if (is_xs(child, "group") && name) {
                groups_[{d.target_namespace, *name}] = Component{&d, child};
            } else if (is_xs(child, "element") && name) {
                global_elements_[{d.target_namespace, *name}] = Component{&d, child};
            } else if (is_xs(child, "import") || is_xs(child, "include") ||
                       is_xs(child, "redefine")) {
                const std::optional<std::string> location = attr(child, "schemaLocation");
                if (!location || location->empty()) {
                    continue;  // e.g. the xml: namespace imported without a location
                }
                const fs::path target = path.parent_path() / platform::path_from_utf8(*location);
                std::error_code exists_ec;
                if (!fs::exists(target, exists_ec)) {
                    continue;  // skipped, as the generator skips it
                }
                load(target);
                if (!table_.error.empty()) {
                    return;
                }
            }
        }
    }

    void collect_declarations(const SchemaDocument& d, xmlNodePtr node) {
        for (xmlNodePtr el = node; el != nullptr; el = el->next) {
            if (el->type != XML_ELEMENT_NODE) {
                continue;
            }
            if (is_xs(el, "element")) {
                if (const std::optional<std::string> name = attr(el, "name")) {
                    ElementContent content;
                    content_of_element(d, el, content);
                    ElementContent& entry = table_.elements[*name];
                    entry.children.insert(content.children.begin(), content.children.end());
                    entry.text = entry.text || content.text;
                }
            }
            collect_declarations(d, el->children);
        }
    }

    // The content model of one element declaration: its named type or its inline type.
    void content_of_element(const SchemaDocument& d, xmlNodePtr element, ElementContent& out) {
        if (const std::optional<std::string> type_name = attr(element, "type")) {
            const Key key = d.qname(element, *type_name);
            if (key.first == kXsNamespace) {
                out.text = true;  // a built-in simple type (xs:string, xs:token, ...)
                return;
            }
            auto it = types_.find(key);
            if (it == types_.end()) {
                fail(d.path, "element " + attr(element, "name").value_or("") +
                                 " has unknown type " + *type_name);
                return;
            }
            content_of_type(*it->second.doc, it->second.node, out, {});
            return;
        }
        for (xmlNodePtr child = element->children; child != nullptr; child = child->next) {
            if (is_xs(child, "complexType")) {
                content_of_type(d, child, out, {});
                return;
            }
            if (is_xs(child, "simpleType")) {
                out.text = true;
                return;
            }
        }
        // No type at all (xs:anyType): FB2 declares `empty-line` so; an empty element.
    }

    void content_of_type(const SchemaDocument& d, xmlNodePtr type_node, ElementContent& out,
                         std::set<Key> seen) {
        if (is_xs(type_node, "simpleType")) {
            out.text = true;
            return;
        }
        if (!is_xs(type_node, "complexType")) {
            return;
        }
        if (attr(type_node, "mixed").value_or("") == "true") {
            out.text = true;
        }
        for (xmlNodePtr child = type_node->children; child != nullptr; child = child->next) {
            if (child->type != XML_ELEMENT_NODE) {
                continue;
            }
            if (is_xs(child, "simpleContent")) {
                out.text = true;
                return;
            }
            if (is_xs(child, "complexContent")) {
                if (attr(child, "mixed").value_or("") == "true") {
                    out.text = true;
                }
                for (xmlNodePtr derivation = child->children; derivation != nullptr;
                     derivation = derivation->next) {
                    const bool extension = is_xs(derivation, "extension");
                    if (!extension && !is_xs(derivation, "restriction")) {
                        continue;
                    }
                    const std::optional<std::string> base = attr(derivation, "base");
                    if (extension && base) {
                        const Key key = d.qname(derivation, *base);
                        if (key.first != kXsNamespace) {
                            auto it = types_.find(key);
                            if (it == types_.end()) {
                                fail(d.path, "unknown base type " + *base);
                                return;
                            }
                            if (seen.count(key) != 0) {
                                fail(d.path, "circular derivation of " + *base);
                                return;
                            }
                            std::set<Key> next = seen;
                            next.insert(key);
                            content_of_type(*it->second.doc, it->second.node, out, next);
                        }
                    }
                    // A restriction restates the content model it keeps: its own particles.
                    particles(d, derivation, out);
                }
                continue;
            }
            particle(d, child, out);
        }
    }

    void particles(const SchemaDocument& d, xmlNodePtr parent, ElementContent& out) {
        for (xmlNodePtr child = parent->children; child != nullptr; child = child->next) {
            if (child->type == XML_ELEMENT_NODE) {
                particle(d, child, out);
            }
        }
    }

    void particle(const SchemaDocument& d, xmlNodePtr node, ElementContent& out) {
        if (is_xs(node, "sequence") || is_xs(node, "choice") || is_xs(node, "all")) {
            particles(d, node, out);
            return;
        }
        if (is_xs(node, "element")) {
            if (const std::optional<std::string> name = attr(node, "name")) {
                out.children.insert(*name);
                return;
            }
            if (const std::optional<std::string> ref = attr(node, "ref")) {
                const Key key = d.qname(node, *ref);
                if (global_elements_.count(key) == 0) {
                    fail(d.path, "unknown element reference " + *ref);
                    return;
                }
                out.children.insert(key.second);
                return;
            }
            fail(d.path, "element without name or ref");
            return;
        }
        if (is_xs(node, "group")) {
            if (const std::optional<std::string> ref = attr(node, "ref")) {
                const Key key = d.qname(node, *ref);
                auto it = groups_.find(key);
                if (it == groups_.end()) {
                    fail(d.path, "unknown group reference " + *ref);
                    return;
                }
                particles(*it->second.doc, it->second.node, out);
                return;
            }
            particles(d, node, out);
        }
        // xs:any (not used by FB2), xs:attribute, xs:attributeGroup, xs:anyAttribute,
        // xs:annotation: no element children.
    }

    ContentTable& table_;
    std::vector<std::unique_ptr<SchemaDocument>> documents_;
    std::set<fs::path> loaded_;
    std::map<Key, Component> types_;
    std::map<Key, Component> groups_;
    std::map<Key, Component> global_elements_;
};

struct Cache {
    std::mutex mutex;
    fs::path dir;
    std::shared_ptr<const ContentTable> table;
};

Cache& cache() {
    static Cache c;
    return c;
}

}  // namespace

const ElementContent* ContentTable::find(const std::string& name) const {
    auto it = elements.find(name);
    return it == elements.end() ? nullptr : &it->second;
}

ContentTable build_content_table(const fs::path& main_xsd) {
    xml::ensure_libxml_initialised();
    ContentTable table;
    Builder builder(table);
    builder.run(main_xsd);
    if (!table.error.empty()) {
        table.elements.clear();
        table.root.clear();
    }
    return table;
}

std::shared_ptr<const ContentTable> content_table() {
    const fs::path dir = validation::schema_dir();
    Cache& c = cache();
    std::lock_guard<std::mutex> lock(c.mutex);
    // A table that could not be built is not kept: the next call tries again (the folder may
    // have been installed meanwhile).
    if (!c.table || c.dir != dir || !c.table->error.empty()) {
        c.table =
            std::make_shared<const ContentTable>(build_content_table(dir / "FictionBook.xsd"));
        c.dir = dir;
    }
    return c.table;
}

}  // namespace mfbe::schema
