// The core's HTTP client (feature 005, T015) against the in-process test server of
// test_http_server.hpp: outcome kinds, the exact header set, the exchange limits, the limit
// headers, redirects never followed, cancel latency, the proxy policy and the lazy libcurl
// initialisation. No real host is contacted (FR-102). The TLS half lives in test_tls_ca.cpp.
#include "test_http_server.hpp"
#include "test_support.hpp"

#include <mfbe/http_client.hpp>
#include <mfbe/utf8_paths.hpp>
#include <mfbe/version.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <ctime>
#include <future>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

using namespace mfbe;
using Clock = std::chrono::steady_clock;

namespace {

long long elapsed_ms(Clock::time_point since) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - since).count();
}

net::HttpClient make_client() {
    net::HttpClientOptions options;
    options.resources_dir = platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR);
    return net::HttpClient(std::move(options));
}

net::HttpRequest get_request(const std::string& url) {
    net::HttpRequest request;
    request.method = "GET";
    request.url = url;
    return request;
}

net::HttpRequest post_request(const std::string& url, std::string body, std::string key = "") {
    net::HttpRequest request;
    request.method = "POST";
    request.url = url;
    request.body = std::move(body);
    request.key = std::move(key);
    return request;
}

std::set<std::string> header_names(const test::RecordedRequest& request) {
    std::set<std::string> names;
    for (const auto& [name, value] : request.headers) {
        names.insert(name);
    }
    return names;
}

// An IMF-fixdate `seconds` from now, as a Retry-After header carries it.
std::string http_date_from_now(int seconds) {
    const std::time_t when = std::time(nullptr) + seconds;
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &when);
#else
    gmtime_r(&when, &utc);
#endif
    char buffer[64];
    std::strftime(buffer, sizeof(buffer), "%a, %d %b %Y %H:%M:%S GMT", &utc);
    return buffer;
}

}  // namespace

