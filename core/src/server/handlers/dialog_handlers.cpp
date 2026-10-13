// dialog.* handlers (T025): delegate to the attached DialogProvider, 1050 when none.
#include "server/services.hpp"

#include <mfbe/dialog_provider.hpp>

namespace mfbe::server {
namespace {

using nlohmann::json;

std::shared_ptr<DialogProvider> require_provider(Services& services) {
    auto provider = services.dialog_provider();
    if (!provider) {
        throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                            json{{"reason", "no shell to show a native dialog"}});
    }
    return provider;
}

// Runs `call` (which hands the request to the provider) translating provider failures into
// RPC errors. The provider's callback may fire on any thread; the Responder is thread-safe.
template <typename Fn>
void guarded(const rpc::Responder& respond, Fn&& call) {
    try {
        call();
    } catch (const DialogUnavailable& e) {
        respond.fail(rpc::RpcError(rpc::codes::kDialogUnavailable, "", json{{"reason", e.what()}}));
    } catch (const std::invalid_argument& e) {
        respond.fail(rpc::invalid_params(e.what()));
    }
}

}  // namespace

void register_dialog_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_async_method("dialog.openFile", [&services](const json& params, rpc::RpcContext&,
                                                           rpc::Responder respond) {
        auto provider = require_provider(services);
        OpenFileRequest request;
        try {
            request = open_file_request_from_json(rpc::params::object(params));
        } catch (const std::invalid_argument& e) {
            throw rpc::invalid_params(e.what());
        }
        guarded(respond, [&] {
            provider->open_file(request,
                                [respond](OpenFileResult result) { respond.ok(to_json(result)); });
        });
    });

    router.add_async_method("dialog.saveFile", [&services](const json& params, rpc::RpcContext&,
                                                           rpc::Responder respond) {
        auto provider = require_provider(services);
        SaveFileRequest request;
        try {
            request = save_file_request_from_json(rpc::params::object(params));
        } catch (const std::invalid_argument& e) {
            throw rpc::invalid_params(e.what());
        }
        guarded(respond, [&] {
            provider->save_file(request,
                                [respond](SaveFileResult result) { respond.ok(to_json(result)); });
        });
    });

    router.add_async_method("dialog.pickFolder", [&services](const json& params, rpc::RpcContext&,
                                                             rpc::Responder respond) {
        auto provider = require_provider(services);
        PickFolderRequest request;
        try {
            request = pick_folder_request_from_json(rpc::params::object(params));
        } catch (const std::invalid_argument& e) {
            throw rpc::invalid_params(e.what());
        }
        guarded(respond, [&] {
            provider->pick_folder(
                request, [respond](PickFolderResult result) { respond.ok(to_json(result)); });
        });
    });

    router.add_async_method("dialog.message", [&services](const json& params, rpc::RpcContext&,
                                                          rpc::Responder respond) {
        auto provider = require_provider(services);
        MessageRequest request;
        try {
            request = message_request_from_json(rpc::params::object(params));
        } catch (const std::invalid_argument& e) {
            throw rpc::invalid_params(e.what());
        }
        guarded(respond, [&] {
            provider->message(request,
                              [respond](MessageResult result) { respond.ok(to_json(result)); });
        });
    });
}

}  // namespace mfbe::server
