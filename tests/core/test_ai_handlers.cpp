// Feature 005: the ai.* handlers end to end over the loopback server (rpc-api.md §3.12, §3.1
// app.openUrl, §5 test hooks) - the service list family (T018), the ai.complete / ai.models /
// ai.test jobs (T019) and the test hooks (T020) - with the test transports of
// test_ai_transport.hpp against the in-process HTTP test server.
#include "test_ai_transport.hpp"
#include "test_http_server.hpp"
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using namespace mfbe;
using nlohmann::json;

namespace {

namespace fs = std::filesystem;

fs::path bundled_file() {
    return fs::path(MFBE_RESOURCES_SOURCE_DIR) / "ai-services.json";
}

fs::path fixture(const char* name) {
    return test::fixtures_dir() / "ai-services" / name;
}

std::vector<json> log_entries(const fs::path& file) {
    std::vector<json> entries;
    if (!fs::exists(file)) {
        return entries;
    }
    std::istringstream lines(test::read_text(file));
    for (std::string line; std::getline(lines, line);) {
        if (!line.empty()) {
            entries.push_back(json::parse(line));
        }
    }
    return entries;
}

// A core with test hooks over a temporary data folder; the transport factory is installed
// before the core starts (it is consulted on the first ai.* call only).
struct AiFixture {
    test::TempDir data{"mfbe-ai"};
    std::shared_ptr<test::TransportLog> transports = std::make_shared<test::TransportLog>();
    std::shared_ptr<test::ScriptedOutcome> script = std::make_shared<test::ScriptedOutcome>();
    test::TransportFactoryScope factory;
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    // `scripted`: the ScriptedTransport instead of the loopback client.
    explicit AiFixture(bool scripted = false, const char* user_fixture = nullptr)
        : factory(scripted ? test::scripted_factory(transports, script)
                           : test::loopback_factory(transports)) {
        if (user_fixture != nullptr) {
            fs::copy_file(fixture(user_fixture), data / "ai-services.json");
        }
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    fs::path user_file() const { return data / "ai-services.json"; }
    fs::path log_file() const { return data / "logs" / "mfbe-errors.log"; }
    std::string log_text() const {
        return fs::exists(log_file()) ? test::read_text(log_file()) : std::string();
    }
    std::vector<json> ai_log_entries() const {
        std::vector<json> out;
        for (const auto& entry : log_entries(log_file())) {
            const std::string code = entry["code"].get<std::string>();
            if (code.rfind("ai", 0) == 0) {
                out.push_back(entry);
            }
        }
        return out;
    }
    json call(const std::string& method, const json& params = json::object()) {
        return ws.call(method, params);
    }
    json result(const std::string& method, const json& params = json::object()) {
        const json response = ws.call(method, params);
        INFO(response.dump());
        REQUIRE(response.contains("result"));
        return response["result"];
    }
    // Drains the notifications named `method` currently queued and counts them.
    int count_notifications(const std::string& method, int wait_ms = 300) {
        int count = 0;
        while (ws.wait_notification(method, wait_ms)) {
            ++count;
        }
        return count;
    }
};

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* T018: ai.services / ai.reloadServices / ai.createUserServices, app.openUrl                 */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE(
    "ai.services: nothing is read before the first ai.* call; the list shapes come from "
    "the fixtures",
    "[ai][server]") {
    SECTION(
        "a directory in the user file's place: no issue logged, no transport created, "
        "until the first ai.services()") {
        AiFixture f;
        fs::create_directories(f.user_file());
        CHECK(f.result("app.info")["apiMinor"] == 4);
        CHECK(f.result("settings.get")["ai"]["mode"] == "free");
        CHECK(f.transports->created.load() == 0);
        CHECK(f.ai_log_entries().empty());

        const json list = f.result("ai.services");
        CHECK(list["services"].size() == 4);
        CHECK(list["hidden"] == json::array());
        REQUIRE(list["issues"].size() == 1);
        CHECK(list["issues"][0]["reason"] == "unreadable");
        CHECK(list["issues"][0]["file"] == platform::utf8_from_path(f.user_file()));
        CHECK(list["files"]["userExists"] == true);
        CHECK(list["files"]["bundled"] == platform::utf8_from_path(bundled_file()));
        CHECK(f.transports->created.load() == 1);
        const std::vector<json> logged = f.ai_log_entries();
        REQUIRE(logged.size() == 1);
        CHECK(logged[0]["code"] == "aiServices.unreadable");
        CHECK(logged[0]["level"] == "warning");
        CHECK(logged[0]["context"]["path"] == platform::utf8_from_path(f.user_file()));
        // The second call answers the list in effect: nothing is re-read, nothing re-logged,
        // the transport is created once.
        CHECK(f.result("ai.services") == list);
        CHECK(f.transports->created.load() == 1);
        CHECK(f.ai_log_entries().size() == 1);
    }
    SECTION("the user override replaces the bundled entry in place") {
        AiFixture f(false, "user-override.json");
        const json list = f.result("ai.services");
        REQUIRE(list["services"].size() == 4);
        const json& ovh = list["services"][0];
        CHECK(ovh["id"] == "ovhcloud");
        CHECK(ovh["source"] == "user");
        CHECK(ovh["replaced"] == true);
        CHECK(ovh["address"] == "http://127.0.0.1:8787/v1");
        CHECK(ovh["local"] == true);
        CHECK(ovh["plainHttp"] == true);
        CHECK(ovh["hasKey"] == false);
        CHECK(list["services"][1]["source"] == "bundled");
        CHECK(list["files"]["userExists"] == true);
        CHECK(list["files"]["user"] == platform::utf8_from_path(f.user_file()));
        CHECK_FALSE(list["files"].contains("portable"));
        CHECK(list["issues"] == json::array());
    }
    SECTION("a hidden bundled id, a user-only entry, a keyed entry without its key") {
        AiFixture f(false, "user-hidden-kilo.json");
        json list = f.result("ai.services");
        CHECK(list["services"].size() == 3);
        CHECK(list["hidden"] == json::array({"kilo"}));
        fs::copy_file(fixture("user-with-key.json"), f.user_file(),
                      fs::copy_options::overwrite_existing);
        list = f.result("ai.reloadServices");
        REQUIRE(list["services"].size() == 5);
        CHECK(list["services"][4]["id"] == "keyed");
        CHECK(list["services"][4]["hasKey"] == true);
        CHECK(list["services"][4]["keyRequired"] == true);
        CHECK(list["services"][4]["source"] == "user");
        CHECK(list["services"][4]["replaced"] == false);
        CHECK(list.dump().find("sk-user") == std::string::npos);
        CHECK(f.log_text().find("sk-user") == std::string::npos);
    }
    SECTION("a malformed user file is reported and the bundled list is used") {
        AiFixture f(false, "user-truncated.json");
        const json list = f.result("ai.services");
        CHECK(list["services"].size() == 4);
        REQUIRE(list["issues"].size() == 1);
        CHECK(list["issues"][0] ==
              json{{"file", platform::utf8_from_path(f.user_file())}, {"reason", "invalidJson"}});
        const std::vector<json> logged = f.ai_log_entries();
        REQUIRE(logged.size() == 1);
        CHECK(logged[0]["code"] == "aiServices.invalidJson");
        CHECK_FALSE(logged[0]["context"].contains("index"));
    }
}

TEST_CASE(
    "ai.createUserServices: copies the bundled file once, never overwrites, reloads and "
    "notifies; ai.reloadServices re-reads and notifies",
    "[ai][server]") {
    AiFixture f;
    json list = f.result("ai.services");
    CHECK(list["files"]["userExists"] == false);
    CHECK(f.count_notifications("resources.changed", 100) == 0);

    // A file written after the first read is not seen until a reload.
    fs::copy_file(fixture("user-hidden-kilo.json"), f.user_file());
    CHECK(f.result("ai.services")["services"].size() == 4);
    list = f.result("ai.reloadServices");
    CHECK(list["services"].size() == 3);
    CHECK(list["hidden"] == json::array({"kilo"}));
    CHECK(list["files"]["userExists"] == true);
    auto changed = f.ws.wait_notification("resources.changed");
    REQUIRE(changed);
    CHECK((*changed)["params"] == json{{"what", "aiServices"}});
    CHECK(f.count_notifications("resources.changed", 200) == 0);  // exactly one
    CHECK(f.result("ai.services") == list);

    // The user's file exists: nothing is written, the list is reloaded and notified anyway.
    const std::string user_before = test::read_text(f.user_file());
    json created = f.result("ai.createUserServices");
    CHECK(created == json{{"path", platform::utf8_from_path(f.user_file())}, {"created", false}});
    CHECK(test::read_text(f.user_file()) == user_before);
    CHECK(f.count_notifications("resources.changed", 300) == 1);

    // No user file: a byte-exact copy of the bundled file, reloaded (every entry now comes from
    // the user's file and replaces the bundled one) and notified once.
    fs::remove(f.user_file());
    CHECK(f.result("ai.reloadServices")["files"]["userExists"] == false);
    CHECK(f.count_notifications("resources.changed", 300) == 1);
    created = f.result("ai.createUserServices");
    CHECK(created["created"] == true);
    CHECK(created["path"] == platform::utf8_from_path(f.user_file()));
    CHECK(test::read_text(f.user_file()) == test::read_text(bundled_file()));
    CHECK(f.count_notifications("resources.changed", 300) == 1);
    list = f.result("ai.services");
    REQUIRE(list["services"].size() == 4);
    for (const auto& entry : list["services"]) {
        CHECK(entry["source"] == "user");
        CHECK(entry["replaced"] == true);
    }
    CHECK(list["files"]["userExists"] == true);
    // The bundled file is never modified (FR-011).
    CHECK(test::read_text(bundled_file()).find("\"id\": \"ovhcloud\"") != std::string::npos);

    // A copy that cannot be written is 1002 {path, reason} (the writer's fault injection).
    fs::remove(f.user_file());
    CHECK(f.result("test.injectFault", json{{"point", "before_rename"}}) == json::object());
    const json failed = f.call("ai.createUserServices");
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1002);
    CHECK(failed["error"]["data"]["path"] == platform::utf8_from_path(f.user_file()));
    CHECK(failed["error"]["data"]["reason"].is_string());
    CHECK_FALSE(fs::exists(f.user_file()));
    CHECK(f.result("test.injectFault", json{{"point", "none"}}) == json::object());
}

TEST_CASE(
    "app.openUrl: http and https reach the opener; file, javascript and mailto are "
    "invalidParams {field: url}",
    "[ai][server]") {
    AiFixture f;
    std::vector<std::vector<std::string>> launched;
    bool start_ok = true;
    process::set_command_runner_for_tests([&](const std::vector<std::string>& argv) {
        launched.push_back(argv);
        return start_ok;
    });
    CHECK(f.result("app.openUrl",
                   json{{"url", "https://www.ovhcloud.com/en/terms-and-conditions/"}}) ==
          json::object());
    CHECK(f.result("app.openUrl", json{{"url", "http://127.0.0.1:8787/terms?lang=en#top"}}) ==
          json::object());
    REQUIRE(launched.size() == 2);
    CHECK(launched[0].back() == "https://www.ovhcloud.com/en/terms-and-conditions/");
    CHECK(launched[1].back() == "http://127.0.0.1:8787/terms?lang=en#top");
    for (const char* bad : {"file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c", "https://",
                            "ftp://x.example/", "https://a.example/\n", "", " "}) {
        INFO(bad);
        const json refused = f.call("app.openUrl", json{{"url", bad}});
        REQUIRE(refused.contains("error"));
        CHECK(refused["error"]["code"] == -32602);
        CHECK(refused["error"]["data"]["field"] == "url");
    }
    CHECK(f.call("app.openUrl", json{{"url", 5}})["error"]["data"]["field"] == "url");
    CHECK(f.call("app.openUrl", json::object())["error"]["data"]["field"] == "url");
    CHECK(launched.size() == 2);  // nothing else reached the opener
    // An opener that cannot be started is 1050, which the callers tolerate.
    start_ok = false;
    const json unavailable = f.call("app.openUrl", json{{"url", "https://kilo.ai/terms"}});
    CHECK(unavailable["error"]["code"] == 1050);
    CHECK(unavailable["error"]["message"] == "dialog.unavailable");
    process::set_command_runner_for_tests(nullptr);
    // The refusals are protocol errors (invalidParams), logged with the field name only; the
    // URL itself never reaches the log.
    CHECK(f.log_text().find("javascript") == std::string::npos);
    CHECK(f.log_text().find("passwd") == std::string::npos);
}

/* ----------------------------------------------------------------------------------------- */
/* T019: ai.complete / ai.models / ai.test                                                    */
/* ----------------------------------------------------------------------------------------- */

namespace {

struct JobRun {
    std::string job_id;
    std::vector<std::string> phases;
    std::optional<json> result;  // job.done
    std::optional<json> error;   // job.failed
};

// Starts the job and waits for its end; the progress phases are collected in order.
JobRun run_job(AiFixture& f, const std::string& method, const json& params,
               int timeout_ms = 10000) {
    JobRun run;
    const json started = f.result(method, params);
    run.job_id = started["jobId"].get<std::string>();
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        auto message = f.ws.receive_json(200);
        if (!message) {
            continue;
        }
        const std::string name = message->value("method", "");
        const json& p = (*message)["params"];
        if (name == "job.progress" && p["jobId"] == run.job_id) {
            run.phases.push_back(p["phase"].get<std::string>());
        } else if (name == "job.done" && p["jobId"] == run.job_id) {
            run.result = p["result"];
            return run;
        } else if (name == "job.failed" && p["jobId"] == run.job_id) {
            run.error = p["error"];
            return run;
        } else {
            f.ws.inbox.push_back(*message);
        }
    }
    FAIL("job " << run.job_id << " did not end");
    return run;
}

const char* kOkCompletion =
    R"({"id":"chatcmpl-1","object":"chat.completion","model":"standin-chat-2026",)"
    R"("choices":[{"index":0,"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}],)"
    R"("usage":{"prompt_tokens":5,"completion_tokens":1}})";

