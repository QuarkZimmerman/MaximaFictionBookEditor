#include <mfbe/maxima_lookup_service.hpp>
#include <mfbe/maxima_lookup_url.hpp>

#include <algorithm>

namespace mfbe::lookup {

namespace {

using nlohmann::json;

constexpr std::size_t kMaxVerifiedFingerprints = 16;
constexpr std::size_t kLookupWorkerCount = 4;

// Minimal JobControl adapter for worker-pool search/exists calls; cancelled on service shutdown.
struct ShutdownJobControl : rpc::JobControl {
    std::atomic<bool>& cancelled_flag;
    std::string job_id = "lookup-worker";
    explicit ShutdownJobControl(std::atomic<bool>& flag) : cancelled_flag(flag) {}
    const std::string& id() const override { return job_id; }
    bool cancelled() const override { return cancelled_flag.load(std::memory_order_acquire); }
    void progress(const std::string&, std::int64_t, std::int64_t) override {}
};

std::string normalize_domain_or_default(std::string_view raw) {
    const auto check = normalize_and_validate_domain(raw);
    if (check.ok) {
        return check.normalized_domain;
    }
    return std::string(kDefaultMaximaLibraryDomain);
}

}  // namespace

json MaximaLookupStatusSnapshot::to_json() const {
    return json{
        {"enabled", enabled},    {"domain", domain},
        {"hasToken", has_token}, {"tokenReadable", token_readable},
        {"verified", verified},  {"tokenPageUrl", token_page_url},
    };
}

MaximaLookupService::MaximaLookupService(std::filesystem::path data_dir,
                                         std::filesystem::path resources_dir)
    : token_store_(std::move(data_dir)), resources_dir_(std::move(resources_dir)) {}

MaximaLookupService::~MaximaLookupService() {
    shutdown();
}

void MaximaLookupService::sync_on_startup(settings::SettingsStore& settings_store) {
    const MaximaLookupTokenReadResult loaded = token_store_.load();
    const std::string stored_domain =
        settings_store.get_string("maximaLibrary.domain", std::string(kDefaultMaximaLibraryDomain));
    const auto domain_check = normalize_and_validate_domain(stored_domain);
    const std::string stored_fp =
        settings_store.get_string("maximaLibrary.verifiedFingerprint", "");
    const bool stored_enabled = settings_store.get_bool("maximaLibrary.enabled", false);

    bool matches = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        cached_token_.state = loaded.state;
        cached_token_.token = loaded.token;
        if (loaded.state == MaximaLookupTokenReadState::ok && !loaded.token.empty() &&
            domain_check.ok && is_valid_fingerprint_hex(stored_fp)) {
            const std::string expected =
                compute_verified_fingerprint(domain_check.normalized_domain, loaded.token);
            if (stored_fp == expected) {
                matches = true;
                record_verified_fingerprint_locked(expected);
            }
        }
    }

    if (stored_enabled && !matches) {
        // Strip tampered or unreadable enabled flag safely without touching token file or network.
        try {
            settings_store.apply_patch(
                json{{"maximaLibrary", {{"enabled", false}, {"verifiedFingerprint", ""}}}});
        } catch (const settings::SettingsError&) {
            // Best-effort guard; runtime credential resolution still blocks unverified configs.
        }
    }
}

MaximaLookupStatusSnapshot MaximaLookupService::status(
    const settings::SettingsStore& settings_store) const {
    MaximaLookupStatusSnapshot out;
    const std::string raw_domain =
        settings_store.get_string("maximaLibrary.domain", std::string(kDefaultMaximaLibraryDomain));
    out.domain = normalize_domain_or_default(raw_domain);
    out.token_page_url = build_token_page_url(out.domain);
    const std::string stored_fp =
        settings_store.get_string("maximaLibrary.verifiedFingerprint", "");
    const bool stored_enabled = settings_store.get_bool("maximaLibrary.enabled", false);

    std::lock_guard<std::mutex> lock(mutex_);
    out.has_token =
        (cached_token_.state == MaximaLookupTokenReadState::ok && !cached_token_.token.empty()) ||
        (cached_token_.state == MaximaLookupTokenReadState::unreadable);
    out.token_readable = cached_token_.state != MaximaLookupTokenReadState::unreadable;
    if (cached_token_.state == MaximaLookupTokenReadState::ok && !cached_token_.token.empty() &&
        is_valid_fingerprint_hex(stored_fp)) {
        const std::string expected = compute_verified_fingerprint(out.domain, cached_token_.token);
        out.verified = (stored_fp == expected);
    } else {
        out.verified = false;
    }
    out.enabled = stored_enabled && out.verified;
    return out;
}

