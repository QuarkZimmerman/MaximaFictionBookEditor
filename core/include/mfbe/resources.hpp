// Layered resource lookup (T020, FR-127) - contracts/resource-formats.md §2.
//
// For each kind (genres, scripts, dictionaries) the effective set is the union of the layers
//   settings (custom folder from settings) -> user (<Data>/<kind>) -> portable -> bundled.
// Purely additive: bundled entries can never be hidden; a same-id entry in another layer is a
// conflict (logged as `resources.conflict`), the bundled one is kept. Between the non-bundled
// layers the order above decides (settings beats user beats portable).
#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::resources {

enum class Kind { genres, scripts, dictionaries };
enum class LayerName { settings, user, portable, bundled };

const char* to_string(Kind kind);
const char* to_string(LayerName layer);
std::optional<Kind> kind_from_string(std::string_view text);

struct Layer {
    LayerName layer;
    Kind kind;
    std::filesystem::path path;
    bool exists = false;
    bool writable = false;
};

struct Entry {
    std::string id;              // genres: file name; dictionaries: tag; scripts: folder name
    std::filesystem::path path;  // file (genres/dictionaries .aff) or folder (scripts)
    LayerName layer;
};

struct Conflict {
    Kind kind;
    std::string id;
    std::filesystem::path kept;
    std::filesystem::path ignored;
};

struct Roots {
    std::filesystem::path user_data;                // <Data>
    std::optional<std::filesystem::path> portable;  // portable user folder
    std::filesystem::path bundled_resources;        // <install>/resources (genres, dictionaries)
    std::filesystem::path bundled_scripts;          // <install>/scripts
    std::filesystem::path settings_genres;          // settings other.genresFolder ("" = none)
    std::filesystem::path settings_scripts;         // settings other.scriptsFolder ("" = none)
};

// Decides the id of a directory entry for a kind (nullopt = not an entry of this kind).
using IdFunction =
    std::function<std::optional<std::string>(const std::filesystem::directory_entry&)>;

// Default id functions: genres = "*.genres.tsv" files (id = file name), dictionaries =
// "<tag>.aff" with a sibling "<tag>.dic" (id = tag), scripts = sub-folders containing
// "script.json" (id = folder name; the manifest id is resolved by the scripts module).
IdFunction default_id_function(Kind kind);

class ResourceLayers {
public:
    explicit ResourceLayers(Roots roots);

    void set_roots(Roots roots);
    const Roots& roots() const { return roots_; }

    // Layers of one kind in report order: settings, user, portable, bundled.
    std::vector<Layer> layers(Kind kind) const;
    // All kinds, same order per kind.
    std::vector<Layer> all_layers() const;
    // [{kind, layer, path, exists, writable}] for resources.layers / app.info.
    nlohmann::json report() const;

    // Effective entries of a kind (conflicts resolved, see header). Conflicts found during
    // the walk are appended to `conflicts` (when given) and logged.
    std::vector<Entry> list(Kind kind, const IdFunction& id_of,
                            std::vector<Conflict>* conflicts = nullptr) const;
    std::vector<Entry> list(Kind kind, std::vector<Conflict>* conflicts = nullptr) const;

    // Writable per-user folder for a kind (<Data>/<kind>), created on demand.
    std::filesystem::path user_folder(Kind kind, bool create = false) const;

private:
    Roots roots_;
};

}  // namespace mfbe::resources
