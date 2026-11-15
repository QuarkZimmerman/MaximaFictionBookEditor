// Layered resource lookup (T020). See mfbe/resources.hpp.
#include <mfbe/log.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <fstream>
#include <iterator>
#include <map>
#include <string_view>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#else
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
    // access() knows nothing of ACLs on Windows: probe by creating and removing an empty file.
    const fs::path probe =
        p / (L".mfbe-write-probe-" + std::to_wstring(::GetCurrentProcessId()) + L".tmp");
    const HANDLE handle =
        ::CreateFileW(probe.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                      FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        return false;
    }
    ::CloseHandle(handle);  // FILE_FLAG_DELETE_ON_CLOSE removes the probe
    return true;
#else
    return ::access(p.c_str(), W_OK) == 0;
#endif
}

// True when the folder exists and its entries can be listed (a folder without read or search
// permission exists but contributes nothing; the user is told so - feature 003 US4).
bool dir_readable(const fs::path& p) {
    if (!dir_exists(p)) {
        return false;
    }
    std::error_code ec;
    const fs::directory_iterator it(p, ec);
    return !ec;
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

namespace {

// True when `text` is well-formed UTF-8 (a genre file in another encoding would give garbled
// names, so it is passed over instead; feature 015).
bool valid_utf8(std::string_view text) {
    std::size_t i = 0;
    while (i < text.size()) {
        const auto c = static_cast<unsigned char>(text[i]);
        std::size_t extra = 0;
        if (c < 0x80) {
            extra = 0;
        } else if (c >= 0xC2 && c <= 0xDF) {
            extra = 1;
        } else if (c >= 0xE0 && c <= 0xEF) {
            extra = 2;
        } else if (c >= 0xF0 && c <= 0xF4) {
            extra = 3;
        } else {
            return false;
        }
        if (text.size() - i <= extra) {
            return false;
        }
        for (std::size_t k = 1; k <= extra; ++k) {
            if ((static_cast<unsigned char>(text[i + k]) & 0xC0) != 0x80) {
                return false;
            }
        }
        i += extra + 1;
    }
    return true;
}

std::vector<fs::directory_entry> sorted_children(const fs::path& folder) {
    std::vector<fs::directory_entry> out;
    std::error_code ec;
    for (fs::directory_iterator it(folder, ec), end; !ec && it != end; it.increment(ec)) {
        out.push_back(*it);
    }
    std::sort(out.begin(), out.end(),
              [](const fs::directory_entry& a, const fs::directory_entry& b) {
                  return a.path() < b.path();
              });
    return out;
}

bool hidden(const fs::path& p) {
    const std::string name = platform::utf8_from_path(p.filename());
    return name.empty() || name[0] == '.';
}

}  // namespace

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
        layer.readable = dir_readable(path);
        layer.writable = dir_writable(path);
        result.push_back(std::move(layer));
    };
    fs::path settings_folder;
    switch (kind) {
        case Kind::genres:
            settings_folder = roots_.settings_genres;
            break;
        case Kind::scripts:
            settings_folder = roots_.settings_scripts;
            break;
        case Kind::dictionaries:
            settings_folder = roots_.settings_dictionaries;
            break;
    }
    add(LayerName::settings, settings_folder);
    add(LayerName::user, roots_.user_data.empty() ? fs::path() : roots_.user_data / sub);
    // A portable folder that holds the data is the user layer already.
    const bool portable_layer = roots_.portable && *roots_.portable != roots_.user_data;
    add(LayerName::portable, portable_layer ? *roots_.portable / sub : fs::path());
    if (kind == Kind::scripts) {
        add(LayerName::bundled, roots_.bundled_scripts);
    } else {
        add(LayerName::bundled,
            roots_.bundled_resources.empty() ? fs::path() : roots_.bundled_resources / sub);
    }
    return result;
}

std::vector<PassedOver> ResourceLayers::passed_over(Kind kind) const {
    std::vector<PassedOver> out;
    for (const Layer& layer : layers(kind)) {
        if (layer.layer == LayerName::bundled || !layer.exists || !layer.readable) {
            continue;
        }
        auto add = [&](const fs::path& path, const char* reason) {
            out.push_back(PassedOver{kind, layer.layer, path, reason});
        };
        for (const fs::directory_entry& e : sorted_children(layer.path)) {
            if (hidden(e.path())) {
                continue;
            }
            std::error_code ec;
            const bool is_dir = e.is_directory(ec);
            const std::string name = lower(platform::utf8_from_path(e.path().filename()));
            switch (kind) {
                case Kind::genres: {
                    if (is_dir) {
                        add(e.path(), "notAFile");
                    } else if (!ends_with(name, ".genres.tsv")) {
                        add(e.path(), "name");
                    } else {
                        std::ifstream in(e.path(), std::ios::binary);
                        if (!in) {
                            add(e.path(), "unreadable");
                        } else {
                            const std::string text((std::istreambuf_iterator<char>(in)),
                                                   std::istreambuf_iterator<char>());
                            if (!valid_utf8(text)) {
                                add(e.path(), "encoding");
                            }
                        }
                    }
                    break;
                }
                case Kind::scripts: {
                    if (!is_dir) {
                        add(e.path(), "notAFolder");
                        break;
                    }
                    if (fs::is_regular_file(e.path() / "script.json", ec)) {
                        break;  // a package
                    }
                    // A folder without script.json is a group of packages (scripts.cpp): its own
                    // files (group.json, its icon) are the group's; its folders must be packages.
                    bool has_package = false;
                    std::vector<fs::path> bare;
                    for (const fs::directory_entry& sub : sorted_children(e.path())) {
                        std::error_code sub_ec;
                        if (hidden(sub.path()) || !sub.is_directory(sub_ec)) {
                            continue;
                        }
                        if (fs::is_regular_file(sub.path() / "script.json", sub_ec)) {
                            has_package = true;
                        } else {
                            bare.push_back(sub.path());
                        }
                    }
                    if (!has_package && bare.empty()) {
                        add(e.path(), "noDescription");
                    }
                    for (const fs::path& folder : bare) {
                        add(folder, "noDescription");
                    }
                    break;
                }
                case Kind::dictionaries: {
                    if (is_dir) {
                        add(e.path(), "notAFile");
                        break;
                    }
                    const std::string ext = lower(platform::utf8_from_path(e.path().extension()));
                    fs::path aff = e.path();
                    aff.replace_extension(".aff");
                    fs::path dic = e.path();
                    dic.replace_extension(".dic");
                    const bool has_aff = fs::is_regular_file(aff, ec);
                    const bool has_dic = fs::is_regular_file(dic, ec);
                    if (ext == ".aff" || ext == ".dic") {
                        if (!(has_aff && has_dic)) {
                            add(e.path(), "partnerMissing");
                        }
                    } else if (!(ext == ".txt" && has_aff && has_dic)) {
                        add(e.path(), "name");  // not a dictionary, nor a dictionary's notice
                    }
                    break;
                }
            }
        }
    }
    return out;
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
                       {"readable", layer.readable},
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
                const Entry& kept = result[found->second];
                Conflict conflict{kind, *id, kept.path, entry.path(), kept.layer, layer->layer};
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
