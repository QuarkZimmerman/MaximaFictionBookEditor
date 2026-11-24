#pragma once
// Feature 016 (PD2, DP-2 to DP-4, contracts/pdf-reader.md): the core's side of mfbe-pdf-reader. One
// reader per import: started with the PDF's path and the import's folder, a password handed to its
// standard input, its events read line by line from its standard output. A crash, a hang or a
// memory overrun ends only the reader; the reader dies with its parent.

#include <chrono>
#include <cstddef>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace mfbe::pdf_import {

struct ReaderOcrOptions {
    bool enabled = false;
    bool auto_detect = true;
    std::vector<std::string> languages;
    std::vector<std::filesystem::path> dirs;
    int threads = 1;
};

struct ReaderOptions {
    std::filesystem::path reader;
    std::filesystem::path pdf;
    std::filesystem::path folder;
    std::size_t max_memory_mb = 1024;
    int quality = 85;
    std::filesystem::path fonts;
    std::chrono::milliseconds silence_timeout{30000};
    ReaderOcrOptions ocr;
    std::vector<std::string> extra_args;
};

/// How the reader ended.
enum class ReaderEnd { running, exited, crashed, timed_out, over_memory, killed };

class ReaderProcess {
public:
    /// Starts the reader; nullptr with `error` set when it cannot be started.
    static std::unique_ptr<ReaderProcess> start(const ReaderOptions& options, std::string& error);
    ~ReaderProcess();
    ReaderProcess(const ReaderProcess&) = delete;
    ReaderProcess& operator=(const ReaderProcess&) = delete;

    /// The next event line, waiting at most `wait`. False when none came: the reader ended (see
    /// end()), or the wait ran out while it still runs (end() == running).
    bool next_event(std::string& line, std::chrono::milliseconds wait);
    /// Writes one line to the reader's standard input (a password; an empty line means Cancel).
    bool send_line(const std::string& line);
    /// Ends the reader at once; safe to call more than once.
    void kill();
    /// The watchdog's silence limit; lifted once the reader is done and only answers requests.
    void set_silence_timeout(std::chrono::milliseconds timeout);
    ReaderEnd end() const { return end_; }
    int exit_code() const { return exit_code_; }

    struct Impl;

private:
    explicit ReaderProcess(std::unique_ptr<Impl> impl);
    void reap(bool wait);
    void check_limits();
    std::unique_ptr<Impl> impl_;
    ReaderEnd end_ = ReaderEnd::running;
    int exit_code_ = -1;
};

/// Where the reader is: $MFBE_PDF_READER, next to this executable, in the macOS bundle's Helpers,
/// or the build's own bin folder. Empty when none exists.
std::filesystem::path find_reader();

}  // namespace mfbe::pdf_import
