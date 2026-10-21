// binary.* handlers and the /binary HTTP endpoints (T042/T092) - contracts/rpc-api.md §2, §3.3.
//
//   GET  /binary/{docId}/{id}            raw bytes, Content-Type as stored (sniffed when the
//                                        declaration is missing), strong ETag + 304 support
//   GET  /binary/{docId}/{id}/preview?w=&h=   scaled preview (JPEG for opaque images, PNG when
//                                        transparent; JPEG/PNG sources that already fit are
//                                        served unchanged; cached per size); undecodable
//                                        binaries fall back to the original bytes
//   POST /binary/{docId}                 raw upload (body = image, Content-Type = source type,
//                                        optional X-MFBE-Suggested-Id) -> BinaryMeta JSON
//   binary.list({docId}) -> BinaryMeta[]
//   binary.add({docId, path, suggestedId?, convertNow?}) -> BinaryMeta
//        id = suggestedId or the file name, made unique (img.png -> img_2.png); convertNow
//        applies the paste-format policy immediately instead of on save
//   binary.addFromClipboard({docId, suggestedId?}) -> BinaryMeta   (shell-delegated: 1050
//        without a clipboard provider; 1002 {path: "clipboard", reason} when it holds no
//        image; the image is stored in the paste format of the settings)
//   binary.remove({docId, id, force?}) -> {}   (fails while referenced unless force)
//   binary.convert({docId, id, format: "jpeg"|"png", quality?}) -> BinaryMeta
//        explicit conversion (also of JPEG/PNG) to the requested format; same id
//   binary.export({docId, id, path}) -> {}
//   binary.copy({docId, fromDocId, id, suggestedId?}) -> BinaryMeta & {existing}   (feature 004
//        US4): the bytes and metadata of `id` of the session `fromDocId` - the import session
//        of doc.readDescription - copied into the store of `docId` inside the core; content
//        already in `docId` (same hash and bytes) is answered with `existing: true` and nothing
//        is added, else stored under `suggestedId ?? id` made unique (img_2.png style) with
//        `existing: false` and no reference yet; 1000 for either session, 1010 for the id
// Binary payloads never travel inside JSON-RPC (Constitution III).
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/log.hpp>

#include <memory>
#include <string>

