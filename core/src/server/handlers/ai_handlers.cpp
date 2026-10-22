// ai.* handlers (feature 005, rpc-api.md §3.12):
//
//   ai.services() -> AiServicesResult        the effective list and the state of its files,
//        loaded on the first ai.* call of the core (never at start-up) or at the last reload
//   ai.reloadServices() -> AiServicesResult  re-reads both files, replaces the list in effect,
//        emits resources.changed {what: 'aiServices'}; a running job keeps the entry it resolved
//   ai.createUserServices() -> {path, created}  *Edit list*: a byte-exact copy of the bundled
//        file into <Data>/ai-services.json when absent (never overwritten), then a reload with
//        the notification; 1002 {path, reason} when the copy cannot be written
//
// Nothing of this family touches the network at start-up: the first ai.* call reads the list
// and creates the transport (the HTTP client's one-time initialisation).
#include "server/ai_state.hpp"
#include "server/services.hpp"

#include <mfbe/ai_services.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>

namespace mfbe::server {
namespace {

using nlohmann::json;

json reload_and_notify(Services& services, rpc::RpcContext& ctx) {
    const auto list = services.ai.reload();
    ctx.notifier.notify("resources.changed", json{{"what", "aiServices"}});
    return list->to_json();
}

}  // namespace

void register_ai_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("ai.services", [&services](const json&, rpc::RpcContext&) {
        return services.ai.services()->to_json();
    });

    router.add_method("ai.reloadServices", [&services](const json&, rpc::RpcContext& ctx) {
        return reload_and_notify(services, ctx);
    });

    router.add_method("ai.createUserServices", [&services](const json&, rpc::RpcContext& ctx) {
        services.ai.touch();
        ai::UserCopy copy;
        try {
            copy = ai::create_user_copy(services.ai.bundled_file(), services.ai.user_layer().user);
        } catch (const atomic_file::WriteError& e) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                json{{"path", e.path}, {"reason", e.reason}});
        }
        reload_and_notify(services, ctx);
        return json{{"path", platform::utf8_from_path(copy.path)}, {"created", copy.created}};
    });
}

}  // namespace mfbe::server
