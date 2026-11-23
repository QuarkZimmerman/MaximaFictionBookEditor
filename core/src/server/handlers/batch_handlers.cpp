// Feature 019 (T012; contracts/rpc-api.md §3): batch.* JSON-RPC handlers and HTTP routes.
#include "batch/extractor.hpp"
#include "batch/run_state.hpp"
#include "batch/scanner.hpp"
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/settings.hpp>
#include <mfbe/store_lock.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/utf8_paths.hpp>

#include <chrono>
#include <filesystem>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace mfbe::server {
namespace {

namespace fs = std::filesystem;
using nlohmann::json;

rpc::RpcError batch_error(const std::string& reason, const std::string& path = "",
                          const std::string& detail = "") {
    json data{{"reason", reason}};
    if (!path.empty()) {
        data["path"] = path;
    }
    if (!detail.empty()) {
        data["detail"] = detail;
    }
    return rpc::RpcError(rpc::codes::kBatchError, "", std::move(data));
}

batch::Direction parse_direction(const json& params) {
    const std::string dir = rpc::params::string(params, "direction");
    if (dir == "fb2ToExport") {
        return batch::Direction::fb2_to_export;
    }
    if (dir == "importToFb2") {
        return batch::Direction::import_to_fb2;
    }
    throw rpc::invalid_params("direction must be fb2ToExport or importToFb2",
                              json{{"field", "direction"}});
}

std::vector<std::string> parse_import_formats(const json& params) {
    static const std::set<std::string> kValid = {"epub", "mobi", "pdf", "txt", "markdown"};
    std::vector<std::string> formats = rpc::params::string_array_or(params, "formats");
    for (const std::string& fmt : formats) {
        if (kValid.count(fmt) == 0) {
            throw rpc::invalid_params("unsupported batch import format: " + fmt,
                                      json{{"field", "formats"}});
        }
    }
    return formats;
}

json item_to_json(const batch::DiscoveredItem& item) {
    json j{{"itemId", item.item_id},
           {"sourcePath", item.source_path},
           {"relativeDir", item.relative_dir},
           {"displayPath", item.display_path},
           {"format", item.format},
           {"archiveMultiBook", item.archive_multi_book},
           {"sizeBytes", item.size_bytes}};
    if (item.archive_entry) {
        j["archiveEntry"] = *item.archive_entry;
    }
    if (item.archive_stem) {
        j["archiveStem"] = *item.archive_stem;
    }
    if (item.archive_fbd_entry) {
        j["archiveFbdEntry"] = *item.archive_fbd_entry;
    }
    return j;
}

json scan_error_to_json(const batch::ScanError& err) {
    json j{{"sourcePath", err.source_path},
           {"displayPath", err.display_path},
           {"reasonCode", err.reason_code}};
    if (!err.detail.empty()) {
        j["detail"] = err.detail;
    }
    return j;
}

constexpr int kBatchSettingsSchemaVersion = 1;

bool is_valid_book_format(const std::string& fmt) {
    return fmt == "epub" || fmt == "mobi" || fmt == "pdf" || fmt == "txt" || fmt == "markdown";
}

bool read_bool_or(const json& obj, const char* key, bool fallback) {
    auto it = obj.find(key);
    return (it != obj.end() && it->is_boolean()) ? it->get<bool>() : fallback;
}

std::string read_utf8_string_or(const json& obj, const char* key, const std::string& fallback) {
    auto it = obj.find(key);
    if (it != obj.end() && it->is_string()) {
        const std::string s = it->get<std::string>();
        if (unicode::is_valid_utf8(s)) {
            return s;
        }
    }
    return fallback;
}

json sanitize_batch_settings(const json& raw, const json& global_settings, bool has_stored) {
    json out = raw.is_object() ? raw : json::object();
    out["schemaVersion"] = kBatchSettingsSchemaVersion;

    const std::string dir = read_utf8_string_or(out, "direction", "fb2ToExport");
    out["direction"] = (dir == "fb2ToExport" || dir == "importToFb2") ? dir : "fb2ToExport";

    const std::string fmt = read_utf8_string_or(out, "exportFormat", "epub");
    out["exportFormat"] = is_valid_book_format(fmt) ? fmt : "epub";

    json import_formats = json::object();
    const json* raw_formats = (out.contains("importFormats") && out["importFormats"].is_object())
                                  ? &out["importFormats"]
                                  : nullptr;
    if (raw_formats != nullptr) {
        for (auto it = raw_formats->begin(); it != raw_formats->end(); ++it) {
            if (it->is_boolean()) {
                import_formats[it.key()] = it->get<bool>();
            }
        }
    }
    bool all_selected = true;
    for (const char* name : {"epub", "mobi", "pdf", "txt", "markdown"}) {
        const bool checked = raw_formats != nullptr ? read_bool_or(*raw_formats, name, true) : true;
        import_formats[name] = checked;
        if (!checked) {
            all_selected = false;
        }
    }
    out["importFormats"] = std::move(import_formats);
    out["importAll"] = all_selected;

    out["sourceDir"] = read_utf8_string_or(out, "sourceDir", "");
    out["destinationDir"] = read_utf8_string_or(out, "destinationDir", "");
    out["includeSubfolders"] = read_bool_or(out, "includeSubfolders", true);
    out["inPlace"] = read_bool_or(out, "inPlace", true);
    out["keepTree"] = read_bool_or(out, "keepTree", true);
    out["fixBroken"] = read_bool_or(out, "fixBroken", true);
    out["overwrite"] = read_bool_or(out, "overwrite", false);

    if (auto it = out.find("parallel"); it != out.end() && !it->is_boolean()) {
        out.erase(it);
    }
    if (auto it = out.find("workerCount");
        it != out.end() && (!it->is_number_integer() || it->get<long long>() < 1)) {
        out.erase(it);
    }

    json zip_overrides = json::object();
    if (auto it = out.find("zipOverrides"); it != out.end() && it->is_object()) {
        for (auto z = it->begin(); z != it->end(); ++z) {
            if (z->is_boolean()) {
                zip_overrides[z.key()] = z->get<bool>();
            }
        }
    }
    out["zipOverrides"] = std::move(zip_overrides);

    if (has_stored) {
        const json stored_exports =
            (out.contains("exportSettings") && out["exportSettings"].is_object())
                ? out["exportSettings"]
                : json::object();
        out["exportSettings"] = settings::sanitize_export_sections(stored_exports, global_settings);
    } else {
        out["exportSettings"] = settings::export_sections_copy(global_settings);
    }
    return out;
}

}  // namespace

