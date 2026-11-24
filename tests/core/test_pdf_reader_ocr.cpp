// Feature 020 (T022, US1): end-to-end Catch2 tests for mfbe-pdf-reader OCR execution
// (image-only EN/RU/DE/UK scans, rotated 90/180/270 scans, garbled-layer rescue, best-effort
// ocrFallback preservation vs zero-usable-text refusals, copy-protection, and cancellation).
#include "pdf/import/session.hpp"
#include "test_support.hpp"

#include <mfbe/ocr.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace mfbe;
using namespace mfbe::pdf_import;
using json = nlohmann::json;

namespace {

std::filesystem::path ocr_fixture(const std::string& name) {
    return std::filesystem::path(MFBE_TEST_FIXTURES_DIR) / "pdf" / "ocr" / name;
}

std::filesystem::path bundled_ocr_dir() {
    return std::filesystem::path(MFBE_RESOURCES_SOURCE_DIR) / "ocr";
}

std::filesystem::path bundled_fonts_dir() {
    return std::filesystem::path(MFBE_RESOURCES_SOURCE_DIR) / "fonts";
}

ReaderOcrOptions make_ocr(std::vector<std::string> langs, bool auto_detect = true, int threads = 2) {
    ReaderOcrOptions o;
    o.enabled = true;
    o.auto_detect = auto_detect;
    o.languages = std::move(langs);
    o.dirs = {bundled_ocr_dir()};
    o.threads = threads;
    return o;
}

std::string collect_all_words(const std::filesystem::path& folder, int pages) {
    std::string out;
    for (int n = 1; n <= pages; ++n) {
        std::ifstream in(folder / ("page-" + std::to_string(n) + ".json"));
        const json page = json::parse(in, nullptr, false);
        if (!page.is_object() || !page.contains("words")) {
            continue;
        }
        for (const auto& w : page["words"]) {
            if (!out.empty()) {
                out.push_back(' ');
            }
            out += w.value("t", "");
        }
    }
    return out;
}

}  // namespace

TEST_CASE("pdf reader ocr: 10-page EN and RU scans with contradictory scanner metadata",
          "[ocr][pdf-reader][020]") {
    REQUIRE_FALSE(find_reader().empty());

    SECTION("scan-en-10p.pdf") {
        test::TempDir work;
        Session session(work.path() / "en", ocr_fixture("scan-en-10p.pdf"), 85, bundled_fonts_dir());
        const json opened = session.inspect(make_ocr({"eng", "rus"}));
        REQUIRE(opened.value("opened", false));
        REQUIRE(opened.value("pages", 0) == 10);

        json result;
        int ocr_events = 0;
        const std::string err = session.read(
            [&](const std::string& phase, int done, int) {
                if (phase == "ocr" && done > 0) {
                    ++ocr_events;
                }
                return true;
            },
            result);
        REQUIRE(err.empty());
        CHECK(ocr_events == 10);
        REQUIRE(result.contains("ocr"));
        CHECK(result["ocr"]["used"] == true);
        CHECK(result["ocr"]["pagesRecognized"] == 10);
        CHECK(result["ocr"]["primaryLang"] == "en");

        const std::string text = collect_all_words(work.path() / "en", 10);
        for (const char* word : {"lantern", "breakwater", "chestnuts", "observatory", "locomotive",
                                 "midnight"}) {
            INFO("expecting word: " << word);
            CHECK(text.find(word) != std::string::npos);
        }
    }

    SECTION("scan-ru-10p.pdf") {
        test::TempDir work;
        Session session(work.path() / "ru", ocr_fixture("scan-ru-10p.pdf"), 85, bundled_fonts_dir());
        const json opened = session.inspect(make_ocr({"eng", "rus"}));
        REQUIRE(opened.value("opened", false));
        REQUIRE(opened.value("pages", 0) == 10);

        json result;
        const std::string err =
            session.read([](const std::string&, int, int) { return true; }, result);
        REQUIRE(err.empty());
        REQUIRE(result.contains("ocr"));
        CHECK(result["ocr"]["used"] == true);
        CHECK(result["ocr"]["pagesRecognized"] == 10);
        CHECK(result["ocr"]["primaryLang"] == "ru");

        const std::string text = collect_all_words(work.path() / "ru", 10);
        for (const char* word :
             {"смотритель", "пекарне", "обсерватории", "телескопа", "паровоз", "полуночных"}) {
            INFO("expecting word: " << word);
            CHECK(text.find(word) != std::string::npos);
        }
    }
}

