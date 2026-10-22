// TLS and CA selection of the core's HTTP client (feature 005, T016; review decision F3;
// resource-formats §C "Run-time selection on Linux"): the selection order as a pure function
// of the environment and the file system, and the client against the OpenSSL HTTPS fixture of
// test_tls_fixture.hpp - `tls` without its CA, `ok` with SSL_CERT_FILE pointing at the test CA,
// a TLS 1.0/1.1-only server refused. No real host is contacted (FR-102). On Windows (Schannel,
// no OpenSSL linked) the HTTPS cases skip with the explicit "manual" mark.
#include "test_http_server.hpp"
#include "test_support.hpp"
#include "test_tls_fixture.hpp"

#include <mfbe/http_client.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

namespace fs = std::filesystem;

net::EnvLookup env_of(std::map<std::string, std::string> values) {
    return [values = std::move(values)](const char* name) -> std::optional<std::string> {
        const auto it = values.find(name);
        if (it == values.end()) {
            return std::nullopt;
        }
        return it->second;
    };
}

fs::path touch(const fs::path& path, const std::string& text = "-----BEGIN CERTIFICATE-----\n") {
    test::write_text(path, text);
    return path;
}

std::string text_of(const fs::path& path) {
    return platform::utf8_from_path(path);
}

net::HttpRequest get_request(const std::string& url) {
    net::HttpRequest request;
    request.method = "GET";
    request.url = url;
    return request;
}

net::HttpClient make_client(
    fs::path resources_dir = platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR),
    fs::path probe_root = {}) {
    net::HttpClientOptions options;
    options.resources_dir = std::move(resources_dir);
    options.probe_root = std::move(probe_root);
    return net::HttpClient(std::move(options));
}

}  // namespace

