// Outbound HTTP client of the AI assistant (feature 005, T015; plan decision D1, research R1;
// rpc-api Definitions "Outcome", "Exchange limits", "Transport policy", "Request headers",
// "Proxy policy", "CA policy").
//
// The core sends the assistant's requests itself through libcurl, so that every journey runs
// headless against a local stand-in (constitution II) and the key never leaves the core
// (principle III). One exchange per call, on the calling job thread: one easy handle on a multi
// handle driven by curl_multi_perform / curl_multi_poll bounded at 50 ms, the job's cancel flag
// polled after every return - Stop reacts within 100 ms. Transport policy, never relaxed:
// no redirect is followed (a 3xx is an `http` outcome), certificate and host-name verification
// stay on, TLS 1.2 is the minimum, only `http` and `https` are reachable, proxies come from the
// environment only (loopback always direct), the request body is capped at 8 MiB and the
// response at 16 MiB. Service failures are results (AiOutcome), never RpcErrors: the router
// logs every RpcError and a service's own words must never reach the log (FR-100).
//
// libcurl is initialised lazily (global_init_once) on the first ai.* call - never at start-up
// (FR-094/FR-096) - and cleaned up at shutdown only when it ran.
#pragma once

#include <mfbe/rpc.hpp>

#include <nlohmann/json.hpp>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::net {

/* ----------------------------------------------------------------------------------------- */
/* Limits (rpc-api Definitions "Exchange limits")                                            */
/* ----------------------------------------------------------------------------------------- */

inline constexpr long kDefaultConnectMs = 20000;
inline constexpr long kDefaultTotalMs = 120000;
inline constexpr std::size_t kMaxRequestBytes = 8u << 20;    // serialised JSON, refused before
inline constexpr std::size_t kMaxResponseBytes = 16u << 20;  // over it -> `format`
inline constexpr std::size_t kMaxTextBytes = 64u << 10;      // `text` of a non-JSON body

/* ----------------------------------------------------------------------------------------- */
/* Lazy libcurl initialisation                                                                */
/* ----------------------------------------------------------------------------------------- */

// curl_global_init(CURL_GLOBAL_DEFAULT) on the first call of the process; later calls do
// nothing. Called by perform() and by the first ai.* handler - never at core start.
void global_init_once();
// True once global_init_once() ran (and until global_cleanup_if_ran()).
bool global_init_ran();
// curl_global_cleanup() when the initialisation ran; a later global_init_once() initialises
// again. Called by the core server at shutdown.
void global_cleanup_if_ran();

/* ----------------------------------------------------------------------------------------- */
/* Outcome (rpc-api Definitions "Outcome")                                                    */
/* ----------------------------------------------------------------------------------------- */

enum class OutcomeKind { ok, offline, timeout, tls, http, format, cancelled };

// The contract's name of a kind: "ok" | "offline" | "timeout" | "tls" | "http" | "format" |
// "cancelled".
std::string_view outcome_kind_name(OutcomeKind kind);

// The IETF draft `ratelimit-*` headers, else OVHcloud's `x-ratelimit-*-minute` pair (no
// reset); other header forms are not parsed in 0.0.5.
struct RateLimit {
    std::optional<std::int64_t> limit;
    std::optional<std::int64_t> remaining;
    std::optional<std::int64_t> reset_seconds;
};

struct AiOutcome {
    OutcomeKind kind = OutcomeKind::ok;
    // HTTP status: always on `ok` and `http`, on `format` when the answer arrived.
    std::optional<int> status;
    // The transport's own English text - libcurl's error buffer or the core's wording - on
    // offline | timeout | tls | format | cancelled; never on `http` (the service's words are in
    // `body` / `text`). May name the host, never the path, the headers or the body.
    std::string message;
    std::optional<nlohmann::json> body;  // the response body parsed as JSON (BOM skipped)
    std::optional<std::string> text;     // else its first 64 KiB, invalid bytes as U+FFFD
    std::optional<std::int64_t> retry_after_seconds;  // Retry-After (a date converted); absent
                                                      // when the header is absent or 0
    std::optional<RateLimit> rate_limit;
    std::int64_t elapsed_ms = 0;  // wall time from the start of the transfer to its end

    bool ok() const { return kind == OutcomeKind::ok; }
    // The wire shape of the contract: {ok: true, status, body, retryAfterSeconds?, rateLimit?,
    // elapsedMs} | {ok: false, kind, status?, message?, body?, text?, retryAfterSeconds?,
    // rateLimit?, elapsedMs}.
    nlohmann::json to_json() const;
};

/* ----------------------------------------------------------------------------------------- */
/* Request                                                                                    */
/* ----------------------------------------------------------------------------------------- */

