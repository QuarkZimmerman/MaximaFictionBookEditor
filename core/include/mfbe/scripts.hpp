// Script package discovery (T101, FR-141/FR-145) - contracts/script-manifest.md §1-§2,
// contracts/resource-formats.md §5, contracts/rpc-api.md §3.8.
//
// Layout of one scripts root (any layer):
//   <root>/NN_<group>/group.json?            optional localised group names ("names"/"name")
//   <root>/NN_<group>/NN_<script>/script.json  manifest (required), index.js (entry), icon.png
//   <root>/tree/<script>/...                  kind "tree" scripts (Document Tree context menu)
//   <root>/<script>/script.json              ungrouped script (group id "")
// The `NN_` prefixes order groups and scripts and are stripped for display.
//
// Manifest validation (script.json): `manifestVersion` must be 1; `name.en` is required; `id`
// defaults to `<group folder>/<script folder>`; `kind` is "menu" or "tree" (missing: "tree"
// under the tree folder, "menu" elsewhere, reported as a warning); `entry` (default index.js)
// must be a file inside the package; `icon` must be a PNG/ICO inside the package (dropped with
// a warning otherwise); `defaultHotkey` must follow the chord grammar of resource-formats.md §7
// (dropped with a warning otherwise); `needsSelection` is a boolean; `legacy.source` is a
// string. Errors skip the package, warnings keep it; both are reported in `Catalog::issues`
// and logged (`scripts.invalidManifest`, `scripts.conflict`).
//
// Layers are purely additive (FR-127): the bundled layer is walked first and always wins a
// same-id conflict; among the other layers settings beats user beats portable; the loser is
// reported as a `duplicateId` issue.
#pragma once

#include <mfbe/resources.hpp>

#include <nlohmann/json.hpp>

#include <filesystem>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::scripts {

using Names = std::map<std::string, std::string>;  // language -> text ("en" always present)

struct LegacyInfo {
    std::string source;      // path of the original FBE script, e.g. "01_Регистр/01_….js"
    std::string fbeVersion;  // optional
};

struct ScriptManifest {
    int manifestVersion = 1;
    std::string id;
    Names name;
    Names description;          // may be empty
    std::string kind = "menu";  // "menu" | "tree"
    std::string entry = "index.js";
    std::string icon;  // "" = none
    std::string defaultHotkey;
    bool needsSelection = false;
    Names undoLabel;  // may be empty (UI falls back to name)
    std::optional<LegacyInfo> legacy;
};

struct ScriptPackage {
    ScriptManifest manifest;
    std::string id;  // effective id (= manifest.id)
    std::filesystem::path dir;
    std::string group;  // group id (folder name, "" for ungrouped scripts)
    resources::LayerName layer = resources::LayerName::bundled;
    std::vector<std::string> warnings;  // non-fatal manifest problems (reason codes)
};

struct Group {
    std::string id;             // folder name ("" for ungrouped scripts, "tree" for tree commands)
    int order = 0;              // NN prefix; ungrouped = -1; unnumbered = 10000 (+ alphabetical)
    Names names;                // from group.json, default: folder name without the prefix
    std::string icon;           // group.json "icon" file name inside the group folder ("" = none)
    std::filesystem::path dir;  // the folder of the first layer that contributed
    std::vector<ScriptPackage> scripts;
};

struct Issue {
    std::filesystem::path path;      // package or group folder (or the manifest file)
    std::string id;                  // script id when known
    std::string reason;              // "missingManifest" | "invalidJson" | "invalidManifest" |
                                     // "duplicateId" | "entryMissing" | "iconMissing" | ...
    std::string message;             // human-readable detail (English, for logs/tooltips)
    std::string severity = "error";  // "error" (package skipped) | "warning" (package kept)
};

struct ParsedManifest {
    std::optional<ScriptManifest> manifest;  // nullopt when `errors` is non-empty
    std::vector<std::string> errors;         // "<reason>: <detail>"
    std::vector<std::string> warnings;       // "<reason>: <detail>"
};

// Parses and validates a manifest JSON document. `default_id` is used when `id` is absent;
// `default_kind` when `kind` is absent. File existence (entry/icon) is checked by the loader.
ParsedManifest parse_manifest(const nlohmann::json& manifest, const std::string& default_id,
                              const std::string& default_kind);
ParsedManifest parse_manifest_text(const std::string& text, const std::string& default_id,
                                   const std::string& default_kind);

// Chord grammar check (resource-formats.md §7): `[Ctrl+][Alt+][Shift+][Meta+|Mod+]Key`.
bool is_valid_hotkey_chord(std::string_view chord);
// Script ids: non-empty, no control characters, no backslash, no "." / ".." segments, no
// leading, trailing or doubled slashes.
bool is_valid_script_id(std::string_view id);
// `01_Регистр` -> ("Регистр", 1); `tree` -> ("tree", nullopt).
std::string strip_order_prefix(const std::string& folder, std::optional<int>* order);

class Catalog {
public:
    const std::vector<Group>& groups() const { return groups_; }
    const std::vector<Issue>& issues() const { return issues_; }
    // "bundled", "user", "settings"/"custom", "portable" -> folder path (only existing roots
    // plus the user folder, which is created on demand by openScriptsFolder).
    const std::map<std::string, std::filesystem::path>& folders() const { return folders_; }

