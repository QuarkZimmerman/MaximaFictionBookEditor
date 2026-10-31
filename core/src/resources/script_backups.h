// Script backups (feature 007, T116; data-model §9; contracts/rpc-api.md §3.6 and
// resource-formats.md §1 of the feature; FR-084). Before the assistant's change replaces a
// script in effect, the core keeps that version:
//
//   <Data>/script-backups/<id percent-encoded>/<yyyymmddThhmmssZ>/
//       backup.json   {id, origin, sourceDir, createdAt, reason}
//       <the script's files as they were>
//
// <Data> is the per-user data folder, or the portable copy's `user` folder (platform::Dirs
// data), so the folder lies outside every scripts root and the loader never reads it. A backup
// is written aside (`<backup id>.partial`) and renamed into place, so it is there whole or not
// at all; a second backup within the same second takes the next free `-N` suffix. Nothing
// removes a backup but the undoing of one whose write then failed. `reason` is
// `assistantChange` for the backup of `scripts.write` and `restore` for the version a restore
// replaced.
#pragma once

#include <mfbe/scripts.hpp>

#include <chrono>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::scripts::backups {

inline constexpr const char* kReasonChange = "assistantChange";
inline constexpr const char* kReasonRestore = "restore";

struct Backup {
    std::string id;             // the script's id
    std::string backup_id;      // the folder name: yyyymmddThhmmssZ, maybe with "-N"
    std::string origin;         // bundled | settings | user | portable | assistant
    std::string source_dir;     // the package folder that was backed up (UTF-8)
    std::string created_at;     // ISO 8601 UTC, whole seconds
    std::string reason;         // kReasonChange | kReasonRestore
    std::filesystem::path dir;  // the backup's folder
};

// <Data>/script-backups.
std::filesystem::path root(const std::filesystem::path& data_dir);
// <Data>/script-backups/<id percent-encoded>.
std::filesystem::path folder_of(const std::filesystem::path& data_dir, const std::string& id);
// `yyyymmddThhmmssZ` of a moment, in UTC.
std::string stamp_of(std::chrono::system_clock::time_point at);
// A backup id: `yyyymmddThhmmssZ`, optionally followed by `-<N>` (N >= 1, no leading zero).
bool is_valid_backup_id(std::string_view backup_id);

// Copies `package` as it is now into a new backup of its id. Throws WriteFailure {path,
// reason} when the backup cannot be written; nothing of it is left then.
Backup create(const std::filesystem::path& data_dir, const ScriptPackage& package,
              const std::string& reason,
              std::chrono::system_clock::time_point at = std::chrono::system_clock::now());

// The backups of `id`, newest first; folders that are no backup of this id are skipped.
std::vector<Backup> list(const std::filesystem::path& data_dir, const std::string& id);

// One backup of `id`; nullopt when there is none of that id (or `backup_id` is malformed).
std::optional<Backup> find(const std::filesystem::path& data_dir, const std::string& id,
                           const std::string& backup_id);

// The script's files a backup holds (everything but backup.json at its top), byte for byte,
// with relative '/' paths, sorted. Throws WriteFailure when one cannot be read.
std::vector<PackageFile> files_of(const Backup& backup);

// Removes a backup - the undoing of one made for a write that then failed. Best effort.
void remove(const Backup& backup);

}  // namespace mfbe::scripts::backups
