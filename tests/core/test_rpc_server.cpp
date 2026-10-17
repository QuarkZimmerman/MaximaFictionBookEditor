// T022/T024/T025: loopback server end to end - token/Origin checks, /health, static UI with
// CSP, WebSocket JSON-RPC (app.*, settings.*, dialog.*, log.error, test.*), notifications,
// app.quit, open paths.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/dialog_provider.hpp>
#include <mfbe/version.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <regex>
#include <thread>

using namespace mfbe;
using nlohmann::json;

namespace {

struct ServerFixture {
    test::TempDir data{"mfbe-server"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;

    explicit ServerFixture(bool test_hooks = true, std::string ui_dir = "") {
        options.data_dir = data.path().string();
        options.test_hooks = test_hooks;
        options.ui_dir = std::move(ui_dir);
        server = CoreServer::start(options);
    }
    int port() const { return server->port(); }
    const std::string& token() const { return server->token(); }
    std::string ws_path() const { return "/rpc?token=" + token(); }
};

}  // namespace

TEST_CASE("server: starts on a random loopback port with a 128-bit token", "[server]") {
    ServerFixture f;
    CHECK(f.port() > 0);
    CHECK(f.token().size() == 32);
    CHECK(f.server->url() ==
          "http://127.0.0.1:" + std::to_string(f.port()) + "/?token=" + f.token());
    CHECK_FALSE(f.server->stopped());

    // The port is busy: a second server on the same port must fail cleanly.
    CoreServerOptions clash = f.options;
    clash.port = f.port();
    CHECK_THROWS_AS(CoreServer::start(clash), std::runtime_error);

    // Explicit token and port are honoured.
    test::TempDir other;
    CoreServerOptions custom;
    custom.data_dir = other.path().string();
    custom.token = "0123456789abcdef0123456789abcdef";
    custom.port = f.port() + 1 < 65535 ? 0 : 0;
    auto second = CoreServer::start(custom);
    CHECK(second->token() == custom.token);
    CHECK(second->port() != f.port());
}

TEST_CASE("server: /health requires the token; Origin must be own origin", "[server]") {
    ServerFixture f;
    const int port = f.port();

    auto ok = test::http_get(port, "/health?token=" + f.token());
    CHECK(ok.status == 200);
    const json body = json::parse(ok.body);
    CHECK(body["version"] == version::kVersion);
    CHECK(body["pid"].is_number_integer());
    CHECK(body["uptime"].is_number());
    CHECK(ok.headers["content-type"].rfind("application/json", 0) == 0);

    CHECK(test::http_get(port, "/health").status == 401);
    CHECK(test::http_get(port, "/health?token=wrong").status == 401);
    CHECK(test::http_get(port, "/health?token=" + f.token().substr(0, 31)).status == 401);
    CHECK(test::http_get(port, "/health", {{"X-MFBE-Token", f.token()}}).status == 200);
    CHECK(test::http_get(port, "/health", {{"Cookie", "mfbe_token=" + f.token()}}).status == 200);
    CHECK(
        test::http_get(port, "/health", {{"Cookie", "other=1; mfbe_token=" + f.token() + "; z=2"}})
            .status == 200);

    CHECK(test::http_get(port, "/health?token=" + f.token(), {{"Origin", "http://evil.example"}})
              .status == 403);
    CHECK(test::http_get(port, "/health?token=" + f.token(), {{"Origin", "http://127.0.0.1:1"}})
              .status == 403);
    CHECK(test::http_get(port, "/health?token=" + f.token(),
                         {{"Origin", "http://127.0.0.1:" + std::to_string(port)}})
              .status == 200);
    CHECK(test::http_get(port, "/health?token=" + f.token(),
                         {{"Origin", "http://localhost:" + std::to_string(port)}})
              .status == 200);
    // A foreign origin with a wrong token is still 403 (origin is checked first) and a
    // missing token with a correct origin is 401.
    CHECK(test::http_get(port, "/health", {{"Origin", "http://evil.example"}}).status == 403);
    CHECK(test::http_get(port, "/health", {{"Origin", "http://127.0.0.1:" + std::to_string(port)}})
              .status == 401);

    // Unknown paths without a UI directory -> 404 (after the token check).
    CHECK(test::http_get(port, "/anything").status == 401);
    CHECK(test::http_get(port, "/anything?token=" + f.token()).status == 404);
    CHECK(test::http_get(port, "/?token=" + f.token(), {}, "POST").status == 405);
}

TEST_CASE("server: static UI bundle is served with MIME types, CSP and token cookie", "[server]") {
    test::TempDir ui{"mfbe-ui"};
    test::write_text(ui / "index.html", "<!doctype html><html><body>MFBE</body></html>");
    test::write_text(ui / "assets" / "app.js", "console.log('hi')");
    test::write_text(ui / "assets" / "style.css", "body{}");
    test::write_text(ui / "icon.png", "PNG");
    test::write_text(ui.path().parent_path() / "outside-secret.txt", "secret");
    ServerFixture f(true, ui.path().string());
    const int port = f.port();
    const std::string own_origin = "127.0.0.1:" + std::to_string(port);

    auto index = test::http_get(port, "/?token=" + f.token());
    REQUIRE(index.status == 200);
    CHECK(index.body == "<!doctype html><html><body>MFBE</body></html>");
    CHECK(index.headers["content-type"] == "text/html; charset=utf-8");
    CHECK(index.headers["content-security-policy"] ==
          "default-src 'self'; connect-src 'self' ws://" + own_origin + " http://" + own_origin +
              "; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
              "worker-src 'self' blob:; script-src 'self'");
    CHECK(index.headers["set-cookie"] ==
          "mfbe_token=" + f.token() + "; Path=/; SameSite=Strict; HttpOnly");
    CHECK(index.headers["x-content-type-options"] == "nosniff");

    // Sub-resources authenticate through the cookie set by the page.
    auto js = test::http_get(port, "/assets/app.js", {{"Cookie", "mfbe_token=" + f.token()}});
    CHECK(js.status == 200);
    CHECK(js.headers["content-type"] == "text/javascript; charset=utf-8");
    CHECK_FALSE(js.headers.count("content-security-policy"));
    CHECK(test::http_get(port, "/assets/style.css?token=" + f.token()).headers["content-type"] ==
          "text/css; charset=utf-8");
    CHECK(test::http_get(port, "/icon.png?token=" + f.token()).headers["content-type"] ==
          "image/png");
    CHECK(test::http_get(port, "/assets/app.js").status == 401);
    CHECK(test::http_get(port, "/assets/missing.js?token=" + f.token()).status == 404);
    CHECK(test::http_get(port, "/assets/../../outside-secret.txt?token=" + f.token()).status ==
          404);
    CHECK(test::http_get(port, "/assets/%2e%2e/%2e%2e/outside-secret.txt?token=" + f.token())
              .status == 404);
    CHECK(test::http_get(port, "/assets?token=" + f.token()).status == 404);  // directory
    auto head = test::http_get(port, "/index.html?token=" + f.token(), {}, "HEAD");
    CHECK(head.status == 200);
    CHECK(head.body.empty());
}

TEST_CASE("server: WebSocket upgrade enforces token and Origin", "[server]") {
    ServerFixture f;
    test::WsClient no_token;
    CHECK(no_token.open(f.port(), "/rpc") == 401);
    test::WsClient bad_origin;
    CHECK(bad_origin.open(f.port(), f.ws_path(), {{"Origin", "http://evil.example"}}) == 403);
    test::WsClient header_token;
    CHECK(header_token.open(f.port(), "/rpc", {{"X-MFBE-Token", f.token()}}) == 101);
    test::WsClient cookie_token;
    CHECK(cookie_token.open(f.port(), "/rpc",
                            {{"Cookie", "mfbe_token=" + f.token()},
                             {"Origin", "http://127.0.0.1:" + std::to_string(f.port())}}) == 101);
    test::WsClient wrong_path;
    CHECK(wrong_path.open(f.port(), "/other?token=" + f.token()) != 101);
}

TEST_CASE("server: app.info / settings round trip / notifications over WebSocket", "[server]") {
    ServerFixture f;
    test::WsClient ws;
    REQUIRE(ws.open(f.port(), f.ws_path()) == 101);

    const json info = ws.call("app.info");
    REQUIRE(info.contains("result"));
    const json& r = info["result"];
    CHECK(r["version"] == version::kVersion);
    CHECK(r["build"] == version::kBuildId);
    CHECK(r["apiVersion"] == 1);
    CHECK(r["apiMinor"] == 2);  // additive contract revision: feature 002 = 1, feature 003 = 2
    CHECK(r["platform"].is_string());
    CHECK(r["uiLanguage"] == "system");
    CHECK(r["dataDir"] == f.data.path().string());
    CHECK(r["logDir"] == (f.data.path() / "logs").string());
    CHECK(r["resourceLayers"].is_array());
    CHECK(r["resourceLayers"].size() == 12);
    CHECK(r["testHooks"] == true);
    CHECK(r["port"] == f.port());

    const json settings = ws.call("settings.get")["result"];
    CHECK(settings["other"]["jpegQuality"] == 90);

    const json set = ws.call("settings.set", json{{"patch", {{"other", {{"jpegQuality", 70}}}}}});
    CHECK(set["result"]["restartRequired"] == false);
    CHECK(set["result"]["settings"]["other"]["jpegQuality"] == 70);
    auto changed = ws.wait_notification("settings.changed");
    REQUIRE(changed);
    CHECK((*changed)["params"]["settings"]["other"]["jpegQuality"] == 70);
    CHECK_FALSE(changed->contains("id"));
    CHECK(std::filesystem::exists(f.data.path() / "settings.json"));

    const json bad = ws.call("settings.set", json{{"patch", {{"other", {{"jpegQuality", 500}}}}}});
    CHECK(bad["error"]["code"] == 1040);
    CHECK(bad["error"]["data"]["field"] == "other.jpegQuality");
    CHECK(ws.call("settings.set", json::object())["error"]["code"] == -32602);

    const json lang = ws.call("app.setUiLanguage", json{{"lang", "ru"}});
    CHECK(lang["result"]["restartRequired"] == true);
    REQUIRE(ws.wait_notification("settings.changed"));
    CHECK(ws.call("app.setUiLanguage", json{{"lang", "ru"}})["result"]["restartRequired"] == false);
    CHECK(ws.call("app.setUiLanguage", json{{"lang", "xx"}})["error"]["code"] == 1040);
    CHECK(ws.call("app.info")["result"]["uiLanguage"] == "ru");

    CHECK(ws.call("no.such.method")["error"]["code"] == -32601);
    // Protocol errors over the wire.
    ws.send_text("{not json");
    auto parse_error = ws.receive_json();
    REQUIRE(parse_error);
    CHECK((*parse_error)["error"]["code"] == -32700);
    ws.send_text("[]");
    auto batch_error = ws.receive_json();
    REQUIRE(batch_error);
    CHECK((*batch_error)["error"]["code"] == -32600);

    // log.error lands in the errors-only log.
    CHECK(ws.call("log.error", json{{"source", "ui"},
                                    {"code", "ui.test"},
                                    {"message", "from the test"},
                                    {"stack", "at x"},
                                    {"context", {{"docId", "d1"}, {"view", "body"}}}})["result"] ==
          json::object());
    CHECK(ws.call("log.error", json::object())["error"]["code"] == -32602);  // message required
    const std::string log_text = test::read_text(f.data.path() / "logs" / "mfbe-errors.log");
    CHECK(log_text.find("\"code\":\"ui.test\"") != std::string::npos);
    CHECK(log_text.find("\"docId\":\"d1\"") != std::string::npos);
    CHECK(log_text.find("\"view\":\"body\"") != std::string::npos);
}

TEST_CASE("server: dialogs are unavailable without a provider; queued answers with test hooks",
          "[server]") {
    SECTION("no provider (test hooks off)") {
        ServerFixture f(false);
        test::WsClient ws;
        REQUIRE(ws.open(f.port(), f.ws_path()) == 101);
        const json r = ws.call("dialog.openFile", json{{"title", "Open"}});
        CHECK(r["error"]["code"] == 1050);
        CHECK(r["error"]["message"] == "dialog.unavailable");
        CHECK(ws.call("test.metrics")["error"]["code"] == -32601);  // not registered
        CHECK(ws.call("app.info")["result"]["testHooks"] == false);
        CHECK(ws.call("app.openLogFolder")["error"]["code"] == 1050);
    }
    SECTION("queued provider") {
        ServerFixture f(true);
        test::WsClient ws;
        REQUIRE(ws.open(f.port(), f.ws_path()) == 101);
        CHECK(ws.call("test.enqueueDialog",
                      json{{"method", "dialog.openFile"},
                           {"result", {{"paths", {"/tmp/a.fb2"}}}}})["result"]["queued"] == 1);
        CHECK(ws.call("test.enqueueDialog", json{{"method", "dialog.saveFile"},
                                                 {"result",
                                                  {{"path", "/tmp/out.fb2"},
                                                   {"encoding", "utf-8"}}}})["result"]["queued"] ==
              2);
        const json open =
            ws.call("dialog.openFile", json{{"title", "Open"}, {"filters", json::array()}});
        CHECK(open["result"] == json{{"paths", {"/tmp/a.fb2"}}});
        const json save = ws.call("dialog.saveFile", json{{"title", "Save"}});
        CHECK(save["result"] == json{{"path", "/tmp/out.fb2"}, {"encoding", "utf-8"}});
        const json empty = ws.call("dialog.pickFolder", json{{"title", "Pick"}});
        CHECK(empty["error"]["code"] == 1050);
        CHECK(empty["error"]["data"]["reason"].get<std::string>().find("dialog.pickFolder") !=
              std::string::npos);
        CHECK(ws.call("test.enqueueDialog", json{{"method", "app.info"}})["error"]["code"] ==
              -32602);
        CHECK(ws.call("dialog.message", json{{"text", 5}})["error"]["code"] == -32602);

        // Feature 002: every file dialog request is recorded, answered or not.
        const json requests = ws.call("test.dialogRequests")["result"];
        REQUIRE(requests.size() == 3);
        CHECK(requests[0]["method"] == "dialog.openFile");
        CHECK(requests[0]["mode"] == "open");
        CHECK(requests[0]["selectedFilter"] == 0);
        CHECK(requests[1]["mode"] == "save");
        CHECK(requests[2]["mode"] == "folder");
        CHECK(ws.call("test.beeps")["result"]["count"] == 0);
        CHECK(ws.call("app.beep", json{{"kind", "searchWrap"}})["result"] == json::object());
        CHECK(ws.call("test.beeps")["result"]["count"] == 1);
        CHECK(ws.call("test.enqueueRelease",
                      json{{"result", {{"tag", "v0.0.9"}}}})["result"]["queued"] == 1);
        CHECK(ws.call("test.enqueueRelease",
                      json{{"error", {{"reason", "offline"}}}})["result"]["queued"] == 2);
        CHECK(ws.call("test.enqueueRelease", json{{"result", {{"tag", ""}}}})["error"]["code"] ==
              -32602);
        // Feature 002: Help > Check for new version, answered by the queue in order.
        CHECK(
            ws.call("app.latestRelease")["result"] ==
            json{
                {"tag", "v0.0.9"},
                {"version", "0.0.9"},
                {"url",
                 "https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases/tag/v0.0.9"}});
        const json offline = ws.call("app.latestRelease");
        CHECK(offline["error"]["code"] == 1060);
        CHECK(offline["error"]["data"]["reason"] == "offline");
        CHECK(ws.call("app.latestRelease")["error"]["code"] == 1050);  // nothing queued

        const json metrics = ws.call("test.metrics")["result"];
        CHECK(metrics["memoryBytes"].get<std::int64_t>() > 0);
        CHECK(metrics["uptimeMs"].is_number());
        CHECK(metrics["openDocuments"] == 0);

        // Shell-delegated folder opening: the queued provider records instead of launching.
        CHECK(ws.call("app.openLogFolder")["result"] == json::object());
        CHECK(ws.call("app.openFolder", json{{"path", f.data.path().string()}})["result"] ==
              json::object());
        CHECK(ws.call("app.openFolder",
                      json{{"path", (f.data / "nope").string()}})["error"]["code"] == 1002);

        // Fault injection hook.
        CHECK(ws.call("test.injectFault", json{{"point", "before_rename"}})["result"] ==
              json::object());
        CHECK(ws.call("test.injectFault", json{{"point", "bogus"}})["error"]["code"] == -32602);
        CHECK(ws.call("test.injectFault", json{{"point", "none"}})["result"] == json::object());

        // Corpus sample over the mini fixture corpus (async handler).
        const json sample = ws.call(
            "test.corpusSample", json{{"count", 4},
                                      {"seed", 3},
                                      {"root", (test::fixtures_dir() / "corpus-mini").string()}});
        REQUIRE(sample.contains("result"));
        CHECK(sample["result"]["scanned"] == 12);
        REQUIRE(sample["result"]["paths"].size() == 4);
        CHECK(std::filesystem::path(sample["result"]["paths"][0].get<std::string>())
                  .generic_string()
                  .find("0000a1/book1.fb2") != std::string::npos);
        CHECK(ws.call("test.corpusSample",
                      json{{"root", "/definitely/missing"}})["error"]["code"] == 1002);
    }
}

TEST_CASE("server: feature 003 test hooks - network requests, restart requests, close request",
          "[server]") {
    SECTION("not registered without test hooks") {
        ServerFixture f(false);
        test::WsClient ws;
        REQUIRE(ws.open(f.port(), f.ws_path()) == 101);
        CHECK(ws.call("test.requests")["error"]["code"] == -32601);
        CHECK(ws.call("test.restartRequests")["error"]["code"] == -32601);
        CHECK(ws.call("test.requestClose")["error"]["code"] == -32601);
    }
    SECTION("queued provider") {
        ServerFixture f(true);
        test::WsClient ws;
        REQUIRE(ws.open(f.port(), f.ws_path()) == 101);
        CHECK(ws.call("test.requests")["result"] == json::array());
        CHECK(ws.call("test.restartRequests")["result"] == json::array());

        // Every app.latestRelease the core delegates is recorded with the time of the call,
        // answered (by the queue) or not (1050).
        CHECK(ws.call("test.enqueueRelease",
                      json{{"result", {{"tag", "v0.0.9"}}}})["result"]["queued"] == 1);
        REQUIRE(ws.call("app.latestRelease").contains("result"));
        json requests = ws.call("test.requests")["result"];
        REQUIRE(requests.size() == 1);
        CHECK(requests[0]["method"] == "app.latestRelease");
        CHECK(std::regex_match(requests[0]["at"].get<std::string>(),
                               std::regex(R"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)")));
        CHECK(requests[0].size() == 2);
        CHECK(ws.call("app.latestRelease")["error"]["code"] == 1050);
        requests = ws.call("test.requests")["result"];
        REQUIRE(requests.size() == 2);
        CHECK(requests[1]["method"] == "app.latestRelease");

        // The provider records app.restart calls as {reopen?, argv} (the app.restart handler
        // arrives with the restart feature; the server's provider is not reachable from here).
        QueuedDialogProvider provider;
        CHECK(provider.restart_requests().empty());
        provider.record_restart(std::nullopt, {});
        provider.record_restart("/books/книга.fb2", {"--no-sandbox", "--url", "x"});
        const auto restarts = provider.restart_requests();
        REQUIRE(restarts.size() == 2);
        CHECK(restarts[0] == json{{"argv", json::array()}});
        CHECK(restarts[1] ==
              json{{"reopen", "/books/книга.fb2"}, {"argv", {"--no-sandbox", "--url", "x"}}});
        CHECK(provider.network_requests().empty());

        // test.requestClose emits app.closeRequested {} to every connected client.
        test::WsClient other;
        REQUIRE(other.open(f.port(), f.ws_path()) == 101);
        CHECK(ws.call("test.requestClose")["result"] == json::object());
        auto closing = ws.wait_notification("app.closeRequested");
        REQUIRE(closing);
        CHECK((*closing)["params"] == json::object());
        CHECK_FALSE(closing->contains("id"));
        auto on_other = other.wait_notification("app.closeRequested");
        REQUIRE(on_other);
        CHECK((*on_other)["params"] == json::object());
        CHECK_FALSE(f.server->stopped());  // the UI decides; nothing closes by itself
    }
}

TEST_CASE("server: a custom DialogProvider attached in-process answers dialogs asynchronously",
          "[server]") {
    struct AsyncProvider : DialogProvider {
        void open_file(const OpenFileRequest& req, Callback<OpenFileResult> done) override {
            std::thread([req, done] {
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
                done(OpenFileResult{{"/async/" + req.title}});
            }).detach();
        }
        void save_file(const SaveFileRequest&, Callback<SaveFileResult> done) override {
            done(SaveFileResult{});
        }
        void pick_folder(const PickFolderRequest&, Callback<PickFolderResult> done) override {
            done(PickFolderResult{std::string("/picked")});
        }
        void message(const MessageRequest& req, Callback<MessageResult> done) override {
            done(MessageResult{req.buttons.empty() ? "" : req.buttons.front()});
        }
    };
    ServerFixture f(false);
    f.server->set_dialog_provider(std::make_shared<AsyncProvider>());
    test::WsClient ws;
    REQUIRE(ws.open(f.port(), f.ws_path()) == 101);
    CHECK(ws.call("dialog.openFile", json{{"title", "x.fb2"}})["result"] ==
          json{{"paths", {"/async/x.fb2"}}});
    CHECK(ws.call("dialog.saveFile", json{{"title", "s"}})["result"] == json::object());
    CHECK(ws.call("dialog.pickFolder", json{{"title", "p"}})["result"] ==
          json{{"path", "/picked"}});
    CHECK(ws.call("dialog.message",
                  json{{"text", "t"}, {"caption", "c"}, {"buttons", {"OK", "Cancel"}}})["result"] ==
          json{{"button", "OK"}});
    f.server->set_dialog_provider(nullptr);
    CHECK(ws.call("dialog.message", json{{"text", "t"}})["error"]["code"] == 1050);
}

TEST_CASE("server: notifications are broadcast to every connection; open paths are queued",
          "[server]") {
    ServerFixture f;
    f.options.open_paths = {"/books/first.fb2"};
    f.server.reset();
    f.server = CoreServer::start(f.options);

    test::WsClient a;
    REQUIRE(a.open(f.port(), f.ws_path()) == 101);
    auto open_paths = a.wait_notification("app.openPaths");
    REQUIRE(open_paths);
    CHECK((*open_paths)["params"]["paths"] == json::array({"/books/first.fb2"}));

    test::WsClient b;
    REQUIRE(b.open(f.port(), f.ws_path()) == 101);
    CHECK_FALSE(b.wait_notification("app.openPaths", 200));  // delivered once only

    f.server->notify_open_paths({"/books/second.fb2"});
    REQUIRE(a.wait_notification("app.openPaths"));
    REQUIRE(b.wait_notification("app.openPaths"));

    b.call("settings.set", json{{"patch", {{"view", {{"spellEnabled", false}}}}}});
    auto on_a = a.wait_notification("settings.changed");
    REQUIRE(on_a);
    CHECK((*on_a)["params"]["settings"]["view"]["spellEnabled"] == false);
    REQUIRE(b.wait_notification("settings.changed"));

    // Closing one connection does not disturb the other.
    a.send_close();
    a.close();
    CHECK(b.call("app.info")["result"]["apiVersion"] == 1);
}

TEST_CASE("server: app.quit answers, closes clients with 1001 and stops the server", "[server]") {
    ServerFixture f;
    test::WsClient ws;
    REQUIRE(ws.open(f.port(), f.ws_path()) == 101);
    CHECK(ws.call("app.quit")["result"] == json::object());
    auto frame = ws.receive(5000);
    REQUIRE(frame);
    CHECK(frame->opcode == 8);
    REQUIRE(frame->payload.size() >= 2);
    const int code = (static_cast<unsigned char>(frame->payload[0]) << 8) |
                     static_cast<unsigned char>(frame->payload[1]);
    CHECK(code == 1001);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (!f.server->stopped() && std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    CHECK(f.server->stopped());
    f.server->wait();
    f.server->stop();  // idempotent
    CHECK_THROWS(test::http_get(f.port(), "/health?token=" + f.token()));
}

TEST_CASE("server: stop() from the owner thread shuts down even with idle HTTP connections",
          "[server]") {
    ServerFixture f;
    test::TcpClient idle;
    idle.connect(f.port());  // keep-alive connection that never sends anything
    const auto t0 = std::chrono::steady_clock::now();
    f.server->stop();
    f.server->wait();
    const auto elapsed = std::chrono::steady_clock::now() - t0;
    CHECK(elapsed < std::chrono::seconds(3));
    CHECK(f.server->stopped());
}