json chat_body() {
    return json{
        {"model", "ignored-by-the-core"},
        {"stream", true},
        {"messages", json::array({json{{"role", "system"}, {"content", "You edit books."}},
                                  json{{"role", "user"}, {"content", "Make it bold."}}})},
        {"tools", json::array({json{{"type", "function"},
                                    {"function", {{"name", "read"}, {"parameters", {}}}}}})},
        {"tool_choice", "auto"},
        {"api_key", "sk-from-the-call"}};
}

// Points the stored custom target at the test server (a local address: no agreement needed).
void use_custom(AiFixture& f, const test::HttpTestServer& server,
                const std::string& key = "sk-local", const std::string& model = "standin-chat",
                const std::string& suffix = "/v1") {
    f.result(
        "settings.set",
        json{{"patch",
              {{"ai",
                {{"mode", "custom"},
                 {"custom",
                  {{"address", server.base_url() + suffix}, {"key", key}, {"model", model}}}}}}}});
}

}  // namespace

TEST_CASE(
    "ai.complete: job phases, result in job.done, the request as the contract says, "
    "job.cancel fails with 1090 and logs nothing",
    "[ai][server][jobs]") {
    test::HttpTestServer http;
    AiFixture f;
    use_custom(f, http);
    http.route("POST", "/v1/chat/completions", test::ScriptedResponse::json(200, kOkCompletion));

    JobRun run =
        run_job(f, "ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", chat_body()}});
    REQUIRE(run.result);
    CHECK_FALSE(run.error);
    CHECK(run.phases == std::vector<std::string>{"connecting", "waiting", "receiving"});
    const json& outcome = *run.result;
    CHECK(outcome["ok"] == true);
    CHECK(outcome["status"] == 200);
    CHECK(outcome["body"]["choices"][0]["message"]["content"] == "OK");
    CHECK(outcome["elapsedMs"].is_number_integer());
    CHECK_FALSE(outcome.contains("kind"));
    CHECK_FALSE(outcome.contains("message"));
    CHECK_FALSE(outcome.contains("retryAfterSeconds"));

    // The request: the URL, exactly the Definitions' headers, the key from the settings, the
    // body as given with model and stream forced (nothing else added or removed).
    REQUIRE(http.wait_for_requests(1));
    const test::RecordedRequest request = http.requests().back();
    CHECK(request.method == "POST");
    CHECK(request.path == "/v1/chat/completions");
    CHECK(request.header("Content-Type") == "application/json");
    CHECK(request.header("Accept") == "application/json");
    CHECK(request.header("User-Agent") ==
          std::string("MaximaFictionBookEditor/") + version::kVersion);
    CHECK(request.header("Authorization") == "Bearer sk-local");
    CHECK_FALSE(request.has_header("Cookie"));
    CHECK_FALSE(request.has_header("Referer"));
    CHECK_FALSE(request.has_header("Origin"));
    const json sent = json::parse(request.body);
    CHECK(sent["model"] == "standin-chat");
    CHECK(sent["stream"] == false);
    CHECK(sent["messages"] == chat_body()["messages"]);
    CHECK(sent["tools"] == chat_body()["tools"]);
    CHECK(sent["tool_choice"] == "auto");
    CHECK(sent["api_key"] == "sk-from-the-call");  // opaque to the core, sent as given
    CHECK_FALSE(sent.contains("max_tokens"));
    CHECK(sent.size() == chat_body().size());

    // A trailing slash on the address never doubles in the path; an empty key sends no
    // Authorization header at all.
    use_custom(f, http, "", "standin-chat", "/v1///");
    run = run_job(f, "ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", chat_body()}});
    REQUIRE(run.result);
    REQUIRE(http.wait_for_requests(2));
    CHECK(http.requests().back().path == "/v1/chat/completions");
    CHECK_FALSE(http.requests().back().has_header("Authorization"));

    // job.cancel: the transfer stops, job.failed 1090, nothing logged, the record says cancelled.
    http.route("POST", "/v1/chat/completions",
               test::ScriptedResponse::json(200, kOkCompletion).with_delay(3000));
    const json started =
        f.result("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", chat_body()}});
    const std::string job_id = started["jobId"].get<std::string>();
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    const auto cancel_at = std::chrono::steady_clock::now();
    CHECK(f.result("job.cancel", json{{"jobId", job_id}}) == json::object());
    auto failed = f.ws.wait_notification("job.failed", 5000);
    REQUIRE(failed);
    const auto reaction = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - cancel_at);
    CHECK((*failed)["params"]["jobId"] == job_id);
    CHECK((*failed)["params"]["error"]["code"] == 1090);
    CHECK(reaction.count() < 1000);
    CHECK(f.ai_log_entries().empty());
    CHECK(f.log_text().find("ai.") == std::string::npos);
    CHECK(f.log_text().find("rpc.cancelled") == std::string::npos);

    // Malformed calls: the body must be an object with a messages array; a draft target is
    // refused for a request; a mix of the draft's members or an unknown member too.
    for (const json& bad : {json{{"target", {{"kind", "custom"}}}},
                            json{{"target", {{"kind", "custom"}}}, {"body", "x"}},
                            json{{"target", {{"kind", "custom"}}}, {"body", json::array()}}}) {
        const json refused = f.call("ai.complete", bad);
        REQUIRE(refused.contains("error"));
        CHECK(refused["error"]["code"] == -32602);
        CHECK(refused["error"]["data"]["field"] == "body");
    }
    json no_messages = f.call(
        "ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", {{"messages", "x"}}}});
    CHECK(no_messages["error"]["data"]["field"] == "body.messages");
    for (const json& target :
         {json{{"kind", "custom"}, {"address", http.base_url()}, {"key", ""}, {"model", "m"}},
          json{{"kind", "custom"}, {"address", http.base_url()}},
          json{{"kind", "custom"}, {"extra", 1}}, json{{"kind", "free"}},
          json{{"kind", "free"}, {"id", "ovhcloud"}, {"x", 1}}, json{{"kind", "other"}},
          json{{"kind", 3}}, json::array(), json("custom")}) {
        INFO(target.dump());
        const json refused = f.call("ai.complete", json{{"target", target}, {"body", chat_body()}});
        REQUIRE(refused.contains("error"));
        CHECK(refused["error"]["code"] == -32602);
        CHECK(refused["error"]["data"]["field"] == "target");
    }
    CHECK(f.call("ai.complete", json{{"body", chat_body()}})["error"]["data"]["field"] == "target");
    // A serialised body over 8 MiB is refused before anything is sent.
    json huge = chat_body();
    huge["messages"][1]["content"] = std::string(8u * 1024u * 1024u + 1u, 'x');
    const json too_large =
        f.call("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", huge}});
    CHECK(too_large["error"]["code"] == -32602);
    CHECK(too_large["error"]["data"] == json{{"field", "body"}, {"reason", "tooLarge"}});
    CHECK(http.request_count() == 3);
}

