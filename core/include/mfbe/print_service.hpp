#pragma once
// Feature 014 (contracts/print-service.md, tasks T011): the core asks the shell to print the PDF
// export's paged document, as it asks for native dialogs (mfbe/dialog_provider.hpp). The shell's
// implementation prints in a hidden browser of its own (app/src/print_service_cef.*); under
// --test-hooks a QueuedPrintService keeps the request until the journeys' fixture prints it with
// the test browser and uploads the bytes (test.printRequests, PUT /test/print/{jobId}).

#include <nlohmann/json.hpp>

#include <filesystem>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace mfbe {

struct PrintRequest {
    std::string url;            // the core's /pdf/{token}/print/{n} address, with the session token
    double paper_width_in = 0;  // the page size of D3, exactly, in inches
    double paper_height_in = 0;
    std::filesystem::path out;  // where the printed PDF goes (a temporary file of the core)
};

/// Called once per request, on any thread: ok, or the reason it failed ("cancelled" when
/// cancelled).
using PrintDone = std::function<void(bool ok, const std::string& message)>;

class PrintService {
public:
    virtual ~PrintService() = default;
    virtual void print(const PrintRequest& request, PrintDone done) = 0;
    /// Stops the printing under way; its done(false, "cancelled") follows.
    virtual void cancel() = 0;
};

/// The test hooks' service: requests wait until test.completePrint or the upload answers them.
class QueuedPrintService final : public PrintService {
public:
    void print(const PrintRequest& request, PrintDone done) override;
    void cancel() override;

    /// The pending requests: [{ jobId, url, paperWidthIn, paperHeightIn, tagged }].
    nlohmann::json requests() const;
    /// Writes the printed bytes to the request's file and reports success; false for an unknown id.
    bool complete(const std::string& job_id, const std::string& bytes);
    /// Reports the request as failed with `message`; false for an unknown id.
    bool fail(const std::string& job_id, const std::string& message);

private:
    struct Pending {
        PrintRequest request;
        PrintDone done;
    };
    mutable std::mutex mutex_;
    std::map<std::string, Pending> pending_;
    unsigned next_ = 1;
};

}  // namespace mfbe
