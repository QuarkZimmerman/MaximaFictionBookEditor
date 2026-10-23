// Opening folders/URLs with the OS and process metrics (T015).
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>

#include <cstdio>
#include <mutex>
#include <system_error>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN  // also a compile definition of mfbe::options (MSVC C4005 otherwise)
#define WIN32_LEAN_AND_MEAN
#endif
// clang-format off: windows.h must come first, psapi.h/shellapi.h depend on its definitions
#include <windows.h>

#include <psapi.h>
#include <shellapi.h>
// clang-format on
#else
#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
extern char** environ;
#endif
#ifdef __APPLE__
#include <mach/mach.h>
#endif

namespace mfbe::process {
namespace {

std::mutex g_runner_mutex;
CommandRunner g_runner;

#ifndef _WIN32
bool spawn_detached(const std::vector<std::string>& argv) {
    if (argv.empty()) {
        return false;
    }
    std::vector<char*> args;
    args.reserve(argv.size() + 1);
    for (const auto& a : argv) {
        args.push_back(const_cast<char*>(a.c_str()));
    }
    args.push_back(nullptr);
    pid_t pid = 0;
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
    posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
    // posix_spawnp reports a missing program through its return code (glibc >= 2.24).
    const int rc = posix_spawnp(&pid, args[0], &actions, nullptr, args.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    if (rc != 0) {
        log::warning("core", "process.spawnFailed", "cannot start opener",
                     log::extras({{"program", argv[0]},
                                  {"reason", platform::utf8_error_message(
                                                 std::error_code(rc, std::generic_category()))}}));
        return false;
    }
    // Reap the opener in the background so it never lingers as a zombie; never block here.
    std::thread([pid] {
        int status = 0;
        (void)::waitpid(pid, &status, 0);
    }).detach();
    return true;
}
#endif

bool run(const std::vector<std::string>& argv) {
    {
        std::lock_guard<std::mutex> lock(g_runner_mutex);
        if (g_runner) {
            return g_runner(argv);
        }
    }
#ifdef _WIN32
    if (argv.size() < 2) {
        return false;
    }
    const std::string& target = argv[1];
    const int size = MultiByteToWideChar(CP_UTF8, 0, target.c_str(), -1, nullptr, 0);
    std::wstring wide(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, target.c_str(), -1, wide.data(), size);
    const auto result = reinterpret_cast<INT_PTR>(
        ShellExecuteW(nullptr, L"open", wide.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
    return result > 32;
#else
    return spawn_detached(argv);
#endif
}

std::vector<std::string> opener_command(const std::string& target) {
#ifdef _WIN32
    return {"explorer", target};
#elif defined(__APPLE__)
    return {"open", target};
#else
    return {"xdg-open", target};
#endif
}

}  // namespace

bool open_folder(const std::filesystem::path& path) {
    std::error_code ec;
    if (!std::filesystem::is_directory(path, ec)) {
        return false;
    }
    return run(opener_command(platform::utf8_from_path(std::filesystem::absolute(path))));
}

bool open_url(const std::string& url) {
    if (url.rfind("http://", 0) != 0 && url.rfind("https://", 0) != 0) {
        return false;
    }
    return run(opener_command(url));
}

void set_command_runner_for_tests(CommandRunner runner) {
    std::lock_guard<std::mutex> lock(g_runner_mutex);
    g_runner = std::move(runner);
}

}  // namespace mfbe::process

namespace mfbe::platform {

std::size_t resident_memory_bytes() {
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS counters{};
    if (GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) {
        return static_cast<std::size_t>(counters.WorkingSetSize);
    }
    return 0;
#elif defined(__APPLE__)
    mach_task_basic_info info{};
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, reinterpret_cast<task_info_t>(&info),
                  &count) == KERN_SUCCESS) {
        return static_cast<std::size_t>(info.resident_size);
    }
    return 0;
#else
    std::FILE* f = std::fopen("/proc/self/statm", "r");
    if (f == nullptr) {
        return 0;
    }
    unsigned long size = 0;
    unsigned long resident = 0;
    const int n = std::fscanf(f, "%lu %lu", &size, &resident);
    std::fclose(f);
    if (n != 2) {
        return 0;
    }
    const long page = ::sysconf(_SC_PAGESIZE);
    return static_cast<std::size_t>(resident) * static_cast<std::size_t>(page > 0 ? page : 4096);
#endif
}

std::size_t peak_resident_memory_bytes() {
#ifdef __linux__
    std::FILE* f = std::fopen("/proc/self/status", "r");
    if (f == nullptr) {
        return 0;
    }
    char line[256];
    std::size_t peak = 0;
    while (std::fgets(line, sizeof(line), f) != nullptr) {
        unsigned long long kb = 0;
        if (std::sscanf(line, "VmHWM: %llu", &kb) == 1) {
            peak = static_cast<std::size_t>(kb) * 1024;
            break;
        }
    }
    std::fclose(f);
    return peak;
#else
    return 0;
#endif
}

}  // namespace mfbe::platform
