#pragma once
// Feature 014 (contracts/print-service.md, tasks T011): the test hooks' print service. Requests
// wait until the journeys' fixture prints them with the test browser and uploads the bytes
// (test.printRequests, test.completePrint, PUT /test/print/{jobId}). Core-internal.

#include <mfbe/print_service.hpp>

#include <nlohmann/json.hpp>

#include <map>
#include <mutex>
#include <string>

namespace mfbe {

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
