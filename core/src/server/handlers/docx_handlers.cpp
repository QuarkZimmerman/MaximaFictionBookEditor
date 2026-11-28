// Feature 023 (T010; contracts/rpc-api.md §3–§4): DOCX export & import JSON-RPC handlers and
// authenticated loopback HTTP routes (`/docx-write/:token/parts`, `/docx-import/:token/part`).
#include "server/loopback_server.hpp"
#include "server/services.hpp"
#include "util/sha256.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/docx.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <random>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::server {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

constexpr std::size_t kMaxPartsUploadBytes = 256ull << 20;

std::string new_token() {
    static constexpr char kHex[] = "0123456789abcdef";
    std::random_device rd;
    std::string token;
    token.reserve(32);
    for (int i = 0; i < 32; ++i) {
        token.push_back(kHex[rd() & 0x0F]);
    }
    return token;
}

rpc::RpcError write_failed(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kDocxWriteFailed, "", std::move(data));
}

rpc::RpcError refused(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kDocxRefused, "", std::move(data));
}

rpc::RpcError unknown_token(const std::string& token) {
    return rpc::RpcError(rpc::codes::kDocxUnknownToken, "", json{{"token", token}});
}

std::string lower_ascii(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return out;
}

bool ends_with_ci(std::string_view s, std::string_view suffix) {
    if (s.size() < suffix.size()) {
        return false;
    }
    return lower_ascii(s.substr(s.size() - suffix.size())) == suffix;
}

bool same_file_or_path(const fs::path& a, const fs::path& b) {
    std::error_code ec;
    if (fs::exists(a, ec) && fs::exists(b, ec) && fs::equivalent(a, b, ec) && !ec) {
        return true;
    }
    const fs::path na = fs::weakly_canonical(a, ec);
    if (ec) {
        return a.lexically_normal() == b.lexically_normal();
    }
    const fs::path nb = fs::weakly_canonical(b, ec);
    if (ec) {
        return a.lexically_normal() == b.lexically_normal();
    }
    return na == nb;
}

void sweep_stale_dirs_once(Services& services) {
    std::lock_guard lock(services.docx.mutex);
    if (services.docx.cleaned) {
        return;
    }
    services.docx.cleaned = true;
    std::error_code ec;
    fs::remove_all(services.dirs.state / "docx-import", ec);
    fs::remove_all(services.dirs.state / "docx-write", ec);
}

