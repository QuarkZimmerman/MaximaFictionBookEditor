// Feature 016 (PD2, DP-2 to DP-4; tasks T008): a crash, a hang or a runaway of mfbe-pdf-reader ends
// only the reader; the core goes on, and no child process is left.
#include "pdf/import/reader_process.hpp"

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <string>

using namespace std::chrono_literals;
using mfbe::pdf_import::ReaderEnd;
using mfbe::pdf_import::ReaderOptions;
using mfbe::pdf_import::ReaderProcess;

namespace {

ReaderOptions options(const char* test_switch) {
    ReaderOptions o;
    o.reader = mfbe::pdf_import::find_reader();
    o.pdf = std::filesystem::temp_directory_path() / "mfbe-reader-test.pdf";
    o.folder = std::filesystem::temp_directory_path();
    o.extra_args = {test_switch};
    return o;
}

ReaderEnd run_to_end(ReaderProcess& reader, std::chrono::seconds limit) {
    const auto until = std::chrono::steady_clock::now() + limit;
    std::string line;
    while (std::chrono::steady_clock::now() < until) {
        reader.next_event(line, 200ms);
        if (reader.end() != ReaderEnd::running) {
            return reader.end();
        }
    }
    return reader.end();
}

}  // namespace

TEST_CASE("the PDF reader is found next to the build's executables", "[pdf][import]") {
    REQUIRE_FALSE(mfbe::pdf_import::find_reader().empty());
}

TEST_CASE("a crashing PDF reader ends only itself", "[pdf][import]") {
    std::string error;
    auto reader = ReaderProcess::start(options("--test-crash"), error);
    REQUIRE(reader);
    CHECK(run_to_end(*reader, 20s) == ReaderEnd::crashed);
}

TEST_CASE("a PDF reader that stops reporting is ended by the watchdog", "[pdf][import]") {
    auto o = options("--test-hang");
    o.silence_timeout = 800ms;
    std::string error;
    auto reader = ReaderProcess::start(o, error);
    REQUIRE(reader);
    CHECK(run_to_end(*reader, 20s) == ReaderEnd::timed_out);
}

TEST_CASE("a PDF reader above its memory cap is ended", "[pdf][import]") {
    auto o = options("--test-alloc");
    o.max_memory_mb = 256;
    std::string error;
    auto reader = ReaderProcess::start(o, error);
    REQUIRE(reader);
    const ReaderEnd end = run_to_end(*reader, 60s);
    // Linux refuses the allocation (RLIMIT_AS: the reader aborts), macOS and Windows end it from
    // outside.
    CHECK((end == ReaderEnd::over_memory || end == ReaderEnd::crashed));
}

TEST_CASE("Cancel ends the PDF reader at once", "[pdf][import]") {
    std::string error;
    auto reader = ReaderProcess::start(options("--test-hang"), error);
    REQUIRE(reader);
    std::string line;
    REQUIRE(reader->next_event(line, 10s));
    reader->kill();
    CHECK(reader->end() == ReaderEnd::killed);
    reader->kill();  // a second end changes nothing
    CHECK(reader->end() == ReaderEnd::killed);
}
