// log.error handler (T024): UI / shell / script failures go into the errors-only log.
#include "server/services.hpp"

#include <mfbe/log.hpp>

namespace mfbe::server {

using nlohmann::json;

void register_log_handlers(rpc::RpcRouter& router, Services&) {
    router.add_method("log.error", [](const json& params, rpc::RpcContext&) {
        const std::string source = rpc::params::string_or(params, "source", "ui");
        const std::string code = rpc::params::string_or(params, "code", "ui.error");
        const std::string message = rpc::params::string(params, "message");
        const std::string stack = rpc::params::string_or(params, "stack", "");
        const std::string level = rpc::params::string_or(params, "level", "error");
        log::Context ctx;
        if (const json* context = rpc::params::opt_field(params, "context")) {
            if (!context->is_object()) {
                throw rpc::invalid_params("context must be an object", json{{"field", "context"}});
            }
            for (auto it = context->begin(); it != context->end(); ++it) {
                const std::string value = it->is_string() ? it->get<std::string>() : it->dump();
                if (it.key() == "docId") {
                    ctx.docId = value;
                } else if (it.key() == "nodeId") {
                    ctx.nodeId = value;
                } else if (it.key() != "version" && it.key() != "platform") {
                    ctx.extra[it.key()] = value;
                }
            }
        }
        if (level == "warning" || level == "warn") {
            log::warning(source, code, message, ctx, stack);
        } else {
            log::error(source, code, message, ctx, stack);
        }
        return json::object();
    });
}

}  // namespace mfbe::server
