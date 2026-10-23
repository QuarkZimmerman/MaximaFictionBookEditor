// scripts.* handlers and the /scripts HTTP endpoint (T101) - contracts/rpc-api.md §2, §3.8.
//
//   scripts.list() -> {groups: [{id, order, names{en,ru}, dir, icon?, scripts: [Script]}],
//                      issues: [{path, id?, reason, message, severity}],
//                      folders: {bundled, user, custom?, portable?}}
//        Script = script.json fields + {id, group, dir, folder, source (layer), entryUrl,
//        iconUrl?, warnings[]}; rebuilt from the layers on every call (new packages are picked
//        up without a restart). Groups are ordered by their `NN_` prefix, the `tree` group last.
//   scripts.source({scriptId | id}) -> {entryUrl, entry, dir, files: string[]}
//        1030 script.notFound for unknown ids.
//   scripts.reload() -> {count}      rescans and emits resources.changed {what: "scripts"}
//   scripts.lastRun({scriptId? | id?}) -> {scriptId?, id?}
//        remembers the "Last script" in the session settings (session.lastScript); without a
//        parameter returns the remembered id (dropped when the script no longer exists).
//   resources.openScriptsFolder() -> {path}   (shell-delegated like openGenresFolder; the
//        folder is the custom scripts folder from settings or <Data>/scripts, created on demand)
//   scripts.write({id, group?, folder?, files: [{path, content}], overwrite?})
//        -> {id, path, reloaded: true, warnings}   (feature 005, the AI assistant - rpc-api.md
//        §3.8 of the feature, resource-formats.md §D): writes a user script package into
//        <Data>/scripts/<group>/<folder>/ (the user layer and nothing else; group default
//        90_assistant, folder default the id's last segment) under the segment rule, the
//        1-64 files / 1 MiB / 4 MiB limits, canonical containment and the symlink refusal
//        (1002 {path, reason: 'symlink'}); script.json validated by the loader before anything
//        is written (1031 {id, errors}, invalidParams {field: 'files.script.json.id'}); a
//        bundled id is 1202, another package with the id or an existing target folder 1203
//        unless `overwrite` and every conflict is the target itself; written all or nothing
//        through <Data>/.scripts-write-<pid>/; then the rescan of scripts.reload and
//        resources.changed {what: 'scripts'}.
//   GET/HEAD /scripts/{scriptId}/{file}      package files for the sandbox loader; only files
//        inside the script's own folder (no "..", no absolute paths); .js served as
//        text/javascript; 404 otherwise.
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/scripts.hpp>

#include <algorithm>
#include <cstddef>
#include <set>
#include <string>
#include <vector>

