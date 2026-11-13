// Feature 014 (contracts/print-service.md, tasks T011): the print requests the journeys answer.

#include <mfbe/print_service.hpp>

#include <fstream>
#include <utility>

namespace mfbe {

void QueuedPrintService::print(const PrintRequest& request, PrintDone done) {
    std::lock_guard lock(mutex_);
    pending_.emplace("print-" + std::to_string(next_++), Pending{request, std::move(done)});
}

void QueuedPrintService::cancel() {
    std::map<std::string, Pending> cancelled;
    {
        std::lock_guard lock(mutex_);
        cancelled.swap(pending_);
    }
    for (auto& [id, pending] : cancelled)
        pending.done(false, "cancelled");
}

nlohmann::json QueuedPrintService::requests() const {
    std::lock_guard lock(mutex_);
    nlohmann::json out = nlohmann::json::array();
    for (const auto& [id, pending] : pending_) {
        out.push_back({{"jobId", id},
                       {"url", pending.request.url},
                       {"paperWidthIn", pending.request.paper_width_in},
                       {"paperHeightIn", pending.request.paper_height_in},
                       {"tagged", true}});
    }
    return out;
}

bool QueuedPrintService::complete(const std::string& job_id, const std::string& bytes) {
    Pending pending;
    {
        std::lock_guard lock(mutex_);
        const auto it = pending_.find(job_id);
        if (it == pending_.end())
            return false;
        pending = std::move(it->second);
        pending_.erase(it);
    }
    std::ofstream out(pending.request.out, std::ios::binary | std::ios::trunc);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    out.close();
    if (!out) {
        pending.done(false, "the printed file could not be written");
    } else {
        pending.done(true, "");
    }
    return true;
}

bool QueuedPrintService::fail(const std::string& job_id, const std::string& message) {
    Pending pending;
    {
        std::lock_guard lock(mutex_);
        const auto it = pending_.find(job_id);
        if (it == pending_.end())
            return false;
        pending = std::move(it->second);
        pending_.erase(it);
    }
    pending.done(false, message);
    return true;
}

}  // namespace mfbe