TEST_CASE(
    "ai.complete: every outcome shape is a result; the log holds kind, host and status "
    "only; limit waits, 3xx, cancels and successes log nothing",
    "[ai][server][jobs][log]") {
    test::HttpTestServer http;
    AiFixture f;
    use_custom(f, http, "sk-secret-key-7731");
    const json params{{"target", {{"kind", "custom"}}}, {"body", chat_body()}};
    const std::string host = "127.0.0.1:" + std::to_string(http.port());

    auto exchange = [&](test::ScriptedResponse response) {
        http.route("POST", "/v1/chat/completions", std::move(response));
        JobRun run = run_job(f, "ai.complete", params);
        REQUIRE(run.result);
        return *run.result;
    };

    // http with a JSON body (the service's words are the result, never the log's).
    json outcome = exchange(test::ScriptedResponse::json(
        404, R"({"error":{"message":"model gone-away not found","code":"model_not_found"}})"));
    CHECK(outcome["ok"] == false);
    CHECK(outcome["kind"] == "http");
    CHECK(outcome["status"] == 404);
    CHECK(outcome["body"]["error"]["code"] == "model_not_found");
    CHECK_FALSE(outcome.contains("message"));
    CHECK_FALSE(outcome.contains("text"));
    std::vector<json> logged = f.ai_log_entries();
    REQUIRE(logged.size() == 1);
    CHECK(logged[0]["code"] == "ai.http");
    CHECK(logged[0]["level"] == "warning");
    CHECK(logged[0]["message"] == "AI request failed");
    CHECK(logged[0]["context"]["method"] == "ai.complete");
    CHECK(logged[0]["context"]["targetKind"] == "custom");
    CHECK(logged[0]["context"]["host"] == host);
    CHECK(logged[0]["context"]["status"] == "404");
    CHECK_FALSE(logged[0]["context"].contains("path"));
    CHECK_FALSE(logged[0]["context"].contains("body"));

    // http with a text body: `text`, no message; 2xx that is not JSON: format with text.
    outcome = exchange(
        test::ScriptedResponse::text(502, "<html><title>Bad gateway</title></html>", "text/html"));
    CHECK(outcome["kind"] == "http");
    CHECK(outcome["status"] == 502);
    CHECK(outcome["text"] == "<html><title>Bad gateway</title></html>");
    CHECK_FALSE(outcome.contains("body"));
    outcome = exchange(test::ScriptedResponse::text(200, "not json at all \xff\xfe"));
    CHECK(outcome["ok"] == false);
    CHECK(outcome["kind"] == "format");
    CHECK(outcome["status"] == 200);
    CHECK(outcome["text"].get<std::string>().rfind("not json at all", 0) == 0);
    CHECK(outcome["message"].is_string());
    CHECK(f.ai_log_entries().size() == 3);
    CHECK(f.ai_log_entries()[2]["code"] == "ai.format");
    CHECK(f.ai_log_entries()[2]["context"]["status"] == "200");

    // A 200 carrying `error` and no `choices` is ok: true (the UI interprets); nothing logged.
    outcome = exchange(test::ScriptedResponse::json(200, R"({"error":{"message":"upstream"}})"));
    CHECK(outcome["ok"] == true);
    CHECK(outcome["body"]["error"]["message"] == "upstream");
    CHECK(f.ai_log_entries().size() == 3);

    // Limit waits: 429 and 402 (any body), 503 with Retry-After - the headers forwarded, no log
    // line; a 503 without Retry-After is an http failure logged with its status.
    outcome = exchange(test::ScriptedResponse::json(429, R"({"message":"API rate limit exceeded"})")
                           .with_header("Retry-After", "30")
                           .with_header("X-RateLimit-Limit-Minute", "2")
                           .with_header("X-RateLimit-Remaining-Minute", "0"));
    CHECK(outcome["kind"] == "http");
    CHECK(outcome["status"] == 429);
    CHECK(outcome["retryAfterSeconds"] == 30);
    CHECK(outcome["rateLimit"] == json{{"limit", 2}, {"remaining", 0}});
    outcome = exchange(test::ScriptedResponse::json(402, R"({"error":"payment required"})"));
    CHECK(outcome["status"] == 402);
    CHECK_FALSE(outcome.contains("retryAfterSeconds"));
    outcome = exchange(test::ScriptedResponse::json(503, R"({"error":"busy"})")
                           .with_header("Retry-After", "Sun, 06 Nov 2094 08:49:37 GMT")
                           .with_header("RateLimit-Limit", "100")
                           .with_header("RateLimit-Remaining", "0")
                           .with_header("RateLimit-Reset", "12"));
    CHECK(outcome["status"] == 503);
    CHECK(outcome["retryAfterSeconds"].get<double>() > 1000000.0);
    CHECK(outcome["rateLimit"] == json{{"limit", 100}, {"remaining", 0}, {"resetSeconds", 12}});
    CHECK(f.ai_log_entries().size() == 3);
    outcome = exchange(test::ScriptedResponse::json(503, R"({"error":"busy"})"));
    CHECK(outcome["status"] == 503);
    REQUIRE(f.ai_log_entries().size() == 4);
    CHECK(f.ai_log_entries()[3]["code"] == "ai.http");
    CHECK(f.ai_log_entries()[3]["context"]["status"] == "503");

    // A 3xx is an http outcome, never followed (the server saw one request), not logged.
    const std::size_t before = http.request_count();
    outcome =
        exchange(test::ScriptedResponse::redirect(302, http.url("/elsewhere/v1/chat/completions")));
    CHECK(outcome["kind"] == "http");
    CHECK(outcome["status"] == 302);
    CHECK(http.request_count() == before + 1);
    CHECK(f.ai_log_entries().size() == 4);

    // A success with rate-limit headers forwards them and logs nothing.
    outcome = exchange(test::ScriptedResponse::json(200, kOkCompletion)
                           .with_header("x-ratelimit-limit-minute", "2")
                           .with_header("x-ratelimit-remaining-minute", "1"));
    CHECK(outcome["ok"] == true);
    CHECK(outcome["rateLimit"] == json{{"limit", 2}, {"remaining", 1}});
    CHECK(f.ai_log_entries().size() == 4);

    // offline: nothing listens on the address.
    test::HttpTestServer closed;
    const int closed_port = closed.port();
    closed.stop();
    f.result(
        "settings.set",
        json{{"patch",
              {{"ai",
                {{"custom",
                  {{"address", "http://127.0.0.1:" + std::to_string(closed_port) + "/v1"}}}}}}}});
    JobRun offline = run_job(f, "ai.complete", params);
    REQUIRE(offline.result);
    CHECK((*offline.result)["ok"] == false);
    CHECK((*offline.result)["kind"] == "offline");
    CHECK((*offline.result)["message"].is_string());
    CHECK_FALSE(offline.result->contains("status"));
    REQUIRE(f.ai_log_entries().size() == 5);
    CHECK(f.ai_log_entries()[4]["code"] == "ai.offline");
    CHECK(f.ai_log_entries()[4]["context"]["host"] == "127.0.0.1:" + std::to_string(closed_port));
    CHECK_FALSE(f.ai_log_entries()[4]["context"].contains("status"));

    // Nothing of the exchange beyond kind, host and status reached the log: not the key, the
    // model, the instruction, the path, the service's words.
    const std::string log = f.log_text();
    for (const char* secret : {"sk-secret-key-7731", "Make it bold", "You edit books.",
                               "standin-chat", "chat/completions", "model gone-away", "upstream",
                               "Bad gateway", "payment required", "not json at all"}) {
        INFO(secret);
        CHECK(log.find(secret) == std::string::npos);
    }
    CHECK(log.find(f.server->token()) == std::string::npos);
}