TEST_CASE(
    "http client: CA bundle selection order on Linux (env, distro paths, shipped; a missing "
    "env file is skipped)",
    "[http-client][tls]") {
    test::TempDir root("mfbe-ca-root");
    test::TempDir resources("mfbe-ca-resources");
    const fs::path shipped = touch(resources.path() / "certs" / "cacert.pem");
    using net::CaPlatform;
    using net::CaSource;
    const CaPlatform linux_like = CaPlatform::linux_like;

    SECTION("nothing set and no distribution bundle: the shipped file, else none") {
        const auto selected =
            net::select_ca_bundle(env_of({}), root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::shipped);
        CHECK(selected.path == shipped);
        CHECK(selected.missing_env_files.empty());

        test::TempDir bare("mfbe-ca-bare");
        const auto none = net::select_ca_bundle(env_of({}), root.path(), bare.path(), linux_like);
        CHECK(none.source == CaSource::none);
        CHECK(none.path == bare.path() / "certs" / "cacert.pem");  // the missing bundle, named
        CHECK(none.missing_env_files.empty());
    }

    SECTION("the four distribution paths are probed in order under the root") {
        const fs::path cert_pem = touch(root.path() / "etc" / "ssl" / "cert.pem");
        auto selected =
            net::select_ca_bundle(env_of({}), root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::distribution);
        CHECK(selected.path == cert_pem);

        const fs::path suse = touch(root.path() / "etc" / "ssl" / "ca-bundle.pem");
        selected = net::select_ca_bundle(env_of({}), root.path(), resources.path(), linux_like);
        CHECK(selected.path == suse);

        const fs::path fedora =
            touch(root.path() / "etc" / "pki" / "tls" / "certs" / "ca-bundle.crt");
        selected = net::select_ca_bundle(env_of({}), root.path(), resources.path(), linux_like);
        CHECK(selected.path == fedora);

        const fs::path debian =
            touch(root.path() / "etc" / "ssl" / "certs" / "ca-certificates.crt");
        selected = net::select_ca_bundle(env_of({}), root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::distribution);
        CHECK(selected.path == debian);
        CHECK(selected.missing_env_files.empty());

        // A directory at a probed path is not a regular file and is skipped.
        test::TempDir other("mfbe-ca-other");
        fs::create_directories(other.path() / "etc" / "ssl" / "certs" / "ca-certificates.crt");
        const fs::path fallback = touch(other.path() / "etc" / "ssl" / "cert.pem");
        CHECK(net::select_ca_bundle(env_of({}), other.path(), resources.path(), linux_like).path ==
              fallback);
    }

    SECTION("the environment wins: SSL_CERT_FILE, then CURL_CA_BUNDLE, then the distribution") {
        const fs::path debian =
            touch(root.path() / "etc" / "ssl" / "certs" / "ca-certificates.crt");
        const fs::path corporate = touch(root.path() / "corporate-roots.pem");
        const fs::path own = touch(root.path() / "own-roots.pem");

        auto selected = net::select_ca_bundle(env_of({{"CURL_CA_BUNDLE", text_of(corporate)}}),
                                              root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::curl_ca_bundle);
        CHECK(selected.path == corporate);

        selected = net::select_ca_bundle(
            env_of({{"SSL_CERT_FILE", text_of(own)}, {"CURL_CA_BUNDLE", text_of(corporate)}}),
            root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::ssl_cert_file);
        CHECK(selected.path == own);
        CHECK(selected.missing_env_files.empty());

        // Surrounding whitespace in the value is tolerated; a blank value is "unset".
        selected = net::select_ca_bundle(env_of({{"SSL_CERT_FILE", " " + text_of(own) + " "}}),
                                         root.path(), resources.path(), linux_like);
        CHECK(selected.path == own);
        selected = net::select_ca_bundle(env_of({{"SSL_CERT_FILE", "   "}, {"CURL_CA_BUNDLE", ""}}),
                                         root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::distribution);
        CHECK(selected.path == debian);
        CHECK(selected.missing_env_files.empty());
    }

    SECTION("a set variable naming no readable file is skipped and reported") {
        const fs::path debian =
            touch(root.path() / "etc" / "ssl" / "certs" / "ca-certificates.crt");
        const fs::path corporate = touch(root.path() / "corporate-roots.pem");
        const fs::path missing = root.path() / "no-such-roots.pem";

        auto selected = net::select_ca_bundle(
            env_of({{"SSL_CERT_FILE", text_of(missing)}, {"CURL_CA_BUNDLE", text_of(corporate)}}),
            root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::curl_ca_bundle);
        CHECK(selected.path == corporate);
        REQUIRE(selected.missing_env_files.size() == 1);
        CHECK(selected.missing_env_files[0] == missing);

        const fs::path folder = root.path() / "a-folder";
        fs::create_directories(folder);
        selected = net::select_ca_bundle(
            env_of({{"SSL_CERT_FILE", text_of(missing)}, {"CURL_CA_BUNDLE", text_of(folder)}}),
            root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::distribution);
        CHECK(selected.path == debian);
        REQUIRE(selected.missing_env_files.size() == 2);
        CHECK(selected.missing_env_files[0] == missing);
        CHECK(selected.missing_env_files[1] == folder);

        // Without a distribution bundle the shipped file is the last resort, still reported.
        test::TempDir empty_root("mfbe-ca-empty");
        selected = net::select_ca_bundle(env_of({{"SSL_CERT_FILE", text_of(missing)}}),
                                         empty_root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::shipped);
        CHECK(selected.path == shipped);
        CHECK(selected.missing_env_files == std::vector<fs::path>{missing});
    }

    SECTION("macOS is native unless SSL_CERT_FILE names a readable file; Windows always native") {
        const fs::path own = touch(root.path() / "own-roots.pem");
        const fs::path missing = root.path() / "no-such-roots.pem";
        touch(root.path() / "etc" / "ssl" / "certs" / "ca-certificates.crt");

        auto mac =
            net::select_ca_bundle(env_of({}), root.path(), resources.path(), CaPlatform::macos);
        CHECK(mac.source == CaSource::native);
        CHECK(mac.path.empty());

        mac = net::select_ca_bundle(env_of({{"SSL_CERT_FILE", text_of(own)}}), root.path(),
                                    resources.path(), CaPlatform::macos);
        CHECK(mac.source == CaSource::ssl_cert_file);
        CHECK(mac.path == own);

        // CURL_CA_BUNDLE and the distribution paths are a Linux matter.
        mac = net::select_ca_bundle(env_of({{"CURL_CA_BUNDLE", text_of(own)}}), root.path(),
                                    resources.path(), CaPlatform::macos);
        CHECK(mac.source == CaSource::native);

        mac = net::select_ca_bundle(env_of({{"SSL_CERT_FILE", text_of(missing)}}), root.path(),
                                    resources.path(), CaPlatform::macos);
        CHECK(mac.source == CaSource::native);
        CHECK(mac.missing_env_files == std::vector<fs::path>{missing});

        auto win = net::select_ca_bundle(
            env_of({{"SSL_CERT_FILE", text_of(own)}, {"CURL_CA_BUNDLE", text_of(own)}}),
            root.path(), resources.path(), CaPlatform::windows);
        CHECK(win.source == CaSource::native);
        CHECK(win.path.empty());
        CHECK(win.missing_env_files.empty());
    }

    SECTION("the path compiled into libcurl is never what is used") {
        // The build host's default (an Ubuntu path on the CI runners) is read for the record
        // only: the selection under a temporary root never hands it out.
        const std::optional<std::string> compiled_in = net::compiled_in_ca_info();
        const auto selected =
            net::select_ca_bundle(env_of({}), root.path(), resources.path(), linux_like);
        CHECK(selected.source == CaSource::shipped);
        if (compiled_in) {
            CHECK(text_of(selected.path) != *compiled_in);
        }
        // Against the real file system the Linux client always has an explicit file (a
        // distribution bundle or the shipped one); the other platforms answer native.
        const auto real = net::select_ca_bundle(
            net::process_env(), fs::path{}, platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR));
        if (net::current_ca_platform() == CaPlatform::linux_like) {
            CHECK((real.source == CaSource::distribution || real.source == CaSource::shipped ||
                   real.source == CaSource::ssl_cert_file ||
                   real.source == CaSource::curl_ca_bundle));
            CHECK(fs::is_regular_file(real.path));
        } else {
            CHECK((real.source == CaSource::native || real.source == CaSource::ssl_cert_file));
        }
    }
}

