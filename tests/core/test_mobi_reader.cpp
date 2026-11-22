// Catch2 tests for clean-room MOBI 7, joint MOBI 7 + KF8, KF8, and PalmDOC reader (T024).
#include "mobi/mobi_reader.hpp"
#include "mobi/mobi_writer.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/images.hpp>
#include <mfbe/mobi.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>

namespace {

namespace fs = std::filesystem;
using namespace mfbe::mobi;

std::string make_test_png(int w = 4, int h = 4) {
    mfbe::images::Bitmap bmp;
    bmp.width = w;
    bmp.height = h;
    bmp.rgba.assign(static_cast<std::size_t>(w * h * 4), 200);
    return mfbe::images::encode_png(bmp);
}

std::string make_test_jpeg(int w = 16, int h = 24) {
    mfbe::images::Bitmap bmp;
    bmp.width = w;
    bmp.height = h;
    bmp.rgba.assign(static_cast<std::size_t>(w * h * 4), 128);
    return mfbe::images::encode_jpeg(bmp, 85);
}

fs::path generate_fixtures_dir() {
    static const fs::path dir = [] {
        fs::path d = fs::path(MFBE_TEST_BUILD_DIR) / "mobi-reader-fixtures";
        std::error_code ec;
        fs::remove_all(d, ec);
        fs::create_directories(d, ec);
        const fs::path script = fs::path(MFBE_TEST_FIXTURES_DIR) / "mobi" / "make-fixtures.py";
        const std::string args = " \"" + mfbe::platform::utf8_from_path(script) + "\" --out \"" +
                                 mfbe::platform::utf8_from_path(d) + "\" --hostile --no-oversized";
#ifdef _WIN32
        int rc = std::system(("python" + args).c_str());
        if (rc != 0) {
            rc = std::system(("python3" + args).c_str());
        }
#else
        int rc = std::system(("python3" + args).c_str());
        if (rc != 0) {
            rc = std::system(("python" + args).c_str());
        }
#endif
        REQUIRE(rc == 0);
        return d;
    }();
    return dir;
}

}  // namespace

TEST_CASE("MobiReader reads MOBI 7 uncompressed, PalmDOC, HuffCDIC, and Windows-1252", "[mobi]") {
    const fs::path dir = generate_fixtures_dir();

    SECTION("MOBI 7 uncompressed UTF-8 with cover, thumbnail, inline picture, and NCX") {
        const auto res = read_mobi_file(dir / "mobi7-uncompressed.mobi");
        CHECK(res.container_kind == ContainerKind::mobi7);
        CHECK(res.active_part == "mobi7");
        CHECK_FALSE(res.fell_back_to_mobi7);
        CHECK(res.encoding == "utf-8");
        CHECK(res.metadata.title == "Uncompressed Sample");
        REQUIRE(res.metadata.authors.size() == 1);
        CHECK(res.metadata.authors[0] == "Jane Author");
        CHECK(res.pictures.size() == 3);
        CHECK(res.cover_index == 1U);
        CHECK(res.thumbnail_index == 2U);
        CHECK(res.navigation.size() == 2);
        CHECK(res.navigation[0].label == "Chapter One");
        CHECK(res.navigation[1].label == "Chapter Two");
        CHECK_FALSE(res.navigation[0].anchor_id.empty());
        CHECK(res.html_bytes.find("<hr class=\"mfbe-pagebreak\"/>") != std::string::npos);
        CHECK(res.html_bytes.find("Chapter One") != std::string::npos);
        CHECK(res.mfbe_status == MfbeStatus::none);
    }

    SECTION("MOBI 7 PalmDOC compressed UTF-8") {
        const auto res = read_mobi_file(dir / "mobi7-palmdoc.mobi");
        CHECK(res.container_kind == ContainerKind::mobi7);
        CHECK(res.active_part == "mobi7");
        CHECK(res.html_bytes.find("quick brown fox") != std::string::npos);
    }

    SECTION("MOBI 7 HuffCDIC compressed UTF-8") {
        const auto res = read_mobi_file(dir / "mobi7-huffcdic.mobi");
        CHECK(res.container_kind == ContainerKind::mobi7);
        CHECK(res.active_part == "mobi7");
        CHECK(res.html_bytes.find("Chapter") != std::string::npos);
    }

    SECTION("MOBI 7 Windows-1252 decodes accented characters to UTF-8") {
        const auto res = read_mobi_file(dir / "mobi7-cp1252.mobi");
        CHECK(res.container_kind == ContainerKind::mobi7);
        CHECK(res.encoding == "windows-1252");
        CHECK(res.html_bytes.find("Caf\xC3\xA9") != std::string::npos);           // Café in UTF-8
        CHECK(res.html_bytes.find("r\xC3\xA9sum\xC3\xA9") != std::string::npos);  // résumé
        CHECK(res.html_bytes.find("\xE2\x82\xAC"
                                  "12") != std::string::npos);  // €12
    }
}

