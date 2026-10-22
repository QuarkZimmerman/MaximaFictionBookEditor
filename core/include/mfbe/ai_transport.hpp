// The seam between the `ai.*` jobs and the HTTP client (feature 005; rpc-api.md "Definitions":
// Outcome, Exchange limits, Request headers).
//
// The jobs of ai_handlers.cpp build an HttpRequest - the URL, exactly the contract's headers,
// the body, the time-outs and the resolve entries in effect - and read back an HttpOutcome in
// the contract's outcome vocabulary. The product binds `Transport` to the libcurl client
// (`net::HttpClient`, mfbe/http_client.hpp) in make_transport(); the Catch2 tests plug their
// own transport through set_transport_factory_for_tests() - a raw-socket loopback client against
// the in-process test server, or a scripted stub for the kinds a loopback server cannot produce.
// outcome_from_response() is the shared classification of a response that arrived (status,
// headers, body bytes) into an outcome.
#pragma once

#include <mfbe/rpc.hpp>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace mfbe::ai {

inline constexpr long kDefaultConnectMs = 20000;
inline constexpr long kDefaultTotalMs = 120000;
inline constexpr std::size_t kMaxRequestBytes = 8u * 1024u * 1024u;    // serialised JSON
inline constexpr std::size_t kMaxResponseBytes = 16u * 1024u * 1024u;  // over it -> format
inline constexpr std::size_t kMaxTextBytes = 64u * 1024u;              // `text` of a non-JSON body

struct HttpRequest {
    std::string method;  // "GET" | "POST"
    std::string url;     // <address>/chat/completions | <address>/models
    std::vector<std::pair<std::string, std::string>> headers;  // the Definitions' headers only
    std::string body;                                          // POST only
    long connect_ms = kDefaultConnectMs;
    long total_ms = kDefaultTotalMs;
    std::vector<std::string> resolve_entries;  // CURLOPT_RESOLVE "host:port:address"
};

// The IETF draft `ratelimit-*` headers, else `x-ratelimit-*-minute` (limit / remaining).
struct RateLimit {
    std::optional<std::int64_t> limit;
    std::optional<std::int64_t> remaining;
    std::optional<std::int64_t> reset_seconds;
    nlohmann::json to_json() const;
};

// The result of one exchange: `ok` for a 2xx whose body parsed as JSON, else one of the failure
// kinds (never an RpcError - a service failure is a result).
struct HttpOutcome {
    bool ok = false;
    std::string kind;  // offline | timeout | tls | http | format | cancelled (when !ok)
    std::optional<int> status;
    std::string message;                 // the transport's own English text; never for `http`
    std::optional<nlohmann::json> body;  // the parsed JSON body (ok; http when it parses)
    std::optional<std::string> text;     // the first 64 KiB of a non-JSON body (http, format)
    std::optional<double> retry_after_seconds;
    std::optional<RateLimit> rate_limit;
    std::int64_t elapsed_ms = 0;

    static HttpOutcome failure(std::string kind, std::string message, std::int64_t elapsed_ms);
    nlohmann::json to_json() const;  // the AiOutcome wire shape
};

// Classifies a response that arrived: a 2xx with a JSON body (a UTF-8 BOM skipped,
// Content-Type not consulted) -> ok; a 2xx otherwise -> format with status and text; any other
// status -> http with body or text; a body over kMaxResponseBytes -> format. Header names are
// matched case-insensitively; Retry-After (seconds or an HTTP date) and the rate-limit headers
// are forwarded on ok and http outcomes.
HttpOutcome outcome_from_response(int status, const std::map<std::string, std::string>& headers,
                                  std::string_view body_bytes, std::int64_t elapsed_ms);

// job.progress phases: connecting (0, 0), waiting (0, 0), receiving (bytes, total or 0).
using ProgressFn = std::function<void(const char* phase, std::int64_t done, std::int64_t total)>;

class Transport {
public:
    virtual ~Transport() = default;
    // Performs one exchange on the calling (job) thread; polls `control.cancelled()` and ends
    // the transfer within 100 ms of a cancel (the job then fails with 1090 as for every job).
    virtual HttpOutcome send(const HttpRequest& request, rpc::JobControl& control,
                             const ProgressFn& progress) = 0;
};

// The transport of the product (bound to the libcurl client) or, when a test installed one,
// the test's. Created on the first ai.* call of a core - never at start-up - which is also
// where the client's one-time global initialisation happens.
std::unique_ptr<Transport> make_transport();

using TransportFactory = std::function<std::unique_ptr<Transport>()>;
// Test hook: every later make_transport() asks `factory`; nullptr restores the product's.
void set_transport_factory_for_tests(TransportFactory factory);

}  // namespace mfbe::ai