namespace mfbe::server {
namespace {

using nlohmann::json;
namespace fs = std::filesystem;

constexpr std::size_t kMaxWriteFiles = 64;
constexpr std::size_t kMaxFileBytes = 1024 * 1024;
constexpr std::size_t kMaxTotalBytes = 4 * 1024 * 1024;

struct WriteRequest {
    std::string id;
    std::string group;
    std::string folder;
    std::vector<scripts::PackageFile> files;
    bool overwrite = false;
};

// The parameters of scripts.write under the rules of rpc-api §3.8 (feature 005): the id rule,
// the segment rule on group, folder and every path segment, the file count and size limits.
WriteRequest write_request(const json& params) {
    const json& p = rpc::params::object(params);
    WriteRequest request;
    request.id = rpc::params::string(p, "id");
    if (!scripts::is_valid_script_id(request.id)) {
        throw rpc::invalid_params("id is not a valid script id", json{{"field", "id"}});
    }
    request.group = rpc::params::string_or(p, "group", scripts::kAssistantGroup);
    if (!scripts::is_valid_path_segment(request.group)) {
        throw rpc::invalid_params("group is not a valid folder name", json{{"field", "group"}});
    }
    request.folder =
        rpc::params::opt_string(p, "folder").value_or(scripts::default_folder_of_id(request.id));
    if (!scripts::is_valid_path_segment(request.folder)) {
        throw rpc::invalid_params("folder is not a valid folder name", json{{"field", "folder"}});
    }
    request.overwrite = rpc::params::boolean_or(p, "overwrite", false);
    const json* files = rpc::params::opt_field(p, "files");
    if (files == nullptr || !files->is_array() || files->empty() ||
        files->size() > kMaxWriteFiles) {
        throw rpc::invalid_params("files must hold 1 to 64 entries", json{{"field", "files"}});
    }
    std::set<std::string> seen;
    std::size_t total = 0;
    for (std::size_t i = 0; i < files->size(); ++i) {
        const json& entry = (*files)[i];
        const std::string index = "files[" + std::to_string(i) + "]";
        if (!entry.is_object() || !entry.contains("path") || !entry["path"].is_string() ||
            !scripts::is_valid_package_path(entry["path"].get<std::string>())) {
            throw rpc::invalid_params(index + ".path is not a relative file path",
                                      json{{"field", index + ".path"}});
        }
        scripts::PackageFile file;
        file.path = entry["path"].get<std::string>();
        if (!seen.insert(file.path).second) {
            throw rpc::invalid_params(index + ".path is listed twice",
                                      json{{"field", index + ".path"}});
        }
        if (!entry.contains("content") || !entry["content"].is_string()) {
            throw rpc::invalid_params(index + ".content must be a string",
                                      json{{"field", index + ".content"}});
        }
        file.content = entry["content"].get<std::string>();
        if (file.content.size() > kMaxFileBytes || file.content.find('\0') != std::string::npos) {
            throw rpc::invalid_params(index + ".content is larger than 1 MiB or holds NUL",
                                      json{{"field", index + ".content"}});
        }
        total += file.content.size();
        if (total > kMaxTotalBytes) {
            throw rpc::invalid_params("files hold more than 4 MiB together",
                                      json{{"field", "files"}});
        }
        request.files.push_back(std::move(file));
    }
    return request;
}

rpc::RpcError invalid_manifest(const std::string& id, std::vector<std::string> errors) {
    return rpc::RpcError(rpc::codes::kScriptInvalidManifest, "",
                         json{{"id", id}, {"errors", std::move(errors)}});
}

// The manifest of the request, validated with the loader before anything is written; its id
// must be present and equal to the request's, its entry among the files.
scripts::ScriptManifest manifest_of(const WriteRequest& request) {
    const auto manifest_file =
        std::find_if(request.files.begin(), request.files.end(),
                     [](const scripts::PackageFile& f) { return f.path == "script.json"; });
    if (manifest_file == request.files.end()) {
        throw invalid_manifest(request.id, {"missingManifest: script.json is not among the files"});
    }
    const std::string default_id = request.group + "/" + request.folder;
    const std::string default_kind = request.group == "tree" ? "tree" : "menu";
    scripts::ParsedManifest parsed =
        scripts::parse_manifest_text(manifest_file->content, default_id, default_kind);
    if (!parsed.manifest) {
        throw invalid_manifest(request.id, std::move(parsed.errors));
    }
    const json raw = json::parse(manifest_file->content);  // parse_manifest_text parsed it
    if (!raw.contains("id") || !raw["id"].is_string() || parsed.manifest->id != request.id) {
        throw rpc::invalid_params("script.json must carry the id of the call",
                                  json{{"field", "files.script.json.id"}});
    }
    const std::string& entry = parsed.manifest->entry;
    if (std::none_of(request.files.begin(), request.files.end(),
                     [&](const scripts::PackageFile& f) { return f.path == entry; })) {
        throw invalid_manifest(
            request.id, {"entryMissing: entry module \"" + entry + "\" is not among the files"});
    }
    return *parsed.manifest;
}

bool same_folder(const fs::path& a, const fs::path& b) {
    std::error_code ec;
    const fs::path ca = fs::weakly_canonical(a, ec);
    if (ec) {
        return a.lexically_normal() == b.lexically_normal();
    }
    const fs::path cb = fs::weakly_canonical(b, ec);
    return !ec && ca == cb;
}

// The conflicts of rpc-api §3.8: a bundled id (1202); a non-bundled package with the id in
// another folder or layer, or the target folder itself holding another package or no valid
// manifest - lifted by `overwrite` only when every conflict is the target folder (1203).
void refuse_conflicts(const scripts::Catalog& catalog, const WriteRequest& request,
                      const fs::path& target) {
    if (const scripts::ScriptPackage* bundled = catalog.find(request.id);
        bundled != nullptr && bundled->layer == resources::LayerName::bundled) {
        throw rpc::RpcError(rpc::codes::kAiScriptIdBundled, "", json{{"id", request.id}});
    }
    const auto exists = [&](const std::string& id, const fs::path& path) {
        return rpc::RpcError(rpc::codes::kAiScriptExists, "",
                             json{{"id", id}, {"path", platform::utf8_from_path(path)}});
    };
    // Every folder a package with this id lives in: the effective one and the shadowed ones.
    std::vector<fs::path> holders;
    if (const scripts::ScriptPackage* package = catalog.find(request.id)) {
        holders.push_back(package->dir);
    }
    for (const scripts::Issue& issue : catalog.issues()) {
        if (issue.reason == "duplicateId" && issue.id == request.id) {
            holders.push_back(issue.path);
        }
    }
    for (const fs::path& holder : holders) {
        if (!same_folder(holder, target)) {
            throw exists(request.id, holder);
        }
    }
    std::error_code ec;
    if (!fs::exists(fs::symlink_status(target, ec))) {
        return;
    }
    // The target folder exists: the id of the valid manifest it holds, else the request's.
    std::string resident = request.id;
    for (const scripts::Group& group : catalog.groups()) {
        for (const scripts::ScriptPackage& package : group.scripts) {
            if (same_folder(package.dir, target)) {
                resident = package.id;
            }
        }
    }
    if (!request.overwrite || resident != request.id) {
        throw exists(resident, target);
    }
}

std::string script_id_param(const json& params) {
    const json& p = rpc::params::object(params);
    if (auto id = rpc::params::opt_string(p, "scriptId")) {
        return *id;
    }
    if (auto id = rpc::params::opt_string(p, "id")) {
        return *id;
    }
    throw rpc::invalid_params("scriptId is required", json{{"field", "scriptId"}});
}

void end_plain(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

void serve_script_file(LoopbackServer& server, Services& services, uWS::HttpResponse<false>* res,
                       uWS::HttpRequest* req) {
    if (!server.check_auth(res, req)) {
        return;
    }
    const std::string raw_id(req->getParameter(0));
    const std::string id = LoopbackServer::url_decode(raw_id);
    const std::string url(req->getUrl());
    const std::string prefix = "/scripts/" + raw_id + "/";
    if (url.compare(0, prefix.size(), prefix) != 0) {
        end_plain(res, "404 Not Found", "not found");
        return;
    }
    const std::string file = LoopbackServer::url_decode(url.substr(prefix.size()));
    auto catalog = services.script_catalog();
    const scripts::ScriptPackage* package = catalog ? catalog->find(id) : nullptr;
    if (package == nullptr) {
        // A package added after the last scan: rescan once.
        services.refresh_scripts();
        catalog = services.script_catalog();
        package = catalog ? catalog->find(id) : nullptr;
    }
    if (package == nullptr) {
        end_plain(res, "404 Not Found", "unknown script");
        return;
    }
    const std::filesystem::path path = scripts::resolve_package_file(*package, file);
    if (path.empty()) {
        end_plain(res, "404 Not Found", "not found");
        return;
    }
    std::string content;
    try {
        content = atomic_file::read_file(path);
    } catch (const atomic_file::WriteError& e) {
        log::warning("core", "scripts.readFailed", "cannot read script file",
                     log::extras({{"path", e.path}, {"reason", e.reason}}));
        end_plain(res, "500 Internal Server Error", "cannot read file");
        return;
    }
    res->writeStatus("200 OK");
    res->writeHeader("Content-Type",
                     LoopbackServer::mime_type(platform::utf8_from_path(path.extension())));
    res->writeHeader("Cache-Control", "no-cache");
    res->writeHeader("X-Content-Type-Options", "nosniff");
    if (req->getMethod() == "head") {
        res->endWithoutBody(content.size());
        return;
    }
    res->end(content);
}

}  // namespace

void register_scripts_http(LoopbackServer& server, Services& services) {
    uWS::App& app = server.app();
    app.get("/scripts/:scriptId/*", [&server, &services](auto* res, auto* req) {
        serve_script_file(server, services, res, req);
    });
    app.head("/scripts/:scriptId/*", [&server, &services](auto* res, auto* req) {
        serve_script_file(server, services, res, req);
    });
}

void register_scripts_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("scripts.list", [&services](const json&, rpc::RpcContext&) {
        services.refresh_scripts();
        return services.script_catalog()->to_json();
    });