TEST_CASE("MobiReader reads joint MOBI 7 + KF8, falls back on damaged KF8, reads KF8 & PalmDOC",
          "[mobi]") {
    const fs::path dir = generate_fixtures_dir();

    SECTION("Healthy joint prefers KF8 with shared pictures") {
        const auto res = read_mobi_file(dir / "joint-valid.mobi");
        CHECK(res.container_kind == ContainerKind::joint);
        CHECK(res.active_part == "kf8");
        CHECK_FALSE(res.fell_back_to_mobi7);
        CHECK_FALSE(res.css_flows.empty());
        CHECK_FALSE(res.pictures.empty());
        CHECK(res.cover_index == 1U);
    }

    SECTION("Damaged KF8 half in joint file automatically falls back to MOBI 7") {
        const auto res = read_mobi_file(dir / "joint-damaged-kf8.mobi");
        CHECK(res.container_kind == ContainerKind::joint);
        CHECK(res.active_part == "mobi7");
        CHECK(res.fell_back_to_mobi7);
        CHECK_FALSE(res.html_bytes.empty());
    }

    SECTION("KF8-only .azw3 with CSS, SVG, MathML") {
        const auto res = read_mobi_file(dir / "kf8-rich.azw3");
        CHECK(res.container_kind == ContainerKind::kf8);
        CHECK(res.active_part == "kf8");
        CHECK_FALSE(res.css_flows.empty());
        CHECK(res.html_bytes.find("<svg") != std::string::npos);
        CHECK(res.html_bytes.find("<math") != std::string::npos);
    }

    SECTION("Plain PalmDOC .prc") {
        const auto res = read_mobi_file(dir / "palmdoc-plain.prc");
        CHECK(res.container_kind == ContainerKind::palmdoc);
        CHECK(res.active_part == "palmdoc");
        CHECK_FALSE(res.html_bytes.empty());
    }
}

TEST_CASE("MobiReader refuses encrypted/DRM, KFX, FB2, bombs, and hostile fixtures", "[mobi]") {
    const fs::path dir = generate_fixtures_dir();

    auto expect_refused = [&](const char* filename, const std::string& expected_reason) {
        try {
            (void)read_mobi_file(dir / filename);
            FAIL("Expected refusal for " << filename);
        } catch (const MobiError& e) {
            INFO("file=" << filename << " reason=" << e.reason << " detail=" << e.detail);
            if (!expected_reason.empty()) {
                CHECK(e.reason == expected_reason);
            }
        }
    };

    expect_refused("drm-encrypted.mobi", "encrypted");
    expect_refused("drm-encrypted.azw3", "encrypted");
    expect_refused("kfx-book.kfx", "kfx");
    expect_refused("kfx-renamed.mobi", "kfx");
    expect_refused("fb2-renamed.mobi", "fictionBook");
    expect_refused("hostile-truncated-header.mobi", "");
    expect_refused("hostile-oob-offset.mobi", "");
    expect_refused("hostile-too-many-records.mobi", "");
    expect_refused("hostile-huff-loop.mobi", "");
    expect_refused("hostile-decomp-bomb.mobi", "decompressBomb");
    expect_refused("hostile-random.mobi", "notMobi");

    // Hostile > 100 MP picture is flagged as too_large without allocating pixel memory.
    const auto huge_pic = read_mobi_file(dir / "hostile-huge-image.mobi");
    bool saw_too_large = false;
    for (const auto& p : huge_pic.pictures) {
        if (p.too_large)
            saw_too_large = true;
    }
    CHECK(saw_too_large);
}

