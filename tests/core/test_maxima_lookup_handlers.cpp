// Feature 021 (T011): End-to-end CoreServer JSON-RPC tests for maximaLookup.* handlers,
// server-side test verification gate, settings.set guard, cancellation, exact hasMore paging,
// Retry-After cooldown, restart encrypted token persistence, and startup tamper recovery.
#include "test_http_server.hpp"
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/maxima_lookup_url.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>

using namespace mfbe;
using nlohmann::json;

namespace {

json start_test_and_wait(test::WsClient& ws, const json& params) {
    const json started = ws.call("maximaLookup.test", params);
    REQUIRE(started.contains("result"));
    const std::string job_id = started["result"].at("jobId").get<std::string>();
    while (true) {
        auto done = ws.wait_notification("job.done", 5000);
        REQUIRE(done.has_value());
        if ((*done)["params"].value("jobId", "") == job_id) {
            return (*done)["params"]["result"];
        }
    }
}

}  // namespace

TEST_CASE("maximaLookup RPC enforces test gate, encrypted persistence, paging, and cooldown",
          "[maxima_lookup][rpc]") {
    test::TempDir data("mfbe-lookup-rpc");
    test::HttpTestServer mock_site;
    const std::string secret_token = "tok_live_secret_987654321";

    {
        CoreServerOptions opts;
        opts.data_dir = platform::utf8_from_path(data.path());
        opts.test_hooks = true;
        auto server = CoreServer::start(opts);
        test::WsClient ws;
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

        // 1. Default status: disabled, default domain, no token, zero HTTP calls.
        const json st0 = ws.call("maximaLookup.status", json::object());
        REQUIRE(st0.contains("result"));
        CHECK(st0["result"]["enabled"] == false);
        CHECK(st0["result"]["domain"] == "https://maxima-library.com");
        CHECK(st0["result"]["hasToken"] == false);
        CHECK(st0["result"]["tokenReadable"] == true);
        CHECK(st0["result"]["verified"] == false);
        CHECK(st0["result"]["tokenPageUrl"] ==
              "https://maxima-library.com/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token");

        // 2. Disabled fast path makes zero outbound HTTP requests.
        const json disabled_search =
            ws.call("maximaLookup.search",
                    json{{"kind", "publisher"}, {"publisherName", "АСТ"}, {"page", 0}});
        REQUIRE(disabled_search.contains("result"));
        CHECK(disabled_search["result"]["ok"] == false);
        CHECK(disabled_search["result"]["code"] == "disabled");
        CHECK(mock_site.request_count() == 0);

        // 3. settings.set rejects direct enabling or verifiedFingerprint tampering (1040).
        const json bad_set = ws.call(
            "settings.set", json{{"patch", {{"maximaLibrary", {{"enabled", true}}}}}});
        REQUIRE(bad_set.contains("error"));
        CHECK(bad_set["error"]["code"] == 1040);

        const json bad_fp = ws.call(
            "settings.set",
            json{{"patch", {{"maximaLibrary", {{"verifiedFingerprint", std::string(64, 'a')}}}}}});
        REQUIRE(bad_fp.contains("error"));
        CHECK(bad_fp["error"]["code"] == 1040);

        // 4. maximaLookup.saveConfig rejects enabled=true before a passing test (1040 notVerified).
        const json bad_save = ws.call(
            "maximaLookup.saveConfig",
            json{{"enabled", true}, {"domain", mock_site.base_url()}, {"token", secret_token}});
        REQUIRE(bad_save.contains("error"));
        CHECK(bad_save["error"]["code"] == 1040);
        CHECK(bad_save["error"]["data"]["reason"] == "notVerified");

        // 5. Test cancellation via job.cancel aborts a slow reply promptly.
        mock_site.enqueue(
            test::ScriptedResponse::json(200, R"({"id":"","code":"","err":""})").with_delay(3000));
        const auto t0 = std::chrono::steady_clock::now();
        const json slow_started = ws.call(
            "maximaLookup.test", json{{"domain", mock_site.base_url()}, {"token", secret_token}});
        const std::string slow_job = slow_started["result"].at("jobId").get<std::string>();
        REQUIRE(mock_site.wait_for_requests(1, 2000));
        ws.call("job.cancel", json{{"jobId", slow_job}});
        auto failed = ws.wait_notification("job.failed", 2000);
        REQUIRE(failed.has_value());
        CHECK((*failed)["params"]["error"]["code"] == 1090);
        const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                    std::chrono::steady_clock::now() - t0)
                                    .count();
        CHECK(elapsed_ms < 1500);
        mock_site.clear_requests();

        // 6. Passing test unlocks saveConfig and encrypts token outside settings.json.
        mock_site.enqueue(test::ScriptedResponse::json(200, R"({"id":"","code":"","err":""})"));
        const json test_ok = start_test_and_wait(
            ws, json{{"domain", mock_site.base_url() + "/"}, {"token", secret_token}});
        REQUIRE(test_ok["ok"] == true);
        CHECK(test_ok["normalizedDomain"] == mock_site.base_url());
        CHECK(lookup::is_valid_fingerprint_hex(test_ok["verifiedFingerprint"].get<std::string>()));

        const json saved = ws.call("maximaLookup.saveConfig",
                                   json{{"enabled", true},
                                        {"domain", mock_site.base_url() + "/"},
                                        {"token", secret_token}});
        REQUIRE(saved.contains("result"));
        CHECK(saved["result"]["status"]["enabled"] == true);
        CHECK(saved["result"]["status"]["verified"] == true);
        CHECK(saved["result"]["status"]["hasToken"] == true);
        CHECK(saved["result"]["status"]["tokenReadable"] == true);

        // Zero plaintext token in settings.json or maxima-lookup-token.json.
        const std::string settings_txt = test::read_text(data / "settings.json");
        CHECK(settings_txt.find(secret_token) == std::string::npos);
        const std::string token_txt = test::read_text(data / "maxima-lookup-token.json");
        CHECK(token_txt.find(secret_token) == std::string::npos);

        // Reveal token returns plaintext only on explicit call.
        const json revealed = ws.call("maximaLookup.revealToken", json::object());
        REQUIRE(revealed.contains("result"));
        CHECK(revealed["result"]["readable"] == true);
        CHECK(revealed["result"]["token"] == secret_token);

        // 7. Enabled search slices pageSize + 1 -> pageSize with exact hasMore.
        mock_site.clear_requests();
        mock_site.enqueue(test::ScriptedResponse::json(
            200,
            R"({"id":"","code":"","err":"","returned":3,"items":[
                {"id":1,"name":"Pub1","bookCount":10,"url":"http://127.0.0.1/p1"},
                {"id":2,"name":"Pub2","bookCount":20,"url":"http://127.0.0.1/p2"},
                {"id":3,"name":"Pub3","bookCount":30,"url":"http://127.0.0.1/p3"}
            ]})"));
        const json sr = ws.call(
            "maximaLookup.search",
            json{{"kind", "publisher"}, {"publisherName", "Pub"}, {"page", 0}, {"pageSize", 2}});
        REQUIRE(sr.contains("result"));
        REQUIRE(sr["result"]["ok"] == true);
        CHECK(sr["result"]["hasMore"] == true);
        CHECK(sr["result"]["items"].size() == 2);
        REQUIRE(mock_site.request_count() == 1);
        const json sent_body = json::parse(mock_site.requests().front().body);
        CHECK(sent_body["recordsPerSearch"] == 3);

        // 8. Enabled exists returns matchedIds for persons.
        mock_site.enqueue(
            test::ScriptedResponse::json(200, R"({"id":"","code":"","err":"","matchedIds":[101]})"));
        const json ex = ws.call("maximaLookup.exists",
                                json{{"kind", "person"},
                                     {"role", "author"},
                                     {"lastName", "Толстой"},
                                     {"firstName", "Лев"},
                                     {"middleName", "Николаевич"}});
        REQUIRE(ex.contains("result"));
        REQUIRE(ex["result"]["ok"] == true);
        CHECK(ex["result"]["matchedIds"] == json::array({101}));

        // 9. HTTP 429 Retry-After suppresses follow-up request during cooldown.
        mock_site.clear_requests();
        mock_site.enqueue(
            test::ScriptedResponse::json(429, R"({"id":"","code":"rate_limited","err":"Slow"})")
                .with_header("Retry-After", "10"));
        const json rl1 = ws.call(
            "maximaLookup.search",
            json{{"kind", "publisher"}, {"publisherName", "Pub"}, {"page", 0}});
        CHECK(rl1["result"]["ok"] == false);
        CHECK(rl1["result"]["code"] == "rate_limited");
        CHECK(mock_site.request_count() == 1);

        const json rl2 = ws.call(
            "maximaLookup.search",
            json{{"kind", "publisher"}, {"publisherName", "Pub"}, {"page", 0}});
        CHECK(rl2["result"]["ok"] == false);
        CHECK(rl2["result"]["code"] == "rate_limited");
        CHECK(mock_site.request_count() == 1);  // suppressed locally without hitting server
    }

    // 10. Restart over the same data_dir preserves verified enabled state with 0 network calls.
    mock_site.clear_requests();
    {
        CoreServerOptions opts;
        opts.data_dir = platform::utf8_from_path(data.path());
        opts.test_hooks = true;
        auto server = CoreServer::start(opts);
        test::WsClient ws;
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

        const json st = ws.call("maximaLookup.status", json::object());
        CHECK(st["result"]["enabled"] == true);
        CHECK(st["result"]["verified"] == true);
        CHECK(st["result"]["hasToken"] == true);
        CHECK(st["result"]["tokenReadable"] == true);
        CHECK(mock_site.request_count() == 0);
    }

    // 11. Corrupting token file before restart safely disables lookup and reports tokenReadable=false.
    {
        std::ofstream out(data / "maxima-lookup-token.json", std::ios::binary | std::ios::trunc);
        out << "{corrupt";
    }
    {
        CoreServerOptions opts;
        opts.data_dir = platform::utf8_from_path(data.path());
        opts.test_hooks = true;
        auto server = CoreServer::start(opts);
        test::WsClient ws;
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

        const json st = ws.call("maximaLookup.status", json::object());
        CHECK(st["result"]["enabled"] == false);
        CHECK(st["result"]["verified"] == false);
        CHECK(st["result"]["tokenReadable"] == false);
    }
}
