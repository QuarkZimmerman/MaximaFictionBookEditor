// Linux sandbox availability probe (T140).
//
// Chromium's multi-process sandbox needs one of two mechanisms on Linux:
//   * the namespace sandbox: unprivileged user namespaces (clone(CLONE_NEWUSER) from a
//     normal process). Ubuntu 24.04+ restricts them for unconfined programs through AppArmor
//     (kernel.apparmor_restrict_unprivileged_userns=1); the .deb/.rpm packages ship an
//     AppArmor profile that lifts the restriction for /usr/lib/mfbe/mfbe, the AppImage
//     cannot;
//   * the SUID sandbox: a root-owned `chrome-sandbox` helper with mode 4755 next to the
//     executable (installed by the .deb/.rpm; impossible inside an AppImage).
// When neither works Chromium aborts at start-up ("No usable sandbox!") unless --no-sandbox
// is given. The shell runs this probe before CefInitialize and, only when neither mechanism
// is usable, turns the sandbox off itself with a logged warning (contracts/cli.md: "used
// automatically by the AppImage when user namespaces are unavailable; logged"). Running as
// root is treated the same way because Chromium refuses to sandbox a root process.
//
// Plain C++, no CEF, no exceptions. On other platforms the probe reports the sandbox as
// usable (Windows/macOS sandboxes need no runtime prerequisites).
#pragma once

#include <filesystem>
#include <string>

namespace mfbe::shell {

struct SandboxProbe {
    bool user_namespaces = false;  // clone(CLONE_NEWUSER) works for an unprivileged process
    bool suid_helper = false;      // root-owned SUID chrome-sandbox next to the executable
    bool running_as_root = false;  // effective uid 0 (Chromium refuses to sandbox root)
    std::string details;           // human-readable summary for logs/diagnostics

    // True when Chromium can start with its sandbox enabled.
    bool usable() const { return !running_as_root && (user_namespaces || suid_helper); }
};

// Probes the sandbox prerequisites. `exe_dir` is the directory of the running executable
// (where chrome-sandbox is expected). Cheap: a few stat/read calls and one short-lived child
// process on Linux.
SandboxProbe probeSandbox(const std::filesystem::path& exe_dir);

// One-line description of the probe result, e.g.
// "user namespaces: no (EPERM: AppArmor restriction?), SUID helper: missing, root: no".
std::string describeSandboxProbe(const SandboxProbe& probe);

}  // namespace mfbe::shell