TEST_CASE(
    "ai.complete: 1200 ai.noService reasons - disabled, unknownService, emptyAddress, "
    "noModel, noAgreement - and nothing is sent",
    "[ai][server][jobs]") {
    test::HttpTestServer http;
    AiFixture f(false, "user-hidden-kilo.json");
    http.route("POST", "/*", test::ScriptedResponse::json(200, kOkCompletion));
    http.route(
        "GET", "/*",
        test::ScriptedResponse::json(200, R"({"object":"list","data":[{"id":"standin-chat"}]})"));
    const json body = chat_body();
    auto expect_1200 = [&](const std::string& method, const json& params, const json& data) {
        const json refused = f.call(method, params);
        INFO(method << " " << params.dump() << " -> " << refused.dump());
        REQUIRE(refused.contains("error"));
        CHECK(refused["error"]["code"] == 1200);
        CHECK(refused["error"]["message"] == "ai.noService");
        CHECK(refused["error"]["data"] == data);
    };

    // (5) a hosted free entry without an agreement; a hosted custom address likewise; the
    // agreement must match service and host both.
    expect_1200("ai.complete",
                json{{"target", {{"kind", "free"}, {"id", "ovhcloud"}}}, {"body", body}},
                json{{"reason", "noAgreement"}, {"service", "ovhcloud"}});
    expect_1200("ai.test", json{{"target", {{"kind", "free"}, {"id", "llm7"}}}},
                json{{"reason", "noAgreement"}, {"service", "llm7"}});
    const std::string hosted = "http://ai.standin.test:" + std::to_string(http.port()) + "/v1";
    f.result(
        "settings.set",
        json{{"patch",
              {{"ai",
                {{"custom", {{"address", hosted}, {"key", ""}, {"model", "standin-chat"}}}}}}}});
    expect_1200("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", body}},
                json{{"reason", "noAgreement"}, {"service", "custom:" + hosted}});
    expect_1200(
        "ai.models",
        json{{"target", {{"kind", "custom"}, {"address", hosted}, {"key", ""}, {"model", ""}}}},
        json{{"reason", "noAgreement"}, {"service", "custom:" + hosted}});
    f.result("settings.set", json{{"patch",
                                   {{"ai",
                                     {{"agreements",
                                       {json{{"service", "custom:" + hosted},
                                             {"host", "other.example:1"},
                                             {"at", "2026-10-22T10:00:00Z"}}}}}}}}});
    expect_1200("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", body}},
                json{{"reason", "noAgreement"}, {"service", "custom:" + hosted}});
    // (2) an unknown id and a hidden one.
    expect_1200("ai.complete", json{{"target", {{"kind", "free"}, {"id", "nope"}}}, {"body", body}},
                json{{"reason", "unknownService"}, {"id", "nope"}});
    expect_1200("ai.complete", json{{"target", {{"kind", "free"}, {"id", "kilo"}}}, {"body", body}},
                json{{"reason", "unknownService"}, {"id", "kilo"}});
    expect_1200("ai.models", json{{"target", {{"kind", "free"}, {"id", "kilo"}}}},
                json{{"reason", "unknownService"}, {"id", "kilo"}});
    // (3) an empty stored address; (4) an empty model - ai.models exempt.
    f.result("settings.set",
             json{{"patch", {{"ai", {{"custom", {{"address", ""}, {"model", ""}}}}}}}});
    expect_1200("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", body}},
                json{{"reason", "emptyAddress"}});
    expect_1200(
        "ai.test",
        json{{"target", {{"kind", "custom"}, {"address", ""}, {"key", "k"}, {"model", "m"}}}},
        json{{"reason", "emptyAddress"}});
    f.result("settings.set",
             json{{"patch",
                   {{"ai", {{"custom", {{"address", http.base_url() + "/v1"}, {"model", ""}}}}}}}});
    expect_1200("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", body}},
                json{{"reason", "noModel"}});
    expect_1200("ai.test", json{{"target", {{"kind", "custom"}}}}, json{{"reason", "noModel"}});
    expect_1200(
        "ai.test",
        json{{"target",
              {{"kind", "custom"}, {"address", http.base_url()}, {"key", ""}, {"model", ""}}}},
        json{{"reason", "noModel"}});
    CHECK(http.request_count() == 0);
    CHECK(f.transports->size() == 0);
    // ai.models needs no model: the job runs.
    JobRun models = run_job(f, "ai.models", json{{"target", {{"kind", "custom"}}}});
    REQUIRE(models.result);
    CHECK((*models.result)["ok"] == true);
    REQUIRE(http.wait_for_requests(1));
    CHECK(http.requests().back().method == "GET");
    CHECK(http.requests().back().path == "/v1/models");
    CHECK_FALSE(http.requests().back().has_header("Content-Type"));
    CHECK(http.requests().back().body.empty());

    // (0) the saved mode disabled refuses ai.complete only - a draft test and a fetch still
    // run (the user is on the page pressing the button).
    f.result(
        "settings.set",
        json{{"patch", {{"ai", {{"mode", "disabled"}, {"custom", {{"model", "standin-chat"}}}}}}}});
    expect_1200("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", body}},
                json{{"reason", "disabled"}});
    expect_1200("ai.complete",
                json{{"target", {{"kind", "free"}, {"id", "ovhcloud"}}}, {"body", body}},
                json{{"reason", "disabled"}});
    const json draft{{"kind", "custom"},
                     {"address", http.base_url() + "/v1"},
                     {"key", "sk-draft"},
                     {"model", "standin-chat"}};
    JobRun test_run = run_job(f, "ai.test", json{{"target", draft}});
    REQUIRE(test_run.result);
    CHECK((*test_run.result)["verified"] == true);
    JobRun models_run = run_job(f, "ai.models", json{{"target", draft}});
    REQUIRE(models_run.result);
    CHECK((*models_run.result)["ok"] == true);
    CHECK(http.request_count() == 3);
    CHECK(http.requests()[1].header("Authorization") == "Bearer sk-draft");
    // The draft's key is used for that exchange and never stored.
    const json settings = f.result("settings.get");
    CHECK(settings["ai"]["custom"]["key"] == "");
    CHECK(settings["ai"]["customVerified"]["fingerprint"] == "");
    // Refusals are logged by the router with their allow-listed data only: never the
    // agreement key (the address).
    const std::string log = f.log_text();
    CHECK(log.find("rpc.ai.noService") != std::string::npos);
    CHECK(log.find("\"reason\":\"noAgreement\"") != std::string::npos);
    CHECK(log.find("\"id\":\"nope\"") != std::string::npos);
    CHECK(log.find("ai.standin.test") == std::string::npos);
    CHECK(log.find("custom:") == std::string::npos);
    CHECK(log.find("sk-draft") == std::string::npos);
}

