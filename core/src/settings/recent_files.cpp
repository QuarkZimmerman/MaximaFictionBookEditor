// Recent files (T019). See mfbe/recent_files.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/recent_files.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <system_error>

namespace mfbe::settings {

using json = nlohmann::json;

std::string now_iso8601_utc() {
    const std::time_t t = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ", tm.tm_year + 1900,
                  tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec);
    return buf;
}

json to_json(const Caret& caret) {
    json j{{"view", caret.view}, {"nodeId", caret.nodeId}, {"offset", caret.offset}};
    if (caret.line) {
        j["line"] = *caret.line;
    }
    if (caret.column) {
        j["column"] = *caret.column;
    }
    return j;
}

std::optional<Caret> caret_from_json(const json& j) {
    if (!j.is_object()) {
        return std::nullopt;
    }
    Caret c;
    auto view = j.find("view");
    if (view == j.end() || !view->is_string()) {
        return std::nullopt;
    }
    c.view = view->get<std::string>();
    auto node = j.find("nodeId");
    if (node != j.end() && node->is_string()) {
        c.nodeId = node->get<std::string>();
    }
    auto offset = j.find("offset");
    if (offset != j.end() && offset->is_number_integer()) {
        c.offset = offset->get<int>();
    }
    auto line = j.find("line");
    if (line != j.end() && line->is_number_integer()) {
        c.line = line->get<int>();
    }
    auto column = j.find("column");
    if (column != j.end() && column->is_number_integer()) {
        c.column = column->get<int>();
    }
    return c;
}

json to_json(const RecentFile& file) {
    // No `caret` any more (feature 004 US8): a legacy one read from an older file is dropped
    // here, at the next write.
    return json{{"path", file.path}, {"lastOpened", file.lastOpened}};
}

RecentFiles::RecentFiles(std::filesystem::path file) : file_(std::move(file)) {}

void RecentFiles::load() {
    items_.clear();
    std::error_code ec;
    if (!std::filesystem::exists(file_, ec)) {
        return;
    }
    json parsed;
    try {
        parsed = json::parse(atomic_file::read_file(file_));
    } catch (const std::exception& e) {
        log::error("core", "recent.unreadable", "recent.json could not be read",
                   log::extras({{"path", platform::utf8_from_path(file_)}, {"reason", e.what()}}));
        return;
    }
    if (!parsed.is_object() || !parsed.contains("items") || !parsed["items"].is_array()) {
        log::warning("core", "recent.invalid", "recent.json has an unexpected shape",
                     log::extras({{"path", platform::utf8_from_path(file_)}}));
        return;
    }
    for (const auto& item : parsed["items"]) {
        if (!item.is_object() || !item.contains("path") || !item["path"].is_string()) {
            continue;
        }
        RecentFile f;
        f.path = item["path"].get<std::string>();
        if (item.contains("lastOpened") && item["lastOpened"].is_string()) {
            f.lastOpened = item["lastOpened"].get<std::string>();
        }
        if (item.contains("caret")) {
            // A release 0.0.3 caret: a Body caret with a node id is kept for the one-time
            // conversion into the positions record; any other is ignored.
            auto legacy = caret_from_json(item["caret"]);
            if (legacy && legacy->view == "body" && !legacy->nodeId.empty()) {
                f.legacyCaret = std::move(legacy);
            }
        }
        const bool duplicate = std::any_of(items_.begin(), items_.end(),
                                           [&](const RecentFile& r) { return r.path == f.path; });
        if (!duplicate && !f.path.empty()) {
            items_.push_back(std::move(f));
        }
        if (items_.size() >= kMaxRecentFiles) {
            break;
        }
    }
}

bool RecentFiles::save() const {
    json doc;
    doc["schemaVersion"] = 1;
    doc["items"] = to_json();
    try {
        std::error_code ec;
        std::filesystem::create_directories(file_.parent_path(), ec);
        atomic_file::write_atomic(file_, doc.dump(2) + "\n");
        return true;
    } catch (const atomic_file::WriteError& e) {
        log::error("core", "recent.writeFailed", "recent.json could not be written",
                   log::extras({{"path", e.path}, {"reason", e.reason}}));
        return false;
    }
}

json RecentFiles::to_json() const {
    json arr = json::array();
    for (const auto& item : items_) {
        arr.push_back(settings::to_json(item));
    }
    return arr;
}

void RecentFiles::touch(const std::string& path) {
    if (path.empty()) {
        return;
    }
    RecentFile entry;
    entry.path = path;
    entry.lastOpened = now_iso8601_utc();
    auto it = std::find_if(items_.begin(), items_.end(),
                           [&](const RecentFile& r) { return r.path == path; });
    if (it != items_.end()) {
        entry.legacyCaret = std::move(it->legacyCaret);
        items_.erase(it);
    }
    items_.insert(items_.begin(), std::move(entry));
    if (items_.size() > kMaxRecentFiles) {
        items_.resize(kMaxRecentFiles);
    }
    save();
}

bool RecentFiles::remove(const std::string& path) {
    auto it = std::find_if(items_.begin(), items_.end(),
                           [&](const RecentFile& r) { return r.path == path; });
    if (it == items_.end()) {
        return false;
    }
    items_.erase(it);
    save();
    return true;
}

void RecentFiles::clear() {
    items_.clear();
    save();
}

std::optional<Caret> RecentFiles::legacy_caret(const std::string& path) const {
    auto it = std::find_if(items_.begin(), items_.end(),
                           [&](const RecentFile& r) { return r.path == path; });
    if (it == items_.end()) {
        return std::nullopt;
    }
    return it->legacyCaret;
}

}  // namespace mfbe::settings
