// The corpus sample lists of the core's corpus tests (label "corpus"): every
// tests/corpus/sample-*.txt that tests/corpus/sample.py writes (git-ignored), one path per line,
// '#' starting a comment. Only FB2 books and descriptors are taken from them: feature 012's EPUB
// sample (`sample.py --ext epub`) lies beside them and belongs to the EPUB gate
// (tests/corpus/epub-import.py).
#pragma once

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace mfbe::corpus {

// The sample lists, sorted by name.
inline std::vector<std::filesystem::path> sample_lists() {
    std::vector<std::filesystem::path> out;
    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(MFBE_TEST_CORPUS_DIR, ec)) {
        const std::string name = entry.path().filename().string();
        if (entry.is_regular_file() && name.rfind("sample-", 0) == 0 &&
            entry.path().extension() == ".txt") {
            out.push_back(entry.path());
        }
    }
    std::sort(out.begin(), out.end());
    return out;
}

// Whether a listed path is an FB2 book or descriptor (.fb2, .fbd; any case).
inline bool is_fb2_book(const std::string& path) {
    std::string ext = std::filesystem::path(path).extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return ext == ".fb2" || ext == ".fbd";
}

// The FB2 books of one list, in its order.
inline std::vector<std::string> fb2_books(const std::filesystem::path& list) {
    std::vector<std::string> paths;
    std::ifstream in(list);
    std::string line;
    while (std::getline(in, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) {
            line.pop_back();
        }
        if (!line.empty() && line[0] != '#' && is_fb2_book(line)) {
            paths.push_back(line);
        }
    }
    return paths;
}

}  // namespace mfbe::corpus
