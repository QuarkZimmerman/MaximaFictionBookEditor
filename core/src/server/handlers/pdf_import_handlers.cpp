// Feature 016 (contracts/rpc-api.md): the core's part of the PDF import. The reader process reads
// the PDF into the import's folder (PD2); the core serves that folder to the interface over a
// route, hands the reader a password, and adds the pictures the interface takes to the new book.
// Bulk data never travel in JSON.
//
//   pdfImport.begin {path, entry?} -> {token} | {archive: {pdfs: [name], fbds: [name]}} (a ZIP
//   without
//        `entry` is listed first)
//   pdfImport.inspect {token} -> {opened, pages} | {needsPassword} | {ownerPassword}; 1113 {reason}
//   pdfImport.password {token, password} -> as inspect, {wrongPassword} after a wrong one
//   pdfImport.read {token} -> job: progress per page -> {pages, kinds}; 1113 {reason}
//   pdfImport.addPictures {token, docId, pictures: [{id, page, suggestedId?}]} -> {added: [{id,
//   binary}],
//        failed: [id]}
//   pdfImport.end {token} -> {}
//   GET /pdf-import/{token}/document | /page/{n} | /picture/{file}
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <random>

namespace mfbe::server {

namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

constexpr std::uintmax_t kMaxPdfBytes = 1024ull * 1024 * 1024;  // DP-3

std::string new_token() {
    std::random_device rd;
    static const char* kHex = "0123456789abcdef";
    std::string token;
    for (int i = 0; i < 32; ++i) {
        token.push_back(kHex[rd() & 0x0F]);
    }
    return token;
}

rpc::RpcError failed(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kPdfImportFailed, "", std::move(data));
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}

bool ends_with(const std::string& s, const std::string& tail) {
    return s.size() >= tail.size() && s.compare(s.size() - tail.size(), tail.size(), tail) == 0;
}

std::shared_ptr<pdf_import::Session> find(Services& services, const json& params) {
    const std::string token = rpc::params::string(params, "token");
    std::lock_guard lock(services.pdf_import.mutex);
    const auto it = services.pdf_import.sessions.find(token);
    if (it == services.pdf_import.sessions.end()) {
        throw rpc::RpcError(rpc::codes::kPdfImportUnknownToken, "", json{{"token", token}});
    }
    return it->second;
}

json checked(const json& answer) {
    if (answer.contains("failed")) {
        throw failed(answer["failed"].get<std::string>());
    }
    return answer;
}

void end_plain(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

void serve(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
           uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string token = LoopbackServer::url_decode(req->getParameter(0));
    // The part after "/pdf-import/<token>/" (uWS does not capture a wildcard as a parameter).
    const std::string url(req->getUrl());
    const std::string prefix = "/pdf-import/" + std::string(req->getParameter(0)) + "/";
    const std::string rest = url.rfind(prefix, 0) == 0
                                 ? LoopbackServer::url_decode(url.substr(prefix.size()))
                                 : std::string();
    fs::path folder;
    {
        std::lock_guard lock(services.pdf_import.mutex);
        const auto it = services.pdf_import.sessions.find(token);
        if (it == services.pdf_import.sessions.end()) {
            end_plain(res, "404 Not Found", "unknown PDF import token");
            return;
        }
        folder = it->second->folder();
    }
    std::string file;
    std::string type = "application/json";
    if (rest == "document") {
        file = "document.json";
    } else if (rest.rfind("page/", 0) == 0 && rest.size() > 5 &&
               std::all_of(rest.begin() + 5, rest.end(),
                           [](unsigned char c) { return std::isdigit(c); })) {
        file = "page-" + rest.substr(5) + ".json";
    } else if (rest.rfind("picture/", 0) == 0 && rest.find("..") == std::string::npos &&
               rest.find('/', 8) == std::string::npos) {
        file = "pictures/" + rest.substr(8);
        type = ends_with(file, ".png") ? "image/png" : "image/jpeg";
    } else {
        end_plain(res, "404 Not Found", "no such part");
        return;
    }
    std::ifstream in(folder / file, std::ios::binary);
    if (!in) {
        end_plain(res, "404 Not Found", "not written yet");
        return;
    }
    const std::string bytes{std::istreambuf_iterator<char>(in), {}};
    res->writeStatus("200 OK");
    res->writeHeader("Content-Type", type);
    res->writeHeader("Cache-Control", "no-store");
    res->writeHeader("X-Content-Type-Options", "nosniff");
    res->end(bytes);
}

}  // namespace

void register_pdf_import_http(LoopbackServer& server, Services& services) {
    server.app().get("/pdf-import/:token/*", [&server, &services](auto* res, auto* req) {
        serve(server, services, res, req);
    });
}

