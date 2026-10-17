// The editor's relaunch of itself (feature 003 US3, research R4; contracts/cli.md §1): the
// restarted editor gets the running shell's start-up options without FILE, `--new` and `--lang`
// (the language override was for one run; the new language setting is the reason for the
// restart), plus `--wait-for-exit <pid>`, `--window-geometry <x,y,w,h[,max]>` and the reopen
// path as FILE; the program is $APPIMAGE when set, else the executable; `--wait-for-exit` polls
// the old process and gives up after the timeout; the Windows command line quotes arguments the
// way CommandLineToArgvW reads them.
#include "relaunch.h"

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

using namespace std::chrono_literals;
using mfbe::shell::relaunchArguments;
using mfbe::shell::relaunchProgram;
using mfbe::shell::WaitClock;
using mfbe::shell::waitForProcessExit;
using mfbe::shell::windowsCommandLine;

namespace {

// A clock the tests advance by hand: sleep() moves time forward, nothing waits for real.
struct FakeClock {
    std::chrono::steady_clock::time_point now{};
    std::vector<std::chrono::milliseconds> sleeps;

    WaitClock clock() {
        return WaitClock{[this] { return now; },
                         [this](std::chrono::milliseconds duration) {
                             sleeps.push_back(duration);
                             now += duration;
                         }};
    }
};

}  // namespace

TEST_CASE("relaunch: the start-up options are kept, FILE, --new and --lang are dropped",
          "[relaunch]") {
    const std::vector<std::string> own = {"--no-sandbox",
                                          "--ozone-platform=x11",
                                          "--remote-debugging-port",
                                          "9222",
                                          "--lang",
                                          "ru",
                                          "--new",
                                          "--url=http://127.0.0.1:5173/",
                                          "/books/old.fb2",
                                          "second.fb2"};
    const auto args =
        relaunchArguments(own, 4242, "10,20,1200,800", std::string("/books/книга.fb2"));
    CHECK(args == std::vector<std::string>{
                      "--no-sandbox", "--ozone-platform=x11", "--remote-debugging-port", "9222",
                      "--url=http://127.0.0.1:5173/", "--wait-for-exit", "4242",
                      "--window-geometry", "10,20,1200,800", "/books/книга.fb2"});
}

TEST_CASE("relaunch: both spellings of a dropped option go, with their values", "[relaunch]") {
    // `--lang=uk` and `--lang uk` are both the one-run override; `--ozone-platform wayland` in
    // the two-word spelling keeps its value.
    const auto args = relaunchArguments(
        {"--lang=uk", "--ozone-platform", "wayland", "--lang", "en", "--new"}, 7, "", std::nullopt);
    CHECK(args == std::vector<std::string>{"--ozone-platform", "wayland", "--wait-for-exit", "7"});
}

TEST_CASE("relaunch: a previous restart's own options are replaced, not repeated", "[relaunch]") {
    // The restarted editor restarts again: its argv already holds --wait-for-exit and
    // --window-geometry (in either spelling) - the new values replace them.
    const auto args = relaunchArguments(
        {"--wait-for-exit", "100", "--window-geometry=0,0,800,600", "--no-sandbox",
         "--wait-for-exit=101", "--window-geometry", "1,1,2,2", "/books/a.fb2"},
        200, "30,40,1000,700,max", std::string("/books/b.fb2"));
    CHECK(args == std::vector<std::string>{"--no-sandbox", "--wait-for-exit", "200",
                                           "--window-geometry", "30,40,1000,700,max",
                                           "/books/b.fb2"});
}

TEST_CASE("relaunch: no reopen path means no FILE; no geometry means no --window-geometry",
          "[relaunch]") {
    CHECK(relaunchArguments({}, 1, "", std::nullopt) ==
          std::vector<std::string>{"--wait-for-exit", "1"});
    // A never-saved document is not carried over (spec FR-020).
    CHECK(relaunchArguments({"/books/old.fb2"}, 1, "0,0,640,400", std::nullopt) ==
          std::vector<std::string>{"--wait-for-exit", "1", "--window-geometry", "0,0,640,400"});
}

TEST_CASE(
    "relaunch: everything after `--` was a FILE and goes; a reopen path starting with '-' "
    "is passed after `--`",
    "[relaunch]") {
    CHECK(relaunchArguments({"--no-sandbox", "--", "--lang", "weird.fb2"}, 5, "", std::nullopt) ==
          std::vector<std::string>{"--no-sandbox", "--wait-for-exit", "5"});
    CHECK(relaunchArguments({}, 5, "", std::string("-dash.fb2")) ==
          std::vector<std::string>{"--wait-for-exit", "5", "--", "-dash.fb2"});
}

