// app.* handlers (T024): app.info, app.quit, app.openLogFolder, app.openFolder,
// app.setUiLanguage.
#include "server/services.hpp"

#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <filesystem>
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

    router.add_method("app.openLogFolder", [&services](const json&, rpc::RpcContext&) {
        return open_folder(services, services.dirs.logs);
    });

    router.add_method("app.openFolder", [&services](const json& params, rpc::RpcContext&) {
        return open_folder(services, platform::path_from_utf8(rpc::params::string(params, "path")));
    });

    router.add_method("app.setUiLanguage", [&services](const json& params, rpc::RpcContext& ctx) {
        const std::string lang = rpc::params::string(params, "lang");
        if (lang != "en" && lang != "ru" && lang != "system") {
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
