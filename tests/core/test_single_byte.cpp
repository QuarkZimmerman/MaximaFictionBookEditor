// Feature 017 (T008; DP-2, D12; specs/017-txt-export-import/contracts/encodings.md): the TXT
// encodings' tables equal the WHATWG index files they were generated from, decode and encode back,
// and the characters an encoding lacks take their plain forms.

#include <mfbe/single_byte.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

namespace {

const std::filesystem::path kIndexDir =
    std::filesystem::path(MFBE_TEST_FIXTURES_DIR).parent_path().parent_path() / "third_party" /
    "whatwg-encoding";

// The index file's code points of the bytes 0x80-0xFF (0 where none).
std::vector<char32_t> index_file(const std::string& name) {
    std::ifstream in(kIndexDir / ("index-" + name + ".txt"), std::ios::binary);
    std::stringstream buffer;
    buffer << in.rdbuf();
    std::vector<char32_t> high(128, 0);
    std::string text = buffer.str();
    std::size_t start = 0;
    while (start < text.size()) {
        std::size_t end = text.find('\n', start);
        if (end == std::string::npos) end = text.size();
        const std::string line = text.substr(start, end - start);
        start = end + 1;
        if (line.empty() || line[0] == '#') continue;
        const std::size_t tab = line.find('\t');
        const int pointer = std::stoi(line.substr(0, tab));
        const std::size_t tab2 = line.find('\t', tab + 1);
        high[static_cast<std::size_t>(pointer)] =
            static_cast<char32_t>(std::stoul(line.substr(tab + 1, tab2 - tab - 1), nullptr, 16));
    }
    return high;
}

std::string utf8(char32_t cp) {
    std::string out;
    if (cp < 0x80) out.push_back(static_cast<char>(cp));
    else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
    return out;
}

}  // namespace

TEST_CASE("single-byte: 28 encodings in the contract's order", "[single_byte]") {
    const auto& names = mfbe::text::single_byte_names();
    REQUIRE(names.size() == 28);
    CHECK(names.front() == "ibm866");
    CHECK(names[18] == "windows-1251");
    CHECK(names.back() == "iso-8859-1");
    CHECK(mfbe::text::is_single_byte("koi8-u"));
    CHECK_FALSE(mfbe::text::is_single_byte("utf-8"));
    CHECK_FALSE(mfbe::text::encode_single_byte("x", "shift_jis").has_value());
}

TEST_CASE("single-byte: every table equals its index file and round-trips", "[single_byte]") {
    for (const std::string& name : mfbe::text::single_byte_names()) {
        INFO(name);
        std::vector<char32_t> high(128, 0);
        if (name == "iso-8859-1") {
            for (std::size_t k = 0; k < 128; ++k) high[k] = static_cast<char32_t>(0x80 + k);
        } else {
            high = index_file(name);
        }
        for (std::size_t k = 0; k < 128; ++k) {
            const std::string byte(1, static_cast<char>(0x80 + k));
            std::size_t unmapped = 0;
            const auto decoded = mfbe::text::decode_single_byte(byte, name, &unmapped);
            REQUIRE(decoded.has_value());
            if (high[k] == 0) {
                CHECK(unmapped == 1);
                CHECK(*decoded == "\xEF\xBF\xBD");
                continue;
            }
            CHECK(unmapped == 0);
            CHECK(*decoded == utf8(high[k]));
            if (high[k] == 0xAD) continue;  // a soft hyphen is left out by design
            const auto encoded = mfbe::text::encode_single_byte(*decoded, name);
            REQUIRE(encoded.has_value());
            CHECK(encoded->bytes == byte);
            CHECK(encoded->replaced.empty());
        }
        const auto ascii = mfbe::text::encode_single_byte("Plain ASCII\r\n", name);
        CHECK(ascii->bytes == "Plain ASCII\r\n");
    }
}

TEST_CASE("single-byte: plain forms, left-out and unknown characters (D12)", "[single_byte]") {
    // KOI8-R has none of these typographic characters.
    const auto koi = mfbe::text::encode_single_byte(
        "\xC2\xAB\xD0\x94\xC2\xBB \xE2\x80\x94 \xE2\x80\x93 \xE2\x80\xA6 \xE2\x84\x96 x\xE2\x80\x8By "
        "\xC2\xADz \xE4\xB8\xAD",  // «Д» — – … № x<ZWSP>y <SHY>z 中
        "koi8-r");
    REQUIRE(koi.has_value());
    CHECK(koi->bytes == "\"\xE4\" - - ... No. xy z ?");
    // « » — – … № <ZWSP> 中: eight distinct characters, in the order first met.
    REQUIRE(koi->replaced.size() == 8);
    CHECK(koi->replaced[0].character == 0x00AB);
    CHECK(koi->replaced[0].as == "\"");
    CHECK(koi->replaced[2].character == 0x2014);
    CHECK(koi->replaced[2].as == "-");
    CHECK(koi->replaced[3].character == 0x2013);
    CHECK(koi->replaced[3].as == "-");
    CHECK(koi->replaced[6].character == 0x200B);
    CHECK(koi->replaced[6].as.empty());
    CHECK(koi->replaced[7].character == 0x4E2D);
    CHECK(koi->replaced[7].as == "?");
    // windows-1251 holds the guillemets and the dashes: written as they are, nothing replaced.
    const auto win = mfbe::text::encode_single_byte("\xC2\xAB\xE2\x80\x94\xC2\xBB", "windows-1251");
    CHECK(win->bytes == "\xAB\x97\xBB");
    CHECK(win->replaced.empty());
    // UTF-8 keeps everything but its soft hyphens.
    CHECK(mfbe::text::utf8_without_soft_hyphens("pro\xC2\xADgram \xC2\xAB") == "program \xC2\xAB");
}
