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

/// What the reader says of a fixture: each page's kind, and its last event (done or failed).
struct Read {
    std::vector<std::string> kinds;
    json last;
};

Read read_fixture(const std::string& name) {
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
    Read read;
    std::string line;
    while (reader->next_event(line, 60s)) {
        const json e = json::parse(line);
        const std::string event = e.value("event", "");
        if (event == "page") {
            read.kinds.push_back(e.value("kind", ""));
        }
        if (event == "done" || event == "failed") {
            read.last = e;
            break;
        }
    }
    reader.reset();
    std::filesystem::remove_all(folder);
    return read;
}

json expected(const std::string& name) {
    return json::parse(std::ifstream(kFixtures / (name + ".expected.json")));
}

}  // namespace

TEST_CASE("the reader tells each page's kind (D19)", "[pdf][import]") {
    for (const char* name : {"text-untagged", "tagged", "scan-invisible", "scan-under",
                             "picture-of-text", "pictures-only", "garbled", "picture-formats"}) {
        INFO(name);
        CHECK(read_fixture(name).kinds == expected(name)["kinds"].get<std::vector<std::string>>());
    }
}

TEST_CASE("the reader refuses what holds no clean text, saying how many pages (D19, FR-032)",
          "[pdf][import]") {
    for (const char* name : {"picture-of-text", "pictures-only", "garbled"}) {
        INFO(name);
        const json want = expected(name);
        const Read read = read_fixture(name);
        CHECK(read.last.value("event", "") == "failed");
        CHECK(read.last.value("reason", "") == want.value("reason", ""));
        CHECK(read.last.value("pages", -1) == want.value("pages", -2));
    }
}

TEST_CASE("the reader measures how readable a text layer is (DP-9)", "[pdf][import]") {
    // Readable layers - a PDF made from text, a tagged one, the scans' layers - read as words.
    for (const char* name : {"text-untagged", "tagged", "scan-invisible", "scan-under"}) {
        INFO(name);
        const Read read = read_fixture(name);
        REQUIRE(read.last.value("event", "") == "done");
        CHECK(read.last.value("garbledShare", 0.0) >= 0.9);
    }
}
