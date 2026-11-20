// Tests for MOBI 7, joint MOBI 7 + KF8, and KF8 (.azw3) writer (T015, contracts/mobi-file.md).
#include "mobi/compression.hpp"
#include "mobi/exth.hpp"
#include "mobi/indx.hpp"
#include "mobi/mobi_writer.hpp"
#include "mobi/palmdb.hpp"

#include <catch2/catch_test_macros.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/images.hpp>
#include <mfbe/mobi.hpp>

#include <filesystem>
#include <nlohmann/json.hpp>
#include <string>
#include <string_view>
#include <vector>

using namespace mfbe;
using namespace mfbe::mobi;
using json = nlohmann::json;
namespace fs = std::filesystem;

namespace {

std::string make_sample_jpeg(int w = 240, int h = 360) {
    images::Bitmap bmp;
    bmp.width = w;
    bmp.height = h;
    bmp.rgba.resize(static_cast<std::size_t>(w) * static_cast<std::size_t>(h) * 4U);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const std::size_t idx = (static_cast<std::size_t>(y) * w + x) * 4U;
            bmp.rgba[idx + 0] = static_cast<std::uint8_t>((x * 255) / w);
            bmp.rgba[idx + 1] = static_cast<std::uint8_t>((y * 255) / h);
            bmp.rgba[idx + 2] = 128;
            bmp.rgba[idx + 3] = 255;
        }
    }
    return images::encode_jpeg(bmp, 85);
}

MobiMetadata sample_meta() {
    MobiMetadata m;
    m.title = "Sample Novel";
    m.updated_title = "Sample Novel";
    m.authors = {"Jane Author"};
    m.publisher = "Example Press";
    m.description = "A test annotation.";
    m.isbn = "978-0-12-345678-9";
    m.subjects = {"prose"};
    m.date = "2026";
    m.language = "en";
    m.identifier = "urn:uuid:11111111-2222-3333-4444-555555555555";
    m.open_at_anchor_id = "fb2-main-start";
    return m;
}

std::string sample_mobi7_html() {
    return "<html><head><title>Sample Novel</title></head><body>"
           "<div id=\"fb2-title-page\"><h1>Sample Novel</h1><p>Jane Author</p></div>"
           "<mbp:pagebreak/>"
           "<div id=\"fb2-main-start\">"
           "<div class=\"fb2-section\" id=\"ch1\"><h1>Chapter One</h1>"
           "<p>First paragraph with a link to "
           "<a filepos=\"0000000000\" data-target=\"ch2\">Chapter Two</a> and a note"
           "<sup><a id=\"ref1\" filepos=\"0000000000\" data-target=\"n1\">[1]</a></sup>.</p>"
           "<p><img recindex=\"00001\" alt=\"Cover\"/></p></div>"
           "<mbp:pagebreak/>"
           "<div class=\"fb2-section\" id=\"ch2\"><h1>Chapter Two</h1>"
           "<p>Second chapter prose repeating enough words for PalmDOC compression to work well. "
           "The quick brown fox jumps over the lazy dog again and again in the quiet valley.</p>"
           "</div><mbp:pagebreak/>"
           "<div id=\"n1\" class=\"fb2-note\"><p>Footnote text. "
           "<a filepos=\"0000000000\" data-target=\"ref1\">↩</a></p></div>"
           "</div></body></html>";
}

std::string sample_kf8_html() {
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
           "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\">"
           "<head><title>Sample Novel</title>"
           "<link rel=\"stylesheet\" type=\"text/css\" href=\"kindle:flow:0001?mime=text/css\"/>"
           "</head><body>"
           "<div id=\"fb2-cover\" class=\"fb2-cover\"><img src=\"kindle:embed:0001?mime=image/jpeg\" alt=\"Cover\"/></div>"
           "<div id=\"fb2-title-page\"><h1>Sample Novel</h1></div>"
           "<div id=\"fb2-main-start\">"
           "<section class=\"fb2-section\" id=\"ch1\"><h1>Chapter One</h1>"
           "<p>Hello <a href=\"#ch2\" data-kf8-target=\"ch2\">Chapter Two</a> "
           "<a id=\"ref1\" epub:type=\"noteref\" href=\"#n1\" data-kf8-target=\"n1\">[1]</a>.</p></section>"
           "<section class=\"fb2-section\" id=\"ch2\"><h1>Chapter Two</h1>"
           "<p>Second chapter prose for KF8 testing.</p></section>"
           "<aside id=\"n1\" class=\"fb2-note\" epub:type=\"footnote\">"
           "<p>Footnote text <a href=\"#ref1\" data-kf8-target=\"ref1\">↩</a></p></aside>"
           "</div></body></html>";
}

}  // namespace