TEST_CASE(
    "http client: a self-signed HTTPS stand-in is a tls outcome without its CA and ok with "
    "SSL_CERT_FILE; TLS below 1.2 and non-http schemes are refused",
    "[http-client][tls]") {
    if (!test::TlsTestServer::available()) {
        SKIP("manual: test CA not installed in the runner's user store");
    }
#if MFBE_TEST_TLS
    // The process environment decides the trust anchors: start from a clean slate.
    const auto no_ssl_cert_file = test::with_env("SSL_CERT_FILE", std::nullopt);
    const auto no_curl_ca_bundle = test::with_env("CURL_CA_BUNDLE", std::nullopt);
    const auto no_https_proxy = test::with_env("https_proxy", std::nullopt);
    const auto no_https_proxy_upper = test::with_env("HTTPS_PROXY", std::nullopt);
    const auto no_all_proxy = test::with_env("all_proxy", std::nullopt);
    const auto no_all_proxy_upper = test::with_env("ALL_PROXY", std::nullopt);
    test::ManualJobControl control;

    SECTION("without its CA the certificate is refused as tls and nothing reaches HTTP") {
        test::TlsTestServer server;
        server.set_default(test::ScriptedResponse::json(200, R"({"data":[]})"));
        net::HttpClient client = make_client();
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        CHECK_FALSE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::tls);
        CHECK_FALSE(outcome.message.empty());
        CHECK_FALSE(outcome.status.has_value());
        CHECK_FALSE(outcome.body.has_value());
        CHECK(outcome.to_json()["kind"] == "tls");
        // libcurl (OpenSSL) completes the handshake and then judges the certificate, so the
        // fixture sees a connection that is closed before any request - never a request.
        REQUIRE(server.wait_for_connections(1));
        CHECK(server.request_count() == 0);

        // The wrong CA is as good as none.
        const auto other_ca = test::with_env("SSL_CERT_FILE", text_of(server.other_ca_file()));
        const auto wrong = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(wrong.kind == net::OutcomeKind::tls);
        CHECK_FALSE(wrong.message.empty());
        REQUIRE(server.wait_for_connections(2));
        CHECK(server.request_count() == 0);
    }

    SECTION("with SSL_CERT_FILE pointing at the test CA the exchange is ok") {
        test::TlsTestServer server;
        server.enqueue(test::ScriptedResponse::json(200, R"({"data":[{"id":"standin-chat"}]})")
                           .with_header("ratelimit-remaining", "9"));
        const auto trust = test::with_env("SSL_CERT_FILE", text_of(server.ca_file()));
        net::HttpClient client = make_client();

        // The test CA is in no system store: an ok here proves the explicit CA file was used
        // and not the path compiled into libcurl.
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        INFO(outcome.message);
        REQUIRE(outcome.ok());
        CHECK(*outcome.status == 200);
        CHECK((*outcome.body)["data"][0]["id"] == "standin-chat");
        REQUIRE(outcome.rate_limit.has_value());
        CHECK(outcome.rate_limit->remaining == 9);
        REQUIRE(server.wait_for_requests(1));
        const auto request = server.requests()[0];
        CHECK(request.method == "GET");
        CHECK(request.path == "/v1/models");
        CHECK(request.header("accept") == "application/json");
        CHECK_FALSE(request.has_header("authorization"));
        CHECK(server.handshake_failures() == 0);

        // A POST with a key over TLS: the service's error is an http outcome as over plain
        // http.
        server.enqueue(
            test::ScriptedResponse::json(429, R"({"error":{"message":"Rate limit exceeded"}})")
                .with_header("Retry-After", "5"));
        net::HttpRequest post;
        post.method = "POST";
        post.url = server.url("/v1/chat/completions");
        post.body = R"({"model":"m","messages":[]})";
        post.key = "sk-tls";
        const auto limited = client.perform(post, control);
        CHECK(limited.kind == net::OutcomeKind::http);
        CHECK(*limited.status == 429);
        CHECK(*limited.retry_after_seconds == 5);
        REQUIRE(server.wait_for_requests(2));
        CHECK(server.requests()[1].header("authorization") == "Bearer sk-tls");
        CHECK(server.requests()[1].body == post.body);
    }

    SECTION("host-name verification: a name outside the certificate is tls, a listed one ok") {
        test::TlsServerOptions options;
        options.dns_names = {"ai.standin.test"};
        test::TlsTestServer server(options);
        server.set_default(test::ScriptedResponse::json(200, "{}"));
        const auto trust = test::with_env("SSL_CERT_FILE", text_of(server.ca_file()));
        const auto no_proxy = test::with_env("no_proxy", "ai.standin.test,other.standin.test");
        net::HttpClient client = make_client();
        const std::string port = std::to_string(server.port());

        net::HttpRequest listed = get_request("https://ai.standin.test:" + port + "/v1/models");
        listed.resolve_entries = {"ai.standin.test:" + port + ":127.0.0.1"};
        const auto ok = client.perform(listed, control);
        INFO(ok.message);
        CHECK(ok.ok());

        net::HttpRequest unlisted =
            get_request("https://other.standin.test:" + port + "/v1/models");
        unlisted.resolve_entries = {"other.standin.test:" + port + ":127.0.0.1"};
        const auto mismatch = client.perform(unlisted, control);
        CHECK(mismatch.kind == net::OutcomeKind::tls);
        CHECK_FALSE(mismatch.message.empty());
        CHECK(server.request_count() == 1);
    }

    SECTION("CURL_CA_BUNDLE is honoured on Linux only") {
        test::TlsTestServer server;
        server.set_default(test::ScriptedResponse::json(200, "{}"));
        const auto bundle = test::with_env("CURL_CA_BUNDLE", text_of(server.ca_file()));
        net::HttpClient client = make_client();
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        if (net::current_ca_platform() == net::CaPlatform::linux_like) {
            INFO(outcome.message);
            CHECK(outcome.ok());
        } else {
            CHECK(outcome.kind == net::OutcomeKind::tls);  // macOS: SSL_CERT_FILE or native
        }
    }

    SECTION("no bundle anywhere on Linux is a tls outcome naming the missing file, unsent") {
        if (net::current_ca_platform() != net::CaPlatform::linux_like) {
            SKIP("the native store always exists on macOS and Windows");
        }
        test::TlsTestServer server;
        test::TempDir root("mfbe-ca-root");
        test::TempDir resources("mfbe-ca-resources");
        test::TempDir logs("mfbe-ca-logs");
        log::init(logs.path());
        const fs::path gone = root.path() / "gone.pem";
        const auto missing = test::with_env("SSL_CERT_FILE", text_of(gone));
        net::HttpClient client = make_client(resources.path(), root.path());
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        CHECK(outcome.kind == net::OutcomeKind::tls);
        CHECK(outcome.message.find("CA bundle not found") != std::string::npos);
        CHECK(outcome.message.find(text_of(resources.path() / "certs" / "cacert.pem")) !=
              std::string::npos);
        CHECK(server.handshake_failures() == 0);
        CHECK(server.request_count() == 0);
        // The same answer again; the skipped variable is warned about once per process.
        CHECK(client.perform(get_request(server.url("/v1/models")), control).kind ==
              net::OutcomeKind::tls);

        // Plain http is unaffected by the missing bundle.
        test::HttpTestServer plain;
        plain.route("GET", "/v1/models", test::ScriptedResponse::json(200, "{}"));
        CHECK(client.perform(get_request(plain.url("/v1/models")), control).ok());

        log::shutdown();
        std::istringstream in(test::read_text(logs.path() / "mfbe-errors.log"));
        std::vector<nlohmann::json> entries;
        for (std::string line; std::getline(in, line);) {
            if (!line.empty()) {
                entries.push_back(nlohmann::json::parse(line));
            }
        }
        // One ai.caBundleMissing warning with the path and nothing else: the tls outcomes are
        // results, logged by the ai.* handler (with host and kind), never by the client.
        REQUIRE(entries.size() == 1);
        CHECK(entries[0]["level"] == "warning");
        CHECK(entries[0]["code"] == "ai.caBundleMissing");
        CHECK(entries[0]["context"]["path"] == text_of(gone));
    }

    SECTION("a TLS 1.0/1.1-only server is refused as tls even with its CA trusted") {
        test::TlsServerOptions legacy;
        legacy.min_version = test::TlsVersion::tls1_0;
        legacy.max_version = test::TlsVersion::tls1_1;
        test::TlsTestServer server(legacy);
        server.set_default(test::ScriptedResponse::json(200, R"({"legacy":true})"));
        const auto trust = test::with_env("SSL_CERT_FILE", text_of(server.ca_file()));
        net::HttpClient client = make_client();
        const auto outcome = client.perform(get_request(server.url("/v1/models")), control);
        CHECK_FALSE(outcome.ok());
        CHECK(outcome.kind == net::OutcomeKind::tls);
        CHECK_FALSE(outcome.message.empty());
        REQUIRE(server.wait_for_connections(1));
        CHECK(server.handshake_failures() == 1);
        CHECK(server.request_count() == 0);
    }

    SECTION("https to a plain-http server and a non-http scheme are refused") {
        test::HttpTestServer plain;
        plain.route("GET", "/v1/models", test::ScriptedResponse::json(200, "{}"));
        net::HttpClient client = make_client();
        const auto outcome = client.perform(
            get_request("https://127.0.0.1:" + std::to_string(plain.port()) + "/v1/models"),
            control);
        CHECK(outcome.kind == net::OutcomeKind::tls);
        CHECK_FALSE(outcome.message.empty());
        CHECK_THROWS_AS(client.perform(get_request("file:///etc/hosts"), control), rpc::RpcError);
        CHECK_THROWS_AS(client.perform(get_request("ftp://127.0.0.1/"), control), rpc::RpcError);
    }
#endif
}