TEST_CASE(
    "http client: outcome kinds against the in-process test server (ok, http, format, "
    "offline, timeout)",
    "[http-client]") {
    test::HttpTestServer server;
    net::HttpClient client = make_client();
    test::ManualJobControl control;

    SECTION("GET JSON is ok with the parsed body, the status and the phases in order") {
        server.route("GET", "/v1/models",
                     test::ScriptedResponse::json(200, R"({"data":[{"id":"standin-chat"}]})"));
        std::vector<std::string> phases;
        std::vector<std::int64_t> totals;
        const auto outcome =
            client.perform(get_request(server.url("/v1/models")), control,
                           [&](const std::string& phase, std::int64_t, std::int64_t total) {
                               phases.push_back(phase);
                               totals.push_back(total);
                           });
        INFO(outcome.message);
        REQUIRE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::ok);
        REQUIRE(outcome.status.has_value());
        CHECK(*outcome.status == 200);
        REQUIRE(outcome.body.has_value());
        CHECK((*outcome.body)["data"][0]["id"] == "standin-chat");
        CHECK_FALSE(outcome.text.has_value());
        CHECK_FALSE(outcome.retry_after_seconds.has_value());
        CHECK_FALSE(outcome.rate_limit.has_value());
        CHECK(outcome.elapsed_ms >= 0);
        CHECK(phases == std::vector<std::string>{"connecting", "waiting", "receiving"});
        CHECK(totals.back() ==
              static_cast<std::int64_t>(std::string(R"({"data":[{"id":"standin-chat"}]})").size()));
        // Nothing went through the job control's own progress: the callback took it.
        CHECK(control.phases().empty());

        const auto wire = outcome.to_json();
        CHECK(wire["ok"] == true);
        CHECK(wire["status"] == 200);
        CHECK(wire["body"]["data"].is_array());
        CHECK(wire.contains("elapsedMs"));
        CHECK_FALSE(wire.contains("kind"));
        CHECK_FALSE(wire.contains("message"));
        CHECK_FALSE(wire.contains("text"));

        REQUIRE(server.wait_for_requests(1));
        const auto requests = server.requests();
        CHECK(requests[0].method == "GET");
        CHECK(requests[0].path == "/v1/models");
        CHECK(requests[0].body.empty());
    }

    SECTION("POST JSON is sent as given and the phases fall back to the job control") {
        server.route("POST", "/v1/chat/completions",
                     test::ScriptedResponse::json(200, R"({"id":"chatcmpl-1","choices":[]})"));
        const std::string body =
            R"({"model":"standin-chat","messages":[{"role":"user","content":"Привет"}],"stream":false})";
        const auto outcome =
            client.perform(post_request(server.url("/v1/chat/completions"), body), control);
        INFO(outcome.message);
        REQUIRE(outcome.ok());
        CHECK((*outcome.body)["id"] == "chatcmpl-1");
        CHECK(control.phases() == std::vector<std::string>{"connecting", "waiting", "receiving"});

        REQUIRE(server.wait_for_requests(1));
        const auto requests = server.requests();
        CHECK(requests[0].method == "POST");
        CHECK(requests[0].path == "/v1/chat/completions");
        CHECK(requests[0].body == body);
        CHECK(requests[0].header("content-type") == "application/json");
        CHECK(requests[0].header("content-length") == std::to_string(body.size()));
    }

    SECTION("a 2xx body with a BOM, or with error and no choices, is still ok") {
        server.enqueue(test::ScriptedResponse::json(200, "\xEF\xBB\xBF{\"bom\":true}"));
        const auto with_bom = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(with_bom.ok());
        CHECK((*with_bom.body)["bom"] == true);

        server.enqueue(test::ScriptedResponse::json(
            200, R"({"error":{"message":"upstream failed","code":502}})"));
        const auto upstream = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(upstream.ok());  // the core does not interpret the body beyond parsing it
        CHECK((*upstream.body)["error"]["code"] == 502);

        server.enqueue(test::ScriptedResponse::json(201, "[1,2,3]"));
        const auto created = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(created.ok());
        CHECK(*created.status == 201);
        CHECK(created.body->is_array());
    }

    SECTION("statuses outside 2xx are http outcomes with the parsed body and no message") {
        server.enqueue(test::ScriptedResponse::json(
            429, R"({"error":{"message":"Rate limit exceeded","type":"rate_limit"}})"));
        const auto limited = client.perform(
            post_request(server.url("/v1/chat/completions"), R"({"model":"m"})"), control);
        CHECK_FALSE(limited.ok());
        CHECK(limited.kind == net::OutcomeKind::http);
        REQUIRE(limited.status.has_value());
        CHECK(*limited.status == 429);
        REQUIRE(limited.body.has_value());
        CHECK((*limited.body)["error"]["message"] == "Rate limit exceeded");
        CHECK(limited.message.empty());
        CHECK_FALSE(limited.text.has_value());
        CHECK_FALSE(limited.retry_after_seconds.has_value());
        const auto wire = limited.to_json();
        CHECK(wire["ok"] == false);
        CHECK(wire["kind"] == "http");
        CHECK(wire["status"] == 429);
        CHECK(wire["body"]["error"]["type"] == "rate_limit");
        CHECK_FALSE(wire.contains("message"));
        CHECK(wire.contains("elapsedMs"));

        server.enqueue(
            test::ScriptedResponse::json(402, R"({"error":{"message":"Insufficient credits"}})"));
        const auto payment = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(payment.kind == net::OutcomeKind::http);
        CHECK(*payment.status == 402);
        CHECK((*payment.body)["error"]["message"] == "Insufficient credits");

        // A 503 without Retry-After is a plain http failure: no wait is suggested.
        server.enqueue(test::ScriptedResponse::json(503, R"({"error":{"message":"overloaded"}})"));
        const auto unavailable = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(unavailable.kind == net::OutcomeKind::http);
        CHECK(*unavailable.status == 503);
        CHECK_FALSE(unavailable.retry_after_seconds.has_value());

        server.enqueue(test::ScriptedResponse::json(
            401, R"({"error":{"message":"Missing API key.","code":"missing_api_key"}})"));
        const auto unauthorized = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(unauthorized.kind == net::OutcomeKind::http);
        CHECK(*unauthorized.status == 401);
        CHECK((*unauthorized.body)["error"]["code"] == "missing_api_key");
    }

    SECTION("a non-JSON error body travels as text, HTML and plain text alike") {
        server.enqueue(test::ScriptedResponse::text(
            400, "<html><title>Bad Request</title><pre>no JSON here</pre></html>",
            "text/html; charset=utf-8"));
        const auto html = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(html.kind == net::OutcomeKind::http);
        CHECK(*html.status == 400);
        CHECK_FALSE(html.body.has_value());
        REQUIRE(html.text.has_value());
        CHECK(html.text->find("<pre>no JSON here</pre>") != std::string::npos);
        CHECK(html.message.empty());
        CHECK(html.to_json()["text"] == *html.text);
        CHECK_FALSE(html.to_json().contains("body"));

        server.enqueue(test::ScriptedResponse::text(500, "Internal Server Error"));
        const auto plain = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(plain.kind == net::OutcomeKind::http);
        CHECK(*plain.status == 500);
        CHECK(*plain.text == "Internal Server Error");

        // Bytes outside UTF-8 become U+FFFD; the text is cut at 64 KiB.
        std::string bad = "oops \xFF\xFE end";
        server.enqueue(test::ScriptedResponse::text(502, bad));
        const auto replaced = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(replaced.text.has_value());
        CHECK(replaced.text->find("\xEF\xBF\xBD") != std::string::npos);
        CHECK(replaced.text->find('\xFF') == std::string::npos);
        CHECK(replaced.text->find(" end") != std::string::npos);

        server.enqueue(test::ScriptedResponse::text(504, std::string(200000, 'g')));
        const auto cut = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(cut.text.has_value());
        CHECK(cut.text->size() == net::kMaxTextBytes);
    }

    SECTION("a 2xx whose body is not JSON is a format outcome with status, text and message") {
        server.enqueue(
            test::ScriptedResponse::text(200, "<html>welcome</html>", "text/html; charset=utf-8"));
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        CHECK_FALSE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::format);
        REQUIRE(outcome.status.has_value());
        CHECK(*outcome.status == 200);
        REQUIRE(outcome.text.has_value());
        CHECK(*outcome.text == "<html>welcome</html>");
        CHECK_FALSE(outcome.message.empty());
        const auto wire = outcome.to_json();
        CHECK(wire["kind"] == "format");
        CHECK(wire["message"] == outcome.message);
        CHECK(wire["status"] == 200);

        // An empty 2xx body is not JSON either.
        server.enqueue(test::ScriptedResponse::text(204, ""));
        const auto empty = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(empty.kind == net::OutcomeKind::format);
        CHECK(*empty.status == 204);
    }

    SECTION("a closed port is offline with the transport's message and no status") {
        const auto outcome = client.perform(get_request("http://127.0.0.1:1/v1/models"), control);
        CHECK_FALSE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::offline);
        CHECK_FALSE(outcome.message.empty());
        CHECK_FALSE(outcome.status.has_value());
        CHECK_FALSE(outcome.body.has_value());
        CHECK(outcome.elapsed_ms >= 0);
        const auto wire = outcome.to_json();
        CHECK(wire["ok"] == false);
        CHECK(wire["kind"] == "offline");
        CHECK(wire["message"] == outcome.message);
        CHECK_FALSE(wire.contains("status"));
        CHECK(wire.contains("elapsedMs"));
        CHECK(server.request_count() == 0);
    }

    SECTION("a server sleeping past the total time-out is a timeout outcome") {
        server.enqueue(test::ScriptedResponse::json(200, "{}").with_delay(3000));
        net::HttpRequest request = get_request(server.url("/v1/models"));
        request.total_ms = 300;
        const auto started = Clock::now();
        const auto outcome = client.perform(request, control);
        const auto took = elapsed_ms(started);
        CHECK(outcome.kind == net::OutcomeKind::timeout);
        CHECK_FALSE(outcome.message.empty());
        CHECK(took >= 250);
        CHECK(took < 2500);
        CHECK(outcome.elapsed_ms >= 250);
        CHECK(outcome.to_json()["kind"] == "timeout");
    }

    SECTION("a connection dropped without an answer is offline") {
        server.enqueue(test::ScriptedResponse::drop());
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        CHECK_FALSE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::offline);
        CHECK_FALSE(outcome.message.empty());
        CHECK_FALSE(outcome.body.has_value());
        REQUIRE(server.wait_for_requests(1));
    }

    SECTION("https to the plain-http server is a tls outcome on every platform") {
        const auto outcome = client.perform(
            get_request("https://127.0.0.1:" + std::to_string(server.port()) + "/v1/models"),
            control);
        CHECK_FALSE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::tls);
        CHECK_FALSE(outcome.message.empty());
        CHECK_FALSE(outcome.status.has_value());
        CHECK(outcome.to_json()["kind"] == "tls");
    }

    SECTION("the caller's mistakes are invalidParams before anything is sent") {
        CHECK_THROWS_AS(client.perform(get_request("file:///etc/hosts"), control), rpc::RpcError);
        CHECK_THROWS_AS(client.perform(get_request("ftp://127.0.0.1/x"), control), rpc::RpcError);
        CHECK_THROWS_AS(client.perform(get_request("127.0.0.1/v1/models"), control), rpc::RpcError);
        net::HttpRequest put = post_request(server.url("/v1/models"), "{}");
        put.method = "PUT";
        CHECK_THROWS_AS(client.perform(put, control), rpc::RpcError);
        try {
            client.perform(get_request("file:///etc/hosts"), control);
            FAIL("file:// must be refused");
        } catch (const rpc::RpcError& e) {
            CHECK(e.code == rpc::codes::kInvalidParams);
            CHECK(e.data["field"] == "url");
        }
        CHECK(server.request_count() == 0);
    }
}

