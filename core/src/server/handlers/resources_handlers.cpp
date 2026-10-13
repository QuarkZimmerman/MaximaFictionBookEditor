// resources.* handlers (T073/T074) - contracts/rpc-api.md §3.6.
//
//   resources.genres() -> {entries: GenreEntry[], categories, userFiles, effectiveSources,
//                          issues}      (GenreEntry = {code, category, names{en,ru}, source,
//                          file?, alsoIn?}; rebuilt from the layers on every call)
//   resources.languages() -> {groups: [{key, title{en,ru}, languages: [{code, name{en,ru}}]}],
//                             entries: [{code, names{en,ru}, group}]}
//   resources.symbols() -> [{index, codepoint, char, names{en,ru}}]
//   resources.layers() -> [{kind, layer, path, exists, writable}]
//   resources.openGenresFolder() -> {path}   (shell-delegated; 1050 in headless mode; the
//                                           folder is the custom genres folder from settings
//                                           or <Data>/genres, created on demand)
#include "server/services.hpp"

#include <mfbe/log.hpp>

namespace mfbe::server {

using nlohmann::json;

void register_resources_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("resources.genres", [&services](const json&, rpc::RpcContext&) {
        services.refresh_genres();
        return services.genre_catalog()->to_json();
    });

    router.add_method("resources.languages", [&services](const json&, rpc::RpcContext&) {
        return services.languages().to_json();
    });

    router.add_method("resources.symbols", [&services](const json&, rpc::RpcContext&) {
        return resources::to_json(services.symbols());
    });

    router.add_method("resources.layers", [&services](const json&, rpc::RpcContext&) {
        services.refresh_layers();
        return services.layers.report();
    });

    router.add_method("resources.openGenresFolder", [&services](const json&, rpc::RpcContext&) {
        std::filesystem::path folder = services.settings.get_string("other.genresFolder");
        if (folder.empty()) {
            folder = services.layers.user_folder(resources::Kind::genres, true);
        }
        json result = open_folder_with_shell(services, folder);
        result["path"] = folder.string();
        return result;
    });
}

}  // namespace mfbe::server
