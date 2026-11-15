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

#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/templates.hpp>

#include <fstream>
#include <iterator>
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

    // Feature 015 (FR-010..FR-015, research R5, contracts/rpc-api.md): adds one genre to the
    // user's own genres - a line of my.genres.tsv in the first writable genres folder (the folder
    // chosen in Settings when it is set and writable, else the per-user folder, which for a
    // portable copy is its user folder) - and makes it known at once.
    router.add_method("resources.addGenre", [&services](const json& params, rpc::RpcContext& ctx) {
        const auto text_field = [&params](const json& holder, const char* key) {
            if (!holder.is_object() || !holder.contains(key) || holder[key].is_null()) {
                return std::string();
            }
            if (!holder[key].is_string()) {
                throw rpc::invalid_params(std::string(key) + " must be a string",
                                          json{{"reason", "invalidText"}, {"field", key}});
            }
            return holder[key].get<std::string>();
        };
        const auto plain = [](const std::string& text) {
            return text.find_first_of("\t\r\n") == std::string::npos;
        };
        const std::string code = text_field(params, "code");
        if (!genres::is_valid_genre_code(code)) {
            throw rpc::invalid_params("not a valid genre code",
                                      json{{"reason", "invalidCode"}, {"code", code}});
        }
        const std::string category = text_field(params, "category");
        const json names =
            params.is_object() && params.contains("names") ? params["names"] : json();
        std::string en = text_field(names, "en");
        std::string ru = text_field(names, "ru");
        const std::string uk = text_field(names, "uk");
        if (category.empty() || !plain(category) || !plain(en) || !plain(ru) || !plain(uk)) {
            throw rpc::invalid_params(
                "a name or the category holds a tab or a line break, or the "
                "category is empty",
                json{{"reason", "invalidText"}});
        }
        services.refresh_genres();
        if (const genres::GenreEntry* known = services.genre_catalog()->find(code)) {
            throw rpc::invalid_params("the genre is already listed",
                                      json{{"reason", "duplicate"}, {"source", known->source}});
        }
        if (en.empty()) {
            en = code;
        }
        if (ru.empty()) {
            ru = code;
        }
        std::string line = code + "\t" + category + "\t" + en + "\t" + ru;
        if (!uk.empty()) {
            line += "\t" + uk;
        }
        line += "\n";

        std::vector<std::filesystem::path> folders;
        const std::filesystem::path chosen =
            platform::path_from_utf8(services.settings.get_string("other.genresFolder"));
        if (!chosen.empty()) {
            folders.push_back(chosen);
        }
        folders.push_back(services.layers.user_folder(resources::Kind::genres));
        json tried = json::array();
        std::optional<std::filesystem::path> written;
        for (const std::filesystem::path& folder : folders) {
            std::error_code ec;
            std::filesystem::create_directories(folder, ec);
            const std::filesystem::path target = folder / "my.genres.tsv";
            std::string bytes;
            if (std::ifstream in(target, std::ios::binary); in) {
                bytes.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
            }
            if (!bytes.empty() && bytes.back() != '\n') {
                bytes += '\n';
            }
            try {
                atomic_file::write_atomic(target, bytes + line);
                written = target;
                break;
            } catch (const atomic_file::WriteError& e) {
                tried.push_back({{"path", platform::utf8_from_path(folder)}, {"reason", e.reason}});
            }
        }
        if (!written) {
            throw rpc::RpcError(rpc::codes::kDocIoError, "no genres folder can be written",
                                json{{"reason", "notWritable"}, {"folders", tried}});
        }
        services.refresh_genres();
        ctx.notifier.notify("resources.changed", json{{"what", "genres"}});
        json entry;
        // The list is kept in a variable: a range over a member of a temporary would dangle.
        const json listed = services.genre_catalog()->to_json();
        for (const json& e : listed["entries"]) {
            if (e["code"] == code) {
                entry = e;
                break;
            }
        }
        return json{{"file", platform::utf8_from_path(*written)}, {"entry", entry}};
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
