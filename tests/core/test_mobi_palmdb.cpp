// Tests for PalmDB container parsing/writing and magic sniffing (T005, contracts/mobi-file.md §1).
#include "mobi/palmdb.hpp"

#include <catch2/catch_test_macros.hpp>
#include <mfbe/mobi.hpp>

#include <string>
#include <vector>

using namespace mfbe::mobi;

TEST_CASE("PalmDB header and record table round-trip", "[mobi][palmdb]") {
    PalmDb src;
    src.name = "Sample_Book";
    src.type = "BOOK";
    src.creator = "MOBI";
    src.created_at = 0xE1000001U;
    src.modified_at = 0xE1000002U;
    src.records = {std::string("REC0_HEADER_DATA"), std::string("REC1_TEXT"), std::string(),
                   std::string("\xE9\x8E\x0D\x0A", 4)};

    const std::string raw = write_palmdb(src);
    REQUIRE(raw.size() >= 78 + 8 * 4 + 2);
    REQUIRE(sniff_bytes(raw).kind == ContainerKind::mobi7);

    const PalmDb parsed = read_palmdb(raw);
    CHECK(parsed.name == "Sample_Book");
    CHECK(parsed.type == "BOOK");
    CHECK(parsed.creator == "MOBI");
    CHECK(parsed.created_at == src.created_at);
    CHECK(parsed.modified_at == src.modified_at);
    REQUIRE(parsed.records.size() == 4);
    CHECK(parsed.records[0] == src.records[0]);
    CHECK(parsed.records[1] == src.records[1]);
    CHECK(parsed.records[2].empty());  // zero-length record tolerated
    CHECK(parsed.records[3] == src.records[3]);
}

TEST_CASE("PalmDB magic sniffing distinguishes BOOK/MOBI, TEXt/REAd, KFX, and FB2",
          "[mobi][palmdb]") {
    // Plain PalmDOC
    PalmDb prc;
    prc.name = "PlainDoc";
    prc.type = "TEXt";
    prc.creator = "REAd";
    prc.records = {std::string(16, '\0'), std::string("Hello PalmDOC")};
    const std::string prc_raw = write_palmdb(prc);
    CHECK(sniff_bytes(prc_raw).kind == ContainerKind::palmdoc);
    CHECK(read_palmdb(prc_raw).type == "TEXt");

    // KFX DRMION signature
    const std::string kfx1 = std::string("\xEA" "DRMION\x00\x01\x02\x03", 11) + std::string(64, '\0');
    CHECK(sniff_bytes(kfx1).kind == ContainerKind::kfx);
    try {
        (void)read_palmdb(kfx1);
        FAIL("expected MobiError");
    } catch (const MobiError& e) {
        CHECK(e.reason == "kfx");
    }

    // KFX CONT signature
    const std::string kfx2 = std::string("CONT\x00\x00\x00\x00", 8) + std::string(70, '\0');
    CHECK(sniff_bytes(kfx2).kind == ContainerKind::kfx);

    // FB2 / FBD XML chosen via All files
    const std::string fb2 =
        "<?xml version=\"1.0\"?><FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\">"
        "<description/></FictionBook>";
    CHECK(sniff_bytes(fb2).kind == ContainerKind::fictionBook);
    try {
        (void)read_palmdb(fb2);
        FAIL("expected MobiError");
    } catch (const MobiError& e) {
        CHECK(e.reason == "fictionBook");
    }

    // Random non-MOBI bytes
    const std::string junk(128, 'Z');
    CHECK(sniff_bytes(junk).kind == ContainerKind::unknown);
    try {
        (void)read_palmdb(junk);
        FAIL("expected MobiError");
    } catch (const MobiError& e) {
        CHECK(e.reason == "notMobi");
    }

    // Extension helper
    CHECK(is_mobi_extension("book.mobi"));
    CHECK(is_mobi_extension("/path/BOOK.AZW3"));
    CHECK(is_mobi_extension("a.Azw"));
    CHECK(is_mobi_extension("legacy.PRC"));
    CHECK_FALSE(is_mobi_extension("book.fb2"));
    CHECK_FALSE(is_mobi_extension("book.epub"));
    CHECK_FALSE(is_mobi_extension("book.kfx"));
}

TEST_CASE("PalmDB reader enforces hostile bounds and offset invariants", "[mobi][palmdb]") {
    SECTION("Truncated header") {
        try {
            (void)read_palmdb(std::string(40, '\0'));
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK(e.reason == "notMobi");
        }
    }

    SECTION("Too few records (< 2)") {
        PalmDb one;
        one.name = "OneRec";
        one.type = "BOOK";
        one.creator = "MOBI";
        one.records = {"only_one"};
        const std::string raw = write_palmdb(one);
        try {
            (void)read_palmdb(raw);
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK(e.reason == "damaged");
        }
    }

    SECTION("Out-of-bounds record offset") {
        PalmDb ok;
        ok.name = "OOB";
        ok.type = "BOOK";
        ok.creator = "MOBI";
        ok.records = {"aaaa", "bbbb"};
        std::string raw = write_palmdb(ok);
        // Overwrite record 1 offset (at byte 78 + 8) with 0x0FFFFFF0
        raw[86] = 0x0F;
        raw[87] = static_cast<char>(0xFF);
        raw[88] = static_cast<char>(0xFF);
        raw[89] = static_cast<char>(0xF0);
        try {
            (void)read_palmdb(raw);
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK(e.reason == "damaged");
        }
    }

    SECTION("Decreasing record offset rejected") {
        PalmDb ok;
        ok.name = "Dec";
        ok.type = "BOOK";
        ok.creator = "MOBI";
        ok.records = {"aaaa", "bbbb", "cccc"};
        std::string raw = write_palmdb(ok);
        // Set record 2 offset smaller than record 1 offset
        raw[78 + 16] = raw[78];
        raw[78 + 17] = raw[79];
        raw[78 + 18] = raw[80];
        raw[78 + 19] = raw[81];
        try {
            (void)read_palmdb(raw);
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK(e.reason == "damaged");
        }
    }

    SECTION("Declared 65535 records inside tiny file fails cleanly") {
        std::string raw(94, '\0');
        raw.replace(60, 4, "BOOK");
        raw.replace(64, 4, "MOBI");
        raw[76] = static_cast<char>(0xFF);
        raw[77] = static_cast<char>(0xFF);
        try {
            (void)read_palmdb(raw);
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK((e.reason == "damaged" || e.reason == "tooManyRecords"));
        }
    }
}
