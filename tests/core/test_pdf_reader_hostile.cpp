// Feature 016 (User Story 5; D27, DP-3, SC-009; tasks T053): the generated hostile PDFs -
// truncated, broken cross-references, a page tree that loops, a decompression bomb, 100,000 pages
// claimed, a 50,000 x 50,000 picture, deep bookmarks with scripts and actions - each ends within
// the limits, with a book's model or a reason, and the reader writes nothing outside its folder.
#include "pdf/import/reader_process.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <set>
#include <string>

using namespace std::chrono_literals;
using nlohmann::json;

namespace {

const std::filesystem::path kHostile =
    std::filesystem::path(MFBE_TEST_FIXTURES_DIR) / "pdf" / "import" / "hostile";

std::set<std::string> names_in(const std::filesystem::path& folder) {
    std::set<std::string> out;
    for (const auto& entry : std::filesystem::directory_iterator(folder)) {
        out.insert(entry.path().filename().string());
    }
    return out;
}

}  // namespace

TEST_CASE("hostile PDFs end within the limits, with a model or a reason (SC-009)",
          "[pdf][import]") {
    const auto parent = std::filesystem::temp_directory_path() / "mfbe-hostile";
    std::filesystem::remove_all(parent);
    const std::set<std::string> fixtures_before = names_in(kHostile);
    for (const auto& entry : std::filesystem::directory_iterator(kHostile)) {
        if (entry.path().extension() != ".pdf") {
            continue;
        }
        const std::string name = entry.path().stem().string();
        INFO(name);
        const json expected = json::parse(std::ifstream(kHostile / (name + ".expected.json")));
        const auto folder = parent / name;
        std::filesystem::create_directories(folder);
        mfbe::pdf_import::ReaderOptions o;
        o.reader = mfbe::pdf_import::find_reader();
        o.pdf = entry.path();
        o.folder = folder;
        // The limits of DP-3, the watchdog shortened for the test: a page that gives nothing for 5
        // s ends it.
        o.max_memory_mb = 1024;
        o.silence_timeout = 5s;
        std::string error;
        auto reader = mfbe::pdf_import::ReaderProcess::start(o, error);
        REQUIRE(reader);
        const auto started = std::chrono::steady_clock::now();
        json last;
        std::string line;
        while (reader->next_event(line, 10s) ||
               reader->end() == mfbe::pdf_import::ReaderEnd::running) {
            if (line.empty()) {
                continue;
            }
            const json e = json::parse(line, nullptr, false);
            line.clear();
            if (e.is_object() &&
                (e.value("event", "") == "done" || e.value("event", "") == "failed")) {
                last = e;
                break;
            }
        }
        CHECK(std::chrono::steady_clock::now() - started < 60s);
        std::string reason = last.is_object() ? last.value("reason", "") : "";
        if (!last.is_object()) {
            // Ended by the limits: the core's reasons for them.
            const auto end = reader->end();
            reason = end == mfbe::pdf_import::ReaderEnd::timed_out     ? "timeout"
                     : end == mfbe::pdf_import::ReaderEnd::over_memory ? "memory"
                                                                       : "crashed";
        }
        if (last.is_object() && last.value("event", "") == "done") {
            CHECK((expected.contains("kinds") || expected.value("mayRead", false)));
        } else {
            const auto allowed = expected.value("reasonAny", std::vector<std::string>{});
            INFO("reason " << reason);
            CHECK(std::find(allowed.begin(), allowed.end(), reason) != allowed.end());
        }
        reader.reset();
        // Nothing outside its folder: the folder holds only the reader's own files.
        for (const auto& written : std::filesystem::recursive_directory_iterator(folder)) {
            const std::string file = written.path().filename().string();
            const bool own = file == "document.json" || file.rfind("page-", 0) == 0 ||
                             file == "pictures" ||
                             written.path().parent_path().filename() == "pictures";
            CHECK(own);
        }
    }
    CHECK(names_in(parent).size() == 7);
    CHECK(names_in(kHostile) == fixtures_before);
    std::filesystem::remove_all(parent);
}
