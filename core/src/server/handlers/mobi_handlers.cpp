// Feature 018 (contracts/rpc-api.md §2–§3): MOBI / KF8 export RPC handlers & HTTP upload routes.
#include "mobi/mobi_writer.hpp"
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/mobi.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/utf8_paths.hpp>

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <random>
#include <string>
#include <vector>

namespace mfbe::server {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

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
    return rpc::RpcError(rpc::codes::kMobiWriteFailed, "", std::move(data));
}

rpc::RpcError unknown_token(const std::string& token) {
    return rpc::RpcError(rpc::codes::kMobiUnknownToken, "", json{{"token", token}});
}

void end_plain(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

std::string slot_after_token(std::string_view url, std::string_view prefix,
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

bool same_file_or_path(const fs::path& a, const std::string& b) {
    if (platform::same_file_path(platform::utf8_from_path(a), b)) {
        return true;
    }
    std::error_code ec;
    const fs::path other = platform::path_from_utf8(b);
    return fs::exists(a, ec) && fs::exists(other, ec) && fs::equivalent(a, other, ec);
}

mobi::MobiMetadata parse_metadata(const json& m) {
    mobi::MobiMetadata meta;
    if (!m.is_object()) {
        return meta;
    }
    meta.title = m.value("title", std::string());
    meta.updated_title = m.value("updatedTitle", std::string());
    meta.authors = rpc::params::string_array_or(m, "authors");
    meta.contributors = rpc::params::string_array_or(m, "contributors");
    meta.publisher = m.value("publisher", std::string());
    meta.description = m.value("description", std::string());
    meta.isbn = m.value("isbn", std::string());
    meta.subjects = rpc::params::string_array_or(m, "subjects");
    meta.date = m.value("date", std::string());
    meta.language = m.value("language", std::string());
    meta.identifier = m.value("identifier", std::string());
    meta.open_at_anchor_id = m.value("openAtAnchorId", std::string());
    return meta;
}

std::vector<mobi::MobiNavEntry> parse_nav(const json& arr) {
    std::vector<mobi::MobiNavEntry> out;
    if (!arr.is_array()) {
        return out;
    }
    for (const auto& item : arr) {
        if (!item.is_object()) {
            continue;
        }
        mobi::MobiNavEntry e;
        e.label = item.value("label", std::string());
        e.anchor_id = item.value("anchorId", std::string());
        e.depth = item.value("depth", 0);
        out.push_back(std::move(e));
    }
    return out;
}

std::vector<mobi::MobiGuideEntry> parse_guide(const json& arr) {
    std::vector<mobi::MobiGuideEntry> out;
    if (!arr.is_array()) {
        return out;
    }
    for (const auto& item : arr) {
        if (!item.is_object()) {
            continue;
        }
        mobi::MobiGuideEntry g;
        g.type = item.value("type", std::string());
        g.title = item.value("title", std::string());
        g.anchor_id = item.value("anchorId", std::string());
        out.push_back(std::move(g));
    }
    return out;
}

std::vector<mobi::MobiKf8Fragment> parse_fragments(const json& arr) {
    std::vector<mobi::MobiKf8Fragment> out;
    if (!arr.is_array()) {
        return out;
    }
    for (const auto& item : arr) {
        if (!item.is_object()) {
            continue;
        }
        mobi::MobiKf8Fragment f;
        f.id = item.value("id", std::string());
        f.skeleton_index = item.value("skeletonIndex", 0U);
        f.start_byte = item.value("startByte", 0U);
        f.end_byte = item.value("endByte", 0U);
        out.push_back(std::move(f));
    }
    return out;
}

void upload_write_slot(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                       uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string token = LoopbackServer::url_decode(req->getParameter(0));
    const std::string slot = slot_after_token(req->getUrl(), "/mobi-write/", token);
    auto buffer = std::make_shared<std::string>();
    auto aborted = std::make_shared<bool>(false);
    res->onAborted([aborted] { *aborted = true; });
    res->onData([res, buffer, aborted, &services, token, slot](std::string_view chunk, bool last) {
        if (*aborted) {
            return;
        }
        if (buffer->size() + chunk.size() > mobi::kMaxDecompressedBytes) {
            *aborted = true;
            end_plain(res, "413 Payload Too Large", "upload exceeds 256 MB limit");
            return;
        }
        buffer->append(chunk);
        if (!last) {
            return;
        }
        std::lock_guard lock(services.mobi.mutex);
        const auto it = services.mobi.writers.find(token);
        if (it == services.mobi.writers.end()) {
            end_plain(res, "404 Not Found", "unknown MOBI write token");
            return;
        }
        mobi::MobiWriter& writer = *it->second->writer;
        if (slot == "mobi7-html") {
            writer.set_mobi7_html(std::move(*buffer));
        } else if (slot == "kf8-html") {
            writer.set_kf8_html(std::move(*buffer));
        } else if (slot == "kf8-css") {
            writer.set_kf8_css(std::move(*buffer));
        } else if (slot == "mfbe") {
            json parsed = json::parse(*buffer, nullptr, false);
            if (parsed.is_discarded() || !parsed.is_object()) {
                end_plain(res, "400 Bad Request", "invalid MFBE JSON payload");
                return;
            }
            writer.set_mfbe_json(std::move(parsed));
        } else {
            end_plain(res, "400 Bad Request", "unknown MOBI upload slot");
            return;
        }
        res->writeStatus("201 Created");
        res->writeHeader("Cache-Control", "no-store");
        res->end();
    });
}

}  // namespace

void register_mobi_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
    app.put("/mobi-write/:token/*", [&server, &services](auto* res, auto* req) {
        upload_write_slot(server, services, res, req);
    });
}