TEST_CASE("MobiWriter assembles valid MOBI 7 with filepos patching, INDX/CNCX, EXTH 116, and MFBE",
          "[mobi][writer]") {
    const fs::path tmp = fs::temp_directory_path() / "mfbe_test_writer_mobi7.mobi";
    std::error_code ec;
    fs::remove(tmp, ec);

    MobiWriter writer(tmp, MobiExportFormat::mobi7);
    images::ConversionPolicy policy;
    const auto pic = writer.add_picture(make_sample_jpeg(), policy, /*is_cover=*/true);
    CHECK(pic.recindex == 1);
    CHECK(writer.cover_rec_index().has_value());
    CHECK(writer.thumbnail_rec_index().has_value());

    writer.set_mobi7_html(sample_mobi7_html());
    writer.set_mfbe_json(json{{"v", 1}, {"description", {{"titleInfo", {{"bookTitle", "Sample Novel"}}}}},
                              {"stylesheets", json::array()}, {"binaries", {{"0001", "cover.jpg"}}},
                              {"attrs", json::object()}});

    MobiCommitInput commit;
    commit.metadata = sample_meta();
    commit.metadata.updated_title = "3_Sample Novel";  // seriesInTitle shelf title only
    commit.nav = {
        {"Chapter One", "ch1", 0, 0, 0, -1, -1, -1, 0, 0},
        {"Chapter Two", "ch2", 0, 0, 0, -1, -1, -1, 0, 0},
    };
    commit.guide = {
        {"title-page", "Title page", "fb2-title-page", 0, 0, 0},
        {"text", "Start", "fb2-main-start", 0, 0, 0},
    };

    const MobiWriteResult res = writer.commit(commit);
    CHECK(res.bytes > 0);
    CHECK_FALSE(res.mfbe_skipped);
    REQUIRE(fs::exists(tmp));

    const std::string file_bytes = atomic_file::read_file(tmp);
    const PalmDb pdb = read_palmdb(file_bytes);
    REQUIRE(pdb.records.size() >= 6);
    const std::string& r0 = pdb.records[0];
    CHECK(read_u16_be(r0, 0) == 2U);      // PalmDOC compression
    CHECK(read_u16_be(r0, 12) == 0U);     // unencrypted
    CHECK(read_u32_be(r0, 36) == 6U);     // MOBI version 6
    CHECK(read_u32_be(r0, 28) == 65001U); // UTF-8
    CHECK(read_u32_be(r0, 92) == 0x0409U);

    // Verify EXTH records: 503 shelf title, 116 openAt, 201/202/203 cover+thumb, 59901 MFBE, NO 113/501
    const std::uint32_t hlen = read_u32_be(r0, 20);
    const auto exth = parse_exth(std::string_view(r0).substr(16 + hlen));
    bool has_116 = false;
    bool has_201 = false;
    bool has_202 = false;
    bool has_59901 = false;
    std::string exth_503;
    std::string mfbe_raw;
    for (const auto& e : exth) {
        CHECK(e.type != 113U);
        CHECK(e.type != 501U);
        if (e.type == 116U) has_116 = true;
        if (e.type == 201U) has_201 = true;
        if (e.type == 202U) has_202 = true;
        if (e.type == 503U) exth_503 = e.data;
        if (e.type == kExthMfbeType) {
            has_59901 = true;
            mfbe_raw = e.data;
        }
    }
    CHECK(has_116);
    CHECK(has_201);
    CHECK(has_202);
    CHECK(has_59901);
    CHECK(exth_503 == "3_Sample Novel");

    // Decompress text records and verify patched filepos != 0000000000 and points to id="ch2"
    const std::uint16_t text_cnt = read_u16_be(r0, 8);
    const std::uint32_t text_len = read_u32_be(r0, 4);
    const std::uint32_t extra_flags = read_u32_be(r0, 240);
    std::vector<std::string_view> trecs;
    for (std::uint16_t i = 1; i <= text_cnt; ++i) {
        trecs.push_back(pdb.records[i]);
    }
    const std::string html = decompress_text_records(2, trecs, extra_flags, text_len);
    CHECK(html.find("data-target=") == std::string::npos);
    CHECK(html.find("filepos=\"0000000000\"") == std::string::npos);
    const std::size_t ch2_pos = html.find("<div class=\"fb2-section\" id=\"ch2\"");
    REQUIRE(ch2_pos != std::string::npos);
    char expected_fp[32];
    std::snprintf(expected_fp, sizeof(expected_fp), "filepos=\"%010zu\"", ch2_pos);
    CHECK(html.find(expected_fp) != std::string::npos);

    // Native INDX/CNCX navigation must be written even though no inline TOC was present
    const std::uint32_t indx_rec = read_u32_be(r0, 244);
    REQUIRE(indx_rec != 0xFFFFFFFFU);
    std::vector<std::string_view> all_views(pdb.records.begin(), pdb.records.end());
    const auto nav = parse_ncx_indx(all_views, indx_rec);
    REQUIRE(nav.size() == 2);
    CHECK(nav[0].label == "Chapter One");
    CHECK(nav[1].label == "Chapter Two");
    CHECK(nav[1].offset == ch2_pos);

    // Verify MFBE digest passes against decompressed HTML + actual EXTH metadata
    const MobiMetadata actual_meta = metadata_from_exth(exth, "3_Sample Novel", 0x0409U);
    const auto mfbe_check = decode_and_verify_mfbe(mfbe_raw, html, actual_meta);
    CHECK(mfbe_check.status == MfbeStatus::valid);
    CHECK(mfbe_check.html_matches);
    CHECK(mfbe_check.meta_matches);

    fs::remove(tmp, ec);
}

