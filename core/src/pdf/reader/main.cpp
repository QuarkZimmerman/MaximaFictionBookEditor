// Feature 016 (PD2, DP-1, contracts/pdf-reader.md): mfbe-pdf-reader, the program that reads one PDF
// for one import, apart from the editor's process, so that a hostile file can end only this
// program. Only the core starts it. It opens no network connection, runs no script of the PDF,
// follows no action and writes nothing outside the folder it is given.
#include "mfbe/version.hpp"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

namespace {

int usage() {
    std::fputs(
        "usage: mfbe-pdf-reader --pdf <path> --out <folder> [--max-memory <MB>] [--quality <1-100>]"
        " [--fonts <folder>]\n",
        stderr);
    return 2;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc == 2 && std::strcmp(argv[1], "--version") == 0) {
        std::printf("mfbe-pdf-reader %s\n", mfbe::version::kVersion);
        return 0;
    }
    std::string pdf;
    std::string out;
    for (int i = 1; i + 1 < argc; i += 2) {
        if (std::strcmp(argv[i], "--pdf") == 0) {
            pdf = argv[i + 1];
        } else if (std::strcmp(argv[i], "--out") == 0) {
            out = argv[i + 1];
        }
    }
    if (pdf.empty() || out.empty()) {
        return usage();
    }
#ifdef MFBE_TEST_HOOKS
    // The reader process tests (tests/core/test_pdf_reader_process.cpp): a crash, a hang, a
    // runaway.
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--test-crash") == 0) {
            std::abort();
        }
        if (std::strcmp(argv[i], "--test-hang") == 0) {
            std::printf("{\"event\":\"opened\",\"pages\":1}\n");
            std::fflush(stdout);
            for (;;) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
        }
        if (std::strcmp(argv[i], "--test-alloc") == 0) {
            std::vector<std::vector<char>> hog;
            for (;;) {
                hog.emplace_back(64 * 1024 * 1024, 'x');
                std::printf("{\"event\":\"page\",\"n\":%zu}\n", hog.size());
                std::fflush(stdout);
            }
        }
    }
#endif
    // The reading itself comes with the reader's parts (tasks T012 to T018).
    std::printf("{\"event\":\"failed\",\"reason\":\"notPdf\"}\n");
    return 1;
}
