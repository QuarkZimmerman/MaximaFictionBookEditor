// Feature 021 (T010): Domain URL policy, v2 request schema bounds, correlation ID checks,
// redirect blocking, Retry-After parsing, and zero credential/cookie leakage.
#include "test_http_server.hpp"
#include "test_support.hpp"

#include <mfbe/http_client.hpp>
#include <mfbe/maxima_lookup_client.hpp>
#include <mfbe/maxima_lookup_url.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include <string>

using namespace mfbe;
using namespace mfbe::lookup;
using nlohmann::json;

namespace {

struct DummyJobControl : rpc::JobControl {
    std::string job_id = "test-job";
    bool is_cancelled = false;
    const std::string& id() const override { return job_id; }
    bool cancelled() const override { return is_cancelled; }
    void progress(const std::string&, std::int64_t, std::int64_t) override {}
};

}  // namespace

TEST_CASE("Maxima Library domain normalization and HTTPS transport policy",
          "[maxima_lookup][url]") {
    const auto def = normalize_and_validate_domain("  HTTPS://Maxima-Library.COM/  ");
    REQUIRE(def.ok);
    CHECK(def.normalized_domain == "https://maxima-library.com");
    CHECK(def.host == "maxima-library.com");
    CHECK(build_lookup_v2_endpoint(def.normalized_domain) ==
          "https://maxima-library.com/index.php?option=com_maxlib&controller=lookupv2");
    CHECK(build_token_page_url(def.normalized_domain) ==
          "https://maxima-library.com/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token");

    // Remote plain HTTP rejected.
    const auto remote_http = normalize_and_validate_domain("http://maxima-library.com");
    CHECK_FALSE(remote_http.ok);
    CHECK(remote_http.code == "httpsRequired");

    // Loopback and .onion plain HTTP allowed.
    CHECK(normalize_and_validate_domain("http://localhost:8080/").ok);
    CHECK(normalize_and_validate_domain("http://127.0.0.1:9000").ok);
    CHECK(normalize_and_validate_domain("http://[::1]:8080").ok);
    CHECK(normalize_and_validate_domain("http://maximaexample123456.onion/").ok);

    // Invalid inputs rejected.
    CHECK(normalize_and_validate_domain("").code == "invalidDomain");
    CHECK(normalize_and_validate_domain("ftp://maxima-library.com").code == "invalidDomain");
    CHECK(normalize_and_validate_domain("https://maxima-library.com?foo=1").code ==
          "invalidDomain");
    CHECK(normalize_and_validate_domain("https://user:pass@maxima-library.com").code ==
          "invalidDomain");
    CHECK(normalize_and_validate_domain("https://maxima-library.com:99999").code ==
          "invalidDomain");

    const std::string fp = compute_verified_fingerprint("https://maxima-library.com", "tok");
    CHECK(is_valid_fingerprint_hex(fp));
    CHECK(fp != compute_verified_fingerprint("https://maxima-library.com", "tok2"));
    CHECK_FALSE(is_valid_fingerprint_hex("NOTHEX"));
}

TEST_CASE("Lookup v2 request builders enforce schema bounds and cross-field rules",
          "[maxima_lookup][client]") {
    json body;
    int page = 0;
    int page_size = 0;
    std::string err;

    // First-name-only person search is valid; pageSize 30 requests 31 for exact hasMore.
    REQUIRE(build_search_request(
        json{{"kind", "person"},
             {"role", "author"},
             {"lastName", ""},
             {"firstName", "Аристотель"},
             {"page", 2},
             {"pageSize", 30}},
        "corr-1", body, page, page_size, err));
    CHECK(page == 2);
    CHECK(page_size == 30);
    CHECK(body["task"] == "search");
    CHECK(body["version"] == "2");
    CHECK(body["id"] == "corr-1");
    CHECK(body["firstRecord"] == 60);
    CHECK(body["recordsPerSearch"] == 31);
    CHECK(body["role"] == "author");
    CHECK(body["lastName"] == "");
    CHECK(body["firstName"] == "Аристотель");

    // Empty lastName AND empty firstName rejected.
    CHECK_FALSE(build_search_request(
        json{{"kind", "person"}, {"role", "author"}, {"lastName", " "}, {"firstName", ""}},
        "corr-2", body, page, page_size, err));

    // Author series empty query allowed on narrowed tab, rejected on "all".
    CHECK_FALSE(build_search_request(
        json{{"kind", "authorSeries"}, {"seriesName", ""}, {"narrow", "all"}}, "corr-3", body,
        page, page_size, err));
    json ids = json::array();
    for (int i = 1; i <= 75; ++i) ids.push_back(i);
    REQUIRE(build_search_request(
        json{{"kind", "authorSeries"},
             {"seriesName", ""},
             {"narrow", "authors"},
             {"excludedSeriesId", 42},
             {"authorIds", ids},
             {"page", 0}},
        "corr-4", body, page, page_size, err));
    CHECK(body["role"] == "series");
    CHECK(body["excludedSeriesId"] == 42);
    CHECK(body["authorIds"].size() == kMaxLookupFilterItems);

    // UTF-8 codepoint truncation (300 Cyrillic chars -> 255 codepoints cleanly).
    std::string long_cyr;
    for (int i = 0; i < 300; ++i) long_cyr += "Я";
    const std::string truncated = truncate_utf8_codepoints(long_cyr, kMaxLookupTextChars);
    CHECK(truncated.size() == 255 * 2);  // each Cyrillic 'Я' is 2 UTF-8 bytes
}

