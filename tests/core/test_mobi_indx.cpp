// Tests for INDX/TAGX/IDXT/CNCX and KF8 FDST/SKEL/FRAG/GUIDE (T007, contracts/mobi-file.md §6).
#include "mobi/indx.hpp"

#include <catch2/catch_test_macros.hpp>
#include <mfbe/mobi.hpp>

#include <string>
#include <string_view>
#include <vector>

using namespace mfbe::mobi;

TEST_CASE("MOBI 7 NCX INDX/TAGX/CNCX round-trips hierarchical entries", "[mobi][indx]") {
    std::vector<MobiNavEntry> entries = {
        {"Part I", "s1", 0, 120, 480, -1, 1, 2, 0, 0},
        {"Chapter 1", "s1_1", 1, 200, 150, 0, -1, -1, 0, 0},
        {"Chapter 2 — «Юникод»", "s1_2", 1, 350, 250, 0, -1, -1, 0, 0},
    };
    const std::vector<std::string> recs = build_mobi7_ncx(entries);
    REQUIRE(recs.size() >= 3);  // meta + entry + cncx
    CHECK(recs[0].substr(0, 4) == "INDX");
    CHECK(recs[1].substr(0, 4) == "INDX");

    std::vector<std::string_view> views(recs.begin(), recs.end());
    const auto parsed = parse_ncx_indx(views, 0);
    REQUIRE(parsed.size() == 3);
    CHECK(parsed[0].label == "Part I");
    CHECK(parsed[0].offset == 120);
    CHECK(parsed[0].length == 480);
    CHECK(parsed[0].depth == 0);
    CHECK(parsed[2].label == "Chapter 2 — «Юникод»");
    CHECK(parsed[2].offset == 350);
    CHECK(parsed[2].depth == 1);
}

TEST_CASE("KF8 NCX, FDST, SKEL, FRAG, and GUIDE round-trip", "[mobi][indx][kf8]") {
    SECTION("FDST flow partitioning") {
        const std::string fdst = build_fdst({{0, 1024}, {1024, 1500}});
        CHECK(fdst.substr(0, 4) == "FDST");
        const auto flows = parse_fdst(fdst, 1500);
        REQUIRE(flows.size() == 2);
        CHECK(flows[0] == std::pair<std::uint32_t, std::uint32_t>{0, 1024});
        CHECK(flows[1] == std::pair<std::uint32_t, std::uint32_t>{1024, 1500});
    }

    SECTION("KF8 NCX with parent/child and pos_fid") {
        std::vector<MobiNavEntry> nav = {
            {"Book", "a0", 0, 50, 500, -1, 1, 1, 0, 50},
            {"Section 1", "a1", 1, 120, 200, 0, -1, -1, 1, 10},
        };
        const auto recs = build_kf8_ncx(nav);
        std::vector<std::string_view> views(recs.begin(), recs.end());
        const auto parsed = parse_ncx_indx(views, 0);
        REQUIRE(parsed.size() == 2);
        CHECK(parsed[0].label == "Book");
        CHECK(parsed[1].label == "Section 1");
        CHECK(parsed[1].depth == 1);
        CHECK(parsed[1].fid == 1);
        CHECK(parsed[1].fid_offset == 10);
    }

    SECTION("KF8 SKEL and FRAG round-trip") {
        std::vector<SkelEntry> skels = {
            {"SKEL0000000000", 2, 0, 100},
        };
        std::vector<FragEntry> frags = {
            {"0000000000", "aid=\"s1\"", 0, 50, 100, 40},
            {"0000000001", "aid=\"s2\"", 0, 50, 140, 60},
        };
        auto skel_recs = build_kf8_skel(skels);
        auto frag_recs = build_kf8_frag(frags);

        std::vector<std::string> all = skel_recs;
        const std::size_t frag_start = all.size();
        all.insert(all.end(), frag_recs.begin(), frag_recs.end());
        std::vector<std::string_view> views(all.begin(), all.end());

        const auto parsed = parse_kf8_skel_frag(views, 0, frag_start);
        REQUIRE(parsed.skels.size() == 1);
        CHECK(parsed.skels[0].chunk_count == 2);
        CHECK(parsed.skels[0].start_pos == 0);
        CHECK(parsed.skels[0].length == 100);
        REQUIRE(parsed.frags.size() == 2);
        CHECK(parsed.frags[0].skeleton_index == 0);
        CHECK(parsed.frags[0].insert_pos == 50);
        CHECK(parsed.frags[0].start_pos == 100);
        CHECK(parsed.frags[0].length == 40);
        CHECK(parsed.frags[1].start_pos == 140);
        CHECK(parsed.frags[1].length == 60);
    }

    SECTION("KF8 GUIDE landmarks round-trip") {
        std::vector<MobiGuideEntry> guides = {
            {"cover", "Cover", "cover-id", 0, 0, 0},
            {"toc", "Contents", "toc-id", 300, 1, 20},
            {"text", "Start", "text-id", 600, 2, 0},
        };
        const auto recs = build_kf8_guide(guides);
        std::vector<std::string_view> views(recs.begin(), recs.end());
        const auto parsed = parse_kf8_guide(views, 0);
        REQUIRE(parsed.size() == 3);
        CHECK(parsed[0].type == "cover");
        CHECK(parsed[1].type == "toc");
        CHECK(parsed[1].title == "Contents");
        CHECK(parsed[1].fid == 1);
        CHECK(parsed[1].fid_offset == 20);
        CHECK(parsed[2].type == "text");
    }
}
