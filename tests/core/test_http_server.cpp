// Self-test of the in-process HTTP test servers of feature 005 (T010): the plain uWS::App
// server of test_http_server.hpp (routes, queued answers, recorded requests, delays, 3xx,
// large and non-JSON bodies, dropped connections, stop while an answer is pending) and the
// OpenSSL HTTPS fixture of test_tls_fixture.hpp (generated CA, verification with the right,
// the wrong and no CA, the TLS 1.0/1.1-only configuration, extra SAN names). The core's HTTP
// client tests (T015, T016) build on both.
#include "test_http_server.hpp"

#include "test_tls_fixture.hpp"
#include "ws_test_client.hpp"

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>

using namespace mfbe;
using Clock = std::chrono::steady_clock;

namespace {

long long elapsed_ms(Clock::time_point since) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - since).count();
}

}  // namespace

TEST_CASE("http_server: GET and POST round trips are answered and recorded", "[http-server]") {
    test::HttpTestServer server;
    REQUIRE(server.port() > 0);
    CHECK(server.base_url() == "http://127.0.0.1:" + std::to_string(server.port()));
    CHECK(server.url("/v1/models") == server.base_url() + "/v1/models");

    server.route("GET", "/v1/models", test::ScriptedResponse::json(200, R"({"data":[]})"));
    server.route("POST", "/v1/chat/completions",
                 test::ScriptedResponse::json(200, R"({"id":"chatcmpl-1"})"));

    auto models =
        test::http_request(server.port(), "GET", "/v1/models?limit=5",
                           {{"Authorization", "Bearer sk-test"}, {"Accept", "application/json"}});
    CHECK(models.status == 200);
    CHECK(models.headers["content-type"] == "application/json");
    CHECK(models.body == R"({"data":[]})");

    const std::string request_body = R"({"model":"standin-chat","messages":[]})";
    auto completion = test::http_request(server.port(), "POST", "/v1/chat/completions",
                                         {{"Content-Type", "application/json"}}, request_body);
    CHECK(completion.status == 200);
    CHECK(completion.body == R"({"id":"chatcmpl-1"})");

    REQUIRE(server.wait_for_requests(2));
    const auto requests = server.requests();
    REQUIRE(requests.size() == 2);
    CHECK(requests[0].method == "GET");
    CHECK(requests[0].path == "/v1/models");
    CHECK(requests[0].query == "limit=5");
    CHECK(requests[0].header("Authorization") == "Bearer sk-test");
    CHECK(requests[0].header("accept") == "application/json");
    CHECK(requests[0].has_header("host"));
    CHECK_FALSE(requests[0].has_header("cookie"));
    CHECK(requests[0].body.empty());
    CHECK(requests[1].method == "POST");
    CHECK(requests[1].path == "/v1/chat/completions");
    CHECK(requests[1].query.empty());
    CHECK(requests[1].header("content-type") == "application/json");
    CHECK(requests[1].header("content-length") == std::to_string(request_body.size()));
    CHECK(requests[1].body == request_body);

    server.clear_requests();
    CHECK(server.request_count() == 0);
}

