// Shared helpers for the core Catch2 tests (not a test file itself: no test_ prefix glob hit
// because the extension is .hpp).
#pragma once

#include <chrono>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>
#include <system_error>

namespace mfbe::test {

inline std::filesystem::path fixtures_dir() {
    return std::filesystem::path(MFBE_TEST_FIXTURES_DIR);
}

inline std::string read_text(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

inline void write_text(const std::filesystem::path& path, const std::string& text) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
}

// The build tree (CMAKE_BINARY_DIR): where the tests keep generated inputs that are worth
// reusing between runs (the 10 MB book of the memory checks, as the @perf journeys do).
inline std::filesystem::path build_dir() {
    return std::filesystem::path(MFBE_TEST_BUILD_DIR);
}

// Resets the process's peak resident set size to its current value, so that the growth of the
// next operation can be read from platform::peak_resident_memory_bytes() (Linux: "5" written to
// /proc/self/clear_refs). False where the kernel offers no reset: the caller then compares peaks
// that only ever grow.
inline bool reset_peak_resident_memory() {
#ifdef __linux__
    std::ofstream out("/proc/self/clear_refs");
    if (!out) {
        return false;
    }
    out << "5";
    return static_cast<bool>(out);
#else
    return false;
#endif
}

// Unique temporary directory removed on destruction.
class TempDir {
public:
    explicit TempDir(const std::string& prefix = "mfbe-test") {
        std::random_device rd;
        const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
        path_ = std::filesystem::temp_directory_path() /
                (prefix + "-" + std::to_string(stamp) + "-" + std::to_string(rd() % 100000));
        std::filesystem::create_directories(path_);
    }
    ~TempDir() {
        std::error_code ec;
        std::filesystem::remove_all(path_, ec);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    const std::filesystem::path& path() const { return path_; }
    std::filesystem::path operator/(const std::string& name) const { return path_ / name; }

private:
    std::filesystem::path path_;
};

}  // namespace mfbe::test
