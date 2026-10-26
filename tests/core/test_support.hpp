// Shared helpers for the core Catch2 tests (not a test file itself: no test_ prefix glob hit
// because the extension is .hpp).
#pragma once

#include <mfbe/rpc.hpp>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <optional>
#include <random>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

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

// The parts of a minimal valid FB2 2.1 book (feature 006's reader, writer and round-trip
// cases): `body` is the content of its one <body> (normally a <section>), `after_body` follows
// that body (a notes body, binaries), `annotation` is the content of the title-info's
// <annotation> (none when empty) and `book_title` the text of <book-title> (escaped XML).
struct BookParts {
    std::string body;
    std::string after_body;
    std::string annotation;
    std::string book_title = "Book";
};

// The book's text: the FB2 and xlink namespaces (prefix `l`) and the required description
// elements, so that it validates against the bundled schema whenever its parts do.
inline std::string book_text(const BookParts& parts) {
    std::string text =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">"
        "<description><title-info><genre>prose_classic</genre><author><first-name>Ann</first-name>"
        "<last-name>Writer</last-name></author><book-title>" +
        parts.book_title + "</book-title>";
    if (!parts.annotation.empty()) {
        text += "<annotation>" + parts.annotation + "</annotation>";
    }
    text +=
        "<lang>en</lang></title-info><document-info><author><nickname>fixture</nickname>"
        "</author><date>2026</date><id>feature-006-test</id><version>1.0</version>"
        "</document-info></description><body>" +
        parts.body + "</body>" + parts.after_body + "</FictionBook>\n";
    return text;
}

// `book_text` with a body only.
inline std::string minimal_book(const std::string& body, const std::string& after_body = "") {
    BookParts parts;
    parts.body = body;
    parts.after_body = after_body;
    return book_text(parts);
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

// Sets an environment variable (or unsets it with nullopt) for the lifetime of the guard and
// restores the previous state afterwards. Feature 005: the HTTP client reads proxies and the
// CA bundle override from the environment, libcurl itself reads `http_proxy` & co.
class EnvGuard {
public:
    EnvGuard(std::string name, std::optional<std::string> value) : name_(std::move(name)) {
        if (const char* current = std::getenv(name_.c_str())) {
            previous_ = std::string(current);
        }
        apply(name_, value);
    }
    ~EnvGuard() { apply(name_, previous_); }
    EnvGuard(const EnvGuard&) = delete;
    EnvGuard& operator=(const EnvGuard&) = delete;

private:
    static void apply(const std::string& name, const std::optional<std::string>& value) {
#ifdef _WIN32
        _putenv_s(name.c_str(), value ? value->c_str() : "");
#else
        if (value) {
            ::setenv(name.c_str(), value->c_str(), 1);
        } else {
            ::unsetenv(name.c_str());
        }
#endif
    }

    std::string name_;
    std::optional<std::string> previous_;
};

// `auto guard = with_env("SSL_CERT_FILE", path);` - the variable is restored when the guard
// goes out of scope; nullopt unsets it for the scope.
[[nodiscard]] inline EnvGuard with_env(std::string name, std::optional<std::string> value) {
    return EnvGuard(std::move(name), std::move(value));
}

// A JobControl for calling a job function directly on the test thread: `cancel()` raises the
// flag the function polls; progress reports are recorded.
class ManualJobControl : public rpc::JobControl {
public:
    struct Progress {
        std::string phase;
        std::int64_t done = 0;
        std::int64_t total = 0;
    };

    explicit ManualJobControl(std::string id = "j-test") : id_(std::move(id)) {}

    const std::string& id() const override { return id_; }
    bool cancelled() const override { return cancelled_.load(); }
    void progress(const std::string& phase, std::int64_t done, std::int64_t total) override {
        std::lock_guard<std::mutex> lock(mutex_);
        reports_.push_back(Progress{phase, done, total});
    }

    void cancel() { cancelled_.store(true); }
    std::vector<Progress> reports() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return reports_;
    }
    std::vector<std::string> phases() const {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<std::string> out;
        for (const auto& report : reports_) {
            out.push_back(report.phase);
        }
        return out;
    }

private:
    std::string id_;
    std::atomic<bool> cancelled_{false};
    mutable std::mutex mutex_;
    std::vector<Progress> reports_;
};

}  // namespace mfbe::test
