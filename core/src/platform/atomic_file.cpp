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
#define WIN32_LEAN_AND_MEAN
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

void write_temp_and_replace(const std::filesystem::path& target, const std::filesystem::path& temp,
                            std::string_view bytes) {
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
    BOOL ok;
    if (GetFileAttributesW(target.c_str()) != INVALID_FILE_ATTRIBUTES) {
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
}

#else

void write_temp_and_replace(const std::filesystem::path& target, const std::filesystem::path& temp,
                            std::string_view bytes) {
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
}

#endif

}  // namespace

void set_fault_injection(FaultPoint point) {
    g_fault.store(point);
}

FaultPoint fault_injection() {
    return g_fault.load();
}

void write_atomic(const std::filesystem::path& path, std::string_view bytes) {
    if (path.empty()) {
        throw WriteError("", "empty path");
    }
    const std::filesystem::path target = std::filesystem::absolute(path);
    std::error_code ec;
    if (!std::filesystem::is_directory(target.parent_path(), ec)) {
        throw WriteError(platform::utf8_from_path(target), "directory does not exist");
    }
    write_temp_and_replace(target, make_temp_path(target), bytes);
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