void register_mobi_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("mobi.write.begin", [&services](const json& params, rpc::RpcContext&) {
        const std::string doc_id = rpc::params::string(params, "docId");
        const std::string path = rpc::params::string(params, "path");
        const std::string fmt_str = rpc::params::string_or(params, "format", "mobi7");
        const bool zip = rpc::params::boolean_or(params, "zip", false);

        const auto fmt = mobi::format_from_string(fmt_str);
        if (!fmt) {
            throw rpc::invalid_params("unknown format: " + fmt_str, json{{"field", "format"}});
        }

        const fs::path target = platform::path_from_utf8(path);
        const session::DocumentSession& doc = services.documents.require(doc_id);
        if (doc.path && same_file_or_path(target, *doc.path)) {
            throw write_failed("targetIsSource", json{{"path", path}});
        }

        const std::string token = new_token();
        auto session = std::make_shared<Services::MobiWriteSession>();
        session->writer = std::make_unique<mobi::MobiWriter>(target, *fmt, zip);
        session->doc_id = doc_id;
        session->work_dir = services.dirs.data / "mobi-write" / token;

        std::lock_guard lock(services.mobi.mutex);
        services.mobi.writers.emplace(token, std::move(session));
        return json{{"token", token}};
    });

    router.add_method("mobi.write.picture", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::string doc_id = rpc::params::string(params, "docId");
        const std::string binary_id = rpc::params::string(params, "binaryId");
        const bool is_cover = rpc::params::boolean_or(params, "isCover", false);

        session::DocumentSession& doc = services.documents.require(doc_id);
        const auto raw = doc.binaries->bytes(binary_id);
        if (!raw) {
            throw rpc::RpcError(rpc::codes::kBinaryNotFound, "", json{{"id", binary_id}});
        }

        std::shared_ptr<Services::MobiWriteSession> session;
        {
            std::lock_guard lock(services.mobi.mutex);
            const auto it = services.mobi.writers.find(token);
            if (it == services.mobi.writers.end()) {
                throw unknown_token(token);
            }
            session = it->second;
        }

        try {
            const mobi::MobiAddedPicture added =
                session->writer->add_picture(*raw, services.conversion_policy(), is_cover);
            return json{
                {"recindex", added.recindex},
                {"mediaType", added.media_type},
                {"width", added.width},
                {"height", added.height},
                {"converted", added.converted},
                {"downscaled", added.downscaled},
            };
        } catch (const mobi::MobiError& e) {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, e.what(), json{{"id", binary_id}});
        } catch (const images::DecodeError& e) {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, e.what(), json{{"id", binary_id}});
        }
    });

    router.add_method("mobi.write.commit", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::shared_ptr<Services::MobiWriteSession> session;
        {
            std::lock_guard lock(services.mobi.mutex);
            const auto it = services.mobi.writers.find(token);
            if (it == services.mobi.writers.end()) {
                throw unknown_token(token);
            }
            session = std::move(it->second);
            services.mobi.writers.erase(it);
        }

        mobi::MobiCommitInput input;
        if (const json* meta = rpc::params::opt_field(params, "metadata")) {
            input.metadata = parse_metadata(*meta);
        }
        if (const json* nav = rpc::params::opt_field(params, "nav")) {
            input.nav = parse_nav(*nav);
        }
        if (const json* guide = rpc::params::opt_field(params, "guide")) {
            input.guide = parse_guide(*guide);
        }
        if (const json* frags = rpc::params::opt_field(params, "kf8Fragments")) {
            input.kf8_fragments = parse_fragments(*frags);
        }

        // Generate companion FBD on the loop thread while document session is accessible.
        std::optional<std::string> fbd_bytes;
        if (session->writer->zip()) {
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

        const std::string job_id = services.jobs.start(
            [session = std::move(session), input = std::move(input),
             fbd_bytes = std::move(fbd_bytes)](rpc::JobControl& control) -> json {
                try {
                    const mobi::MobiWriteResult res = session->writer->commit(
                        input,
                        [&control](const std::string& phase, std::int64_t done, std::int64_t total) {
                            control.progress(phase, done, total);
                        },
                        [&control]() { control.check_cancelled(); }, fbd_bytes);
                    return json{
                        {"path", res.path},
                        {"bytes", res.bytes},
                        {"format", res.format},
                        {"zip", res.zip},
                        {"mfbeSkipped", res.mfbe_skipped},
                    };
                } catch (const rpc::RpcError&) {
                    throw;
                } catch (const mobi::MobiError& e) {
                    throw write_failed(
                        e.reason,
                        json{{"path", platform::utf8_from_path(session->writer->target())},
                             {"detail", e.detail}});
                } catch (const std::exception& e) {
                    throw write_failed(
                        "ioError",
                        json{{"path", platform::utf8_from_path(session->writer->target())},
                             {"detail", e.what()}});
                }
            });
        return json{{"jobId", job_id}};
    });

    router.add_method("mobi.write.abort", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::shared_ptr<Services::MobiWriteSession> session;
        {
            std::lock_guard lock(services.mobi.mutex);
            const auto it = services.mobi.writers.find(token);
            if (it != services.mobi.writers.end()) {
                session = std::move(it->second);
                services.mobi.writers.erase(it);
            }
        }
        if (session) {
            std::error_code ec;
            fs::remove_all(session->work_dir, ec);
        }
        return json::object();
    });
}

}  // namespace mfbe::server
