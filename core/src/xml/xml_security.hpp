// Internal: hardened libxml2 parsing shared by the FB2 reader and the validator (T041, FR-130).
//
// Policy (research D6):
//   - XML_PARSE_NO_XXE + no XML_PARSE_DTDLOAD/DTDVALID: external DTDs and entities are never
//     loaded; a resource loader that refuses everything is installed as a second barrier, and
//     XML_PARSE_NONET/NO_SYS_CATALOG keep network clients and system catalogs out of the picture.
//   - XML_PARSE_NOENT stays OFF: internal entity declarations are not expanded by the parser
//     (entity reference nodes are resolved by the reader), and libxml2's default amplification
//     limit (xmlCtxtSetMaxAmplification 5) bounds "billion laughs" style inputs.
//   - XML_PARSE_HUGE stays OFF, so libxml2's standard limits apply: 10 MB per text node,
//     50 KB names, 256 levels of element nesting, 20 levels of entity nesting. <binary>
//     payloads never hit the text limit because the reader decodes them from SAX chunks
//     instead of building text nodes (see fb2_reader.cpp).
//   - XML_PARSE_BIG_LINES keeps line numbers exact beyond 65535 lines; XML_PARSE_NOCDATA
//     turns CDATA sections into ordinary text.
// Errors are collected as structured records (line/column/message) - nothing is printed.
#pragma once

#include <libxml/parser.h>
#include <libxml/tree.h>

#include <string>
#include <string_view>
#include <vector>

namespace mfbe::xml {

inline constexpr std::size_t kMaxDocumentBytes = 512ULL * 1024 * 1024;  // refuse absurd inputs

struct CollectedError {
    int line = 0;
    int column = 0;
    int code = 0;
    std::string message;  // trimmed libxml2 text
    bool fatal = false;
};

// Parser options for untrusted FB2 input (see the policy above).
int hardened_parse_options();

// Makes sure libxml2 is initialised (idempotent, thread-safe).
void ensure_libxml_initialised();

// Applies the policy to a context: options, resource loader, amplification limit, structured
// error collection into `errors`, and the table-based legacy encodings.
void harden_context(xmlParserCtxtPtr ctxt, std::vector<CollectedError>* errors);

// Parses `bytes` into a DOM. `encoding` overrides BOM/declaration detection when non-null.
// `sax` lets the caller wrap the default SAX2 handlers (binary stripping); `priv` becomes
// xmlCtxtGetPrivate(). Returns nullptr when the input is not well-formed (errors filled).
xmlDocPtr parse_memory(std::string_view bytes, const char* url, const char* encoding,
                       std::vector<CollectedError>& errors, const xmlSAXHandler* sax = nullptr,
                       void* priv = nullptr);

// First fatal error (or first error) as line/column/message; a generic message when none.
CollectedError primary_error(const std::vector<CollectedError>& errors);

// Serialises an element (with the namespace declarations it needs) as a self-contained XML
// fragment. Comments and processing instructions serialise as themselves.
std::string dump_node(xmlNodePtr node);

// Escapes text for XML character data (& < >) or attribute values (also ").
std::string escape_text(std::string_view text);
std::string escape_attribute(std::string_view text);

}  // namespace mfbe::xml
