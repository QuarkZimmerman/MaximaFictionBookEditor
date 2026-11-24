// Feature 020 (T012, contracts/rpc-api.md §1): ocr.report handler.
#include "server/services.hpp"

#include <mfbe/ocr.hpp>

namespace mfbe::server {

using nlohmann::json;

void register_ocr_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("ocr.report", [&services](const json&, rpc::RpcContext&) {
        services.refresh_layers();
        const std::string custom = services.settings.get_string("ocr.folder");
        return ocr::to_json(ocr::build_catalog(services.layers, custom));
    });
}

}  // namespace mfbe::server
