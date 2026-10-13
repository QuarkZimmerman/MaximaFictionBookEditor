// T040: table converters, BOM detection, declared-vs-actual mismatch detection, base64.
#include "test_support.hpp"

#include <mfbe/base64.hpp>
#include <mfbe/encodings.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/generators/catch_generators.hpp>

using namespace mfbe;

namespace {

const std::string kCyrillic = "Съешь же ещё этих мягких французских булок, да выпей чаю. ЁёЙй";
const std::string kLatin2 = "Příliš žluťoučký kůň úpěl ďábelské ódy";
const std::string kLatin1 = "Voix ambiguë d'un cœur qui au zéphyr préfère les jattes de kiwis";

}  // namespace

TEST_CASE("encodings: names are normalised with common aliases", "[encodings]") {
    CHECK(encoding::normalize_name("UTF-8") == "utf-8");
    CHECK(encoding::normalize_name("utf8") == "utf-8");
    CHECK(encoding::normalize_name("Windows-1251") == "windows-1251");
    CHECK(encoding::normalize_name("cp1251") == "windows-1251");
    CHECK(encoding::normalize_name("win-1251") == "windows-1251");
    CHECK(encoding::normalize_name("KOI8-R") == "koi8-r");
    CHECK(encoding::normalize_name("koi8r") == "koi8-r");
    CHECK(encoding::normalize_name("latin1") == "iso-8859-1");
    CHECK(encoding::normalize_name("ISO_8859-5") == "iso-8859-5");
    CHECK(encoding::normalize_name("iso8859-15") == "iso-8859-15");
    CHECK(encoding::normalize_name("UTF-16") == "utf-16");
    CHECK(encoding::normalize_name("utf-16le") == "utf-16le");
    CHECK(encoding::normalize_name(" 'windows-1252' ") == "windows-1252");
    CHECK_FALSE(encoding::normalize_name("windows-1250").has_value());
    CHECK_FALSE(encoding::normalize_name("").has_value());
    CHECK(encoding::supported_names().size() == 11);
    CHECK(encoding::is_supported("koi8-r"));
    CHECK_FALSE(encoding::is_supported("shift_jis"));
}

TEST_CASE("encodings: Cyrillic round-trips through every Cyrillic-capable table", "[encodings]") {
    const std::string enc =
        GENERATE(std::string("windows-1251"), std::string("koi8-r"), std::string("iso-8859-5"),
                 std::string("utf-16"), std::string("utf-16le"), std::string("utf-16be"),
                 std::string("utf-8"));
    INFO(enc);
    const auto encoded = encoding::encode_from_utf8(kCyrillic, enc);
    CHECK(encoded.unmappable == 0);
    if (enc.rfind("utf-16", 0) == 0) {
        CHECK(encoded.bytes.size() >= kCyrillic.size());  // 2 bytes per BMP character
    } else if (enc != "utf-8") {
        CHECK(encoded.bytes.size() < kCyrillic.size());  // 1 byte per Cyrillic letter
    }
    const auto decoded = encoding::decode_to_utf8(encoded.bytes, enc);
    CHECK(decoded.replacements == 0);
    CHECK(decoded.utf8 == kCyrillic);
}

TEST_CASE("encodings: Latin tables round-trip their repertoire", "[encodings]") {
    CHECK(encoding::decode_to_utf8(encoding::encode_from_utf8(kLatin2, "iso-8859-2").bytes,
                                   "iso-8859-2")
              .utf8 == kLatin2);
    for (const char* enc : {"iso-8859-1", "iso-8859-15", "windows-1252"}) {
        INFO(enc);
        const auto encoded = encoding::encode_from_utf8(kLatin1, enc);
        if (std::string(enc) == "iso-8859-1") {
            CHECK(encoded.unmappable == 1);  // œ is not in Latin-1 -> character reference
            CHECK(encoded.bytes.find("&#x153;") != std::string::npos);
        } else {
            CHECK(encoded.unmappable == 0);
            CHECK(encoding::decode_to_utf8(encoded.bytes, enc).utf8 == kLatin1);
        }
    }
    // Euro sign: windows-1252 and ISO-8859-15 have it, ISO-8859-1 does not.
    CHECK(encoding::can_encode("windows-1252", U'\u20AC'));
    CHECK(encoding::can_encode("iso-8859-15", U'\u20AC'));
    CHECK_FALSE(encoding::can_encode("iso-8859-1", U'\u20AC'));
    CHECK(encoding::can_encode("windows-1251", U'\u2116'));  // numero sign
    CHECK_FALSE(encoding::can_encode("koi8-r", U'\u2116'));
}