TEST_CASE(
    "ai.test: the fixed body; verified only with choices; a verified custom target "
    "returns the fingerprint of the triple used and writes no setting",
    "[ai][server][jobs]") {
    test::HttpTestServer http;
    AiFixture f;
    use_custom(f, http, "sk-test", "standin-chat");
    http.route("POST", "/v1/chat/completions", test::ScriptedResponse::json(200, kOkCompletion));

    // The stored custom target: the fixed body, verified, the answering model, the fingerprint
    // of address\0key\0model (recorded with Node's createHash in test_settings.cpp).
    const std::string address = http.base_url() + "/v1";
    JobRun run = run_job(f, "ai.test", json{{"target", {{"kind", "custom"}}}});
    REQUIRE(run.result);
    const json result = *run.result;
    CHECK(result["ok"] == true);
    CHECK(result["status"] == 200);
    CHECK(result["verified"] == true);
    CHECK(result["model"] == "standin-chat-2026");
    CHECK(result["fingerprint"].get<std::string>().size() == 64);
    REQUIRE(http.wait_for_requests(1));
    CHECK(json::parse(http.requests()[0].body) ==
          json{{"model", "standin-chat"},
               {"stream", false},
               {"messages", json::array({json{{"role", "user"},
                                              {"content", "Reply with the single word OK."}}})}});
    CHECK(http.requests()[0].header("Authorization") == "Bearer sk-test");
    const json settings_before = f.result("settings.get");
    CHECK(settings_before["ai"]["customVerified"]["fingerprint"] == "");

    // The draft of the settings page: tested as given, its fingerprint returned, nothing stored.
    const json draft{{"kind", "custom"},
                     {"address", "http://127.0.0.1:" + std::to_string(http.port()) + "/v1"},
                     {"key", "sk-draft"},
                     {"model", "standin-chat"}};
    run = run_job(f, "ai.test", json{{"target", draft}});
    REQUIRE(run.result);
    CHECK((*run.result)["verified"] == true);
    const std::string draft_fingerprint = (*run.result)["fingerprint"].get<std::string>();
    CHECK(draft_fingerprint != result["fingerprint"].get<std::string>());
    CHECK(draft_fingerprint.find("sk-draft") == std::string::npos);
    CHECK(f.result("settings.get") == settings_before);
    CHECK(http.requests()[1].header("Authorization") == "Bearer sk-draft");
    // The fingerprint belongs to the triple: the UI's record of it is accepted by settings.set
    // only together with that triple.
    const json accepted = f.result(
        "settings.set",
        json{{"patch",
              {{"ai",
                {{"custom",
                  {{"address", draft["address"]}, {"key", "sk-draft"}, {"model", "standin-chat"}}},
                 {"customVerified",
                  {{"fingerprint", draft_fingerprint},
                   {"model", "standin-chat-2026"},
                   {"at", "2026-10-22T10:00:00Z"}}}}}}}});
    CHECK(accepted["settings"]["ai"]["customVerified"]["fingerprint"] == draft_fingerprint);
    // A free target carries no fingerprint; an answer without choices is not verified.
    test::write_text(f.user_file(),
                     R"({"version": 1, "services": [{"id": "standin", "name": "Stand-in",
        "address": ")" + address +
                         R"(", "model": "standin-chat"}]})");
    f.result("ai.reloadServices");
    run = run_job(f, "ai.test", json{{"target", {{"kind", "free"}, {"id", "standin"}}}});
    REQUIRE(run.result);
    CHECK((*run.result)["verified"] == true);
    CHECK_FALSE(run.result->contains("fingerprint"));
    CHECK_FALSE(http.requests().back().has_header("Authorization"));
    http.route(
        "POST", "/v1/chat/completions",
        test::ScriptedResponse::json(200, R"({"error":{"message":"no capacity"},"model":"x"})"));
    run = run_job(f, "ai.test", json{{"target", {{"kind", "custom"}}}});
    REQUIRE(run.result);
    CHECK((*run.result)["ok"] == true);
    CHECK((*run.result)["verified"] == false);
    CHECK_FALSE(run.result->contains("fingerprint"));
    CHECK_FALSE(run.result->contains("model"));
    http.route("POST", "/v1/chat/completions",
               test::ScriptedResponse::json(
                   401, R"({"error":{"message":"Missing API key.","code":"missing_api_key"}})"));
    run = run_job(f, "ai.test", json{{"target", {{"kind", "custom"}}}});
    REQUIRE(run.result);
    CHECK((*run.result)["ok"] == false);
    CHECK((*run.result)["kind"] == "http");
    CHECK((*run.result)["verified"] == false);
    CHECK((*run.result)["body"]["error"]["code"] == "missing_api_key");
    CHECK(f.ai_log_entries().size() == 1);
    CHECK(f.ai_log_entries()[0]["context"]["method"] == "ai.test");
    CHECK(f.ai_log_entries()[0]["context"]["status"] == "401");
}

