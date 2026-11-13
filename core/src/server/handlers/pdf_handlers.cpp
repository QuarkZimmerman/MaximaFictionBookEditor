// Feature 014 (contracts/rpc-api.md, tasks T014): the PDF export's methods and routes. The
// interface asks for the target with dialog.saveFile, as the EPUB export does, then:
//   pdf.export.begin {docId, path, pageSize} -> {token}
//   PUT /pdf/{token}/part/{n}          the paged HTML of part n (research R7, DP-3)
//   pdf.export.print {token, part}     -> job: the print service prints the part (R1)
//   GET /pdf/{token}/print/{n}         the part as the print browser loads it
//   pdf.export.finish {token, pageMap} -> job: the finished file, written atomically (R3)
//   pdf.export.abort {token}
// Everything of an export lives in its own folder of the data folder until finish or abort, or
// ten minutes without a call.

#include "pdf/check.hpp"
#include "pdf/coverage.hpp"
#include "pdf/finish.hpp"
#include "pdf/fonts.hpp"
#include "pdf/join.hpp"
#include "pdf/xmp.hpp"
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/print_service.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/version.hpp>

#include <chrono>
#include <fstream>
#include <future>
#include <iterator>
#include <random>
#include <string>
#include <thread>

namespace mfbe::server {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

constexpr std::size_t kMaxPartBytes = 512ull * 1024 * 1024;
constexpr auto kIdleLimit = std::chrono::minutes(10);
constexpr int kMaxParts = 1000;
// The paged document tells the print browser it is ready once its fonts are (the shell's print
// service and the journeys' print seam wait for this title; contracts/print-service.md).
constexpr std::string_view kReadyScript =
    "<script xmlns=\"http://www.w3.org/1999/xhtml\">"
    "document.fonts.ready.then(function(){document.title='mfbe-print-ready';});</script>";

struct PageSize {
    const char* id;
    double width_in;
    double height_in;
};

// D3, portrait, exactly (millimetres / 25.4, or inches).
constexpr PageSize kPageSizes[] = {
    {"a4", 210.0 / 25.4, 297.0 / 25.4},
    {"b5", 176.0 / 25.4, 250.0 / 25.4},
    {"a5", 148.0 / 25.4, 210.0 / 25.4},
    {"b6", 125.0 / 25.4, 176.0 / 25.4},
    {"a6", 105.0 / 25.4, 148.0 / 25.4},
    {"legal", 8.5, 14.0},
    {"letter", 8.5, 11.0},
    {"executive", 7.25, 10.5},
    {"statement", 5.5, 8.5},
};

rpc::RpcError failed(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kPdfExportFailed, "", std::move(data));
}

std::string new_token() {
    std::random_device rd;
    static const char* kHex = "0123456789abcdef";
    std::string token;
    for (int i = 0; i < 32; ++i) {
        token.push_back(kHex[rd() & 0x0F]);
    }
    return token;
}

bool same_file(const fs::path& a, const fs::path& b) {
    std::error_code ec;
    return fs::exists(a, ec) && fs::exists(b, ec) && fs::equivalent(a, b, ec);
}

fs::path part_html(const Services::PdfExport& e, int part) {
    return e.work / ("part-" + std::to_string(part) + ".html");
}

fs::path part_pdf(const Services::PdfExport& e, int part) {
    return e.work / ("part-" + std::to_string(part) + ".pdf");
}

void remove_work(const fs::path& work) {
    std::error_code ec;
    fs::remove_all(work, ec);
}

// Drops the exports nobody has called for ten minutes (the interface died, or forgot one).
void purge_idle(Services& services) {
    const auto now = std::chrono::steady_clock::now();
    std::lock_guard lock(services.pdf.mutex);
    for (auto it = services.pdf.exports.begin(); it != services.pdf.exports.end();) {
        if (now - it->second.touched > kIdleLimit) {
            remove_work(it->second.work);
            it = services.pdf.exports.erase(it);
        } else {
            ++it;
        }
    }
}

// A copy of the export, touched; throws pdf.unknownToken.
Services::PdfExport require_export(Services& services, const std::string& token) {
    std::lock_guard lock(services.pdf.mutex);
    const auto it = services.pdf.exports.find(token);
    if (it == services.pdf.exports.end()) {
        throw failed("pdf.unknownToken");
    }
    it->second.touched = std::chrono::steady_clock::now();
    return it->second;
}