TEST_CASE("http_server: queued answers come first, then the routes, then a loud 500",
          "[http-server]") {
    test::HttpTestServer server;
    server.route("*", "/v1/*", test::ScriptedResponse::json(200, R"({"route":true})"));
    server.enqueue(test::ScriptedResponse::json(429, R"({"error":{"message":"slow down"}})")
                       .with_header("Retry-After", "7")
                       .with_header("ratelimit-remaining", "0"));
    CHECK(server.queued() == 1);

    // The queued 429 answers whatever the route.
    auto limited = test::http_request(server.port(), "POST", "/v1/chat/completions",
                                      {{"Content-Type", "application/json"}}, "{}");
    CHECK(limited.status == 429);
    CHECK(limited.headers["retry-after"] == "7");
    CHECK(limited.headers["ratelimit-remaining"] == "0");
    CHECK(limited.headers["content-type"] == "application/json");
    CHECK(limited.body == R"({"error":{"message":"slow down"}})");
    CHECK(server.queued() == 0);

    // Then the prefix route.
    auto routed = test::http_request(server.port(), "GET", "/v1/models");
    CHECK(routed.status == 200);
    CHECK(routed.body == R"({"route":true})");

    // A request nobody scripted fails loudly instead of hanging (as the stand-in's empty queue).
    auto unscripted = test::http_request(server.port(), "GET", "/nothing/here");
    CHECK(unscripted.status == 500);
    CHECK(unscripted.body.find("no scripted answer for GET /nothing/here") != std::string::npos);

    // An exact route beats the prefix route whatever the registration order, and a later
    // route for the same method and path replaces the earlier one.
    server.route("GET", "/v1/models", test::ScriptedResponse::text(200, "plain"));
    server.route("GET", "/v1/models", test::ScriptedResponse::text(503, "later"));
    auto replaced = test::http_request(server.port(), "GET", "/v1/models");
    CHECK(replaced.status == 503);
    CHECK(replaced.body == "later");
    CHECK(test::http_request(server.port(), "POST", "/v1/models").body == R"({"route":true})");

    // A longer prefix beats a shorter one; an explicit method beats "*".
    server.route("*", "/v1/chat/*", test::ScriptedResponse::text(200, "chat"));
    server.route("POST", "/v1/chat/*", test::ScriptedResponse::text(201, "posted chat"));
    CHECK(test::http_request(server.port(), "GET", "/v1/chat/completions").body == "chat");
    auto posted = test::http_request(server.port(), "POST", "/v1/chat/completions", {}, "{}");
    CHECK(posted.status == 201);
    CHECK(posted.body == "posted chat");

    server.clear_scripts();
    CHECK(test::http_request(server.port(), "GET", "/v1/models").status == 500);
    CHECK(server.request_count() == 8);
}

TEST_CASE(
    "http_server: a delayed answer, a 3xx with Location, a 17 MiB body, a non-JSON "
    "body and a dropped connection",
    "[http-server]") {
    test::HttpTestServer server;

    SECTION("the answer waits delay_ms before the status line goes out") {
        server.enqueue(test::ScriptedResponse::json(200, "{}").with_delay(300));
        const auto started = Clock::now();
        auto slow = test::http_request(server.port(), "GET", "/slow");
        CHECK(elapsed_ms(started) >= 250);
        CHECK(slow.status == 200);
        CHECK(slow.body == "{}");
    }

    SECTION("a redirect carries its Location header and is not followed by the raw client") {
        server.enqueue(test::ScriptedResponse::redirect(302, "http://127.0.0.1:1/elsewhere"));
        auto moved = test::http_request(server.port(), "POST", "/v1/chat/completions",
                                        {{"Content-Type", "application/json"}}, "{}");
        CHECK(moved.status == 302);
        CHECK(moved.headers["location"] == "http://127.0.0.1:1/elsewhere");
        CHECK(server.request_count() == 1);
    }

    SECTION("a generated 17 MiB body arrives whole") {
        const std::string large(17u << 20, 'x');
        server.enqueue(test::ScriptedResponse::json(200, large));
        auto big = test::http_request(server.port(), "GET", "/big");
        CHECK(big.status == 200);
        CHECK(big.headers["content-length"] == std::to_string(large.size()));
        CHECK(big.body.size() == large.size());
        CHECK(big.body == large);
    }

    SECTION("a non-JSON body keeps its media type") {
        server.enqueue(test::ScriptedResponse::text(
            400, "<html><title>Bad Request</title><pre>no JSON here</pre></html>",
            "text/html; charset=utf-8"));
        auto html = test::http_request(server.port(), "GET", "/html");
        CHECK(html.status == 400);
        CHECK(html.headers["content-type"] == "text/html; charset=utf-8");
        CHECK(html.body.find("<pre>no JSON here</pre>") != std::string::npos);
    }

    SECTION("a dropped connection gives the client no answer at all") {
        server.enqueue(test::ScriptedResponse::drop());
        CHECK_THROWS_AS(test::http_request(server.port(), "GET", "/dropped"), std::runtime_error);
        CHECK(server.wait_for_requests(1));
    }
}

