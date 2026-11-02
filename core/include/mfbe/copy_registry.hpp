// Copies of the editor (feature 008, research R2, data-model §1-§2, resource-formats §1-§2).
//
// Every running copy owns one slot: an exclusive OS lock on `<Data>/copies/<n>.lock` (flock on
// Linux and macOS, LockFileEx on Windows), held for the process lifetime, so a copy that ends in
// any way frees its slot. Slot 1 uses the engine profile `<Data>/cef`, slot n >= 2
// `<Data>/cef-<n>`. The copy record `<Data>/copies/<n>.json` (schema 1) tells other starts where
// the copy is, which book it holds and whether it responds; a record counts only while its lock is
// held by another holder on this host.
#pragma once

#include <chrono>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::copies {

struct WindowRect {
    int x = 0;
    int y = 0;
    int w = 0;
    int h = 0;
    bool maximized = false;
};

struct BookRef {
    std::string path;
    std::string file_id;
};

struct Record {
    int schema = 1;
    int slot = 0;
    long long pid = 0;
    std::string host;
    std::string started_at;       // ISO-8601 UTC
    std::string last_active_at;   // ISO-8601 UTC
    std::string heartbeat_at;     // ISO-8601 UTC
    std::string state = "ready";  // "ready" | "busy" | "restarting"
    bool untouched = true;
    std::optional<BookRef> book;
    std::optional<WindowRect> window;
    bool live = false;  // computed when read: the slot's lock is held by another holder
};

// `<data>/cef` for slot 1, `<data>/cef-<n>` for n >= 2.
std::filesystem::path profile_dir(const std::filesystem::path& data_dir, int slot);

// A file's identity: device and inode (POSIX), volume serial and file index (Windows); else the
// canonical path, case-folded where the file system ignores case. Empty when the file is missing.
std::string file_identity(const std::filesystem::path& path);

// The local host name, as written into records.
std::string host_name();

// True when the record's heartbeat is less than five seconds old at `now` (FR-011).
bool is_responding(const Record& record, std::chrono::system_clock::time_point now);

class CopyRegistry {
public:
    explicit CopyRegistry(std::filesystem::path data_dir);
    ~CopyRegistry();
    CopyRegistry(const CopyRegistry&) = delete;
    CopyRegistry& operator=(const CopyRegistry&) = delete;

    // Takes the lowest free slot (1..max_slots) and writes its record. False when none is free.
    bool acquire(int max_slots = 64);
    // Takes this slot only (test hooks, `--mfbe-slot`). False when it is held.
    bool acquire_slot(int slot);
    // 0 before a slot was taken.
    int slot() const;

    void heartbeat();
    void set_active();
    void set_window(const WindowRect& window);
    void set_state(const std::string& state);
    void set_book(const std::optional<BookRef>& book);
    void set_untouched(bool untouched);
    Record record() const;

    // The records of the other copies; `live_only` drops stale ones.
    std::vector<Record> records(bool live_only = true) const;
    // The live copy, other than this one, that holds the book with this identity.
    std::optional<Record> find_book(const std::string& file_id) const;

    const std::filesystem::path& copies_dir() const { return dir_; }

private:
    void write_record() const;

    std::filesystem::path data_dir_;
    std::filesystem::path dir_;
    struct Lock;
    std::unique_ptr<Lock> lock_;
    Record record_;
};

}  // namespace mfbe::copies
