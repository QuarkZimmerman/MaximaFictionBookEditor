// Core runtime manager for Maxima Library Lookup Service v2 (feature 021, data-model.md §3).
// Owns encrypted token cache, process-lifetime verified fingerprints, server-side saveConfig test
// gate, Retry-After rate-limit cooldown, lazy HttpClient initialization, and a bounded 4-thread
// async worker pool for non-blocking lookup queries.
#pragma once

#include <mfbe/http_client.hpp>
#include <mfbe/maxima_lookup_client.hpp>
#include <mfbe/maxima_lookup_token_store.hpp>
#include <mfbe/rpc.hpp>
#include <mfbe/settings.hpp>

#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace mfbe::lookup {

struct MaximaLookupStatusSnapshot {
    bool enabled = false;
    std::string domain;
    bool has_token = false;
    bool token_readable = true;
    bool verified = false;
    std::string token_page_url;

    nlohmann::json to_json() const;
};

struct MaximaLookupRevealResult {
    std::string token;
    bool readable = true;
};

class MaximaLookupService {
public:
    MaximaLookupService(std::filesystem::path data_dir, std::filesystem::path resources_dir);
    ~MaximaLookupService();

    MaximaLookupService(const MaximaLookupService&) = delete;
    MaximaLookupService& operator=(const MaximaLookupService&) = delete;

    // Loads encrypted token from disk into memory and cross-checks `settings.maximaLibrary`.
    // If `enabled == true` but `verifiedFingerprint` does not match the decrypted token +
    // normalized domain (or token is unreadable), forces `maximaLibrary.enabled = false` in
    // `settings_store` so tampered/unreadable configurations never run silently. Never touches the
    // network or initializes libcurl.
    void sync_on_startup(settings::SettingsStore& settings_store);

    // Non-network status snapshot for `maximaLookup.status`.
    MaximaLookupStatusSnapshot status(const settings::SettingsStore& settings_store) const;

    // Returns decrypted plaintext token on explicit Settings reveal click; never logged.
    MaximaLookupRevealResult reveal_token() const;

    // Executes a cancellable `task: "verify"` test against `(domain, token)` without mutating
    // persisted settings or token storage. Records the verified fingerprint in memory on success.
    nlohmann::json run_verify_test(const nlohmann::json& params, rpc::JobControl& control);

    // Atomically validates domain & verified-fingerprint gate, updates encrypted token storage,
    // persists `settings.maximaLibrary`, and refreshes in-memory state. Throws
    // `settings::SettingsError` (mapped to RPC 1040) on validation/gate violation.
    struct SaveOutcome {
        settings::ApplyResult apply;
        MaximaLookupStatusSnapshot status;
    };
    SaveOutcome save_config(const nlohmann::json& params, settings::SettingsStore& settings_store);

    // Dispatches non-blocking `maximaLookup.search` on the bounded worker pool. Immediately
    // responds `{ok: false, code: "disabled"}` without initializing libcurl when disabled.
    void dispatch_search(const nlohmann::json& params, const settings::SettingsStore& settings_store,
                         std::function<void(nlohmann::json)> respond);

    // Dispatches non-blocking `maximaLookup.exists` on the bounded worker pool.
    void dispatch_exists(const nlohmann::json& params, const settings::SettingsStore& settings_store,
                         std::function<void(nlohmann::json)> respond);

    // Test hook: override DNS resolution (CURLOPT_RESOLVE) for HTTPS tests.
    void set_resolve_overrides(std::vector<std::string> entries);

    // Cancels active transfers and joins worker threads (called before net::global_cleanup_if_ran).
    void shutdown();

private:
    struct CachedTokenState {
        MaximaLookupTokenReadState state = MaximaLookupTokenReadState::absent;
        std::string token;
    };

    net::HttpClient& ensure_http_client();
    void ensure_workers_locked();
    void enqueue_work(std::function<void()> task);
    std::string next_correlation_id();
    bool is_fingerprint_verified_locked(std::string_view fp) const;
    void record_verified_fingerprint_locked(const std::string& fp);
    void apply_rate_limit_locked(std::optional<std::int64_t> retry_after_seconds);
    std::optional<std::int64_t> active_rate_limit_remaining_seconds_locked() const;
    bool resolve_active_credentials(const settings::SettingsStore& settings_store,
                                    std::string& normalized_domain_out, std::string& token_out,
                                    std::string& error_code_out, std::string& error_msg_out,
                                    std::optional<std::int64_t>& retry_after_out);

    MaximaLookupTokenStore token_store_;
    std::filesystem::path resources_dir_;

    mutable std::mutex mutex_;
    CachedTokenState cached_token_;
    // Bounded ring of verified SHA-256 fingerprints proven in this process (max 16).
    std::deque<std::string> verified_fingerprints_;
    std::chrono::steady_clock::time_point rate_limit_until_{};
    std::vector<std::string> resolve_overrides_;
    std::unique_ptr<net::HttpClient> http_client_;
    std::atomic<std::uint64_t> seq_{0};

    // Bounded worker pool (4 threads), lazily spawned on first enabled search/exists call so
    // disabled sessions allocate zero extra threads and zero curl state.
    std::mutex queue_mutex_;
    std::condition_variable queue_cv_;
    std::deque<std::function<void()>> queue_;
    std::vector<std::thread> workers_;
    bool workers_started_ = false;
    bool shutting_down_ = false;
    std::atomic<bool> cancel_all_{false};
};

}  // namespace mfbe::lookup
