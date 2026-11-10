// Feature 012 (T012; contracts/rpc-api.md §1-§3): the core's part of the EPUB import and export.
// The interface converts; the core opens the EPUB (limits, DRM, names outside the container),
// serves its entries over a binary route, gathers the export's files - the book's binaries copied
// inside the core, byte for byte - and writes the EPUB atomically. Binary data never travel in
// JSON.
//
//   epub.open {path} -> {token, version, packagePath, protection, mimetypeFirst,
//                        entries: [{name, size, packed, method}], outside: [name]}
//        1110 epub refused {reason, path}
//   epub.close {token} -> {}
//   epub.picture {token, entry, docId, suggestedId} -> {binary, from, converted}: a picture of the
//        EPUB put into the document's binaries (JPEG and PNG byte for byte, GIF/WebP/BMP/TIFF to
//        PNG when transparent or of 256 colours or fewer, else JPEG; D23); 1110
//        epub.pictureTooLarge past 100 megapixels (D29); 1013 binaryNotImage {entry, contentType}
//        for the rest
//   GET  /epub/{token}/{entry}         the entry's bytes (404 when not offered)
//   epub.write.begin {path, docId?} -> {token}; 1111 {reason: epub.targetIsSource, path}
//   PUT  /epub-write/{token}/{name}    adds a file (400 for a bad or duplicate name)
//   epub.write.binary {token, stem, docId, binaryId} -> {name, mediaType, converted}: JPEG and PNG
//        byte for byte, other pictures converted as a save converts them (D12); the name is
//        the stem with .jpg or .png; 1013 binaryNotImage {id}; 1111 {reason: epub.badName, name}
//   epub.write.commit {token} -> {bytes}; 1111 {reason: epub.ioError, path}
//   epub.write.abort {token} -> {}
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/epub.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/utf8_paths.hpp>

#include <cstdint>
#include <filesystem>
#include <memory>
#include <random>
#include <string>

namespace mfbe::server {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

constexpr std::size_t kMaxEntryUploadBytes = 512ull * 1024 * 1024;

std::string new_token() {
    std::random_device rd;
    static const char* kHex = "0123456789abcdef";
    std::string token;
    for (int i = 0; i < 32; ++i) {
        token.push_back(kHex[rd() & 0x0F]);
    }
    return token;
}

// D29: a picture of more pixels than this is not read (a 100-megapixel RGBA bitmap is 400 MB).
constexpr std::uint64_t kMaxPicturePixels = 100'000'000;

rpc::RpcError refused(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kEpubRefused, "", std::move(data));
}

rpc::RpcError write_failed(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kEpubWriteFailed, "", std::move(data));
}

