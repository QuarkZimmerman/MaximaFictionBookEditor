// hotkeys.json persistence. See mfbe/hotkeys.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/hotkeys.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <system_error>

namespace mfbe::settings {

using json = nlohmann::json;

json to_json(const HotkeyBinding& binding) {
    return json{{"command", binding.command}, {"keys", binding.keys}};
}

HotkeysStore::HotkeysStore(std::filesystem::path file) : file_(std::move(file)) {}

void HotkeysStore::load() {
    bindings_.clear();
    std::error_code ec;
    if (!std::filesystem::exists(file_, ec)) {
        return;
    }
    json parsed;
    try {
        parsed = json::parse(atomic_file::read_file(file_));
    } catch (const std::exception& e) {
        log::error("core", "hotkeys.unreadable", "hotkeys.json could not be read",
                   log::extras({{"path", platform::utf8_from_path(file_)}, {"reason", e.what()}}));
        return;
    }
    if (!parsed.is_object() || !parsed.contains("bindings") || !parsed["bindings"].is_array()) {
        log::warning("core", "hotkeys.invalid", "hotkeys.json has an unexpected shape",
                     log::extras({{"path", platform::utf8_from_path(file_)}}));
        return;
    }
    std::size_t skipped = 0;
    for (const auto& item : parsed["bindings"]) {
        if (!item.is_object() || !item.contains("command") || !item["command"].is_string() ||
            !item.contains("keys") || !item["keys"].is_string()) {
            ++skipped;
            continue;
        }
        bindings_.push_back({item["command"].get<std::string>(), item["keys"].get<std::string>()});
    }
    if (skipped > 0) {
        log::warning("core", "hotkeys.invalidEntries", "hotkeys.json contains invalid bindings",
                     log::extras({{"path", platform::utf8_from_path(file_)},
                                  {"skipped", std::to_string(skipped)}}));
    }
}

bool HotkeysStore::save() const {
    json doc;
    doc["schemaVersion"] = 1;
    doc["bindings"] = to_json();
    try {
        std::error_code ec;
        std::filesystem::create_directories(file_.parent_path(), ec);
        atomic_file::write_atomic(file_, doc.dump(2) + "\n");
        return true;
    } catch (const atomic_file::WriteError& e) {
        log::error("core", "hotkeys.writeFailed", "hotkeys.json could not be written",
                   log::extras({{"path", e.path}, {"reason", e.reason}}));
        return false;
    }
}

json HotkeysStore::to_json() const {
    json arr = json::array();
    for (const auto& b : bindings_) {
        arr.push_back(settings::to_json(b));
    }
    return arr;
}

void HotkeysStore::set_bindings(std::vector<HotkeyBinding> bindings) {
    std::vector<HotkeyBinding> result;
    for (auto& b : bindings) {
        auto it = std::find_if(result.begin(), result.end(),
                               [&](const HotkeyBinding& r) { return r.command == b.command; });
        if (it != result.end()) {
            it->keys = b.keys;
        } else {
            result.push_back(std::move(b));
        }
    }
    bindings_ = std::move(result);
    save();
}

}  // namespace mfbe::settings
