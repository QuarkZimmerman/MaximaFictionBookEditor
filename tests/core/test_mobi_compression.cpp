// Tests for PalmDOC LZ77, HuffCDIC, trailing entries, and bomb limits (T005, contracts/mobi-file.md §3).
#include "mobi/compression.hpp"
#include "mobi/palmdb.hpp"

#include <catch2/catch_test_macros.hpp>
#include <mfbe/mobi.hpp>

#include <cstdint>
#include <string>
#include <vector>

using namespace mfbe::mobi;

namespace {

std::string encode_9bit_symbols(const std::vector<std::uint16_t>& syms) {
    std::uint32_t bits = 0;
    int nbits = 0;
    std::string out;
    for (std::uint16_t sym : syms) {
        const std::uint32_t code9 = 511U - sym;
        bits = (bits << 9) | code9;
        nbits += 9;
        while (nbits >= 8) {
            nbits -= 8;
            out.push_back(static_cast<char>((bits >> nbits) & 0xFFU));
        }
    }
    if (nbits > 0) {
        out.push_back(static_cast<char>((bits << (8 - nbits)) & 0xFFU));
    }
    return out;
}

std::pair<std::string, std::string> make_test_huff_cdic(bool recursive_loop, bool bomb) {
    // Fixed 9-bit Huffman table1 + table2
    std::string huff = "HUFF";
    append_u32_be(huff, 24);
    append_u32_be(huff, 24);
    append_u32_be(huff, 24 + 256 * 4);
    append_u32_be(huff, 0);
    append_u32_be(huff, 0);
    for (int i = 0; i < 256; ++i) {
        append_u32_be(huff, 9);  // term=0, codelen=9
    }
    for (int L = 1; L <= 32; ++L) {
        if (L == 9) {
            append_u32_be(huff, 0);
            append_u32_be(huff, 511);
        } else {
            append_u32_be(huff, 0xFFFFFFFFU);
            append_u32_be(huff, 0);
        }
    }

    // 512 CDIC entries
    std::vector<std::pair<bool, std::string>> entries;
    for (int b = 0; b < 256; ++b) {
        entries.emplace_back(true, std::string(1, static_cast<char>(b)));
    }
    if (recursive_loop) {
        entries.emplace_back(false, encode_9bit_symbols({256}));
    } else if (bomb) {
        for (int lvl = 0; lvl < 21; ++lvl) {
            const std::uint16_t nxt =
                (lvl < 20) ? static_cast<std::uint16_t>(256 + lvl + 1) : static_cast<std::uint16_t>('A');
            entries.emplace_back(false, encode_9bit_symbols({nxt, nxt}));
        }
    } else {
        // Non-terminal symbol 256 -> "Chapter"
        std::vector<std::uint16_t> word = {'C', 'h', 'a', 'p', 't', 'e', 'r'};
        entries.emplace_back(false, encode_9bit_symbols(word));
    }
    while (entries.size() < 512) {
        entries.emplace_back(true, " ");
    }

    const std::size_t data_start = entries.size() * 2;
    std::string offsets;
    std::string blob;
    for (const auto& [term, payload] : entries) {
        append_u16_be(offsets, static_cast<std::uint16_t>(data_start + blob.size()));
        const std::uint16_t hdr =
            static_cast<std::uint16_t>(payload.size()) | (term ? 0x8000U : 0x0000U);
        append_u16_be(blob, hdr);
        blob.append(payload);
    }

    std::string cdic = "CDIC";
    append_u32_be(cdic, 16);
    append_u32_be(cdic, static_cast<std::uint32_t>(entries.size()));
    append_u32_be(cdic, 9);
    cdic.append(offsets);
    cdic.append(blob);
    return {huff, cdic};
}

}  // namespace

TEST_CASE("PalmDOC LZ77 compresses prose to <= 80% and round-trips UTF-8 losslessly",
          "[mobi][compression]") {
    std::string prose;
    for (int i = 0; i < 40; ++i) {
        prose += "<p>The quick brown fox jumps over the lazy dog in the quiet valley. "
                 "Привет, мир! Український текст із діакритикою — «цитата».</p>\n";
    }
    const std::vector<std::string> chunks = split_utf8_chunks(prose, 4096);
    REQUIRE(chunks.size() >= 2);
    for (const auto& ch : chunks) {
        CHECK(ch.size() <= 4096);
    }

    std::size_t compressed_total = 0;
    std::string reconstructed;
    for (const auto& ch : chunks) {
        const std::string comp = palmdoc_compress(ch);
        compressed_total += comp.size();
        const std::string decomp = palmdoc_decompress(comp, 65536);
        CHECK(decomp == ch);
        reconstructed += decomp;
    }
    CHECK(reconstructed == prose);

    // SC-001 requirement: compressed-to-uncompressed prose ratio <= 80%
    const double ratio =
        static_cast<double>(compressed_total) / static_cast<double>(prose.size());
    CHECK(ratio <= 0.80);
}

