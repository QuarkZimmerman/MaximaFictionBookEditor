// resources.* handlers (T073/T074) - contracts/rpc-api.md §3.6.
//
//   resources.genres() -> {entries: GenreEntry[], categories, userFiles, effectiveSources,
//                          issues}      (GenreEntry = {code, category, names{en,ru,uk}, source,
//                          file?, alsoIn?}; rebuilt from the layers on every call)
//   resources.languages() -> {groups: [{key, title{en,ru,uk},
//                             languages: [{code, name{en,ru,uk}}]}],
//                             entries: [{code, names{en,ru,uk}, group}]}
//   resources.symbols() -> [{index, codepoint, char, names{en,ru,uk}}]
//   (the names carry every interface language - the Ukrainian ones since feature 003 US1;
//   the UI picks the interface language's name with English as the fallback)
//   resources.layers() -> [{kind, layer, path, exists, writable}]
//   resources.openGenresFolder() -> {path}   (shell-delegated; 1050 in headless mode; the
//                                           folder is the custom genres folder from settings
//                                           or <Data>/genres, created on demand)
//   resources.template() -> {path, layer, issue?}   (feature 002: the template a new document
//                                                   would use now)
//   resources.openTemplateFolder() -> {path}        (shell-delegated; the template folder from
//                                                   settings or <Data>, created on demand)
//   resources.openDictionariesFolder() -> {path}    (feature 003 US4, shell-delegated; the
//                                                   dictionaries folder chosen in Settings
//                                                   (other.dictionariesFolder) or
//                                                   <Data>/dictionaries, created on demand)
#include "server/services.hpp"

#include <mfbe/log.hpp>
#include <mfbe/templates.hpp>

#include <system_error>

namespace mfbe::server {

using nlohmann::json;

void register_resources_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("resources.genres", [&services](const json&, rpc::RpcContext&) {
        services.refresh_genres();
        json result = services.genre_catalog()->to_json();
        // Feature 015 (FR-004): how many genre items the editor passes over, so that the genre
        // picker can point to Settings, where they are listed with their reasons.
        result["passedOver"] = services.layers.passed_over(resources::Kind::genres).size();
        return result;
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
        std::filesystem::path folder =
            platform::path_from_utf8(services.settings.get_string("other.genresFolder"));
        if (folder.empty()) {
            folder = services.layers.user_folder(resources::Kind::genres, true);
        }
        json result = open_folder_with_shell(services, folder);
        result["path"] = platform::utf8_from_path(folder);
        return result;
    });

    const auto template_setting = [&services] {
        return platform::path_from_utf8(services.settings.get_string("other.templateFolder"));
    };

    router.add_method("resources.template", [&services, template_setting](const json&,
                                                                          rpc::RpcContext&) {
        return resources::to_json(resources::resolve_template(services.layers, template_setting()));
    });

    // Feature 015 (FR-004, contracts/rpc-api.md): the items of the user layers that the editor
    // passes over, with their reasons, per kind; the user template that cannot be used is one of
    // them (reason "invalid", its own reason as "detail").
    router.add_method("resources.passedOver", [&services, template_setting](const json& params,
                                                                            rpc::RpcContext&) {
        std::string only;
        if (params.is_object() && params.contains("kind")) {
            if (!params["kind"].is_string()) {
                throw rpc::invalid_params("kind must be a string", json{{"field", "kind"}});
            }
            only = params["kind"].get<std::string>();
            if (only != "template" && !resources::kind_from_string(only)) {
                throw rpc::invalid_params("unknown kind", json{{"field", "kind"}});
            }
        }
        json items = json::array();
        for (const resources::Kind kind :
             {resources::Kind::genres, resources::Kind::scripts, resources::Kind::dictionaries}) {
            if (!only.empty() && only != resources::to_string(kind)) {
                continue;
            }
            for (const resources::PassedOver& item : services.layers.passed_over(kind)) {
                items.push_back({{"kind", resources::to_string(item.kind)},
                                 {"layer", resources::to_string(item.layer)},
                                 {"path", platform::utf8_from_path(item.path)},
                                 {"reason", item.reason}});
            }
        }
        if (only.empty() || only == "template") {
            const resources::EffectiveTemplate effective =
                resources::resolve_template(services.layers, template_setting());
            if (effective.issue) {
                const std::filesystem::path folder = effective.issue->path.parent_path();
                const char* layer = "user";
                if (!template_setting().empty() && folder == template_setting()) {
                    layer = "settings";
                } else if (services.dirs.portable && folder == *services.dirs.portable) {
                    layer = "portable";
                }
                items.push_back({{"kind", "template"},
                                 {"layer", layer},
                                 {"path", platform::utf8_from_path(effective.issue->path)},
                                 {"reason", "invalid"},
                                 {"detail", effective.issue->reason}});
            }
        }
        return json{{"items", items}};
    });

    router.add_method("resources.openTemplateFolder",
                      [&services, template_setting](const json&, rpc::RpcContext&) {
                          const std::filesystem::path folder =
                              resources::template_folder(services.layers, template_setting());
                          std::error_code ec;
                          std::filesystem::create_directories(folder, ec);
                          json result = open_folder_with_shell(services, folder);
                          result["path"] = platform::utf8_from_path(folder);
                          return result;
                      });

    router.add_method(
        "resources.openDictionariesFolder", [&services](const json&, rpc::RpcContext&) {
            // The chosen folder when there is one, else the per-user folder; either is created
            // when missing (spec FR-030), so the user can drop files into it right away.
            std::filesystem::path folder =
                platform::path_from_utf8(services.settings.get_string("other.dictionariesFolder"));
            if (folder.empty()) {
                folder = services.layers.user_folder(resources::Kind::dictionaries, true);
            } else {
                std::error_code ec;
                std::filesystem::create_directories(folder, ec);
            }
            json result = open_folder_with_shell(services, folder);
            result["path"] = platform::utf8_from_path(folder);
            return result;
        });
}

}  // namespace mfbe::server
