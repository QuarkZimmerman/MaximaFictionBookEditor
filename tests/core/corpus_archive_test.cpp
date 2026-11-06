// Feature 009 (T022, FR-023, SC-004): the corpus sample through ZIP archives - each listed book
// is packed into a one-book archive the way a ZIP save writes it, read back through the archive
// reader byte for byte, and the book read from the archive then passes the same round trip as
// the plain file (open -> save unchanged -> re-open -> structural comparison). Label "corpus";
// skips (passes) when no tests/corpus/sample-*.txt exists, like the plain corpus case.
#include <mfbe/archive.hpp>
#include <mfbe/roundtrip.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

namespace fs = std::filesystem;

std::vector<std::string> sampled_books() {
    std::vector<fs::path> lists;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(MFBE_TEST_CORPUS_DIR, ec)) {
        const std::string name = entry.path().filename().string();
        if (entry.is_regular_file() && name.rfind("sample-", 0) == 0 &&
            entry.path().extension() == ".txt") {
            lists.push_back(entry.path());
        }
    }
    std::sort(lists.begin(), lists.end());
    std::vector<std::string> books;
    for (const auto& list : lists) {
        std::ifstream in(list);
        std::string line;
        while (std::getline(in, line)) {
            while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) {
                line.pop_back();
            }
            if (!line.empty() && line[0] != '#') {
                books.push_back(line);
            }
        }
    }
    return books;
}

std::string read_bytes(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

}  // namespace

TEST_CASE("corpus: every sampled book round-trips through a ZIP archive", "[corpus][archive]") {
    const auto books = sampled_books();
    if (books.empty()) {
        WARN("no tests/corpus/sample-*.txt found - run tests/corpus/sample.py first; skipping");
        SUCCEED();
        return;
    }
    const fs::path root = fs::temp_directory_path() / "mfbe-corpus-archive";
    std::error_code ec;
    fs::remove_all(root, ec);
    fs::create_directories(root, ec);
    std::size_t total = 0;
    std::size_t opened = 0;
    for (const std::string& path : books) {
        if (!fs::exists(path, ec)) {
            continue;
        }
        ++total;
        INFO(path);
        const std::string bytes = read_bytes(path);
        const fs::path zip = root / (std::to_string(total) + ".fb2.zip");
        {
            std::ofstream out(zip, std::ios::binary);
            out << archive::zip_one("book.fb2", bytes);
        }
        const std::string back = archive::read_entry(zip, "book.fb2");
        CHECK(back == bytes);
        const fs::path extracted = root / (std::to_string(total) + ".fb2");
        {
            std::ofstream out(extracted, std::ios::binary);
            out << back;
        }
        const roundtrip::Report report =
            roundtrip::run(extracted.string(), root / ("out-" + std::to_string(total)));
        if (!report.opened) {
            CHECK(report.failure.has_value());
            continue;
        }
        ++opened;
        CHECK(report.reopened);
        for (const auto& d : report.comparison.differences) {
            FAIL_CHECK(path << " " << d.where << ": " << d.what);
        }
        fs::remove(zip, ec);
        fs::remove(extracted, ec);
    }
    WARN("corpus through ZIP archives: " << total << " books, " << opened << " opened");
}
