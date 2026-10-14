// Layered resource lookup (T020). See mfbe/resources.hpp.
#include <mfbe/log.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <map>
#include <system_error>

#ifndef _WIN32
#include <unistd.h>
#endif

namespace mfbe::resources {
namespace {

namespace fs = std::filesystem;

bool dir_exists(const fs::path& p) {
    if (p.empty()) {
        return false;
    }
    std::error_code ec;
    return fs::is_directory(p, ec);
}

bool dir_writable(const fs::path& p) {
    if (!dir_exists(p)) {
        return false;
    }
#ifdef _WIN32
    // No cheap portable probe without creating a file; assume per-user folders are writable.
    return true;
#else
    return ::access(p.c_str(), W_OK) == 0;
#endif
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

bool ends_with(const std::string& s, const std::string& suffix) {
    return s.size() >= suffix.size() &&
           s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

}  // namespace

const char* to_string(Kind kind) {
    switch (kind) {
        case Kind::genres:
            return "genres";
        case Kind::scripts:
            return "scripts";
        case Kind::dictionaries:
            return "dictionaries";
    }
    return "genres";
}

const char* to_string(LayerName layer) {
    switch (layer) {
        case LayerName::settings:
            return "settings";
        case LayerName::user:
            return "user";
        case LayerName::portable:
            return "portable";
        case LayerName::bundled:
            return "bundled";
    }
    return "bundled";
}

std::optional<Kind> kind_from_string(std::string_view text) {
    if (text == "genres") {
        return Kind::genres;
    }
    if (text == "scripts") {
        return Kind::scripts;
    }
    if (text == "dictionaries") {
        return Kind::dictionaries;
    }
    return std::nullopt;
}

IdFunction default_id_function(Kind kind) {
    switch (kind) {
        case Kind::genres:
            return [](const fs::directory_entry& e) -> std::optional<std::string> {
                std::error_code ec;
                if (!e.is_regular_file(ec)) {
                    return std::nullopt;
                }
                const std::string name = platform::utf8_from_path(e.path().filename());
                if (!ends_with(lower(name), ".genres.tsv")) {
                    return std::nullopt;
                }
                return name;
            };
        case Kind::dictionaries:
            return [](const fs::directory_entry& e) -> std::optional<std::string> {
                std::error_code ec;
                if (!e.is_regular_file(ec)) {
                    return std::nullopt;
                }
                if (lower(platform::utf8_from_path(e.path().extension())) != ".aff") {
                    return std::nullopt;
                }
                fs::path dic = e.path();
                dic.replace_extension(".dic");
                if (!fs::is_regular_file(dic, ec)) {
                    return std::nullopt;
                }
                return platform::utf8_from_path(e.path().stem());
            };
        case Kind::scripts:
            return [](const fs::directory_entry& e) -> std::optional<std::string> {
                std::error_code ec;
                if (!e.is_directory(ec)) {
                    return std::nullopt;
                }
                if (!fs::is_regular_file(e.path() / "script.json", ec)) {
                    return std::nullopt;
                }
                return platform::utf8_from_path(e.path().filename());
            };
    }
    return [](const fs::directory_entry&) { return std::nullopt; };
}

ResourceLayers::ResourceLayers(Roots roots) : roots_(std::move(roots)) {}

void ResourceLayers::set_roots(Roots roots) {
    roots_ = std::move(roots);
}

std::vector<Layer> ResourceLayers::layers(Kind kind) const {
    const char* const sub = to_string(kind);
    std::vector<Layer> result;
    auto add = [&](LayerName name, const fs::path& path) {
        Layer layer;
        layer.layer = name;
        layer.kind = kind;
        layer.path = path;
        layer.exists = dir_exists(path);
        layer.writable = dir_writable(path);
        result.push_back(std::move(layer));
    };
    fs::path settings_folder;
    if (kind == Kind::genres) {
        settings_folder = roots_.settings_genres;
    } else if (kind == Kind::scripts) {
        settings_folder = roots_.settings_scripts;
    }
    add(LayerName::settings, settings_folder);
    add(LayerName::user, roots_.user_data.empty() ? fs::path() : roots_.user_data / sub);
    add(LayerName::portable, roots_.portable ? *roots_.portable / sub : fs::path());
    if (kind == Kind::scripts) {
        add(LayerName::bundled, roots_.bundled_scripts);
    } else {
        add(LayerName::bundled,
            roots_.bundled_resources.empty() ? fs::path() : roots_.bundled_resources / sub);
    }
    return result;
}

std::vector<Layer> ResourceLayers::all_layers() const {
    std::vector<Layer> result;
    for (Kind kind : {Kind::genres, Kind::scripts, Kind::dictionaries}) {
        auto layers_of_kind = layers(kind);
        result.insert(result.end(), layers_of_kind.begin(), layers_of_kind.end());
    }
    return result;
}

nlohmann::json ResourceLayers::report() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& layer : all_layers()) {
        arr.push_back({{"kind", to_string(layer.kind)},
                       {"layer", to_string(layer.layer)},
                       {"path", platform::utf8_from_path(layer.path)},
                       {"exists", layer.exists},
                       {"writable", layer.writable}});
    }
    return arr;
}

std::vector<Entry> ResourceLayers::list(Kind kind, const IdFunction& id_of,
                                        std::vector<Conflict>* conflicts) const {
    // Resolution order: bundled first (always wins), then settings, user, portable.
    const auto all = layers(kind);
    std::vector<const Layer*> order;
    for (const auto& l : all) {
        if (l.layer == LayerName::bundled) {
            order.push_back(&l);
        }
    }
    for (const auto& l : all) {
        if (l.layer != LayerName::bundled) {
            order.push_back(&l);
        }
    }
    std::vector<Entry> result;
    std::map<std::string, std::size_t> index_by_id;
    for (const Layer* layer : order) {
        if (!layer->exists) {
            continue;
        }
        std::error_code ec;
        std::vector<fs::directory_entry> entries;
        for (fs::directory_iterator it(layer->path, ec), end; !ec && it != end; it.increment(ec)) {
            entries.push_back(*it);
        }
        std::sort(entries.begin(), entries.end(),
                  [](const fs::directory_entry& a, const fs::directory_entry& b) {
                      return a.path().filename() < b.path().filename();
                  });
        for (const auto& entry : entries) {
            const auto id = id_of(entry);
            if (!id) {
                continue;
            }
            auto found = index_by_id.find(*id);
            if (found != index_by_id.end()) {
                Conflict conflict{kind, *id, result[found->second].path, entry.path()};
                log::warning(
                    "core", "resources.conflict",
                    "resource id present in several layers; higher layer kept",
                    log::extras({{"kind", to_string(kind)},
                                 {"id", *id},
                                 {"kept", platform::utf8_from_path(conflict.kept)},
                                 {"ignored", platform::utf8_from_path(conflict.ignored)}}));
                if (conflicts != nullptr) {
                    conflicts->push_back(std::move(conflict));
                }
                continue;
            }
            index_by_id[*id] = result.size();
            result.push_back(Entry{*id, entry.path(), layer->layer});
        }
    }
    return result;
}

std::vector<Entry> ResourceLayers::list(Kind kind, std::vector<Conflict>* conflicts) const {
    return list(kind, default_id_function(kind), conflicts);
}

fs::path ResourceLayers::user_folder(Kind kind, bool create) const {
    if (roots_.user_data.empty()) {
        return {};
    }
    const fs::path folder = roots_.user_data / to_string(kind);
    if (create) {
        std::error_code ec;
        fs::create_directories(folder, ec);
    }
    return folder;
}

}  // namespace mfbe::resources
