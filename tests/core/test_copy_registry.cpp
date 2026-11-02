// Feature 008, T006: copy slots, records, liveness and file identity (data-model §1, §2).
#include "test_support.hpp"

#include <mfbe/copy_registry.hpp>

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <fstream>

namespace fs = std::filesystem;
using mfbe::copies::BookRef;
using mfbe::copies::CopyRegistry;
using mfbe::copies::Record;
using mfbe::copies::WindowRect;

TEST_CASE("copies: slot 1 keeps the engine profile cef, later slots use cef-<n>", "[copies]") {
    const fs::path data = "/data";
    CHECK(mfbe::copies::profile_dir(data, 1) == data / "cef");
    CHECK(mfbe::copies::profile_dir(data, 2) == data / "cef-2");
    CHECK(mfbe::copies::profile_dir(data, 11) == data / "cef-11");
}

TEST_CASE("copies: each copy takes the lowest free slot, and a slot frees when its copy ends",
          "[copies]") {
    mfbe::test::TempDir tmp;
    auto a = std::make_unique<CopyRegistry>(tmp.path());
    REQUIRE(a->acquire());
    CHECK(a->slot() == 1);
    CopyRegistry b(tmp.path());
    REQUIRE(b.acquire());
    CHECK(b.slot() == 2);
    CHECK(fs::exists(tmp.path() / "copies" / "1.json"));
    CHECK(fs::exists(tmp.path() / "copies" / "2.json"));
    a.reset();
    CHECK_FALSE(fs::exists(tmp.path() / "copies" / "1.json"));
    CopyRegistry c(tmp.path());
    REQUIRE(c.acquire());
    CHECK(c.slot() == 1);
    CopyRegistry d(tmp.path());
    CHECK_FALSE(d.acquire_slot(2));  // held by b
}

TEST_CASE("copies: another copy reads the record with its book, window and state", "[copies]") {
    mfbe::test::TempDir tmp;
    CopyRegistry a(tmp.path());
    REQUIRE(a.acquire());
    a.set_book(BookRef{"/books/Книга один.fb2", "dev:1/ino:2"});
    a.set_window(WindowRect{100, 80, 1200, 800, false});
    a.set_state("busy");
    a.set_untouched(false);
    CopyRegistry b(tmp.path());
    REQUIRE(b.acquire());
    const auto others = b.records();
    REQUIRE(others.size() == 1);
    const Record& r = others.front();
    CHECK(r.slot == 1);
    CHECK(r.live);
    CHECK(r.state == "busy");
    CHECK_FALSE(r.untouched);
    REQUIRE(r.book);
    CHECK(r.book->path == "/books/Книга один.fb2");
    REQUIRE(r.window);
    CHECK(r.window->w == 1200);
    CHECK(r.host == mfbe::copies::host_name());
    CHECK(b.find_book("dev:1/ino:2").has_value());
    CHECK_FALSE(b.find_book("dev:9/ino:9").has_value());
    CHECK(a.records().size() == 1);  // a sees b, never itself
}

TEST_CASE("copies: a record whose lock is free is stale, ignored, and replaced", "[copies]") {
    mfbe::test::TempDir tmp;
    fs::create_directories(tmp.path() / "copies");
    {
        std::ofstream out(tmp.path() / "copies" / "7.json");
        out << nlohmann::json{{"schema", 1}, {"slot", 7}, {"pid", 1}, {"host", "elsewhere"},
                              {"heartbeatAt", "2026-11-01T10:00:00Z"}, {"state", "ready"},
                              {"untouched", true}, {"book", nullptr}, {"window", nullptr}}
                   .dump();
    }
    CopyRegistry b(tmp.path());
    REQUIRE(b.acquire());
    CHECK(b.records(true).empty());
    const auto all = b.records(false);
    REQUIRE(all.size() == 1);
    CHECK_FALSE(all.front().live);
    CopyRegistry d(tmp.path());
    REQUIRE(d.acquire_slot(7));
    CHECK(d.record().host == mfbe::copies::host_name());
}

TEST_CASE("copies: a copy responds while its heartbeat is under five seconds old", "[copies]") {
    Record r;
    r.heartbeat_at = "2026-11-01T10:00:00Z";
    std::tm tm{};
    tm.tm_year = 2026 - 1900;
    tm.tm_mon = 10;
    tm.tm_mday = 1;
    tm.tm_hour = 10;
#ifdef _WIN32
    const auto base = std::chrono::system_clock::from_time_t(_mkgmtime(&tm));
#else
    const auto base = std::chrono::system_clock::from_time_t(timegm(&tm));
#endif
    CHECK(mfbe::copies::is_responding(r, base + std::chrono::seconds(4)));
    CHECK_FALSE(mfbe::copies::is_responding(r, base + std::chrono::seconds(6)));
    r.heartbeat_at = "not a time";
    CHECK_FALSE(mfbe::copies::is_responding(r, base));
}

TEST_CASE("copies: a book has one identity however its path is written", "[copies]") {
    mfbe::test::TempDir tmp;
    const fs::path file = tmp.path() / "book.fb2";
    { std::ofstream(file) << "x"; }
    const std::string id = mfbe::copies::file_identity(file);
    CHECK_FALSE(id.empty());
    CHECK(mfbe::copies::file_identity(tmp.path() / "." / "book.fb2") == id);
#ifndef _WIN32
    std::error_code ec;
    fs::create_symlink(file, tmp.path() / "link.fb2", ec);
    if (!ec) CHECK(mfbe::copies::file_identity(tmp.path() / "link.fb2") == id);
#endif
    CHECK(mfbe::copies::file_identity(tmp.path() / "missing.fb2").empty());
}