TEST_CASE(
    "ai.models: OpenAI list and bare arrays (objects or strings) are accepted with "
    "contextLength and tools; other bodies are a format outcome",
    "[ai][server][jobs]") {
    test::HttpTestServer http;
    AiFixture f;
    use_custom(f, http, "", "");
    auto fetch = [&](const char* body) {
        http.route("GET", "/v1/models", test::ScriptedResponse::json(200, body));
        JobRun run = run_job(f, "ai.models", json{{"target", {{"kind", "custom"}}}});
        REQUIRE(run.result);
        return *run.result;
    };
    json result = fetch(R"({"object":"list","data":[
        {"id":"standin-chat","object":"model","context_length":131072,"supported_parameters":["tools","temperature"]},
        {"id":"standin-mini","capabilities":{"tools":false},"context_window":{"tokens":8192}},
        {"name":"named-only","max_model_len":4096,"tools":true},
        {"id":"no-extras","context_length":0},
        {"object":"model"}, 7, "plain"]})");
    CHECK(result["ok"] == true);
    CHECK(result["status"] == 200);
    CHECK_FALSE(result.contains("body"));
    CHECK(result["models"] ==
          json::array({json{{"id", "standin-chat"}, {"contextLength", 131072}, {"tools", true}},
                       json{{"id", "standin-mini"}, {"contextLength", 8192}, {"tools", false}},
                       json{{"id", "named-only"}, {"contextLength", 4096}, {"tools", true}},
                       json{{"id", "no-extras"}}, json{{"id", "plain"}}}));
    CHECK(result["elapsedMs"].is_number_integer());
    result = fetch(R"([{"id":"a","context_length":1000},{"id":"b"}])");
    CHECK(result["models"] ==
          json::array({json{{"id", "a"}, {"contextLength", 1000}}, json{{"id", "b"}}}));
    result = fetch(R"(["x","y"])");
    CHECK(result["models"] == json::array({json{{"id", "x"}}, json{{"id", "y"}}}));
    result = fetch(R"({"data":[]})");
    CHECK(result["models"] == json::array());
    result = fetch(R"({"error":{"message":"no such route"}})");
    CHECK(result["ok"] == false);
    CHECK(result["kind"] == "format");
    CHECK(result["status"] == 200);
    CHECK(result["text"].get<std::string>().find("no such route") != std::string::npos);
    CHECK_FALSE(result.contains("models"));
    CHECK_FALSE(result.contains("body"));
    // A non-2xx stays an http outcome with the body.
    http.route("GET", "/v1/models", test::ScriptedResponse::json(401, R"({"error":"key"})"));
    JobRun denied = run_job(f, "ai.models", json{{"target", {{"kind", "custom"}}}});
    REQUIRE(denied.result);
    CHECK((*denied.result)["kind"] == "http");
    CHECK((*denied.result)["body"] == json{{"error", "key"}});
    CHECK_FALSE(denied.result->contains("models"));
    // The requests were GETs without a body or a Content-Type.
    for (const auto& request : http.requests()) {
        CHECK(request.method == "GET");
        CHECK(request.path == "/v1/models");
        CHECK(request.body.empty());
        CHECK_FALSE(request.has_header("Content-Type"));
        CHECK(request.header("Accept") == "application/json");
    }
}

