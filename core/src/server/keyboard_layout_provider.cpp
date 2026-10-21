// Keyboard layout provider JSON shapes and the recording stand-in (feature 004, User Story 11).
// See mfbe/keyboard_layout_provider.hpp.
#include <mfbe/keyboard_layout_provider.hpp>
#include <mfbe/recent_files.hpp>

#include <algorithm>
#include <stdexcept>

namespace mfbe {

using nlohmann::json;

json to_json(const KeyboardLayoutList& list) {
    json layouts = json::array();
    for (const auto& layout : list.layouts) {
        layouts.push_back(json{{"id", layout.id}, {"name", layout.name}});
    }
    json out{{"supported", list.supported}, {"layouts", std::move(layouts)}};
    if (!list.reason.empty()) {
        out["reason"] = list.reason;
    }
    if (list.current) {
        out["current"] = *list.current;
    }
    return out;
}

json to_json(const KeyboardLayoutSwitch& result) {
    json out{{"activated", result.activated}};
    if (!result.reason.empty()) {
        out["reason"] = result.reason;
    }
    return out;
}

KeyboardLayoutList keyboard_layout_list_from_json(const json& j) {
    if (!j.is_object()) {
        throw std::invalid_argument("keyboard layout list must be an object");
    }
    KeyboardLayoutList list;
    if (auto it = j.find("supported"); it != j.end() && !it->is_null()) {
        if (!it->is_boolean()) {
            throw std::invalid_argument("supported must be a boolean");
        }
        list.supported = it->get<bool>();
    } else {
        list.supported = true;  // a seed that lists layouts offers them
    }
    if (auto it = j.find("reason"); it != j.end() && !it->is_null()) {
        if (!it->is_string()) {
            throw std::invalid_argument("reason must be a string");
        }
        list.reason = it->get<std::string>();
    }
    if (auto it = j.find("layouts"); it != j.end() && !it->is_null()) {
        if (!it->is_array()) {
            throw std::invalid_argument("layouts must be an array of {id, name}");
        }
        for (const auto& item : *it) {
            if (!item.is_object() || !item.contains("id") || !item["id"].is_string()) {
                throw std::invalid_argument("layouts must be an array of {id, name}");
            }
            KeyboardLayout layout;
            layout.id = item["id"].get<std::string>();
            if (layout.id.empty()) {
                throw std::invalid_argument("a layout id must not be empty");
            }
            if (item.contains("name") && !item["name"].is_null()) {
                if (!item["name"].is_string()) {
                    throw std::invalid_argument("a layout name must be a string");
                }
                layout.name = item["name"].get<std::string>();
            }
            list.layouts.push_back(std::move(layout));
        }
    }
    if (auto it = j.find("current"); it != j.end() && !it->is_null()) {
        if (!it->is_string()) {
            throw std::invalid_argument("current must be a string");
        }
        list.current = it->get<std::string>();
    }
    return list;
}

RecordingKeyboardLayoutProvider::RecordingKeyboardLayoutProvider() {
    seed_.supported = true;
    seed_.layouts = {{"test-en", "English (United States)"}, {"test-ru", "Russian"}};
    seed_.current = "test-en";
}

void RecordingKeyboardLayoutProvider::seed(KeyboardLayoutList list) {
    std::lock_guard<std::mutex> lock(mutex_);
    seed_ = std::move(list);
}

KeyboardLayoutList RecordingKeyboardLayoutProvider::seeded() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return seed_;
}

std::vector<json> RecordingKeyboardLayoutProvider::requests() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return requests_;
}

void RecordingKeyboardLayoutProvider::clear_requests() {
    std::lock_guard<std::mutex> lock(mutex_);
    requests_.clear();
}

void RecordingKeyboardLayoutProvider::list(Callback<KeyboardLayoutList> done) {
    KeyboardLayoutList copy;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        copy = seed_;
    }
    done(std::move(copy));
}

void RecordingKeyboardLayoutProvider::activate(const std::string& id,
                                               Callback<KeyboardLayoutSwitch> done) {
    KeyboardLayoutSwitch result;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!seed_.supported) {
            result.reason = "unsupported";
        } else if (std::any_of(seed_.layouts.begin(), seed_.layouts.end(),
                               [&id](const KeyboardLayout& l) { return l.id == id; })) {
            result.activated = true;
        } else {
            result.reason = "notInstalled";
        }
        requests_.push_back(
            json{{"id", id}, {"at", settings::now_iso8601_utc()}, {"activated", result.activated}});
    }
    done(std::move(result));
}

}  // namespace mfbe
