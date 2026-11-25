// JSON-RPC handlers for Maxima Library Lookup Service v2 integration (feature 021,
// specs/021-maxima-library-lookup/contracts/rpc-api.md §2–§7).
#include "server/services.hpp"

#include <mfbe/settings.hpp>

namespace mfbe::server {

using nlohmann::json;

void register_maxima_lookup_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("maximaLookup.status", [&services](const json&, rpc::RpcContext&) {
        return services.maxima_lookup.status(services.settings).to_json();
    });

    router.add_method("maximaLookup.revealToken", [&services](const json&, rpc::RpcContext&) {
        const lookup::MaximaLookupRevealResult revealed = services.maxima_lookup.reveal_token();
        return json{{"token", revealed.token}, {"readable", revealed.readable}};
    });

    router.add_method("maximaLookup.test", [&services](const json& params, rpc::RpcContext& ctx) {
        if (!params.is_object()) {
            throw rpc::RpcError(rpc::codes::kInvalidParams, "expected object params");
        }
        const json copied = params;
        const std::string job_id =
            ctx.jobs.start([&services, copied](rpc::JobControl& control) {
                return services.maxima_lookup.run_verify_test(copied, control);
            });
        return json{{"jobId", job_id}};
    });

    router.add_method("maximaLookup.saveConfig",
                      [&services](const json& params, rpc::RpcContext& ctx) {
                          lookup::MaximaLookupService::SaveOutcome outcome;
                          try {
                              outcome = services.maxima_lookup.save_config(params, services.settings);
                          } catch (const settings::SettingsError& e) {
                              json data{{"field", e.field}};
                              if (!e.reason.empty()) {
                                  data["reason"] = e.reason;
                              }
                              throw rpc::RpcError(rpc::codes::kSettingsInvalid,
                                                  "settings.invalid: " + e.reason, std::move(data));
                          }
                          ctx.notifier.notify("settings.changed",
                                              json{{"settings", outcome.apply.settings}});
                          return json{{"settings", outcome.apply.settings},
                                      {"status", outcome.status.to_json()}};
                      });

    router.add_async_method(
        "maximaLookup.search",
        [&services](const json& params, rpc::RpcContext&, rpc::Responder respond) {
            services.maxima_lookup.dispatch_search(
                params, services.settings,
                [respond](json result) { respond.ok(std::move(result)); });
        });

    router.add_async_method(
        "maximaLookup.exists",
        [&services](const json& params, rpc::RpcContext&, rpc::Responder respond) {
            services.maxima_lookup.dispatch_exists(
                params, services.settings,
                [respond](json result) { respond.ok(std::move(result)); });
        });
}

}  // namespace mfbe::server
