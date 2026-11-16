// Feature 016 (D19, DP-8; tasks T045): each page's kind as the generated fixtures expect it - text,
// a picture with a text layer, a picture showing text without one, a picture without text, a blank
// page.
#include "pdf/import/reader_process.hpp"

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>

using namespace std::chrono_literals;
using nlohmann::json;

namespace {

const std::filesystem::path kFixtures =
    std::filesystem::path(MFBE_TEST_FIXTURES_DIR) / "pdf" / "import";

std::vector<std::string> kinds_of(const std::string& name) {
    const auto folder = std::filesystem::temp_directory_path() / ("mfbe-kinds-" + name);
    std::filesystem::remove_all(folder);
    std::filesystem::create_directories(folder);
    mfbe::pdf_import::ReaderOptions o;
    o.reader = mfbe::pdf_import::find_reader();
    o.pdf = kFixtures / (name + ".pdf");
    o.folder = folder;
    std::string error;
    auto reader = mfbe::pdf_import::ReaderProcess::start(o, error);
    REQUIRE(reader);
    std::vector<std::string> kinds;
    std::string line;
    while (reader->next_event(line, 60s)) {
        const json e = json::parse(line);
        if (e.value("event", "") == "page")
            kinds.push_back(e.value("kind", ""));
        if (e.value("event", "") == "done" || e.value("event", "") == "failed")
            break;
    }
    return kinds;
}

std::vector<std::string> expected(const std::string& name) {
    const json e = json::parse(std::ifstream(kFixtures / (name + ".expected.json")));
    return e["kinds"].get<std::vector<std::string>>();
}

}  // namespace

TEST_CASE("the reader tells each page's kind (D19)", "[pdf][import]") {
    for (const char* name :
         {"text-untagged", "scan-invisible", "picture-of-text", "pictures-only"}) {
        INFO(name);
        CHECK(kinds_of(name) == expected(name));
    }
}