TEST_CASE("relaunch: the program is $APPIMAGE when set, else the executable", "[relaunch]") {
    CHECK(relaunchProgram("/home/u/Downloads/mfbe-0.0.3.AppImage",
                          "/tmp/.mount_mfbeAb12/usr/lib/mfbe/mfbe") ==
          "/home/u/Downloads/mfbe-0.0.3.AppImage");
    CHECK(relaunchProgram("", "/usr/lib/mfbe/mfbe") == "/usr/lib/mfbe/mfbe");
    CHECK(relaunchProgram("", "C:\\Program Files\\Maxima Fiction Book Editor\\bin\\mfbe.exe") ==
          "C:\\Program Files\\Maxima Fiction Book Editor\\bin\\mfbe.exe");
    // The running executable and process are known.
    CHECK_FALSE(mfbe::shell::currentExecutable().empty());
    CHECK(mfbe::shell::currentProcessId() > 0);
}

TEST_CASE("relaunch: the Windows command line quotes what CommandLineToArgvW needs quoted",
          "[relaunch]") {
    CHECK(windowsCommandLine(
              "C:\\Program Files\\mfbe\\bin\\mfbe.exe",
              {"--no-sandbox", "--wait-for-exit", "4242", "C:\\Книги\\Моя книга.fb2"}) ==
          "\"C:\\Program Files\\mfbe\\bin\\mfbe.exe\" --no-sandbox --wait-for-exit 4242 "
          "\"C:\\Книги\\Моя книга.fb2\"");
    // Empty arguments stay as a pair of quotes; quotes are escaped; backslashes before a quote
    // (or at the end of a quoted argument) are doubled, elsewhere left alone.
    CHECK(windowsCommandLine("mfbe.exe", {"", "say \"hi\"", "C:\\my dir\\", "a\\b", "C:\\dir\\"}) ==
          "mfbe.exe \"\" \"say \\\"hi\\\"\" \"C:\\my dir\\\\\" a\\b C:\\dir\\");
}

TEST_CASE("relaunch: --wait-for-exit polls until the process is gone", "[relaunch]") {
    FakeClock clock;
    int polls = 0;
    const auto alive = [&] { return ++polls < 4; };  // gone at the fourth poll
    CHECK(waitForProcessExit(alive, 30s, 100ms, clock.clock()));
    CHECK(polls == 4);
    CHECK(clock.sleeps == std::vector<std::chrono::milliseconds>{100ms, 100ms, 100ms});
}

TEST_CASE("relaunch: --wait-for-exit gives up after the timeout and the editor starts anyway",
          "[relaunch]") {
    FakeClock clock;
    int polls = 0;
    const auto alive = [&] {
        ++polls;
        return true;
    };
    CHECK_FALSE(waitForProcessExit(alive, 30s, 100ms, clock.clock()));
    CHECK(clock.now == std::chrono::steady_clock::time_point{} + 30s);
    CHECK(polls == 301);  // one poll per 100 ms over 30 s, plus the first
    CHECK(clock.sleeps.size() == 300);
}

TEST_CASE("relaunch: a process that is already gone is not waited for", "[relaunch]") {
    FakeClock clock;
    CHECK(waitForProcessExit([] { return false; }, 30s, 100ms, clock.clock()));
    CHECK(clock.sleeps.empty());
}

TEST_CASE("relaunch: processAlive knows the running process and an impossible pid", "[relaunch]") {
    CHECK(mfbe::shell::processAlive(mfbe::shell::currentProcessId()));
    CHECK_FALSE(mfbe::shell::processAlive(std::numeric_limits<std::int32_t>::max()));
}

TEST_CASE("relaunch: a program that cannot be started is reported, not thrown", "[relaunch]") {
    std::string reason;
    CHECK_FALSE(mfbe::shell::spawnDetached("/nonexistent/folder/mfbe", {"--no-sandbox"}, &reason));
    CHECK_FALSE(reason.empty());
#if !defined(_WIN32)
    reason.clear();
    CHECK(mfbe::shell::spawnDetached("/bin/true", {}, &reason));
    CHECK(reason.empty());
#endif
}

TEST_CASE("relaunch: the timeout and the poll interval are the contract's", "[relaunch]") {
    CHECK(mfbe::shell::kWaitForExitTimeout == 30s);
    CHECK(mfbe::shell::kWaitForExitInterval == 100ms);
}