TEST_CASE(
    "http client: the request carries exactly the contract's headers and Authorization only "
    "with a key",
    "[http-client]") {
    test::HttpTestServer server;
    server.route("*", "/v1/*", test::ScriptedResponse::json(200, "{}"));
    net::HttpClient client = make_client();
    test::ManualJobControl control;
    const std::string user_agent = std::string("MaximaFictionBookEditor/") + version::kVersion;

    // A POST with a key: Content-Type, Accept, User-Agent, Authorization, plus what the
    // transport itself needs (Host, Content-Length, libcurl's Accept-Encoding) - nothing else.
    const auto posted = client.perform(
        post_request(server.url("/v1/chat/completions"), R"({"model":"m"})", "sk-test-key"),
        control);
    REQUIRE(posted.ok());
    REQUIRE(server.wait_for_requests(1));
    const auto post = server.requests()[0];
    CHECK(header_names(post) == std::set<std::string>{"host", "content-type", "accept",
                                                      "user-agent", "authorization",
                                                      "content-length", "accept-encoding"});
    CHECK(post.header("content-type") == "application/json");
    CHECK(post.header("accept") == "application/json");
    CHECK(post.header("user-agent") == user_agent);
    CHECK(post.header("authorization") == "Bearer sk-test-key");
    CHECK(post.header("host") == "127.0.0.1:" + std::to_string(server.port()));
    CHECK(post.header("accept-encoding").find("gzip") != std::string::npos);
    CHECK_FALSE(post.has_header("cookie"));
    CHECK_FALSE(post.has_header("referer"));
    CHECK_FALSE(post.has_header("origin"));
    CHECK_FALSE(post.has_header("expect"));

    // A GET without a key: no Content-Type, no Content-Length and no Authorization header at
    // all - not even an empty `Bearer ` (it breaks LLM7).
    const auto fetched = client.perform(get_request(server.url("/v1/models")), control);
    REQUIRE(fetched.ok());
    REQUIRE(server.wait_for_requests(2));
    const auto get = server.requests()[1];
    CHECK(header_names(get) ==
          std::set<std::string>{"host", "accept", "user-agent", "accept-encoding"});
    CHECK(get.header("accept") == "application/json");
    CHECK(get.header("user-agent") == user_agent);
    CHECK_FALSE(get.has_header("authorization"));

    // A POST with an empty key: no Authorization either.
    const auto keyless = client.perform(
        post_request(server.url("/v1/chat/completions"), R"({"model":"m"})", ""), control);
    REQUIRE(keyless.ok());
    REQUIRE(server.wait_for_requests(3));
    CHECK_FALSE(server.requests()[2].has_header("authorization"));

    // A GET with a key carries it.
    net::HttpRequest with_key = get_request(server.url("/v1/models"));
    with_key.key = "sk-models";
    REQUIRE(client.perform(with_key, control).ok());
    REQUIRE(server.wait_for_requests(4));
    CHECK(server.requests()[3].header("authorization") == "Bearer sk-models");
}