    router.add_method("scripts.source", [&services](const json& params, rpc::RpcContext&) {
        const std::string id = script_id_param(params);
        auto catalog = services.script_catalog();
        const scripts::ScriptPackage* package = catalog ? catalog->find(id) : nullptr;
        if (package == nullptr) {
            services.refresh_scripts();
            catalog = services.script_catalog();
            package = catalog ? catalog->find(id) : nullptr;
        }
        if (package == nullptr) {
            throw rpc::RpcError(rpc::codes::kScriptNotFound, "", json{{"scriptId", id}});
        }
        if (scripts::resolve_package_file(*package, package->manifest.entry).empty()) {
            throw rpc::RpcError(rpc::codes::kScriptInvalidManifest, "",
                                json{{"scriptId", id}, {"entry", package->manifest.entry}});
        }
        return json{{"entryUrl", scripts::package_url(package->id, package->manifest.entry)},
                    {"entry", package->manifest.entry},
                    {"dir", platform::utf8_from_path(package->dir)},
                    {"files", json(scripts::package_files(*package))}};
    });

    router.add_method("scripts.reload", [&services](const json&, rpc::RpcContext& ctx) {
        services.refresh_layers();
        services.refresh_scripts();
        ctx.notifier.notify("resources.changed", json{{"what", "scripts"}});
        return json{{"count", services.script_catalog()->size()}};
    });