namespace mfbe::server {
namespace {

using nlohmann::json;

constexpr std::size_t kMaxUploadBytes = 256ULL * 1024 * 1024;

void end_plain(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

int query_int(uWS::HttpRequest* req, const char* name) {
    const std::string_view value = req->getQuery(name);
    if (value.empty()) {
        return 0;
    }
    int out = 0;
    for (const char c : value) {
        if (c < '0' || c > '9' || out > 100000) {
            return 0;
        }
        out = out * 10 + (c - '0');
    }
    return out;
}

void serve_binary(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                  uWS::HttpRequest* req, bool preview) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string doc_id = LoopbackServer::url_decode(req->getParameter(0));
    const std::string id = LoopbackServer::url_decode(req->getParameter(1));
    const std::string if_none_match(req->getHeader("if-none-match"));
    const bool head = req->getMethod() == "head";
    const int want_w = preview ? query_int(req, "w") : 0;
    const int want_h = preview ? query_int(req, "h") : 0;
    session::DocumentSession* s = services.documents.find(doc_id);
    if (s == nullptr) {
        end_plain(res, "404 Not Found", "unknown document");
        return;
    }
    const auto meta = s->binaries->meta(id);
    if (!meta) {
        end_plain(res, "404 Not Found", "unknown binary");
        return;
    }
    std::string etag = s->binaries->etag(id);
    if (preview && !etag.empty()) {
        etag = "\"p" + std::to_string(want_w) + "x" + std::to_string(want_h) + "-" + etag.substr(1);
    }
    if (!etag.empty() && !if_none_match.empty() && if_none_match.find(etag) != std::string::npos) {
        res->writeStatus("304 Not Modified");
        res->writeHeader("ETag", etag);
        res->writeHeader("Cache-Control", "private, no-cache");
        res->end();
        return;
    }
    const auto bytes = s->binaries->bytes(id);
    if (!bytes) {
        end_plain(res, "500 Internal Server Error", "binary payload unavailable");
        return;
    }
    std::string content_type = s->binaries->effective_content_type(id);
    std::string body;
    if (preview && meta->decodable && !s->binaries->is_raw_text(id)) {
        std::string error;
        const auto scaled = services.previews.get(doc_id + "/" + id + "@" + s->binaries->etag(id),
                                                  *bytes, want_w, want_h, &error);
        if (scaled) {
            body = scaled->bytes;
            content_type = scaled->content_type;
            res->writeStatus("200 OK");
            res->writeHeader("X-MFBE-Preview-Width", std::to_string(scaled->width));
            res->writeHeader("X-MFBE-Preview-Height", std::to_string(scaled->height));
        } else {
            log::warning("core", "image.previewFailed", "preview could not be generated",
                         log::extras({{"id", id}, {"reason", error}}));
            body = *bytes;  // fall back to the original bytes
            res->writeStatus("200 OK");
        }
    } else {
        body = *bytes;
        res->writeStatus("200 OK");
    }
    res->writeHeader("Content-Type", content_type);
    res->writeHeader("ETag", etag);
    res->writeHeader("Cache-Control", "private, no-cache");
    res->writeHeader("X-Content-Type-Options", "nosniff");
    if (head) {
        res->endWithoutBody(body.size());
        return;
    }
    res->end(body);
}

void upload_binary(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                   uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    // `req` is not valid once the handler returns: copy what the body callback needs.
    const std::string doc_id = LoopbackServer::url_decode(req->getParameter(0));
    const std::string content_type(req->getHeader("content-type"));
    const std::string suggested = LoopbackServer::url_decode(req->getHeader("x-mfbe-suggested-id"));
    if (services.documents.find(doc_id) == nullptr) {
        end_plain(res, "404 Not Found", "unknown document");
        return;
    }
    auto buffer = std::make_shared<std::string>();
    auto aborted = std::make_shared<bool>(false);
    res->onAborted([aborted] { *aborted = true; });
    res->onData([res, buffer, aborted, &services, doc_id, content_type, suggested](
                    std::string_view chunk, bool last) {
        if (*aborted) {
            return;
        }
        if (buffer->size() + chunk.size() > kMaxUploadBytes) {
            *aborted = true;
            end_plain(res, "413 Payload Too Large", "upload exceeds 256 MB");
            return;
        }
        buffer->append(chunk);
        if (!last) {
            return;
        }
        session::DocumentSession* s = services.documents.find(doc_id);
        if (s == nullptr) {
            end_plain(res, "404 Not Found", "unknown document");
            return;
        }
        if (buffer->empty()) {
            end_plain(res, "400 Bad Request", "empty body");
            return;
        }
        const std::string sniffed = images::sniff_content_type(*buffer);
        std::string type = content_type;
        if (type.empty() || type == "application/octet-stream") {
            type = sniffed;
        }
        const std::string id = suggested.empty()
                                   ? s->binaries->next_image_id(type.empty() ? sniffed : type)
                                   : s->binaries->unique_id(suggested);
        const model::BinaryMeta meta = s->binaries->put(id, type, std::move(*buffer));
        if (s->snapshot) {
            sync_binaries(*s->snapshot, *s->binaries);
        }
        res->writeStatus("201 Created");
        res->writeHeader("Content-Type", "application/json; charset=utf-8");
        res->writeHeader("Cache-Control", "no-store");
        res->end(model::to_json(meta).dump());
    });
}

// Stores `bytes` under a unique id derived from `suggested` (or img_<N>.<ext>), optionally
// converting to the paste format first. Returns the metadata.
model::BinaryMeta store_bytes(Services& services, session::DocumentSession& s, std::string bytes,
                              std::string declared_type, const std::string& suggested,
                              bool convert_now, bool force_policy_format) {
    const std::string sniffed = images::sniff_content_type(bytes);
    std::string type = sniffed.empty() ? declared_type : sniffed;
    if (type.empty()) {
        type = "application/octet-stream";
    }
    if (convert_now) {
        const images::Probe info = images::probe(bytes);
        if (info.decodable && (force_policy_format || !images::is_jpeg_or_png(sniffed))) {
            std::string error;
            const auto converted =
                images::convert(bytes, services.conversion_policy(), &error, force_policy_format);
            if (converted) {
                if (converted->changed) {
                    bytes = converted->bytes;
                    type = converted->content_type;
                }
            } else {
                log::warning("core", "image.convertFailed", "image could not be converted",
                             log::extras({{"reason", error}}));
            }
        }
    }
    std::string id;
    if (!suggested.empty()) {
        id = s.binaries->unique_id(suggested);
    } else {
        id = s.binaries->next_image_id(type);
    }
    const model::BinaryMeta meta = s.binaries->put(id, type, std::move(bytes));
    if (s.snapshot) {
        sync_binaries(*s.snapshot, *s.binaries);
    }
    return meta;
}

}  // namespace

void register_binary_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
    app.get("/binary/:docId/:id", [&server, &services](auto* res, auto* req) {
        serve_binary(server, services, res, req, false);
    });
    app.head("/binary/:docId/:id", [&server, &services](auto* res, auto* req) {
        serve_binary(server, services, res, req, false);
    });
    app.get("/binary/:docId/:id/preview", [&server, &services](auto* res, auto* req) {
        serve_binary(server, services, res, req, true);
    });
    app.head("/binary/:docId/:id/preview", [&server, &services](auto* res, auto* req) {
        serve_binary(server, services, res, req, true);
    });
    app.post("/binary/:docId", [&server, &services](auto* res, auto* req) {
        upload_binary(server, services, res, req);
    });
}