struct HttpRequest {
    std::string method = "GET";  // "GET" | "POST" (anything else is invalidParams {field: method})
    std::string url;  // absolute http(s) URL (anything else is invalidParams {field: url})
    // The resolved key: `Authorization: Bearer <key>` is sent only when it is non-empty (an
    // empty `Bearer ` breaks LLM7). The other headers are fixed: Content-Type: application/json
    // (POST), Accept: application/json, User-Agent: MaximaFictionBookEditor/<version>, plus
    // libcurl's Accept-Encoding; no cookies, Referer or Origin.
    std::string key;
    std::string body;  // POST body (serialised JSON); over kMaxRequestBytes -> invalidParams
    long connect_ms = kDefaultConnectMs;  // CURLOPT_CONNECTTIMEOUT_MS
    long total_ms = kDefaultTotalMs;      // CURLOPT_TIMEOUT_MS
    // CURLOPT_RESOLVE entries "host:port:address" (the test hook test.setAiResolve).
    std::vector<std::string> resolve_entries;
};

// job.progress phases, each emitted once and in order: "connecting" (until the request is
// fully sent), "waiting" (no response header yet), "receiving" (done = bytes, total =
// Content-Length or 0).
using ProgressFn =
    std::function<void(const std::string& phase, std::int64_t done, std::int64_t total)>;

/* ----------------------------------------------------------------------------------------- */
/* Environment, proxies and CA selection (rpc-api "Proxy policy", "CA policy";              */
/* resource-formats §C "Run-time selection on Linux")                                        */
/* ----------------------------------------------------------------------------------------- */

// A variable of the environment; nullopt when unset. Injectable so that the selection below is
// a pure function of its arguments.
using EnvLookup = std::function<std::optional<std::string>(const char* name)>;
EnvLookup process_env();

// CURLOPT_NOPROXY: the environment's `no_proxy` / `NO_PROXY` merged with
// `localhost,127.0.0.1,::1` (setting the option replaces the variable, so the merge keeps the
// user's list), so that local model servers and the test stand-in are always reached directly.
std::string merged_no_proxy(const EnvLookup& env);

// Where the trust anchors come from.
enum class CaSource {
    ssl_cert_file,   // $SSL_CERT_FILE (Linux and macOS)
    curl_ca_bundle,  // $CURL_CA_BUNDLE (Linux)
    distribution,    // one of the distribution bundles under the probe root (Linux)
    shipped,         // <resources>/certs/cacert.pem (Linux)
    native,          // the operating system's store: Schannel (Windows), SecTrust (macOS)
    none             // Linux without any readable bundle: a TLS request is a `tls` outcome
};
// The platform rule to apply; the default is the running platform. A parameter so that the
// Linux order and the macOS/Windows rules are unit-tested everywhere.
enum class CaPlatform { linux_like, macos, windows };
CaPlatform current_ca_platform();

struct CaSelection {
    CaSource source = CaSource::none;
    // The chosen file for the file sources; for `none` the missing shipped bundle.
    std::filesystem::path path;
    // Environment variables that were set but named no readable regular file (skipped; the
    // client warns once per process with ai.caBundleMissing {path}).
    std::vector<std::filesystem::path> missing_env_files;
};

// A pure function of the environment and the file system: Windows -> native; macOS -> a
// readable $SSL_CERT_FILE, else native; Linux -> the first readable regular file of
// $SSL_CERT_FILE, $CURL_CA_BUNDLE, /etc/ssl/certs/ca-certificates.crt,
// /etc/pki/tls/certs/ca-bundle.crt, /etc/ssl/ca-bundle.pem, /etc/ssl/cert.pem (the four
// joined to `probe_root` when it is non-empty), <resources>/certs/cacert.pem; none -> `none`.
// The path compiled into libcurl is never consulted.
CaSelection select_ca_bundle(const EnvLookup& env, const std::filesystem::path& probe_root,
                             const std::filesystem::path& resources_dir,
                             CaPlatform platform = current_ca_platform());

// The CA file compiled into libcurl (CURLINFO_CAINFO of a fresh handle; nullopt when none),
// exposed so that a test can assert that it is never what the client uses.
std::optional<std::string> compiled_in_ca_info();

/* ----------------------------------------------------------------------------------------- */
/* Client                                                                                     */
/* ----------------------------------------------------------------------------------------- */

struct HttpClientOptions {
    std::filesystem::path resources_dir;  // the folder holding certs/cacert.pem
    std::filesystem::path probe_root;     // empty = the file system root (tests redirect it)
    EnvLookup env;                        // empty = process_env()
};

// Thread-safe: perform() may run on several job threads at once; every call owns its handles.
class HttpClient {
public:
    explicit HttpClient(HttpClientOptions options);
    ~HttpClient();
    HttpClient(const HttpClient&) = delete;
    HttpClient& operator=(const HttpClient&) = delete;

    // One exchange on the calling thread. `control.cancelled()` is polled every 50 ms: a
    // cancelled job ends within 100 ms with kind `cancelled` (the ai.* handler lets the job
    // machinery report it as job.failed 1090). Phases go through `progress`, else through
    // `control.progress`. Throws RpcError invalidParams for a caller's mistake only - a method
    // other than GET/POST, a URL that is not http(s), a body over 8 MiB - before anything is
    // sent; everything the network or the service does is an outcome.
    AiOutcome perform(const HttpRequest& request, rpc::JobControl& control,
                      const ProgressFn& progress = {});

    // Ends every running transfer with `cancelled` and refuses later ones (core shutdown).
    void shutdown();

private:
    HttpClientOptions options_;
    std::atomic<bool> shutting_down_{false};
};

}  // namespace mfbe::net
