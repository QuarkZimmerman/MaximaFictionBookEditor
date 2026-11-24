// Feature 016 (User Story 6; D20, FR-060; tasks T061): ready for a later OCR. The reader's render
// switch draws every page of a scanned PDF as a picture, with the editor's own PDF library; no OCR
// library comes with the editor - none among its third-party libraries (vcpkg.json, the one list of
// them) or their notices.
#include "pdf/import/reader_process.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <cctype>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

using namespace std::chrono_literals;
using nlohmann::json;

namespace {

const std::filesystem::path kFixtures = std::filesystem::path(MFBE_TEST_FIXTURES_DIR);

std::string lower_file(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::stringstream text;
    text << in.rdbuf();
    std::string s = text.str();
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}

}  // namespace

TEST_CASE("the reader draws every page of a scan as a picture (D20)", "[pdf][import]") {
    const auto folder = std::filesystem::temp_directory_path() / "mfbe-render";
    std::filesystem::remove_all(folder);
    std::filesystem::create_directories(folder);
    for (int n = 1; n <= 4; ++n) {
        INFO("page " << n);
        mfbe::pdf_import::ReaderOptions o;
        o.reader = mfbe::pdf_import::find_reader();
        o.pdf = kFixtures / "pdf" / "import" / "scan-invisible.pdf";
        o.folder = folder / ("page-" + std::to_string(n) + ".png");
        o.extra_args = {"--render", std::to_string(n), "--dpi", "72"};
        std::string error;
        auto reader = mfbe::pdf_import::ReaderProcess::start(o, error);
        REQUIRE(reader);
        std::string line;
        REQUIRE(reader->next_event(line, 60s));
        const json e = json::parse(line);
        CHECK(e["event"] == "rendered");
        // An A5 page at 72 dpi: 420 x 595 pixels.
        CHECK(e["width"] == 420);
        CHECK(e["height"] == 595);
        std::ifstream png(o.folder, std::ios::binary);
        char signature[8] = {};
        png.read(signature, 8);
        CHECK(std::string(signature, 8) == std::string("\x89PNG\r\n\x1a\n", 8));
    }
    std::filesystem::remove_all(folder);
}

TEST_CASE("only offline Tesseract and Leptonica OCR libraries are linked exclusively into the PDF reader",
          "[pdf][import][ocr]") {
    const auto repo = kFixtures.parent_path().parent_path();
    for (const auto& file : {repo / "vcpkg.json", repo / "THIRD-PARTY-NOTICES.md"}) {
        INFO(file.string());
        const std::string text = lower_file(file);
        REQUIRE_FALSE(text.empty());
        CHECK(text.find("tesseract") != std::string::npos);
        CHECK(text.find("leptonica") != std::string::npos);
        for (const char* name :
             {"ocrad", "gocr", "cuneiform", "paddleocr", "easyocr", "rapidocr", "ocrmypdf"}) {
            INFO(name);
            CHECK(text.find(name) == std::string::npos);
        }
    }

    // OCR stays isolated inside mfbe-pdf-reader; mfbe_core / mfbe-core never link Tesseract.
    const std::string core_cmake = lower_file(repo / "core" / "CMakeLists.txt");
    REQUIRE_FALSE(core_cmake.empty());
    const auto reader_pos = core_cmake.find("add_executable(mfbe-pdf-reader");
    REQUIRE(reader_pos != std::string::npos);
    const std::string before_reader = core_cmake.substr(0, reader_pos);
    const std::string after_reader = core_cmake.substr(reader_pos);
    CHECK(before_reader.find("tesseract::libtesseract") == std::string::npos);
    CHECK(after_reader.find("tesseract::libtesseract") != std::string::npos);
}
