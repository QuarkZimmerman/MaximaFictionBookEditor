// The ai.* transport seam (feature 005). See mfbe/ai_transport.hpp.
#include <mfbe/ai_transport.hpp>
#include <mfbe/http_client.hpp>
#include <mfbe/unicode.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <utility>

namespace mfbe::ai {
namespace {

using json = nlohmann::json;

std::string lower(std::string_view text) {
    std::string out(text);
    for (auto& c : out) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return out;
}

// The value of `name` whatever the case the server used; nullopt when absent.
std::optional<std::string> header(const std::map<std::string, std::string>& headers,
                                  std::string_view name) {
    const std::string wanted = lower(name);
    for (const auto& [key, value] : headers) {
        if (lower(key) == wanted) {
            return value;
        }
    }
    return std::nullopt;
}

std::optional<std::int64_t> integer_header(const std::map<std::string, std::string>& headers,
                                           std::string_view name) {
    const auto value = header(headers, name);
    if (!value) {
        return std::nullopt;
    }
    std::string text = *value;
    text.erase(0, text.find_first_not_of(" \t"));
    if (text.empty() || !std::isdigit(static_cast<unsigned char>(text.front()))) {
        return std::nullopt;
    }
    char* end = nullptr;
    const long long parsed = std::strtoll(text.c_str(), &end, 10);
    return parsed < 0 ? std::nullopt : std::optional<std::int64_t>(parsed);
}

// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's days_from_civil).
std::int64_t days_from_civil(int y, unsigned m, unsigned d) {
    y -= m <= 2;
    const std::int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<std::int64_t>(doe) - 719468;
}

// An IMF-fixdate ("Sun, 06 Nov 1994 08:49:37 GMT") as seconds since the epoch; nullopt
// otherwise. The weekday is ignored.
std::optional<std::int64_t> parse_http_date(const std::string& text) {
    static const char* const kMonths[] = {"jan", "feb", "mar", "apr", "may", "jun",
                                          "jul", "aug", "sep", "oct", "nov", "dec"};
    const auto comma = text.find(',');
    std::string rest = comma == std::string::npos ? text : text.substr(comma + 1);
    rest.erase(0, rest.find_first_not_of(" \t"));
    unsigned day = 0, hour = 0, minute = 0, second = 0;
    int year = 0;
    char month[4] = {};
    if (std::sscanf(rest.c_str(), "%2u %3s %4d %2u:%2u:%2u", &day, month, &year, &hour, &minute,
                    &second) != 6) {
        return std::nullopt;
    }
    const std::string mon = lower(month);
    const auto* it = std::find(std::begin(kMonths), std::end(kMonths), mon);
    if (it == std::end(kMonths) || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
        return std::nullopt;
    }
    const auto month_index = static_cast<unsigned>(it - std::begin(kMonths)) + 1;
    return days_from_civil(year, month_index, day) * 86400 + hour * 3600 + minute * 60 + second;
}

// Retry-After as seconds: a delay in seconds, or an HTTP date converted against now; absent
// when the header is absent, malformed or 0.
std::optional<double> retry_after(const std::map<std::string, std::string>& headers) {
    const auto value = header(headers, "Retry-After");
    if (!value) {
        return std::nullopt;
    }
    std::string text = *value;
    text.erase(0, text.find_first_not_of(" \t"));
    if (!text.empty() && std::isdigit(static_cast<unsigned char>(text.front()))) {
        char* end = nullptr;
        const double seconds = std::strtod(text.c_str(), &end);
        return seconds > 0 ? std::optional<double>(seconds) : std::nullopt;
    }
    if (const auto at = parse_http_date(text)) {
        const auto now = std::chrono::duration_cast<std::chrono::seconds>(
                             std::chrono::system_clock::now().time_since_epoch())
                             .count();
        const auto delta = static_cast<double>(*at - now);
        return delta > 0 ? std::optional<double>(delta) : std::nullopt;
    }
    return std::nullopt;
}

std::optional<RateLimit> rate_limit(const std::map<std::string, std::string>& headers) {
    RateLimit limit;
    limit.limit = integer_header(headers, "ratelimit-limit");
    limit.remaining = integer_header(headers, "ratelimit-remaining");
    limit.reset_seconds = integer_header(headers, "ratelimit-reset");
    if (!limit.limit && !limit.remaining && !limit.reset_seconds) {
        limit.limit = integer_header(headers, "x-ratelimit-limit-minute");
        limit.remaining = integer_header(headers, "x-ratelimit-remaining-minute");
    }
    if (!limit.limit && !limit.remaining && !limit.reset_seconds) {
        return std::nullopt;
    }
    return limit;
}

// The first kMaxTextBytes of a body as UTF-8 text, bytes outside UTF-8 replaced by U+FFFD.
std::string text_excerpt(std::string_view bytes) {
    const std::string_view head = bytes.substr(0, std::min(bytes.size(), kMaxTextBytes));
    if (unicode::is_valid_utf8(head)) {
        return std::string(head);
    }
    std::string out;
    out.reserve(head.size());
    for (char32_t cp : unicode::decode_utf8(head)) {
        unicode::append_utf8(out, cp);
    }
    return out;
}

// The client's outcome in this seam's vocabulary, member by member: the kinds are the same
// seven names, `kind` is set on a failure only (the wire shape never carries it on `ok`).
HttpOutcome outcome_from_client(net::AiOutcome&& outcome) {
    HttpOutcome out;
    out.ok = outcome.ok();
    if (!out.ok) {
        out.kind = std::string(net::outcome_kind_name(outcome.kind));
    }
    out.status = outcome.status;
    out.message = std::move(outcome.message);
    out.body = std::move(outcome.body);
    out.text = std::move(outcome.text);
    if (outcome.retry_after_seconds) {
        out.retry_after_seconds = static_cast<double>(*outcome.retry_after_seconds);
    }
    if (outcome.rate_limit) {
        RateLimit limit;
        limit.limit = outcome.rate_limit->limit;
        limit.remaining = outcome.rate_limit->remaining;
        limit.reset_seconds = outcome.rate_limit->reset_seconds;
        out.rate_limit = std::move(limit);
    }
    out.elapsed_ms = outcome.elapsed_ms;
    return out;
}

// The product's transport: the libcurl client of mfbe/http_client.hpp behind the seam. One
// client per core, created by make_transport() on the first ai.* call; send() runs on the job
// thread and the client polls the job's cancel flag itself. The request crosses the seam
// field by field - the key travels as the key, and the client alone turns it into the
// Authorization header (only when non-empty) next to the Definitions' fixed headers.
class CurlTransport : public Transport {
public:
    explicit CurlTransport(const TransportOptions& options)
        : client_(net::HttpClientOptions{options.resources_dir, {}, net::process_env()}) {}

