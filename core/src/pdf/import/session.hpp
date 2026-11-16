#pragma once
// Feature 016 (contracts/rpc-api.md, data-model.md "Import session"): one PDF import in the core -
// its private folder, its reader process, the password hand-over and the picture requests.

#include "pdf/import/reader_process.hpp"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>

namespace mfbe::pdf_import {

class Session {
public:
    Session(std::filesystem::path folder, std::filesystem::path pdf, int quality,
            std::filesystem::path fonts);
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    /// Starts the reader and waits until the PDF is open or a password is needed:
    /// {opened, pages} | {needsPassword} | {ownerPassword} | {failed: reason}.
    nlohmann::json inspect();
    /// Hands a password to the reader (an empty one cancels); answers as inspect() does, with
    /// {wrongPassword} after a wrong one.
    nlohmann::json password(const std::string& password);
    /// Reads every page; `progress(n, pages)` after each, returning false to cancel. "" when done,
    /// else the reason. `kinds` counts the pages of each kind.
    std::string read(const std::function<bool(int, int)>& progress, nlohmann::json& kinds);
    /// Asks the reader for a picture; its event (contracts/pdf-reader.md).
    nlohmann::json picture(const std::string& id, int page);
    /// Ends the reader and removes the folder; safe to call more than once.
    void end();

    const std::filesystem::path& folder() const { return folder_; }
    std::mutex& mutex() { return mutex_; }

private:
    nlohmann::json wait_open();
    std::string ended_reason() const;

    std::filesystem::path folder_;
    std::filesystem::path pdf_;
    int quality_;
    std::filesystem::path fonts_;
    std::unique_ptr<ReaderProcess> reader_;
    int pages_ = 0;
    bool done_ = false;
    std::mutex mutex_;
};

/// Removes import folders left behind by an editor that ended abruptly (DP-2), keeping `keep`.
void remove_stale_folders(const std::filesystem::path& root);

}  // namespace mfbe::pdf_import
