// Internal: the AI assistant's state of one core (feature 005), shared by ai_handlers.cpp and
// test_handlers.cpp - the service list read lazily on the first ai.* call, the transport
// created on that same call (the HTTP client's one-time initialisation happens there, never at
// start-up), the test hooks' overrides (resolve entries, time-outs - instance members, so every
// core start begins with the Definitions' 20 s / 120 s) and the request record of
// test.aiRequests (rpc-api §5: never a body, a header, a key, the model or the answer).
#pragma once

#include <mfbe/ai_services.hpp>
#include <mfbe/ai_transport.hpp>

#include <nlohmann/json.hpp>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace mfbe::server {

// One ai.complete / ai.models / ai.test call for test.aiRequests (rpc-api §5).
struct AiRequestRecord {
    std::string at;  // ISO 8601 UTC
    std::string method;
    std::string target_kind;  // free | custom
    std::optional<std::string> service_id;
    std::optional<std::string> host;
    std::string outcome;  // ok | offline | timeout | tls | http | format | cancelled | refused
    std::optional<int> status;
    std::optional<std::string> reason;  // the 1200 reason for `refused`
    std::optional<std::int64_t> elapsed_ms;

    nlohmann::json to_json() const {
        nlohmann::json j{
            {"at", at}, {"method", method}, {"targetKind", target_kind}, {"outcome", outcome}};
        if (service_id) {
            j["serviceId"] = *service_id;
        }
        if (host) {
            j["host"] = *host;
        }
        if (status) {
            j["status"] = *status;
        }
        if (reason) {
            j["reason"] = *reason;
        }
        if (elapsed_ms) {
            j["elapsedMs"] = *elapsed_ms;
        }
        return j;
    }
};

class AiState {
public:
    // `resources_dir`: the install's bundled resources - the bundled service list lives there
    // (ai::kServicesFileName) and the transport takes its shipped CA bundle from it.
    AiState(std::filesystem::path resources_dir, ai::UserLayer user_layer)
        : resources_dir_(std::move(resources_dir)),
          bundled_file_(resources_dir_ / ai::kServicesFileName),
          user_layer_(std::move(user_layer)) {}

    // The first ai.* call of the core: reads the list and creates (initialises) the transport.
    // Idempotent and cheap afterwards.
    void touch() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!transport_) {
            transport_ = ai::make_transport(ai::TransportOptions{resources_dir_});
        }
        if (!services_) {
            services_ = std::make_shared<const ai::ServiceList>(
                ai::ServiceList::load(bundled_file_, user_layer_));
        }
    }

    // The list in effect (loaded on the first call).
    std::shared_ptr<const ai::ServiceList> services() {
        touch();
        std::lock_guard<std::mutex> lock(mutex_);
        return services_;
    }

    // Re-reads both files and replaces the list in effect; a job that already resolved its
    // entry keeps its own copy.
    std::shared_ptr<const ai::ServiceList> reload() {
        touch();
        auto list = std::make_shared<const ai::ServiceList>(
            ai::ServiceList::load(bundled_file_, user_layer_));
        std::lock_guard<std::mutex> lock(mutex_);
        services_ = list;
        return list;
    }

    bool loaded() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return services_ != nullptr;
    }

    ai::Transport& transport() {
        touch();
        std::lock_guard<std::mutex> lock(mutex_);
        return *transport_;
    }

    const std::filesystem::path& bundled_file() const { return bundled_file_; }
    const ai::UserLayer& user_layer() const { return user_layer_; }

    // The exchange limits and resolve entries in effect (test.setAiTimeouts /
    // test.setAiResolve replace them until the core exits).
    long connect_ms() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return connect_ms_;
    }
    long total_ms() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return total_ms_;
    }
    void set_timeouts(long connect_ms, long total_ms) {
        std::lock_guard<std::mutex> lock(mutex_);
        connect_ms_ = connect_ms;
        total_ms_ = total_ms;
    }
    std::vector<std::string> resolve_entries() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return resolve_entries_;
    }
    void set_resolve_entries(std::vector<std::string> entries) {
        std::lock_guard<std::mutex> lock(mutex_);
        resolve_entries_ = std::move(entries);
    }

    // The request record (test.aiRequests / test.resetAiRequests).
    void record(AiRequestRecord record) {
        std::lock_guard<std::mutex> lock(mutex_);
        records_.push_back(std::move(record));
    }
    std::vector<AiRequestRecord> records() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return records_;
    }
    void reset_records() {
        std::lock_guard<std::mutex> lock(mutex_);
        records_.clear();
    }

private:
    std::filesystem::path resources_dir_;
    std::filesystem::path bundled_file_;  // resources_dir_ / ai::kServicesFileName
    ai::UserLayer user_layer_;
    mutable std::mutex mutex_;
    std::shared_ptr<const ai::ServiceList> services_;
    std::unique_ptr<ai::Transport> transport_;
    long connect_ms_ = ai::kDefaultConnectMs;
    long total_ms_ = ai::kDefaultTotalMs;
    std::vector<std::string> resolve_entries_;
    std::vector<AiRequestRecord> records_;
};

}  // namespace mfbe::server