    const ScriptPackage* find(const std::string& id) const;
    std::size_t size() const;  // number of packages
    Group* group(const std::string& id);
    const Group* group(const std::string& id) const;

    // {groups: [{id, order, names, icon?, iconUrl?, scripts: [...]}], issues: [...],
    //  folders: {bundled, user, custom?, portable?}} - see scripts_handlers.cpp.
    nlohmann::json to_json() const;
    static nlohmann::json package_to_json(const ScriptPackage& package);

    // Mutators used by the loader (and tests).
    Group& add_group(Group group);            // merges into an existing group with the same id
    bool add_package(ScriptPackage package);  // false (+ issue) on a duplicate id
    void add_issue(Issue issue) { issues_.push_back(std::move(issue)); }
    void set_folder(const std::string& key, std::filesystem::path path);
    void prune_empty_groups();  // drops groups without a single valid package
    void sort();                // groups by order then id; scripts by folder name

private:
    std::vector<Group> groups_;
    std::vector<Issue> issues_;
    std::map<std::string, std::filesystem::path> folders_;
};

// Walks the script layers (`layers.layers(Kind::scripts)`): bundled first, then settings,
// user, portable.
Catalog load_catalog(const resources::ResourceLayers& layers);

// URL path of a package file for the sandbox loader: `/scripts/<id>/<file>` with the id and
// each path segment percent-encoded.
std::string package_url(const std::string& id, const std::string& file);
// Percent-encodes one URL path segment (RFC 3986 unreserved characters kept).
std::string url_encode_segment(std::string_view text);

// Resolves `file` (a relative path such as "index.js" or "lib/util.js") inside the package
// folder. Returns an empty path for anything that escapes the folder ("..", absolute paths,
// backslashes) or does not exist as a regular file.
std::filesystem::path resolve_package_file(const ScriptPackage& package, std::string_view file);

// Relative paths of every regular file inside the package (sorted, '/' separators).
std::vector<std::string> package_files(const ScriptPackage& package);

/* ----------------------------------------------------------------------------------------- */
/* scripts.write (feature 005, the AI assistant - rpc-api.md §3.8 of the feature,            */
/* resource-formats.md §D)                                                                   */
/* ----------------------------------------------------------------------------------------- */

// The default group folder of a script the assistant writes.
inline constexpr const char* kAssistantGroup = "90_assistant";

// The segment rule: non-empty, not "." or "..", no '/' or '\', no control characters
// (U+0000-U+001F, U+007F), none of : * ? " < > |, not an NTFS reserved device name (CON, PRN,
// AUX, NUL, COM1-COM9, LPT1-LPT9 - ASCII case-insensitive, with or without an extension - on
// every platform, so that a package survives a copy to Windows), at most 255 bytes of UTF-8.
bool is_valid_path_segment(std::string_view segment);
// A package file path: relative, '/' separators, every segment under the segment rule (so no
// leading '/' or '\', no empty, "." or ".." segment).
bool is_valid_package_path(std::string_view path);
// The default package folder of an id: its last segment with every character the segment
// rule forbids replaced by '_' ("assistant/my-tool" -> "my-tool"). May still fail the rule
// (a reserved device name) - the caller checks.
std::string default_folder_of_id(std::string_view id);

struct PackageFile {
    std::string path;     // relative, '/' separators, under is_valid_package_path
    std::string content;  // UTF-8, written byte for byte
};

// A write that could not be performed (RPC 1002 doc.ioError {path, reason}); `reason` is
// "symlink" for a link met where none may be, else the operating system's text.
struct WriteFailure : std::runtime_error {
    WriteFailure(std::string path_, std::string reason_)
        : std::runtime_error(reason_), path(std::move(path_)), reason(std::move(reason_)) {}
    std::string path;  // UTF-8
    std::string reason;
};

// Canonical containment: `candidate` made weakly canonical lies strictly below the canonical
// `root`.
bool is_contained(const std::filesystem::path& root, const std::filesystem::path& candidate);
// Throws WriteFailure {path, "symlink"} when an ancestor of `dir` below `root`, `dir` itself
// or anything inside it is a symbolic link (symlink_status - never followed).
void refuse_symlinks(const std::filesystem::path& root, const std::filesystem::path& dir);

// The transient aside folder of a write: <data_dir>/.scripts-write-<pid>.
std::filesystem::path write_aside_dir(const std::filesystem::path& data_dir);
// Writes the package all or nothing: the files into the aside folder one by one with the
// atomic writer, an existing `dir` moved aside whole, the new folder renamed into `dir`, the
// aside folder removed. A failure restores the old folder, removes the aside folder and
// throws WriteFailure with `dir` as it was.
void write_package(const std::filesystem::path& data_dir, const std::filesystem::path& dir,
                   const std::vector<PackageFile>& files);
// Removes every <data_dir>/.scripts-write-* folder an interrupted write left behind (called
// by every rescan of the scripts). Best effort.
void remove_write_leftovers(const std::filesystem::path& data_dir);

}  // namespace mfbe::scripts
