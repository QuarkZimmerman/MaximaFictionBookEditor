#include "sandbox_check.h"

#include <mfbe/utf8_paths.hpp>

#include <string>

#if defined(__linux__)
#include <cerrno>
#include <csignal>
#include <cstring>
#include <fstream>
#include <sched.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace mfbe::shell {

#if defined(__linux__)

namespace {

// First token of a /proc/sys file ("" when unreadable).
std::string readSysctl(const char* path) {
    std::ifstream in(path);
    std::string value;
    if (in) {
        in >> value;
    }
    return value;
}

// Exit codes of the probe child.
constexpr int kChildOk = 0;
constexpr int kChildUserNsFailed = 10;
constexpr int kChildPidNsFailed = 11;

// Forks a child that tries to enter a new user namespace (and then a PID + network
// namespace, as Chromium's zygote does). Returns 0 on success, otherwise an errno-like value
// describing the failure; sets `why` to a short reason.
int tryUserNamespace(std::string* why) {
    const pid_t pid = ::fork();
    if (pid < 0) {
        *why = std::string("fork failed: ") + std::strerror(errno);
        return errno != 0 ? errno : EAGAIN;
    }
    if (pid == 0) {
        // Child: only async-signal-safe calls from here on.
        if (::unshare(CLONE_NEWUSER) != 0) {
            ::_exit(kChildUserNsFailed);
        }
        if (::unshare(CLONE_NEWPID | CLONE_NEWNET) != 0) {
            ::_exit(kChildPidNsFailed);
        }
        ::_exit(kChildOk);
    }
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0) {
        if (errno != EINTR) {
            *why = std::string("waitpid failed: ") + std::strerror(errno);
            return errno;
        }
    }
    if (!WIFEXITED(status)) {
        *why = "probe process terminated abnormally";
        return EFAULT;
    }
    switch (WEXITSTATUS(status)) {
        case kChildOk:
            return 0;
        case kChildUserNsFailed:
            *why = "unshare(CLONE_NEWUSER) refused (kernel setting or AppArmor restriction)";
            return EPERM;
        case kChildPidNsFailed:
            *why = "user namespace created but PID/network namespaces refused";
            return EPERM;
        default:
            *why = "unexpected probe result";
            return EFAULT;
    }
}

}  // namespace

SandboxProbe probeSandbox(const std::filesystem::path& exe_dir) {
    SandboxProbe probe;
    probe.running_as_root = ::geteuid() == 0;

    // --- SUID helper -------------------------------------------------------------------------
    std::string helper_state = "missing";
    if (!exe_dir.empty()) {
        const std::filesystem::path helper = exe_dir / "chrome-sandbox";
        struct stat st = {};
        if (::stat(helper.c_str(), &st) == 0) {
            const bool root_owned = st.st_uid == 0;
            const bool setuid = (st.st_mode & S_ISUID) != 0;
            const bool executable = (st.st_mode & S_IXOTH) != 0;
            if (root_owned && setuid && executable) {
                probe.suid_helper = true;
                helper_state = "ok (" + mfbe::platform::utf8_from_path(helper) + ")";
            } else {
                helper_state = "present but not root-owned mode 4755 (" +
                               mfbe::platform::utf8_from_path(helper) + ")";
            }
        }
    }

    // --- unprivileged user namespaces --------------------------------------------------------
    std::string userns_state;
    const std::string clone_knob = readSysctl("/proc/sys/kernel/unprivileged_userns_clone");
    const std::string max_ns = readSysctl("/proc/sys/user/max_user_namespaces");
    if (clone_knob == "0") {
        userns_state = "no (kernel.unprivileged_userns_clone=0)";
    } else if (max_ns == "0") {
        userns_state = "no (user.max_user_namespaces=0)";
    } else {
        std::string why;
        const int rc = tryUserNamespace(&why);
        if (rc == 0) {
            probe.user_namespaces = true;
            userns_state = "yes";
        } else {
            userns_state = "no (" + why + ")";
        }
    }

    probe.details = "user namespaces: " + userns_state + "; SUID helper: " + helper_state +
                    "; running as root: " + (probe.running_as_root ? "yes" : "no");
    return probe;
}

#else  // !__linux__

SandboxProbe probeSandbox(const std::filesystem::path& /*exe_dir*/) {
    SandboxProbe probe;
    probe.user_namespaces = true;  // not applicable: the platform sandbox needs no helper
    probe.details = "not applicable on this platform";
    return probe;
}

#endif  // __linux__

std::string describeSandboxProbe(const SandboxProbe& probe) {
    return probe.details.empty() ? std::string("no probe information") : probe.details;
}

}  // namespace mfbe::shell
