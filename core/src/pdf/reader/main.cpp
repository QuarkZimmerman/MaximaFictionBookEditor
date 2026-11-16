// Feature 016 (PD2, DP-1, contracts/pdf-reader.md): mfbe-pdf-reader, the program that reads one PDF
// for one import, apart from the editor's process, so that a hostile file can end only this
// program. Only the core starts it. It opens no network connection, runs no script of the PDF,
// follows no action and writes nothing outside the folder it is given.
#include "mfbe/version.hpp"

#include <cstdio>
#include <cstring>
#include <string>

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
    // The reading itself comes with the reader's parts (tasks T012 to T018).
    std::printf("{\"event\":\"failed\",\"reason\":\"notPdf\"}\n");
    return 1;
}
