// Feature 016 (PD2, DP-1, contracts/pdf-reader.md): mfbe-pdf-reader, the program that reads one PDF
// for one import, apart from the editor's process, so that a hostile file can end only this
// program. Only the core starts it. It opens no network connection, runs no script of the PDF,
// follows no action and writes nothing outside the folder it is given.
#include "mfbe/utf8_paths.hpp"
#include "mfbe/version.hpp"
#include "pdf/reader/reader.hpp"

#include <Error.h>
#include <GlobalParams.h>
#include <PDFDoc.h>
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#ifndef _WIN32
#include <unistd.h>
#endif
#include <optional>
#include <string>
#include <thread>
#include <vector>

namespace {

int usage() {
    std::fputs(
        "usage: mfbe-pdf-reader --pdf <path> --out <folder> [--max-memory <MB>] [--quality <1-100>]"
        " [--fonts <folder>]\n"
        "       mfbe-pdf-reader --pdf <path> --render <page> --dpi <18-600> --out <file.png>\n",
        stderr);
    return 2;
}

}  // namespace

namespace mfbe::pdf_reader {
void emit(const std::string& json) {
    std::fwrite(json.data(), 1, json.size(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
}
}  // namespace mfbe::pdf_reader

int main(int argc, char** argv) {
    if (argc == 2 && std::strcmp(argv[1], "--version") == 0) {
        std::printf("mfbe-pdf-reader %s\n", mfbe::version::kVersion);
        return 0;
    }
    std::string pdf;
    std::string out;
    std::string fonts;
    int quality = 85;
    int render = 0;
    int dpi = 0;
    for (int i = 1; i + 1 < argc; i += 2) {
        const std::string value = argv[i + 1];
        if (std::strcmp(argv[i], "--pdf") == 0) {
            pdf = value;
        } else if (std::strcmp(argv[i], "--out") == 0) {
            out = value;
        } else if (std::strcmp(argv[i], "--quality") == 0) {
            quality = std::clamp(std::atoi(value.c_str()), 1, 100);
        } else if (std::strcmp(argv[i], "--fonts") == 0) {
            fonts = value;
        } else if (std::strcmp(argv[i], "--render") == 0) {
            render = std::atoi(value.c_str());
        } else if (std::strcmp(argv[i], "--dpi") == 0) {
            dpi = std::atoi(value.c_str());
        }
        // --max-memory: the core caps the process itself (an address-space limit, a job object).
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
    if (!globalParams) {
        globalParams = std::make_unique<GlobalParams>();
    }
    // DP-7: the fonts a PDF does not embed (the 14 standard ones, and what Poppler puts in their
    // place) are drawn with the shipped Noto and DejaVu files - the editor's Poppler has no system
    // font lookup on Linux and macOS; on Windows it looks in the Windows fonts folder for a font it
    // is not given.
    if (!fonts.empty()) {
        const std::pair<const char*, const char*> standard[] = {
            {"Helvetica", "NotoSans-Regular.ttf"},
            {"Helvetica-Bold", "NotoSans-Bold.ttf"},
            {"Helvetica-Oblique", "NotoSans-Italic.ttf"},
            {"Helvetica-BoldOblique", "NotoSans-BoldItalic.ttf"},
            {"Times-Roman", "NotoSerif-Regular.ttf"},
            {"Times-Bold", "NotoSerif-Bold.ttf"},
            {"Times-Italic", "NotoSerif-Italic.ttf"},
            {"Times-BoldItalic", "NotoSerif-BoldItalic.ttf"},
            {"Courier", "DejaVuSansMono.ttf"},
            {"Courier-Bold", "DejaVuSansMono-Bold.ttf"},
            {"Courier-Oblique", "DejaVuSansMono-Oblique.ttf"},
            {"Courier-BoldOblique", "DejaVuSansMono-BoldOblique.ttf"}};
        for (const auto& [name, file] : standard) {
            const auto path = mfbe::platform::path_from_utf8(fonts) / file;
            if (std::filesystem::exists(path)) {
                globalParams->addFontFile(name, mfbe::platform::utf8_from_path(path));
            }
        }
    }
    // Poppler's syntax notices about a hostile or sloppy file are not the editor's errors: kept
    // silent.
    setErrorCallback([](ErrorCategory, Goffset, const char*) {});
    mfbe::pdf_reader::Options options;
    options.pdf = mfbe::platform::path_from_utf8(pdf);
    options.out = mfbe::platform::path_from_utf8(out);
    options.quality = quality;
    if (!fonts.empty()) {
        options.fonts = mfbe::platform::path_from_utf8(fonts);
    }
    std::optional<GooString> user;
    std::unique_ptr<PDFDoc> doc;
    for (int attempt = 0;; ++attempt) {
        doc = std::make_unique<PDFDoc>(std::make_unique<GooString>(pdf), user, user);
        if (doc->isOk()) {
            break;
        }
        if (doc->getErrorCode() != errEncrypted) {
            mfbe::pdf_reader::emit(R"({"event":"failed","reason":"damaged"})");
            return 1;
        }
        mfbe::pdf_reader::emit(attempt == 0 ? R"({"event":"needs-password"})"
                                            : R"({"event":"wrong-password"})");
        std::string line;
        if (!std::getline(std::cin, line) || line.empty()) {
            mfbe::pdf_reader::emit(R"({"event":"failed","reason":"passwordCancelled"})");
            return 1;
        }
        user = GooString(line);
    }
    mfbe::pdf_reader::map_newer_types(*doc);
    if (!doc->okToCopy()) {
        mfbe::pdf_reader::emit(R"({"event":"owner-password"})");
        std::string line;
        if (!std::getline(std::cin, line) || line.empty()) {
            mfbe::pdf_reader::emit(R"({"event":"failed","reason":"copyForbidden"})");
            return 1;
        }
        auto owner =
            std::make_unique<PDFDoc>(std::make_unique<GooString>(pdf), GooString(line), user);
        if (!owner->isOk() || !owner->okToCopy()) {
            mfbe::pdf_reader::emit(R"({"event":"failed","reason":"copyForbidden"})");
            return 1;
        }
        doc = std::move(owner);
    }
    const int pages = doc->getNumPages();
    // DP-3: a PDF without pages is damaged; one past 25,000 pages is past what the import reads
    // (the export writes up to 20,000).
    if (pages <= 0) {
        mfbe::pdf_reader::emit(R"({"event":"failed","reason":"damaged"})");
        return 1;
    }
    if (pages > 25'000) {
        mfbe::pdf_reader::emit("{\"event\":\"failed\",\"reason\":\"tooManyPages\",\"pages\":" +
                               std::to_string(pages) + "}");
        return 1;
    }
    // D20: the render switch draws one page as a picture, for a later OCR, and ends.
    if (render != 0) {
        int width = 0;
        int height = 0;
        if (!mfbe::pdf_reader::render_page(*doc, render, dpi, options.out, width, height)) {
            mfbe::pdf_reader::emit(R"({"event":"failed","reason":"damaged"})");
            return 1;
        }
        mfbe::pdf_reader::emit("{\"event\":\"rendered\",\"n\":" + std::to_string(render) +
                               ",\"width\":" + std::to_string(width) +
                               ",\"height\":" + std::to_string(height) + "}");
        return 0;
    }
    std::string error;
    bool ours = false;
    if (!mfbe::pdf_reader::write_document(*doc, options, error, &ours)) {
        mfbe::pdf_reader::emit(R"({"event":"failed","reason":"damaged"})");
        return 1;
    }
    // "opened" means document.json is written: the import asks its questions from it (D23).
    mfbe::pdf_reader::emit("{\"event\":\"opened\",\"pages\":" + std::to_string(pages) + "}");
    // D19, DP-9: what the pages hold, for the refusals at the end and the import's summary.
    int text_pages = 0;
    int showing_text = 0;
    int garbled = 0;
    mfbe::pdf_reader::Readability all;
    for (int n = 1; n <= pages; ++n) {
#ifndef _WIN32
        if (getppid() == 1) {
            return 1;  // the core is gone (macOS has no parent-death signal): end with it
        }
#endif
        mfbe::pdf_reader::Readability readable;
        const std::string kind = mfbe::pdf_reader::write_page(*doc, n, options, &readable);
        all.tokens += readable.tokens;
        all.plain += readable.plain;
        text_pages += kind == "text" || kind == "pictureWithLayer" || kind == "garbled" ? 1 : 0;
        showing_text += kind == "pictureShowingText" ? 1 : 0;
        garbled += kind == "garbled" ? 1 : 0;
        mfbe::pdf_reader::emit("{\"event\":\"page\",\"n\":" + std::to_string(n) + ",\"kind\":\"" +
                               kind + "\"}");
    }
    const double share = all.tokens > 0 ? static_cast<double>(all.plain) / all.tokens : 1.0;
    // D19: only clean text. The editor's own PDF always holds its text; any other is refused when
    // it holds no text at all, when pages show text without a layer, or when its layer reads mostly
    // as garbage - each refusal with the number of pages concerned (FR-032).
    if (!ours) {
        const auto refuse = [](const char* reason, int count) {
            mfbe::pdf_reader::emit(std::string("{\"event\":\"failed\",\"reason\":\"") + reason +
                                   "\",\"pages\":" + std::to_string(count) + "}");
            return 1;
        };
        if (text_pages == 0) {
            return refuse("noText", pages);
        }
        if (all.tokens >= mfbe::pdf_reader::kGarbledDocumentTokens &&
            share < mfbe::pdf_reader::kGarbledShare) {
            return refuse("garbled", garbled > 0 ? garbled : text_pages);
        }
        if (showing_text > 0) {
            return refuse("pictureOfText", showing_text);
        }
    }
    char done[96];
    std::snprintf(done, sizeof done, R"({"event":"done","garbledShare":%.2f,"drawingsLeftOut":%d})",
                  share, mfbe::pdf_reader::drawings_left_out());
    mfbe::pdf_reader::emit(done);
    // The import now asks for the pictures it takes, one line each, until the core closes standard
    // input.
    for (std::string line; std::getline(std::cin, line);) {
        const auto request = nlohmann::json::parse(line, nullptr, false);
        if (!request.is_object() || !request.contains("picture") || !request.contains("page")) {
            continue;
        }
        mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(
            request.value("picture", std::string()).rfind('d', 0) == 0
                ? mfbe::pdf_reader::write_drawing(*doc, request.value("picture", std::string()),
                                                  options)
                : mfbe::pdf_reader::write_picture(*doc, request.value("page", 0),
                                                  request.value("picture", std::string()),
                                                  options)));
    }
    return 0;
}
