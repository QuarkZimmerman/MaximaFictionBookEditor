// Corpus round-trip gate as a CTest (label "corpus", T038/T046, Constitution IV).
//
// Reads every tests/corpus/sample-*.txt (written by tests/corpus/sample.py; git-ignored) and
// round-trips each listed book in-process: open -> save unchanged -> re-open -> structural
// comparison -> validate. Requirements: nothing crashes, every book that opens is structurally
// identical after the round trip, and malformed books report line/column instead of failing
// silently. Validation failures of real-world books are expected and only reported.
// Skips (passes) when no sample file exists so the default `ctest` run stays hermetic.
#include <mfbe/roundtrip.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

namespace fs = std::filesystem;

std::vector<fs::path> sample_files() {
    std::vector<fs::path> out;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(MFBE_TEST_CORPUS_DIR, ec)) {
        const std::string name = entry.path().filename().string();
        if (entry.is_regular_file() && name.rfind("sample-", 0) == 0 &&
            entry.path().extension() == ".txt") {
            out.push_back(entry.path());
        }
    }
    std::sort(out.begin(), out.end());
    return out;
}

std::vector<std::string> read_list(const fs::path& file) {
    std::vector<std::string> paths;
    std::ifstream in(file);
    std::string line;
    while (std::getline(in, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) {
            line.pop_back();
        }
        if (!line.empty() && line[0] != '#') {
            paths.push_back(line);
        }
    }
    return paths;
}

}  // namespace

TEST_CASE("corpus: every sampled book round-trips structurally identical", "[corpus]") {
    const auto samples = sample_files();
    if (samples.empty()) {
        WARN("no tests/corpus/sample-*.txt found - run tests/corpus/sample.py first; skipping");
        SUCCEED();
        return;
    }
    const fs::path out_root = fs::temp_directory_path() / "mfbe-corpus-roundtrip";
    std::error_code ec;
    fs::remove_all(out_root, ec);
    std::size_t total = 0;
    std::size_t opened = 0;
    std::size_t identical = 0;
    std::size_t valid = 0;
    std::size_t non_jpeg_png = 0;
    std::vector<std::string> not_opened;
    std::vector<std::string> invalid;
    const auto started = std::chrono::steady_clock::now();
    for (const auto& sample : samples) {
        const auto books = read_list(sample);
        for (std::size_t i = 0; i < books.size(); ++i) {
            const std::string& path = books[i];
            if (!fs::exists(path, ec)) {
                WARN("missing corpus file (library not mounted?): " << path);
                continue;
            }
            ++total;
            INFO(path);
            const roundtrip::Report report = roundtrip::run(path, out_root / std::to_string(total));
            if (!report.opened) {
                // Malformed books must be reported with a location, never crash.
                CHECK(report.failure.has_value());
                not_opened.push_back(path + ": " + report.failure.value_or("?"));
                continue;
            }
            ++opened;
            CHECK(report.reopened);
            for (const auto& d : report.comparison.differences) {
                FAIL_CHECK(path << " " << d.where << ": " << d.what);
            }
            if (report.identical) {
                ++identical;
            }
            if (report.valid) {
                ++valid;
            } else {
                std::string first;
                for (const auto& issue : report.validation.issues) {
                    if (issue.severity == model::Severity::error) {
                        auto it = issue.params.find("message");
                        first = it != issue.params.end() && it->second.is_string()
                                    ? it->second.get<std::string>()
                                    : issue.code;
                        break;
                    }
                }
                invalid.push_back(fs::path(path).filename().string() + ": " + first.substr(0, 120));
            }
            non_jpeg_png += report.non_jpeg_png_ids.size();
        }
    }
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - started)
                        .count();
    std::printf(
        "corpus: %zu books, %zu opened, %zu identical, %zu valid, %zu not opened, %zu invalid, "
        "%zu image binaries not JPEG/PNG, %lld ms\n",
        total, opened, identical, valid, not_opened.size(), invalid.size(), non_jpeg_png,
        static_cast<long long>(ms));
    for (const auto& line : not_opened) {
        std::printf("  not opened: %s\n", line.c_str());
    }
    for (const auto& line : invalid) {
        std::printf("  invalid: %s\n", line.c_str());
    }
    CHECK(identical == opened);
    fs::remove_all(out_root, ec);
}
