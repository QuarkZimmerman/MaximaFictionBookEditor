// Portable folder of a copy of the editor. See mfbe/portable.hpp. Built as mfbe_paths
// (core/CMakeLists.txt).
#include <mfbe/portable.hpp>
#include <mfbe/utf8_paths.hpp>

#include <fstream>
#include <system_error>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN  // also a compile definition of mfbe::options (MSVC C4005 otherwise)
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace mfbe::platform {

namespace {

bool is_dir(const std::filesystem::path& p) {
    std::error_code ec;
    return std::filesystem::is_directory(p, ec);
}

unsigned long process_id() {
#ifdef _WIN32
    return static_cast<unsigned long>(GetCurrentProcessId());
#else
    return static_cast<unsigned long>(getpid());
#endif
}

}  // namespace

std::optional<std::filesystem::path> detect_portable_dir(
    const std::filesystem::path& exe_dir, const std::optional<std::string>& appimage) {
    std::vector<std::filesystem::path> candidates;
    if (appimage && !appimage->empty()) {
        const std::filesystem::path image = path_from_utf8(*appimage);
        std::filesystem::path home = image;
        home += ".home";
        std::filesystem::path dot_d = image;
        dot_d += ".d";
        candidates.push_back(home / "user");
        candidates.push_back(dot_d / "user");
        candidates.push_back(dot_d);
    } else if (!exe_dir.empty()) {
        candidates.push_back(exe_dir / "user");
#ifdef __APPLE__
        // <App>.app/Contents/MacOS/<exe> -> <App>.app/../user
        candidates.push_back(exe_dir / ".." / ".." / ".." / "user");
#endif
    }
    for (const auto& c : candidates) {
        if (is_dir(c)) {
            std::error_code ec;
            auto canonical = std::filesystem::weakly_canonical(c, ec);
            return ec ? c : canonical;
        }
    }
    return std::nullopt;
}

bool directory_writable(const std::filesystem::path& dir) {
    if (dir.empty() || !is_dir(dir)) {
        return false;
    }
    // Windows does not show access rights in a folder's attributes: only creating a file tells.
    const std::filesystem::path probe =
        dir / path_from_utf8(".mfbe-write-probe-" + std::to_string(process_id()));
    {
        std::ofstream out(probe, std::ios::binary | std::ios::trunc);
        if (!out) {
            return false;
        }
    }
    std::error_code ec;
    std::filesystem::remove(probe, ec);
    return true;
}

std::optional<std::filesystem::path> portable_data_dir(
    const std::optional<std::filesystem::path>& portable) {
    if (portable && directory_writable(*portable)) {
        return portable;
    }
    return std::nullopt;
}

}  // namespace mfbe::platform