void end_plain(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

// "/epub/<token>/<name...>" -> <name...>, percent-decoded ("" when the path has no name part).
std::string name_after_token(std::string_view url, std::string_view prefix,
                             const std::string& token) {
    const std::string head = std::string(prefix) + token + "/";
    if (url.substr(0, head.size()) != head) {
        return {};
    }
    std::string_view rest = url.substr(head.size());
    if (const std::size_t q = rest.find('?'); q != std::string_view::npos) {
        rest = rest.substr(0, q);
    }
    return LoopbackServer::url_decode(rest);
}

bool same_file(const fs::path& a, const std::string& b) {
    std::error_code ec;
    const fs::path other = platform::path_from_utf8(b);
    return fs::exists(a, ec) && fs::exists(other, ec) && fs::equivalent(a, other, ec);
}

void serve_entry(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                 uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string token = LoopbackServer::url_decode(req->getParameter(0));
    const std::string name = name_after_token(req->getUrl(), "/epub/", token);
    std::string bytes;
    {
        std::lock_guard lock(services.epub.mutex);
        const auto it = services.epub.sources.find(token);
        if (it == services.epub.sources.end()) {
            end_plain(res, "404 Not Found", "unknown EPUB token");
            return;
        }
        try {
            bytes = epub::read(it->second, name);
        } catch (const std::out_of_range&) {
            end_plain(res, "404 Not Found", "the EPUB offers no such entry");
            return;
        } catch (const epub::Refused& e) {
            res->writeHeader("X-MFBE-Reason", epub::refusal_name(e.reason));
            end_plain(res, "413 Payload Too Large", e.what());
            return;
        } catch (const archive::ArchiveError& e) {
            res->writeHeader("X-MFBE-Reason", archive::reason_name(e.reason));
            end_plain(res, "422 Unprocessable Entity", e.what());
            return;
        }
    }
    res->writeStatus("200 OK");
    res->writeHeader("Content-Type", "application/octet-stream");
    res->writeHeader("Cache-Control", "no-store");
    res->writeHeader("X-Content-Type-Options", "nosniff");
    res->end(bytes);
}

void upload_entry(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                  uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    // `req` is not valid once the handler returns: copy what the body callback needs.
    const std::string token = LoopbackServer::url_decode(req->getParameter(0));
    const std::string name = name_after_token(req->getUrl(), "/epub-write/", token);
    auto buffer = std::make_shared<std::string>();
    auto aborted = std::make_shared<bool>(false);
    res->onAborted([aborted] { *aborted = true; });
    res->onData([res, buffer, aborted, &services, token, name](std::string_view chunk, bool last) {
        if (*aborted) {
            return;
        }
        if (buffer->size() + chunk.size() > kMaxEntryUploadBytes) {
            *aborted = true;
            end_plain(res, "413 Payload Too Large", "a file of more than 512 MB");
            return;
        }
        buffer->append(chunk);
        if (!last) {
            return;
        }
        std::lock_guard lock(services.epub.mutex);
        const auto it = services.epub.writers.find(token);
        if (it == services.epub.writers.end()) {
            end_plain(res, "404 Not Found", "unknown EPUB token");
            return;
        }
        try {
            it->second->add(name, std::move(*buffer));
        } catch (const std::invalid_argument& e) {
            res->writeHeader("X-MFBE-Reason", "epub.badName");
            end_plain(res, "400 Bad Request", e.what());
            return;
        }
        res->writeStatus("201 Created");
        res->writeHeader("Cache-Control", "no-store");
        res->end();
    });
}

}  // namespace

void register_epub_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
    app.get("/epub/:token/*", [&server, &services](auto* res, auto* req) {
        serve_entry(server, services, res, req);
    });
    app.put("/epub-write/:token/*", [&server, &services](auto* res, auto* req) {
        upload_entry(server, services, res, req);
    });
}