TEST_CASE("http_server: stop() ends the loop while a delayed answer is still pending",
          "[http-server]") {
    auto server = std::make_unique<test::HttpTestServer>();
    const int port = server->port();
    server->enqueue(test::ScriptedResponse::json(200, "{}").with_delay(10000));
    std::thread client([port] {
        try {
            (void)test::http_request(port, "GET", "/never");
        } catch (const std::runtime_error&) {
            // the connection is closed by stop() before any answer
        }
    });
    REQUIRE(server->wait_for_requests(1));
    const auto started = Clock::now();
    server->stop();
    CHECK(elapsed_ms(started) < 2000);
    server->stop();  // idempotent
    server.reset();
    client.join();
}

#if MFBE_TEST_TLS

namespace {

// A blocking OpenSSL client for the fixture: verifies the server against `ca_file` (none when
// empty) and the name `host`, then sends one GET and reads the whole answer.
struct TlsClientOptions {
    std::filesystem::path ca_file;
    int min_version = TLS1_2_VERSION;
    int max_version = TLS1_3_VERSION;
    int security_level = -1;  // -1: the library default
    std::string host = "127.0.0.1";
    bool host_is_ip = true;
};

struct TlsClientResult {
    bool connected = false;
    long verify_result = -1;
    int version = 0;
    std::string error;
    std::string raw;  // the HTTP answer as received
};

struct LoopbackSocket : test::TcpClient {
    int fd() const { return sock_; }
};

std::string openssl_error_text() {
    const unsigned long code = ERR_peek_last_error();
    if (code == 0) {
        return "no OpenSSL error recorded";
    }
    char buffer[256];
    ERR_error_string_n(code, buffer, sizeof(buffer));
    ERR_clear_error();
    return buffer;
}

TlsClientResult tls_get(int port, const TlsClientOptions& options, const std::string& path) {
    TlsClientResult result;
    SSL_CTX* ctx = SSL_CTX_new(TLS_client_method());
    REQUIRE(ctx != nullptr);
    if (options.security_level >= 0) {
        SSL_CTX_set_security_level(ctx, options.security_level);
    }
    REQUIRE(SSL_CTX_set_min_proto_version(ctx, options.min_version) == 1);
    REQUIRE(SSL_CTX_set_max_proto_version(ctx, options.max_version) == 1);
    SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, nullptr);
    if (!options.ca_file.empty()) {
        REQUIRE(SSL_CTX_load_verify_file(ctx, options.ca_file.string().c_str()) == 1);
    }

    LoopbackSocket socket;
    socket.connect(port);
    SSL* ssl = SSL_new(ctx);
    REQUIRE(ssl != nullptr);
    SSL_set_fd(ssl, socket.fd());
    if (options.host_is_ip) {
        REQUIRE(X509_VERIFY_PARAM_set1_ip_asc(SSL_get0_param(ssl), options.host.c_str()) == 1);
    } else {
        REQUIRE(SSL_set1_host(ssl, options.host.c_str()) == 1);
    }

    const int rc = SSL_connect(ssl);
    result.verify_result = SSL_get_verify_result(ssl);
    if (rc != 1) {
        result.error = openssl_error_text();
    } else {
        result.connected = true;
        result.version = SSL_version(ssl);
        const std::string request = "GET " + path +
                                    " HTTP/1.1\r\nHost: 127.0.0.1:" + std::to_string(port) +
                                    "\r\nConnection: close\r\n\r\n";
        if (SSL_write(ssl, request.data(), static_cast<int>(request.size())) > 0) {
            char chunk[16384];
            for (;;) {
                const int n = SSL_read(ssl, chunk, sizeof(chunk));
                if (n <= 0) {
                    break;
                }
                result.raw.append(chunk, static_cast<std::size_t>(n));
            }
        }
        ERR_clear_error();
    }
    SSL_free(ssl);
    SSL_CTX_free(ctx);
    return result;
}

}  // namespace

