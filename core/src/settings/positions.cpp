// Remembered positions (feature 004 US8). See mfbe/positions.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/positions.hpp>
#include <mfbe/recent_files.hpp>  // now_iso8601_utc
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string_view>
#include <system_error>

namespace mfbe::settings {

using json = nlohmann::json;

namespace {

// `[n]` with n >= 1 and no leading zero at `text[pos..]`; returns the length consumed (0 when
// the text is not such an index).
std::size_t index_length(std::string_view text) {
    if (text.size() < 3 || text[0] != '[' || text[1] < '1' || text[1] > '9') {
        return 0;
    }
    std::size_t i = 2;
    while (i < text.size() && text[i] >= '0' && text[i] <= '9') {
        ++i;
    }
    return i < text.size() && text[i] == ']' ? i + 1 : 0;
}

// `body[n]` at the start of `text`; the length consumed (0 when absent).
std::size_t body_root_length(std::string_view text) {
    constexpr std::string_view kBody = "body";
    if (text.substr(0, kBody.size()) != kBody) {
        return 0;
    }
    const std::size_t index = index_length(text.substr(kBody.size()));
    return index == 0 ? 0 : kBody.size() + index;
}

}  // namespace

bool is_position_path(const std::string& path) {
    std::string_view rest = path;
    std::size_t root = body_root_length(rest);
    if (root == 0) {
        for (std::string_view fixed : {std::string_view("title-info/annotation[1]"),
                                       std::string_view("document-info/history[1]")}) {
            if (rest.substr(0, fixed.size()) == fixed) {
                root = fixed.size();
                break;
            }
        }
    }
    if (root == 0) {
        return false;
    }
    rest.remove_prefix(root);
    while (!rest.empty()) {
        if (rest[0] != '/') {
            return false;
        }
        rest.remove_prefix(1);
        std::size_t name = 0;
        while (name < rest.size() &&
               ((rest[name] >= 'a' && rest[name] <= 'z') || rest[name] == '-')) {
            ++name;
        }
        if (name == 0) {
            return false;
        }
        const std::size_t index = index_length(rest.substr(name));
        if (index == 0) {
            return false;
        }
        rest.remove_prefix(name + index);
    }
    return true;
}

std::optional<Position> position_from_json(const json& j) {
    if (!j.is_object()) {
        return std::nullopt;
    }
    const auto path = j.find("path");
    const auto offset = j.find("offset");
    if (path == j.end() || !path->is_string() || offset == j.end() ||
        !offset->is_number_integer()) {
        return std::nullopt;
    }
    Position position;
    position.path = path->get<std::string>();
    if (!is_position_path(position.path)) {
        return std::nullopt;
    }
    const auto value = offset->get<std::int64_t>();
    if (value < 0 || value > std::numeric_limits<int>::max()) {
        return std::nullopt;
    }
    position.offset = static_cast<int>(value);
    return position;
}

json to_json(const Position& position) {
    return json{{"path", position.path}, {"offset", position.offset}};
}

Positions::Positions(std::filesystem::path file) : file_(std::move(file)) {}

void Positions::load() {
    items_.clear();
    std::error_code ec;
    if (!std::filesystem::exists(file_, ec)) {
        return;
    }
    json parsed;
    try {
        parsed = json::parse(atomic_file::read_file(file_));
    } catch (const std::exception& e) {
        log::error("core", "positions.unreadable", "positions.json could not be read",
                   log::extras({{"path", platform::utf8_from_path(file_)}, {"reason", e.what()}}));
        return;
    }
    if (!parsed.is_object() || parsed.value("schemaVersion", 0) != 1 || !parsed.contains("items") ||
        !parsed["items"].is_array()) {
        log::warning("core", "positions.invalid",
                     "positions.json has an unexpected shape or schema version",
                     log::extras({{"path", platform::utf8_from_path(file_)}}));
        return;
    }
    std::size_t skipped = 0;
    for (const auto& item : parsed["items"]) {
        const auto path = item.is_object() ? item.find("path") : item.end();
        const auto position = item.is_object() && item.contains("position")
                                  ? position_from_json(item["position"])
                                  : std::nullopt;
        if (path == item.end() || !path->is_string() || path->get<std::string>().empty() ||
            !position) {
            ++skipped;
            continue;
        }
        PositionItem entry;
        entry.path = path->get<std::string>();
        if (item.contains("at") && item["at"].is_string()) {
            entry.at = item["at"].get<std::string>();
        }
        entry.position = *position;
        for (const auto& [key, value] : item.items()) {
            if (key != "path" && key != "at" && key != "position") {
                entry.extra[key] = value;
            }
        }
        const bool duplicate = std::any_of(
            items_.begin(), items_.end(),
            [&](const PositionItem& p) { return platform::same_file_path(p.path, entry.path); });
        if (!duplicate) {
            items_.push_back(std::move(entry));
        }
        if (items_.size() >= kMaxPositions) {
            break;
        }
    }
    if (skipped > 0) {
        log::warning("core", "positions.itemsSkipped",
                     "positions.json holds items without a usable path or position",
                     log::extras({{"path", platform::utf8_from_path(file_)},
                                  {"skipped", std::to_string(skipped)}}));
    }
}

bool Positions::save() const {
    json items = json::array();
    for (const auto& item : items_) {
        json j = item.extra.is_object() ? item.extra : json::object();
        j["path"] = item.path;
        if (!item.at.empty()) {
            j["at"] = item.at;
        }
        j["position"] = to_json(item.position);
        items.push_back(std::move(j));
    }
    json doc;
    doc["schemaVersion"] = 1;
    doc["items"] = std::move(items);
    try {
        std::error_code ec;
        std::filesystem::create_directories(file_.parent_path(), ec);
        atomic_file::write_atomic(file_, doc.dump(2) + "\n");
        return true;
    } catch (const atomic_file::WriteError& e) {
        log::error("core", "positions.writeFailed", "positions.json could not be written",
                   log::extras({{"path", e.path}, {"reason", e.reason}}));
        return false;
    }
}

std::optional<Position> Positions::get(const std::string& path) const {
    const auto it = std::find_if(items_.begin(), items_.end(), [&](const PositionItem& item) {
        return platform::same_file_path(item.path, path);
    });
    if (it == items_.end()) {
        return std::nullopt;
    }
    return it->position;
}

void Positions::set(const std::string& path, const Position& position) {
    if (path.empty()) {
        return;
    }
    PositionItem entry;
    entry.path = path;
    entry.at = now_iso8601_utc();
    entry.position = position;
    const auto it = std::find_if(items_.begin(), items_.end(), [&](const PositionItem& item) {
        return platform::same_file_path(item.path, path);
    });
    if (it != items_.end()) {
        entry.extra = std::move(it->extra);
        items_.erase(it);
    }
    items_.insert(items_.begin(), std::move(entry));
    if (items_.size() > kMaxPositions) {
        items_.resize(kMaxPositions);
    }
    save();
}

void Positions::clear() {
    items_.clear();
    save();
}

}  // namespace mfbe::settings
