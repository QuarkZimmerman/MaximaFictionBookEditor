// libcurl-based HTTP client of the AI assistant (feature 005, T015). See http_client.hpp for
// the policy; research R1 for the measurements behind the multi handle (an easy-handle
// callback cancels in ~1 s, the 50 ms poll bound in ≤ 100 ms) and the Linux CA pitfall (a
// configured CA file that does not exist fails every transfer with CURLE_SSL_CACERT_BADFILE,
// so the path is chosen at run time, never compiled in).
#include <mfbe/http_client.hpp>
#include <mfbe/log.hpp>
#include <mfbe/unicode.hpp>
#include <mfbe/utf8_paths.hpp>
#include <mfbe/version.hpp>

#include <algorithm>
#include <cctype>
#include <charconv>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <curl/curl.h>
#include <fstream>
#include <mutex>
#include <set>
#include <system_error>
#include <utility>

namespace mfbe::net {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;
using Clock = std::chrono::steady_clock;

/* ----------------------------------------------------------------------------------------- */
/* Global initialisation                                                                      */
/* ----------------------------------------------------------------------------------------- */

std::mutex g_init_mutex;
bool g_init_ran = false;

/* ----------------------------------------------------------------------------------------- */
/* Small helpers                                                                              */
/* ----------------------------------------------------------------------------------------- */

std::string lower(std::string_view in) {
    std::string out(in);
    for (auto& c : out) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return out;
}

std::string_view trim(std::string_view text) {
    while (!text.empty() && (text.front() == ' ' || text.front() == '\t' || text.front() == '\r' ||
                             text.front() == '\n')) {
        text.remove_prefix(1);
    }
    while (!text.empty() && (text.back() == ' ' || text.back() == '\t' || text.back() == '\r' ||
                             text.back() == '\n')) {
        text.remove_suffix(1);
    }
    return text;
}

bool starts_with_ci(std::string_view text, std::string_view prefix) {
    if (text.size() < prefix.size()) {
        return false;
    }
    for (std::size_t i = 0; i < prefix.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(text[i])) !=
            std::tolower(static_cast<unsigned char>(prefix[i]))) {
            return false;
        }
    }
    return true;
}

// The leading non-negative integer of a header value ("100", "100, 100;w=60", " 7 ");
// nullopt when the value does not start with digits.
std::optional<std::int64_t> leading_integer(std::string_view value) {
    value = trim(value);
    std::size_t digits = 0;
    while (digits < value.size() && std::isdigit(static_cast<unsigned char>(value[digits]))) {
        ++digits;
    }
    if (digits == 0 || digits > 18) {
        return std::nullopt;
    }
    std::int64_t result = 0;
    const auto [ptr, ec] = std::from_chars(value.data(), value.data() + digits, result);
    if (ec != std::errc()) {
        return std::nullopt;
    }
    return result;
}

bool readable_regular_file(const fs::path& path) {
    std::error_code ec;
    if (path.empty() || !fs::is_regular_file(path, ec)) {
        return false;
    }
    std::ifstream in(path, std::ios::binary);
    return in.good();
}

// The response body as the contract wants it: JSON when it parses (a UTF-8 BOM skipped), else
// the first 64 KiB as text with invalid bytes replaced by U+FFFD.
std::optional<json> parse_json_body(std::string_view body) {
    if (body.size() >= 3 && static_cast<unsigned char>(body[0]) == 0xEF &&
        static_cast<unsigned char>(body[1]) == 0xBB &&
        static_cast<unsigned char>(body[2]) == 0xBF) {
        body.remove_prefix(3);
    }
    if (trim(body).empty()) {
        return std::nullopt;
    }
    json parsed = json::parse(body.begin(), body.end(), nullptr, false);
    if (parsed.is_discarded()) {
        return std::nullopt;
    }
    return parsed;
}

std::string text_of_body(std::string_view body) {
    if (body.size() > kMaxTextBytes) {
        body = body.substr(0, kMaxTextBytes);
    }
    if (unicode::is_valid_utf8(body)) {
        return std::string(body);
    }
    std::string out;
    out.reserve(body.size());
    for (const char32_t cp : unicode::decode_utf8(body)) {
        unicode::append_utf8(out, cp);
    }
    return out;
}