MaximaLookupRevealResult MaximaLookupService::reveal_token() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (cached_token_.state == MaximaLookupTokenReadState::unreadable) {
        return MaximaLookupRevealResult{"", false};
    }
    if (cached_token_.state == MaximaLookupTokenReadState::ok) {
        return MaximaLookupRevealResult{cached_token_.token, true};
    }
    return MaximaLookupRevealResult{"", true};
}

net::HttpClient& MaximaLookupService::ensure_http_client() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!http_client_) {
        net::HttpClientOptions opts;
        opts.resources_dir = resources_dir_;
        http_client_ = std::make_unique<net::HttpClient>(std::move(opts));
    }
    return *http_client_;
}

std::string MaximaLookupService::next_correlation_id() {
    const std::uint64_t n = seq_.fetch_add(1, std::memory_order_relaxed) + 1;
    return "mfbe-" + std::to_string(n);
}

bool MaximaLookupService::is_fingerprint_verified_locked(std::string_view fp) const {
    return std::find(verified_fingerprints_.begin(), verified_fingerprints_.end(), fp) !=
           verified_fingerprints_.end();
}

void MaximaLookupService::record_verified_fingerprint_locked(const std::string& fp) {
    if (fp.empty()) {
        return;
    }
    auto it = std::find(verified_fingerprints_.begin(), verified_fingerprints_.end(), fp);
    if (it != verified_fingerprints_.end()) {
        verified_fingerprints_.erase(it);
    }
    verified_fingerprints_.push_back(fp);
    while (verified_fingerprints_.size() > kMaxVerifiedFingerprints) {
        verified_fingerprints_.pop_front();
    }
}

void MaximaLookupService::apply_rate_limit_locked(std::optional<std::int64_t> retry_after_seconds) {
    if (retry_after_seconds.has_value() && *retry_after_seconds > 0) {
        const auto clamped = std::min<std::int64_t>(*retry_after_seconds, 3600);
        const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(clamped);
        if (until > rate_limit_until_) {
            rate_limit_until_ = until;
        }
    }
}

std::optional<std::int64_t> MaximaLookupService::active_rate_limit_remaining_seconds_locked()
    const {
    const auto now = std::chrono::steady_clock::now();
    if (rate_limit_until_ <= now) {
        return std::nullopt;
    }
    const auto rem_ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(rate_limit_until_ - now).count();
    const std::int64_t sec = (rem_ms + 999) / 1000;
    return std::max<std::int64_t>(1, sec);
}

json MaximaLookupService::run_verify_test(const json& params, rpc::JobControl& control) {
    const std::string raw_domain = params.value("domain", std::string{});
    const auto domain_check = normalize_and_validate_domain(raw_domain);
    if (!domain_check.ok) {
        return json{{"ok", false},
                    {"code", domain_check.code},
                    {"message", domain_check.code == "httpsRequired"
                                    ? "HTTPS is required for remote Maxima Library domains"
                                    : "Invalid Maxima Library domain"}};
    }

    const bool use_stored = params.value("useStoredToken", false);
    std::string effective_token;
    std::vector<std::string> overrides;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        overrides = resolve_overrides_;
        if (use_stored) {
            if (cached_token_.state == MaximaLookupTokenReadState::unreadable) {
                return json{{"ok", false},
                            {"code", "tokenUnreadable"},
                            {"message", "Saved access token could not be decrypted"}};
            }
            effective_token = cached_token_.token;
        } else if (params.contains("token") && params["token"].is_string()) {
            effective_token = params["token"].get<std::string>();
        }
    }

    if (effective_token.empty()) {
        return json{{"ok", false}, {"code", "emptyToken"}, {"message", "Access token is empty"}};
    }

    const std::string corr_id = next_correlation_id();
    const json req_body = build_verify_request(corr_id);
    MaximaLookupClient client(ensure_http_client());
    const MaximaLookupCallResult call = client.execute(
        domain_check.normalized_domain, effective_token, req_body, corr_id, control, overrides);

    if (call.code == "cancelled" || control.cancelled()) {
        throw rpc::RpcError(rpc::codes::kCancelled, "cancelled");
    }

    if (!call.ok) {
        json out{{"ok", false},
                 {"code", call.code},
                 {"message", call.message},
                 {"normalizedDomain", domain_check.normalized_domain}};
        if (call.retry_after_seconds.has_value()) {
            out["retryAfterSeconds"] = *call.retry_after_seconds;
        }
        return out;
    }

    const std::string fp =
        compute_verified_fingerprint(domain_check.normalized_domain, effective_token);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        record_verified_fingerprint_locked(fp);
        rate_limit_until_ = {};
    }

    return json{{"ok", true},
                {"code", ""},
                {"message", ""},
                {"verifiedFingerprint", fp},
                {"normalizedDomain", domain_check.normalized_domain}};
}

