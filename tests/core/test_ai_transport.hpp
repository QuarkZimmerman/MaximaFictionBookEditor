// Test transports for the ai.* handlers (feature 005): the Catch2 suite plugs them through
// ai::set_transport_factory_for_tests() so that the jobs' plumbing - target resolution, the
// request built, the outcome delivery, the log rule, the test hooks - is exercised against the
// in-process HTTP test server (test_http_server.hpp) without the libcurl client.
//
//   LoopbackTransport  a raw-socket HTTP/1.1 client: resolves the URL's host through the
//                      request's resolve entries (a hosted name mapped to 127.0.0.1, as
//                      CURLOPT_RESOLVE does) or the loopback literals, honours `total_ms` as the
//                      deadline (-> timeout), reports a refused connection or an unknown host
//                      as offline, and classifies an answer with ai::outcome_from_response().
//   ScriptedTransport  answers every exchange with a canned outcome (tls, cancelled, ...).
//   Both record every HttpRequest they were given.
#pragma once

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/ai_transport.hpp>
#include <mfbe/version.hpp>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace mfbe::test {

struct ParsedUrl {
    std::string host;  // without brackets
    int port = 80;
    std::string path;  // path (no query)
};

inline std::optional<ParsedUrl> parse_url(const std::string& url) {
    const auto scheme_end = url.find("://");
    if (scheme_end == std::string::npos) {
        return std::nullopt;
    }
    ParsedUrl out;
    out.port = url.compare(0, scheme_end, "https") == 0 ? 443 : 80;
    const std::string rest = url.substr(scheme_end + 3);
    const auto slash = rest.find('/');
    std::string authority = rest.substr(0, slash);
    out.path = slash == std::string::npos ? "/" : rest.substr(slash);
    if (!authority.empty() && authority.front() == '[') {
        const auto close = authority.find(']');
        out.host = authority.substr(1, close - 1);
        if (close + 1 < authority.size() && authority[close + 1] == ':') {
            out.port = std::atoi(authority.c_str() + close + 2);
        }
    } else {
        const auto colon = authority.find(':');
        out.host = authority.substr(0, colon);
        if (colon != std::string::npos) {
            out.port = std::atoi(authority.c_str() + colon + 1);
        }
    }
    return out;
}

// Records the requests a transport was given (shared by the tests and the factory).
struct TransportLog {
    std::mutex mutex;
    std::vector<ai::HttpRequest> requests;
    std::atomic<int> created{0};

    std::vector<ai::HttpRequest> take() {
        std::lock_guard<std::mutex> lock(mutex);
        auto out = std::move(requests);
        requests.clear();
        return out;
    }
    std::size_t size() {
        std::lock_guard<std::mutex> lock(mutex);
        return requests.size();
    }
    void push(const ai::HttpRequest& request) {
        std::lock_guard<std::mutex> lock(mutex);
        requests.push_back(request);
    }
};

class LoopbackTransport : public ai::Transport {
public:
    explicit LoopbackTransport(std::shared_ptr<TransportLog> log) : log_(std::move(log)) {}

