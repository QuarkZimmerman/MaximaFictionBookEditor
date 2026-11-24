// Feature 016 (PD2, DP-2 to DP-4): see reader_process.hpp.
#include "pdf/import/reader_process.hpp"

#include "mfbe/utf8_paths.hpp"

#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <mutex>

#ifdef __linux__
extern char** environ;
#endif

#ifdef _WIN32
// clang-format off: windows.h must come first
#include <windows.h>
#include <psapi.h>
// clang-format on
#else
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __linux__
#include <fstream>
#include <sys/prctl.h>
#endif
#ifdef __APPLE__
#include <libproc.h>
#include <mach-o/dyld.h>
#endif
#endif

namespace mfbe::pdf_import {

namespace {

std::vector<std::string> arguments(const ReaderOptions& o) {
    std::vector<std::string> args{platform::utf8_from_path(o.reader), "--pdf",
                                  platform::utf8_from_path(o.pdf),    "--out",
                                  platform::utf8_from_path(o.folder), "--max-memory",
                                  std::to_string(o.max_memory_mb),    "--quality",
                                  std::to_string(o.quality)};
    if (!o.fonts.empty()) {
        args.push_back("--fonts");
        args.push_back(platform::utf8_from_path(o.fonts));
    }
    if (o.ocr.enabled) {
        args.push_back("--ocr");
        args.push_back("--ocr-auto");
        args.push_back(o.ocr.auto_detect ? "1" : "0");
        if (!o.ocr.languages.empty()) {
            std::string joined;
            for (std::size_t i = 0; i < o.ocr.languages.size(); ++i) {
                if (i > 0) {
                    joined += ',';
                }
                joined += o.ocr.languages[i];
            }
            args.push_back("--ocr-langs");
            args.push_back(std::move(joined));
        }
        for (const auto& dir : o.ocr.dirs) {
            if (!dir.empty()) {
                args.push_back("--ocr-dir");
                args.push_back(platform::utf8_from_path(dir));
            }
        }
        args.push_back("--ocr-threads");
        args.push_back(std::to_string(std::clamp(o.ocr.threads, 1, 8)));
    }
    args.insert(args.end(), o.extra_args.begin(), o.extra_args.end());
    return args;
}

std::filesystem::path own_executable() {
#ifdef _WIN32
    std::wstring buffer(32768, L'\0');
    const DWORD n = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    buffer.resize(n);
    return std::filesystem::path(buffer);  // path-text: wide Windows API path
#elif defined(__APPLE__)
    char buffer[4096];
    uint32_t size = sizeof buffer;
    if (_NSGetExecutablePath(buffer, &size) == 0) {
        return platform::path_from_utf8(buffer);
    }
    return {};
#else
    std::error_code ec;
    return std::filesystem::read_symlink("/proc/self/exe", ec);
#endif
}

}  // namespace

std::filesystem::path find_reader() {
#ifdef _WIN32
    const char* name = "mfbe-pdf-reader.exe";
#else
    const char* name = "mfbe-pdf-reader";
#endif
    std::vector<std::filesystem::path> candidates;
    if (const char* env = std::getenv("MFBE_PDF_READER"); env != nullptr && *env != '\0') {
        candidates.push_back(platform::path_from_utf8(env));
    }
    const std::filesystem::path dir = own_executable().parent_path();
    if (!dir.empty()) {
        candidates.push_back(dir / name);
        candidates.push_back(dir.parent_path() / "Helpers" / name);
    }
#ifdef MFBE_PDF_READER_BUILD_PATH
    candidates.push_back(platform::path_from_utf8(MFBE_PDF_READER_BUILD_PATH));
#endif
    for (const auto& candidate : candidates) {
        std::error_code ec;
        if (std::filesystem::is_regular_file(candidate, ec)) {
            return candidate;
        }
    }
    return {};
}

#ifdef _WIN32

struct ReaderProcess::Impl {
    HANDLE process = nullptr;
    HANDLE job = nullptr;
    HANDLE in_write = nullptr;
    HANDLE out_read = nullptr;
    std::string buffer;
    std::chrono::milliseconds silence{30000};
    std::chrono::steady_clock::time_point last;
};

std::unique_ptr<ReaderProcess> ReaderProcess::start(const ReaderOptions& o, std::string& error) {
    auto impl = std::make_unique<Impl>();
    // Each argument quoted as the C runtime splits a command line: backslashes before a quote - the
    // closing one too - are doubled, and a quote inside is escaped. A folder ending in a backslash
    // (the temporary folder) otherwise swallowed the arguments after it.
    std::wstring command;
    for (const auto& arg : arguments(o)) {
        const std::wstring w = platform::path_from_utf8(arg).wstring();
        command += L'"';
        std::size_t slashes = 0;
        for (const wchar_t c : w) {
            if (c == L'\\') {
                ++slashes;
                continue;
            }
            command.append(c == L'"' ? slashes * 2 + 1 : slashes, L'\\');
            slashes = 0;
            command += c;
        }
        command.append(slashes * 2, L'\\');
        command += L"\" ";
    }
    impl->job = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    limits.ProcessMemoryLimit = o.max_memory_mb * 1024 * 1024;
    SetInformationJobObject(impl->job, JobObjectExtendedLimitInformation, &limits, sizeof limits);

    // Serialize inheritable pipe creation + CreateProcessW across parallel batch workers so one
    // worker's child cannot inherit another worker's pipe ends on Windows.
    PROCESS_INFORMATION pi{};
    {
        static std::mutex spawn_mutex;
        std::lock_guard<std::mutex> lock(spawn_mutex);
        SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
        HANDLE in_read = nullptr, out_write = nullptr;
        if (!CreatePipe(&in_read, &impl->in_write, &sa, 0) ||
            !CreatePipe(&impl->out_read, &out_write, &sa, 0)) {
            if (in_read) {
                CloseHandle(in_read);
            }
            if (out_write) {
                CloseHandle(out_write);
            }
            if (impl->in_write) {
                CloseHandle(impl->in_write);
            }
            if (impl->out_read) {
                CloseHandle(impl->out_read);
            }
            if (impl->job) {
                CloseHandle(impl->job);
            }
            error = "pipes";
            return nullptr;
        }
        SetHandleInformation(impl->in_write, HANDLE_FLAG_INHERIT, 0);
        SetHandleInformation(impl->out_read, HANDLE_FLAG_INHERIT, 0);
        STARTUPINFOW si{};
        si.cb = sizeof si;
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = in_read;
        si.hStdOutput = out_write;
        si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        const BOOL ok =
            CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE,
                           CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &si, &pi);
        CloseHandle(in_read);
        CloseHandle(out_write);
        if (!ok) {
            CloseHandle(impl->in_write);
            CloseHandle(impl->out_read);
            if (impl->job) {
                CloseHandle(impl->job);
            }
            error = "start";
            return nullptr;
        }
    }
    AssignProcessToJobObject(impl->job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    impl->process = pi.hProcess;
    impl->silence = o.silence_timeout;
    impl->last = std::chrono::steady_clock::now();
    return std::unique_ptr<ReaderProcess>(new ReaderProcess(std::move(impl)));
}

bool ReaderProcess::next_event(std::string& line, std::chrono::milliseconds wait) {
    const auto until = std::chrono::steady_clock::now() + wait;
    for (;;) {
        if (const auto nl = impl_->buffer.find('\n'); nl != std::string::npos) {
            line = impl_->buffer.substr(0, nl);
            impl_->buffer.erase(0, nl + 1);
            impl_->last = std::chrono::steady_clock::now();
            return true;
        }
        DWORD available = 0;
        if (impl_->out_read &&
            PeekNamedPipe(impl_->out_read, nullptr, 0, nullptr, &available, nullptr) &&
            available > 0) {
            std::string chunk(available, '\0');
            DWORD got = 0;
            ReadFile(impl_->out_read, chunk.data(), available, &got, nullptr);
            impl_->buffer.append(chunk.data(), got);
            continue;
        }
        reap(false);
        if (end_ != ReaderEnd::running) {
            return false;
        }
        if (std::chrono::steady_clock::now() - impl_->last > impl_->silence) {
            kill();
            end_ = ReaderEnd::timed_out;
            return false;
        }
        if (std::chrono::steady_clock::now() >= until) {
            return false;
        }
        Sleep(10);
    }
}

bool ReaderProcess::send_line(const std::string& text) {
    const std::string data = text + "\n";
    DWORD written = 0;
    return impl_->in_write && WriteFile(impl_->in_write, data.data(),
                                        static_cast<DWORD>(data.size()), &written, nullptr) != 0;
}

void ReaderProcess::kill() {
    if (impl_->in_write) {
        CloseHandle(impl_->in_write);
        impl_->in_write = nullptr;
    }
    if (impl_->job) {
        TerminateJobObject(impl_->job, 1);
    }
    if (impl_->process) {
        // TerminateProcess covers cases where job assignment was rejected, and WaitForSingleObject
        // ensures the reader releases source-PDF and work-directory handles before cleanup runs.
        TerminateProcess(impl_->process, 1);
        WaitForSingleObject(impl_->process, 5000);
    }
    if (end_ == ReaderEnd::running) {
        end_ = ReaderEnd::killed;
    }
}

void ReaderProcess::reap(bool wait) {
    if (!impl_->process || end_ != ReaderEnd::running) {
        return;
    }
    if (WaitForSingleObject(impl_->process, wait ? INFINITE : 0) == WAIT_OBJECT_0) {
        DWORD code = 0;
        GetExitCodeProcess(impl_->process, &code);
        exit_code_ = static_cast<int>(code);
        end_ = (code == 0 || code == 1) ? ReaderEnd::exited : ReaderEnd::crashed;
    }
}

void ReaderProcess::check_limits() {}

ReaderProcess::~ReaderProcess() {
    kill();
    for (HANDLE h : {impl_->process, impl_->job, impl_->in_write, impl_->out_read}) {
        if (h) {
            CloseHandle(h);
        }
    }
}

#else  // POSIX

struct ReaderProcess::Impl {
    pid_t pid = -1;
    int in_fd = -1;
    int out_fd = -1;
    std::string buffer;
    std::chrono::milliseconds silence{30000};
    std::chrono::steady_clock::time_point last;
    std::chrono::steady_clock::time_point eof_at{};
    std::size_t max_bytes = 0;
    bool over_memory = false;
};

std::unique_ptr<ReaderProcess> ReaderProcess::start(const ReaderOptions& o, std::string& error) {
    const std::vector<std::string> args = arguments(o);
    std::vector<char*> argv;
    for (const auto& a : args) {
        argv.push_back(const_cast<char*>(a.c_str()));
    }
    argv.push_back(nullptr);
#ifdef __linux__
    // Build the child environment before fork() so the child stays strictly async-signal-safe.
    // Under --ocr, multi-threaded Tesseract workers cause glibc malloc to reserve large virtual
    // arenas and retain freed multi-megabyte Pix/Splash buffers via dynamic mmap-threshold
    // ratcheting; capping arenas to 2, pinning MALLOC_MMAP_THRESHOLD_ to 128 KiB, and raising
    // RLIMIT_AS to 4096 MiB avoids false bad_alloc and immediately returns freed image buffers to
    // the OS while check_limits() enforces physical RSS <= max_memory_mb.
    std::vector<std::string> env_strings;
    std::vector<char*> envp;
    if (o.ocr.enabled) {
        if (environ != nullptr) {
            for (char** e = environ; *e != nullptr; ++e) {
                if (std::strncmp(*e, "MALLOC_ARENA_MAX=", 17) != 0 &&
                    std::strncmp(*e, "MALLOC_MMAP_THRESHOLD_=", 23) != 0) {
                    env_strings.emplace_back(*e);
                }
            }
        }
        env_strings.emplace_back("MALLOC_ARENA_MAX=2");
        env_strings.emplace_back("MALLOC_MMAP_THRESHOLD_=131072");
        envp.reserve(env_strings.size() + 1);
        for (auto& s : env_strings) {
            envp.push_back(s.data());
        }
        envp.push_back(nullptr);
    }
#endif
    int in_pipe[2] = {-1, -1};
    int out_pipe[2] = {-1, -1};
    pid_t pid = -1;
    // Serialize pipe creation + FD_CLOEXEC + fork() across concurrent callers so no reader child
    // can inherit another worker's pipe descriptors across exec().
    {
        static std::mutex spawn_mutex;
        std::lock_guard<std::mutex> lock(spawn_mutex);
        if (pipe(in_pipe) != 0) {
            error = "pipes";
            return nullptr;
        }
        if (pipe(out_pipe) != 0) {
            close(in_pipe[0]);
            close(in_pipe[1]);
            error = "pipes";
            return nullptr;
        }
        for (int fd : {in_pipe[0], in_pipe[1], out_pipe[0], out_pipe[1]}) {
            fcntl(fd, F_SETFD, FD_CLOEXEC);
        }
        const pid_t parent = getpid();
        pid = fork();
        if (pid < 0) {
            for (int fd : {in_pipe[0], in_pipe[1], out_pipe[0], out_pipe[1]}) {
                close(fd);
            }
            error = "fork";
            return nullptr;
        }
        if (pid == 0) {
#ifdef __linux__
            prctl(PR_SET_PDEATHSIG, SIGKILL);
            if (getppid() != parent) {
                _exit(1);
            }
            const std::size_t as_limit_mb =
                o.ocr.enabled ? std::max<std::size_t>(o.max_memory_mb, 4096) : o.max_memory_mb;
            rlimit limit{};
            limit.rlim_cur = limit.rlim_max = static_cast<rlim_t>(as_limit_mb) * 1024 * 1024;
            setrlimit(RLIMIT_AS, &limit);
#else
            (void)parent;
#endif
            // Restore default SIGPIPE in the child; parent ignores it so a closed reader pipe does
            // not kill the core, whereas the reader must not ignore a broken stdout pipe.
            signal(SIGPIPE, SIG_DFL);
            if (in_pipe[0] == 0) {
                fcntl(0, F_SETFD, 0);
            } else {
                dup2(in_pipe[0], 0);
            }
            if (out_pipe[1] == 1) {
                fcntl(1, F_SETFD, 0);
            } else {
                dup2(out_pipe[1], 1);
            }
            for (int fd : {in_pipe[0], in_pipe[1], out_pipe[0], out_pipe[1]}) {
                if (fd != 0 && fd != 1) {
                    close(fd);
                }
            }
#ifdef __linux__
            if (!envp.empty()) {
                execve(argv[0], argv.data(), envp.data());
            } else {
                execv(argv[0], argv.data());
            }
#else
            execv(argv[0], argv.data());
#endif
            _exit(127);
        }
        close(in_pipe[0]);
        close(out_pipe[1]);
    }
    auto impl = std::make_unique<Impl>();
    impl->pid = pid;
    impl->in_fd = in_pipe[1];
    impl->out_fd = out_pipe[0];
    impl->silence = o.silence_timeout;
    impl->last = std::chrono::steady_clock::now();
    impl->max_bytes = o.max_memory_mb * 1024 * 1024;
    signal(SIGPIPE, SIG_IGN);
    return std::unique_ptr<ReaderProcess>(new ReaderProcess(std::move(impl)));
}

void ReaderProcess::check_limits() {
    if (impl_->pid <= 0 || end_ != ReaderEnd::running) {
        return;
    }
    std::size_t resident = 0;
#ifdef __linux__
    std::ifstream statm("/proc/" + std::to_string(impl_->pid) + "/statm");
    std::size_t pages = 0, rss = 0;
    if (statm >> pages >> rss) {
        resident = rss * static_cast<std::size_t>(sysconf(_SC_PAGESIZE));
    }
#elif defined(__APPLE__)
    proc_taskinfo info{};
    if (proc_pidinfo(impl_->pid, PROC_PIDTASKINFO, 0, &info, sizeof info) == sizeof info) {
        resident = info.pti_resident_size;
    }
#endif
    if (resident > impl_->max_bytes) {
        impl_->over_memory = true;
        kill();
        end_ = ReaderEnd::over_memory;
    }
}

bool ReaderProcess::next_event(std::string& line, std::chrono::milliseconds wait) {
    const auto until = std::chrono::steady_clock::now() + wait;
    for (;;) {
        if (const auto nl = impl_->buffer.find('\n'); nl != std::string::npos) {
            line = impl_->buffer.substr(0, nl);
            impl_->buffer.erase(0, nl + 1);
            impl_->last = std::chrono::steady_clock::now();
            return true;
        }
        if (impl_->out_fd >= 0) {
            pollfd p{impl_->out_fd, POLLIN, 0};
            const int pr = poll(&p, 1, 20);
            if (pr > 0) {
                char chunk[65536];
                const ssize_t n = read(impl_->out_fd, chunk, sizeof chunk);
                if (n > 0) {
                    impl_->buffer.append(chunk, static_cast<std::size_t>(n));
                    continue;
                }
                if (n < 0 && (errno == EINTR || errno == EAGAIN)) {
                    continue;
                }
                close(impl_->out_fd);
                impl_->out_fd = -1;
                if (impl_->in_fd >= 0) {
                    close(impl_->in_fd);
                    impl_->in_fd = -1;
                }
                impl_->eof_at = std::chrono::steady_clock::now();
            }
        }
        check_limits();
        reap(false);
        if (end_ != ReaderEnd::running) {
            return false;
        }
        const auto now = std::chrono::steady_clock::now();
        if (impl_->out_fd < 0) {
            // Once stdout reached EOF, give the child a brief window to exit cleanly before
            // killing it so next_event() never deadlocks in a blocking waitpid().
            if (now - impl_->eof_at > std::chrono::seconds(5)) {
                kill();
                end_ = ReaderEnd::crashed;
                return false;
            }
            poll(nullptr, 0, 10);
        }
        if (now - impl_->last > impl_->silence) {
            kill();
            end_ = ReaderEnd::timed_out;
            return false;
        }
        if (now >= until) {
            return false;
        }
    }
}

bool ReaderProcess::send_line(const std::string& text) {
    const std::string data = text + "\n";
    return impl_->in_fd >= 0 &&
           write(impl_->in_fd, data.data(), data.size()) == static_cast<ssize_t>(data.size());
}

void ReaderProcess::kill() {
    if (impl_->in_fd >= 0) {
        close(impl_->in_fd);  // the macOS reader ends when its standard input closes
        impl_->in_fd = -1;
    }
    if (impl_->pid > 0 && end_ == ReaderEnd::running) {
        ::kill(impl_->pid, SIGKILL);
        end_ = ReaderEnd::killed;
        int status = 0;
        while (waitpid(impl_->pid, &status, 0) < 0 && errno == EINTR) {
        }
        impl_->pid = -1;
    }
}

void ReaderProcess::reap(bool wait) {
    if (impl_->pid <= 0 || end_ != ReaderEnd::running) {
        return;
    }
    int status = 0;
    const pid_t r = waitpid(impl_->pid, &status, wait ? 0 : WNOHANG);
    if (r != impl_->pid) {
        return;
    }
    impl_->pid = -1;
    if (WIFEXITED(status)) {
        exit_code_ = WEXITSTATUS(status);
        end_ = (exit_code_ == 0 || exit_code_ == 1) ? ReaderEnd::exited : ReaderEnd::crashed;
    } else {
        end_ = ReaderEnd::crashed;
    }
}

ReaderProcess::~ReaderProcess() {
    kill();
    if (impl_->out_fd >= 0) {
        close(impl_->out_fd);
        impl_->out_fd = -1;
    }
}

#endif

ReaderProcess::ReaderProcess(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

void ReaderProcess::set_silence_timeout(std::chrono::milliseconds timeout) {
    impl_->silence = timeout;
}

}  // namespace mfbe::pdf_import
