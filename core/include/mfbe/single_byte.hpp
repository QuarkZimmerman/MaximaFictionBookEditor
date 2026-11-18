// Feature 017 (PD2, DP-2; specs/017-txt-export-import/contracts/encodings.md): the TXT export's
// and import's single-byte encodings - the 27 legacy single-byte encodings of the WHATWG Encoding
// Standard and the true ISO-8859-1 - from the tables generated into single_byte_tables.inc.
// Names are the Standard's in lower case ("windows-1251", "koi8-r", "ibm866", "x-mac-cyrillic").
#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::text {

// The 28 encodings in the contract's order (the Standard's 27, then "iso-8859-1").
const std::vector<std::string>& single_byte_names();

bool is_single_byte(std::string_view name);

// A character the encoding cannot write, what it became and how often (D12).
struct Replacement {
    char32_t character = 0;
    std::string as;  // its plain form, "?" for any other, "" when left out
    std::size_t count = 0;
};

struct Encoded {
    std::string bytes;
    std::vector<Replacement> replaced;  // in the order first met
};

// `utf8` in the encoding `name`: ASCII and the table's characters as they are; a character the
// table lacks takes its plain form (quotes, dashes, the ellipsis, spaces, No., (C)...), an
// invisible formatting character is left out, any other becomes "?". Soft hyphens are left out
// and not counted (D12: a text file has no hyphenation). nullopt for an unknown name.
std::optional<Encoded> encode_single_byte(std::string_view utf8, std::string_view name);

// UTF-8 output (D12): the text without its soft hyphens.
std::string utf8_without_soft_hyphens(std::string_view utf8);

// `bytes` in the encoding `name` as UTF-8, as the Standard's single-byte decoder reads them: a
// byte without a code point becomes U+FFFD, counted in `*unmapped`. nullopt for an unknown name.
std::optional<std::string> decode_single_byte(std::string_view bytes, std::string_view name,
                                              std::size_t* unmapped = nullptr);

}  // namespace mfbe::text