TEST_CASE(
    "http client: a response body over 16 MiB is a format outcome; a request over 8 MiB is "
    "refused before sending",
    "[http-client]") {
    test::HttpTestServer server;
    net::HttpClient client = make_client();
    test::ManualJobControl control;

    SECTION("17 MiB -> format with the core's message; exactly 16 MiB still arrives") {
        server.enqueue(test::ScriptedResponse::json(200, std::string(17u << 20, 'x')));
        const auto over = client.perform(get_request(server.url("/big")), control);
        CHECK_FALSE(over.ok());
        CHECK(over.kind == net::OutcomeKind::format);
        CHECK(over.message == "response larger than 16 MiB");
        CHECK_FALSE(over.body.has_value());
        CHECK(over.to_json()["kind"] == "format");

        std::string exact = "{\"pad\":\"";
        exact.append(net::kMaxResponseBytes - exact.size() - 2, 'y');
        exact += "\"}";
        REQUIRE(exact.size() == net::kMaxResponseBytes);
        server.enqueue(test::ScriptedResponse::json(200, exact));
        const auto at_cap = client.perform(get_request(server.url("/big")), control);
        INFO(at_cap.message);
        REQUIRE(at_cap.ok());
        CHECK((*at_cap.body)["pad"].get<std::string>().size() == net::kMaxResponseBytes - 10);
    }

    SECTION("8 MiB + 1 is invalidParams and the server sees nothing; 8 MiB is sent") {
        server.route("POST", "/v1/chat/completions", test::ScriptedResponse::json(200, "{}"));
        try {
            client.perform(post_request(server.url("/v1/chat/completions"),
                                        std::string(net::kMaxRequestBytes + 1, 'z')),
                           control);
            FAIL("an oversize body must be refused");
        } catch (const rpc::RpcError& e) {
            CHECK(e.code == rpc::codes::kInvalidParams);
            CHECK(e.data["field"] == "body");
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        CHECK(server.request_count() == 0);

        const auto sent = client.perform(post_request(server.url("/v1/chat/completions"),
                                                      std::string(net::kMaxRequestBytes, 'z')),
                                         control);
        INFO(sent.message);
        REQUIRE(sent.ok());
        REQUIRE(server.wait_for_requests(1));
        CHECK(server.requests()[0].body.size() == net::kMaxRequestBytes);
    }
}

TEST_CASE(
    "http client: Retry-After and ratelimit-* / x-ratelimit-*-minute headers are forwarded; "
    "others are not parsed",
    "[http-client]") {
    test::HttpTestServer server;
    net::HttpClient client = make_client();
    test::ManualJobControl control;

    SECTION("Retry-After in seconds with the IETF draft headers on a 429") {
        server.enqueue(test::ScriptedResponse::json(429, R"({"error":{"message":"slow down"}})")
                           .with_header("Retry-After", "7")
                           .with_header("RateLimit-Limit", "100")
                           .with_header("RateLimit-Remaining", "0")
                           .with_header("RateLimit-Reset", "30"));
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(outcome.kind == net::OutcomeKind::http);
        CHECK(*outcome.status == 429);
        REQUIRE(outcome.retry_after_seconds.has_value());
        CHECK(*outcome.retry_after_seconds == 7);
        REQUIRE(outcome.rate_limit.has_value());
        CHECK(outcome.rate_limit->limit == 100);
        CHECK(outcome.rate_limit->remaining == 0);
        CHECK(outcome.rate_limit->reset_seconds == 30);
        const auto wire = outcome.to_json();
        CHECK(wire["retryAfterSeconds"] == 7);
        CHECK(wire["rateLimit"]["limit"] == 100);
        CHECK(wire["rateLimit"]["remaining"] == 0);
        CHECK(wire["rateLimit"]["resetSeconds"] == 30);
    }

    SECTION("Retry-After as an HTTP date is converted to seconds from now") {
        server.enqueue(test::ScriptedResponse::json(503, R"({"error":{"message":"busy"}})")
                           .with_header("Retry-After", http_date_from_now(120)));
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(outcome.kind == net::OutcomeKind::http);
        CHECK(*outcome.status == 503);
        REQUIRE(outcome.retry_after_seconds.has_value());
        CHECK(*outcome.retry_after_seconds >= 100);
        CHECK(*outcome.retry_after_seconds <= 121);
    }

    SECTION("Retry-After: 0 and a date in the past are absent") {
        server.enqueue(test::ScriptedResponse::json(402, "{}").with_header("Retry-After", "0"));
        CHECK_FALSE(client.perform(get_request(server.url("/v1/models")), control)
                        .retry_after_seconds.has_value());
        server.enqueue(test::ScriptedResponse::json(402, "{}").with_header(
            "Retry-After", http_date_from_now(-600)));
        CHECK_FALSE(client.perform(get_request(server.url("/v1/models")), control)
                        .retry_after_seconds.has_value());
    }

    SECTION("OVHcloud's x-ratelimit-*-minute pair on a 200, without a reset") {
        server.enqueue(test::ScriptedResponse::json(200, R"({"choices":[]})")
                           .with_header("x-ratelimit-limit-minute", "60")
                           .with_header("x-ratelimit-remaining-minute", "59"));
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(outcome.ok());
        REQUIRE(outcome.rate_limit.has_value());
        CHECK(outcome.rate_limit->limit == 60);
        CHECK(outcome.rate_limit->remaining == 59);
        CHECK_FALSE(outcome.rate_limit->reset_seconds.has_value());
        const auto wire = outcome.to_json();
        CHECK(wire["ok"] == true);
        CHECK(wire["rateLimit"]["limit"] == 60);
        CHECK(wire["rateLimit"]["remaining"] == 59);
        CHECK_FALSE(wire["rateLimit"].contains("resetSeconds"));
        CHECK_FALSE(wire.contains("retryAfterSeconds"));
    }

    SECTION("the draft headers win over the -minute pair; a quota policy keeps its number") {
        server.enqueue(test::ScriptedResponse::json(200, "{}")
                           .with_header("ratelimit-limit", "100, 100;w=60")
                           .with_header("ratelimit-remaining", "41")
                           .with_header("x-ratelimit-limit-minute", "5")
                           .with_header("x-ratelimit-remaining-minute", "1"));
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(outcome.rate_limit.has_value());
        CHECK(outcome.rate_limit->limit == 100);
        CHECK(outcome.rate_limit->remaining == 41);
        CHECK_FALSE(outcome.rate_limit->reset_seconds.has_value());
    }

    SECTION("other forms are not parsed in 0.0.5") {
        server.enqueue(test::ScriptedResponse::json(200, "{}")
                           .with_header("x-ratelimit-limit-requests", "500")
                           .with_header("x-ratelimit-remaining-requests", "499")
                           .with_header("x-ratelimit-reset-requests", "1s")
                           .with_header("RateLimit", "limit=10, remaining=5, reset=7"));
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(outcome.ok());
        CHECK_FALSE(outcome.rate_limit.has_value());
        CHECK_FALSE(outcome.to_json().contains("rateLimit"));

        // A non-numeric draft header is skipped, the numeric ones kept.
        server.enqueue(test::ScriptedResponse::json(200, "{}")
                           .with_header("ratelimit-limit", "many")
                           .with_header("ratelimit-remaining", "3"));
        const auto partial = client.perform(get_request(server.url("/v1/models")), control);
        REQUIRE(partial.rate_limit.has_value());
        CHECK_FALSE(partial.rate_limit->limit.has_value());
        CHECK(partial.rate_limit->remaining == 3);
    }
}

TEST_CASE("http client: a 3xx is an http outcome and is not followed", "[http-client]") {
    test::HttpTestServer server;
    server.route("*", "/elsewhere*", test::ScriptedResponse::json(200, R"({"followed":true})"));
    net::HttpClient client = make_client();
    test::ManualJobControl control;

    for (const int status : {301, 302, 307, 308}) {
        server.clear_requests();
        server.enqueue(test::ScriptedResponse::redirect(status, server.url("/elsewhere/v1")));
        const auto outcome = client.perform(
            post_request(server.url("/v1/chat/completions"), R"({"model":"m"})", "sk-secret"),
            control);
        INFO("status " << status);
        CHECK_FALSE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::http);
        REQUIRE(outcome.status.has_value());
        CHECK(*outcome.status == status);
        REQUIRE(outcome.text.has_value());
        CHECK(outcome.text->find("moved") != std::string::npos);
        CHECK_FALSE(outcome.body.has_value());
        CHECK(outcome.message.empty());

        // The Location is never requested: the key travelled to the first address only.
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        const auto requests = server.requests();
        REQUIRE(requests.size() == 1);
        CHECK(requests[0].path == "/v1/chat/completions");
        CHECK(requests[0].header("authorization") == "Bearer sk-secret");
    }
}