TEST_CASE("PalmDOC decompress rejects invalid back-references", "[mobi][compression]") {
    // 0x80 0x00 -> distance = 0, invalid
    try {
        (void)palmdoc_decompress(std::string("\x80\x00", 2), 4096);
        FAIL("expected MobiError");
    } catch (const MobiError& e) {
        CHECK(e.reason == "damaged");
    }

    // Distance > output.size()
    try {
        (void)palmdoc_decompress(std::string("A\x80\x10", 3), 4096);
        FAIL("expected MobiError");
    } catch (const MobiError& e) {
        CHECK(e.reason == "damaged");
    }
}

TEST_CASE("Trailing entries stripping obeys extra_data_flags bit order", "[mobi][compression]") {
    // Bit 0 (multibyte overlap) + Bit 1 (backward VWI entry)
    // Original compressed payload: "HELLO"
    // Bit 0 appended first: overlap byte 0x00 -> length 1 byte ("HELLO\x00")
    // Bit 1 appended after: 3 bytes payload + 1 byte backward VWI (0x80 | 4 = 0x84) -> total 4 bytes
    // Wait: stripped high-to-low (bit 1 then bit 0)!
    std::string rec = "HELLO";
    rec.push_back(0x00);  // bit 0: (0x00 & 3) + 1 = 1 byte
    rec.append("XYZ");    // 3 bytes of bit-1 data
    rec.push_back(static_cast<char>(0x84));  // backward VWI = 4 (includes itself)

    const std::string_view stripped = strip_trailing_entries(rec, 0x03);
    CHECK(stripped == "HELLO");

    // Bit 0 only with 2 overlap bytes: (0x02 & 3) + 1 = 3 bytes removed
    std::string rec2 = "DATA\xC3\xA9\x02";
    CHECK(strip_trailing_entries(rec2, 0x01) == "DATA");

    // Corrupt trailing length exceeding record size
    std::string bad = "A\x90";
    try {
        (void)strip_trailing_entries(bad, 0x02);
        FAIL("expected MobiError");
    } catch (const MobiError& e) {
        CHECK(e.reason == "damaged");
    }
}

TEST_CASE("HuffCDIC decodes non-terminal symbols and enforces depth <= 32 and bomb cap",
          "[mobi][compression]") {
    SECTION("Valid HuffCDIC with non-terminal recursive symbol") {
        const auto [huff, cdic] = make_test_huff_cdic(false, false);
        const std::vector<std::string_view> huff_recs = {huff, cdic};
        const HuffCdicDecoder decoder = HuffCdicDecoder::parse(huff_recs);

        const std::string stream = encode_9bit_symbols({256, ' ', '1', '!'});
        const std::vector<std::string_view> text_recs = {stream};
        const std::string out = decompress_text_records(17480, text_recs, 0, 10, &decoder);
        CHECK(out == "Chapter 1!");
    }

    SECTION("Infinite CDIC recursion stopped at depth <= 32") {
        const auto [huff, cdic] = make_test_huff_cdic(true, false);
        const HuffCdicDecoder decoder = HuffCdicDecoder::parse({huff, cdic});
        const std::string stream = encode_9bit_symbols({256});
        try {
            (void)decompress_text_records(17480, {stream}, 0, 100, &decoder);
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK(e.reason == "damaged");
        }
    }

    SECTION("Exponential HuffCDIC decompression bomb refused with decompressBomb") {
        const auto [huff, cdic] = make_test_huff_cdic(false, true);
        const HuffCdicDecoder decoder = HuffCdicDecoder::parse({huff, cdic});
        const std::string stream = encode_9bit_symbols({256, 256});
        try {
            (void)decompress_text_records(17480, {stream}, 0, 4 * 1024 * 1024, &decoder);
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK(e.reason == "decompressBomb");
        }
    }
}
