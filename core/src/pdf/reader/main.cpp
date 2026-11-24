// Feature 016 (PD2, DP-1, contracts/pdf-reader.md): mfbe-pdf-reader, the program that reads one PDF
// for one import, apart from the editor's process, so that a hostile file can end only this
// program. Only the core starts it. It opens no network connection, runs no script of the PDF,
// follows no action and writes nothing outside the folder it is given.
#include "mfbe/utf8_paths.hpp"
#include "mfbe/version.hpp"
#include "pdf/reader/ocr.hpp"
#include "pdf/reader/ocr_layout.hpp"
#include "pdf/reader/reader.hpp"

#include <Error.h>
#include <GlobalParams.h>
#include <PDFDoc.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#ifndef _WIN32
#include <unistd.h>
#endif
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace {

int usage() {
    std::fputs(
        "usage: mfbe-pdf-reader --pdf <path> --out <folder> [--max-memory <MB>] [--quality <1-100>]"
        " [--fonts <folder>] [--ocr] [--ocr-auto <0|1>] [--ocr-langs <c1,c2,...>]"
        " [--ocr-dir <path>]... [--ocr-threads <1-8>]\n"
        "       mfbe-pdf-reader --pdf <path> --render <page> --dpi <18-600> --out <file.png>\n",
        stderr);
    return 2;
}

std::vector<std::string> split_csv(const std::string& raw) {
    std::vector<std::string> out;
    std::size_t start = 0;
    while (start <= raw.size()) {
        const std::size_t comma = raw.find(',', start);
        const std::size_t end = comma == std::string::npos ? raw.size() : comma;
        if (end > start) {
            out.push_back(raw.substr(start, end - start));
        }
        if (comma == std::string::npos) {
            break;
        }
        start = comma + 1;
    }
    return out;
}

nlohmann::json load_page_json(const std::filesystem::path& out_dir, int n) {
    std::ifstream in(out_dir / ("page-" + std::to_string(n) + ".json"));
    auto parsed = nlohmann::json::parse(in, nullptr, false);
    return parsed.is_object() ? std::move(parsed) : nlohmann::json::object();
}

void write_ocr_page_json(const std::filesystem::path& out_dir,
                         const mfbe::pdf_reader::OcrPageResult& res,
                         const nlohmann::json& pictures) {
    nlohmann::json words = nlohmann::json::array();
    for (const auto& w : res.words) {
        words.push_back({{"t", w.text},
                         {"box", {w.box[0], w.box[1], w.box[2], w.box[3]}},
                         {"f", "ocr"},
                         {"s", w.font_size},
                         {"c", "#000000"},
                         {"base", w.box[1] + w.box[3] * 0.85},
                         {"lang", w.lang},
                         {"conf", static_cast<int>(std::lround(w.conf))}});
    }
    nlohmann::json fonts = nlohmann::json::array();
    if (!words.empty()) {
        fonts.push_back({{"id", "ocr"},
                         {"name", "OCR"},
                         {"bold", false},
                         {"italic", false},
                         {"mono", false}});
    }
    nlohmann::json page{
        {"n", res.page},
        {"width", res.page_width_pts},
        {"height", res.page_height_pts},
        {"rotation", 0},
        {"kind", res.usable ? "pictureShowingText" : "pictureWithoutText"},
        {"links", nlohmann::json::array()},
        {"fonts", std::move(fonts)},
        {"words", std::move(words)},
        {"pictures", pictures},
        {"forms", nlohmann::json::array()},
        {"drawings", nlohmann::json::array()},
        {"ocrUsed", true},
        {"ocrRotation", res.rotation_cw},
        {"ocrMeanConf", std::round(res.mean_conf * 10.0) / 10.0},
        {"ocrLowConfidence", res.low_confidence},
    };
    if (!res.primary_lang.empty()) {
        page["ocrLang"] = res.primary_lang;
    }
    if (!res.languages.empty()) {
        page["ocrLanguages"] = res.languages;
    }
    std::ofstream(out_dir / ("page-" + std::to_string(res.page) + ".json"))
        << mfbe::pdf_reader::dumped(page);
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
    mfbe::pdf_reader::OcrOptions ocr_opts;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--ocr") == 0) {
            ocr_opts.enabled = true;
            continue;
        }
        if (i + 1 >= argc) {
            continue;
        }
        const std::string flag = argv[i];
        const std::string value = argv[i + 1];
        if (flag == "--pdf") {
            pdf = value;
            ++i;
        } else if (flag == "--out") {
            out = value;
            ++i;
        } else if (flag == "--quality") {
            quality = std::clamp(std::atoi(value.c_str()), 1, 100);
            ++i;
        } else if (flag == "--fonts") {
            fonts = value;
            ++i;
        } else if (flag == "--render") {
            render = std::atoi(value.c_str());
            ++i;
        } else if (flag == "--dpi") {
            dpi = std::atoi(value.c_str());
            ++i;
        } else if (flag == "--max-memory") {
            // The core enforces the memory cap externally via RLIMIT / Job Object / RSS polling.
            ++i;
        } else if (flag == "--ocr-auto") {
            ocr_opts.auto_detect = (value != "0");
            ++i;
        } else if (flag == "--ocr-langs") {
            ocr_opts.languages = split_csv(value);
            ++i;
        } else if (flag == "--ocr-dir") {
            ocr_opts.ocr_dirs.push_back(mfbe::platform::path_from_utf8(value));
            ++i;
        } else if (flag == "--ocr-threads") {
            ocr_opts.threads = std::clamp(std::atoi(value.c_str()), 1, 8);
            ++i;
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
    int clean_text_pages = 0;
    int showing_text = 0;
    int garbled = 0;
    mfbe::pdf_reader::Readability all;
    std::vector<std::string> page_kinds(static_cast<std::size_t>(pages + 1));
    for (int n = 1; n <= pages; ++n) {
#ifndef _WIN32
        if (getppid() == 1) {
            return 1;  // the core is gone (macOS has no parent-death signal): end with it
        }
#endif
        mfbe::pdf_reader::Readability readable;
        const std::string kind = mfbe::pdf_reader::write_page(*doc, n, options, &readable);
        page_kinds[static_cast<std::size_t>(n)] = kind;
        all.tokens += readable.tokens;
        all.plain += readable.plain;
        const bool has_clean_text = (kind == "text" || kind == "pictureWithLayer");
        clean_text_pages += has_clean_text ? 1 : 0;
        text_pages += (has_clean_text || kind == "garbled") ? 1 : 0;
        showing_text += kind == "pictureShowingText" ? 1 : 0;
        garbled += kind == "garbled" ? 1 : 0;
        mfbe::pdf_reader::emit("{\"event\":\"page\",\"n\":" + std::to_string(n) + ",\"kind\":\"" +
                               kind + "\"}");
    }
    const double share = all.tokens > 0 ? static_cast<double>(all.plain) / all.tokens : 1.0;

    // Pre-written ocr-* picture metadata served directly in the stdin loop (contracts/pdf-reader.md).
    std::map<std::string, nlohmann::json> prewritten_pictures;
    nlohmann::json ocr_done_summary;

    if (!ocr_opts.enabled || ours) {
        // Strict zero-OCR fast path: never stage tessdata or initialize Tesseract.
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
        if (ocr_opts.enabled) {
            ocr_done_summary = {{"used", false},
                                {"pagesRecognized", 0},
                                {"imageBlocksRecognized", 0},
                                {"fallbackPages", 0},
                                {"lowConfidencePages", 0},
                                {"primaryLang", ""},
                                {"languages", nlohmann::json::array()}};
        }
    } else {
        // Feature 020: determine full-page OCR targets.
        // - Always target pictureShowingText and garbled pages.
        // - If the whole document read as garbled (low overall plain share), target all text pages.
        // - On image-only books (text_pages == 0), also target non-blank pictureWithoutText pages
        //   (excluding a page-1 full-page cover when pages > 1 and other pages have text).
        const bool whole_doc_garbled =
            all.tokens >= mfbe::pdf_reader::kGarbledDocumentTokens &&
            share < mfbe::pdf_reader::kGarbledShare;
        std::vector<int> full_ocr_pages;
        std::vector<mfbe::pdf_reader::EmbeddedImageCandidate> embedded_candidates;
        std::map<int, nlohmann::json> page_models;
        for (int n = 1; n <= pages; ++n) {
            const std::string& kind = page_kinds[static_cast<std::size_t>(n)];
            if (kind == "pictureShowingText" || kind == "garbled" ||
                (whole_doc_garbled && (kind == "text" || kind == "pictureWithLayer"))) {
                full_ocr_pages.push_back(n);
            } else if (kind == "pictureWithoutText" && text_pages == 0) {
                const bool page1_cover = (n == 1 && pages > 1 && (showing_text > 0 || garbled > 0));
                if (!page1_cover) {
                    full_ocr_pages.push_back(n);
                }
            } else if (kind == "text" && !whole_doc_garbled) {
                nlohmann::json pj = load_page_json(options.out, n);
                if (pj.contains("pictures") && pj["pictures"].is_array() &&
                    !pj["pictures"].empty()) {
                    auto cands = mfbe::pdf_reader::find_embedded_ocr_candidates(*doc, n, pj);
                    if (!cands.empty()) {
                        page_models.emplace(n, std::move(pj));
                        for (auto& c : cands) {
                            embedded_candidates.push_back(std::move(c));
                        }
                    }
                }
            }
        }

        if (full_ocr_pages.empty() && embedded_candidates.empty()) {
            // Strict zero-OCR fast path when no page or embedded image needs OCR.
            ocr_done_summary = {{"used", false},
                                {"pagesRecognized", 0},
                                {"imageBlocksRecognized", 0},
                                {"fallbackPages", 0},
                                {"lowConfidencePages", 0},
                                {"primaryLang", ""},
                                {"languages", nlohmann::json::array()}};
        } else {
            for (int p : full_ocr_pages) {
                page_models.emplace(p, load_page_json(options.out, p));
            }
            mfbe::pdf_reader::OcrRuntime runtime(ocr_opts, options.out);
            if (!runtime.initialize()) {
                mfbe::pdf_reader::emit(R"({"event":"failed","reason":"ocrNoLanguages"})");
                return 1;
            }

            mfbe::pdf_reader::OcrDiagnosis diag;
            std::map<int, mfbe::pdf_reader::OcrPageResult> results;
            int ocr_done = 0;
            const int ocr_total =
                static_cast<int>(full_ocr_pages.size() + embedded_candidates.size());
            std::atomic<bool> cancelled{false};

            if (!full_ocr_pages.empty()) {
                // Pass 2: sample up to 3 spread pages to determine document primary language.
                std::vector<int> sample_pages;
                if (full_ocr_pages.size() <= 3) {
                    sample_pages = full_ocr_pages;
                } else {
                    sample_pages = {full_ocr_pages.front(),
                                    full_ocr_pages[full_ocr_pages.size() / 2],
                                    full_ocr_pages.back()};
                }
                diag = runtime.detect_document_language(
                    *doc, sample_pages, page_models, [](int done, int total) {
                        mfbe::pdf_reader::emit(
                            mfbe::pdf_reader::dumped({{"event", "ocr-stage"},
                                                      {"stage", "detect"},
                                                      {"done", done},
                                                      {"total", total}}));
                    });

                // Pass 3: recognize target pages concurrently via sequential Poppler -> worker pool.
                runtime.recognize_pages_parallel(
                    *doc, full_ocr_pages, page_models, diag.primary_pack,
                    [&](mfbe::pdf_reader::OcrPageResult&& res) {
                        const int p = res.page;
                        const bool usable = res.usable;
                        const std::string plang = res.primary_lang;
                        if (usable) {
                            write_ocr_page_json(options.out, res, nlohmann::json::array());
                        }
                        results.emplace(p, std::move(res));
                        ++ocr_done;
                        nlohmann::json ev{{"event", "ocr-page"},
                                          {"n", p},
                                          {"done", ocr_done},
                                          {"total", ocr_total},
                                          {"kind", usable ? "ocr" : "ocrFallback"}};
                        if (!plang.empty()) {
                            ev["lang"] = plang;
                        }
                        mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(ev));
                    },
                    cancelled);
            }

            if (cancelled.load()) {
                return 1;
            }

            // Embedded text-bearing raster images on searchable pages (T036).
            int image_blocks_recognized = 0;
            std::map<int, nlohmann::json> embedded_blocks_by_page;
            std::map<std::string, int> lang_word_counts;
            for (const auto& cand : embedded_candidates) {
#ifndef _WIN32
                if (getppid() == 1) {
                    return 1;
                }
#endif
                constexpr int kEmbeddedDpi = 240;
                auto region = mfbe::pdf_reader::OcrRuntime::render_region_gray(
                    *doc, cand.page, cand.box_pts, kEmbeddedDpi);
                const auto block = runtime.recognize_embedded_region(
                    region.get(), kEmbeddedDpi, cand.box_pts, diag.primary_pack);
                ++ocr_done;
                nlohmann::json ev{{"event", "ocr-page"},
                                  {"n", cand.page},
                                  {"done", ocr_done},
                                  {"total", ocr_total},
                                  {"kind", "ocrImage"}};
                if (block.usable) {
                    ++image_blocks_recognized;
                    if (!block.fb2_lang.empty()) {
                        ev["lang"] = block.fb2_lang;
                        lang_word_counts[block.fb2_lang] += static_cast<int>(block.words.size());
                    }
                    auto& arr = embedded_blocks_by_page[cand.page];
                    if (!arr.is_array()) {
                        arr = nlohmann::json::array();
                    }
                    arr.push_back(mfbe::pdf_reader::build_ocr_image_block_json(cand, block));
                }
                mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(ev));
            }
            for (auto& [p, blocks] : embedded_blocks_by_page) {
                nlohmann::json pj = page_models.contains(p) ? page_models[p]
                                                            : load_page_json(options.out, p);
                pj["ocrImages"] = std::move(blocks);
                std::ofstream(options.out / ("page-" + std::to_string(p) + ".json"))
                    << mfbe::pdf_reader::dumped(pj);
            }

            int pages_recognized = 0;
            int low_conf_pages = 0;
            std::vector<int> fallback_pages;
            std::map<std::string, float> script_votes;
            if (!diag.dominant_osd_script.empty() && diag.dominant_osd_script_conf > 0.0f) {
                script_votes[diag.dominant_osd_script] += diag.dominant_osd_script_conf;
            }
            for (const auto& [p, r] : results) {
                if (!r.osd_script.empty() && r.osd_script_conf >= 1.5f) {
                    script_votes[r.osd_script] += r.osd_script_conf;
                }
                if (r.usable) {
                    ++pages_recognized;
                    if (r.low_confidence) {
                        ++low_conf_pages;
                    }
                    for (const auto& w : r.words) {
                        if (!w.lang.empty()) {
                            lang_word_counts[w.lang]++;
                        }
                    }
                    // Crop distinct non-text inline illustrations on scanned pages (T036).
                    nlohmann::json cropped = mfbe::pdf_reader::crop_scanned_inline_illustrations(
                        *doc, r, options.quality, options.out, prewritten_pictures);
                    if (!cropped.empty()) {
                        write_ocr_page_json(options.out, r, cropped);
                    }
                } else {
                    fallback_pages.push_back(p);
                }
            }

            const int usable_searchable = whole_doc_garbled ? 0 : clean_text_pages;
            if (usable_searchable == 0 && pages_recognized == 0 && image_blocks_recognized == 0) {
                std::string best_script;
                float best_votes = 0.0f;
                for (const auto& [script, votes] : script_votes) {
                    if (votes > best_votes) {
                        best_script = script;
                        best_votes = votes;
                    }
                }
                if (!best_script.empty()) {
                    const auto disabled = runtime.disabled_packs_for_script(best_script);
                    if (!disabled.empty()) {
                        mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(
                            {{"event", "failed"},
                             {"reason", "ocrLanguageDisabled"},
                             {"script", best_script},
                             {"suggestedLanguages", disabled}}));
                        return 1;
                    }
                    if (!runtime.any_installed_for_script(best_script)) {
                        mfbe::pdf_reader::emit(
                            mfbe::pdf_reader::dumped({{"event", "failed"},
                                                      {"reason", "ocrLanguageMissing"},
                                                      {"script", best_script}}));
                        return 1;
                    }
                }
                mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(
                    {{"event", "failed"}, {"reason", "ocrUnreadable"}, {"pages", pages}}));
                return 1;
            }

            // Best-effort preservation: save isolated unreadable pages as ocrFallback pictures.
            int saved_fallbacks = 0;
            for (int p : fallback_pages) {
                const auto& r = results.at(p);
                const std::string pic_id = "ocr-fallback-p" + std::to_string(p);
                const std::string rel_file = "pictures/" + pic_id + ".jpg";
                auto rgb = mfbe::pdf_reader::OcrRuntime::render_page_rgb(*doc, p, r.dpi);
                std::string content_type;
                int out_w = 0;
                int out_h = 0;
                nlohmann::json pics = nlohmann::json::array();
                if (rgb && mfbe::pdf_reader::OcrRuntime::save_pix_full(
                               rgb.get(), r.rotation_cw, options.quality, options.out / rel_file,
                               content_type, out_w, out_h)) {
                    ++saved_fallbacks;
                    pics.push_back({{"id", pic_id},
                                    {"box", {0.0, 0.0, r.page_width_pts, r.page_height_pts}},
                                    {"w", out_w},
                                    {"h", out_h},
                                    {"jpeg", true},
                                    {"ocrFallback", true}});
                    prewritten_pictures.emplace(
                        pic_id, nlohmann::json{{"event", "picture"},
                                               {"id", pic_id},
                                               {"file", rel_file},
                                               {"contentType", content_type},
                                               {"width", out_w},
                                               {"height", out_h}});
                }
                write_ocr_page_json(options.out, r, pics);
            }

            std::vector<std::pair<std::string, int>> ordered_langs(lang_word_counts.begin(),
                                                                   lang_word_counts.end());
            std::sort(ordered_langs.begin(), ordered_langs.end(),
                      [](const auto& a, const auto& b) {
                          if (a.second != b.second) {
                              return a.second > b.second;
                          }
                          return a.first < b.first;
                      });
            std::vector<std::string> doc_langs;
            for (const auto& [lang, _] : ordered_langs) {
                doc_langs.push_back(lang);
            }
            const std::string primary_lang =
                !doc_langs.empty() ? doc_langs.front() : diag.primary_lang;

            const bool any_ocr_output =
                pages_recognized > 0 || image_blocks_recognized > 0 || saved_fallbacks > 0;
            ocr_done_summary = {{"used", any_ocr_output},
                                {"pagesRecognized", pages_recognized},
                                {"imageBlocksRecognized", image_blocks_recognized},
                                {"fallbackPages", saved_fallbacks},
                                {"lowConfidencePages", low_conf_pages},
                                {"primaryLang", any_ocr_output ? primary_lang : ""},
                                {"languages", any_ocr_output ? nlohmann::json(doc_langs)
                                                             : nlohmann::json::array()}};
        }
    }

    nlohmann::json done_event{{"event", "done"},
                              {"garbledShare", std::round(share * 100.0) / 100.0},
                              {"drawingsLeftOut", mfbe::pdf_reader::drawings_left_out()}};
    if (!ocr_done_summary.is_null()) {
        done_event["ocr"] = std::move(ocr_done_summary);
    }
    mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(done_event));
    // The import now asks for the pictures it takes, one line each, until the core closes standard
    // input.
    for (std::string line; std::getline(std::cin, line);) {
        const auto request = nlohmann::json::parse(line, nullptr, false);
        if (!request.is_object() || !request.contains("picture") || !request.contains("page")) {
            continue;
        }
        const std::string pic_id = request.value("picture", std::string());
        if (pic_id.rfind("ocr-", 0) == 0) {
            const auto it = prewritten_pictures.find(pic_id);
            if (it != prewritten_pictures.end()) {
                mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(it->second));
            } else {
                mfbe::pdf_reader::emit(
                    mfbe::pdf_reader::dumped({{"event", "picture-failed"}, {"id", pic_id}}));
            }
            continue;
        }
        mfbe::pdf_reader::emit(mfbe::pdf_reader::dumped(
            pic_id.rfind('d', 0) == 0
                ? mfbe::pdf_reader::write_drawing(*doc, pic_id, options)
                : mfbe::pdf_reader::write_picture(*doc, request.value("page", 0), pic_id,
                                                  options)));
    }
    return 0;
}