TEST_CASE("http client: cancellation through the polled job flag ends the transfer within 100 ms",
          "[http-client]") {
    test::HttpTestServer server;
    server.enqueue(test::ScriptedResponse::json(200, "{}").with_delay(5000));
    net::HttpClient client = make_client();
    test::ManualJobControl control;

    std::promise<Clock::time_point> finished;
    auto finished_future = finished.get_future();
    net::AiOutcome outcome;
    std::thread worker([&] {
        outcome = client.perform(
            post_request(server.url("/v1/chat/completions"), R"({"model":"m"})"), control);
        finished.set_value(Clock::now());
    });

    // The request is at the server (which sleeps); Stop is pressed.
    REQUIRE(server.wait_for_requests(1));
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    const auto cancelled_at = Clock::now();
    control.cancel();
    REQUIRE(finished_future.wait_for(std::chrono::seconds(5)) == std::future_status::ready);
    const auto finished_at = finished_future.get();
    worker.join();

    const auto latency =
        std::chrono::duration_cast<std::chrono::milliseconds>(finished_at - cancelled_at).count();
    INFO("cancel latency " << latency << " ms");
    CHECK(latency <= 100);
    CHECK(outcome.kind == net::OutcomeKind::cancelled);
    CHECK_FALSE(outcome.message.empty());
    CHECK(outcome.to_json()["kind"] == "cancelled");
    CHECK(outcome.elapsed_ms >= 100);
    CHECK(control.phases() == std::vector<std::string>{"connecting", "waiting"});

    // A job already cancelled sends nothing at all.
    server.clear_requests();
    const auto refused = client.perform(get_request(server.url("/v1/models")), control);
    CHECK(refused.kind == net::OutcomeKind::cancelled);
    CHECK(server.request_count() == 0);

    // shutdown() ends later transfers the same way (the core is going down).
    test::ManualJobControl fresh;
    client.shutdown();
    CHECK(client.perform(get_request(server.url("/v1/models")), fresh).kind ==
          net::OutcomeKind::cancelled);
    CHECK(server.request_count() == 0);
}

