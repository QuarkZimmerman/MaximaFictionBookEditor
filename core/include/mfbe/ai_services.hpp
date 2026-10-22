// The AI service list (feature 005; resource-formats.md §A, rpc-api.md §3.12 "services",
// data-model §1): the bundled file `<resources>/ai-services.json` and one user layer -
// `<Data>/ai-services.json` when it exists, else the read-only portable file
// `<portable>/ai-services.json` (the `user` folder next to the program when the editor cannot
// write to it), else none - united by id: bundled order, a user entry with a bundled id replaces
// it whole, `hidden: true` removes it, user-only entries follow in user-file order. Within one
// file the first entry with an id wins. An unusable bundled file gives the user layer alone, an
// unusable user file the bundled list alone; every problem is an issue `{file, index?, reason,
// field?}`, logged once per load as `aiServices.<reason>` with the path, index and field only.
//
// Nothing of this is read at start-up: the server loads the list on the first `ai.*` call and
// again on `ai.reloadServices` / `ai.createUserServices` (never on a timer or a file watch).
#pragma once

#include <mfbe/platform.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::ai {

inline constexpr const char* kServicesFileName = "ai-services.json";

enum class Layer { bundled, user, portable };
const char* to_string(Layer layer);  // "bundled" | "user" | "portable"

struct ServiceLimits {
    std::string en;
    std::string ru;  // filled from `en` when the file has no `ru`
    std::string uk;  // filled from `en` when the file has no `uk`
};

// One usable entry of the effective list (rpc-api `AiServiceEntry` plus the key).
struct ServiceEntry {
    std::string id;
    std::string name;
    std::string address;  // as written in the file
    std::string model;
    bool key_required = false;
    std::string key;  // the user layer's key; never returned by to_json() (`hasKey` only) and
                      // never logged - it reaches the request builder of the ai.* jobs only
    bool tools = true;
    std::optional<std::string> terms_url;
    ServiceLimits limits;
    std::optional<std::int64_t> context_length;
    bool hidden = false;  // a user entry hiding the bundled id (the entry then needs nothing
                          // but its id); never set for a bundled entry
    Layer source = Layer::bundled;
    bool replaced = false;  // a user entry that replaced a bundled one
    // Derived from the address (mfbe/ai_address.hpp).
    std::string base;    // the address with its trailing '/' removed - what requests use
    std::string host;    // `host` or `host:port` as written (the only loggable part)
    bool local = false;  // localhost, 127.0.0.0/8 or ::1
    bool plain_http = false;

    bool has_key() const { return !key.empty(); }
    nlohmann::json to_json() const;  // the AiServiceEntry view: `hasKey`, never `key`
};

struct ServiceIssue {
    std::filesystem::path file;
    std::optional<int> index;  // the entry's position in the file's `services`; absent for a
                               // file-level issue
    std::string reason;        // unreadable | invalidJson | badVersion | notObject | missingField |
                               // badAddress | badId | duplicateId | badField
    std::optional<std::string> field;  // missingField / badField
    nlohmann::json to_json() const;    // {file, index?, reason, field?}
};

struct ServiceFiles {
    std::filesystem::path bundled;
    std::filesystem::path user;  // <Data>/ai-services.json, whether or not it exists
    bool user_exists = false;
    std::optional<std::filesystem::path> portable;  // the read-only portable file when it is
                                                    // the user layer in effect
};

// The one user layer of a core: the data folder's file and, when a read-only portable folder
// exists beside the program (it is not `data` then), its file.
struct UserLayer {
    std::filesystem::path user;
    std::optional<std::filesystem::path> portable;

    static UserLayer of(const platform::Dirs& dirs);
};

struct ServiceList {
    std::vector<ServiceEntry> services;  // bundled order, user-only entries after
    std::vector<std::string> hidden;     // bundled ids removed by a user entry's hidden: true
    ServiceFiles files;
    std::vector<ServiceIssue> issues;

    const ServiceEntry* find(std::string_view id) const;
    nlohmann::json to_json() const;  // rpc-api AiServicesResult

    // Reads both files and builds the effective list; never throws for a malformed or missing
    // file (the issues carry them). Logs every issue once.
    static ServiceList load(const std::filesystem::path& bundled_path, const UserLayer& layer);
};

// Parses one list file's bytes (exposed for tests): the usable entries in file order (hide
// directives of a user layer included, with `hidden` set) and the issues. `layer` decides
// whether `key` and `hidden` are honoured (user layers) or reported as badField (bundled).
struct ParsedFile {
    std::vector<ServiceEntry> entries;
    std::vector<ServiceIssue> issues;
};
ParsedFile parse_services_file(const std::filesystem::path& file, std::string_view bytes,
                               Layer layer);

struct UserCopy {
    std::filesystem::path path;
    bool created = false;
};

// *Edit list*: writes a byte-exact copy of the bundled file to `user_path` (creating its folder)
// only when no file exists there; never overwrites. Throws atomic_file::WriteError when the
// bundled file cannot be read or the copy cannot be written.
UserCopy create_user_copy(const std::filesystem::path& bundled_path,
                          const std::filesystem::path& user_path);

}  // namespace mfbe::ai
