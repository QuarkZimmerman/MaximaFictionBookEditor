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
//   GET/HEAD /scripts/{scriptId}/{file}      package files for the sandbox loader; only files
//        inside the script's own folder (no "..", no absolute paths); .js served as
//        text/javascript; 404 otherwise.
#include "server/loopback_server.hpp"
#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/scripts.hpp>

namespace mfbe::server {
namespace {

using nlohmann::json;

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
