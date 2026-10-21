// Remembered positions (feature 004 US8, "Restore position") - `positions.json`, the record
// behind spec FR-100 / FR-101 (contracts/resource-formats.md §13; research R5.4):
//
//   { "schemaVersion": 1,
//     "items": [ { "path": "/abs/book.fb2", "at": "2026-10-20T18:33:33Z",
//                  "position": { "path": "body[1]/section[3]/p[12]", "offset": 12 } } ] }
//
// A least-recently-used list of at most kMaxPositions files, newest first: remembering a
// position moves its item to the front, the 101st file pushes the oldest out. Kept beside
// recent.json in the config folder and independent of the Recent Files list (ten entries,
// its own exact-string matching, untouched by Clear Recent Files - requester decision D4).
// Paths are compared as the platform compares file names (platform::same_file_path); a match
// with another spelling replaces the stored spelling by the newer one. Written atomically on
// every change; a malformed item is skipped (logged once per load), an unreadable file or
// another schemaVersion is treated as empty and never deleted; unknown item members survive.
#pragma once

#include <nlohmann/json.hpp>

#include <cstddef>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::settings {

inline constexpr std::size_t kMaxPositions = 100;

// The Body view's caret keyed by place in document order: a structural path (one of the three
// roots the Body view shows - `body[n]`, `title-info/annotation[1]`, `document-info/history[1]`
// - then `/type[n]` segments, rpc-api "Definitions shared by the additions") and a model offset
// (UTF-16 units of text plus one per inline atom, >= 0).
struct Position {
    std::string path;
    int offset = 0;

    bool operator==(const Position&) const = default;
};

struct PositionItem {
    std::string path;  // the file: absolute, lexically normalised, UTF-8
    std::string at;    // ISO 8601 UTC of the last remembering ("" when the file had none)
    Position position;
    nlohmann::json extra = nlohmann::json::object();  // unknown members, preserved on rewrite

    bool operator==(const PositionItem&) const = default;
};

// True when `path` matches the remembered-position grammar:
//   ^(body\[[1-9]\d*\]|title-info/annotation\[1\]|document-info/history\[1\])(/[a-z-]+\[[1-9]\d*\])*$
bool is_position_path(const std::string& path);

// {path, offset} -> Position; nullopt when not an object, the path fails the grammar or the
// offset is not an integer >= 0.
std::optional<Position> position_from_json(const nlohmann::json& j);
nlohmann::json to_json(const Position& position);

class Positions {
public:
    explicit Positions(std::filesystem::path file);

    // Missing -> empty; unreadable, malformed or another schemaVersion -> empty and logged
    // once (the file is left as it is); malformed items skipped and counted in one warning.
    void load();
    bool save() const;  // atomic; logs on failure

    const std::vector<PositionItem>& items() const { return items_; }

    // The position remembered for `path` (the platform's file-name comparison), if any.
    std::optional<Position> get(const std::string& path) const;
    // Remembers `position` for `path`: the item moves to the front with a fresh `at` (another
    // spelling of the same file is replaced by `path`), the list is trimmed to kMaxPositions.
    // Saves. An empty path is ignored.
    void set(const std::string& path, const Position& position);
    void clear();

private:
    std::filesystem::path file_;
    std::vector<PositionItem> items_;
};

}  // namespace mfbe::settings
