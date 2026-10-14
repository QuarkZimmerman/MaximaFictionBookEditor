// External-change detection (T045, FR-006): polls mtime + size of watched files on a background
// thread (every 2 s by default) and reports changes once per change through a callback, which
// the server turns into the `doc.changedOnDisk {docId, path, mtime}` notification. Our own
// saves call refresh() so they are never reported.
#pragma once

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace mfbe::platform {

struct FileStamp {
    bool exists = false;
    std::int64_t mtime = 0;  // seconds since the Unix epoch
    std::uintmax_t size = 0;

    bool operator==(const FileStamp&) const = default;
};

// Current stamp of a file (exists = false when missing/unreadable).
FileStamp stamp_of(const std::filesystem::path& path);

class FileWatcher {
public:
    // (docId, path (UTF-8), mtime of the changed file)
    using Callback =
        std::function<void(const std::string& doc_id, const std::string& path, std::int64_t mtime)>;

    explicit FileWatcher(Callback callback,
                         std::chrono::milliseconds interval = std::chrono::milliseconds(2000));
    ~FileWatcher();
    FileWatcher(const FileWatcher&) = delete;
    FileWatcher& operator=(const FileWatcher&) = delete;

    // Starts watching `path` for `doc_id` (records the current stamp). Replaces any previous
    // entry of the document.
    void watch(const std::string& doc_id, const std::filesystem::path& path);
    void unwatch(const std::string& doc_id);
    bool watching(const std::string& doc_id) const;
    // Re-records the current stamp (after our own save) so the change is not reported.
    void refresh(const std::string& doc_id);
    // Checks every watched file now (also done periodically by the thread). Returns the
    // number of changes reported.
    std::size_t poll();
    std::size_t size() const;

private:
    struct Entry {
        std::filesystem::path path;
        FileStamp stamp;
    };
    void run();

    Callback callback_;
    std::chrono::milliseconds interval_;
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::map<std::string, Entry> entries_;
    bool stop_ = false;
    std::thread thread_;
};

}  // namespace mfbe::platform