MaximaLookupService::SaveOutcome MaximaLookupService::save_config(
    const json& params, settings::SettingsStore& settings_store) {
    if (!params.is_object() || !params.contains("enabled") || !params["enabled"].is_boolean() ||
        !params.contains("domain") || !params["domain"].is_string()) {
        throw settings::SettingsError("maximaLibrary",
                                      "expected enabled (bool) and domain (string)");
    }

    const bool want_enabled = params["enabled"].get<bool>();
    const auto domain_check = normalize_and_validate_domain(params["domain"].get<std::string>());
    if (!domain_check.ok) {
        throw settings::SettingsError("maximaLibrary.domain", domain_check.code);
    }

    const bool use_stored = params.value("useStoredToken", false);
    const bool clear_token = params.value("clearToken", false);
    const bool has_new_token =
        !use_stored && !clear_token && params.contains("token") && params["token"].is_string();
    const std::string provided_token = has_new_token ? params["token"].get<std::string>() : "";

    std::string effective_token;
    bool effective_token_readable = true;
    std::string fp_to_save;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (clear_token) {
            effective_token.clear();
        } else if (use_stored) {
            if (cached_token_.state == MaximaLookupTokenReadState::unreadable) {
                effective_token_readable = false;
            } else if (cached_token_.state == MaximaLookupTokenReadState::ok) {
                effective_token = cached_token_.token;
            }
        } else if (has_new_token) {
            effective_token = provided_token;
        } else if (cached_token_.state == MaximaLookupTokenReadState::ok) {
            effective_token = cached_token_.token;
        }

        if (want_enabled) {
            if (!effective_token_readable || effective_token.empty()) {
                throw settings::SettingsError("maximaLibrary.enabled", "notVerified");
            }
            const std::string candidate_fp =
                compute_verified_fingerprint(domain_check.normalized_domain, effective_token);
            const std::string saved_fp =
                settings_store.get_string("maximaLibrary.verifiedFingerprint", "");
            const bool already_saved_verified =
                cached_token_.state == MaximaLookupTokenReadState::ok &&
                cached_token_.token == effective_token && saved_fp == candidate_fp;
            if (!is_fingerprint_verified_locked(candidate_fp) && !already_saved_verified) {
                throw settings::SettingsError("maximaLibrary.enabled", "notVerified");
            }
            fp_to_save = candidate_fp;
            record_verified_fingerprint_locked(candidate_fp);
        } else {
            // Disabled: preserve verified fingerprint only if the effective (domain, token) pair
            // still matches an already-verified fingerprint.
            if (effective_token_readable && !effective_token.empty()) {
                const std::string candidate_fp =
                    compute_verified_fingerprint(domain_check.normalized_domain, effective_token);
                const std::string saved_fp =
                    settings_store.get_string("maximaLibrary.verifiedFingerprint", "");
                if (saved_fp == candidate_fp || is_fingerprint_verified_locked(candidate_fp)) {
                    fp_to_save = candidate_fp;
                }
            }
        }
    }

    // Persist encrypted token store before settings.json so settings.json never points to an
    // unsaved token.
    if (clear_token) {
        if (!token_store_.remove()) {
            throw settings::SettingsError("maximaLibrary.token", "failed to clear token");
        }
        std::lock_guard<std::mutex> lock(mutex_);
        cached_token_.state = MaximaLookupTokenReadState::absent;
        cached_token_.token.clear();
    } else if (has_new_token) {
        if (provided_token.empty()) {
            if (!token_store_.remove()) {
                throw settings::SettingsError("maximaLibrary.token", "failed to clear token");
            }
            std::lock_guard<std::mutex> lock(mutex_);
            cached_token_.state = MaximaLookupTokenReadState::absent;
            cached_token_.token.clear();
        } else {
            if (!token_store_.save(provided_token)) {
                throw settings::SettingsError("maximaLibrary.token",
                                              "failed to save encrypted token");
            }
            std::lock_guard<std::mutex> lock(mutex_);
            cached_token_.state = MaximaLookupTokenReadState::ok;
            cached_token_.token = provided_token;
        }
    }

    const settings::ApplyResult applied = settings_store.apply_patch(json{
        {"maximaLibrary",
         {{"enabled", want_enabled},
          {"domain", domain_check.normalized_domain},
          {"verifiedFingerprint", fp_to_save}}},
    });

    SaveOutcome outcome;
    outcome.apply = applied;
    outcome.status = status(settings_store);
    return outcome;
}