    ai::HttpOutcome send(const ai::HttpRequest& request, rpc::JobControl& control,
                         const ai::ProgressFn& progress) override {
        log_->push(request);
        const auto started = std::chrono::steady_clock::now();
        const auto elapsed = [&] {
            return std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::steady_clock::now() - started)
                .count();
        };
        progress("connecting", 0, 0);
        const auto url = parse_url(request.url);
        if (!url) {
            return ai::HttpOutcome::failure("offline", "malformed URL", elapsed());
        }
        // Name resolution: the loopback literals, or a resolve entry "host:port:address".
        std::string address;
        if (url->host == "127.0.0.1" || url->host == "localhost" || url->host == "::1") {
            address = "127.0.0.1";
        } else {
            for (const auto& entry : request.resolve_entries) {
                const std::string prefix = url->host + ":" + std::to_string(url->port) + ":";
                if (entry.compare(0, prefix.size(), prefix) == 0) {
                    address = entry.substr(prefix.size());
                }
            }
        }
        if (address != "127.0.0.1") {
            return ai::HttpOutcome::failure("offline", "Could not resolve host: " + url->host,
                                            elapsed());
        }
        TcpClient client;
        try {
            client.connect(url->port);
        } catch (const std::runtime_error&) {
            return ai::HttpOutcome::failure("offline",
                                            "Failed to connect to " + url->host + " port " +
                                                std::to_string(url->port) + ": Connection refused",
                                            elapsed());
        }
        // The Definitions' headers as the product's client composes them from the request:
        // Content-Type on a POST, Accept, User-Agent, Authorization only with a non-empty key.
        std::string raw = request.method + " " + url->path + " HTTP/1.1\r\nHost: " + url->host +
                          ":" + std::to_string(url->port) + "\r\nConnection: close\r\n";
        if (request.method == "POST") {
            raw += "Content-Type: application/json\r\n";
        }
        raw += "Accept: application/json\r\n";
        raw += std::string("User-Agent: MaximaFictionBookEditor/") + version::kVersion + "\r\n";
        if (!request.key.empty()) {
            raw += "Authorization: Bearer " + request.key + "\r\n";
        }
        if (request.method == "POST") {
            raw += "Content-Length: " + std::to_string(request.body.size()) + "\r\n";
        }
        raw += "\r\n" + request.body;
        try {
            client.send_all(raw);
        } catch (const std::runtime_error&) {
            return ai::HttpOutcome::failure("offline", "Send failure: connection reset", elapsed());
        }
        progress("waiting", 0, 0);
        const auto deadline = started + std::chrono::milliseconds(request.total_ms);
        std::string response;
        std::optional<std::size_t> expected_total;
        bool receiving = false;
        bool closed = false;
        while (true) {
            if (control.cancelled()) {
                throw rpc::RpcError(rpc::codes::kCancelled, "", {{"jobId", control.id()}});
            }
            if (std::chrono::steady_clock::now() >= deadline) {
                return ai::HttpOutcome::failure("timeout",
                                                "Operation timed out after " +
                                                    std::to_string(request.total_ms) +
                                                    " milliseconds",
                                                elapsed());
            }
            try {
                if (!client.read_some(response, 20)) {
                    continue;
                }
            } catch (const std::runtime_error&) {
                closed = true;
            }
            if (!expected_total) {
                const auto end = response.find("\r\n\r\n");
                if (end != std::string::npos) {
                    const HttpResponse head = parse_http_response(response.substr(0, end + 4));
                    const auto it = head.headers.find("content-length");
                    if (it != head.headers.end()) {
                        expected_total = end + 4 + static_cast<std::size_t>(std::stoul(it->second));
                    }
                    if (!receiving) {
                        receiving = true;
                        progress("receiving", 0,
                                 it != head.headers.end() ? std::stoll(it->second) : 0);
                    }
                }
            }
            if ((expected_total && response.size() >= *expected_total) || closed) {
                break;
            }
        }
        if (response.find("\r\n\r\n") == std::string::npos) {
            return ai::HttpOutcome::failure("offline", "Empty reply from server", elapsed());
        }
        const HttpResponse parsed = parse_http_response(response);
        return ai::outcome_from_response(parsed.status, parsed.headers, parsed.body, elapsed());
    }

private:
    std::shared_ptr<TransportLog> log_;
};

// Answers every exchange with `outcome` (set the shared slot before the call).
struct ScriptedOutcome {
    std::mutex mutex;
    std::optional<ai::HttpOutcome> next;
    int delay_ms = 0;
};

class ScriptedTransport : public ai::Transport {
public:
    ScriptedTransport(std::shared_ptr<TransportLog> log, std::shared_ptr<ScriptedOutcome> script)
        : log_(std::move(log)), script_(std::move(script)) {}

    ai::HttpOutcome send(const ai::HttpRequest& request, rpc::JobControl& control,
                         const ai::ProgressFn& progress) override {
        log_->push(request);
        progress("connecting", 0, 0);
        int delay = 0;
        std::optional<ai::HttpOutcome> outcome;
        {
            std::lock_guard<std::mutex> lock(script_->mutex);
            delay = script_->delay_ms;
            outcome = script_->next;
        }
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(delay);
        while (std::chrono::steady_clock::now() < deadline) {
            if (control.cancelled()) {
                throw rpc::RpcError(rpc::codes::kCancelled, "", {{"jobId", control.id()}});
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        if (!outcome) {
            return ai::HttpOutcome::failure("offline", "no scripted outcome", 0);
        }
        return *outcome;
    }

private:
    std::shared_ptr<TransportLog> log_;
    std::shared_ptr<ScriptedOutcome> script_;
};

// Installs a factory for the duration of a test; restores the product's on destruction.
class TransportFactoryScope {
public:
    explicit TransportFactoryScope(ai::TransportFactory factory) {
        ai::set_transport_factory_for_tests(std::move(factory));
    }
    ~TransportFactoryScope() { ai::set_transport_factory_for_tests(nullptr); }
    TransportFactoryScope(const TransportFactoryScope&) = delete;
    TransportFactoryScope& operator=(const TransportFactoryScope&) = delete;
};

inline ai::TransportFactory loopback_factory(std::shared_ptr<TransportLog> log) {
    return [log] {
        ++log->created;
        return std::make_unique<LoopbackTransport>(log);
    };
}

inline ai::TransportFactory scripted_factory(std::shared_ptr<TransportLog> log,
                                             std::shared_ptr<ScriptedOutcome> script) {
    return [log, script] {
        ++log->created;
        return std::make_unique<ScriptedTransport>(log, script);
    };
}

}  // namespace mfbe::test