TEST_CASE("http client: loopback hosts bypass the environment proxy (NOPROXY merged)",
          "[http-client]") {
    SECTION("merged_no_proxy keeps the user's list and adds the loopback names") {
        const auto env_of = [](std::map<std::string, std::string> values) -> net::EnvLookup {
            return [values = std::move(values)](const char* name) -> std::optional<std::string> {
                const auto it = values.find(name);
                if (it == values.end()) {
                    return std::nullopt;
                }
                return it->second;
            };
        };
        CHECK(net::merged_no_proxy(env_of({})) == "localhost,127.0.0.1,::1");
        CHECK(net::merged_no_proxy(env_of({{"no_proxy", ".corp.example,10.0.0.1"}})) ==
              ".corp.example,10.0.0.1,localhost,127.0.0.1,::1");
        CHECK(net::merged_no_proxy(env_of({{"NO_PROXY", "ai.standin.test"}})) ==
              "ai.standin.test,localhost,127.0.0.1,::1");
        CHECK(net::merged_no_proxy(env_of({{"no_proxy", "lower"}, {"NO_PROXY", "upper"}})) ==
              "lower,localhost,127.0.0.1,::1");
        CHECK(net::merged_no_proxy(env_of({{"no_proxy", "  "}})) == "localhost,127.0.0.1,::1");
        CHECK(net::merged_no_proxy(env_of({{"no_proxy", "*"}})) == "*");
        CHECK(net::merged_no_proxy(net::EnvLookup{}) == "localhost,127.0.0.1,::1");
    }

    SECTION("a loopback request stays direct whatever the proxy variables say") {
        test::HttpTestServer server;
        server.route("GET", "/v1/models", test::ScriptedResponse::json(200, R"({"data":[]})"));
        const auto http_proxy = test::with_env("http_proxy", "http://127.0.0.1:1");
        const auto https_proxy = test::with_env("https_proxy", "http://127.0.0.1:1");
        const auto all_proxy = test::with_env("all_proxy", "http://127.0.0.1:1");
        const auto no_proxy = test::with_env("no_proxy", std::nullopt);
        const auto no_proxy_upper = test::with_env("NO_PROXY", std::nullopt);
        net::HttpClient client = make_client();
        test::ManualJobControl control;

        const auto direct = client.perform(get_request(server.url("/v1/models")), control);
        INFO(direct.message);
        REQUIRE(direct.ok());
        REQUIRE(server.wait_for_requests(1));

        const auto localhost = client.perform(
            get_request("http://localhost:" + std::to_string(server.port()) + "/v1/models"),
            control);
        INFO(localhost.message);
        CHECK(localhost.ok());

        // A hosted name goes through the (unreachable) proxy - offline, nothing at the server -
        // unless the environment's own no_proxy names it (the journeys' recipe).
        net::HttpRequest hosted =
            get_request("http://ai.standin.test:" + std::to_string(server.port()) + "/v1/models");
        hosted.resolve_entries = {"ai.standin.test:" + std::to_string(server.port()) +
                                  ":127.0.0.1"};
        server.clear_requests();
        const auto proxied = client.perform(hosted, control);
        CHECK(proxied.kind == net::OutcomeKind::offline);
        CHECK(server.request_count() == 0);
        {
            const auto exempt = test::with_env("no_proxy", "ai.standin.test");
            const auto reached = client.perform(hosted, control);
            INFO(reached.message);
            REQUIRE(reached.ok());
            REQUIRE(server.wait_for_requests(1));
            CHECK(server.requests()[0].header("host") ==
                  "ai.standin.test:" + std::to_string(server.port()));
        }
    }
}

TEST_CASE("http client: libcurl is initialised lazily and cleaned up only when it ran",
          "[http-client]") {
    net::global_cleanup_if_ran();
    CHECK_FALSE(net::global_init_ran());
    net::global_cleanup_if_ran();  // nothing ran: nothing to clean, no harm
    CHECK_FALSE(net::global_init_ran());

    net::global_init_once();
    CHECK(net::global_init_ran());
    net::global_init_once();  // idempotent
    CHECK(net::global_init_ran());
    net::global_cleanup_if_ran();
    CHECK_FALSE(net::global_init_ran());

    // A transfer initialises on demand and works again after a cleanup.
    test::HttpTestServer server;
    server.route("GET", "/v1/models", test::ScriptedResponse::json(200, "{}"));
    net::HttpClient client = make_client();
    test::ManualJobControl control;
    REQUIRE(client.perform(get_request(server.url("/v1/models")), control).ok());
    CHECK(net::global_init_ran());
    net::global_cleanup_if_ran();
    CHECK_FALSE(net::global_init_ran());
    REQUIRE(client.perform(get_request(server.url("/v1/models")), control).ok());
    CHECK(net::global_init_ran());
}
