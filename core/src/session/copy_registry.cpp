// Copies of the editor (feature 008). See mfbe/copy_registry.hpp.
#include <mfbe/atomic_file.hpp>
#include <mfbe/copy_registry.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <ctime>
#include <system_error>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace mfbe::copies {

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace {

std::string iso_utc(std::chrono::system_clock::time_point t) {
    const std::time_t secs = std::chrono::system_clock::to_time_t(t);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &secs);
#else
    gmtime_r(&secs, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

std::optional<std::chrono::system_clock::time_point> parse_iso_utc(const std::string& text) {
    std::tm tm{};
    if (text.size() != 20 || text[4] != '-' || text[7] != '-' || text[10] != 'T' ||
        text[13] != ':' || text[16] != ':' || text[19] != 'Z') {
        return std::nullopt;
    }
    try {
        tm.tm_year = std::stoi(text.substr(0, 4)) - 1900;
        tm.tm_mon = std::stoi(text.substr(5, 2)) - 1;
        tm.tm_mday = std::stoi(text.substr(8, 2));
        tm.tm_hour = std::stoi(text.substr(11, 2));
        tm.tm_min = std::stoi(text.substr(14, 2));
        tm.tm_sec = std::stoi(text.substr(17, 2));
    } catch (...) {
        return std::nullopt;
    }
#ifdef _WIN32
    const std::time_t secs = _mkgmtime(&tm);
#else
    const std::time_t secs = timegm(&tm);
#endif
    if (secs == static_cast<std::time_t>(-1)) return std::nullopt;
    return std::chrono::system_clock::from_time_t(secs);
}

long long current_pid() {
#ifdef _WIN32
    return static_cast<long long>(GetCurrentProcessId());
#else
    return static_cast<long long>(getpid());
#endif
}

fs::path lock_path(const fs::path& dir, int slot) {
    return dir / (std::to_string(slot) + ".lock");
}

fs::path record_path(const fs::path& dir, int slot) {
    return dir / (std::to_string(slot) + ".json");
}

json to_json(const Record& r) {
    json j{{"schema", 1},
           {"slot", r.slot},
           {"pid", r.pid},
           {"host", r.host},
           {"startedAt", r.started_at},
           {"lastActiveAt", r.last_active_at},
           {"heartbeatAt", r.heartbeat_at},
           {"state", r.state},
           {"untouched", r.untouched},
           {"book", nullptr},
           {"window", nullptr}};
    if (r.book) j["book"] = json{{"path", r.book->path}, {"fileId", r.book->file_id}};
    if (r.window) {
        j["window"] = json{{"x", r.window->x},
                           {"y", r.window->y},
                           {"w", r.window->w},
                           {"h", r.window->h},
                           {"maximized", r.window->maximized}};
    }
    return j;
}

std::optional<Record> from_json(const json& j) {
    if (!j.is_object() || j.value("schema", 0) != 1 || !j.contains("slot")) return std::nullopt;
    try {
        Record r;
        r.slot = j.at("slot").get<int>();
        r.pid = j.value("pid", 0LL);
        r.host = j.value("host", std::string{});
        r.started_at = j.value("startedAt", std::string{});
        r.last_active_at = j.value("lastActiveAt", std::string{});
        r.heartbeat_at = j.value("heartbeatAt", std::string{});
        r.state = j.value("state", std::string{"ready"});
        r.untouched = j.value("untouched", false);
        if (j.contains("book") && j["book"].is_object()) {
            r.book = BookRef{j["book"].value("path", std::string{}),
                             j["book"].value("fileId", std::string{})};
        }
        if (j.contains("window") && j["window"].is_object()) {
            const auto& w = j["window"];
            r.window = WindowRect{w.value("x", 0), w.value("y", 0), w.value("w", 0),
                                  w.value("h", 0), w.value("maximized", false)};
        }
        return r;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

}  // namespace

// ---------------------------------------------------------------------------------------------
// The slot lock: an exclusive OS lock on the slot's lock file, released when the process ends.

struct CopyRegistry::Lock {
#ifdef _WIN32
    HANDLE handle = INVALID_HANDLE_VALUE;
#else
    int fd = -1;
#endif
    static std::unique_ptr<Lock> try_take(const fs::path& path) {
        auto lock = std::make_unique<Lock>();
#ifdef _WIN32
        lock->handle = CreateFileW(path.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                   OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (lock->handle == INVALID_HANDLE_VALUE) return nullptr;
        OVERLAPPED overlapped{};
        if (!LockFileEx(lock->handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0,
                        &overlapped)) {
            return nullptr;
        }
#else
        lock->fd = ::open(path.c_str(), O_RDWR | O_CREAT | O_CLOEXEC, 0600);
        if (lock->fd < 0) return nullptr;
        if (::flock(lock->fd, LOCK_EX | LOCK_NB) != 0) return nullptr;
#endif
        return lock;
    }
    ~Lock() {
#ifdef _WIN32
        if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
#else
        if (fd >= 0) ::close(fd);
#endif
    }
};

namespace {

// True when another holder keeps the slot's lock.
bool lock_held(const fs::path& dir, int slot) {
    std::error_code ec;
    if (!fs::exists(lock_path(dir, slot), ec)) return false;
    struct Probe {
        static bool held(const fs::path& path) {
#ifdef _WIN32
            HANDLE h = CreateFileW(path.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                   OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (h == INVALID_HANDLE_VALUE) return false;
            OVERLAPPED overlapped{};
            const bool taken = LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                                          0, 1, 0, &overlapped) != 0;
            if (taken) UnlockFileEx(h, 0, 1, 0, &overlapped);
            CloseHandle(h);
            return !taken;
#else
            const int fd = ::open(path.c_str(), O_RDWR | O_CLOEXEC);
            if (fd < 0) return false;
            const bool taken = ::flock(fd, LOCK_EX | LOCK_NB) == 0;
            ::close(fd);  // closing drops a lock the probe took
            return !taken;
#endif
        }
    };
    return Probe::held(lock_path(dir, slot));
}

}  // namespace

fs::path profile_dir(const fs::path& data_dir, int slot) {
    return slot <= 1 ? data_dir / "cef" : data_dir / ("cef-" + std::to_string(slot));
}

std::string file_identity(const fs::path& path) {
#ifdef _WIN32
    HANDLE h = CreateFileW(path.wstring().c_str(), 0,
                           FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                           OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
        BY_HANDLE_FILE_INFORMATION info{};
        const bool ok = GetFileInformationByHandle(h, &info) != 0;
        CloseHandle(h);
        if (ok) {
            const unsigned long long index =
                (static_cast<unsigned long long>(info.nFileIndexHigh) << 32) | info.nFileIndexLow;
            return "vol:" + std::to_string(info.dwVolumeSerialNumber) + "/idx:" +
                   std::to_string(index);
        }
    }
#else
    struct stat st {};
    if (::stat(path.c_str(), &st) == 0) {
        return "dev:" + std::to_string(static_cast<unsigned long long>(st.st_dev)) + "/ino:" +
               std::to_string(static_cast<unsigned long long>(st.st_ino));
    }
#endif
    std::error_code ec;
    if (!fs::exists(path, ec)) return {};
    std::string text = platform::utf8_from_path(fs::weakly_canonical(path, ec));
#if defined(_WIN32) || defined(__APPLE__)
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
#endif
    return "path:" + text;
}

std::string host_name() {
#ifdef _WIN32
    wchar_t buf[256];
    DWORD size = 256;
    if (!GetComputerNameExW(ComputerNamePhysicalDnsHostname, buf, &size)) return {};
    const int bytes = WideCharToMultiByte(CP_UTF8, 0, buf, static_cast<int>(size), nullptr, 0,
                                          nullptr, nullptr);
    std::string out(static_cast<size_t>(bytes > 0 ? bytes : 0), '\0');
    if (bytes > 0) {
        WideCharToMultiByte(CP_UTF8, 0, buf, static_cast<int>(size), out.data(), bytes, nullptr,
                            nullptr);
    }
    return out;
#else
    char buf[256] = {};
    if (gethostname(buf, sizeof buf - 1) != 0) return {};
    return buf;
#endif
}

bool is_responding(const Record& record, std::chrono::system_clock::time_point now) {
    const auto beat = parse_iso_utc(record.heartbeat_at);
    return beat && now - *beat < std::chrono::seconds(5);
}

CopyRegistry::CopyRegistry(fs::path data_dir)
    : data_dir_(std::move(data_dir)), dir_(data_dir_ / "copies") {}

CopyRegistry::~CopyRegistry() {
    if (lock_ && record_.slot > 0) {
        std::error_code ec;
        fs::remove(record_path(dir_, record_.slot), ec);
    }
}

bool CopyRegistry::acquire(int max_slots) {
    for (int slot = 1; slot <= max_slots; ++slot) {
        if (acquire_slot(slot)) return true;
    }
    return false;
}

bool CopyRegistry::acquire_slot(int slot) {
    if (lock_ || slot < 1) return false;
    std::error_code ec;
    fs::create_directories(dir_, ec);
    auto lock = Lock::try_take(lock_path(dir_, slot));
    if (!lock) return false;
    lock_ = std::move(lock);
    const auto now = std::chrono::system_clock::now();
    record_ = Record{};
    record_.slot = slot;
    record_.pid = current_pid();
    record_.host = host_name();
    record_.started_at = iso_utc(now);
    record_.last_active_at = record_.started_at;
    record_.heartbeat_at = record_.started_at;
    record_.live = true;
    write_record();  // replaces a stale record of this slot
    return true;
}

int CopyRegistry::slot() const {
    return lock_ ? record_.slot : 0;
}

void CopyRegistry::heartbeat() {
    if (!lock_) return;
    record_.heartbeat_at = iso_utc(std::chrono::system_clock::now());
    write_record();
}

void CopyRegistry::set_active() {
    if (!lock_) return;
    const auto now = iso_utc(std::chrono::system_clock::now());
    record_.last_active_at = now;
    record_.heartbeat_at = now;
    write_record();
}

void CopyRegistry::set_window(const WindowRect& window) {
    if (!lock_) return;
    record_.window = window;
    write_record();
}

void CopyRegistry::set_state(const std::string& state) {
    if (!lock_) return;
    record_.state = state;
    write_record();
}

void CopyRegistry::set_book(const std::optional<BookRef>& book) {
    if (!lock_) return;
    record_.book = book;
    write_record();
}

void CopyRegistry::set_untouched(bool untouched) {
    if (!lock_) return;
    record_.untouched = untouched;
    write_record();
}

Record CopyRegistry::record() const {
    return record_;
}

std::vector<Record> CopyRegistry::records(bool live_only) const {
    std::vector<Record> out;
    std::error_code ec;
    if (!fs::is_directory(dir_, ec)) return out;
    const std::string host = host_name();
    for (const auto& entry : fs::directory_iterator(dir_, ec)) {
        const fs::path& p = entry.path();
        if (p.extension() != ".json") continue;
        std::string text;
        try {
            text = atomic_file::read_file(p);
        } catch (const std::exception&) {
            continue;
        }
        const json j = json::parse(text, nullptr, false);
        auto r = from_json(j);
        if (!r || (lock_ && r->slot == record_.slot)) continue;
        r->live = r->host == host && lock_held(dir_, r->slot);
        if (live_only && !r->live) continue;
        out.push_back(std::move(*r));
    }
    std::sort(out.begin(), out.end(),
              [](const Record& a, const Record& b) { return a.slot < b.slot; });
    return out;
}

std::optional<Record> CopyRegistry::find_book(const std::string& file_id) const {
    if (file_id.empty()) return std::nullopt;
    for (auto& r : records(true)) {
        if (r.book && r.book->file_id == file_id) return r;
    }
    return std::nullopt;
}

void CopyRegistry::write_record() const {
    try {
        atomic_file::write_atomic(record_path(dir_, record_.slot), to_json(record_).dump(2) + "\n");
    } catch (const std::exception&) {
        log::error("core", "copies.recordWriteFailed", "a copy record could not be written",
                   log::extras({{"slot", std::to_string(record_.slot)}}));
    }
}

}  // namespace mfbe::copies