#endif  // MFBE_TEST_TLS

TEST_CASE(
    "tls_fixture: a client trusting the generated CA verifies 127.0.0.1 and gets the "
    "scripted answer",
    "[tls-fixture]") {
    if (!test::TlsTestServer::available()) {
        SKIP("manual: test CA not installed in the runner's user store");
    }
#if MFBE_TEST_TLS
    test::TlsTestServer server;
    REQUIRE(server.port() > 0);
    CHECK(server.base_url() == "https://127.0.0.1:" + std::to_string(server.port()));

    // The PEM files exist and the CA is distinct from the unrelated one.
    const std::string ca = test::read_text(server.ca_file());
    CHECK(ca.rfind("-----BEGIN CERTIFICATE-----", 0) == 0);
    CHECK(test::read_text(server.other_ca_file()).rfind("-----BEGIN CERTIFICATE-----", 0) == 0);
    CHECK(test::read_text(server.other_ca_file()) != ca);
    CHECK(test::read_text(server.server_cert_file()).rfind("-----BEGIN CERTIFICATE-----", 0) == 0);
    CHECK(test::read_text(server.server_key_file()).find("PRIVATE KEY-----") != std::string::npos);

    server.enqueue(test::ScriptedResponse::json(200, R"({"ok":true})").with_header("X-Test", "1"));
    TlsClientOptions trusting;
    trusting.ca_file = server.ca_file();
    const auto result = tls_get(server.port(), trusting, "/v1/models?all=1");
    INFO(result.error);
    REQUIRE(result.connected);
    CHECK(result.verify_result == X509_V_OK);
    CHECK(result.version >= TLS1_2_VERSION);
    auto answer = test::parse_http_response(result.raw);
    CHECK(answer.status == 200);
    CHECK(answer.headers["x-test"] == "1");
    CHECK(answer.headers["content-type"] == "application/json");
    CHECK(answer.headers["connection"] == "close");
    CHECK(answer.body == R"({"ok":true})");

    REQUIRE(server.wait_for_requests(1));
    const auto requests = server.requests();
    REQUIRE(requests.size() == 1);
    CHECK(requests[0].method == "GET");
    CHECK(requests[0].path == "/v1/models");
    CHECK(requests[0].query == "all=1");
    CHECK(requests[0].header("host") == "127.0.0.1:" + std::to_string(server.port()));
    CHECK(server.handshake_failures() == 0);

    // The default answer serves once the queue is empty.
    server.set_default(test::ScriptedResponse::text(503, "down", "text/plain"));
    const auto second = tls_get(server.port(), trusting, "/v1/chat/completions");
    REQUIRE(second.connected);
    auto down = test::parse_http_response(second.raw);
    CHECK(down.status == 503);
    CHECK(down.body == "down");
    CHECK(server.request_count() == 2);
#endif
}