TEST_CASE(
    "ai.*: a job started before an ai.reloadServices that removes its entry still sends to "
    "the entry it resolved; a tls outcome is a result logged by kind",
    "[ai][server][jobs]") {
    SECTION("reload during a job") {
        test::HttpTestServer http;
        AiFixture f;
        test::write_text(f.user_file(),
                         R"({"version": 1, "services": [{"id": "standin", "name": "Stand-in",
            "address": ")" + http.base_url() +
                             R"(/v1", "model": "standin-chat"}]})");
        http.route("POST", "/v1/chat/completions",
                   test::ScriptedResponse::json(200, kOkCompletion).with_delay(700));
        const json started = f.result(
            "ai.complete",
            json{{"target", {{"kind", "free"}, {"id", "standin"}}}, {"body", chat_body()}});
        REQUIRE(http.wait_for_requests(1));
        test::write_text(f.user_file(), R"({"version": 1, "services": []})");
        const json reloaded = f.result("ai.reloadServices");
        CHECK(reloaded["services"].size() == 4);
        auto done = f.ws.wait_notification("job.done", 5000);
        REQUIRE(done);
        CHECK((*done)["params"]["jobId"] == started["jobId"]);
        CHECK((*done)["params"]["result"]["ok"] == true);
        CHECK(f.call("ai.complete", json{{"target", {{"kind", "free"}, {"id", "standin"}}},
                                         {"body", chat_body()}})["error"]["code"] == 1200);
    }
    SECTION("a tls outcome through the scripted transport") {
        AiFixture f(true);
        f.result(
            "settings.set",
            json{{"patch",
                  {{"ai",
                    {{"mode", "custom"},
                     {"custom",
                      {{"address", "http://127.0.0.1:1/v1"}, {"key", ""}, {"model", "m"}}}}}}}});
        {
            std::lock_guard<std::mutex> lock(f.script->mutex);
            f.script->next = ai::HttpOutcome::failure(
                "tls", "SSL certificate problem: self-signed certificate", 12);
        }
        JobRun run = run_job(f, "ai.complete",
                             json{{"target", {{"kind", "custom"}}}, {"body", chat_body()}});
        REQUIRE(run.result);
        CHECK(*run.result == json{{"ok", false},
                                  {"kind", "tls"},
                                  {"message", "SSL certificate problem: self-signed certificate"},
                                  {"elapsedMs", 12}});
        REQUIRE(f.ai_log_entries().size() == 1);
        CHECK(f.ai_log_entries()[0]["code"] == "ai.tls");
        CHECK(f.ai_log_entries()[0]["context"]["host"] == "127.0.0.1:1");
        CHECK_FALSE(f.ai_log_entries()[0]["context"].contains("status"));
        // The transport saw the request the Definitions describe, time-outs at their defaults.
        REQUIRE(f.transports->size() == 1);
        const ai::HttpRequest request = f.transports->take().front();
        CHECK(request.connect_ms == 20000);
        CHECK(request.total_ms == 120000);
        CHECK(request.resolve_entries.empty());
        CHECK(request.url == "http://127.0.0.1:1/v1/chat/completions");
    }
}