    HttpOutcome send(const HttpRequest& request, rpc::JobControl& control,
                     const ProgressFn& progress) override {
        net::HttpRequest wire;
        wire.method = request.method;
        wire.url = request.url;
        wire.key = request.key;
        wire.body = request.body;
        wire.connect_ms = request.connect_ms;
        wire.total_ms = request.total_ms;
        wire.resolve_entries = request.resolve_entries;
        net::ProgressFn forward;
        if (progress) {
            forward = [&progress](const std::string& phase, std::int64_t done, std::int64_t total) {
                progress(phase.c_str(), done, total);
            };
        }
        return outcome_from_client(client_.perform(wire, control, forward));
    }

private:
    net::HttpClient client_;
};

std::mutex g_factory_mutex;
TransportFactory g_factory;

}  // namespace

json RateLimit::to_json() const {
    json j = json::object();
    if (limit) {
        j["limit"] = *limit;
    }
    if (remaining) {
        j["remaining"] = *remaining;
    }
    if (reset_seconds) {
        j["resetSeconds"] = *reset_seconds;
    }
    return j;
}

HttpOutcome HttpOutcome::failure(std::string kind_, std::string message_,
                                 std::int64_t elapsed_ms_) {
    HttpOutcome outcome;
    outcome.ok = false;
    outcome.kind = std::move(kind_);
    outcome.message = std::move(message_);
    outcome.elapsed_ms = elapsed_ms_;
    return outcome;
}

json HttpOutcome::to_json() const {
    json j;
    j["ok"] = ok;
    if (!ok) {
        j["kind"] = kind;
        if (!message.empty()) {
            j["message"] = message;
        }
    }
    if (status) {
        j["status"] = *status;
    }
    if (body) {
        j["body"] = *body;
    }
    if (text) {
        j["text"] = *text;
    }
    if (retry_after_seconds) {
        j["retryAfterSeconds"] = *retry_after_seconds;
    }
    if (rate_limit) {
        j["rateLimit"] = rate_limit->to_json();
    }
    j["elapsedMs"] = elapsed_ms;
    return j;
}

HttpOutcome outcome_from_response(int status, const std::map<std::string, std::string>& headers,
                                  std::string_view body_bytes, std::int64_t elapsed_ms) {
    HttpOutcome outcome;
    outcome.status = status;
    outcome.elapsed_ms = elapsed_ms;
    outcome.retry_after_seconds = retry_after(headers);
    outcome.rate_limit = rate_limit(headers);
    const bool success = status >= 200 && status <= 299;
    if (body_bytes.size() > kMaxResponseBytes) {
        outcome.ok = false;
        outcome.kind = "format";
        outcome.message = "response larger than 16 MiB";
        return outcome;
    }
    std::string_view bytes = body_bytes;
    if (bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xEF &&
        static_cast<unsigned char>(bytes[1]) == 0xBB &&
        static_cast<unsigned char>(bytes[2]) == 0xBF) {
        bytes.remove_prefix(3);
    }
    json parsed = bytes.empty() ? json(nullptr) : json::parse(bytes, nullptr, false);
    const bool is_json = !bytes.empty() && !parsed.is_discarded();
    if (success) {
        if (is_json) {
            outcome.ok = true;
            outcome.body = std::move(parsed);
        } else {
            outcome.ok = false;
            outcome.kind = "format";
            outcome.message = "response body is not JSON";
            outcome.text = text_excerpt(body_bytes);
        }
        return outcome;
    }
    outcome.ok = false;
    outcome.kind = "http";
    if (is_json) {
        outcome.body = std::move(parsed);
    } else {
        outcome.text = text_excerpt(body_bytes);
    }
    return outcome;
}

std::unique_ptr<Transport> make_transport(const TransportOptions& options) {
    TransportFactory factory;
    {
        std::lock_guard<std::mutex> lock(g_factory_mutex);
        factory = g_factory;
    }
    if (factory) {
        return factory();
    }
    // The product's path. libcurl's one-time initialisation belongs here - the first ai.* call
    // of the core creates the transport, nothing touches the network library before (FR-094,
    // FR-096) - and the core server cleans up at shutdown only because it ran.
    net::global_init_once();
    return std::make_unique<CurlTransport>(options);
}

void set_transport_factory_for_tests(TransportFactory factory) {
    std::lock_guard<std::mutex> lock(g_factory_mutex);
    g_factory = std::move(factory);
}

}  // namespace mfbe::ai