bool MaximaLookupService::resolve_active_credentials(const settings::SettingsStore& settings_store,
                                                     std::string& normalized_domain_out,
                                                     std::string& token_out,
                                                     std::string& error_code_out,
                                                     std::string& error_msg_out,
                                                     std::optional<std::int64_t>& retry_after_out) {
    const bool enabled = settings_store.get_bool("maximaLibrary.enabled", false);
    if (!enabled) {
        error_code_out = "disabled";
        error_msg_out = "Maxima Library integration is disabled";
        return false;
    }

    const std::string raw_domain =
        settings_store.get_string("maximaLibrary.domain", std::string(kDefaultMaximaLibraryDomain));
    const auto domain_check = normalize_and_validate_domain(raw_domain);
    if (!domain_check.ok) {
        error_code_out = domain_check.code;
        error_msg_out = "Invalid Maxima Library domain";
        return false;
    }

    const std::string stored_fp =
        settings_store.get_string("maximaLibrary.verifiedFingerprint", "");
    std::lock_guard<std::mutex> lock(mutex_);
    if (cached_token_.state == MaximaLookupTokenReadState::unreadable) {
        error_code_out = "tokenUnreadable";
        error_msg_out = "Saved access token could not be decrypted";
        return false;
    }
    if (cached_token_.state != MaximaLookupTokenReadState::ok || cached_token_.token.empty()) {
        error_code_out = "emptyToken";
        error_msg_out = "Access token is not configured";
        return false;
    }
    const std::string expected_fp =
        compute_verified_fingerprint(domain_check.normalized_domain, cached_token_.token);
    if (stored_fp != expected_fp) {
        error_code_out = "disabled";
        error_msg_out = "Maxima Library integration requires verification";
        return false;
    }

    if (const auto remaining = active_rate_limit_remaining_seconds_locked()) {
        error_code_out = "rate_limited";
        error_msg_out = "Rate limit cooldown active";
        retry_after_out = remaining;
        return false;
    }

    normalized_domain_out = domain_check.normalized_domain;
    token_out = cached_token_.token;
    return true;
}

void MaximaLookupService::ensure_workers_locked() {
    if (workers_started_ || shutting_down_) {
        return;
    }
    workers_started_ = true;
    workers_.reserve(kLookupWorkerCount);
    for (std::size_t i = 0; i < kLookupWorkerCount; ++i) {
        workers_.emplace_back([this]() {
            while (true) {
                std::function<void()> task;
                {
                    std::unique_lock<std::mutex> lock(queue_mutex_);
                    queue_cv_.wait(lock, [this]() { return shutting_down_ || !queue_.empty(); });
                    if (shutting_down_ && queue_.empty()) {
                        return;
                    }
                    task = std::move(queue_.front());
                    queue_.pop_front();
                }
                if (task) {
                    task();
                }
            }
        });
    }
}

void MaximaLookupService::enqueue_work(std::function<void()> task) {
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        if (shutting_down_) {
            return;
        }
        ensure_workers_locked();
        queue_.push_back(std::move(task));
    }
    queue_cv_.notify_one();
}