TEST_CASE("MobiWriter assembles joint MOBI 7 + KF8 with shared pictures, BOUNDARY, and EXTH 121/125",
          "[mobi][writer][joint]") {
    const fs::path tmp = fs::temp_directory_path() / "mfbe_test_writer_joint.mobi";
    std::error_code ec;
    fs::remove(tmp, ec);

    MobiWriter writer(tmp, MobiExportFormat::joint);
    images::ConversionPolicy policy;
    (void)writer.add_picture(make_sample_jpeg(), policy, /*is_cover=*/true);
    writer.set_mobi7_html(sample_mobi7_html());
    writer.set_kf8_html(sample_kf8_html());
    writer.set_kf8_css("p { text-indent: 1.5em; }\n");
    writer.set_mfbe_json(json{{"v", 1}, {"description", {{"titleInfo", {{"bookTitle", "Sample Novel"}}}}},
                              {"stylesheets", json::array()}, {"binaries", {{"0001", "cover.jpg"}}},
                              {"attrs", json::object()}});

    MobiCommitInput commit;
    commit.metadata = sample_meta();
    commit.nav = {
        {"Chapter One", "ch1", 0, 0, 0, -1, -1, -1, 0, 0},
        {"Chapter Two", "ch2", 0, 0, 0, -1, -1, -1, 0, 0},
    };
    commit.guide = {
        {"cover", "Cover", "fb2-cover", 0, 0, 0},
        {"text", "Start", "fb2-main-start", 0, 0, 0},
    };

    const MobiWriteResult res = writer.commit(commit);
    CHECK(res.bytes > 0);
    const PalmDb pdb = read_palmdb(atomic_file::read_file(tmp));

    // Locate BOUNDARY and verify EXTH 121 points to record immediately after BOUNDARY
    const auto exth7 = parse_exth(std::string_view(pdb.records[0]).substr(16 + read_u32_be(pdb.records[0], 20)));
    std::uint32_t kf8_hdr_idx = 0;
    std::uint32_t res_count = 0;
    for (const auto& e : exth7) {
        if (e.type == 121U) kf8_hdr_idx = read_u32_be(e.data, 0);
        if (e.type == 125U) res_count = read_u32_be(e.data, 0);
    }
    REQUIRE(kf8_hdr_idx > 1);
    REQUIRE(kf8_hdr_idx < pdb.records.size());
    CHECK(pdb.records[kf8_hdr_idx - 1] == "BOUNDARY");
    CHECK(res_count == 2U);  // cover + thumbnail stored ONCE in MOBI 7 section

    // KF8 header has file_version == 8, FDST, SKEL, FRAG, GUIDE, and mirrored EXTH 59901
    const std::string& kf8_hdr = pdb.records[kf8_hdr_idx];
    CHECK(read_u32_be(kf8_hdr, 36) == 8U);
    const std::uint32_t fdst_rel = read_u32_be(kf8_hdr, 192);
    REQUIRE(kf8_hdr_idx + fdst_rel < pdb.records.size());
    CHECK(pdb.records[kf8_hdr_idx + fdst_rel].substr(0, 4) == "FDST");
    CHECK(pdb.records.back() == make_eof_record());

    fs::remove(tmp, ec);
}

TEST_CASE("MobiWriter assembles standalone KF8 (.azw3) and rejects missing HTML parts",
          "[mobi][writer][kf8]") {
    const fs::path tmp = fs::temp_directory_path() / "mfbe_test_writer_kf8.azw3";
    std::error_code ec;
    fs::remove(tmp, ec);

    // Missing KF8 HTML must fail cleanly with badPart
    {
        MobiWriter bad(tmp, MobiExportFormat::kf8);
        MobiCommitInput commit;
        commit.metadata = sample_meta();
        try {
            (void)bad.commit(commit);
            FAIL("expected MobiError");
        } catch (const MobiError& e) {
            CHECK(e.reason == "badPart");
        }
        CHECK_FALSE(fs::exists(tmp));
    }

    MobiWriter writer(tmp, MobiExportFormat::kf8);
    images::ConversionPolicy policy;
    (void)writer.add_picture(make_sample_jpeg(), policy, /*is_cover=*/true);
    writer.set_kf8_html(sample_kf8_html());
    writer.set_kf8_css("body { margin: 0; }\n");

    MobiCommitInput commit;
    commit.metadata = sample_meta();
    commit.nav = {{"Chapter One", "ch1", 0, 0, 0, -1, -1, -1, 0, 0}};
    commit.guide = {{"cover", "Cover", "fb2-cover", 0, 0, 0}};

    const MobiWriteResult res = writer.commit(commit);
    CHECK(res.bytes > 0);
    const PalmDb pdb = read_palmdb(atomic_file::read_file(tmp));
    CHECK(read_u32_be(pdb.records[0], 36) == 8U);
    CHECK(pdb.records.back() == make_eof_record());

    fs::remove(tmp, ec);
}
