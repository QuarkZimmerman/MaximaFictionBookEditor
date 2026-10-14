// T021: JSON-RPC 2.0 router, error table, params helpers, async responders and jobs.
#include <mfbe/rpc.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <thread>

using namespace mfbe;
using nlohmann::json;

namespace {

struct Harness {
    rpc::RecordingNotifier notifier;
    rpc::JobManager jobs{notifier};
    rpc::RpcContext ctx{notifier, jobs, "test"};
    rpc::RpcRouter router;
    std::vector<json> async_responses;

    std::optional<json> dispatch(const json& request) {
        return router.dispatch(request, ctx,
                               [this](json response) { async_responses.push_back(response); });
    }
    std::optional<json> dispatch_text(const std::string& text) {
        return router.dispatch_text(text, ctx,
                                    [this](json response) { async_responses.push_back(response); });
    }
};

json request(json id, const std::string& method, json params = json::object()) {
    return json{{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", params}};
}

}  // namespace

TEST_CASE("rpc: error table matches rpc-api.md section 1", "[rpc]") {
    using namespace rpc::codes;
    CHECK(std::string(rpc::error_name(kDocNotFound)) == "doc.notFound");
    CHECK(kDocNotFound == 1000);
    CHECK(kDocParseError == 1001);
    CHECK(kDocIoError == 1002);
    CHECK(kDocSourceMalformed == 1003);
    CHECK(kDocNotFictionBook == 1004);
    CHECK(std::string(rpc::error_name(kDocNotFictionBook)) == "doc.notFictionBook");
    CHECK(kBinaryNotFound == 1010);
    CHECK(kSpellDictionaryUnavailable == 1020);
    CHECK(kScriptNotFound == 1030);
    CHECK(kScriptInvalidManifest == 1031);
    CHECK(kSettingsInvalid == 1040);
    CHECK(kDialogUnavailable == 1050);
    CHECK(kReleaseUnavailable == 1060);
    CHECK(kCancelled == 1090);
    CHECK(std::string(rpc::error_name(kDialogUnavailable)) == "dialog.unavailable");
    CHECK(std::string(rpc::error_name(kReleaseUnavailable)) == "app.releaseUnavailable");
    CHECK(std::string(rpc::error_name(kCancelled)) == "cancelled");
    CHECK(std::string(rpc::error_name(-32601)) == "methodNotFound");
    CHECK(std::string(rpc::error_name(4242)).empty());

    rpc::RpcError e(kDocIoError, "", json{{"path", "/x"}, {"reason", "EACCES"}});
    CHECK(e.message == "doc.ioError");
    CHECK(e.to_json() == json{{"code", 1002},
                              {"message", "doc.ioError"},
                              {"data", {{"path", "/x"}, {"reason", "EACCES"}}}});
    rpc::RpcError custom(kDocParseError, "line 3: mismatched tag");
    CHECK(custom.to_json() == json{{"code", 1001}, {"message", "line 3: mismatched tag"}});
    CHECK(std::string(custom.what()) == "line 3: mismatched tag");
}

TEST_CASE("rpc: sync dispatch - results, errors and protocol violations", "[rpc]") {
    Harness h;
    h.router.add_method("echo", [](const json& params, rpc::RpcContext&) { return params; });
    h.router.add_method("boom", [](const json&, rpc::RpcContext&) -> json {
        throw rpc::RpcError(rpc::codes::kDocNotFound, "", json{{"docId", "d9"}});
    });
    h.router.add_method("crash", [](const json&, rpc::RpcContext&) -> json {
        throw std::runtime_error("unexpected");
    });
    CHECK(h.router.has_method("echo"));
    CHECK(h.router.methods() == std::vector<std::string>{"boom", "crash", "echo"});

    auto ok = h.dispatch(request(1, "echo", json{{"a", 1}}));
    REQUIRE(ok);
    CHECK(*ok == json{{"jsonrpc", "2.0"}, {"id", 1}, {"result", {{"a", 1}}}});

    auto err = h.dispatch(request("x", "boom"));
    REQUIRE(err);
    CHECK((*err)["id"] == "x");
    CHECK((*err)["error"]["code"] == 1000);
    CHECK((*err)["error"]["data"]["docId"] == "d9");

    auto crash = h.dispatch(request(2, "crash"));
    REQUIRE(crash);
    CHECK((*crash)["error"]["code"] == -32603);

    auto missing = h.dispatch(request(3, "nope"));
    CHECK((*missing)["error"]["code"] == -32601);

    auto parse = h.dispatch_text("{bad json");
    CHECK((*parse)["error"]["code"] == -32700);
    CHECK((*parse)["id"].is_null());

    auto batch = h.dispatch(json::array({request(1, "echo")}));
    CHECK((*batch)["error"]["code"] == -32600);

    auto version = h.dispatch(json{{"jsonrpc", "1.0"}, {"id", 4}, {"method", "echo"}});
    CHECK((*version)["error"]["code"] == -32600);

    auto no_method = h.dispatch(json{{"jsonrpc", "2.0"}, {"id", 5}});
    CHECK((*no_method)["error"]["code"] == -32600);

    auto bad_params =
        h.dispatch(json{{"jsonrpc", "2.0"}, {"id", 6}, {"method", "echo"}, {"params", 7}});
    CHECK((*bad_params)["error"]["code"] == -32602);

    // Omitted params = empty object.
    auto none = h.dispatch(json{{"jsonrpc", "2.0"}, {"id", 7}, {"method", "echo"}});
    CHECK((*none)["result"] == json::object());

    // Notifications (no id) never produce a response, even on error.
    CHECK_FALSE(h.dispatch(json{{"jsonrpc", "2.0"}, {"method", "echo"}}).has_value());
    CHECK_FALSE(h.dispatch(json{{"jsonrpc", "2.0"}, {"method", "boom"}}).has_value());
    CHECK_FALSE(h.dispatch(json{{"jsonrpc", "2.0"}, {"method", "nope"}}).has_value());
    CHECK(h.async_responses.empty());
}

TEST_CASE("rpc: params helpers validate shapes and report the field", "[rpc]") {
    const json p{
        {"name", "x"}, {"n", 3}, {"flag", true}, {"list", {"a", "b"}}, {"obj", {{"k", 1}}}};
    CHECK(rpc::params::string(p, "name") == "x");
    CHECK(rpc::params::string_or(p, "missing", "d") == "d");
    CHECK_FALSE(rpc::params::opt_string(p, "missing").has_value());
    CHECK(rpc::params::integer(p, "n") == 3);
    CHECK(rpc::params::integer_or(p, "missing", 9) == 9);
    CHECK(rpc::params::boolean_or(p, "flag", false));
    CHECK(rpc::params::string_array_or(p, "list") == std::vector<std::string>{"a", "b"});
    CHECK(rpc::params::object_field(p, "obj")["k"] == 1);
    CHECK(rpc::params::opt_field(p, "missing") == nullptr);
    CHECK(rpc::params::object(nullptr).empty());

    auto expect_field = [](auto&& fn, const std::string& field) {
        try {
            fn();
            FAIL("expected RpcError for " << field);
        } catch (const rpc::RpcError& e) {
            CHECK(e.code == rpc::codes::kInvalidParams);
            CHECK(e.data["field"] == field);
        }
    };
    expect_field([&] { rpc::params::string(p, "n"); }, "n");
    expect_field([&] { rpc::params::string(p, "missing"); }, "missing");
    expect_field([&] { rpc::params::integer(p, "name"); }, "name");
    expect_field([&] { rpc::params::boolean_or(p, "n", false); }, "n");
    expect_field([&] { rpc::params::string_array_or(p, "obj"); }, "obj");
    expect_field([&] { rpc::params::object_field(p, "list"); }, "list");
    CHECK_THROWS_AS(rpc::params::object(json::array()), rpc::RpcError);
}

TEST_CASE("rpc: async handlers respond through the sink exactly once", "[rpc]") {
    Harness h;
    rpc::Responder* captured = nullptr;
    std::optional<rpc::Responder> held;
    h.router.add_async_method("later", [&](const json&, rpc::RpcContext&, rpc::Responder respond) {
        held = respond;
        captured = &*held;
    });
    h.router.add_async_method("now", [](const json& p, rpc::RpcContext&, rpc::Responder respond) {
        respond.ok(json{{"got", p}});
    });
    h.router.add_async_method("throws", [](const json&, rpc::RpcContext&, rpc::Responder) {
        throw rpc::RpcError(rpc::codes::kDialogUnavailable);
    });
    h.router.add_async_method("forgets", [](const json&, rpc::RpcContext&, rpc::Responder) {});

    CHECK_FALSE(h.dispatch(request(1, "now", json{{"x", 1}})).has_value());
    REQUIRE(h.async_responses.size() == 1);
    CHECK(h.async_responses[0] ==
          json{{"jsonrpc", "2.0"}, {"id", 1}, {"result", {{"got", {{"x", 1}}}}}});

    CHECK_FALSE(h.dispatch(request(2, "later")).has_value());
    CHECK(h.async_responses.size() == 1);
    REQUIRE(captured != nullptr);
    captured->ok(json{{"done", true}});
    captured->fail(rpc::RpcError(rpc::codes::kCancelled));  // ignored: already answered
    held.reset();
    REQUIRE(h.async_responses.size() == 2);
    CHECK(h.async_responses[1]["id"] == 2);
    CHECK(h.async_responses[1]["result"] == json{{"done", true}});

    CHECK_FALSE(h.dispatch(request(3, "throws")).has_value());
    REQUIRE(h.async_responses.size() == 3);
    CHECK(h.async_responses[2]["error"]["code"] == 1050);

    CHECK_FALSE(h.dispatch(request(4, "forgets")).has_value());
    REQUIRE(h.async_responses.size() == 4);  // dropped responder -> internal error
    CHECK(h.async_responses[3]["error"]["code"] == -32603);

    // call() awaits asynchronous handlers.
    const json r = h.router.call("now", json{{"y", 2}}, h.ctx);
    CHECK(r["result"]["got"]["y"] == 2);
}

TEST_CASE("rpc: jobs emit progress/done/failed and support cancellation", "[rpc]") {
    rpc::RecordingNotifier notifier;
    rpc::JobManager jobs(notifier);

    SECTION("successful job") {
        const std::string id = jobs.start([](rpc::JobControl& c) {
            c.progress("open", 1, 2);
            c.progress("open", 2, 2);
            return json{{"ok", true}};
        });
        CHECK(id == "j1");
        REQUIRE(jobs.wait_idle(5000));
        const auto events = notifier.take();
        REQUIRE(events.size() == 3);
        CHECK(events[0].first == "job.progress");
        CHECK(events[0].second ==
              json{{"jobId", "j1"}, {"phase", "open"}, {"done", 1}, {"total", 2}});
        CHECK(events[2].first == "job.done");
        CHECK(events[2].second == json{{"jobId", "j1"}, {"result", {{"ok", true}}}});
        CHECK_FALSE(jobs.running("j1"));
        CHECK_FALSE(jobs.cancel("j1"));
    }
    SECTION("failing job") {
        jobs.start([](rpc::JobControl&) -> json {
            throw rpc::RpcError(rpc::codes::kDocIoError, "", json{{"path", "/p"}});
        });
        REQUIRE(jobs.wait_idle(5000));
        const auto events = notifier.take();
        REQUIRE(events.size() == 1);
        CHECK(events[0].first == "job.failed");
        CHECK(events[0].second["error"]["code"] == 1002);
    }
    SECTION("crashing job becomes an internal error") {
        jobs.start([](rpc::JobControl&) -> json { throw std::runtime_error("x"); });
        REQUIRE(jobs.wait_idle(5000));
        const auto events = notifier.take();
        REQUIRE(events.size() == 1);
        CHECK(events[0].second["error"]["code"] == -32603);
    }
    SECTION("cancelled job reports 1090") {
        std::atomic<bool> started{false};
        const std::string id = jobs.start([&](rpc::JobControl& c) -> json {
            started = true;
            for (int i = 0; i < 1000; ++i) {
                c.check_cancelled();
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
            }
            return json{{"finished", true}};
        });
        while (!started) {
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        CHECK(jobs.running(id));
        CHECK(jobs.running_count() == 1);
        CHECK(jobs.cancel(id));
        REQUIRE(jobs.wait_idle(5000));
        const auto events = notifier.take();
        REQUIRE(events.size() == 1);
        CHECK(events[0].first == "job.failed");
        CHECK(events[0].second["error"]["code"] == 1090);
        CHECK(events[0].second["error"]["data"]["jobId"] == id);
    }
    SECTION("shutdown cancels running jobs") {
        jobs.start([&](rpc::JobControl& c) -> json {
            while (!c.cancelled()) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            return json::object();
        });
        jobs.shutdown();
        CHECK(jobs.running_count() == 0);
        CHECK_THROWS_AS(jobs.start([](rpc::JobControl&) { return json(); }), rpc::RpcError);
    }
}

TEST_CASE("rpc: notification envelope", "[rpc]") {
    CHECK(rpc::RpcRouter::make_notification("settings.changed", json{{"settings", 1}}) ==
          json{{"jsonrpc", "2.0"}, {"method", "settings.changed"}, {"params", {{"settings", 1}}}});
}
