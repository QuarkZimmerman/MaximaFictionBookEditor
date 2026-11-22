// Tests for EXTH TLV, LCIDs, store-marker omission, and MFBE EXTH 59901 (T007, contracts/mobi-file.md §5).
#include "mobi/exth.hpp"
#include "mobi/palmdb.hpp"

#include <catch2/catch_test_macros.hpp>
#include <mfbe/mobi.hpp>

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

using namespace mfbe::mobi;
using json = nlohmann::json;

TEST_CASE("EXTH TLV round-trip and 4-byte padding", "[mobi][exth]") {
    std::vector<ExthEntry> entries = {
        {100, "Author One"},
        {100, "Author Two"},
        {503, "Book Title"},
        {524, "uk"},
        {201, encode_u32_be(0)},
    };
    const std::string raw = serialize_exth(entries);
    REQUIRE(raw.size() >= 12);
    REQUIRE(raw.size() % 4 == 0);
    CHECK(raw.substr(0, 4) == "EXTH");

    std::size_t consumed = 0;
    const auto parsed = parse_exth(raw, &consumed);
    CHECK(consumed == raw.size());
    REQUIRE(parsed.size() == 5);
    CHECK(parsed[0].type == 100);
    CHECK(parsed[0].data == "Author One");
    CHECK(parsed[1].data == "Author Two");
    CHECK(parsed[3].type == 524);
    CHECK(parsed[3].data == "uk");
    CHECK(parsed[4].type == 201);
}

TEST_CASE("LCID mapping returns 0 unset for missing or invalid language", "[mobi][exth]") {
    CHECK(lcid_from_bcp47("en") == 0x0409U);
    CHECK(lcid_from_bcp47("en-GB") == 0x0809U);
    CHECK(lcid_from_bcp47("ru") == 0x0419U);
    CHECK(lcid_from_bcp47("uk") == 0x0422U);
    CHECK(lcid_from_bcp47("de") == 0x0407U);
    CHECK(lcid_from_bcp47("fr") == 0x040CU);
    CHECK(lcid_from_bcp47("") == 0U);
    CHECK(lcid_from_bcp47("und") == 0U);
    CHECK(lcid_from_bcp47("invalid-xyz") == 0U);

    CHECK(bcp47_from_lcid(0x0409U) == "en");
    CHECK(bcp47_from_lcid(0x0419U) == "ru");
    CHECK(bcp47_from_lcid(0x0422U) == "uk");
    CHECK(bcp47_from_lcid(0U).empty());
}

TEST_CASE("Standard export EXTH omits store-only 113 and 501 and omits 524 when language missing",
          "[mobi][exth]") {
    MobiMetadata meta;
    meta.title = "Shelf Title";
    meta.authors = {"Jane Doe"};
    meta.publisher = "Pub";
    meta.description = "Summary";
    meta.isbn = "978-0-00-000000-0";
    meta.subjects = {"sf_space"};
    meta.date = "2026";
    meta.language = "";  // missing -> EXTH 524 must be omitted
    meta.identifier = "mfbe-id-123";

    const auto entries = build_export_exth(meta, /*cover_offset=*/0, /*thumb_offset=*/1,
                                           /*open_at_offset=*/std::nullopt,
                                           /*kf8_boundary_rec=*/std::nullopt,
                                           /*resource_count=*/std::nullopt,
                                           /*is_kf8=*/false,
                                           /*mfbe_payload=*/std::nullopt);
    for (const auto& e : entries) {
        CHECK(e.type != 113U);  // ASIN omitted (spec D5)
        CHECK(e.type != 501U);  // CDE type omitted (spec D5)
        CHECK(e.type != 524U);  // language omitted when empty (spec D4)
    }

    // With valid language -> EXTH 524 present
    meta.language = "ru";
    const auto entries_ru = build_export_exth(meta, std::nullopt, std::nullopt, std::nullopt,
                                              std::nullopt, std::nullopt, false, std::nullopt);
    bool found_524 = false;
    for (const auto& e : entries_ru) {
        if (e.type == 524U) {
            found_524 = true;
            CHECK(e.data == "ru");
        }
    }
    CHECK(found_524);
}

TEST_CASE("MFBE EXTH 59901 envelope, 48 KB cap, and independent HTML/meta SHA-256 verification",
          "[mobi][exth][mfbe]") {
    MobiMetadata meta;
    meta.title = "Original Title";
    meta.authors = {"Author A"};
    meta.language = "en";
    meta.subjects = {"prose"};
    meta.identifier = "id-1";

    const std::string html = "<html><body><h1>Original Title</h1><p>Hello world.</p></body></html>";
    json record = {
        {"v", 1},
        {"description", {{"titleInfo", {{"bookTitle", "Original Title"}}}}},
        {"stylesheets", json::array({{{"type", "text/css"}, {"text", "p { color: #111; }"}}})},
        {"binaries", {{"0001", "cover.jpg"}}},
        {"attrs", {{"b0", {{"name", ""}}}}},
    };

    const auto encoded = encode_mfbe_record(record, html, meta);
    REQUIRE(encoded.has_value());
    CHECK(encoded->size() <= kMaxMfbeCompressedBytes);
    CHECK(encoded->substr(0, 4) == "MFBE");
    CHECK(static_cast<unsigned char>((*encoded)[4]) == 1U);

    SECTION("Untouched file verifies valid with both digests matching") {
        const auto res = decode_and_verify_mfbe(*encoded, html, meta);
        CHECK(res.status == MfbeStatus::valid);
        CHECK(res.html_matches);
        CHECK(res.meta_matches);
        CHECK(res.json["binaries"]["0001"] == "cover.jpg");
    }

    SECTION("External metadata-only edit preserves mfbeHtmlMatches == true and flags meta mismatch") {
        MobiMetadata edited_meta = meta;
        edited_meta.title = "Renamed by ebook-meta";
        const auto res = decode_and_verify_mfbe(*encoded, html, edited_meta);
        CHECK(res.status == MfbeStatus::externally_modified);
        CHECK(res.html_matches);
        CHECK_FALSE(res.meta_matches);
        CHECK(res.json.is_object());
    }

    SECTION("External HTML-only edit preserves mfbeMetaMatches == true and flags html mismatch") {
        const std::string edited_html = html + "<!-- edited -->";
        const auto res = decode_and_verify_mfbe(*encoded, edited_html, meta);
        CHECK(res.status == MfbeStatus::externally_modified);
        CHECK_FALSE(res.html_matches);
        CHECK(res.meta_matches);
        CHECK(res.json.is_object());
    }

    SECTION("Corrupt envelope falls back to corrupt") {
        std::string broken = *encoded;
        broken[10] ^= 0xFF;
        const auto res = decode_and_verify_mfbe(broken, html, meta);
        CHECK(res.status == MfbeStatus::corrupt);
        CHECK_FALSE(res.html_matches);
        CHECK_FALSE(res.meta_matches);
    }

    SECTION("Oversized incompressible payload exceeding 48 KB returns nullopt") {
        json huge = record;
        std::string noise;
        noise.reserve(120000);
        std::uint32_t state = 0x12345678U;
        for (int i = 0; i < 120000; ++i) {
            state = state * 1664525U + 1013904223U;
            noise.push_back(static_cast<char>('!' + ((state >> 24) % 90)));
        }
        huge["description"]["noise"] = noise;
        const auto skipped = encode_mfbe_record(huge, html, meta);
        CHECK_FALSE(skipped.has_value());
    }
}