void end_plain(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

std::shared_ptr<Services::DocxImportSession> require_import(Services& services,
                                                            const std::string& token) {
    std::lock_guard lock(services.docx.mutex);
    const auto it = services.docx.imports.find(token);
    if (it == services.docx.imports.end()) {
        throw unknown_token(token);
    }
    return it->second;
}

std::shared_ptr<Services::DocxWriteSession> require_writer(Services& services,
                                                           const std::string& token) {
    std::lock_guard lock(services.docx.mutex);
    const auto it = services.docx.writers.find(token);
    if (it == services.docx.writers.end()) {
        throw unknown_token(token);
    }
    return it->second;
}

std::string content_type_for_part(std::string_view name) {
    if (ends_with_ci(name, ".xml") || ends_with_ci(name, ".rels")) {
        return "application/xml; charset=utf-8";
    }
    if (ends_with_ci(name, ".svg")) {
        return "image/svg+xml";
    }
    if (ends_with_ci(name, ".png")) {
        return "image/png";
    }
    if (ends_with_ci(name, ".jpg") || ends_with_ci(name, ".jpeg")) {
        return "image/jpeg";
    }
    return "application/octet-stream";
}

void handle_upload_parts(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                         uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string token = LoopbackServer::url_decode(req->getParameter(0));
    auto buffer = std::make_shared<std::string>();
    const std::string_view cl_hdr = req->getHeader("content-length");
    if (!cl_hdr.empty() && cl_hdr.find_first_not_of("0123456789") == std::string_view::npos) {
        try {
            const std::size_t expected = static_cast<std::size_t>(std::stoull(std::string(cl_hdr)));
            if (expected <= kMaxPartsUploadBytes) {
                buffer->reserve(expected);
            }
        } catch (...) {
            // Ignore malformed Content-Length and let onData enforce the size cap.
        }
    }
    auto aborted = std::make_shared<bool>(false);
    res->onAborted([aborted] { *aborted = true; });
    res->onData([res, buffer, aborted, &services, token](std::string_view chunk, bool last) {
        if (*aborted) {
            return;
        }
        if (buffer->size() + chunk.size() > kMaxPartsUploadBytes) {
            *aborted = true;
            end_plain(res, "413 Payload Too Large", "DOCX parts upload exceeds 256 MB limit");
            return;
        }
        buffer->append(chunk);
        if (!last) {
            return;
        }

        std::shared_ptr<Services::DocxWriteSession> session;
        {
            std::lock_guard lock(services.docx.mutex);
            const auto it = services.docx.writers.find(token);
            if (it == services.docx.writers.end()) {
                end_plain(res, "404 Not Found", "unknown DOCX write token");
                return;
            }
            session = it->second;
        }

        json payload;
        try {
            payload = json::parse(*buffer);
        } catch (const std::exception& e) {
            end_plain(res, "400 Bad Request", std::string("invalid JSON: ") + e.what());
            return;
        }
        if (!payload.is_array()) {
            end_plain(res, "400 Bad Request", "parts body must be a JSON array");
            return;
        }

        std::lock_guard slock(session->mutex);
        std::size_t staged = 0;
        try {
            for (const json& item : payload) {
                if (!item.is_object() || !item.contains("name") || !item.contains("content") ||
                    !item["name"].is_string() || !item["content"].is_string()) {
                    end_plain(res, "400 Bad Request",
                              "each part must be an object with string name and content");
                    return;
                }
                session->writer->add_xml_part(item["name"].get<std::string>(),
                                              item["content"].get<std::string>());
                ++staged;
            }
        } catch (const std::exception& e) {
            end_plain(res, "400 Bad Request", e.what());
            return;
        }

        const std::string body = json{{"staged", staged}}.dump();
        res->writeStatus("200 OK");
        res->writeHeader("Content-Type", "application/json; charset=utf-8");
        res->writeHeader("Cache-Control", "no-store");
        res->end(body);
    });
}

void handle_get_import_part(LoopbackServer& server, Services& services,
                            uWS::HttpResponse<false>* res, uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string token = LoopbackServer::url_decode(req->getParameter(0));
    const std::string name = LoopbackServer::url_decode(req->getQuery("name"));
    if (name.empty()) {
        end_plain(res, "400 Bad Request", "missing part name query parameter");
        return;
    }

    std::shared_ptr<Services::DocxImportSession> session;
    {
        std::lock_guard lock(services.docx.mutex);
        const auto it = services.docx.imports.find(token);
        if (it == services.docx.imports.end()) {
            end_plain(res, "404 Not Found", "unknown DOCX import token");
            return;
        }
        session = it->second;
    }

    std::lock_guard slock(session->mutex);
    if (!session->opened.has_value()) {
        end_plain(res, "404 Not Found", "DOCX archive not opened");
        return;
    }
    try {
        const std::string bytes = docx::read_docx_entry(*session->opened, name);
        res->writeStatus("200 OK");
        res->writeHeader("Content-Type", content_type_for_part(name));
        res->writeHeader("Cache-Control", "no-store");
        res->end(bytes);
    } catch (const std::out_of_range&) {
        end_plain(res, "404 Not Found", "DOCX entry not found");
    } catch (const docx::DocxRefused& e) {
        end_plain(res, "400 Bad Request", e.what());
    }
}

}  // namespace

void register_docx_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
    app.put("/docx-write/:token/parts", [&server, &services](auto* res, auto* req) {
        handle_upload_parts(server, services, res, req);
    });
    app.get("/docx-import/:token/part", [&server, &services](auto* res, auto* req) {
        handle_get_import_part(server, services, res, req);
    });
}

