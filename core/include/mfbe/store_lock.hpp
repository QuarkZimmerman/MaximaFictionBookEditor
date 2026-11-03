// Serialises the writes of several copies of the editor to one shared file (feature 008,
// data-model §6, resource-formats §3): an exclusive OS lock on `<file>.lock` beside the file,
// held while a copy re-reads the file, applies its own changes and writes it atomically.
#pragma once

#include <filesystem>

namespace mfbe::store_lock {

class StoreLock {
public:
    // Blocks until the lock is held; an unusable lock file leaves the writer unserialised.
    explicit StoreLock(const std::filesystem::path& file);
    ~StoreLock();
    StoreLock(const StoreLock&) = delete;
    StoreLock& operator=(const StoreLock&) = delete;
    bool held() const { return held_; }

private:
#ifdef _WIN32
    void* handle_ = nullptr;
#else
    int fd_ = -1;
#endif
    bool held_ = false;
};

}  // namespace mfbe::store_lock
