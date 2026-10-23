// In-process plain-HTTP test server for the core's HTTP client tests (feature 005, T010): a
// `uWS::App` on 127.0.0.1:0 running on its own thread. A test registers routes with canned
// answers or queues one-shot answers (status, headers, body, a pause before the answer, a 3xx
// with Location, a large or a non-JSON body), and reads back every request the server saw
// (method, path, headers, body). Hermetic like ws_test_client.hpp: no external process, no
// real host, so `ctest` stays self-contained on every CI platform.
//
// Header-only; shared by test_http_server.cpp (the self-test), test_http_client.cpp and, for
// the response/request vocabulary, test_tls_fixture.hpp.
#pragma once

#include <algorithm>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <uwebsockets/App.h>
#include <vector>

namespace mfbe::test {

// One canned HTTP answer.
struct ScriptedResponse {
    int status = 200;
    std::vector<std::pair<std::string, std::string>> headers;  // written in this order
    std::string body;
    int delay_ms = 0;                  // pause before the status line goes out
    bool close_without_reply = false;  // drop the connection instead of answering

    ScriptedResponse& with_header(std::string name, std::string value) {
        headers.emplace_back(std::move(name), std::move(value));
        return *this;
    }
    ScriptedResponse& with_delay(int ms) {
        delay_ms = ms;
        return *this;
    }

    // A JSON body (`Content-Type: application/json`).
    static ScriptedResponse json(int status_code, std::string body_text) {
        ScriptedResponse r;
        r.status = status_code;
        r.body = std::move(body_text);
        r.headers.emplace_back("Content-Type", "application/json");
        return r;
    }
    // A non-JSON body with the given media type (`text/plain`, `text/html`, ...).
    static ScriptedResponse text(int status_code, std::string body_text,
                                 std::string content_type = "text/plain; charset=utf-8") {
        ScriptedResponse r;
        r.status = status_code;
        r.body = std::move(body_text);
        r.headers.emplace_back("Content-Type", std::move(content_type));
        return r;
    }
    // A 3xx with a Location header and a short HTML body.
    static ScriptedResponse redirect(int status_code, std::string location) {
        ScriptedResponse r;
        r.status = status_code;
        r.headers.emplace_back("Location", std::move(location));
        r.headers.emplace_back("Content-Type", "text/html; charset=utf-8");
        r.body = "<html><body>moved</body></html>";
        return r;
    }
    // Closes the connection without an answer (a "network" failure for the client).
    static ScriptedResponse drop() {
        ScriptedResponse r;
        r.close_without_reply = true;
        return r;
    }
};

// One request as the server saw it.
struct RecordedRequest {
    std::string method;                          // upper case: GET, POST, ...
    std::string path;                            // URL path, without the query
    std::string query;                           // raw query string, without the '?'
    std::map<std::string, std::string> headers;  // lower-case names; repeats joined by ", "
    std::string body;

    std::string header(std::string name) const {
        for (auto& c : name) {
            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        }
        const auto it = headers.find(name);
        return it == headers.end() ? std::string() : it->second;
    }
    bool has_header(const std::string& name) const {
        std::string key = name;
        for (auto& c : key) {
            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        }
        return headers.count(key) != 0;
    }
};

// The reason phrase of a status code (curl only reads the number; the raw-socket client of
// ws_test_client.hpp parses the three digits).
inline std::string http_status_line(int status) {
    static const std::map<int, const char*> kPhrases = {
        {200, "OK"},
        {201, "Created"},
        {202, "Accepted"},
        {204, "No Content"},
        {301, "Moved Permanently"},
        {302, "Found"},
        {303, "See Other"},
        {307, "Temporary Redirect"},
        {308, "Permanent Redirect"},
        {400, "Bad Request"},
        {401, "Unauthorized"},
        {402, "Payment Required"},
        {403, "Forbidden"},
        {404, "Not Found"},
        {405, "Method Not Allowed"},
        {408, "Request Timeout"},
        {409, "Conflict"},
        {413, "Payload Too Large"},
        {415, "Unsupported Media Type"},
        {422, "Unprocessable Entity"},
        {429, "Too Many Requests"},
        {500, "Internal Server Error"},
        {502, "Bad Gateway"},
        {503, "Service Unavailable"},
        {504, "Gateway Timeout"},
    };
    const auto it = kPhrases.find(status);
    return std::to_string(status) + " " + (it == kPhrases.end() ? "Status" : it->second);
}

// The plain-HTTP test server. Thread-safe: every public member may be called from the test
// thread while the loop thread serves requests.
class HttpTestServer {
public:
    // Listens before returning; throws std::runtime_error when 127.0.0.1:0 cannot be bound.
    HttpTestServer() {
        std::promise<std::string> ready;  // "" = listening, otherwise the error text
        auto ready_future = ready.get_future();
        thread_ = std::thread([this, ready = std::move(ready)]() mutable { run(ready); });
        const std::string error = ready_future.get();
        if (!error.empty()) {
            thread_.join();
            throw std::runtime_error(error);
        }
    }
    ~HttpTestServer() { stop(); }
    HttpTestServer(const HttpTestServer&) = delete;
    HttpTestServer& operator=(const HttpTestServer&) = delete;

