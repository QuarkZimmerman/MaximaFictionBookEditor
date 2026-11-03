// Feature 008, T008 and T020: the relay payload, the relayed command line, the target choice and
// the new window's place (data-model §3, research R1, R3, R6).
#include "test_support.hpp"

#include <mfbe/copy_launch.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace mfbe::copies;

namespace {
#ifdef _WIN32
const std::string kAbs1 = "C:\\Книги\\Война и мир.fb2";
const std::string kAbs2 = "D:\\books\\b.fb2";
#else
const std::string kAbs1 = "/home/u/Книги/Война и мир.fb2";
const std::string kAbs2 = "/home/u/books/b.fb2";
#endif

Record live(int slot, const std::string& active, bool untouched,
            const std::string& book_id = "") {
    Record r;
    r.slot = slot;
    r.live = true;
    r.last_active_at = active;
    r.heartbeat_at = "2026-11-01T10:00:00Z";
    r.untouched = untouched;
    if (!book_id.empty()) r.book = BookRef{"/x.fb2", book_id};
    return r;
}

std::chrono::system_clock::time_point at_10_00_02() {
    std::tm tm{};
    tm.tm_year = 2026 - 1900;
    tm.tm_mon = 10;
    tm.tm_mday = 1;
    tm.tm_hour = 10;
    tm.tm_sec = 2;
#ifdef _WIN32
    return std::chrono::system_clock::from_time_t(_mkgmtime(&tm));
#else
    return std::chrono::system_clock::from_time_t(timegm(&tm));
#endif
}
}  // namespace

TEST_CASE("copy launch: the request payload round-trips with any characters", "[copy-launch]") {
    OpenRequest r;
    r.request_id = new_request_id();
    r.paths = {kAbs1, kAbs2};
    r.target = "untouched";
    const std::string payload = encode_request(r);
    CHECK(payload.find_first_of("+/= ") == std::string::npos);
    const auto back = decode_request(payload);
    REQUIRE(back);
    CHECK(back->paths == r.paths);
    CHECK(back->kind == "open");
    CHECK(back->target == "untouched");
    CHECK(back->request_id == r.request_id);
    CHECK_FALSE(decode_request("not base64 at all!"));
    CHECK_FALSE(decode_request(""));
}

TEST_CASE("copy launch: a request with a relative path or an unknown kind is refused",
          "[copy-launch]") {
    OpenRequest relative;
    relative.paths = {"books/a.fb2"};
    CHECK_FALSE(decode_request(encode_request(relative)));
    OpenRequest other;
    other.kind = "delete";
    other.paths = {kAbs1};
    CHECK_FALSE(decode_request(encode_request(other)));
    OpenRequest none;
    CHECK_FALSE(decode_request(encode_request(none)));
}

TEST_CASE("copy launch: only the editor's switch is read from a relayed command line",
          "[copy-launch]") {
    OpenRequest r;
    r.paths = {kAbs1};
    const std::vector<std::string> argv = {"mfbe",
                                           "--lang=en-US",
                                           "--log-file=/tmp/cef.log",
                                           "--log-severity=warning",
                                           "--disable-features=Foo,Bar",
                                           "--ozone-platform-hint=auto",
                                           "--no-sandbox",
                                           "/etc/passwd",
                                           "--mfbe-request=" + encode_request(r)};
    const auto got = parse_relayed_request(argv);
    REQUIRE(got);
    CHECK(got->paths == std::vector<std::string>{kAbs1});
    CHECK_FALSE(parse_relayed_request({"mfbe", "--lang=en-US", kAbs1}));
}

TEST_CASE("copy launch: the receiving copy follows research R3", "[copy-launch]") {
    const auto now = at_10_00_02();
    SECTION("no copy runs or none responds -> a new copy") {
        CHECK_FALSE(choose_target({}, "", now).relay);
        Record silent = live(1, "2026-11-01T09:00:00Z", false);
        silent.heartbeat_at = "2026-11-01T09:59:00Z";
        CHECK_FALSE(choose_target({silent}, "", now).relay);
    }
    SECTION("the copy holding the book is activated") {
        const auto t = choose_target(
            {live(1, "2026-11-01T09:59:00Z", false), live(2, "2026-11-01T09:00:00Z", false, "id-a")},
            "id-a", now);
        CHECK(t.relay);
        CHECK(t.slot == 2);
        CHECK(t.kind == "activate");
    }
    SECTION("an untouched copy, the most recent of them, takes the book") {
        const auto t = choose_target({live(1, "2026-11-01T09:59:00Z", false),
                                      live(2, "2026-11-01T09:10:00Z", true),
                                      live(3, "2026-11-01T09:20:00Z", true)},
                                     "", now);
        CHECK(t.slot == 3);
        CHECK(t.target == "untouched");
    }
    SECTION("otherwise the copy used last, which asks") {
        const auto t = choose_target(
            {live(1, "2026-11-01T09:00:00Z", false), live(2, "2026-11-01T09:30:00Z", false)}, "",
            now);
        CHECK(t.slot == 2);
        CHECK(t.target == "ask");
        CHECK(t.kind == "open");
    }
}

TEST_CASE("copy launch: a new window is placed beside the last one, or at its normal place",
          "[copy-launch]") {
    const WorkArea area{0, 0, 1920, 1040};
    const WindowRect fallback{100, 100, 1000, 700, false};
    CHECK(place_new_window(std::nullopt, area, fallback).x == 100);
    const auto next = place_new_window(WindowRect{200, 150, 1200, 800, false}, area, fallback);
    CHECK(next.x == 232);
    CHECK(next.y == 182);
    CHECK_FALSE(next.maximized);
    const auto wrapped = place_new_window(WindowRect{700, 230, 1200, 800, false}, area, fallback);
    CHECK(wrapped.x == 0);
    CHECK(wrapped.y == 0);
    const auto from_max = place_new_window(WindowRect{300, 120, 1100, 760, true}, area, fallback);
    CHECK(from_max.x == 300);
    CHECK(from_max.y == 120);
    CHECK(from_max.w == 1100);
    CHECK_FALSE(from_max.maximized);
}