TEST_CASE("pdf reader ocr: German, Ukrainian, rotated 90/180/270, and garbled-layer rescue",
          "[ocr][pdf-reader][020]") {
    REQUIRE_FALSE(find_reader().empty());

    SECTION("scan-de.pdf with eng,rus,deu enabled") {
        test::TempDir work;
        Session session(work.path() / "de", ocr_fixture("scan-de.pdf"), 85, bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng", "rus", "deu"})).value("opened", false));
        json result;
        REQUIRE(session.read([](const std::string&, int, int) { return true; }, result).empty());
        CHECK(result["ocr"]["primaryLang"] == "de");
        const std::string text = collect_all_words(work.path() / "de", 2);
        CHECK(text.find("Straße") != std::string::npos);
        CHECK(text.find("Frühling") != std::string::npos);
    }

    SECTION("scan-uk.pdf with eng,rus,ukr enabled") {
        test::TempDir work;
        Session session(work.path() / "uk", ocr_fixture("scan-uk.pdf"), 85, bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng", "rus", "ukr"})).value("opened", false));
        json result;
        REQUIRE(session.read([](const std::string&, int, int) { return true; }, result).empty());
        CHECK(result["ocr"]["primaryLang"] == "uk");
        const std::string text = collect_all_words(work.path() / "uk", 2);
        CHECK(text.find("Київ") != std::string::npos);
        CHECK(text.find("України") != std::string::npos);
    }

    SECTION("scan-rotated.pdf restores 90/180/270 upright") {
        test::TempDir work;
        Session session(work.path() / "rot", ocr_fixture("scan-rotated.pdf"), 85,
                        bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng", "rus"})).value("opened", false));
        json result;
        REQUIRE(session.read([](const std::string&, int, int) { return true; }, result).empty());
        CHECK(result["ocr"]["pagesRecognized"] == 3);
        for (int n = 1; n <= 3; ++n) {
            std::ifstream in(work.path() / "rot" / ("page-" + std::to_string(n) + ".json"));
            const json page = json::parse(in);
            CHECK(page.value("ocrUsed", false));
            CHECK(page.value("ocrRotation", 0) != 0);
            std::string pt;
            for (const auto& w : page["words"]) {
                pt += w.value("t", "") + " ";
            }
            INFO("page " << n << " text: " << pt);
            CHECK(pt.find("Navigation") != std::string::npos);
            CHECK(pt.find("lighthouse") != std::string::npos);
        }
    }

    SECTION("garbled-ru.pdf rescued with OCR and refused without OCR") {
        test::TempDir work;
        {
            Session no_ocr(work.path() / "noocr", ocr_fixture("garbled-ru.pdf"), 85,
                           bundled_fonts_dir());
            REQUIRE(no_ocr.inspect().value("opened", false));
            json r;
            CHECK(no_ocr.read([](const std::string&, int, int) { return true; }, r) == "garbled");
        }
        {
            Session with_ocr(work.path() / "withocr", ocr_fixture("garbled-ru.pdf"), 85,
                             bundled_fonts_dir());
            REQUIRE(with_ocr.inspect(make_ocr({"eng", "rus"})).value("opened", false));
            json r;
            REQUIRE(
                with_ocr.read([](const std::string&, int, int) { return true; }, r).empty());
            CHECK(r["ocr"]["primaryLang"] == "ru");
            CHECK(r["kinds"].value("garbled", 0) == 0);
            const std::string text = collect_all_words(work.path() / "withocr", 2);
            CHECK(text.find("смотритель") != std::string::npos);
            CHECK(text.find("пекарне") != std::string::npos);
        }
    }
}

TEST_CASE("pdf reader ocr: partial fallback picture, refusals, copy protection, and cancel cleanup",
          "[ocr][pdf-reader][020]") {
    REQUIRE_FALSE(find_reader().empty());

    SECTION("scan-partial-fallback.pdf keeps readable page 1 and preserves page 2 as ocrFallback") {
        test::TempDir work;
        Session session(work.path() / "partial", ocr_fixture("scan-partial-fallback.pdf"), 85,
                        bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng", "rus"})).value("opened", false));
        json r;
        REQUIRE(session.read([](const std::string&, int, int) { return true; }, r).empty());
        CHECK(r["ocr"]["pagesRecognized"] == 1);
        CHECK(r["ocr"]["fallbackPages"] == 1);

        std::ifstream p2_in(work.path() / "partial" / "page-2.json");
        const json p2 = json::parse(p2_in);
        REQUIRE(p2["pictures"].size() == 1);
        CHECK(p2["pictures"][0]["id"] == "ocr-fallback-p2");
        CHECK(p2["pictures"][0]["ocrFallback"] == true);

        // Pre-written ocr-* picture is served directly via the stdin picture loop
        const json pic = session.picture("ocr-fallback-p2", 2);
        CHECK(pic.value("event", "") == "picture");
        CHECK(pic.value("id", "") == "ocr-fallback-p2");
        CHECK(std::filesystem::is_regular_file(work.path() / "partial" / pic.value("file", "")));
    }

    SECTION("unreadable-noise.pdf refuses with ocrUnreadable") {
        test::TempDir work;
        Session session(work.path() / "noise", ocr_fixture("unreadable-noise.pdf"), 85,
                        bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng", "rus"})).value("opened", false));
        json r;
        CHECK(session.read([](const std::string&, int, int) { return true; }, r) ==
              "ocrUnreadable");
    }

    SECTION("Russian scan with only eng enabled refuses with ocrLanguageDisabled") {
        test::TempDir work;
        Session session(work.path() / "disabled", ocr_fixture("scan-ru-10p.pdf"), 85,
                        bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng"})).value("opened", false));
        json r;
        const std::string reason =
            session.read([](const std::string&, int, int) { return true; }, r);
        CHECK(reason == "ocrLanguageDisabled");
        CHECK(r.value("script", "") == "cyrillic");
        REQUIRE(r.contains("suggestedLanguages"));
        bool has_rus = false;
        for (const auto& s : r["suggestedLanguages"]) {
            if (s == "rus") {
                has_rus = true;
            }
        }
        CHECK(has_rus);
    }

    SECTION("Georgian scan with no Georgian pack installed refuses with ocrLanguageMissing") {
        test::TempDir work;
        Session session(work.path() / "missing", ocr_fixture("scan-uninstalled-script.pdf"), 85,
                        bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng", "rus"})).value("opened", false));
        json r;
        const std::string reason =
            session.read([](const std::string&, int, int) { return true; }, r);
        CHECK((reason == "ocrLanguageMissing" || reason == "ocrUnreadable"));
    }

    SECTION("copy-restricted-scan.pdf still requires owner password under OCR") {
        test::TempDir work;
        Session session(work.path() / "copy", ocr_fixture("copy-restricted-scan.pdf"), 85,
                        bundled_fonts_dir());
        const json opened = session.inspect(make_ocr({"eng", "rus"}));
        CHECK(opened.value("ownerPassword", false));
    }

    SECTION("mid-run cancel stops within 3 seconds and cleans up temp directory") {
        test::TempDir work;
        const auto dir = work.path() / "cancel";
        Session session(dir, ocr_fixture("scan-en-10p.pdf"), 85, bundled_fonts_dir());
        REQUIRE(session.inspect(make_ocr({"eng", "rus"}, true, 2)).value("opened", false));
        const auto start = std::chrono::steady_clock::now();
        json r;
        const std::string reason = session.read(
            [](const std::string& phase, int done, int) {
                return !(phase == "ocr" && done >= 1);
            },
            r);
        const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                    std::chrono::steady_clock::now() - start)
                                    .count();
        CHECK(reason == "cancelled");
        CHECK(elapsed_ms < 3000);
        CHECK_FALSE(std::filesystem::exists(dir));
    }
}
