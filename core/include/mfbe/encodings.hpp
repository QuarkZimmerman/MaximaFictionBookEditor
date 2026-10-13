// Legacy text encodings (T040, FR-001/FR-002, research D6).
//
// Table-driven converters for the nine encodings the editor must read and write besides
// UTF-8 - windows-1251, windows-1252, ISO-8859-1/2/5/15, KOI8-R and UTF-16 (LE/BE) - with
// identical behaviour on every platform (no iconv). They are used
//   - directly: BOM detection, declared-vs-actual encoding check, Source-only decoding, and
//     encoding the serialised document on save (unmappable characters become numeric
//     character references so the file stays lossless and well-formed);
//   - by libxml2: `install_libxml_handlers()` plugs them in as custom encoding handlers of a
//     parser context, so declarations such as encoding="windows-1251" parse without iconv.
// Canonical names are lower-case IANA labels: "utf-8", "utf-16", "utf-16le", "utf-16be",
// "windows-1251", "windows-1252", "iso-8859-1", "iso-8859-2", "iso-8859-5", "iso-8859-15",
// "koi8-r".
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

struct _xmlParserCtxt;  // libxml2 (kept out of the public header)

namespace mfbe::encoding {

inline constexpr const char* kUtf8 = "utf-8";
inline constexpr const char* kUtf16 = "utf-16";  // written as UTF-16LE with a BOM

// Canonical lower-case name for a declaration label (aliases: cp1251, win-1251, windows1251,
// koi8r, latin1, iso8859-1, iso_8859-5, utf8, utf-16le, ucs-2 ...). nullopt when unknown.
std::optional<std::string> normalize_name(std::string_view label);

// Every canonical name the converters support (including the UTF-16 variants).
const std::vector<std::string>& supported_names();
bool is_supported(std::string_view canonical_name);

struct DecodeResult {
    std::string utf8;
    std::size_t replacements = 0;  // U+FFFD inserted for undefined bytes / invalid sequences
};

// Decodes `bytes` (in `encoding`) to UTF-8. A leading BOM matching the encoding is removed.
// For "utf-8" invalid sequences count as replacements (the output is always valid UTF-8).
// Throws std::invalid_argument for an unsupported encoding.
DecodeResult decode_to_utf8(std::string_view bytes, std::string_view encoding);

struct EncodeResult {
    std::string bytes;
    std::size_t unmappable = 0;  // characters that had no code in the target encoding
};

// Encodes UTF-8 text into `encoding`. Unmappable characters become "&#xHHHH;" when
// `char_refs` is true (XML text/attribute safe), otherwise '?'. UTF-16 output is little
// endian with a BOM. Throws std::invalid_argument for an unsupported encoding.
EncodeResult encode_from_utf8(std::string_view utf8, std::string_view encoding,
                              bool char_refs = true);

// True when `encoding` can represent the code point.
bool can_encode(std::string_view encoding, char32_t code_point);

struct Bom {
    std::string encoding;    // "" when there is no BOM
    std::size_t length = 0;  // bytes to skip
};
Bom detect_bom(std::string_view bytes);

// The encoding named by the XML declaration at the start of `bytes` (8-bit or UTF-16 forms
// are both recognised); "" when there is no declaration or no encoding attribute.
std::string declared_encoding(std::string_view bytes);

struct Detection {
    std::string declared;  // canonical declared encoding ("" = none)
    std::string detected;  // encoding to decode with (canonical, always supported)
    bool bom = false;
    bool mismatch = false;  // detected differs from what the file claims
    std::string reason;     // "bom" | "invalid-bytes" | "utf8-bytes" | "unsupported" | ""
};

// Decides how to decode a file: BOM first, then the declaration, verified against a sample
// of the bytes. When the declared encoding cannot decode the sample cleanly (or is unknown)
// the first candidate that can is chosen (utf-8, windows-1251, koi8-r, windows-1252,
// iso-8859-1) and `mismatch` is set so the caller can emit warning `encoding.mismatch`.
Detection detect_encoding(std::string_view bytes, std::size_t sample_bytes = 256 * 1024);

// Registers the table converters with a libxml2 parser context (xmlCtxtSetCharEncConvImpl).
// libxml2 keeps using its built-in UTF-8/UTF-16/ISO-8859-x converters; ours answer for the
// labels it does not know (windows-1251, KOI8-R, their aliases) with the same tables.
void install_libxml_handlers(_xmlParserCtxt* ctxt);

}  // namespace mfbe::encoding
