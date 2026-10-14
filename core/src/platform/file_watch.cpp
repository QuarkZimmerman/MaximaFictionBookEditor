// Polling file watcher (T045). See mfbe/file_watch.hpp.
#include <mfbe/file_watch.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>

#include <system_error>
#include <vector>

namespace mfbe::platform {

FileStamp stamp_of(const std::filesystem::path& path) {
    FileStamp stamp;
    std::error_code ec;
    const auto status = std::filesystem::status(path, ec);
    if (ec || !std::filesystem::is_regular_file(status)) {
        return stamp;
    }
    const auto mtime = std::filesystem::last_write_time(path, ec);
    if (ec) {
        return stamp;
    }
    const auto size = std::filesystem::file_size(path, ec);
    if (ec) {
        return stamp;
    }
    stamp.exists = true;
    // Portable file_clock -> system_clock conversion (std::chrono::clock_cast is missing in
    // libstdc++ 11/12 and Apple's libc++): the two clocks are compared at the same instant.
    const auto now_file = std::filesystem::file_time_type::clock::now();
    const auto now_sys = std::chrono::system_clock::now();
    const auto sys = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
        now_sys +
        std::chrono::duration_cast<std::chrono::system_clock::duration>(mtime - now_file));
    stamp.mtime = std::chrono::duration_cast<std::chrono::seconds>(sys.time_since_epoch()).count();
    stamp.size = size;
    return stamp;
}

FileWatcher::FileWatcher(Callback callback, std::chrono::milliseconds interval)
    : callback_(std::move(callback)), interval_(interval) {
    thread_ = std::thread([this] { run(); });
}

FileWatcher::~FileWatcher() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stop_ = true;
    }
    cv_.notify_all();
    if (thread_.joinable()) {
        thread_.join();
    }
}

void FileWatcher::watch(const std::string& doc_id, const std::filesystem::path& path) {
    const FileStamp stamp = stamp_of(path);
    std::lock_guard<std::mutex> lock(mutex_);
    entries_[doc_id] = Entry{path, stamp};
}

void FileWatcher::unwatch(const std::string& doc_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    entries_.erase(doc_id);
}

bool FileWatcher::watching(const std::string& doc_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return entries_.count(doc_id) != 0;
}

void FileWatcher::refresh(const std::string& doc_id) {
    std::filesystem::path path;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = entries_.find(doc_id);
        if (it == entries_.end()) {
            return;
        }
        path = it->second.path;
    }
    const FileStamp stamp = stamp_of(path);
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(doc_id);
    if (it != entries_.end()) {
        it->second.stamp = stamp;
    }
}

std::size_t FileWatcher::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return entries_.size();
}

std::size_t FileWatcher::poll() {
    struct Change {
        std::string doc_id;
        std::string path;
        std::int64_t mtime;
    };
    std::vector<Change> changes;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (auto& [doc_id, entry] : entries_) {
            const FileStamp now = stamp_of(entry.path);
            if (now == entry.stamp) {
                continue;
            }
            entry.stamp = now;  // report each change once
            if (now.exists) {
                changes.push_back(Change{doc_id, utf8_from_path(entry.path), now.mtime});
            }
        }
    }
    for (const auto& change : changes) {
        if (callback_) {
            callback_(change.doc_id, change.path, change.mtime);
        }
    }
    return changes.size();
}

void FileWatcher::run() {
    std::unique_lock<std::mutex> lock(mutex_);
    while (!stop_) {
        cv_.wait_for(lock, interval_, [this] { return stop_; });
        if (stop_) {
            break;
        }
        if (entries_.empty()) {
            continue;
        }
        lock.unlock();
        poll();
        lock.lock();
    }
}

}  // namespace mfbe::platform
