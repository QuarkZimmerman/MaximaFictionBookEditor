// See mfbe/store_lock.hpp.
#include <mfbe/store_lock.hpp>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#endif

namespace mfbe::store_lock {

namespace {
std::filesystem::path lock_file(const std::filesystem::path& file) {
    std::filesystem::path p = file;
    p += ".lock";
    return p;
}
}  // namespace

StoreLock::StoreLock(const std::filesystem::path& file) {
    std::error_code ec;
    std::filesystem::create_directories(file.parent_path(), ec);
    const auto path = lock_file(file);
#ifdef _WIN32
    HANDLE h = CreateFileW(path.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
                           FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                           OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    OVERLAPPED overlapped{};
    if (!LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &overlapped)) {
        CloseHandle(h);
        return;
    }
    handle_ = h;
#else
    fd_ = ::open(path.c_str(), O_RDWR | O_CREAT | O_CLOEXEC, 0600);
    if (fd_ < 0) return;
    if (::flock(fd_, LOCK_EX) != 0) {
        ::close(fd_);
        fd_ = -1;
        return;
    }
#endif
    held_ = true;
}

StoreLock::~StoreLock() {
#ifdef _WIN32
    if (handle_ != nullptr) CloseHandle(static_cast<HANDLE>(handle_));
#else
    if (fd_ >= 0) ::close(fd_);
#endif
}

}  // namespace mfbe::store_lock
