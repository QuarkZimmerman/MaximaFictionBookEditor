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

#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/print_service.hpp>
#include <mfbe/rpc.hpp>

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
    "<script>document.fonts.ready.then(function(){document.title='mfbe-print-ready';});</script>";

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
    res->writeHeader("Content-Type", "text/html; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->writeHeader("X-Content-Type-Options", "nosniff");
    res->end(html);
}

}  // namespace

void register_pdf_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
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
        const std::string job_id = ctx.jobs.start([&services, token,
                                                   e](rpc::JobControl& control) -> json {
            control.progress("finish", 0, 1);
            // Tasks T025 onwards finish the file (pictures, metadata, bookmarks, PDF/A,
            // checks); until then the printed parts are written as they are.
            if (e.parts != 1) {
                throw failed("pdf.checkFailed", json{{"message", "several parts not joined yet"}});
            }
            std::string bytes;
            try {
                bytes = atomic_file::read_file(part_pdf(e, 0));
            } catch (const std::exception&) {
                throw failed("pdf.noPart", json{{"part", 0}});
            }
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
            return json{{"path", platform::utf8_from_path(e.target)}, {"bytes", bytes.size()}};
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