TEST_CASE("MaximaLookupClient sends Bearer POST without redirects or cookies and checks id",
          "[maxima_lookup][client]") {
    test::HttpTestServer srv;
    net::HttpClient http(
        net::HttpClientOptions{platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR), {}, {}});
    MaximaLookupClient client(http);
    DummyJobControl control;

    // 1. Valid verify response.
    srv.enqueue(test::ScriptedResponse::json(200, R"({"id":"req-1","code":"","err":""})"));
    const auto ok_res =
        client.execute(srv.base_url(), "my-secret-token", build_verify_request("req-1"), "req-1",
                       control);
    REQUIRE(ok_res.ok);
    REQUIRE(srv.request_count() == 1);
    const auto req = srv.requests().front();
    CHECK(req.method == "POST");
    CHECK(req.path == "/index.php");
    CHECK(req.query == "option=com_maxlib&controller=lookupv2");
    CHECK(req.header("authorization") == "Bearer my-secret-token");
    CHECK_FALSE(req.has_header("cookie"));
    CHECK(req.body.find("my-secret-token") == std::string::npos);

    // 2. Correlation ID mismatch discarded as format error.
    srv.enqueue(test::ScriptedResponse::json(200, R"({"id":"wrong-id","code":"","err":""})"));
    const auto bad_id =
        client.execute(srv.base_url(), "my-secret-token", build_verify_request("req-2"), "req-2",
                       control);
    CHECK_FALSE(bad_id.ok);
    CHECK(bad_id.code == "format");

    // 3. HTTP 302 redirect is NOT followed (prevents Authorization header leakage).
    srv.clear_requests();
    srv.enqueue(test::ScriptedResponse::redirect(302, srv.url("/stolen")));
    const auto redir =
        client.execute(srv.base_url(), "my-secret-token", build_verify_request("req-3"), "req-3",
                       control);
    CHECK_FALSE(redir.ok);
    CHECK(srv.request_count() == 1);

    // 4. HTTP 429 rate_limited preserves Retry-After seconds.
    srv.enqueue(
        test::ScriptedResponse::json(429, R"({"id":"req-4","code":"rate_limited","err":"Slow down"})")
            .with_header("Retry-After", "7"));
    const auto rl =
        client.execute(srv.base_url(), "my-secret-token", build_verify_request("req-4"), "req-4",
                       control);
    CHECK_FALSE(rl.ok);
    CHECK(rl.code == "rate_limited");
    REQUIRE(rl.retry_after_seconds.has_value());
    CHECK(*rl.retry_after_seconds == 7);

    // 5. HTTP 401 invalid_token maps cleanly without leaking token.
    srv.enqueue(
        test::ScriptedResponse::json(401, R"({"id":"req-5","code":"invalid_token","err":"Revoked"})"));
    const auto auth =
        client.execute(srv.base_url(), "my-secret-token", build_verify_request("req-5"), "req-5",
                       control);
    CHECK_FALSE(auth.ok);
    CHECK(auth.code == "invalid_token");
    CHECK(auth.message.find("my-secret-token") == std::string::npos);
}
