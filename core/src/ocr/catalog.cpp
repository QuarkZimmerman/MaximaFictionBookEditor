// Feature 020 (T010, contracts/resource-formats.md §1–§3, data-model.md §2):
// Layered OCR language pack catalog discovery, binary .traineddata header validation,
// higher-layer override detection, osd.traineddata resolution, and passed-over diagnostics.
#include <mfbe/ocr.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <map>
#include <set>
#include <system_error>

namespace mfbe::ocr {
namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kMinTraineddataBytes = 64;
constexpr std::int32_t kMaxTessdataEntries = 32;

std::string lower_ascii(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

bool is_ignored_notice_file(const fs::path& p) {
    const std::string name = lower_ascii(platform::utf8_from_path(p.filename()));
    if (name.empty() || name[0] == '.') {
        return true;
    }
    if (name == "readme.md" || name == "readme.txt" || name == "license.txt" ||
        name == "sources.txt") {
        return true;
    }
    const std::string ext = lower_ascii(platform::utf8_from_path(p.extension()));
    return ext == ".txt";
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

std::int32_t read_le32(const unsigned char* p) {
    const std::uint32_t v = static_cast<std::uint32_t>(p[0]) |
                            (static_cast<std::uint32_t>(p[1]) << 8) |
                            (static_cast<std::uint32_t>(p[2]) << 16) |
                            (static_cast<std::uint32_t>(p[3]) << 24);
    return static_cast<std::int32_t>(v);
}

std::int64_t read_le64(const unsigned char* p) {
    std::uint64_t v = 0;
    for (int i = 0; i < 8; ++i) {
        v |= static_cast<std::uint64_t>(p[i]) << (i * 8);
    }
    return static_cast<std::int64_t>(v);
}

}  // namespace

std::string validate_traineddata_file(const fs::path& path) {
    std::error_code ec;
    if (!fs::is_regular_file(path, ec)) {
        return "unreadable";
    }
    const auto size = fs::file_size(path, ec);
    if (ec) {
        return "unreadable";
    }
    if (size == 0) {
        return "empty";
    }
    if (size < kMinTraineddataBytes) {
        return "corrupt";
    }

    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return "unreadable";
    }
    unsigned char count_buf[4]{};
    if (!in.read(reinterpret_cast<char*>(count_buf), sizeof(count_buf))) {
        return "unreadable";
    }
    const std::int32_t count = read_le32(count_buf);
    if (count < 1 || count > kMaxTessdataEntries) {
        return "corrupt";
    }
    const std::uint64_t header_bytes = 4ull + static_cast<std::uint64_t>(count) * 8ull;
    if (size <= header_bytes) {
        return "corrupt";
    }

    std::vector<unsigned char> offsets_buf(static_cast<std::size_t>(count) * 8);
    if (!in.read(reinterpret_cast<char*>(offsets_buf.data()),
                 static_cast<std::streamsize>(offsets_buf.size()))) {
        return "corrupt";
    }

    int present = 0;
    std::int64_t prev = -1;
    for (std::int32_t i = 0; i < count; ++i) {
        const std::int64_t off = read_le64(offsets_buf.data() + static_cast<std::size_t>(i) * 8);
        if (off == -1) {
            continue;
        }
        if (off < static_cast<std::int64_t>(header_bytes) ||
            static_cast<std::uint64_t>(off) >= size) {
            return "corrupt";
        }
        if (prev >= 0 && off < prev) {
            return "corrupt";
        }
        prev = off;
        ++present;
    }
    if (present == 0) {
        return "corrupt";
    }
    return {};
}

CatalogReport build_catalog(const resources::ResourceLayers& layers,
                            const std::string& custom_folder_utf8) {
    CatalogReport report;
    report.custom_folder = custom_folder_utf8;

    const auto all_layers = layers.layers(resources::Kind::ocr);

    // Determine effective folder for "Open OCR folder": custom folder when set, else user/portable.
    if (!custom_folder_utf8.empty()) {
        report.active_folder = platform::path_from_utf8(custom_folder_utf8);
    } else {
        report.active_folder = layers.user_folder(resources::Kind::ocr, false);
    }

    // First discover which codes exist in the bundled layer so overridesBundled and bundled are
    // exact regardless of resolution order.
    std::set<std::string> bundled_codes;
    for (const auto& layer : all_layers) {
        if (layer.layer != resources::LayerName::bundled || !layer.exists || !layer.readable) {
            continue;
        }
        for (const auto& entry : sorted_children(layer.path)) {
            std::error_code ec;
            if (!entry.is_regular_file(ec)) {
                continue;
            }
            const std::string ext = lower_ascii(platform::utf8_from_path(entry.path().extension()));
            if (ext != ".traineddata") {
                continue;
            }
            const std::string stem = platform::utf8_from_path(entry.path().stem());
            if (!is_valid_pack_code(stem)) {
                continue;
            }
            if (validate_traineddata_file(entry.path()).empty()) {
                bundled_codes.insert(lower_ascii(stem));
            }
        }
    }

    // Walk layers in descending priority order: settings > user > portable > bundled.
    // First valid pack for each lowercase code wins cleanly (higher layers override bundled).
    const bool user_is_portable =
        layers.roots().portable && *layers.roots().portable == layers.roots().user_data;
    auto effective_layer_name = [user_is_portable](resources::LayerName layer_name) {
        if (user_is_portable && layer_name == resources::LayerName::user) {
            return resources::LayerName::portable;
        }
        return layer_name;
    };
    std::map<std::string, LanguagePack> by_code_lower;
    for (const auto& layer : all_layers) {
        const resources::LayerName reported_layer = effective_layer_name(layer.layer);
        if (layer.layer == resources::LayerName::settings && !custom_folder_utf8.empty()) {
            if (!layer.exists) {
                report.custom_folder_issue = "missing";
                report.passed_over.push_back(
                    PassedOver{reported_layer, layer.path, "missingFolder"});
                continue;
            }
            if (!layer.readable) {
                report.custom_folder_issue = "unreadable";
                report.passed_over.push_back(
                    PassedOver{reported_layer, layer.path, "unreadableFolder"});
                continue;
            }
        }
        if (!layer.exists || !layer.readable) {
            continue;
        }
        const bool user_layer = layer.layer != resources::LayerName::bundled;
        for (const auto& entry : sorted_children(layer.path)) {
            if (is_ignored_notice_file(entry.path())) {
                continue;
            }
            std::error_code ec;
            if (!entry.is_regular_file(ec)) {
                if (user_layer) {
                    report.passed_over.push_back(
                        PassedOver{reported_layer, entry.path(), "unsupportedFile"});
                }
                continue;
            }
            const std::string ext = lower_ascii(platform::utf8_from_path(entry.path().extension()));
            if (ext != ".traineddata") {
                if (user_layer) {
                    report.passed_over.push_back(
                        PassedOver{reported_layer, entry.path(), "unsupportedFile"});
                }
                continue;
            }
            const std::string stem = platform::utf8_from_path(entry.path().stem());
            if (!is_valid_traineddata_stem(stem)) {
                if (user_layer) {
                    report.passed_over.push_back(
                        PassedOver{reported_layer, entry.path(), "unsupportedFile"});
                }
                continue;
            }
            const std::string err = validate_traineddata_file(entry.path());
            if (!err.empty()) {
                if (user_layer) {
                    report.passed_over.push_back(PassedOver{reported_layer, entry.path(), err});
                }
                continue;
            }

            const std::string key = lower_ascii(stem);
            if (key == "osd") {
                if (!report.osd_available) {
                    report.osd_available = true;
                    report.osd_layer = reported_layer;
                    report.osd_path = entry.path();
                }
                continue;
            }
            if (by_code_lower.contains(key)) {
                continue;  // higher-priority layer already won cleanly
            }

            const LanguageInfo info = language_info_for_code(stem);
            const std::uint64_t sz = fs::file_size(entry.path(), ec);
            const bool is_bundled_code = bundled_codes.contains(key);
            LanguagePack pack;
            pack.code = stem;
            pack.fb2_lang = info.fb2_lang;
            pack.script = info.script;
            pack.layer = reported_layer;
            pack.path = entry.path();
            pack.size_bytes = ec ? 0 : sz;
            pack.bundled = is_bundled_code;
            pack.overrides_bundled =
                is_bundled_code && layer.layer != resources::LayerName::bundled;
            by_code_lower.emplace(key, std::move(pack));
        }
    }

    report.packs.reserve(by_code_lower.size());
    for (auto& [_, pack] : by_code_lower) {
        report.packs.push_back(std::move(pack));
    }
    return report;
}

std::vector<fs::path> active_ocr_dirs(const resources::ResourceLayers& layers) {
    std::vector<fs::path> dirs;
    for (const auto& layer : layers.layers(resources::Kind::ocr)) {
        if (layer.exists && layer.readable && !layer.path.empty()) {
            if (std::find(dirs.begin(), dirs.end(), layer.path) == dirs.end()) {
                dirs.push_back(layer.path);
            }
        }
    }
    return dirs;
}

nlohmann::json to_json(const LanguagePack& pack) {
    return nlohmann::json{
        {"code", pack.code},
        {"fb2Lang", pack.fb2_lang},
        {"script", pack.script},
        {"layer", resources::to_string(pack.layer)},
        {"path", platform::utf8_from_path(pack.path)},
        {"sizeBytes", pack.size_bytes},
        {"overridesBundled", pack.overrides_bundled},
        {"bundled", pack.bundled},
    };
}

nlohmann::json to_json(const PassedOver& item) {
    return nlohmann::json{
        {"layer", resources::to_string(item.layer)},
        {"path", platform::utf8_from_path(item.path)},
        {"reason", item.reason},
    };
}

nlohmann::json to_json(const CatalogReport& report) {
    nlohmann::json packs = nlohmann::json::array();
    for (const auto& p : report.packs) {
        packs.push_back(to_json(p));
    }
    nlohmann::json passed = nlohmann::json::array();
    for (const auto& po : report.passed_over) {
        passed.push_back(to_json(po));
    }
    return nlohmann::json{
        {"packs", std::move(packs)},
        {"osdAvailable", report.osd_available},
        {"osdLayer",
         report.osd_layer ? nlohmann::json(resources::to_string(*report.osd_layer))
                          : nlohmann::json(nullptr)},
        {"activeFolder", platform::utf8_from_path(report.active_folder)},
        {"customFolder", report.custom_folder},
        {"customFolderIssue",
         report.custom_folder_issue ? nlohmann::json(*report.custom_folder_issue)
                                    : nlohmann::json(nullptr)},
        {"passedOver", std::move(passed)},
    };
}

}  // namespace mfbe::ocr