// One warning per path per process for an environment variable naming no readable bundle.
void warn_missing_env_bundle(const fs::path& path) {
    static std::mutex mutex;
    static std::set<std::string> warned;
    const std::string text = platform::utf8_from_path(path);
    std::lock_guard<std::mutex> lock(mutex);
    if (warned.insert(text).second) {
        log::warning("core", "ai.caBundleMissing",
                     "the CA bundle named by the environment is not a readable file",
                     log::extras({{"path", text}}));
    }
}

/* ----------------------------------------------------------------------------------------- */
/* One transfer                                                                              */
/* ----------------------------------------------------------------------------------------- */

enum class Phase { none, connecting, waiting, receiving };

struct Transfer {
    const HttpRequest* request = nullptr;
    const ProgressFn* progress = nullptr;
    rpc::JobControl* control = nullptr;
    const std::atomic<bool>* shutting_down = nullptr;

    std::string response;
    std::vector<std::pair<std::string, std::string>> headers;  // lower-case names
    std::size_t sent = 0;                                      // request body bytes handed over
    long interim_status = 0;                                   // of the header block being read
    std::int64_t content_length = 0;
    bool over_cap = false;
    Phase phase = Phase::none;

    // Emits `target` and every phase skipped before it, each once and in order.
    void emit(Phase target) {
        static const char* const kNames[] = {"", "connecting", "waiting", "receiving"};
        while (phase < target) {
            phase = static_cast<Phase>(static_cast<int>(phase) + 1);
            const std::string name = kNames[static_cast<int>(phase)];
            const std::int64_t done = 0;
            const std::int64_t total = phase == Phase::receiving ? content_length : 0;
            if (progress != nullptr && *progress) {
                (*progress)(name, done, total);
            } else if (control != nullptr) {
                control->progress(name, done, total);
            }
        }
    }
};

std::size_t on_body(char* data, std::size_t size, std::size_t count, void* userdata) {
    auto* transfer = static_cast<Transfer*>(userdata);
    const std::size_t bytes = size * count;
    if (transfer->response.size() + bytes > kMaxResponseBytes) {
        transfer->over_cap = true;
        return 0;  // CURLE_WRITE_ERROR -> `format`
    }
    transfer->response.append(data, bytes);
    return bytes;
}

std::size_t on_header(char* data, std::size_t size, std::size_t count, void* userdata) {
    auto* transfer = static_cast<Transfer*>(userdata);
    const std::size_t bytes = size * count;
    const std::string_view line(data, bytes);
    if (starts_with_ci(line, "HTTP/")) {
        // Status line: a new header block (an interim 1xx is skipped below).
        const std::size_t space = line.find(' ');
        transfer->interim_status =
            space == std::string_view::npos
                ? 0
                : static_cast<long>(leading_integer(line.substr(space + 1)).value_or(0));
        transfer->headers.clear();
        transfer->content_length = 0;
        return bytes;
    }
    if (trim(line).empty()) {
        // End of a header block: the final answer is being received.
        if (transfer->interim_status >= 200) {
            transfer->emit(Phase::receiving);
        }
        return bytes;
    }
    const std::size_t colon = line.find(':');
    if (colon == std::string_view::npos) {
        return bytes;
    }
    std::string name = lower(trim(line.substr(0, colon)));
    const std::string value(trim(line.substr(colon + 1)));
    if (name == "content-length") {
        transfer->content_length = leading_integer(value).value_or(0);
    }
    transfer->headers.emplace_back(std::move(name), value);
    return bytes;
}

