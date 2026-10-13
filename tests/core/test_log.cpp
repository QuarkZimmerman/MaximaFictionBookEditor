// T012: errors-only log.
#include "test_support.hpp"

#include <mfbe/log.hpp>

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>
#include <sstream>

using namespace mfbe;

TEST_CASE("log: format_entry renders a single JSON line with the mandated fields", "[log]") {
    log::Context ctx;
    ctx.docId = "d1";
    ctx.nodeId = "n5";
    ctx.extra["path"] = "/tmp/x";
    const std::string line = log::format_entry(log::Level::error, "core", "io.writeFailed",
                                               "cannot write", ctx, "stack trace");
    REQUIRE(line.find('\n') == std::string::npos);
    const auto j = nlohmann::json::parse(line);
    CHECK(j["level"] == "error");
    CHECK(j["source"] == "core");
    CHECK(j["code"] == "io.writeFailed");
    CHECK(j["message"] == "cannot write");
    CHECK(j["stack"] == "stack trace");
    CHECK(j["context"]["docId"] == "d1");
    CHECK(j["context"]["nodeId"] == "n5");
    CHECK(j["context"]["path"] == "/tmp/x");
    CHECK(j["context"].contains("version"));
    CHECK(j["context"].contains("platform"));
    const std::string ts = j["ts"].get<std::string>();
    CHECK(ts.size() == 24);  // 2026-10-12T20:00:00.123Z
    CHECK(ts.back() == 'Z');
}

TEST_CASE("log: init writes error and warning entries to mfbe-errors.log", "[log]") {
    test::TempDir tmp;
    log::init(tmp.path() / "logs");
    log::error("ui", "ui.crash", "boom", log::extras({{"view", "body"}}));
    log::warning("core", "settings.invalidValue", "reset", {});
    log::info("core", "not written to the file");
    log::debug("core", "not written either");
    log::shutdown();

    const auto file = tmp.path() / "logs" / "mfbe-errors.log";
    REQUIRE(std::filesystem::exists(file));
    std::istringstream in(test::read_text(file));
    std::string line;
    std::vector<nlohmann::json> entries;
    while (std::getline(in, line)) {
        if (!line.empty()) {
            entries.push_back(nlohmann::json::parse(line));
        }
    }
    REQUIRE(entries.size() == 2);
    CHECK(entries[0]["level"] == "error");
    CHECK(entries[0]["code"] == "ui.crash");
    CHECK(entries[0]["context"]["view"] == "body");
    CHECK(entries[1]["level"] == "warning");
    CHECK(entries[1]["code"] == "settings.invalidValue");
}

TEST_CASE("log: console level parsing", "[log]") {
    log::set_console_level("debug");
    CHECK(log::console_level() == log::Level::debug);
    log::set_console_level("warn");
    CHECK(log::console_level() == log::Level::warning);
    log::set_console_level("nonsense");
    CHECK(log::console_level() == log::Level::warning);
    log::set_console_level("error");
    CHECK(log::console_level() == log::Level::error);
}

TEST_CASE("log: oversized fields are truncated", "[log]") {
    const std::string huge(10000, 'x');
    const auto j =
        nlohmann::json::parse(log::format_entry(log::Level::error, "core", "x", huge, {}, ""));
    CHECK(j["message"].get<std::string>().size() < 5000);
}
