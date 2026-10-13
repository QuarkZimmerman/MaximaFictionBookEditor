// Recent files list (T019) - `recent.json`, at most 10 entries, newest first.
// { "schemaVersion": 1, "items": [ { "path", "lastOpened", "caret"? } ] }
#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::settings {

inline constexpr std::size_t kMaxRecentFiles = 10;

struct Caret {
    Caret() = default;
    Caret(std::string view_, std::string nodeId_, int offset_)
        : view(std::move(view_)), nodeId(std::move(nodeId_)), offset(offset_) {}

    std::string view;    // "description" | "body" | "source"
    std::string nodeId;  // body node id ("" for source/description)
    int offset = 0;
    std::optional<int> line;  // Source view position (1-based)
    std::optional<int> column;

    bool operator==(const Caret&) const = default;
};

struct RecentFile {
    std::string path;        // absolute
    std::string lastOpened;  // ISO 8601 UTC, e.g. "2026-10-12T20:00:00Z"
    std::optional<Caret> caret;

    bool operator==(const RecentFile&) const = default;
};

nlohmann::json to_json(const Caret& caret);
std::optional<Caret> caret_from_json(const nlohmann::json& j);  // nullopt when malformed
nlohmann::json to_json(const RecentFile& file);

// Current time as "YYYY-MM-DDTHH:MM:SSZ".
std::string now_iso8601_utc();

class RecentFiles {
public:
    explicit RecentFiles(std::filesystem::path file);

    void load();        // missing/unreadable -> empty (+ log when unreadable)
    bool save() const;  // atomic; logs on failure

    const std::vector<RecentFile>& items() const { return items_; }
    nlohmann::json to_json() const;  // array of RecentFile

    // Moves/inserts `path` at the front (keeps its caret unless a new one is given) and
    // trims the list to kMaxRecentFiles. Saves.
    void touch(const std::string& path, std::optional<Caret> caret = std::nullopt);
    // Removes an entry (e.g. after an open failure). Saves. Returns true when removed.
    bool remove(const std::string& path);
    void clear();

    std::optional<Caret> caret(const std::string& path) const;
    // Updates the caret of an existing entry (no reordering). Returns false when unknown.
    bool set_caret(const std::string& path, const std::optional<Caret>& caret);

private:
    std::filesystem::path file_;
    std::vector<RecentFile> items_;
};

}  // namespace mfbe::settings