    int port() const { return port_; }
    std::string base_url() const { return "http://127.0.0.1:" + std::to_string(port_); }
    std::string url(const std::string& path) const { return base_url() + path; }

    // A canned answer for `method` (upper case, or "*" for any) and `path` (exact, or with a
    // trailing '*' for a prefix). The most specific route answers a request (an exact path
    // over a prefix, a longer prefix over a shorter one, an explicit method over "*"); a later
    // route for the same method and path replaces the earlier one.
    void route(std::string method, std::string path, ScriptedResponse response) {
        std::lock_guard<std::mutex> lock(mutex_);
        for (auto& r : routes_) {
            if (r.method == method && r.path == path) {
                r.response = std::move(response);
                return;
            }
        }
        routes_.push_back(Route{std::move(method), std::move(path), std::move(response)});
    }
    // One-shot answers, consumed in order by the next requests whatever their route.
    void enqueue(ScriptedResponse response) {
        std::lock_guard<std::mutex> lock(mutex_);
        queue_.push_back(std::move(response));
    }
    std::size_t queued() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return queue_.size();
    }

    std::vector<RecordedRequest> requests() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return requests_;
    }
    std::size_t request_count() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return requests_.size();
    }
    // Waits until at least `count` requests were recorded; false on time-out.
    bool wait_for_requests(std::size_t count, int timeout_ms = 5000) const {
        std::unique_lock<std::mutex> lock(mutex_);
        return cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                            [&] { return requests_.size() >= count; });
    }
    void clear_requests() {
        std::lock_guard<std::mutex> lock(mutex_);
        requests_.clear();
    }
    // Forgets the queued answers and the routes.
    void clear_scripts() {
        std::lock_guard<std::mutex> lock(mutex_);
        queue_.clear();
        routes_.clear();
    }

    // Closes the listen socket and every connection, ends the loop and joins the thread.
    // Pending delayed answers are abandoned. Idempotent.
    void stop() {
        if (!thread_.joinable()) {
            return;
        }
        loop_->defer([this] { close_on_loop(); });
        thread_.join();
    }