void register_binary_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("binary.list", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        if (s.snapshot) {
            update_reference_counts(*s.snapshot, *s.binaries);
        }
        json out = json::array();
        for (const auto& meta : s.binaries->list()) {
            out.push_back(model::to_json(meta));
        }
        return out;
    });

    router.add_method("binary.add", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const std::string path = rpc::params::string(params, "path");
        std::string bytes;
        try {
            bytes = fb2::read_file_bytes(platform::path_from_utf8(path));
        } catch (const fb2::IoFailure& e) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", e.path}, {"reason", e.reason}});
        }
        if (bytes.empty()) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", path}, {"reason", "file is empty"}});
        }
        if (bytes.size() > kMaxUploadBytes) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", path}, {"reason", "file exceeds 256 MB"}});
        }
        std::string suggested = rpc::params::string_or(params, "suggestedId", "");
        if (suggested.empty()) {
            suggested = platform::utf8_from_path(platform::path_from_utf8(path).filename());
        }
        const bool convert_now = rpc::params::boolean_or(params, "convertNow", false);
        return model::to_json(
            store_bytes(services, s, std::move(bytes), "", suggested, convert_now, false));
    });

    router.add_method("binary.addFromClipboard", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        auto provider = services.clipboard_provider();
        if (!provider) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "no shell attached to read the clipboard"}});
        }
        std::optional<ClipboardImage> image = provider->read_image();
        if (!image || image->bytes.empty()) {
            throw rpc::RpcError(
                rpc::codes::kDocIoError, "",
                json{{"path", "clipboard"}, {"reason", "no image on the clipboard"}});
        }
        if (image->bytes.size() > kMaxUploadBytes) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", "clipboard"}, {"reason", "image exceeds 256 MB"}});
        }
        const std::string suggested = rpc::params::string_or(params, "suggestedId", "");
        // Pasted images land in the format chosen in the settings (US7 scenario 2).
        return model::to_json(store_bytes(services, s, std::move(image->bytes), image->contentType,
                                          suggested, true, true));
    });

    router.add_method("binary.convert", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const std::string id = rpc::params::string(params, "id");
        const auto format = images::format_from_string(rpc::params::string(params, "format"));
        if (!format) {
            throw rpc::invalid_params("format must be \"jpeg\" or \"png\"",
                                      json{{"field", "format"}});
        }
        images::ConversionPolicy policy = services.conversion_policy();
        policy.preferred = *format;
        policy.png_when_alpha = false;  // an explicit request wins over the alpha rule
        policy.jpeg_quality = rpc::params::integer_or(params, "quality", policy.jpeg_quality);
        if (policy.jpeg_quality < 1 || policy.jpeg_quality > 100) {
            throw rpc::invalid_params("quality must be between 1 and 100",
                                      json{{"field", "quality"}});
        }
        const auto bytes = s.binaries->bytes(id);
        const auto meta = s.binaries->meta(id);
        if (!bytes || !meta) {
            throw rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", id}});
        }
        if (s.binaries->is_raw_text(id) || !meta->decodable) {
            throw rpc::invalid_params("binary is not a decodable image",
                                      json{{"field", "id"}, {"id", id}});
        }
        std::string error;
        const auto converted = images::convert(*bytes, policy, &error, true);
        if (!converted) {
            throw rpc::invalid_params("image could not be decoded: " + error,
                                      json{{"field", "id"}, {"id", id}, {"reason", error}});
        }
        model::BinaryMeta result = *meta;
        if (converted->changed) {
            result = s.binaries->put(id, converted->content_type, converted->bytes);
            services.previews.invalidate_prefix(s.docId + "/" + id + "@");
        }
        if (s.snapshot) {
            update_reference_counts(*s.snapshot, *s.binaries);
            sync_binaries(*s.snapshot, *s.binaries);
            result.referenceCount = s.binaries->meta(id)->referenceCount;
        }
        return model::to_json(result);
    });

    router.add_method("binary.remove", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const std::string id = rpc::params::string(params, "id");
        const auto meta = s.binaries->meta(id);
        if (!meta) {
            throw rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", id}});
        }
        if (s.snapshot) {
            update_reference_counts(*s.snapshot, *s.binaries);
        }
        const int references = s.binaries->meta(id)->referenceCount;
        if (references > 0 && !rpc::params::boolean_or(params, "force", false)) {
            throw rpc::invalid_params(
                "binary is still referenced",
                json{{"field", "id"}, {"id", id}, {"referenceCount", references}});
        }
        s.binaries->remove(id);
        services.previews.invalidate_prefix(s.docId + "/" + id + "@");
        if (s.snapshot) {
            sync_binaries(*s.snapshot, *s.binaries);
        }
        return json::object();
    });

    router.add_method("binary.copy", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& target =
            services.documents.require(rpc::params::string(params, "docId"));
        session::DocumentSession& source =
            services.documents.require(rpc::params::string(params, "fromDocId"));
        const std::string id = rpc::params::string(params, "id");
        if (id.empty()) {
            throw rpc::invalid_params("id must not be empty", json{{"field", "id"}});
        }
        const auto meta = source.binaries->meta(id);
        const auto bytes = source.binaries->bytes(id);
        if (!meta || !bytes) {
            throw rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", id}});
        }
        // Identical content already in the document (spec FR-035, "not added twice"): the
        // hash tells the candidates apart, the bytes decide.
        const std::string etag = source.binaries->etag(id);
        for (const std::string& existing_id : target.binaries->ids()) {
            if (target.binaries->etag(existing_id) != etag) {
                continue;
            }
            const auto existing_bytes = target.binaries->bytes(existing_id);
            if (existing_bytes && *existing_bytes == *bytes) {
                if (target.snapshot) {
                    update_reference_counts(*target.snapshot, *target.binaries);
                }
                json result = model::to_json(*target.binaries->meta(existing_id));
                result["existing"] = true;
                return result;
            }
        }
        const std::string suggested = rpc::params::string_or(params, "suggestedId", "");
        const std::string new_id = target.binaries->unique_id(suggested.empty() ? id : suggested);
        model::BinaryMeta copied = target.binaries->put(new_id, meta->contentType, *bytes,
                                                        source.binaries->is_raw_text(id));
        copied.referenceCount = 0;
        if (target.snapshot) {
            sync_binaries(*target.snapshot, *target.binaries);
        }
        json result = model::to_json(copied);
        result["existing"] = false;
        return result;
    });

    router.add_method("binary.export", [&services](const json& params, rpc::RpcContext&) {
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const std::string id = rpc::params::string(params, "id");
        const std::string path = rpc::params::string(params, "path");
        const auto bytes = s.binaries->bytes(id);
        if (!bytes) {
            throw rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", id}});
        }
        try {
            atomic_file::write_atomic(platform::path_from_utf8(path), *bytes);
        } catch (const atomic_file::WriteError& e) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", e.path}, {"reason", e.reason}});
        }
        return json::object();
    });
}

}  // namespace mfbe::server