void register_batch_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
    app.get("/batch/doc/:docId", [&server, &services](auto* res, auto* req) {
        if (!server.check_auth(res, req)) {
            return;
        }
        const std::string doc_id = LoopbackServer::url_decode(req->getParameter(0));
        auto body = services.batch.take_doc_json(doc_id);
        if (!body) {
            res->writeStatus("404 Not Found");
            res->writeHeader("Content-Type", "text/plain; charset=utf-8");
            res->writeHeader("Cache-Control", "no-store");
            res->end("unknown or already consumed batch document");
            return;
        }
        res->writeStatus("200 OK");
        res->writeHeader("Content-Type", "application/json; charset=utf-8");
        res->writeHeader("Cache-Control", "no-store");
        res->writeHeader("X-Content-Type-Options", "nosniff");
        res->end(*body);
    });
}

void register_batch_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("batch.scan", [&services](const json& params, rpc::RpcContext& ctx) {
        batch::ScanRequest req;
        req.direction = parse_direction(params);
        const std::string source_str = rpc::params::string(params, "sourceDir");
        req.source_dir = platform::path_from_utf8(source_str);
        req.include_subfolders = rpc::params::boolean_or(params, "includeSubfolders", true);
        if (req.direction == batch::Direction::import_to_fb2) {
            req.formats = parse_import_formats(params);
        }

        const fs::path batch_root = services.dirs.state / "batch";
        const std::string job_id = ctx.jobs.start(
            [&services, req = std::move(req), batch_root](rpc::JobControl& control) -> json {
                control.check_cancelled();
                control.progress("scan", 0, 0);

                auto last_progress = std::chrono::steady_clock::now();
                batch::ScanCallbacks cb;
                cb.is_cancelled = [&control]() { return control.cancelled(); };
                cb.on_progress = [&control, &last_progress](std::int64_t inspected) {
                    const auto now = std::chrono::steady_clock::now();
                    if (inspected == 1 || inspected % 25 == 0 ||
                        now - last_progress >= std::chrono::milliseconds(100)) {
                        control.progress("scan", inspected, 0);
                        last_progress = now;
                    }
                };

                batch::ScanResult res;
                try {
                    res = batch::scan_directory(req, cb);
                } catch (const batch::ScanException& e) {
                    if (e.reason == "cancelled") {
                        throw rpc::RpcError(rpc::codes::kCancelled, "batch scan cancelled");
                    }
                    throw batch_error(e.reason, e.path, e.detail);
                }

                control.check_cancelled();
                const std::string run_id = services.batch.create_run(batch_root);

                json items = json::array();
                for (const batch::DiscoveredItem& item : res.items) {
                    items.push_back(item_to_json(item));
                }
                json errors = json::array();
                for (const batch::ScanError& err : res.scan_errors) {
                    errors.push_back(scan_error_to_json(err));
                }
                return json{{"runId", run_id},
                            {"sourceDir", res.source_dir},
                            {"items", std::move(items)},
                            {"scanErrors", std::move(errors)}};
            });
        return json{{"jobId", job_id}};
    });

    router.add_method("batch.claimTarget", [&services](const json& params, rpc::RpcContext&) {
        const std::string run_id = rpc::params::string(params, "runId");
        const std::string source_path = rpc::params::string(params, "sourcePath");
        const std::string target_path = rpc::params::string(params, "targetPath");
        const std::optional<std::string> open_doc_id = rpc::params::opt_string(params, "openDocId");
        const bool overwrite = rpc::params::boolean_or(params, "overwrite", false);

        std::optional<std::string> open_doc_path;
        if (open_doc_id && !open_doc_id->empty()) {
            if (const session::DocumentSession* s = services.documents.find(*open_doc_id)) {
                open_doc_path = s->path;
            }
        }

        try {
            const batch::ClaimOutcome out = services.batch.claim_target(
                run_id, source_path, target_path, open_doc_path, overwrite);
            switch (out.status) {
                case batch::ClaimOutcome::Status::claimed:
                    return json{{"status", "claimed"},
                                {"claimId", out.claim_id},
                                {"targetPath", out.target_path}};
                case batch::ClaimOutcome::Status::skipped:
                    return json{{"status", "skipped"}, {"reason", out.reason}};
                case batch::ClaimOutcome::Status::failed: {
                    json res{{"status", "failed"}, {"reason", out.reason}};
                    if (!out.detail.empty()) {
                        res["detail"] = out.detail;
                    }
                    return res;
                }
            }
        } catch (const batch::BatchStateError& e) {
            throw batch_error(e.reason, e.path, e.detail);
        }
        return json{{"status", "failed"}, {"reason", "ioError"}};
    });

    router.add_method("batch.releaseTarget", [&services](const json& params, rpc::RpcContext&) {
        const std::string run_id = rpc::params::string(params, "runId");
        const std::string claim_id = rpc::params::string(params, "claimId");
        const bool succeeded = rpc::params::boolean_or(params, "succeeded", false);
        services.batch.release_target(run_id, claim_id, succeeded);
        return json::object();
    });

    router.add_method("batch.extractEntry", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string run_id = rpc::params::string(params, "runId");
        const std::string item_id = rpc::params::string(params, "itemId");
        const std::string archive_path_str = rpc::params::string(params, "archivePath");
        const std::string entry = rpc::params::string(params, "entry");
        const std::string format = rpc::params::string(params, "format");
        const std::optional<std::string> fbd_entry = rpc::params::opt_string(params, "fbdEntry");

        if (format != "epub" && format != "markdown") {
            throw rpc::invalid_params("format must be epub or markdown", json{{"field", "format"}});
        }

        fs::path dest_dir;
        try {
            dest_dir = services.batch.allocate_item_dir(run_id, item_id);
        } catch (const batch::BatchStateError& e) {
            throw batch_error(e.reason, e.path, e.detail);
        }

        const fs::path archive_path = platform::path_from_utf8(archive_path_str);
        const std::string job_id = ctx.jobs.start([archive_path, entry, format, fbd_entry,
                                                   dest_dir](rpc::JobControl& control) -> json {
            control.check_cancelled();
            control.progress("extract", 0, 1);
            try {
                const batch::ExtractedEntry out =
                    batch::extract_archive_entry(archive_path, entry, format, fbd_entry, dest_dir,
                                                 [&control]() { return control.cancelled(); });
                control.check_cancelled();
                control.progress("extract", 1, 1);
                json res{{"tempDir", platform::utf8_from_path(out.temp_dir)},
                         {"extractedPath", platform::utf8_from_path(out.extracted_path)}};
                if (out.fbd_path) {
                    res["fbdPath"] = platform::utf8_from_path(*out.fbd_path);
                }
                return res;
            } catch (const batch::ExtractError& e) {
                if (e.cancelled) {
                    throw rpc::RpcError(rpc::codes::kCancelled, "extraction cancelled");
                }
                throw batch_error("extractFailed", e.path, e.detail);
            }
        });
        return json{{"jobId", job_id}};
    });

    router.add_method("batch.cleanupItem", [&services](const json& params, rpc::RpcContext&) {
        const std::string run_id = rpc::params::string(params, "runId");
        const std::string item_id = rpc::params::string(params, "itemId");
        services.batch.cleanup_item(run_id, item_id);
        return json::object();
    });

    router.add_method("batch.endRun", [&services](const json& params, rpc::RpcContext&) {
        const std::string run_id = rpc::params::string(params, "runId");
        services.batch.end_run(run_id);
        return json::object();
    });

    router.add_method("batch.writeReport", [](const json& params, rpc::RpcContext&) {
        const std::string path_str = rpc::params::string(params, "path");
        const std::string content = rpc::params::string(params, "content");
        if (path_str.empty()) {
            throw batch_error("invalidPath", path_str, "report path must not be empty");
        }
        const fs::path target = platform::path_from_utf8(path_str);
        if (!target.is_absolute()) {
            throw batch_error("invalidPath", path_str, "report path must be absolute");
        }
        const fs::path parent = target.parent_path();
        if (!parent.empty()) {
            std::error_code ec;
            fs::create_directories(parent, ec);
            if (ec) {
                throw batch_error("ioError", path_str, platform::utf8_error_message(ec));
            }
        }
        try {
            atomic_file::write_atomic(target, content);
        } catch (const atomic_file::WriteError& e) {
            throw batch_error("ioError", e.path, e.reason);
        }
        return json{{"path", platform::utf8_from_path(target)}, {"bytes", content.size()}};
    });

    router.add_method("batch.settings.get", [&services](const json&, rpc::RpcContext&) {
        const fs::path file = services.dirs.config / "batch-converter.json";
        json raw = json::object();
        bool has_stored = false;
        std::error_code ec;
        if (fs::exists(file, ec)) {
            store_lock::StoreLock lock(file);
            try {
                json parsed = json::parse(atomic_file::read_file(file), nullptr, true, true);
                if (parsed.is_object()) {
                    raw = std::move(parsed);
                    has_stored = true;
                }
            } catch (const std::exception&) {
                log::warning("core", "batch.settings.unreadable",
                             "batch-converter.json could not be read; defaults used",
                             log::extras({{"path", platform::utf8_from_path(file)}}));
            }
        }
        return json{
            {"hasStored", has_stored},
            {"settings", sanitize_batch_settings(raw, services.settings.get(), has_stored)}};
    });

    router.add_method("batch.settings.save", [&services](const json& params, rpc::RpcContext&) {
        auto it = params.find("settings");
        if (it == params.end() || !it->is_object()) {
            throw rpc::invalid_params("settings must be an object", json{{"field", "settings"}});
        }

        const fs::path file = services.dirs.config / "batch-converter.json";
        std::error_code ec;
        fs::create_directories(file.parent_path(), ec);
        if (ec) {
            throw batch_error("ioError", platform::utf8_from_path(file),
                              platform::utf8_error_message(ec));
        }

        store_lock::StoreLock lock(file);
        json incoming = *it;
        // On 1-2 core hosts the UI omits parallel/workerCount so previously stored multi-core
        // settings survive if the user shares a config folder across machines.
        if ((!incoming.contains("parallel") || !incoming.contains("workerCount")) &&
            fs::exists(file, ec)) {
            try {
                json on_disk = json::parse(atomic_file::read_file(file), nullptr, false, true);
                if (on_disk.is_object()) {
                    if (!incoming.contains("parallel") && on_disk.contains("parallel") &&
                        on_disk["parallel"].is_boolean()) {
                        incoming["parallel"] = on_disk["parallel"];
                    }
                    if (!incoming.contains("workerCount") && on_disk.contains("workerCount") &&
                        on_disk["workerCount"].is_number_integer() &&
                        on_disk["workerCount"].get<long long>() >= 1) {
                        incoming["workerCount"] = on_disk["workerCount"];
                    }
                }
            } catch (const std::exception&) {
                // Unreadable prior file; proceed with incoming settings.
            }
        }

        json out = sanitize_batch_settings(incoming, services.settings.get(), true);
        try {
            atomic_file::write_atomic(file, out.dump(2) + "\n");
        } catch (const atomic_file::WriteError& e) {
            throw batch_error("ioError", e.path, e.reason);
        }
        return json{{"settings", std::move(out)}};
    });
}

}  // namespace mfbe::server