private:
    struct Route {
        std::string method;
        std::string path;
        ScriptedResponse response;
    };
    struct Connection {
        bool aborted = false;
    };
    struct Delayed {
        HttpTestServer* server = nullptr;
        uWS::HttpResponse<false>* res = nullptr;
        std::shared_ptr<Connection> connection;
        ScriptedResponse answer;
    };

    static std::string lower(std::string_view in) {
        std::string out(in);
        for (auto& c : out) {
            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        }
        return out;
    }
    static std::string upper(std::string_view in) {
        std::string out(in);
        for (auto& c : out) {
            c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        }
        return out;
    }

    // Loop thread.
    void run(std::promise<std::string>& ready) {
        loop_ = uWS::Loop::get();
        {
            uWS::App app;
            app.any("/*", [this](uWS::HttpResponse<false>* res, uWS::HttpRequest* req) {
                on_request(res, req);
            });
            us_listen_socket_t* listen_socket = nullptr;
            app.listen("127.0.0.1", 0, LIBUS_LISTEN_EXCLUSIVE_PORT,
                       [&](us_listen_socket_t* s) { listen_socket = s; });
            if (listen_socket == nullptr) {
                ready.set_value("test HTTP server: cannot bind 127.0.0.1:0");
                return;
            }
            listen_socket_ = listen_socket;
            app_ = &app;
            port_ = us_socket_local_port(0, reinterpret_cast<us_socket_t*>(listen_socket));
            ready.set_value("");
            app.run();
            app_ = nullptr;
        }
        // `app` is gone; the thread-local loop is freed when the thread ends.
    }

    void on_request(uWS::HttpResponse<false>* res, uWS::HttpRequest* req) {
        auto record = std::make_shared<RecordedRequest>();
        record->method = upper(req->getCaseSensitiveMethod());
        record->path = std::string(req->getUrl());
        record->query = std::string(req->getQuery());
        for (auto [key, value] : *req) {
            const std::string name = lower(key);
            auto it = record->headers.find(name);
            if (it == record->headers.end()) {
                record->headers.emplace(name, std::string(value));
            } else {
                it->second += ", " + std::string(value);
            }
        }
        auto connection = std::make_shared<Connection>();
        res->onAborted([connection] { connection->aborted = true; });
        res->onData([this, res, record, connection](std::string_view chunk, bool last) {
            record->body.append(chunk.data(), chunk.size());
            if (!last) {
                return;
            }
            ScriptedResponse answer;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                requests_.push_back(*record);
                answer = pick_answer_locked(*record);
            }
            cv_.notify_all();
            if (connection->aborted) {
                return;
            }
            if (answer.delay_ms > 0) {
                schedule(res, connection, std::move(answer));
            } else {
                write_answer(res, answer);
            }
        });
    }

    // mutex_ held.
    ScriptedResponse pick_answer_locked(const RecordedRequest& request) {
        if (!queue_.empty()) {
            ScriptedResponse answer = std::move(queue_.front());
            queue_.pop_front();
            return answer;
        }
        // The most specific route wins: an exact path over a prefix, a longer prefix over a
        // shorter one, an explicit method over "*".
        const Route* best = nullptr;
        std::size_t best_score = 0;
        for (const auto& route : routes_) {
            if (route.method != "*" && route.method != request.method) {
                continue;
            }
            const bool prefix = !route.path.empty() && route.path.back() == '*';
            std::size_t score = 0;
            if (prefix && request.path.compare(0, route.path.size() - 1, route.path, 0,
                                               route.path.size() - 1) == 0) {
                score = route.path.size();
            } else if (!prefix && request.path == route.path) {
                score = 1u << 20;
            } else {
                continue;
            }
            score = score * 2 + (route.method != "*" ? 1 : 0);
            if (best == nullptr || score > best_score) {
                best = &route;
                best_score = score;
            }
        }
        if (best != nullptr) {
            return best->response;
        }
        // A forgotten script fails loudly, as the Playwright stand-in's empty queue does.
        return ScriptedResponse::json(500,
                                      "{\"error\":{\"message\":\"test server: no scripted "
                                      "answer for " +
                                          request.method + " " + request.path + "\"}}");
    }

    void write_answer(uWS::HttpResponse<false>* res, const ScriptedResponse& answer) {
        if (answer.close_without_reply) {
            res->close();
            return;
        }
        res->writeStatus(http_status_line(answer.status));
        for (const auto& [name, value] : answer.headers) {
            res->writeHeader(name, value);
        }
        res->end(answer.body);
    }

    void schedule(uWS::HttpResponse<false>* res, std::shared_ptr<Connection> connection,
                  ScriptedResponse answer) {
        us_timer_t* timer =
            us_create_timer(reinterpret_cast<us_loop_t*>(loop_), 0, sizeof(Delayed*));
        auto* delayed = new Delayed{this, res, std::move(connection), std::move(answer)};
        *static_cast<Delayed**>(us_timer_ext(timer)) = delayed;
        pending_.insert(timer);
        us_timer_set(
            timer,
            [](us_timer_t* t) {
                Delayed* d = *static_cast<Delayed**>(us_timer_ext(t));
                d->server->pending_.erase(t);
                us_timer_close(t);
                if (!d->connection->aborted) {
                    d->server->write_answer(d->res, d->answer);
                }
                delete d;
            },
            delayed->answer.delay_ms, 0);
    }

    void close_on_loop() {
        for (us_timer_t* timer : pending_) {
            delete *static_cast<Delayed**>(us_timer_ext(timer));
            us_timer_close(timer);
        }
        pending_.clear();
        if (listen_socket_ != nullptr) {
            us_listen_socket_close(0, listen_socket_);
            listen_socket_ = nullptr;
        }
        if (app_ != nullptr) {
            app_->close();
        }
    }

    std::thread thread_;
    uWS::Loop* loop_ = nullptr;                    // set before the constructor returns
    uWS::App* app_ = nullptr;                      // loop thread only
    us_listen_socket_t* listen_socket_ = nullptr;  // loop thread only
    std::set<us_timer_t*> pending_;                // loop thread only
    int port_ = 0;

    mutable std::mutex mutex_;
    mutable std::condition_variable cv_;
    std::deque<ScriptedResponse> queue_;
    std::vector<Route> routes_;
    std::vector<RecordedRequest> requests_;
};

}  // namespace mfbe::test