std::size_t on_read(char* buffer, std::size_t size, std::size_t count, void* userdata) {
    auto* transfer = static_cast<Transfer*>(userdata);
    const std::string& body = transfer->request->body;
    const std::size_t room = size * count;
    const std::size_t left = body.size() - transfer->sent;
    const std::size_t chunk = std::min(room, left);
    if (chunk > 0) {
        std::memcpy(buffer, body.data() + transfer->sent, chunk);
        transfer->sent += chunk;
    }
    if (transfer->sent >= body.size()) {
        transfer->emit(Phase::waiting);  // the request is fully handed over
    }
    return chunk;
}

int on_connected(void* userdata, char*, char*, int, int) {
    auto* transfer = static_cast<Transfer*>(userdata);
    if (transfer->shutting_down != nullptr && transfer->shutting_down->load()) {
        return CURL_PREREQFUNC_ABORT;
    }
    if (transfer->request->body.empty() || transfer->request->method != "POST") {
        transfer->emit(Phase::waiting);  // a GET goes out as soon as the connection is up
    }
    return CURL_PREREQFUNC_OK;
}

struct SlistGuard {
    curl_slist* list = nullptr;
    ~SlistGuard() { curl_slist_free_all(list); }
    void add(const std::string& line) { list = curl_slist_append(list, line.c_str()); }
};

OutcomeKind kind_of(CURLcode code, const Transfer& transfer) {
    switch (code) {
        case CURLE_OK:
            return OutcomeKind::ok;
        case CURLE_COULDNT_RESOLVE_HOST:
        case CURLE_COULDNT_RESOLVE_PROXY:
        case CURLE_COULDNT_CONNECT:
            return OutcomeKind::offline;
        case CURLE_OPERATION_TIMEDOUT:
            return OutcomeKind::timeout;
        case CURLE_SSL_CONNECT_ERROR:
        case CURLE_PEER_FAILED_VERIFICATION:
        case CURLE_SSL_ENGINE_NOTFOUND:
        case CURLE_SSL_ENGINE_SETFAILED:
        case CURLE_SSL_CERTPROBLEM:
        case CURLE_SSL_CIPHER:
        case CURLE_SSL_CACERT_BADFILE:
        case CURLE_SSL_SHUTDOWN_FAILED:
        case CURLE_SSL_CRL_BADFILE:
        case CURLE_SSL_ISSUER_ERROR:
        case CURLE_SSL_PINNEDPUBKEYNOTMATCH:
        case CURLE_SSL_INVALIDCERTSTATUS:
        case CURLE_SSL_CLIENTCERT:
            return OutcomeKind::tls;
        case CURLE_WRITE_ERROR:
            return transfer.over_cap ? OutcomeKind::format : OutcomeKind::offline;
        case CURLE_FILESIZE_EXCEEDED:
            return OutcomeKind::format;
        case CURLE_ABORTED_BY_CALLBACK:
            return OutcomeKind::cancelled;
        default:
            // A dropped connection (CURLE_GOT_NOTHING, CURLE_RECV_ERROR, CURLE_SEND_ERROR,
            // CURLE_PARTIAL_FILE), an unreachable proxy and every other transport failure:
            // the service could not be reached or the connection was lost.
            return OutcomeKind::offline;
    }
}

