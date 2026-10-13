// Hardened libxml2 parsing helpers (T041). See xml_security.hpp for the policy.
#include "xml/xml_security.hpp"

#include <mfbe/encodings.hpp>

#include <libxml/parserInternals.h>
#include <libxml/xmlerror.h>

#include <cstring>
#include <mutex>

namespace mfbe::xml {
namespace {

std::once_flag g_init_once;

void collect_error(void* user_data, const xmlError* error) {
    auto* errors = static_cast<std::vector<CollectedError>*>(user_data);
    if (errors == nullptr || error == nullptr) {
        return;
    }
    CollectedError e;
    e.line = error->line;
    e.column = error->int2;
    e.code = error->code;
    e.fatal = error->level == XML_ERR_FATAL;
    if (error->message != nullptr) {
        e.message = error->message;
        while (!e.message.empty() && (e.message.back() == '\n' || e.message.back() == ' ')) {
            e.message.pop_back();
        }
    }
    if (errors->size() < 200) {  // keep hostile inputs from flooding memory with messages
        errors->push_back(std::move(e));
    }
}

xmlParserErrors deny_resource(void* /*ctxt*/, const char* /*url*/, const char* /*publicId*/,
                              xmlResourceType /*type*/, xmlParserInputFlags /*flags*/,
                              xmlParserInput** out) {
    if (out != nullptr) {
        *out = nullptr;
    }
    return XML_IO_ENOENT;
}

}  // namespace

int hardened_parse_options() {
    // (XML_PARSE_NOERROR would also silence the structured error handler, so errors are routed
    // through xmlCtxtSetErrorHandler instead.)
    return XML_PARSE_NONET | XML_PARSE_NO_XXE | XML_PARSE_NO_SYS_CATALOG | XML_PARSE_BIG_LINES |
           XML_PARSE_NOCDATA;
}

void ensure_libxml_initialised() {
    std::call_once(g_init_once, [] { xmlInitParser(); });
}

void harden_context(xmlParserCtxtPtr ctxt, std::vector<CollectedError>* errors) {
    if (ctxt == nullptr) {
        return;
    }
    xmlCtxtSetOptions(ctxt, hardened_parse_options());
    xmlCtxtSetResourceLoader(ctxt, deny_resource, nullptr);
    xmlCtxtSetMaxAmplification(ctxt, 5);
    if (errors != nullptr) {
        xmlCtxtSetErrorHandler(ctxt, collect_error, errors);
    }
    encoding::install_libxml_handlers(ctxt);
}

xmlDocPtr parse_memory(std::string_view bytes, const char* url, const char* encoding,
                       std::vector<CollectedError>& errors, const xmlSAXHandler* sax, void* priv) {
    ensure_libxml_initialised();
    if (bytes.size() > kMaxDocumentBytes) {
        errors.push_back(CollectedError{1, 1, XML_ERR_RESOURCE_LIMIT,
                                        "document exceeds the maximum supported size", true});
        return nullptr;
    }
    xmlParserCtxtPtr ctxt = sax != nullptr ? xmlNewSAXParserCtxt(sax, nullptr) : xmlNewParserCtxt();
    if (ctxt == nullptr) {
        errors.push_back(CollectedError{0, 0, XML_ERR_NO_MEMORY, "cannot create parser", true});
        return nullptr;
    }
    xmlCtxtSetPrivate(ctxt, priv);
    harden_context(ctxt, &errors);
    xmlDocPtr doc = xmlCtxtReadMemory(ctxt, bytes.data(), static_cast<int>(bytes.size()), url,
                                      encoding, hardened_parse_options());
    const bool well_formed = (xmlCtxtGetStatus(ctxt) & XML_STATUS_NOT_WELL_FORMED) == 0;
    xmlFreeParserCtxt(ctxt);
    if (doc != nullptr && !well_formed) {
        xmlFreeDoc(doc);
        doc = nullptr;
    }
    if (doc == nullptr && errors.empty()) {
        errors.push_back(
            CollectedError{0, 0, XML_ERR_INTERNAL_ERROR, "document could not be parsed", true});
    }
    return doc;
}

CollectedError primary_error(const std::vector<CollectedError>& errors) {
    for (const auto& e : errors) {
        if (e.fatal) {
            return e;
        }
    }
    if (!errors.empty()) {
        return errors.front();
    }
    return CollectedError{0, 0, 0, "document could not be parsed", true};
}

std::string dump_node(xmlNodePtr node) {
    if (node == nullptr) {
        return "";
    }
    std::string result;
    xmlBufferPtr buffer = xmlBufferCreate();
    if (buffer == nullptr) {
        return "";
    }
    if (node->type == XML_ELEMENT_NODE) {
        // A detached copy picks up the namespace declarations it needs from its ancestors, so
        // the fragment stays well-formed wherever it is re-inserted (see xmlStaticCopyNode).
        xmlNodePtr copy = xmlDocCopyNode(node, node->doc, 1);
        if (copy != nullptr) {
            xmlNodeDump(buffer, node->doc, copy, 0, 0);
            xmlFreeNode(copy);
        }
    } else {
        xmlNodeDump(buffer, node->doc, node, 0, 0);
    }
    const xmlChar* content = xmlBufferContent(buffer);
    if (content != nullptr) {
        result.assign(reinterpret_cast<const char*>(content));
    }
    xmlBufferFree(buffer);
    return result;
}

std::string escape_text(std::string_view text) {
    std::string out;
    out.reserve(text.size() + 8);
    for (const char c : text) {
        switch (c) {
            case '&':
                out += "&amp;";
                break;
            case '<':
                out += "&lt;";
                break;
            case '>':
                out += "&gt;";
                break;
            default:
                out.push_back(c);
        }
    }
    return out;
}

std::string escape_attribute(std::string_view text) {
    std::string out;
    out.reserve(text.size() + 8);
    for (const char c : text) {
        switch (c) {
            case '&':
                out += "&amp;";
                break;
            case '<':
                out += "&lt;";
                break;
            case '>':
                out += "&gt;";
                break;
            case '"':
                out += "&quot;";
                break;
            case '\n':
                out += "&#10;";
                break;
            case '\r':
                out += "&#13;";
                break;
            case '\t':
                out += "&#9;";
                break;
            default:
                out.push_back(c);
        }
    }
    return out;
}

}  // namespace mfbe::xml
