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
    nlohmann::json inspect(const ReaderOcrOptions& ocr = {});
    /// Hands a password to the reader (an empty one cancels); answers as inspect() does, with
    /// {wrongPassword} after a wrong one.
    nlohmann::json password(const std::string& password);
    /// Reads every page; `progress(phase, done, total)` after each event (phase = "read",
    /// "ocrDetect", or "ocr"), returning false to cancel. "" when done, else the reason.
    /// `result` gets {kinds} (reconciled without double-counting pages) and, when done,
    /// {garbledShare, drawingsLeftOut, ocr?}; refusals populate {pages?, script?, suggestedLanguages?}.
    std::string read(const std::function<bool(const std::string&, int, int)>& progress,
                     nlohmann::json& result);
    /// Legacy 2-argument progress overload (maps all phases onto done/total).
    std::string read(const std::function<bool(int, int)>& progress, nlohmann::json& result);
    /// Asks the reader for a picture; its event (contracts/pdf-reader.md).
    nlohmann::json picture(const std::string& id, int page);
    /// Ends the reader and removes the folder; safe to call more than once.
    void end();

    const std::filesystem::path& folder() const { return folder_; }
    std::mutex& mutex() { return mutex_; }
    /// The ZIP archive the PDF came from (D21), empty for a PDF on its own: its FBDs are read from
    /// it.
    void set_archive(std::filesystem::path archive) { archive_ = std::move(archive); }
    const std::filesystem::path& archive() const { return archive_; }

private:
    nlohmann::json wait_open();
    std::string ended_reason() const;

    std::filesystem::path folder_;
    std::filesystem::path pdf_;
    int quality_;
    std::filesystem::path fonts_;
    std::filesystem::path archive_;
    std::unique_ptr<ReaderProcess> reader_;
    int pages_ = 0;
    bool done_ = false;
    std::mutex mutex_;
};

/// Removes import folders left behind by an editor that ended abruptly (DP-2), keeping `keep`.
void remove_stale_folders(const std::filesystem::path& root);

}  // namespace mfbe::pdf_import