int part_param(const json& params, const Services::PdfExport& e) {
    const int part = rpc::params::integer_or(params, "part", 0);
    if (part < 0 || part >= e.parts) {
        throw failed("pdf.noPart", json{{"part", part}});
    }
    return part;
}

void end_plain(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

// "/pdf/<token>/part/<n>" and "/pdf/<token>/print/<n>": the token and the part number.
bool route_part(uWS::HttpRequest* req, std::string* token, int* part) {
    *token = LoopbackServer::url_decode(req->getParameter(0));
    const std::string n(req->getParameter(1));
    if (n.empty() || n.size() > 4 || n.find_first_not_of("0123456789") != std::string::npos) {
        return false;
    }
    *part = std::stoi(n);
    return true;
}

void upload_part(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                 uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    std::string token;
    int part = 0;
    if (!route_part(req, &token, &part)) {
        end_plain(res, "404 Not Found", "no such part");
        return;
    }
    auto buffer = std::make_shared<std::string>();
    auto aborted = std::make_shared<bool>(false);
    res->onAborted([aborted] { *aborted = true; });
    res->onData([res, buffer, aborted, &services, token, part](std::string_view chunk, bool last) {
        if (*aborted) {
            return;
        }
        if (buffer->size() + chunk.size() > kMaxPartBytes) {
            *aborted = true;
            end_plain(res, "413 Payload Too Large", "a part of more than 512 MB");
            return;
        }
        buffer->append(chunk);
        if (!last) {
            return;
        }
        std::lock_guard lock(services.pdf.mutex);
        const auto it = services.pdf.exports.find(token);
        if (it == services.pdf.exports.end() || part >= it->second.parts) {
            end_plain(res, "404 Not Found", "unknown PDF export or part");
            return;
        }
        it->second.touched = std::chrono::steady_clock::now();
        try {
            atomic_file::write_atomic(part_html(it->second, part), *buffer);
        } catch (const std::exception& e) {
            end_plain(res, "500 Internal Server Error", e.what());
            return;
        }
        res->writeStatus("201 Created");
        res->writeHeader("Cache-Control", "no-store");
        res->end();
    });
}

void serve_print(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                 uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    std::string token;
    int part = 0;
    if (!route_part(req, &token, &part)) {
        end_plain(res, "404 Not Found", "no such part");
        return;
    }
    fs::path file;
    {
        std::lock_guard lock(services.pdf.mutex);
        const auto it = services.pdf.exports.find(token);
        if (it == services.pdf.exports.end() || part >= it->second.parts) {
            end_plain(res, "404 Not Found", "unknown PDF export or part");
            return;
        }
        file = part_html(it->second, part);
    }
    std::string html;
    try {
        html = atomic_file::read_file(file);
    } catch (const std::exception&) {
        end_plain(res, "404 Not Found", "the part has not been uploaded");
        return;
    }
    const auto body_end = html.rfind("</body>");
    html.insert(body_end == std::string::npos ? html.size() : body_end, kReadyScript);
    res->writeStatus("200 OK");
    // XHTML: the book's elements are in the FB2 namespace, as Preview builds them, and only
    // XML keeps them so (an HTML parser would read <title> or <section> as its own elements).
    res->writeHeader("Content-Type", "application/xhtml+xml; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->writeHeader("X-Content-Type-Options", "nosniff");
    res->end(html);
}

void serve_font(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string id = LoopbackServer::url_decode(req->getParameter(0));
    const std::string style = LoopbackServer::url_decode(req->getParameter(1));
    const auto file = pdf::shipped_file(services.resources_dir / "fonts", id, style);
    std::string bytes;
    if (file) {
        try {
            bytes = atomic_file::read_file(*file);
        } catch (const std::exception&) {
        }
    }
    if (bytes.empty()) {
        end_plain(res, "404 Not Found", "no such font");
        return;
    }
    res->writeStatus("200 OK");
    res->writeHeader("Content-Type", "font/ttf");
    res->writeHeader("Cache-Control", "private, max-age=3600");
    res->writeHeader("X-Content-Type-Options", "nosniff");
    res->end(bytes);
}

}  // namespace

void register_pdf_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
    // Feature 014 (T017): the shipped fonts the paged document's @font-face rules name.
    app.get("/pdf/fonts/shipped/:id/:style",
            [&server, &services](auto* res, auto* req) { serve_font(server, services, res, req); });
    app.put("/pdf/:token/part/:n", [&server, &services](auto* res, auto* req) {
        upload_part(server, services, res, req);
    });
    app.get("/pdf/:token/print/:n", [&server, &services](auto* res, auto* req) {
        serve_print(server, services, res, req);
    });
}

