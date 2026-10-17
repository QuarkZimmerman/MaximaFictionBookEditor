// app.* handlers (T024): app.info, app.quit, app.openLogFolder, app.openFolder,
// app.setUiLanguage; feature 002: app.latestRelease, app.beep; feature 003: app.restart.
#include "server/services.hpp"

#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <filesystem>
#include <optional>
#include <system_error>

namespace mfbe::server {

using nlohmann::json;

// Opens a folder through the shell (dialog provider) or the OS opener; without a shell the
// call is unavailable in headless mode (1050).
json open_folder_with_shell(Services& services, const std::filesystem::path& path) {
    const std::string text = platform::utf8_from_path(path);
    std::error_code ec;
    if (!std::filesystem::is_directory(path, ec)) {
        throw rpc::RpcError(rpc::codes::kDocIoError, "",
                            json{{"path", text}, {"reason", "not a directory"}});
    }
    auto provider = services.dialog_provider();
    if (!provider) {
        throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                            json{{"reason", "no shell attached to open folders"}});
    }
    if (!provider->open_path(text) && !process::open_folder(path)) {
        throw rpc::RpcError(rpc::codes::kDocIoError, "",
                            json{{"path", text}, {"reason", "cannot start the file manager"}});
    }
    return json::object();
}

namespace {

json open_folder(Services& services, const std::filesystem::path& path) {
    return open_folder_with_shell(services, path);
}

}  // namespace

void register_app_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("app.info", [&services](const json&, rpc::RpcContext&) {
        json info;
        info["version"] = version::kVersion;
        info["build"] = version::kBuildId;
        info["gitHash"] = version::kGitHash;
        info["buildDate"] = version::kBuildDate;
        info["productName"] = version::kProductName;
        info["apiVersion"] = version::kApiVersion;
        info["apiMinor"] = version::kApiMinor;
        info["platform"] = platform::platform_name();
        info["pid"] = platform::current_pid();
        info["port"] = services.port;
        info["uiLanguage"] = services.settings.get_string("view.uiLanguage", "system");
        info["systemLanguage"] = platform::system_language();
        info["dataDir"] = platform::utf8_from_path(services.dirs.data);
        info["configDir"] = platform::utf8_from_path(services.dirs.config);
        info["logDir"] = platform::utf8_from_path(services.dirs.logs);
        info["resourcesDir"] = platform::utf8_from_path(services.resources_dir);
        info["scriptsDir"] = platform::utf8_from_path(services.scripts_dir);
        if (services.dirs.portable) {
            info["portableDir"] = platform::utf8_from_path(*services.dirs.portable);
        }
        info["resourceLayers"] = services.layers.report();
        info["testHooks"] = services.test_hooks;
        info["uptimeMs"] = services.uptime_ms();
        return info;
    });

    router.add_method("app.quit", [&services](const json& params, rpc::RpcContext&) {
        (void)rpc::params::boolean_or(params, "force", false);
        log::info("server", "app.quit requested");
        if (services.request_quit) {
            services.request_quit();
        }
        return json::object();
    });

    // "Restart now?" (feature 003 US3, rpc-api.md §3.1): the shell starts the same program again
    // with its own options, `reopen` as FILE and the window placement, then the normal quit
    // follows. Without a shell (browser/dev mode) the call is unavailable (1070) and the UI
    // reloads its page; a shell that could not start the new instance answers 1071 {reason} and
    // the editor stays open. With test hooks every call is recorded (test.restartRequests).
    router.add_method("app.restart", [&services](const json& params, rpc::RpcContext&) {
        const std::optional<std::string> reopen = rpc::params::opt_string(params, "reopen");
        log::info("server", reopen ? "app.restart requested with a document to reopen"
                                   : "app.restart requested");
        RestartOutcome outcome;
        if (services.request_restart) {
            outcome = services.request_restart(reopen);
        }
#ifdef MFBE_TEST_HOOKS
        if (services.queued_dialogs) {
            services.queued_dialogs->record_restart(reopen, outcome.argv);
        }
#endif
        if (!services.request_restart) {
            throw rpc::RpcError(rpc::codes::kRestartUnavailable, "",
                                json{{"reason", "no shell attached to restart the editor"}});
        }
        if (!outcome.started) {
            throw rpc::RpcError(rpc::codes::kRestartFailed, "", json{{"reason", outcome.reason}});
        }
        // The new instance waits for this process to end (--wait-for-exit): quit as app.quit does.
        if (services.request_quit) {
            services.request_quit();
        }
        return json::object();
    });

    router.add_method("app.openLogFolder", [&services](const json&, rpc::RpcContext&) {
        return open_folder(services, services.dirs.logs);
    });

    router.add_method("app.openFolder", [&services](const json& params, rpc::RpcContext&) {
        return open_folder(services, platform::path_from_utf8(rpc::params::string(params, "path")));
    });

    // Help > Check for new version (feature 002, decision D15): the shell asks the release
    // service for the latest release; the core relays its answer. Never sent on its own.
    router.add_async_method("app.latestRelease", [&services](const json&, rpc::RpcContext&,
                                                             rpc::Responder respond) {
        auto provider = services.dialog_provider();
        if (!provider) {
            respond.fail(rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                       json{{"reason", "no shell to ask for the latest release"}}));
            return;
        }
        try {
            provider->latest_release([respond](ReleaseResult result) {
                if (result.release) {
                    respond.ok(to_json(result));
                } else {
                    respond.fail(rpc::RpcError(rpc::codes::kReleaseUnavailable, "",
                                               json{{"reason", result.error}}));
                }
            });
        } catch (const DialogUnavailable& e) {
            respond.fail(
                rpc::RpcError(rpc::codes::kDialogUnavailable, "", json{{"reason", e.what()}}));
        }
    });

    // The system sound of a search that continued from the other end of the document (as the
    // original's MessageBeep); without a shell there is nothing to play.
    router.add_method("app.beep", [&services](const json&, rpc::RpcContext&) {
        if (auto provider = services.dialog_provider()) {
            provider->beep();
        }
        return json::object();
    });

    router.add_method("app.setUiLanguage", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string lang = rpc::params::string(params, "lang");
        if (lang != "en" && lang != "ru" && lang != "uk" && lang != "system") {
            throw rpc::RpcError(rpc::codes::kSettingsInvalid, "",
                                json{{"field", "view.uiLanguage"}});
        }
        auto result = services.settings.apply_patch(json{{"view", {{"uiLanguage", lang}}}});
        if (result.restartRequired) {
            ctx.notifier.notify("settings.changed", json{{"settings", result.settings}});
        }
        return json{{"restartRequired", result.restartRequired}};
    });
}

}  // namespace mfbe::server