void register_epub_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("epub.open", [&services](const json& params, rpc::RpcContext&) {
        const std::string path = rpc::params::string(params, "path");
        epub::Source source;
        try {
            source = epub::open(platform::path_from_utf8(path));
        } catch (const epub::Refused& e) {
            throw rpc::RpcError(rpc::codes::kEpubRefused, e.what(),
                                json{{"reason", epub::refusal_name(e.reason)}, {"path", path}});
        }
        json entries = json::array();
        for (const epub::Entry& e : source.entries) {
            entries.push_back(
                {{"name", e.name}, {"size", e.size}, {"packed", e.packed}, {"method", e.method}});
        }
        json out{{"version", source.version},
                 {"packagePath", source.package_path},
                 {"protection", epub::protection_name(source.protection)},
                 {"mimetypeFirst", source.mimetype_first},
                 {"entries", std::move(entries)},
                 {"outside", source.outside}};
        const std::string token = new_token();
        std::lock_guard lock(services.epub.mutex);
        services.epub.sources.emplace(token, std::move(source));
        out["token"] = token;
        return out;
    });

    router.add_method("epub.close", [&services](const json& params, rpc::RpcContext&) {
        std::lock_guard lock(services.epub.mutex);
        services.epub.sources.erase(rpc::params::string(params, "token"));
        return json::object();
    });

    router.add_method("epub.picture", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::string entry = rpc::params::string(params, "entry");
        const std::string suggested = rpc::params::opt_string(params, "suggestedId").value_or("");
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        std::string bytes;
        {
            std::lock_guard lock(services.epub.mutex);
            const auto it = services.epub.sources.find(token);
            if (it == services.epub.sources.end()) {
                throw refused("epub.unknownToken", json{{"entry", entry}});
            }
            try {
                bytes = epub::read(it->second, entry);
            } catch (const std::out_of_range&) {
                throw refused("epub.noEntry", json{{"entry", entry}});
            } catch (const epub::Refused& e) {
                throw refused(epub::refusal_name(e.reason), json{{"entry", entry}});
            } catch (const archive::ArchiveError& e) {
                throw refused(archive::reason_name(e.reason), json{{"entry", entry}});
            }
        }
        // D29: the pixels are counted from the headers, before anything is decoded.
        const images::Probe probe = images::probe(bytes);
        const std::uint64_t pixels = static_cast<std::uint64_t>(probe.width.value_or(0)) *
                                     static_cast<std::uint64_t>(probe.height.value_or(0));
        if (pixels > kMaxPicturePixels) {
            throw refused("epub.pictureTooLarge", json{{"entry", entry}, {"pixels", pixels}});
        }
        if (!probe.decodable) {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, "",
                                json{{"entry", entry}, {"contentType", probe.contentType}});
        }
        // D23: JPEG and PNG byte for byte; the rest PNG when transparent or of few colours, else
        // JPEG at the quality from settings - whatever the paste format setting says.
        images::ConversionPolicy policy = services.conversion_policy();
        policy.preferred = images::Format::jpeg;
        policy.png_when_alpha = true;
        policy.png_when_few_colours = true;
        std::string error;
        auto picture = images::convert(bytes, policy, &error, false);
        if (!picture) {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, error,
                                json{{"entry", entry}, {"contentType", probe.contentType}});
        }
        const std::string id = s.binaries->unique_id(suggested.empty() ? "picture" : suggested);
        const model::BinaryMeta meta =
            s.binaries->put(id, picture->content_type, std::move(picture->bytes));
        if (s.snapshot) {
            sync_binaries(*s.snapshot, *s.binaries);
        }
        return json{{"binary", model::to_json(meta)},
                    {"from", probe.contentType},
                    {"converted", picture->changed}};
    });

    router.add_method("epub.write.begin", [&services](const json& params, rpc::RpcContext&) {
        const std::string path = rpc::params::string(params, "path");
        const fs::path target = platform::path_from_utf8(path);
        if (const auto doc_id = rpc::params::opt_string(params, "docId")) {
            const session::DocumentSession* s = services.documents.find(*doc_id);
            if (s != nullptr && s->path && same_file(target, *s->path)) {
                throw write_failed("epub.targetIsSource", json{{"path", path}});
            }
        }
        const std::string token = new_token();
        std::lock_guard lock(services.epub.mutex);
        services.epub.writers.emplace(token, std::make_unique<epub::Writer>(target));
        return json{{"token", token}};
    });

    router.add_method("epub.write.binary", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::string stem = rpc::params::string(params, "stem");
        session::DocumentSession& s =
            services.documents.require(rpc::params::string(params, "docId"));
        const std::string id = rpc::params::string(params, "binaryId");
        const auto bytes = s.binaries->bytes(id);
        if (!bytes) {
            throw rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", id}});
        }
        // D12: JPEG and PNG pass through byte for byte; any other picture is converted as the
        // book's next save would convert it; data that is no decodable picture is left out.
        std::string error;
        auto picture = images::convert(*bytes, services.conversion_policy(), &error, false);
        if (!picture) {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, error, json{{"id", id}});
        }
        const bool png = picture->content_type == "image/png";
        const std::string name = stem + (png ? ".png" : ".jpg");
        const bool converted = picture->changed;
        std::lock_guard lock(services.epub.mutex);
        const auto it = services.epub.writers.find(token);
        if (it == services.epub.writers.end()) {
            throw write_failed("epub.unknownToken");
        }
        try {
            it->second->add(name, converted ? std::move(picture->bytes) : std::string(*bytes));
        } catch (const std::invalid_argument&) {
            throw write_failed("epub.badName", json{{"name", name}});
        }
        return json{{"name", name}, {"mediaType", picture->content_type}, {"converted", converted}};
    });

    router.add_method("epub.write.commit", [&services](const json& params, rpc::RpcContext&) {
        std::unique_ptr<epub::Writer> writer;
        {
            std::lock_guard lock(services.epub.mutex);
            const auto it = services.epub.writers.find(rpc::params::string(params, "token"));
            if (it == services.epub.writers.end()) {
                throw write_failed("epub.unknownToken");
            }
            writer = std::move(it->second);
            services.epub.writers.erase(it);
        }
        try {
            return json{{"bytes", writer->commit()}};
        } catch (const std::exception& e) {
            throw write_failed(
                "epub.ioError",
                json{{"path", platform::utf8_from_path(writer->target())}, {"detail", e.what()}});
        }
    });

    router.add_method("epub.write.abort", [&services](const json& params, rpc::RpcContext&) {
        std::lock_guard lock(services.epub.mutex);
        services.epub.writers.erase(rpc::params::string(params, "token"));
        return json::object();
    });
}

}  // namespace mfbe::server
