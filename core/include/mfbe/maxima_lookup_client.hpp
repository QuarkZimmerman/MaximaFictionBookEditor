// Maxima Library Lookup Service v2 HTTP client (feature 021, contracts/lookup-v2.md).
// Builds schema-bounded v2 JSON requests, dispatches them through mfbe::net::HttpClient with
// Authorization: Bearer <token> (no redirects, no cookies, TLS >= 1.2), verifies echoed correlation
// IDs, and maps all server/transport outcomes without ever logging or leaking tokens.
#pragma once

#include <mfbe/http_client.hpp>
#include <mfbe/rpc.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::lookup {

inline constexpr int kDefaultLookupPageSize = 30;
inline constexpr int kMaxLookupPageSize = 99;  // core asks pageSize + 1 <= 100 for exact hasMore
inline constexpr int kMaxLookupFirstRecord = 100000;
inline constexpr int kMaxLookupRecordsPerSearch = 100;
inline constexpr std::size_t kMaxLookupTextChars = 255;
inline constexpr std::size_t kMaxLookupFilterItems = 50;
inline constexpr long kLookupConnectTimeoutMs = 10000;
inline constexpr long kLookupTotalTimeoutMs = 15000;

struct MaximaLookupCallResult {
    bool ok = false;
    // Empty on ok; otherwise v2 code (unauthorized, invalid_token, account_disabled,
    // https_required, wrong_version, rate_limited, method_not_allowed, invalid_request,
    // server_error) or transport code (offline, timeout, tls, http, format, cancelled,
    // invalidDomain, httpsRequired, emptyToken, tokenUnreadable, disabled).
    std::string code;
    // Human-readable non-secret message (never contains the Bearer token).
    std::string message;
    std::optional<std::int64_t> retry_after_seconds;
    // Full parsed JSON answer on ok == true.
    nlohmann::json payload;
};

// Truncates a UTF-8 string cleanly at code-point boundaries to at most `max_codepoints`.
std::string truncate_utf8_codepoints(std::string_view input, std::size_t max_codepoints);

// True if `role` is one of the 8 v2 person roles.
bool is_valid_person_role(std::string_view role);

// Builds a schema-compliant v2 `task: "verify"` request JSON.
nlohmann::json build_verify_request(std::string_view correlation_id);

// Builds a schema-compliant v2 `task: "search"` request JSON from RPC `maximaLookup.search` params.
// Sets `out_page` and `out_page_size` (used to slice `pageSize + 1` back to `pageSize` for exact
// `hasMore`). Returns false and sets `err_reason` if params are malformed.
bool build_search_request(const nlohmann::json& rpc_params, std::string_view correlation_id,
                          nlohmann::json& out_body, int& out_page, int& out_page_size,
                          std::string& err_reason);

// Builds a schema-compliant v2 `task: "exists"` request JSON from RPC `maximaLookup.exists` params.
bool build_exists_request(const nlohmann::json& rpc_params, std::string_view correlation_id,
                          nlohmann::json& out_body, std::string& err_reason);

// Validates a raw HTTP/transport `AiOutcome` against the sent correlation `id` and maps it to a
// `MaximaLookupCallResult` (exposed for unit tests).
MaximaLookupCallResult interpret_v2_response(const net::AiOutcome& outcome,
                                             std::string_view expected_correlation_id);

class MaximaLookupClient {
public:
    explicit MaximaLookupClient(net::HttpClient& http_client);

    MaximaLookupCallResult execute(std::string_view normalized_domain,
                                   std::string_view plaintext_token,
                                   const nlohmann::json& request_body,
                                   std::string_view correlation_id, rpc::JobControl& control,
                                   const std::vector<std::string>& resolve_overrides = {},
                                   const net::ProgressFn& progress = {});

private:
    net::HttpClient& http_;
};

}  // namespace mfbe::lookup