TEST_CASE("encodings: unmappable characters become U+FFFD on input and char refs on output",
          "[encodings]") {
    // 0x98 is undefined in windows-1251.
    const auto decoded = encoding::decode_to_utf8(std::string("a\x98z", 3), "windows-1251");
    CHECK(decoded.replacements == 1);
    CHECK(decoded.utf8 == "a\xEF\xBF\xBDz");
    // Chinese cannot be written in KOI8-R: numeric character references keep the text.
    const auto encoded = encoding::encode_from_utf8("Текст 漢字", "koi8-r");
    CHECK(encoded.unmappable == 2);
    CHECK(encoded.bytes.find("&#x6F22;&#x5B57;") != std::string::npos);
    const auto question = encoding::encode_from_utf8("漢", "koi8-r", false);
    CHECK(question.bytes == "?");
    CHECK_THROWS_AS(encoding::decode_to_utf8("x", "windows-1250"), std::invalid_argument);
    // Invalid UTF-8 input is repaired, never passed through.
    const auto bad = encoding::decode_to_utf8(std::string("ok\xC3(\xFF", 5), "utf-8");
    CHECK(bad.replacements == 2);
    CHECK(bad.utf8 == "ok\xEF\xBF\xBD(\xEF\xBF\xBD");
}

TEST_CASE("encodings: BOM detection and UTF-16 handling", "[encodings]") {
    CHECK(encoding::detect_bom("\xEF\xBB\xBF<?xml").encoding == "utf-8");
    CHECK(encoding::detect_bom("\xEF\xBB\xBF<?xml").length == 3);
    CHECK(encoding::detect_bom("\xFF\xFE<\0").encoding == "utf-16le");
    CHECK(encoding::detect_bom(std::string("\xFE\xFF\0<", 4)).encoding == "utf-16be");
    CHECK(encoding::detect_bom("<?xml").encoding.empty());

    // utf-16 output = BOM + little endian; decoding honours the BOM whatever the label says.
    const auto utf16 = encoding::encode_from_utf8("Aб", "utf-16").bytes;
    REQUIRE(utf16.size() == 6);
    CHECK(static_cast<unsigned char>(utf16[0]) == 0xFF);
    CHECK(static_cast<unsigned char>(utf16[1]) == 0xFE);
    CHECK(utf16[2] == 'A');
    CHECK(encoding::decode_to_utf8(utf16, "utf-16").utf8 == "Aб");
    CHECK(encoding::decode_to_utf8(utf16, "utf-16be").utf8 == "Aб");  // BOM wins
    const auto be = encoding::encode_from_utf8("A", "utf-16be").bytes;
    CHECK(be == std::string("\0A", 2));
    // Astral characters use surrogate pairs; lone surrogates decode to U+FFFD.
    const std::string astral = "\xF0\x9F\x98\x80";  // U+1F600
    CHECK(encoding::decode_to_utf8(encoding::encode_from_utf8(astral, "utf-16le").bytes, "utf-16le")
              .utf8 == astral);
    const auto lone = encoding::decode_to_utf8(std::string("\x00\xD8"
                                                           "A\x00",
                                                           4),
                                               "utf-16le");
    CHECK(lone.replacements == 1);
    // A UTF-8 BOM is stripped when decoding UTF-8.
    CHECK(encoding::decode_to_utf8("\xEF\xBB\xBF"
                                   "abc",
                                   "utf-8")
              .utf8 == "abc");
}

TEST_CASE("encodings: declared encoding is read from 8-bit and UTF-16 declarations",
          "[encodings]") {
    CHECK(encoding::declared_encoding("<?xml version=\"1.0\" encoding=\"windows-1251\"?><a/>") ==
          "windows-1251");
    CHECK(encoding::declared_encoding("<?xml version='1.0' encoding = 'KOI8-R' ?>") == "KOI8-R");
    CHECK(encoding::declared_encoding("  <?xml version=\"1.0\"?><a/>").empty());
    CHECK(encoding::declared_encoding("<a/>").empty());
    const auto utf16 =
        encoding::encode_from_utf8("<?xml version=\"1.0\" encoding=\"UTF-16\"?><a/>", "utf-16")
            .bytes;
    CHECK(encoding::declared_encoding(utf16) == "UTF-16");
}

