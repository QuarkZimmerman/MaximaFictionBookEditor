// system.* handlers (feature 004, User Story 11; rpc-api.md §3.11) - shell-delegated: the
// keyboard layouts the system offers and the switch of the editor's window to one of them when
// a document is opened. Both are asynchronous (the shell answers from its UI thread) and answer
// results, never errors, for an unsupported platform, a missing layout or a refused switch, so
// that the Settings page and the open routes need no special case (FR-091).
#include "server/services.hpp"

#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>

namespace mfbe::server {
namespace {

using nlohmann::json;

}  // namespace

void register_system_handlers(rpc::RpcRouter& router, Services& services) {
    // system.keyboardLayouts() -> {supported, reason?, layouts: [{id, name}], current?}: read
    // afresh from the provider on every call (never cached); without a provider - browser/dev
    // mode without test hooks - `{supported: false, reason: "noShell", layouts: []}`.
    router.add_async_method("system.keyboardLayouts", [&services](const json&, rpc::RpcContext&,
                                                                  rpc::Responder respond) {
        auto provider = services.keyboard_layouts();
        if (!provider) {
            KeyboardLayoutList none;
            none.reason = "noShell";
            respond.ok(to_json(none));
            return;
        }
        provider->list([respond](KeyboardLayoutList list) { respond.ok(to_json(list)); });
    });

    // system.activateKeyboardLayout({id}) -> {activated, reason?}: `id` missing, empty or not a
    // string -> invalidParams {field: "id"}; no provider -> {activated: false, reason:
    // "unsupported"}; `refused` -> one errors-only log entry with the system's code (the id is a
    // layout identifier, never book text) and {activated: false, reason: "refused"}.
    router.add_async_method("system.activateKeyboardLayout", [&services](const json& params,
                                                                         rpc::RpcContext&,
                                                                         rpc::Responder respond) {
        const std::string id = rpc::params::string(params, "id");
        if (id.empty()) {
            throw rpc::invalid_params("id must be a non-empty string", json{{"field", "id"}});
        }
        auto provider = services.keyboard_layouts();
        if (!provider) {
            KeyboardLayoutSwitch none;
            none.reason = "unsupported";
            respond.ok(to_json(none));
            return;
        }
        provider->activate(id, [respond, id](KeyboardLayoutSwitch result) {
            if (result.reason == "refused") {
                log::warning("shell", "keyboard.switchRefused",
                             "the system refused the keyboard layout switch",
                             log::extras({{"id", id},
                                          {"systemCode", result.systemCode
                                                             ? std::to_string(*result.systemCode)
                                                             : std::string()},
                                          {"platform", platform::platform_name()}}));
            }
            respond.ok(to_json(result));
        });
    });
}

}  // namespace mfbe::server
