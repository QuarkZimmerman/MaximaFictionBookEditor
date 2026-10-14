// dialog.* handlers (T025): delegate to the attached DialogProvider, 1050 when none.
//
// Linux and macOS: the folder of the file chosen in Open or Save As (the dialogs that offer
// FictionBook files) is kept in session.lastFileDialogFolder, and every file dialog that names no
// folder opens there. Windows keeps that folder itself (the shell's client GUID for both
// dialogs, as the original editor did).
#include "server/services.hpp"

#include <mfbe/dialog_provider.hpp>

#include <filesystem>
#include <optional>
#include <string>
#include <system_error>
#include <utility>

namespace mfbe::server {
namespace {

using nlohmann::json;

#if defined(_WIN32)
constexpr bool kKeepsLastFolder = false;
#else
constexpr bool kKeepsLastFolder = true;
#endif

constexpr const char* kLastFolderKey = "session.lastFileDialogFolder";

// The folder last used by Open or Save As, while it exists.
std::optional<std::string> last_folder(const Services& services) {
    if (!kKeepsLastFolder) {
        return std::nullopt;
    }
    std::string folder = services.settings.get_string(kLastFolderKey);
    std::error_code ec;
    if (folder.empty() || !std::filesystem::is_directory(platform::path_from_utf8(folder), ec)) {
        return std::nullopt;
    }
    return folder;
}

bool names_folder(const std::optional<std::string>& path) {
    return path && !platform::path_from_utf8(*path).parent_path().empty();
}

// Keeps the folder of `chosen`. The provider answers on any thread; the settings change on the
// transport thread. No settings.changed: the interface does not read the key, and the
// notification would reset the session flags it keeps itself.
void remember_folder(Services& services, const std::string& chosen) {
    if (!kKeepsLastFolder) {
        return;
    }
    const std::filesystem::path parent = platform::path_from_utf8(chosen).parent_path();
    if (parent.empty()) {
        return;
    }
    auto store = [&services, folder = platform::utf8_from_path(parent)] {
        if (services.settings.get_string(kLastFolderKey) == folder) {
            return;
        }
        try {
            services.settings.apply_patch(json{{"session", {{"lastFileDialogFolder", folder}}}});
        } catch (const std::exception&) {
            // A convenience: the next dialog opens elsewhere (write failures are logged by the
            // settings store).
        }
    };
    if (services.post) {
        services.post(std::move(store));
    } else {
        store();
    }
}

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
        if (!request.folder) {
            request.folder = last_folder(services);
        }
        const bool remember = request.documentDialog;
        guarded(respond, [&] {
            provider->open_file(request, [respond, &services, remember](OpenFileResult result) {
                if (remember && !result.paths.empty()) {
                    remember_folder(services, result.paths.front());
                }
                respond.ok(to_json(result));
            });
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
        if (!names_folder(request.defaultPath)) {
            request.folder = last_folder(services);
        }
        const bool remember = request.documentDialog;
        guarded(respond, [&] {
            provider->save_file(request, [respond, &services, remember](SaveFileResult result) {
                if (remember && result.path) {
                    remember_folder(services, *result.path);
                }
                respond.ok(to_json(result));
            });
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
