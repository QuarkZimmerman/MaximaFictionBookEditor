// settings.get / settings.set handlers and the settings.changed notification (T018).
#include "server/services.hpp"

#include <mfbe/settings.hpp>

namespace mfbe::server {

using nlohmann::json;

void register_settings_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("settings.get", [&services](const json&, rpc::RpcContext&) {
        return services.settings.get();
    });

    router.add_method("settings.set", [&services](const json& params, rpc::RpcContext& ctx) {
        const json& patch = rpc::params::object_field(params, "patch");
        settings::ApplyResult result;
        try {
            result = services.settings.apply_patch(patch);
        } catch (const settings::SettingsError& e) {
            throw rpc::RpcError(rpc::codes::kSettingsInvalid, "settings.invalid: " + e.reason,
                                json{{"field", e.field}});
        }
        services.refresh_layers();  // custom genres/scripts folders may have changed
        if (patch.contains("other") && patch["other"].is_object() &&
            patch["other"].contains("genresFolder")) {
            services.refresh_genres();
        }
        if (services.spell && patch.contains("view") && patch["view"].is_object() &&
            patch["view"].contains("customDictionaryPath")) {
            std::filesystem::path custom =
                services.settings.get_string("view.customDictionaryPath");
            if (custom.empty()) {
                custom = services.dirs.data / "custom.dic";
            }
            services.spell->set_custom_path(custom);
        }
        ctx.notifier.notify("settings.changed", json{{"settings", result.settings}});
        return json{{"settings", result.settings}, {"restartRequired", result.restartRequired}};
    });

    // Hotkey overrides (contracts/resource-formats.md §7). Defaults live in the UI; the core
    // persists the user's bindings only.
    // Contract: hotkeys.get/defaults return HotkeyBinding[] (the UI owns the default table,
    // so `defaults` is empty here); hotkeys.set returns {bindings, collisions}.
    router.add_method("hotkeys.get", [&services](const json&, rpc::RpcContext&) {
        return services.hotkeys.to_json();
    });
    router.add_method("hotkeys.defaults",
                      [](const json&, rpc::RpcContext&) { return json::array(); });
    router.add_method("hotkeys.set", [&services](const json& params, rpc::RpcContext& ctx) {
        const json& list = params.value("bindings", json::array());
        if (!list.is_array()) {
            throw rpc::RpcError(rpc::codes::kInvalidParams, "bindings must be an array");
        }
        std::vector<settings::HotkeyBinding> bindings;
        for (const auto& item : list) {
            if (!item.is_object())
                continue;
            settings::HotkeyBinding b;
            b.command = item.value("commandId", item.value("command", std::string{}));
            b.keys = item.value("keys", std::string{});
            if (!b.command.empty())
                bindings.push_back(std::move(b));
        }
        services.hotkeys.set_bindings(std::move(bindings));
        json result{{"bindings", services.hotkeys.to_json()}, {"collisions", json::array()}};
        ctx.notifier.notify("hotkeys.changed", result);
        return result;
    });
}

}  // namespace mfbe::server