TEST_CASE(
    "tls_fixture: another CA or no CA fails verification and the server counts the "
    "handshake failure",
    "[tls-fixture]") {
    if (!test::TlsTestServer::available()) {
        SKIP("manual: test CA not installed in the runner's user store");
    }
#if MFBE_TEST_TLS
    test::TlsTestServer server;
    server.enqueue(test::ScriptedResponse::json(200, "{}"));

    TlsClientOptions wrong_ca;
    wrong_ca.ca_file = server.other_ca_file();
    const auto untrusted = tls_get(server.port(), wrong_ca, "/");
    CHECK_FALSE(untrusted.connected);
    CHECK(untrusted.verify_result != X509_V_OK);
    CHECK(untrusted.raw.empty());
    REQUIRE(server.wait_for_connections(1));
    CHECK(server.handshake_failures() == 1);
    CHECK_FALSE(server.last_handshake_error().empty());

    TlsClientOptions no_ca;
    const auto bare = tls_get(server.port(), no_ca, "/");
    CHECK_FALSE(bare.connected);
    CHECK(bare.verify_result != X509_V_OK);
    REQUIRE(server.wait_for_connections(2));
    CHECK(server.handshake_failures() == 2);

    // Nothing reached the HTTP layer; the queued answer is still there for a trusted client.
    CHECK(server.request_count() == 0);
    TlsClientOptions trusting;
    trusting.ca_file = server.ca_file();
    const auto trusted = tls_get(server.port(), trusting, "/");
    REQUIRE(trusted.connected);
    CHECK(test::parse_http_response(trusted.raw).body == "{}");
    CHECK(server.handshake_failures() == 2);
#endif
}

TEST_CASE(
    "tls_fixture: a TLS 1.0/1.1-only server is refused by a TLS 1.2 client and reached by "
    "a legacy one",
    "[tls-fixture]") {
    if (!test::TlsTestServer::available()) {
        SKIP("manual: test CA not installed in the runner's user store");
    }
#if MFBE_TEST_TLS
    test::TlsServerOptions legacy;
    legacy.min_version = test::TlsVersion::tls1_0;
    legacy.max_version = test::TlsVersion::tls1_1;
    test::TlsTestServer server(legacy);
    server.set_default(test::ScriptedResponse::json(200, R"({"legacy":true})"));

    TlsClientOptions modern;
    modern.ca_file = server.ca_file();
    const auto refused = tls_get(server.port(), modern, "/");
    CHECK_FALSE(refused.connected);
    REQUIRE(server.wait_for_connections(1));
    CHECK(server.handshake_failures() == 1);
    CHECK(server.request_count() == 0);

    // Only a client that still allows the old versions (security level 0) gets through -
    // which proves the server really offers nothing newer than TLS 1.1.
    TlsClientOptions old;
    old.ca_file = server.ca_file();
    old.min_version = TLS1_VERSION;
    old.max_version = TLS1_1_VERSION;
    old.security_level = 0;
    const auto reached = tls_get(server.port(), old, "/");
    INFO(reached.error);
    REQUIRE(reached.connected);
    CHECK(reached.version == TLS1_1_VERSION);
    CHECK(reached.verify_result == X509_V_OK);
    CHECK(test::parse_http_response(reached.raw).body == R"({"legacy":true})");
    CHECK(server.request_count() == 1);
#endif
}

TEST_CASE("tls_fixture: extra DNS names are in the certificate's subjectAltName", "[tls-fixture]") {
    if (!test::TlsTestServer::available()) {
        SKIP("manual: test CA not installed in the runner's user store");
    }
#if MFBE_TEST_TLS
    test::TlsServerOptions options;
    options.dns_names = {"ai.standin.test"};
    test::TlsTestServer server(options);
    server.set_default(test::ScriptedResponse::json(200, "{}"));

    TlsClientOptions by_name;
    by_name.ca_file = server.ca_file();
    by_name.host = "ai.standin.test";
    by_name.host_is_ip = false;
    const auto named = tls_get(server.port(), by_name, "/");
    INFO(named.error);
    CHECK(named.connected);
    CHECK(named.verify_result == X509_V_OK);

    TlsClientOptions localhost;
    localhost.ca_file = server.ca_file();
    localhost.host = "localhost";
    localhost.host_is_ip = false;
    CHECK(tls_get(server.port(), localhost, "/").connected);

    TlsClientOptions other_name;
    other_name.ca_file = server.ca_file();
    other_name.host = "example.invalid";
    other_name.host_is_ip = false;
    const auto mismatch = tls_get(server.port(), other_name, "/");
    CHECK_FALSE(mismatch.connected);
    CHECK(mismatch.verify_result == X509_V_ERR_HOSTNAME_MISMATCH);
#endif
}