void MaximaLookupService::dispatch_search(const json& params,
                                          const settings::SettingsStore& settings_store,
                                          std::function<void(json)> respond) {
    std::string domain;
    std::string token;
    std::string err_code;
    std::string err_msg;
    std::optional<std::int64_t> retry_after;
    if (!resolve_active_credentials(settings_store, domain, token, err_code, err_msg,
                                    retry_after)) {
        json res{{"ok", false}, {"code", err_code}, {"message", err_msg}};
        if (retry_after.has_value()) {
            res["retryAfterSeconds"] = *retry_after;
        }
        respond(std::move(res));
        return;
    }

    const std::string corr_id = next_correlation_id();
    json req_body;
    int page = 0;
    int page_size = kDefaultLookupPageSize;
    std::string build_err;
    if (!build_search_request(params, corr_id, req_body, page, page_size, build_err)) {
        respond(json{{"ok", false}, {"code", "invalid_request"}, {"message", build_err}});
        return;
    }

    std::vector<std::string> overrides;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        overrides = resolve_overrides_;
    }

    enqueue_work([this, domain = std::move(domain), token = std::move(token),
                  req_body = std::move(req_body), corr_id, page, page_size,
                  overrides = std::move(overrides), respond = std::move(respond)]() {
        ShutdownJobControl control(cancel_all_);
        MaximaLookupClient client(ensure_http_client());
        const MaximaLookupCallResult call =
            client.execute(domain, token, req_body, corr_id, control, overrides);
        if (!call.ok) {
            if (call.code == "rate_limited") {
                std::lock_guard<std::mutex> lock(mutex_);
                apply_rate_limit_locked(call.retry_after_seconds);
            }
            json out{{"ok", false}, {"code", call.code}, {"message", call.message}};
            if (call.retry_after_seconds.has_value()) {
                out["retryAfterSeconds"] = *call.retry_after_seconds;
            }
            respond(std::move(out));
            return;
        }

        if (!call.payload.contains("items") || !call.payload["items"].is_array()) {
            respond(json{{"ok", false},
                         {"code", "format"},
                         {"message", "Missing items array in lookup search answer"}});
            return;
        }
        json items = call.payload["items"];
        const bool has_more = static_cast<int>(items.size()) > page_size;
        if (has_more) {
            items.erase(items.begin() + page_size, items.end());
        }
        respond(
            json{{"ok", true}, {"page", page}, {"hasMore", has_more}, {"items", std::move(items)}});
    });
}

void MaximaLookupService::dispatch_exists(const json& params,
                                          const settings::SettingsStore& settings_store,
                                          std::function<void(json)> respond) {
    std::string domain;
    std::string token;
    std::string err_code;
    std::string err_msg;
    std::optional<std::int64_t> retry_after;
    if (!resolve_active_credentials(settings_store, domain, token, err_code, err_msg,
                                    retry_after)) {
        json res{{"ok", false}, {"code", err_code}, {"message", err_msg}};
        if (retry_after.has_value()) {
            res["retryAfterSeconds"] = *retry_after;
        }
        respond(std::move(res));
        return;
    }

    const std::string kind = params.value("kind", std::string{});
    const std::string corr_id = next_correlation_id();
    json req_body;
    std::string build_err;
    if (!build_exists_request(params, corr_id, req_body, build_err)) {
        respond(json{{"ok", false}, {"code", "invalid_request"}, {"message", build_err}});
        return;
    }

    std::vector<std::string> overrides;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        overrides = resolve_overrides_;
    }

    enqueue_work([this, domain = std::move(domain), token = std::move(token), kind,
                  req_body = std::move(req_body), corr_id, overrides = std::move(overrides),
                  respond = std::move(respond)]() {
        ShutdownJobControl control(cancel_all_);
        MaximaLookupClient client(ensure_http_client());
        const MaximaLookupCallResult call =
            client.execute(domain, token, req_body, corr_id, control, overrides);
        if (!call.ok) {
            if (call.code == "rate_limited") {
                std::lock_guard<std::mutex> lock(mutex_);
                apply_rate_limit_locked(call.retry_after_seconds);
            }
            json out{{"ok", false}, {"code", call.code}, {"message", call.message}};
            if (call.retry_after_seconds.has_value()) {
                out["retryAfterSeconds"] = *call.retry_after_seconds;
            }
            respond(std::move(out));
            return;
        }

        if (kind == "person" || kind == "authorSeries") {
            if (!call.payload.contains("matchedIds") || !call.payload["matchedIds"].is_array()) {
                respond(json{{"ok", false},
                             {"code", "format"},
                             {"message", "Missing matchedIds in lookup exists answer"}});
                return;
            }
            respond(json{{"ok", true}, {"kind", kind}, {"matchedIds", call.payload["matchedIds"]}});
            return;
        }

        if (!call.payload.contains("items") || !call.payload["items"].is_array()) {
            respond(json{{"ok", false},
                         {"code", "format"},
                         {"message", "Missing items in lookup exists answer"}});
            return;
        }
        respond(json{{"ok", true}, {"kind", kind}, {"items", call.payload["items"]}});
    });
}

void MaximaLookupService::set_resolve_overrides(std::vector<std::string> entries) {
    std::lock_guard<std::mutex> lock(mutex_);
    resolve_overrides_ = std::move(entries);
}

void MaximaLookupService::shutdown() {
    cancel_all_.store(true, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (http_client_) {
            http_client_->shutdown();
        }
    }
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        shutting_down_ = true;
        queue_.clear();
    }
    queue_cv_.notify_all();
    for (auto& t : workers_) {
        if (t.joinable()) {
            t.join();
        }
    }
    workers_.clear();
}

}  // namespace mfbe::lookup
