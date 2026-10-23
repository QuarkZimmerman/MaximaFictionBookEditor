// SIGINT/SIGTERM (POSIX) and console control (Windows) handling for `mfbe-core serve`.
#include <mfbe/platform.hpp>

#include <atomic>
#include <mutex>
#include <thread>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN  // also a compile definition of mfbe::options (MSVC C4005 otherwise)
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <pthread.h>
#include <signal.h>
#endif

namespace mfbe::signals {
namespace {

std::mutex g_mutex;
std::function<void()> g_on_terminate;
std::atomic<bool> g_installed{false};
std::atomic<bool> g_fired{false};

void fire() {
    if (g_fired.exchange(true)) {
        return;
    }
    std::function<void()> cb;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        cb = g_on_terminate;
    }
    if (cb) {
        cb();
    }
}

#ifdef _WIN32
BOOL WINAPI console_handler(DWORD type) {
    switch (type) {
        case CTRL_C_EVENT:
        case CTRL_BREAK_EVENT:
        case CTRL_CLOSE_EVENT:
        case CTRL_SHUTDOWN_EVENT:
            fire();
            return TRUE;
        default:
            return FALSE;
    }
}
#endif

}  // namespace

void install_termination_handler(std::function<void()> on_terminate) {
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        g_on_terminate = std::move(on_terminate);
    }
    if (g_installed.exchange(true)) {
        return;
    }
#ifdef _WIN32
    SetConsoleCtrlHandler(console_handler, TRUE);
#else
    // Block the signals in the calling thread (inherited by threads created afterwards) and
    // wait for them synchronously on a dedicated thread: no async-signal-safety constraints.
    sigset_t set;
    sigemptyset(&set);
    sigaddset(&set, SIGINT);
    sigaddset(&set, SIGTERM);
    pthread_sigmask(SIG_BLOCK, &set, nullptr);
    std::thread([set] {
        int sig = 0;
        while (sigwait(&set, &sig) != 0) {
        }
        fire();
    }).detach();
#endif
}

}  // namespace mfbe::signals
