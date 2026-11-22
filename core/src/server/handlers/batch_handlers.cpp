// Feature 019 (T012; contracts/rpc-api.md §3): batch.* JSON-RPC handlers.
#include "batch/extractor.hpp"
#include "batch/run_state.hpp"
#include "batch/scanner.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/rpc.hpp>
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

}  // namespace

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
}

}  // namespace mfbe::server
