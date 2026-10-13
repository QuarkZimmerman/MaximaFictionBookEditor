// T014: atomic file writes with fault injection - the original must survive any failure.
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <vector>

using namespace mfbe;

namespace {

std::vector<std::string> list_names(const std::filesystem::path& dir) {
    std::vector<std::string> names;
    for (const auto& entry : std::filesystem::directory_iterator(dir)) {
        names.push_back(entry.path().filename().string());
    }
    std::sort(names.begin(), names.end());
    return names;
}

}  // namespace

TEST_CASE("atomic_file: writes a new file and replaces an existing one", "[atomic]") {
    test::TempDir tmp;
    const auto target = tmp / "book.fb2";
    atomic_file::write_atomic(target, "first");
    CHECK(test::read_text(target) == "first");
    atomic_file::write_atomic(target, "second version");
    CHECK(test::read_text(target) == "second version");
    CHECK(list_names(tmp.path()) == std::vector<std::string>{"book.fb2"});  // no temp leftovers
}

TEST_CASE("atomic_file: large payload round trip", "[atomic]") {
    test::TempDir tmp;
    const auto target = tmp / "big.bin";
    std::string payload(5 * 1024 * 1024 + 13, '\0');
    for (std::size_t i = 0; i < payload.size(); ++i) {
        payload[i] = static_cast<char>(i * 31 + 7);
    }
    atomic_file::write_atomic(target, payload);
    CHECK(test::read_text(target) == payload);
}

TEST_CASE("atomic_file: the original stays intact when the write fails midway", "[atomic]") {
    test::TempDir tmp;
    const auto target = tmp / "book.fb2";
    atomic_file::write_atomic(target, "ORIGINAL CONTENT");

    const auto points = {
        atomic_file::FaultPoint::before_write, atomic_file::FaultPoint::during_write,
        atomic_file::FaultPoint::before_fsync, atomic_file::FaultPoint::before_rename};
    for (const auto point : points) {
        INFO("fault point " << static_cast<int>(point));
        atomic_file::set_fault_injection(point);
        CHECK_THROWS_AS(atomic_file::write_atomic(target, std::string(100000, 'N')),
                        atomic_file::WriteError);
        CHECK(atomic_file::fault_injection() == atomic_file::FaultPoint::none);  // one-shot
        CHECK(test::read_text(target) == "ORIGINAL CONTENT");
        CHECK(list_names(tmp.path()) == std::vector<std::string>{"book.fb2"});
    }
    // And a subsequent write succeeds normally.
    atomic_file::write_atomic(target, "NEW");
    CHECK(test::read_text(target) == "NEW");
}

TEST_CASE("atomic_file: WriteError carries path and reason", "[atomic]") {
    test::TempDir tmp;
    const auto target = tmp / "missing-dir" / "x.fb2";
    try {
        atomic_file::write_atomic(target, "x");
        FAIL("expected WriteError");
    } catch (const atomic_file::WriteError& e) {
        CHECK(e.path == std::filesystem::absolute(target).string());
        CHECK_FALSE(e.reason.empty());
    }
    CHECK_THROWS_AS(atomic_file::write_atomic("", "x"), atomic_file::WriteError);
    CHECK_THROWS_AS(atomic_file::read_file(tmp / "nope.txt"), atomic_file::WriteError);
}

#ifndef _WIN32
TEST_CASE("atomic_file: existing permissions are preserved", "[atomic]") {
    test::TempDir tmp;
    const auto target = tmp / "perm.txt";
    atomic_file::write_atomic(target, "a");
    std::filesystem::permissions(target, std::filesystem::perms::owner_read |
                                             std::filesystem::perms::owner_write |
                                             std::filesystem::perms::group_read);
    atomic_file::write_atomic(target, "b");
    const auto perms = std::filesystem::status(target).permissions();
    CHECK((perms & std::filesystem::perms::group_read) != std::filesystem::perms::none);
    CHECK((perms & std::filesystem::perms::others_read) == std::filesystem::perms::none);
}
#endif
