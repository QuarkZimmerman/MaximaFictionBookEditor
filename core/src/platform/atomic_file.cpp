// Atomic file writes (T014). See mfbe/atomic_file.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <fstream>
#include <random>
#include <sstream>
#include <system_error>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN  // also a compile definition of mfbe::options (MSVC C4005 otherwise)
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace mfbe::atomic_file {
namespace {

std::atomic<FaultPoint> g_fault{FaultPoint::none};

// Consumes the armed fault point if it matches `point`.
bool take_fault(FaultPoint point) {
    FaultPoint expected = point;
    return g_fault.compare_exchange_strong(expected, FaultPoint::none);
}

std::string errno_message(int err) {
    return platform::utf8_error_message(std::error_code(err, std::generic_category()));
}

// ".<file name>.<random hex>.tmp" next to the target (joined as paths: the name may hold any
// character).
std::filesystem::path make_temp_path(const std::filesystem::path& target) {
    static thread_local std::mt19937_64 rng{std::random_device{}()};
    std::ostringstream suffix;
    suffix << "." << std::hex << rng() << ".tmp";
    std::filesystem::path name = ".";
    name += target.filename();
    name += platform::path_from_utf8(suffix.str());
    return target.parent_path() / name;
}

#ifdef _WIN32

std::string last_error_message() {
    const DWORD err = GetLastError();
    LPWSTR buffer = nullptr;
    const DWORD n = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, err, 0, reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
    std::string result = "error " + std::to_string(err);
    if (n != 0 && buffer != nullptr) {
        const int size = WideCharToMultiByte(CP_UTF8, 0, buffer, static_cast<int>(n), nullptr, 0,
                                             nullptr, nullptr);
        std::string utf8(static_cast<std::size_t>(size), '\0');
        WideCharToMultiByte(CP_UTF8, 0, buffer, static_cast<int>(n), utf8.data(), size, nullptr,
                            nullptr);
        while (!utf8.empty() && (utf8.back() == '\r' || utf8.back() == '\n')) {
            utf8.pop_back();
        }
        result = utf8;
        LocalFree(buffer);
    }
    return result;
}

BackupOutcome write_temp_and_replace(const std::filesystem::path& target,
                                     const std::filesystem::path& temp, std::string_view bytes,
                                     const WriteOptions& options) {
    HANDLE h = CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
        throw WriteError(platform::utf8_from_path(target),
                         "cannot create temporary file: " + last_error_message());
    }
    auto fail = [&](const std::string& reason) {
        CloseHandle(h);
        DeleteFileW(temp.c_str());
        throw WriteError(platform::utf8_from_path(target), reason);
    };
    if (take_fault(FaultPoint::before_write)) {
        fail("injected fault: before_write");
    }
    std::size_t written = 0;
    const std::size_t half = bytes.size() / 2;
    while (written < bytes.size()) {
        if (written >= half && take_fault(FaultPoint::during_write)) {
            fail("injected fault: during_write");
        }
        // Stop at the halfway mark so the during_write fault can fire mid-payload.
        const std::size_t limit = written < half ? half - written : bytes.size() - written;
        const std::size_t chunk = std::min<std::size_t>(limit, 1u << 20);
        DWORD done = 0;
        if (!WriteFile(h, bytes.data() + written, static_cast<DWORD>(chunk), &done, nullptr)) {
            fail("write failed: " + last_error_message());
        }
        written += done;
    }
    if (take_fault(FaultPoint::before_fsync) || !FlushFileBuffers(h)) {
        fail("flush failed: " + last_error_message());
    }
    CloseHandle(h);
    if (take_fault(FaultPoint::before_rename)) {
        DeleteFileW(temp.c_str());
        throw WriteError(platform::utf8_from_path(target), "injected fault: before_rename");
    }
    BackupOutcome outcome;
    BOOL ok;
    if (GetFileAttributesW(target.c_str()) != INVALID_FILE_ATTRIBUTES) {
        if (options.backup) {
            outcome.requested = true;
            const std::filesystem::path bak = backup_path(target);
            if (take_fault(FaultPoint::before_backup)) {
                outcome.reason = "injected fault: before_backup";
            } else if (take_fault(FaultPoint::after_backup)) {
                // Tests: the backup is made, then the replace fails; the target stays whole.
                CopyFileW(target.c_str(), bak.c_str(), FALSE);
                DeleteFileW(temp.c_str());
                throw WriteError(platform::utf8_from_path(target), "injected fault: after_backup");
            } else if (ReplaceFileW(target.c_str(), temp.c_str(), bak.c_str(),
                                    REPLACEFILE_IGNORE_MERGE_ERRORS, nullptr, nullptr)) {
                outcome.kept = true;
                return outcome;
            } else {
                outcome.reason = last_error_message();
                if (GetFileAttributesW(target.c_str()) == INVALID_FILE_ATTRIBUTES &&
                    GetFileAttributesW(temp.c_str()) != INVALID_FILE_ATTRIBUTES) {
                    // ERROR_UNABLE_TO_MOVE_REPLACEMENT_2: the replaced file already went to the
                    // backup name; finish by moving the new file in.
                    if (MoveFileExW(temp.c_str(), target.c_str(),
                                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
                        outcome.kept = GetFileAttributesW(bak.c_str()) != INVALID_FILE_ATTRIBUTES;
                        if (outcome.kept) {
                            outcome.reason.clear();
                        }
                        return outcome;
                    }
                    throw WriteError(platform::utf8_from_path(target),
                                     "replace failed: " + last_error_message() +
                                         "; the previous version is in " +
                                         platform::utf8_from_path(bak));
                }
            }
        }
        ok = ReplaceFileW(target.c_str(), temp.c_str(), nullptr, REPLACEFILE_IGNORE_MERGE_ERRORS,
                          nullptr, nullptr);
    } else {
        ok = MoveFileExW(temp.c_str(), target.c_str(),
                         MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
    }
    if (!ok) {
        const std::string reason = "replace failed: " + last_error_message();
        DeleteFileW(temp.c_str());
        throw WriteError(platform::utf8_from_path(target), reason);
    }
    return outcome;
}

#else

// Copies `from` to the new file `to` (created exclusively) with fsync; "" or the reason.
std::string copy_file(const std::filesystem::path& from, const std::filesystem::path& to,
                      mode_t mode) {
    const int in = ::open(from.c_str(), O_RDONLY | O_CLOEXEC);
    if (in < 0) {
        return errno_message(errno);
    }
    const int out = ::open(to.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (out < 0) {
        const std::string why = errno_message(errno);
        ::close(in);
        return why;
    }
    std::string why;
    char buffer[1 << 16];
    for (;;) {
        const ssize_t n = ::read(in, buffer, sizeof buffer);
        if (n < 0 && errno == EINTR) {
            continue;
        }
        if (n < 0) {
            why = errno_message(errno);
            break;
        }
        if (n == 0) {
            break;
        }
        ssize_t done = 0;
        while (done < n) {
            const ssize_t w = ::write(out, buffer + done, static_cast<std::size_t>(n - done));
            if (w < 0 && errno == EINTR) {
                continue;
            }
            if (w < 0) {
                why = errno_message(errno);
                break;
            }
            done += w;
        }
        if (!why.empty()) {
            break;
        }
    }
    if (why.empty() && ::fsync(out) != 0) {
        why = errno_message(errno);
    }
    (void)::fchmod(out, mode);
    ::close(in);
    if (::close(out) != 0 && why.empty()) {
        why = errno_message(errno);
    }
    if (!why.empty()) {
        ::unlink(to.c_str());
    }
    return why;
}

// Keeps `target` as "<target>.bak": a hard link (or, where the file system has none, a copy)
// under a temporary name, then a rename over the backup. The target is never touched.
// Returns "" on success, else the reason.
std::string make_backup(const std::filesystem::path& target, mode_t mode) {
    const std::filesystem::path bak = backup_path(target);
    const std::filesystem::path staging = make_temp_path(bak);
    const bool no_link = take_fault(FaultPoint::no_hard_link);
    if (no_link || ::link(target.c_str(), staging.c_str()) != 0) {
        const int err = no_link ? EPERM : errno;
        if (err != EPERM && err != ENOTSUP && err != EOPNOTSUPP && err != EMLINK && err != EXDEV &&
            err != ENOSYS) {
            return errno_message(err);
        }
        const std::string why = copy_file(target, staging, mode);
        if (!why.empty()) {
            return why;
        }
    }
    if (::rename(staging.c_str(), bak.c_str()) != 0) {
        const std::string why = errno_message(errno);
        ::unlink(staging.c_str());
        return why;
    }
    return "";
}

BackupOutcome write_temp_and_replace(const std::filesystem::path& target,
                                     const std::filesystem::path& temp, std::string_view bytes,
                                     const WriteOptions& options) {
    // Keep the permissions of an existing target (default 0644 before umask otherwise).
    mode_t mode = 0644;
    struct stat st{};
    const bool target_exists = ::stat(target.c_str(), &st) == 0;
    if (target_exists) {
        mode = st.st_mode & 07777;
    }
    const int fd = ::open(temp.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd < 0) {
        throw WriteError(platform::utf8_from_path(target),
                         "cannot create temporary file: " + errno_message(errno));
    }
    auto fail = [&](const std::string& reason) {
        ::close(fd);
        ::unlink(temp.c_str());
        throw WriteError(platform::utf8_from_path(target), reason);
    };
    if (take_fault(FaultPoint::before_write)) {
        fail("injected fault: before_write");
    }
    std::size_t written = 0;
    const std::size_t half = bytes.size() / 2;
    while (written < bytes.size()) {
        if (written >= half && take_fault(FaultPoint::during_write)) {
            fail("injected fault: during_write");
        }
        // Stop at the halfway mark so the during_write fault can fire mid-payload.
        const std::size_t limit = written < half ? half - written : bytes.size() - written;
        const std::size_t chunk = std::min<std::size_t>(limit, 1u << 20);
        const ssize_t n = ::write(fd, bytes.data() + written, chunk);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            fail("write failed: " + errno_message(errno));
        }
        written += static_cast<std::size_t>(n);
    }
    if (take_fault(FaultPoint::before_fsync)) {
        fail("injected fault: before_fsync");
    }
    if (::fsync(fd) != 0) {
        fail("flush failed: " + errno_message(errno));
    }
    if (target_exists) {
        (void)::fchmod(fd, mode);
    }
    if (::close(fd) != 0) {
        ::unlink(temp.c_str());
        throw WriteError(platform::utf8_from_path(target), "close failed: " + errno_message(errno));
    }
    BackupOutcome outcome;
    if (options.backup && target_exists) {
        outcome.requested = true;
        if (take_fault(FaultPoint::before_backup)) {
            outcome.reason = "injected fault: before_backup";
        } else {
            outcome.reason = make_backup(target, mode);
            outcome.kept = outcome.reason.empty();
        }
        if (outcome.kept && take_fault(FaultPoint::after_backup)) {
            ::unlink(temp.c_str());
            throw WriteError(platform::utf8_from_path(target), "injected fault: after_backup");
        }
    }
    if (take_fault(FaultPoint::before_rename)) {
        ::unlink(temp.c_str());
        throw WriteError(platform::utf8_from_path(target), "injected fault: before_rename");
    }
    if (::rename(temp.c_str(), target.c_str()) != 0) {
        const std::string reason = "rename failed: " + errno_message(errno);
        ::unlink(temp.c_str());
        throw WriteError(platform::utf8_from_path(target), reason);
    }
    // Best effort: persist the directory entry.
    const int dir_fd = ::open(target.parent_path().c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir_fd >= 0) {
        (void)::fsync(dir_fd);
        ::close(dir_fd);
    }
    return outcome;
}

#endif

}  // namespace

void set_fault_injection(FaultPoint point) {
    g_fault.store(point);
}

FaultPoint fault_injection() {
    return g_fault.load();
}

std::filesystem::path backup_path(const std::filesystem::path& path) {
    std::filesystem::path bak = path;
    bak += platform::path_from_utf8(".bak");
    return bak;
}

void write_atomic(const std::filesystem::path& path, std::string_view bytes) {
    (void)write_atomic(path, bytes, WriteOptions{});
}

BackupOutcome write_atomic(const std::filesystem::path& path, std::string_view bytes,
                           const WriteOptions& options) {
    if (path.empty()) {
        throw WriteError("", "empty path");
    }
    const std::filesystem::path target = std::filesystem::absolute(path);
    std::error_code ec;
    if (!std::filesystem::is_directory(target.parent_path(), ec)) {
        throw WriteError(platform::utf8_from_path(target), "directory does not exist");
    }
    return write_temp_and_replace(target, make_temp_path(target), bytes, options);
}

std::string read_file(const std::filesystem::path& path) {
    // A folder opens as a stream on Linux and macOS (libstdc++ then throws from the read,
    // libc++ reads nothing); refused up front so every platform answers alike.
    std::error_code ec;
    if (std::filesystem::is_directory(path, ec)) {
        throw WriteError(platform::utf8_from_path(path), "is a directory");
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw WriteError(platform::utf8_from_path(path),
                         "cannot open file: " + errno_message(errno));
    }
    std::string data;
    try {
        data.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    } catch (const std::ios_base::failure&) {
        throw WriteError(platform::utf8_from_path(path), "read failed");
    }
    if (in.bad()) {
        throw WriteError(platform::utf8_from_path(path), "read failed");
    }
    return data;
}

}  // namespace mfbe::atomic_file