void register_docx_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("docx.write.begin", [&services](const json& params, rpc::RpcContext&) {
        sweep_stale_dirs_once(services);
        const std::string doc_id = rpc::params::string(params, "docId");
        const std::string path = rpc::params::string(params, "path");
        const bool zip = rpc::params::boolean_or(params, "zip", false);

        const fs::path target = platform::path_from_utf8(path);
        const session::DocumentSession& doc = services.documents.require(doc_id);
        if (doc.path && same_file_or_path(target, *doc.path)) {
            throw write_failed("targetIsSource", json{{"path", path}});
        }

        const std::string token = new_token();
        auto session = std::make_shared<Services::DocxWriteSession>();
        session->writer = std::make_unique<docx::DocxPackageWriter>(target, zip);
        session->doc_id = doc_id;
        session->work_dir = services.dirs.state / "docx-write" / token;

        std::lock_guard lock(services.docx.mutex);
        services.docx.writers.emplace(token, std::move(session));
        return json{{"token", token}};
    });

    router.add_method("docx.write.picture", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::string binary_id = rpc::params::string(params, "binaryId");
        const std::string media_name = rpc::params::string(params, "mediaName");

        auto session = require_writer(services, token);
        session::DocumentSession& doc = services.documents.require(session->doc_id);
        const auto raw = doc.binaries->bytes(binary_id);
        if (!raw) {
            return json{{"missing", true}};
        }

        const images::Probe probe = images::probe(*raw);
        if (!probe.decodable) {
            return json{{"unreadable", true}};
        }

        images::ConversionPolicy policy = services.conversion_policy();
        policy.preferred = images::Format::jpeg;
        policy.png_when_alpha = true;
        policy.png_when_few_colours = true;
        std::string err;
        auto converted = images::convert(*raw, policy, &err, false);
        if (!converted) {
            return json{{"unreadable", true}};
        }

        const std::string digest = util::sha256_hex(converted->bytes);
        const std::size_t byte_count = converted->bytes.size();
        const std::string content_type = converted->content_type;
        const bool was_converted = converted->changed;
        const images::Probe final_probe = was_converted ? images::probe(converted->bytes) : probe;

        // Ensure the staged media entry's extension matches its actual encoded content type so
        // OOXML `[Content_Types].xml` default mappings (`jpg` / `png`) always agree with the bytes.
        std::string final_media_name = media_name;
        const std::string wanted_ext = content_type == "image/png" ? ".png" : ".jpg";
        if (!ends_with_ci(final_media_name, wanted_ext)) {
            const std::size_t dot = final_media_name.rfind('.');
            const std::size_t slash = final_media_name.rfind('/');
            if (dot != std::string::npos && (slash == std::string::npos || dot > slash)) {
                final_media_name.resize(dot);
            }
            final_media_name += wanted_ext;
        }

        std::lock_guard slock(session->mutex);
        try {
            session->writer->add_media_part(final_media_name, std::move(converted->bytes));
        } catch (const std::exception& e) {
            throw write_failed("badPart", json{{"detail", e.what()}});
        }

        return json{
            {"mediaName", final_media_name},
            {"contentType", content_type},
            {"width", final_probe.width.value_or(probe.width.value_or(0))},
            {"height", final_probe.height.value_or(probe.height.value_or(0))},
            {"bytes", byte_count},
            {"sha256", digest},
            {"converted", was_converted},
        };
    });

    router.add_method("docx.write.commit", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::shared_ptr<Services::DocxWriteSession> session;
        {
            std::lock_guard lock(services.docx.mutex);
            const auto it = services.docx.writers.find(token);
            if (it == services.docx.writers.end()) {
                throw unknown_token(token);
            }
            session = std::move(it->second);
            services.docx.writers.erase(it);
        }

        // Generate companion FBD on the loop thread while the open DocumentSession is accessible.
        std::string fbd_bytes;
        if (session->writer->zip_with_fbd()) {
            std::error_code ec;
            fs::create_directories(session->work_dir, ec);
            fs::path fbd_path = session->work_dir / session->writer->target().stem();
            fbd_path += ".fbd";  // path-text: ASCII extension
            try {
                write_description_file(services, session->doc_id, params,
                                       platform::utf8_from_path(fbd_path));
                fbd_bytes = atomic_file::read_file(fbd_path);
            } catch (...) {
                fs::remove_all(session->work_dir, ec);
                throw;
            }
            fs::remove_all(session->work_dir, ec);
        }

        const std::string job_id =
            services.jobs.start([session = std::move(session), fbd_bytes = std::move(fbd_bytes)](
                                    rpc::JobControl& control) -> json {
                control.progress("write", 1, 3);
                control.check_cancelled();
                std::uint64_t written = 0;
                try {
                    std::lock_guard slock(session->mutex);
                    written = session->writer->commit(fbd_bytes);
                } catch (const std::runtime_error& e) {
                    const std::string msg = e.what();
                    if (msg.find("malformed OOXML") != std::string::npos ||
                        msg.find("missing required OOXML") != std::string::npos ||
                        msg.find("missing staged DOCX media") != std::string::npos) {
                        throw write_failed("checkFailed", json{{"detail", msg}});
                    }
                    throw write_failed("ioError", json{{"detail", msg}});
                }
                control.progress("write", 3, 3);
                return json{
                    {"path", platform::utf8_from_path(session->writer->target())},
                    {"bytes", written},
                    {"zip", session->writer->zip_with_fbd()},
                };
            });
        return json{{"jobId", job_id}};
    });

    router.add_method("docx.write.abort", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::shared_ptr<Services::DocxWriteSession> session;
        {
            std::lock_guard lock(services.docx.mutex);
            const auto it = services.docx.writers.find(token);
            if (it != services.docx.writers.end()) {
                session = std::move(it->second);
                services.docx.writers.erase(it);
            }
        }
        if (session) {
            std::error_code ec;
            fs::remove_all(session->work_dir, ec);
        }
        return json{{"ok", true}};
    });

    router.add_method("docxImport.begin", [&services](const json& params, rpc::RpcContext&) {
        sweep_stale_dirs_once(services);
        const std::string path_str = rpc::params::string(params, "path");
        const std::optional<std::string> requested_entry = rpc::params::opt_string(params, "entry");
        const fs::path source_path = platform::path_from_utf8(path_str);

        const docx::DocxSniffResult sniff = docx::sniff_docx_file(source_path);
        switch (sniff.kind) {
            case docx::DocxSniffKind::encrypted_office:
                throw refused("encrypted", json{{"path", path_str}, {"detail", sniff.detail}});
            case docx::DocxSniffKind::legacy_doc:
                throw refused("legacyDoc", json{{"path", path_str}, {"detail", sniff.detail}});
            case docx::DocxSniffKind::macro_enabled_docm:
                throw refused("macroEnabled", json{{"path", path_str}, {"detail", sniff.detail}});
            case docx::DocxSniffKind::fiction_book:
                throw refused("fictionBook", json{{"path", path_str}});
            case docx::DocxSniffKind::other_archive:
                throw refused("otherArchive", json{{"path", path_str}, {"kind", sniff.detail}});
            case docx::DocxSniffKind::not_docx:
                if (archive::detect_kind(source_path) == archive::Kind::zip) {
                    throw refused("noDocxInArchive", json{{"path", path_str}});
                }
                throw refused("notDocx", json{{"path", path_str}, {"detail", sniff.detail}});
            case docx::DocxSniffKind::docx:
            case docx::DocxSniffKind::outer_zip_with_docx:
                break;
        }

        // Outer ZIP archive holding one or more `.docx` files.
        if (sniff.kind == docx::DocxSniffKind::outer_zip_with_docx) {
            archive::Listing listing;
            try {
                listing = archive::list(source_path);
            } catch (const archive::ArchiveError& e) {
                if (e.reason == archive::Reason::encrypted) {
                    throw refused("archiveEncrypted", json{{"path", path_str}});
                }
                if (e.reason == archive::Reason::too_large) {
                    throw refused("archiveTooLarge", json{{"path", path_str}});
                }
                throw refused("archiveDamaged", json{{"path", path_str}, {"detail", e.what()}});
            }

            std::vector<std::string> docx_entries;
            std::vector<std::string> fbd_entries;
            for (const archive::Entry& rec : listing.entries) {
                if (rec.directory || !docx::valid_docx_entry_name(rec.name)) {
                    continue;
                }
                if (docx::is_docx_extension(rec.name)) {
                    docx_entries.push_back(rec.name);
                } else if (ends_with_ci(rec.name, ".fbd")) {
                    fbd_entries.push_back(rec.name);
                }
            }
            if (docx_entries.empty()) {
                throw refused("noDocxInArchive", json{{"path", path_str}});
            }
            if (!requested_entry.has_value() || requested_entry->empty()) {
                if (docx_entries.size() > 1) {
                    return json{
                        {"archive", true},
                        {"entries", docx_entries},
                        {"fbdEntries", fbd_entries},
                    };
                }
            }

            const std::string chosen =
                (requested_entry && !requested_entry->empty()) ? *requested_entry : docx_entries[0];
            std::string extracted_bytes;
            try {
                extracted_bytes = archive::read_entry(source_path, chosen);
            } catch (const archive::ArchiveError& e) {
                if (e.reason == archive::Reason::encrypted) {
                    throw refused("archiveEncrypted", json{{"path", path_str}});
                }
                if (e.reason == archive::Reason::too_large) {
                    throw refused("archiveTooLarge", json{{"path", path_str}});
                }
                throw refused("archiveDamaged", json{{"path", path_str}, {"detail", e.what()}});
            }

            const std::string token = new_token();
            const fs::path folder = services.dirs.state / "docx-import" / token;
            std::error_code ec;
            fs::create_directories(folder, ec);
            const fs::path temp_docx = folder / "book.docx";
            atomic_file::write_atomic(temp_docx, extracted_bytes);

            docx::DocxOpenedArchive opened;
            try {
                opened = docx::open_docx_archive(temp_docx);
            } catch (const docx::DocxRefused& e) {
                fs::remove_all(folder, ec);
                throw refused(docx::docx_refusal_name(e.reason),
                              json{{"path", path_str}, {"detail", e.what()}});
            }

            auto session = std::make_shared<Services::DocxImportSession>();
            session->source_path = source_path;
            session->archive_path = source_path;
            session->archive_entry = chosen;
            session->folder = folder;
            session->opened = std::move(opened);
            session->fbd_entries = fbd_entries;

            json entry_names = json::array();
            for (const auto& info : session->opened->entries) {
                entry_names.push_back(info.name);
            }
            json result = {
                {"token", token},
                {"entries", std::move(entry_names)},
                {"strayMacros", session->opened->stray_macro_entries},
                {"outside", session->opened->outside_entries},
                {"fromArchive", true},
                {"archiveEntry", chosen},
                {"fbdEntries", fbd_entries},
            };

            std::lock_guard lock(services.docx.mutex);
            services.docx.imports.emplace(token, std::move(session));
            return result;
        }

        // Bare `.docx` file.
        docx::DocxOpenedArchive opened;
        try {
            opened = docx::open_docx_archive(source_path);
        } catch (const docx::DocxRefused& e) {
            throw refused(docx::docx_refusal_name(e.reason),
                          json{{"path", path_str}, {"detail", e.what()}});
        }

        const std::string token = new_token();
        const fs::path folder = services.dirs.state / "docx-import" / token;
        const auto sibling = docx::find_sibling_fbd(source_path);

        auto session = std::make_shared<Services::DocxImportSession>();
        session->source_path = source_path;
        session->folder = folder;
        session->opened = std::move(opened);

        json entry_names = json::array();
        for (const auto& info : session->opened->entries) {
            entry_names.push_back(info.name);
        }
        json result = {
            {"token", token},
            {"entries", std::move(entry_names)},
            {"strayMacros", session->opened->stray_macro_entries},
            {"outside", session->opened->outside_entries},
            {"fromArchive", false},
            {"fbdEntries", json::array()},
        };
        if (sibling.has_value()) {
            result["siblingFbdPath"] = platform::utf8_from_path(*sibling);
        }

        std::lock_guard lock(services.docx.mutex);
        services.docx.imports.emplace(token, std::move(session));
        return result;
    });

    router.add_method("docxImport.picture", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::string doc_id = rpc::params::string(params, "docId");
        const std::string entry = rpc::params::string(params, "entry");
        const std::string binary_id = rpc::params::string(params, "binaryId");

        auto session = require_import(services, token);
        session::DocumentSession& doc = services.documents.require(doc_id);

        std::string raw_bytes;
        {
            std::lock_guard slock(session->mutex);
            if (!session->opened.has_value()) {
                throw refused("damaged", json{{"detail", "DOCX session has no opened archive"}});
            }
            try {
                raw_bytes = docx::read_docx_entry(*session->opened, entry);
            } catch (const std::out_of_range&) {
                return json{{"ok", false}, {"reason", "unreadable"}};
            } catch (const docx::DocxRefused&) {
                return json{{"ok", false}, {"reason", "tooLarge"}};
            }
        }

        if (ends_with_ci(entry, ".svg") || ends_with_ci(entry, ".wmf") ||
            ends_with_ci(entry, ".emf")) {
            return json{{"ok", false}, {"reason", "unsupported"}};
        }

        const images::Probe probe = images::probe(raw_bytes);
        const std::uint64_t pixels = static_cast<std::uint64_t>(probe.width.value_or(0)) *
                                     static_cast<std::uint64_t>(probe.height.value_or(0));
        if (pixels > static_cast<std::uint64_t>(images::kMaxPixels)) {
            return json{{"ok", false}, {"reason", "tooLarge"}};
        }
        if (!probe.decodable) {
            return json{{"ok", false}, {"reason", "unreadable"}};
        }

        images::ConversionPolicy policy = services.conversion_policy();
        if (const json* q = rpc::params::opt_field(params, "jpegQuality");
            q != nullptr && q->is_number_integer()) {
            policy.jpeg_quality = std::clamp(q->get<int>(), 1, 100);
        }
        policy.preferred = images::Format::jpeg;
        policy.png_when_alpha = true;
        policy.png_when_few_colours = true;
        std::string err;
        auto converted = images::convert(raw_bytes, policy, &err, false);
        if (!converted) {
            return json{{"ok", false}, {"reason", "unreadable"}};
        }

        const std::string id = doc.binaries->unique_id(binary_id.empty() ? "picture" : binary_id);
        const std::size_t out_bytes = converted->bytes.size();
        const std::string out_ct = converted->content_type;
        const bool was_converted = converted->changed;
        const model::BinaryMeta meta = doc.binaries->put(id, out_ct, std::move(converted->bytes));
        if (doc.snapshot) {
            sync_binaries(*doc.snapshot, *doc.binaries);
        }
        return json{
            {"ok", true},         {"binary", model::to_json(meta)}, {"contentType", out_ct},
            {"bytes", out_bytes}, {"converted", was_converted},
        };
    });

    router.add_method("docxImport.extractFbd", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::string fbd_entry = rpc::params::string(params, "fbdEntry");
        auto session = require_import(services, token);
        std::lock_guard slock(session->mutex);
        if (!session->archive_path.has_value() || !ends_with_ci(fbd_entry, ".fbd")) {
            throw refused("damaged", json{{"detail", "archive FBD unavailable"}});
        }
        std::string bytes;
        try {
            bytes = archive::read_entry(*session->archive_path, fbd_entry);
        } catch (const archive::ArchiveError& e) {
            throw refused("archiveDamaged", json{{"detail", e.what()}});
        }
        std::error_code ec;
        fs::create_directories(session->folder, ec);
        const fs::path out_file = session->folder / "description.fbd";
        atomic_file::write_atomic(out_file, bytes);
        return json{{"path", platform::utf8_from_path(out_file)}};
    });

    router.add_method("docxImport.end", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::shared_ptr<Services::DocxImportSession> session;
        {
            std::lock_guard lock(services.docx.mutex);
            const auto it = services.docx.imports.find(token);
            if (it != services.docx.imports.end()) {
                session = std::move(it->second);
                services.docx.imports.erase(it);
            }
        }
        if (session) {
            std::lock_guard slock(session->mutex);
            session->opened.reset();
            std::error_code ec;
            fs::remove_all(session->folder, ec);
        }
        return json{{"ok", true}};
    });
}

}  // namespace mfbe::server
