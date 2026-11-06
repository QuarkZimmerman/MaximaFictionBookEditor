// Atomic file replacement (T014, Constitution IV).
//
// write_atomic() writes the bytes to a temporary file in the target directory, flushes it to
// disk and renames it over the target in one step (rename(2) on POSIX, ReplaceFileW /
// MoveFileExW on Windows). If anything fails the target file is left untouched and the
// temporary file is removed. The fault-injection hook lets tests fail the operation midway.
//
// With `WriteOptions::backup` (feature 009, FR-001 to FR-005, research DP-7) a replaced file is
// kept as "<path>.bak", replacing an older backup, without the target ever going missing:
// Windows makes the backup in the same ReplaceFileW call; POSIX links the target (or copies it
// where the file system has no hard links) to a temporary name, renames that to ".bak", and only
// then renames the new file over the target. A backup that cannot be made never stops the save:
// the outcome says why.
#pragma once

#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>

namespace mfbe::atomic_file {

struct WriteError : std::runtime_error {
    WriteError(std::string path_, std::string reason_)
        : std::runtime_error(reason_), path(std::move(path_)), reason(std::move(reason_)) {}
    std::string path;    // target path (UTF-8)
    std::string reason;  // human-readable OS reason (no book text)
};

enum class FaultPoint {
    none,
    before_write,   // temp file created, nothing written yet
    during_write,   // half of the payload written, then failure
    before_fsync,   // data written, flush fails
    before_rename,  // temp complete, rename fails
    before_backup,  // feature 009: the backup step fails; the save goes on without a backup
    after_backup,   // feature 009: the backup is made, then the replace fails
    no_hard_link    // feature 009 (POSIX): the backup's hard link fails as on FAT; copy instead
};

struct WriteOptions {
    bool backup = false;  // keep a replaced file as "<path>.bak"
};

// What became of a requested backup. `kept` is true when "<path>.bak" now holds the replaced
// file; `reason` is set only when a backup was wanted, the target existed, and none was made.
struct BackupOutcome {
    bool requested = false;
    bool kept = false;
    std::string reason;
};

// Test hook: the next write_atomic() fails at `point` (then the hook resets to `none`).
void set_fault_injection(FaultPoint point);
FaultPoint fault_injection();

// Replaces `path` with `bytes` atomically. Throws WriteError on failure.
void write_atomic(const std::filesystem::path& path, std::string_view bytes);
// The same, with a backup of the replaced file when `options.backup` is set.
BackupOutcome write_atomic(const std::filesystem::path& path, std::string_view bytes,
                           const WriteOptions& options);

// "<path>.bak": where write_atomic keeps the replaced file.
std::filesystem::path backup_path(const std::filesystem::path& path);

// Reads a whole file into a string. Throws WriteError (same shape) on failure - a missing file,
// a permission problem, a failing read, and a folder in the file's place (refused before the
// open: the platforms disagree on whether a folder opens as a stream).
std::string read_file(const std::filesystem::path& path);

}  // namespace mfbe::atomic_file