void register_pdf_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("pdf.export.begin", [&services](const json& params, rpc::RpcContext&) {
        purge_idle(services);
        const std::string path = rpc::params::string(params, "path");
        const std::string size = rpc::params::string(params, "pageSize");
        const fs::path target = platform::path_from_utf8(path);
        const PageSize* page = nullptr;
        for (const PageSize& candidate : kPageSizes) {
            if (size == candidate.id)
                page = &candidate;
        }
        if (page == nullptr) {
            throw failed("pdf.badPageSize", json{{"pageSize", size}});
        }
        const std::string doc_id = rpc::params::opt_string(params, "docId").value_or("");
        if (!doc_id.empty()) {
            const session::DocumentSession* s = services.documents.find(doc_id);
            // The book's own file, or the archive it came from (D4).
            if (s != nullptr && s->path && same_file(target, *s->path)) {
                throw failed("pdf.targetIsSource", json{{"path", path}});
            }
        }
        Services::PdfExport e;
        e.target = target;
        e.doc_id = doc_id;
        e.page_size = page->id;
        e.width_in = page->width_in;
        e.height_in = page->height_in;
        e.touched = std::chrono::steady_clock::now();
        const std::string token = new_token();
        e.work = services.dirs.data / "pdf-export" / token;
        std::error_code ec;
        fs::create_directories(e.work, ec);
        if (ec) {
            throw failed("pdf.ioError", json{{"message", ec.message()}});
        }
        std::lock_guard lock(services.pdf.mutex);
        services.pdf.exports.emplace(token, std::move(e));
        return json{{"token", token}, {"pageSize", page->id}};
    });

    router.add_method("pdf.export.document", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const int parts = rpc::params::integer_or(params, "parts", 1);
        if (parts < 1 || parts > kMaxParts) {
            throw failed("pdf.noPart", json{{"parts", parts}});
        }
        std::lock_guard lock(services.pdf.mutex);
        const auto it = services.pdf.exports.find(token);
        if (it == services.pdf.exports.end()) {
            throw failed("pdf.unknownToken");
        }
        it->second.parts = parts;
        it->second.touched = std::chrono::steady_clock::now();
        return json::object();
    });

    router.add_method("pdf.export.print", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string token = rpc::params::string(params, "token");
        const Services::PdfExport e = require_export(services, token);
        const int part = part_param(params, e);
        std::shared_ptr<PrintService> printer = services.print_service();
        if (!printer) {
            throw failed("pdf.noPrinter", json{{"message", "printing needs the editor's window"}});
        }
        PrintRequest request;
        request.url = "http://127.0.0.1:" + std::to_string(services.port) + "/pdf/" + token +
                      "/print/" + std::to_string(part) + "?token=" + services.token;
        request.paper_width_in = e.width_in;
        request.paper_height_in = e.height_in;
        request.out = part_pdf(e, part);
        const std::string job_id = ctx.jobs.start([printer, request,
                                                   part](rpc::JobControl& control) -> json {
            control.progress("print", 0, 1);
            auto promise = std::make_shared<std::promise<std::pair<bool, std::string>>>();
            auto future = promise->get_future();
            printer->print(request, [promise](bool ok, const std::string& message) {
                promise->set_value({ok, message});
            });
            bool cancelling = false;
            while (future.wait_for(std::chrono::milliseconds(100)) != std::future_status::ready) {
                if (control.cancelled() && !cancelling) {
                    cancelling = true;
                    printer->cancel();
                }
            }
            const auto [ok, message] = future.get();
            if (!ok) {
                if (message == "cancelled")
                    control.check_cancelled();
                throw failed("pdf.printFailed", json{{"part", part}, {"message", message}});
            }
            control.progress("print", 1, 1);
            return json{{"part", part}};
        });
        return json{{"jobId", job_id}};
    });

    router.add_method("pdf.export.finish", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string token = rpc::params::string(params, "token");
        const Services::PdfExport e = require_export(services, token);
        pdf::FinishInput input;
        input.width_pt = e.width_in * 72.0;
        input.height_pt = e.height_in * 72.0;
        input.title = rpc::params::string_or(params, "title", "");
        if (params.contains("pageMap") && params["pageMap"].is_object()) {
            input.lang = params["pageMap"].value("language", std::string());
        }
        input.creator_tool = std::string(version::kProductName) + " " + version::kVersion;
        // D14-D16: the description the window has, its <description> element written by the
        // core's FB2 writer (D15), and the genres as the interface named them (012 D6).
        if (params.contains("description") && params["description"].is_object()) {
            try {
                input.description = model::description_from_json(params["description"]);
                model::Document only;
                only.description = *input.description;
                const std::string xml = fb2::write_document(only, nullptr).text;
                const auto from = xml.find("<description");
                const auto to = xml.find("</description>");
                if (from != std::string::npos && to != std::string::npos) {
                    // A standalone element: the namespaces its document's root declared go on it,
                    // so that the record reads back on its own (a later import, D15).
                    input.description_xml =
                        "<description xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
                        "xmlns:l=\"http://www.w3.org/1999/xlink\"" +
                        xml.substr(from + 12, to + 14 - from - 12);
                }
            } catch (const std::exception& error) {
                throw failed("pdf.checkFailed",
                             json{{"message", std::string("the description: ") + error.what()}});
            }
        }
        input.genre_names = rpc::params::string_array_or(params, "genreNames");
        input.hints = rpc::params::string_or(params, "hints", "");
        // D17: the bookmarks of the page map, nested.
        if (params.contains("pageMap") && params["pageMap"].is_object() &&
            params["pageMap"].contains("bookmarks") && params["pageMap"]["bookmarks"].is_array()) {
            const std::function<std::vector<pdf::Bookmark>(const json&, int)> marks =
                [&marks](const json& list, int depth) {
                    std::vector<pdf::Bookmark> out;
                    for (const json& item : list) {
                        if (!item.is_object() || depth > 64)
                            continue;
                        pdf::Bookmark mark;
                        mark.title = item.value("title", std::string());
                        mark.page = item.value("page", 0);
                        mark.y = item.value("y", 0.0);
                        if (item.contains("children") && item["children"].is_array()) {
                            mark.children = marks(item["children"], depth + 1);
                        }
                        out.push_back(std::move(mark));
                    }
                    return out;
                };
            input.bookmarks = marks(params["pageMap"]["bookmarks"], 0);
        }
        // DP-18: the text each page shows, for the check of the finished file.
        std::vector<std::string> page_texts;
        if (params.contains("pageMap") && params["pageMap"].is_object() &&
            params["pageMap"].contains("text") && params["pageMap"]["text"].is_array()) {
            for (const json& t : params["pageMap"]["text"]) {
                page_texts.push_back(t.is_string() ? t.get<std::string>() : std::string());
            }
        }
        // R4: the picture boxes of the page map, and the bytes of their binaries, taken here on
        // the server's thread from the book's session.
        if (params.contains("pageMap") && params["pageMap"].is_object() &&
            params["pageMap"].contains("pictures") && params["pageMap"]["pictures"].is_array()) {
            const session::DocumentSession* s = services.documents.find(e.doc_id);
            for (const json& p : params["pageMap"]["pictures"]) {
                if (!p.is_object())
                    continue;
                pdf::PlacedPicture placed;
                placed.page = p.value("page", 0);
                placed.x = p.value("x", 0.0);
                placed.y = p.value("y", 0.0);
                placed.width = p.value("width", 0.0);
                placed.height = p.value("height", 0.0);
                placed.binary_id = p.value("binaryId", std::string());
                if (s != nullptr && !input.binaries.contains(placed.binary_id)) {
                    if (const auto bytes = s->binaries->bytes(placed.binary_id)) {
                        input.binaries.emplace(placed.binary_id, std::string(*bytes));
                    }
                }
                input.pictures.push_back(std::move(placed));
            }
        }
        // R10: the hints go into the file only when they are sound.
        if (!input.hints.empty()) {
            if (const std::string fault = pdf::validate_hints(input.hints, page_texts);
                !fault.empty()) {
                throw failed("pdf.checkFailed", json{{"message", "the editor's hints: " + fault}});
            }
        }
        const std::string job_id = ctx.jobs.start([&services, token, e, input,
                                                   page_texts](rpc::JobControl& control) -> json {
            control.progress("finish", 0, 1);
            // DP-3: the printed parts, joined into one file; then R3: finished as PDF/A-2 level
            // U.
            std::vector<std::vector<char>> printed;
            for (int part = 0; part < e.parts; ++part) {
                try {
                    const std::string part_bytes = atomic_file::read_file(part_pdf(e, part));
                    printed.emplace_back(part_bytes.begin(), part_bytes.end());
                } catch (const std::exception&) {
                    throw failed("pdf.noPart", json{{"part", part}});
                }
                control.check_cancelled();
            }
            // Progress at least once a second (SC-010): each part joined, then the writing
            // (which Poppler does in one go, shown as busy), then each page checked. A fault
            // of the PDF library is reported as the check's; a cancellation stays one.
            const auto library = [](auto&& step) {
                try {
                    return step();
                } catch (const rpc::RpcError&) {
                    throw;
                } catch (const std::runtime_error& error) {
                    throw failed("pdf.checkFailed", json{{"message", error.what()}});
                }
            };
            std::vector<char> joined = library([&] {
                return pdf::join_parts(std::move(printed), [&control](int done, int total) {
                    control.progress("join", done, total);
                });
            });
            control.check_cancelled();
            control.progress("write", 0, 0);
            pdf::FinishReport report;
            std::vector<char> finished =
                library([&] { return pdf::finish(std::move(joined), input, &report); });
            control.check_cancelled();
            std::string bytes;
            // DP-18: the finished file is read back before anything is written.
            auto last = std::chrono::steady_clock::now();
            const std::vector<std::string> faults =
                pdf::check_finished(finished, page_texts, [&control, &last](int done, int total) {
                    const auto now = std::chrono::steady_clock::now();
                    if (done == total || now - last > std::chrono::milliseconds(200)) {
                        control.progress("check", done, total);
                        last = now;
                    }
                });
            if (!faults.empty()) {
                std::string message;
                for (std::size_t i = 0; i < faults.size() && i < 5; ++i) {
                    message += (i ? "; " : "") + faults[i];
                }
                throw failed("pdf.checkFailed", json{{"message", message}});
            }
            bytes.assign(finished.begin(), finished.end());
            control.check_cancelled();
            try {
                atomic_file::write_atomic(e.target, bytes);
            } catch (const std::exception& error) {
                throw failed("pdf.ioError", json{{"message", error.what()}});
            }
            {
                std::lock_guard lock(services.pdf.mutex);
                services.pdf.exports.erase(token);
            }
            remove_work(e.work);
            control.progress("finish", 1, 1);
            // D7: the characters no shipped font draws (drawn with a system font, or as a
            // replacement mark), for the summary.
            const std::u32string uncovered =
                pdf::uncovered_characters(page_texts, services.resources_dir / "fonts");
            return json{{"path", platform::utf8_from_path(e.target)},
                        {"bytes", bytes.size()},
                        {"uncovered", pdf::utf8(uncovered)},
                        {"picturesLeftOut", report.pictures_left_out}};
        });
        return json{{"jobId", job_id}};
    });

    router.add_method("pdf.export.abort", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        fs::path work;
        {
            std::lock_guard lock(services.pdf.mutex);
            const auto it = services.pdf.exports.find(token);
            if (it == services.pdf.exports.end()) {
                return json{{"known", false}};
            }
            work = it->second.work;
            services.pdf.exports.erase(it);
        }
        if (std::shared_ptr<PrintService> printer = services.print_service()) {
            printer->cancel();
        }
        remove_work(work);
        return json{{"known", true}};
    });
}

}  // namespace mfbe::server