std::optional<RateLimit> rate_limit_of(
    const std::vector<std::pair<std::string, std::string>>& headers) {
    const auto find = [&](std::string_view name) -> std::optional<std::int64_t> {
        for (const auto& [key, value] : headers) {
            if (key == name) {
                return leading_integer(value);
            }
        }
        return std::nullopt;
    };
    RateLimit limit;
    limit.limit = find("ratelimit-limit");
    limit.remaining = find("ratelimit-remaining");
    limit.reset_seconds = find("ratelimit-reset");
    if (!limit.limit && !limit.remaining && !limit.reset_seconds) {
        limit.limit = find("x-ratelimit-limit-minute");
        limit.remaining = find("x-ratelimit-remaining-minute");
    }
    if (!limit.limit && !limit.remaining && !limit.reset_seconds) {
        return std::nullopt;
    }
    return limit;
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Global initialisation                                                                      */
/* ----------------------------------------------------------------------------------------- */

void global_init_once() {
    std::lock_guard<std::mutex> lock(g_init_mutex);
    if (!g_init_ran) {
        curl_global_init(CURL_GLOBAL_DEFAULT);
        g_init_ran = true;
    }
}

bool global_init_ran() {
    std::lock_guard<std::mutex> lock(g_init_mutex);
    return g_init_ran;
}

void global_cleanup_if_ran() {
    std::lock_guard<std::mutex> lock(g_init_mutex);
    if (g_init_ran) {
        curl_global_cleanup();
        g_init_ran = false;
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Outcome                                                                                    */
/* ----------------------------------------------------------------------------------------- */

std::string_view outcome_kind_name(OutcomeKind kind) {
    switch (kind) {
        case OutcomeKind::ok:
            return "ok";
        case OutcomeKind::offline:
            return "offline";
        case OutcomeKind::timeout:
            return "timeout";
        case OutcomeKind::tls:
            return "tls";
        case OutcomeKind::http:
            return "http";
        case OutcomeKind::format:
            return "format";
        case OutcomeKind::cancelled:
            return "cancelled";
    }
    return "offline";
}

json AiOutcome::to_json() const {
    json out = json::object();
    out["ok"] = ok();
    if (!ok()) {
        out["kind"] = std::string(outcome_kind_name(kind));
        if (kind != OutcomeKind::http) {
            out["message"] = message;
        }
    }
    if (status) {
        out["status"] = *status;
    }
    if (body) {
        out["body"] = *body;
    }
    if (text) {
        out["text"] = *text;
    }
    if (retry_after_seconds) {
        out["retryAfterSeconds"] = *retry_after_seconds;
    }
    if (rate_limit) {
        json limit = json::object();
        if (rate_limit->limit) {
            limit["limit"] = *rate_limit->limit;
        }
        if (rate_limit->remaining) {
            limit["remaining"] = *rate_limit->remaining;
        }
        if (rate_limit->reset_seconds) {
            limit["resetSeconds"] = *rate_limit->reset_seconds;
        }
        out["rateLimit"] = std::move(limit);
    }
    out["elapsedMs"] = elapsed_ms;
    return out;
}

/* ----------------------------------------------------------------------------------------- */
/* Environment, proxies, CA selection                                                        */
/* ----------------------------------------------------------------------------------------- */

EnvLookup process_env() {
    return [](const char* name) -> std::optional<std::string> {
        const char* value = std::getenv(name);
        if (value == nullptr) {
            return std::nullopt;
        }
        return std::string(value);
    };
}

std::string merged_no_proxy(const EnvLookup& env) {
    static constexpr std::string_view kLoopback = "localhost,127.0.0.1,::1";
    std::string own;
    for (const char* name : {"no_proxy", "NO_PROXY"}) {
        std::optional<std::string> value;
        if (env) {
            value = env(name);
        }
        if (value && !trim(*value).empty()) {
            own = std::string(trim(*value));
            break;
        }
    }
    if (own.empty()) {
        return std::string(kLoopback);
    }
    if (own == "*") {
        return own;  // "everything direct" - libcurl honours the asterisk only on its own
    }
    return own + "," + std::string(kLoopback);
}

CaPlatform current_ca_platform() {
#if defined(_WIN32)
    return CaPlatform::windows;
#elif defined(__APPLE__)
    return CaPlatform::macos;
#else
    return CaPlatform::linux_like;
#endif
}

CaSelection select_ca_bundle(const EnvLookup& env, const fs::path& probe_root,
                             const fs::path& resources_dir, CaPlatform platform) {
    CaSelection out;
    if (platform == CaPlatform::windows) {
        out.source = CaSource::native;
        return out;
    }
    const auto env_file = [&](const char* name, CaSource source) {
        std::optional<std::string> value;
        if (env) {
            value = env(name);
        }
        if (!value || trim(*value).empty()) {
            return false;
        }
        fs::path path = platform::path_from_utf8(trim(*value));
        if (readable_regular_file(path)) {
            out.source = source;
            out.path = std::move(path);
            return true;
        }
        out.missing_env_files.push_back(std::move(path));
        return false;
    };
    if (env_file("SSL_CERT_FILE", CaSource::ssl_cert_file)) {
        return out;
    }
    if (platform == CaPlatform::macos) {
        out.source = CaSource::native;
        return out;
    }
    if (env_file("CURL_CA_BUNDLE", CaSource::curl_ca_bundle)) {
        return out;
    }
    static constexpr const char* kDistributionBundles[] = {
        "/etc/ssl/certs/ca-certificates.crt",  // Debian, Ubuntu, Arch, Alpine
        "/etc/pki/tls/certs/ca-bundle.crt",    // Fedora, RHEL, CentOS
        "/etc/ssl/ca-bundle.pem",              // openSUSE
        "/etc/ssl/cert.pem",
    };
    for (const char* bundle : kDistributionBundles) {
        fs::path path = probe_root.empty() ? platform::path_from_utf8(bundle)
                                           : probe_root / platform::path_from_utf8(bundle + 1);
        if (readable_regular_file(path)) {
            out.source = CaSource::distribution;
            out.path = std::move(path);
            return out;
        }
    }
    fs::path shipped = resources_dir / "certs" / "cacert.pem";
    out.source = readable_regular_file(shipped) ? CaSource::shipped : CaSource::none;
    out.path = std::move(shipped);
    return out;
}

std::optional<std::string> compiled_in_ca_info() {
    global_init_once();
    CURL* easy = curl_easy_init();
    if (easy == nullptr) {
        return std::nullopt;
    }
    char* path = nullptr;
    std::optional<std::string> out;
    if (curl_easy_getinfo(easy, CURLINFO_CAINFO, &path) == CURLE_OK && path != nullptr &&
        *path != '\0') {
        out = std::string(path);
    }
    curl_easy_cleanup(easy);
    return out;
}

/* ----------------------------------------------------------------------------------------- */
/* Client                                                                                     */
/* ----------------------------------------------------------------------------------------- */

HttpClient::HttpClient(HttpClientOptions options) : options_(std::move(options)) {
    if (!options_.env) {
        options_.env = process_env();
    }
}

HttpClient::~HttpClient() = default;

void HttpClient::shutdown() {
    shutting_down_.store(true);
}

AiOutcome HttpClient::perform(const HttpRequest& request, rpc::JobControl& control,
                              const ProgressFn& progress) {
    // The caller's mistakes - never the service's - are RpcErrors, raised before anything goes
    // out. The ai.* handlers validate the address themselves; this is the last line.
    if (request.method != "GET" && request.method != "POST") {
        throw rpc::invalid_params("method must be GET or POST", json{{"field", "method"}});
    }
    const bool https = starts_with_ci(request.url, "https://");
    if (!https && !starts_with_ci(request.url, "http://")) {
        throw rpc::invalid_params("url must be an http or https URL", json{{"field", "url"}});
    }
    if (request.body.size() > kMaxRequestBytes) {
        throw rpc::invalid_params("request body over 8 MiB", json{{"field", "body"}});
    }
    if (request.method == "GET" && !request.body.empty()) {
        throw rpc::invalid_params("a GET carries no body", json{{"field", "body"}});
    }

    const auto started = Clock::now();
    AiOutcome outcome;
    const auto finish = [&](OutcomeKind kind, std::string message) -> AiOutcome {
        outcome.kind = kind;
        outcome.message = std::move(message);
        outcome.elapsed_ms =
            std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count();
        return std::move(outcome);
    };
    if (shutting_down_.load() || control.cancelled()) {
        return finish(OutcomeKind::cancelled, "transfer cancelled");
    }

    // Trust anchors (rpc-api "CA policy"): chosen now, per request, so that an environment
    // change or an installed bundle is seen without a restart.
    CaSelection ca;
    if (https) {
        ca = select_ca_bundle(options_.env, options_.probe_root, options_.resources_dir);
        for (const auto& missing : ca.missing_env_files) {
            warn_missing_env_bundle(missing);
        }
        if (ca.source == CaSource::none) {
            return finish(OutcomeKind::tls,
                          "CA bundle not found: " + platform::utf8_from_path(ca.path));
        }
    }

    global_init_once();
    CURL* easy = curl_easy_init();
    CURLM* multi = curl_multi_init();
    if (easy == nullptr || multi == nullptr) {
        if (easy != nullptr) {
            curl_easy_cleanup(easy);
        }
        if (multi != nullptr) {
            curl_multi_cleanup(multi);
        }
        return finish(OutcomeKind::offline, "libcurl could not create a transfer handle");
    }

    Transfer transfer;
    transfer.request = &request;
    transfer.progress = &progress;
    transfer.control = &control;
    transfer.shutting_down = &shutting_down_;
    char error_buffer[CURL_ERROR_SIZE] = {};

    // Transport policy - fixed, no option below is ever relaxed.
    curl_easy_setopt(easy, CURLOPT_URL, request.url.c_str());
    curl_easy_setopt(easy, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(easy, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(easy, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(easy, CURLOPT_CONNECTTIMEOUT_MS,
                     request.connect_ms > 0 ? request.connect_ms : kDefaultConnectMs);
    curl_easy_setopt(easy, CURLOPT_TIMEOUT_MS,
                     request.total_ms > 0 ? request.total_ms : kDefaultTotalMs);
    curl_easy_setopt(easy, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(easy, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(easy, CURLOPT_SSLVERSION, static_cast<long>(CURL_SSLVERSION_TLSv1_2));
    curl_easy_setopt(easy, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(easy, CURLOPT_MAXFILESIZE_LARGE, static_cast<curl_off_t>(kMaxResponseBytes));
    curl_easy_setopt(easy, CURLOPT_ERRORBUFFER, error_buffer);
    curl_easy_setopt(easy, CURLOPT_WRITEFUNCTION, on_body);
    curl_easy_setopt(easy, CURLOPT_WRITEDATA, &transfer);
    curl_easy_setopt(easy, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(easy, CURLOPT_HEADERDATA, &transfer);
    curl_easy_setopt(easy, CURLOPT_PREREQFUNCTION, on_connected);
    curl_easy_setopt(easy, CURLOPT_PREREQDATA, &transfer);

    // Proxies from the environment only; loopback always direct.
    const std::string no_proxy = merged_no_proxy(options_.env);
    curl_easy_setopt(easy, CURLOPT_NOPROXY, no_proxy.c_str());

    // CA policy per platform.
    const char* const no_path = nullptr;
    std::string ca_file;
#if defined(_WIN32)
    (void)no_path;
    curl_easy_setopt(easy, CURLOPT_SSL_OPTIONS, static_cast<long>(CURLSSLOPT_REVOKE_BEST_EFFORT));
#elif defined(__APPLE__)
    curl_easy_setopt(easy, CURLOPT_SSL_OPTIONS, static_cast<long>(CURLSSLOPT_NATIVE_CA));
    if (ca.source == CaSource::ssl_cert_file) {
        ca_file = platform::utf8_from_path(ca.path);
        curl_easy_setopt(easy, CURLOPT_CAINFO, ca_file.c_str());
    } else {
        curl_easy_setopt(easy, CURLOPT_CAINFO, no_path);
    }
    curl_easy_setopt(easy, CURLOPT_CAPATH, no_path);
#else
    if (https) {
        ca_file = platform::utf8_from_path(ca.path);
        curl_easy_setopt(easy, CURLOPT_CAINFO, ca_file.c_str());
    }
    curl_easy_setopt(easy, CURLOPT_CAPATH, no_path);
#endif

    // Exactly the contract's headers. `Expect:` empty keeps libcurl from adding
    // `Expect: 100-continue` to large bodies (it is not sent as a header).
    SlistGuard headers;
    if (request.method == "POST") {
        headers.add("Content-Type: application/json");
    }
    headers.add("Accept: application/json");
    headers.add(std::string("User-Agent: MaximaFictionBookEditor/") + version::kVersion);
    if (!request.key.empty()) {
        headers.add("Authorization: Bearer " + request.key);
    }
    headers.add("Expect:");
    curl_easy_setopt(easy, CURLOPT_HTTPHEADER, headers.list);

    if (request.method == "POST") {
        curl_easy_setopt(easy, CURLOPT_POST, 1L);
        curl_easy_setopt(easy, CURLOPT_READFUNCTION, on_read);
        curl_easy_setopt(easy, CURLOPT_READDATA, &transfer);
        curl_easy_setopt(easy, CURLOPT_POSTFIELDSIZE_LARGE,
                         static_cast<curl_off_t>(request.body.size()));
    } else {
        curl_easy_setopt(easy, CURLOPT_HTTPGET, 1L);
    }

    SlistGuard resolve;
    for (const auto& entry : request.resolve_entries) {
        resolve.add(entry);
    }
    if (resolve.list != nullptr) {
        curl_easy_setopt(easy, CURLOPT_RESOLVE, resolve.list);
    }

    // The transfer: multi handle, poll bounded at 50 ms, the cancel flag after every return.
    transfer.emit(Phase::connecting);
    curl_multi_add_handle(multi, easy);
    int running = 0;
    CURLMcode multi_code = CURLM_OK;
    bool aborted = false;
    do {
        multi_code = curl_multi_perform(multi, &running);
        if (multi_code == CURLM_OK && running > 0) {
            multi_code = curl_multi_poll(multi, nullptr, 0, 50, nullptr);
        }
        if (multi_code != CURLM_OK) {
            break;
        }
        if (running > 0 && (control.cancelled() || shutting_down_.load())) {
            aborted = true;
            break;
        }
    } while (running > 0);

    CURLcode result = CURLE_OK;
    bool have_result = false;
    if (!aborted && multi_code == CURLM_OK) {
        int queued = 0;
        while (CURLMsg* message = curl_multi_info_read(multi, &queued)) {
            if (message->msg == CURLMSG_DONE && message->easy_handle == easy) {
                result = message->data.result;
                have_result = true;
            }
        }
    }

    long status_code = 0;
    curl_easy_getinfo(easy, CURLINFO_RESPONSE_CODE, &status_code);
    curl_off_t retry_after = 0;
    curl_easy_getinfo(easy, CURLINFO_RETRY_AFTER, &retry_after);

    curl_multi_remove_handle(multi, easy);
    curl_easy_cleanup(easy);
    curl_multi_cleanup(multi);

    if (aborted) {
        return finish(OutcomeKind::cancelled, "transfer cancelled");
    }
    if (multi_code != CURLM_OK) {
        return finish(OutcomeKind::offline, curl_multi_strerror(multi_code));
    }
    if (!have_result) {
        return finish(OutcomeKind::offline, "libcurl reported no result for the transfer");
    }

    // Limit headers travel with every outcome that has headers (a 200, a 429, a 402, a 503).
    if (retry_after > 0) {
        outcome.retry_after_seconds = static_cast<std::int64_t>(retry_after);
    }
    outcome.rate_limit = rate_limit_of(transfer.headers);
    if (status_code > 0) {
        outcome.status = static_cast<int>(status_code);
    }

    const OutcomeKind kind = kind_of(result, transfer);
    if (kind == OutcomeKind::ok) {
        std::optional<json> parsed = parse_json_body(transfer.response);
        if (status_code >= 200 && status_code < 300) {
            if (parsed) {
                outcome.body = std::move(parsed);
                return finish(OutcomeKind::ok, "");
            }
            outcome.text = text_of_body(transfer.response);
            return finish(OutcomeKind::format, "response is not JSON");
        }
        if (parsed) {
            outcome.body = std::move(parsed);
        } else {
            outcome.text = text_of_body(transfer.response);
        }
        return finish(OutcomeKind::http, "");
    }
    if (kind == OutcomeKind::format) {
        return finish(OutcomeKind::format, "response larger than 16 MiB");
    }
    std::string message = error_buffer[0] != '\0' ? error_buffer : curl_easy_strerror(result);
    return finish(kind, std::move(message));
}

}  // namespace mfbe::net
