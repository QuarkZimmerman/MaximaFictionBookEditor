// Feature 018 (contracts/rpc-api.md §2–§3): MOBI / KF8 export & import RPC handlers and HTTP routes.
#include "mobi/mobi_reader.hpp"
#include "mobi/mobi_writer.hpp"
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/binary_store.hpp>
#include <mfbe/fb2_writer.hpp>
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>
#include <mfbe/json_codec.hpp>
#include <mfbe/mobi.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
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

rpc::RpcError refused(const std::string& reason, json data = json::object()) {
    data["reason"] = reason;
    return rpc::RpcError(rpc::codes::kMobiRefused, "", std::move(data));
}

rpc::RpcError unknown_token(const std::string& token) {
    return rpc::RpcError(rpc::codes::kMobiUnknownToken, "", json{{"token", token}});
}

std::string lower_ascii(std::string s) {
    for (char& c : s) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return s;
}

bool ends_with_ci(const std::string& s, std::string_view suffix) {
    if (s.size() < suffix.size()) return false;
    const std::string l = lower_ascii(s);
    return l.compare(l.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::shared_ptr<Services::MobiImportSession> require_import(Services& services,
                                                            const std::string& token) {
    std::lock_guard lock(services.mobi.mutex);
    const auto it = services.mobi.imports.find(token);
    if (it == services.mobi.imports.end()) {
        throw unknown_token(token);
    }
    return it->second;
}

json metadata_to_json(const mobi::MobiMetadata& m) {
    json j = {
        {"title", m.title},
        {"authors", m.authors},
        {"contributors", m.contributors},
        {"subjects", m.subjects},
        {"language", m.language},
        {"identifier", m.identifier},
    };
    if (!m.updated_title.empty()) j["updatedTitle"] = m.updated_title;
    if (!m.publisher.empty()) j["publisher"] = m.publisher;
    if (!m.description.empty()) j["description"] = m.description;
    if (!m.isbn.empty()) j["isbn"] = m.isbn;
    if (!m.date.empty()) j["date"] = m.date;
    if (!m.rights.empty()) j["rights"] = m.rights;
    return j;
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

void serve_import_slot(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                       uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string token = LoopbackServer::url_decode(req->getParameter(0));
    const std::string rest = slot_after_token(req->getUrl(), "/mobi-import/", token);
    std::shared_ptr<Services::MobiImportSession> session;
    {
        std::lock_guard lock(services.mobi.mutex);
        const auto it = services.mobi.imports.find(token);
        if (it == services.mobi.imports.end()) {
            end_plain(res, "404 Not Found", "unknown MOBI import token");
            return;
        }
        session = it->second;
    }
    std::lock_guard slock(session->mutex);
    if (!session->parsed.has_value()) {
        end_plain(res, "404 Not Found", "MOBI has not been read yet");
        return;
    }
    const auto& parsed = *session->parsed;
    if (rest == "html") {
        res->writeStatus("200 OK");
        res->writeHeader("Content-Type",
                         parsed.active_part == "palmdoc" ? "text/plain; charset=utf-8"
                                                         : "text/html; charset=utf-8");
        res->writeHeader("Cache-Control", "no-store");
        res->writeHeader("X-Content-Type-Options", "nosniff");
        res->end(parsed.html_bytes);
        return;
    }
    if (rest.rfind("css/", 0) == 0 && rest.size() > 4) {
        const std::string num = rest.substr(4);
        if (num.find_first_not_of("0123456789") == std::string::npos) {
            const std::size_t idx = std::stoull(num);
            if (idx < parsed.css_flows.size()) {
                res->writeStatus("200 OK");
                res->writeHeader("Content-Type", "text/css; charset=utf-8");
                res->writeHeader("Cache-Control", "no-store");
                res->writeHeader("X-Content-Type-Options", "nosniff");
                res->end(parsed.css_flows[idx]);
                return;
            }
        }
        end_plain(res, "404 Not Found", "no such CSS flow");
        return;
    }
    if (rest.rfind("picture/", 0) == 0 && rest.size() > 8) {
        const std::string num = rest.substr(8);
        if (num.find_first_not_of("0123456789") == std::string::npos) {
            const std::uint32_t pic_idx = static_cast<std::uint32_t>(std::stoul(num));
            for (const auto& p : parsed.pictures) {
                if (p.index == pic_idx) {
                    res->writeStatus("200 OK");
                    res->writeHeader("Content-Type",
                                     p.content_type.empty() ? "application/octet-stream"
                                                            : p.content_type);
                    res->writeHeader("Cache-Control", "no-store");
                    res->writeHeader("X-Content-Type-Options", "nosniff");
                    res->end(p.bytes);
                    return;
                }
            }
        }
        end_plain(res, "404 Not Found", "no such picture");
        return;
    }
    end_plain(res, "404 Not Found", "unknown MOBI import route");
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
    app.get("/mobi-import/:token/*", [&server, &services](auto* res, auto* req) {
        serve_import_slot(server, services, res, req);
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

    /* --- MOBI / KF8 / PalmDOC Import (contracts/rpc-api.md §3) --- */

    router.add_method("mobiImport.begin", [&services](const json& params, rpc::RpcContext&) {
        const std::string path_str = rpc::params::string(params, "path");
        const fs::path path = platform::path_from_utf8(path_str);
        const auto entry = rpc::params::opt_string(params, "entry");
        const fs::path root = services.dirs.state / "mobi-import";
        std::error_code ec;
        {
            std::lock_guard lock(services.mobi.mutex);
            if (!services.mobi.cleaned) {
                if (fs::exists(root, ec)) {
                    for (const auto& old : fs::directory_iterator(root, ec)) {
                        fs::remove_all(old.path(), ec);
                    }
                }
                services.mobi.cleaned = true;
            }
        }
        if (!path.is_absolute() || !fs::is_regular_file(path, ec)) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", path_str}, {"reason", "file not found"}});
        }
        const archive::Kind akind = archive::detect_kind(path);
        if (archive::is_other_archive(akind)) {
            throw refused("otherArchive",
                          json{{"path", path_str}, {"kind", archive::kind_name(akind)}});
        }

        const std::string token = new_token();
        auto session = std::make_shared<Services::MobiImportSession>();
        session->folder = root / token;
        session->source_file = path;

        if (akind == archive::Kind::zip) {
            if (!entry) {
                json mobis = json::array();
                json fbds = json::array();
                try {
                    for (const archive::Entry& e : archive::list(path).entries) {
                        if (e.directory) {
                            continue;
                        }
                        const json item{{"entry", e.name}, {"size", e.size}};
                        if (mobi::is_mobi_extension(e.name)) {
                            mobis.push_back(item);
                        } else if (ends_with_ci(e.name, ".fbd")) {
                            fbds.push_back(item);
                        }
                    }
                } catch (const archive::ArchiveError& e) {
                    throw refused(archive::reason_name(e.reason), json{{"path", path_str}});
                }
                if (mobis.empty()) {
                    throw refused("noMobiInArchive", json{{"path", path_str}});
                }
                return json{{"archive", {{"mobis", mobis}, {"fbds", fbds}}}};
            }
            fs::create_directories(session->folder, ec);
            fs::permissions(session->folder, fs::perms::owner_all, fs::perm_options::replace, ec);
            try {
                const std::string bytes = archive::read_entry(path, *entry);
                if (bytes.size() > mobi::kMaxFileBytes) {
                    fs::remove_all(session->folder, ec);
                    throw refused("tooLarge", json{{"path", path_str},
                                                   {"limit", mobi::kMaxFileBytes}});
                }
                const fs::path extracted = session->folder / "source.mobi";
                atomic_file::write_atomic(extracted, bytes);
                session->source_file = extracted;
                session->archive_path = path;
                session->archive_entry = *entry;
            } catch (const rpc::RpcError&) {
                throw;
            } catch (const archive::ArchiveError& e) {
                fs::remove_all(session->folder, ec);
                throw refused(archive::reason_name(e.reason), json{{"path", path_str}});
            }
        } else {
            const auto sz = fs::file_size(path, ec);
            if (!ec && sz > mobi::kMaxFileBytes) {
                throw refused("tooLarge",
                              json{{"path", path_str}, {"limit", mobi::kMaxFileBytes}});
            }
        }

        std::lock_guard lock(services.mobi.mutex);
        services.mobi.imports.emplace(token, std::move(session));
        return json{{"token", token}};
    });

    router.add_method("mobiImport.read", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        auto session = require_import(services, token);
        const std::string job_id = services.jobs.start([session](rpc::JobControl& control) -> json {
            std::lock_guard slock(session->mutex);
            try {
                mobi::MobiReadResult res = mobi::read_mobi_file(
                    session->source_file,
                    [&control](const std::string& phase, std::int64_t done, std::int64_t total) {
                        control.progress(phase, done, total);
                    },
                    [&control]() { control.check_cancelled(); });

                json pictures = json::array();
                for (const auto& p : res.pictures) {
                    json pj{
                        {"index", p.index},
                        {"contentType", p.content_type},
                        {"size", p.size},
                        {"tooLarge", p.too_large},
                    };
                    if (p.width) pj["width"] = *p.width;
                    if (p.height) pj["height"] = *p.height;
                    pictures.push_back(std::move(pj));
                }

                json navigation = json::array();
                for (const auto& n : res.navigation) {
                    navigation.push_back(json{
                        {"label", n.label},
                        {"anchorId", n.anchor_id},
                        {"depth", n.depth},
                        {"offset", n.offset},
                    });
                }

                json guide = json::array();
                for (const auto& g : res.guide) {
                    guide.push_back(json{
                        {"type", g.type},
                        {"title", g.title},
                        {"anchorId", g.anchor_id},
                        {"offset", g.offset},
                    });
                }

                json out{
                    {"containerKind", mobi::container_kind_to_string(res.container_kind)},
                    {"activePart", res.active_part},
                    {"fellBackToMobi7", res.fell_back_to_mobi7},
                    {"encoding", res.encoding},
                    {"cssFlowCount", res.css_flows.size()},
                    {"metadata", metadata_to_json(res.metadata)},
                    {"navigation", std::move(navigation)},
                    {"guide", std::move(guide)},
                    {"pictures", std::move(pictures)},
                    {"mfbeStatus", mobi::mfbe_status_to_string(res.mfbe_status)},
                    {"mfbeHtmlMatches", res.mfbe_html_matches},
                    {"mfbeMetaMatches", res.mfbe_meta_matches},
                };
                if (res.cover_index) out["coverIndex"] = *res.cover_index;
                if (res.thumbnail_index) out["thumbnailIndex"] = *res.thumbnail_index;
                if ((res.mfbe_status == mobi::MfbeStatus::valid ||
                     res.mfbe_status == mobi::MfbeStatus::externally_modified) &&
                    res.mfbe_json.is_object()) {
                    out["mfbe"] = res.mfbe_json;
                }

                session->parsed = std::move(res);
                return out;
            } catch (const rpc::RpcError&) {
                throw;
            } catch (const mobi::MobiError& e) {
                json data{{"path", platform::utf8_from_path(session->source_file)}};
                if (e.reason == "tooLarge") {
                    data["limit"] = mobi::kMaxFileBytes;
                }
                throw refused(e.reason, std::move(data));
            } catch (const std::exception& e) {
                throw refused("damaged",
                              json{{"path", platform::utf8_from_path(session->source_file)},
                                   {"detail", e.what()}});
            }
        });
        return json{{"jobId", job_id}};
    });

    router.add_method("mobiImport.picture", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::uint32_t pic_index =
            static_cast<std::uint32_t>(rpc::params::integer_or(params, "index", 0));
        const std::string doc_id = rpc::params::string(params, "docId");
        const std::string suggested = rpc::params::opt_string(params, "suggestedId").value_or("");

        session::DocumentSession& doc = services.documents.require(doc_id);
        auto session = require_import(services, token);
        std::string raw_bytes;
        std::string pic_ct;
        {
            std::lock_guard slock(session->mutex);
            if (!session->parsed.has_value()) {
                throw refused("damaged", json{{"detail", "MOBI has not been read yet"}});
            }
            bool found = false;
            for (const auto& p : session->parsed->pictures) {
                if (p.index == pic_index) {
                    raw_bytes = p.bytes;
                    pic_ct = p.content_type;
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw rpc::RpcError(rpc::codes::kBinaryNotFound, "",
                                    json{{"index", pic_index}});
            }
        }

        if (pic_ct == "image/svg+xml") {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, "",
                                json{{"index", pic_index}, {"contentType", pic_ct}});
        }

        const images::Probe probe = images::probe(raw_bytes);
        const std::uint64_t pixels = static_cast<std::uint64_t>(probe.width.value_or(0)) *
                                     static_cast<std::uint64_t>(probe.height.value_or(0));
        if (pixels > static_cast<std::uint64_t>(images::kMaxPixels)) {
            throw refused("pictureTooLarge", json{{"index", pic_index}, {"pixels", pixels}});
        }
        if (!probe.decodable) {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, "",
                                json{{"index", pic_index}, {"contentType", probe.contentType}});
        }

        // D23 rule: JPEG and PNG pass through byte-for-byte; others convert to PNG (alpha or <=256
        // colours) else JPEG at settings quality.
        images::ConversionPolicy policy = services.conversion_policy();
        policy.preferred = images::Format::jpeg;
        policy.png_when_alpha = true;
        policy.png_when_few_colours = true;
        std::string err;
        auto converted = images::convert(raw_bytes, policy, &err, false);
        if (!converted) {
            throw rpc::RpcError(rpc::codes::kBinaryNotImage, err,
                                json{{"index", pic_index}, {"contentType", probe.contentType}});
        }

        const std::string id =
            doc.binaries->unique_id(suggested.empty() ? "picture" : suggested);
        const model::BinaryMeta meta =
            doc.binaries->put(id, converted->content_type, std::move(converted->bytes));
        if (doc.snapshot) {
            sync_binaries(*doc.snapshot, *doc.binaries);
        }
        return json{
            {"binary", model::to_json(meta)},
            {"from", probe.contentType},
            {"converted", converted->changed},
        };
    });

    router.add_method("mobiImport.extractFbd", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        const std::string entry = rpc::params::string(params, "entry");
        auto session = require_import(services, token);
        std::lock_guard slock(session->mutex);
        if (!session->archive_path.has_value() || !ends_with_ci(entry, ".fbd")) {
            throw refused("damaged");
        }
        std::string bytes;
        try {
            bytes = archive::read_entry(*session->archive_path, entry);
        } catch (const archive::ArchiveError& e) {
            throw refused(archive::reason_name(e.reason));
        }
        std::error_code ec;
        fs::create_directories(session->folder, ec);
        const fs::path file = session->folder / "description.fbd";
        atomic_file::write_atomic(file, bytes);
        return json{{"path", platform::utf8_from_path(file)}};
    });

    router.add_method("mobiImport.recordFbd", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        auto session = require_import(services, token);
        std::lock_guard slock(session->mutex);
        if (!session->parsed.has_value() || !session->parsed->mfbe_json.is_object() ||
            !session->parsed->mfbe_json.contains("description") ||
            !session->parsed->mfbe_json["description"].is_object()) {
            throw refused("damaged", json{{"detail", "no embedded MFBE description"}});
        }
        model::Document doc;
        try {
            doc.description = model::description_from_json(session->parsed->mfbe_json["description"]);
        } catch (const std::exception& e) {
            throw refused("damaged", json{{"detail", e.what()}});
        }
        model::Node p;
        p.type = "p";
        model::Node sec;
        sec.type = "section";
        sec.content.push_back(std::move(p));
        model::Node body;
        body.type = "body";
        body.content.push_back(std::move(sec));
        doc.bodies.push_back(std::move(body));

        const fb2::WriteResult written = fb2::write_document(doc, nullptr);
        std::error_code ec;
        fs::create_directories(session->folder, ec);
        const fs::path file = session->folder / "record.fbd";
        atomic_file::write_atomic(file, written.text);
        return json{{"path", platform::utf8_from_path(file)}};
    });

    router.add_method("mobiImport.end", [&services](const json& params, rpc::RpcContext&) {
        const std::string token = rpc::params::string(params, "token");
        std::shared_ptr<Services::MobiImportSession> session;
        {
            std::lock_guard lock(services.mobi.mutex);
            const auto it = services.mobi.imports.find(token);
            if (it != services.mobi.imports.end()) {
                session = std::move(it->second);
                services.mobi.imports.erase(it);
            }
        }
        if (session) {
            std::lock_guard slock(session->mutex);
            session->parsed.reset();
            std::error_code ec;
            fs::remove_all(session->folder, ec);
        }
        return json::object();
    });
}

}  // namespace mfbe::server