void register_pdf_import_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("pdfImport.begin", [&services](const json& params, rpc::RpcContext&) {
        const fs::path path = platform::path_from_utf8(rpc::params::string(params, "path"));
        const auto entry = rpc::params::opt_string(params, "entry");
        const fs::path root = services.dirs.state / "pdf-import";
        {
            std::lock_guard lock(services.pdf_import.mutex);
            if (!services.pdf_import.cleaned) {
                pdf_import::remove_stale_folders(root);
                services.pdf_import.cleaned = true;
            }
        }
        std::error_code ec;
        if (!fs::is_regular_file(path, ec)) {
            throw failed("notPdf");
        }
        const std::string token = new_token();
        const fs::path folder = root / token;
        fs::create_directories(folder, ec);
        fs::permissions(folder, fs::perms::owner_all, fs::perm_options::replace, ec);
        fs::path pdf = path;
        if (archive::detect_kind(path) == archive::Kind::zip) {
            if (!entry) {
                fs::remove_all(folder, ec);
                json pdfs = json::array(), fbds = json::array();
                try {
                    for (const archive::Entry& e : archive::list(path).entries) {
                        const std::string name = lower(e.name);
                        const json item{{"entry", e.name}, {"size", e.size}};
                        if (ends_with(name, ".pdf")) {
                            pdfs.push_back(item);
                        } else if (ends_with(name, ".fbd")) {
                            fbds.push_back(item);
                        }
                    }
                } catch (const archive::ArchiveError& e) {
                    throw failed(archive::reason_name(e.reason));
                }
                if (pdfs.empty()) {
                    throw failed("noPdfInArchive");
                }
                return json{{"archive", {{"pdfs", pdfs}, {"fbds", fbds}}}};
            }
            try {
                const std::string bytes = archive::read_entry(path, *entry);
                pdf = folder / "source.pdf";
                std::ofstream(pdf, std::ios::binary) << bytes;
            } catch (const archive::ArchiveError& e) {
                fs::remove_all(folder, ec);
                throw failed(archive::reason_name(e.reason));
            }
        } else if (fs::file_size(path, ec) > kMaxPdfBytes) {
            fs::remove_all(folder, ec);
            throw failed("tooLarge");
        }
        {
            std::ifstream in(pdf, std::ios::binary);
            char head[5] = {};
            in.read(head, 5);
            if (std::string(head, 5) != "%PDF-") {
                fs::remove_all(folder, ec);
                throw failed("notPdf");
            }
        }
        const int quality = services.conversion_policy().jpeg_quality;
        auto session = std::make_shared<pdf_import::Session>(folder, pdf, quality,
                                                             services.resources_dir / "fonts");
        std::lock_guard lock(services.pdf_import.mutex);
        services.pdf_import.sessions.emplace(token, std::move(session));
        return json{{"token", token}};
    });
    router.add_method("pdfImport.inspect", [&services](const json& params, rpc::RpcContext&) {
        auto session = find(services, params);
        std::lock_guard lock(session->mutex());
        return checked(session->inspect());
    });
    router.add_method("pdfImport.password", [&services](const json& params, rpc::RpcContext&) {
        auto session = find(services, params);
        std::lock_guard lock(session->mutex());
        return checked(session->password(rpc::params::string(params, "password")));
    });
    router.add_method("pdfImport.read", [&services](const json& params, rpc::RpcContext& ctx) {
        auto session = find(services, params);
        const std::string job_id = ctx.jobs.start([session](rpc::JobControl& control) -> json {
            std::lock_guard lock(session->mutex());
            json kinds;
            int pages = 0;
            const std::string reason = session->read(
                [&control, &pages](int n, int total) {
                    pages = total;
                    if (n > 0) {
                        control.progress("read", n, total);
                    }
                    return !control.cancelled();
                },
                kinds);
            if (reason == "cancelled") {
                control.check_cancelled();
            }
            if (!reason.empty()) {
                throw failed(reason);
            }
            return json{{"pages", pages}, {"kinds", kinds}};
        });
        return json{{"jobId", job_id}};
    });
    router.add_method("pdfImport.addPictures", [&services](const json& params, rpc::RpcContext&) {
        auto session = find(services, params);
        session::DocumentSession& doc =
            services.documents.require(rpc::params::string(params, "docId"));
        json added = json::array(), not_added = json::array();
        std::lock_guard lock(session->mutex());
        for (const auto& wanted : params.value("pictures", json::array())) {
            const std::string id = wanted.value("id", "");
            const json event = session->picture(id, wanted.value("page", 0));
            if (event.value("event", "") != "picture") {
                not_added.push_back(id);
                continue;
            }
            std::ifstream in(session->folder() / event.value("file", ""), std::ios::binary);
            std::string bytes{std::istreambuf_iterator<char>(in), {}};
            const std::string suggested = wanted.value("suggestedId", "picture");
            const std::string binary_id =
                doc.binaries->unique_id(suggested.empty() ? "picture" : suggested);
            const model::BinaryMeta meta = doc.binaries->put(
                binary_id, event.value("contentType", "image/jpeg"), std::move(bytes));
            added.push_back({{"id", id}, {"binary", model::to_json(meta)}});
        }
        if (doc.snapshot) {
            sync_binaries(*doc.snapshot, *doc.binaries);
        }
        return json{{"added", added}, {"failed", not_added}};
    });
    router.add_method("pdfImport.end", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::shared_ptr<pdf_import::Session> session;
        {
            std::lock_guard lock(services.pdf_import.mutex);
            const auto it = services.pdf_import.sessions.find(token);
            if (it != services.pdf_import.sessions.end()) {
                session = it->second;
                services.pdf_import.sessions.erase(it);
            }
        }
        if (session) {
            session->end();
        }
        return json::object();
    });
}

}  // namespace mfbe::server