    router.add_method("scripts.lastRun", [&services](const json& params, rpc::RpcContext&) {
        const json& p = rpc::params::object(params);
        std::optional<std::string> id = rpc::params::opt_string(p, "scriptId");
        if (!id) {
            id = rpc::params::opt_string(p, "id");
        }
        if (id) {
            try {
                services.settings.apply_patch(json{{"session", {{"lastScript", *id}}}});
            } catch (const settings::SettingsError& e) {
                throw rpc::RpcError(rpc::codes::kSettingsInvalid, "settings.invalid: " + e.reason,
                                    json{{"field", e.field}});
            }
        }
        const std::string remembered = services.settings.get_string("session.lastScript");
        json result = json::object();
        if (!remembered.empty()) {
            auto catalog = services.script_catalog();
            if (!catalog) {
                services.refresh_scripts();
                catalog = services.script_catalog();
            }
            if (catalog && catalog->find(remembered) != nullptr) {
                result["scriptId"] = remembered;
                result["id"] = remembered;
            }
        }
        return result;
    });

    // Feature 005: the user script package of an assistant proposal, written into the user
    // layer and nothing else (resource-formats §D), confined and all or nothing.
    router.add_method("scripts.write", [&services](const json& params, rpc::RpcContext& ctx) {
        const WriteRequest request = write_request(params);
        // Containment: every joined path, made canonical, stays below the canonical
        // <Data>/scripts - named after the parameter that would leave it.
        const fs::path root = services.layers.user_folder(resources::Kind::scripts, false);
        if (root.empty()) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", ""}, {"reason", "no data folder"}});
        }
        const fs::path group_dir = root / platform::path_from_utf8(request.group);
        const fs::path target = group_dir / platform::path_from_utf8(request.folder);
        if (!scripts::is_contained(root, group_dir)) {
            throw rpc::invalid_params("group leaves the scripts folder", json{{"field", "group"}});
        }
        if (!scripts::is_contained(root, target)) {
            throw rpc::invalid_params("folder leaves the scripts folder",
                                      json{{"field", "folder"}});
        }
        for (std::size_t i = 0; i < request.files.size(); ++i) {
            if (!scripts::is_contained(root,
                                       target / platform::path_from_utf8(request.files[i].path))) {
                throw rpc::invalid_params("the file leaves the package folder",
                                          json{{"field", "files[" + std::to_string(i) + "].path"}});
            }
        }
        const auto io_failure = [](const scripts::WriteFailure& e) {
            return rpc::RpcError(rpc::codes::kDocIoError, "",
                                 json{{"path", e.path}, {"reason", e.reason}});
        };
        try {
            scripts::refuse_symlinks(root, target);
        } catch (const scripts::WriteFailure& e) {
            throw io_failure(e);
        }
        // The manifest before anything is written, then the conflicts against the current
        // layers (the rescan also removes leftovers of an interrupted write).
        manifest_of(request);
        services.refresh_layers();
        services.refresh_scripts();
        refuse_conflicts(*services.script_catalog(), request, target);
        try {
            scripts::refuse_symlinks(root, target);  // again at write time
            scripts::write_package(services.dirs.data, target, request.files);
        } catch (const scripts::WriteFailure& e) {
            throw io_failure(e);
        }
        // The rescan of scripts.reload and its notification.
        services.refresh_layers();
        services.refresh_scripts();
        ctx.notifier.notify("resources.changed", json{{"what", "scripts"}});
        json warnings = json::array();
        if (const scripts::ScriptPackage* written = services.script_catalog()->find(request.id)) {
            warnings = json(written->warnings);
        }
        return json{{"id", request.id},
                    {"path", platform::utf8_from_path(target)},
                    {"reloaded", true},
                    {"warnings", std::move(warnings)}};
    });

    router.add_method("resources.openScriptsFolder", [&services](const json&, rpc::RpcContext&) {
        std::filesystem::path folder =
            platform::path_from_utf8(services.settings.get_string("other.scriptsFolder"));
        if (folder.empty()) {
            folder = services.layers.user_folder(resources::Kind::scripts, true);
        }
        json result = open_folder_with_shell(services, folder);
        result["path"] = platform::utf8_from_path(folder);
        return result;
    });
}

}  // namespace mfbe::server
