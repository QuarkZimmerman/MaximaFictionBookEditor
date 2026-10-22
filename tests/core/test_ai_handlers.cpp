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