TEST_CASE("encodings: mismatch detection picks the encoding that decodes cleanly", "[encodings]") {
    const std::string body = "<FictionBook><p>" + kCyrillic + "</p></FictionBook>";

    SECTION("consistent declaration: no mismatch") {
        const auto bytes =
            encoding::encode_from_utf8("<?xml version=\"1.0\" encoding=\"windows-1251\"?>" + body,
                                       "windows-1251")
                .bytes;
        const auto d = encoding::detect_encoding(bytes);
        CHECK(d.declared == "windows-1251");
        CHECK(d.detected == "windows-1251");
        CHECK_FALSE(d.mismatch);
    }
    SECTION("declares utf-8 but the bytes are windows-1251") {
        const auto bytes = encoding::encode_from_utf8(
                               "<?xml version=\"1.0\" encoding=\"utf-8\"?>" + body, "windows-1251")
                               .bytes;
        const auto d = encoding::detect_encoding(bytes);
        CHECK(d.declared == "utf-8");
        CHECK(d.detected == "windows-1251");
        CHECK(d.mismatch);
        CHECK(d.reason == "invalid-bytes");
    }
    SECTION("declares windows-1251 but the bytes are UTF-8") {
        const std::string bytes = "<?xml version=\"1.0\" encoding=\"windows-1251\"?>" + body;
        const auto d = encoding::detect_encoding(bytes);
        CHECK(d.detected == "utf-8");
        CHECK(d.mismatch);
        CHECK(d.reason == "utf8-bytes");
    }
    SECTION("no declaration: UTF-8 is the default, legacy bytes fall back") {
        CHECK_FALSE(encoding::detect_encoding(body).mismatch);
        CHECK(encoding::detect_encoding(body).detected == "utf-8");
        const auto cp1251 = encoding::encode_from_utf8(body, "windows-1251").bytes;
        const auto d = encoding::detect_encoding(cp1251);
        CHECK(d.declared.empty());
        CHECK(d.detected == "windows-1251");
        CHECK(d.mismatch);
    }
    SECTION("BOM beats the declaration") {
        const auto bytes = encoding::encode_from_utf8(
                               "<?xml version=\"1.0\" encoding=\"windows-1251\"?>" + body, "utf-16")
                               .bytes;
        const auto d = encoding::detect_encoding(bytes);
        CHECK(d.bom);
        CHECK(d.detected == "utf-16le");
        CHECK(d.mismatch);
        CHECK(d.reason == "bom");
        const auto consistent = encoding::encode_from_utf8(
                                    "<?xml version=\"1.0\" encoding=\"UTF-16\"?>" + body, "utf-16")
                                    .bytes;
        CHECK_FALSE(encoding::detect_encoding(consistent).mismatch);
    }
    SECTION("unsupported declaration falls back to a candidate") {
        const auto bytes =
            encoding::encode_from_utf8("<?xml version=\"1.0\" encoding=\"x-mac-cyrillic\"?>" + body,
                                       "windows-1251")
                .bytes;
        const auto d = encoding::detect_encoding(bytes);
        CHECK(d.mismatch);
        CHECK(d.reason == "unsupported");
        CHECK(d.detected == "windows-1251");
    }
}

TEST_CASE("base64: encode, wrap, decode and streaming decode", "[encodings][base64]") {
    CHECK(base64::encode("") == "");
    CHECK(base64::encode("f") == "Zg==");
    CHECK(base64::encode("fo") == "Zm8=");
    CHECK(base64::encode("foo") == "Zm9v");
    CHECK(base64::encode("foobar") == "Zm9vYmFy");
    CHECK(base64::decode("Zm9vYmFy") == std::string("foobar"));
    CHECK(base64::decode("Zm9v\n  YmFy\r\n") == std::string("foobar"));
    CHECK(base64::decode("Zm8") == std::string("fo"));  // missing padding tolerated
    CHECK(base64::decode("Zm8=") == std::string("fo"));
    CHECK_FALSE(base64::decode("Zm9v!").has_value());
    CHECK_FALSE(base64::decode("Z").has_value());
    CHECK_FALSE(base64::decode("Zm8=Zm8=").has_value());  // data after padding
    CHECK_FALSE(base64::decode("…1234 bytes…").has_value());

    std::string bytes;
    for (int i = 0; i < 1000; ++i) {
        bytes.push_back(static_cast<char>(i * 7 % 256));
    }
    const std::string wrapped = base64::encode_wrapped(bytes, 76);
    std::size_t longest = 0;
    std::size_t pos = 0;
    while (pos <= wrapped.size()) {
        const auto nl = wrapped.find('\n', pos);
        const std::size_t len = (nl == std::string::npos ? wrapped.size() : nl) - pos;
        longest = std::max(longest, len);
        if (nl == std::string::npos) {
            break;
        }
        pos = nl + 1;
    }
    CHECK(longest == 76);
    CHECK(wrapped.back() != '\n');
    base64::Decoder decoder;
    for (std::size_t i = 0; i < wrapped.size(); i += 7) {  // chunks that split groups
        REQUIRE(decoder.feed(wrapped.substr(i, 7)));
    }
    REQUIRE(decoder.finish());
    CHECK(decoder.take() == bytes);
}