TEST_CASE("MobiWriter -> MobiReader round-trip verifies MFBE EXTH 59901 across all 3 formats",
          "[mobi]") {
    const fs::path tmp = fs::path(MFBE_TEST_BUILD_DIR) / "mobi-rt-core";
    std::error_code ec;
    fs::remove_all(tmp, ec);
    fs::create_directories(tmp, ec);

    const std::string cover_jpg = make_test_jpeg(200, 300);
    const std::string fig_png = make_test_png(32, 32);
    mfbe::images::ConversionPolicy policy;

    for (const auto fmt :
         {MobiExportFormat::mobi7, MobiExportFormat::joint, MobiExportFormat::kf8}) {
        const fs::path target = tmp / ("book-" + format_to_string(fmt) +
                                       (fmt == MobiExportFormat::kf8 ? ".azw3" : ".mobi"));
        MobiWriter writer(target, fmt, false);
        const auto p1 = writer.add_picture(cover_jpg, policy, true);
        const auto p3 = writer.add_picture(fig_png, policy, false);
        REQUIRE(p1.recindex == 1U);
        REQUIRE(p3.recindex == 3U);

        writer.set_mobi7_html(
            "<html><head><title>RT</title></head><body>"
            "<div id=\"fb2-main-start\"><h2 id=\"ch1\">Chapter 1</h2>"
            "<p>See <a filepos=\"0000000000\" data-target=\"n1\">[1]</a></p>"
            "<p><img recindex=\"00003\"/></p></div>"
            "<mbp:pagebreak/><div id=\"fb2-notes\"><p id=\"n1\">Note text</p></div>"
            "</body></html>");
        writer.set_kf8_html(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>RT</title>"
            "<link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head>"
            "<body aid=\"0\"><div id=\"fb2-main-start\"><h2 id=\"ch1\">Chapter 1</h2>"
            "<p>See <a href=\"#n1\" data-kf8-target=\"n1\">[1]</a></p>"
            "<p><img src=\"kindle:embed:0003?mime=image/png\"/></p></div>"
            "<div id=\"fb2-notes\"><aside id=\"n1\">Note text</aside></div>"
            "</body></html>");
        writer.set_kf8_css("p { margin: 0; }");
        writer.set_mfbe_json(nlohmann::json{
            {"v", 1},
            {"description", {{"titleInfo", {{"bookTitle", "RT"}}}}},
            {"stylesheets", nlohmann::json::array()},
            {"binaries", {{"0001", "cover.jpg"}, {"0003", "fig.png"}}},
            {"attrs", nlohmann::json::object()},
        });

        MobiCommitInput in;
        in.metadata.title = "RT";
        in.metadata.authors = {"Test Author"};
        in.metadata.language = "en";
        in.metadata.identifier = "urn:uuid:1234";
        in.metadata.open_at_anchor_id = "fb2-main-start";
        in.nav = {{"Chapter 1", "ch1", 0, 0, 0, -1, -1, -1, 0, 0}};
        in.guide = {{"text", "Text", "fb2-main-start", 0, 0, 0}};

        const auto wres = writer.commit(in);
        REQUIRE(wres.mfbe_skipped == false);

        const auto rres = read_mobi_file(target);
        INFO("format=" << format_to_string(fmt));
        CHECK(rres.mfbe_status == MfbeStatus::valid);
        CHECK(rres.mfbe_html_matches);
        CHECK(rres.mfbe_meta_matches);
        CHECK(rres.cover_index == 1U);
        CHECK(rres.thumbnail_index == 2U);
        CHECK(rres.pictures.size() == 3);
        // Patched link resolves back to #n1!
        CHECK(rres.html_bytes.find("href=\"#n1\"") != std::string::npos);
        CHECK(rres.navigation.size() == 1);
        CHECK(rres.navigation[0].label == "Chapter 1");
        CHECK(rres.navigation[0].anchor_id == "ch1");
    }
}
