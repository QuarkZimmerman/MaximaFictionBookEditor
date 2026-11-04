// Feature 009, User Story 1 (T008): the backup of the previous version kept by the atomic save
// (FR-001 to FR-005, research DP-7, data-model §1).
#include "test_support.hpp"

#include <mfbe/atomic_file.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>
#include <string>

using namespace mfbe;
namespace fs = std::filesystem;

namespace {

void put(const fs::path& path, const std::string& bytes) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << bytes;
}

std::string get(const fs::path& path) {
    return atomic_file::read_file(path);
}

const atomic_file::WriteOptions kBackup{true};

}  // namespace

TEST_CASE("backup: a save over an existing file keeps the replaced bytes as .bak", "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    put(book, "version 1");
    const auto outcome = atomic_file::write_atomic(book, "version 2", kBackup);
    CHECK(outcome.requested);
    CHECK(outcome.kept);
    CHECK(outcome.reason.empty());
    CHECK(get(book) == "version 2");
    CHECK(atomic_file::backup_path(book) == tmp / "book.fb2.bak");
    CHECK(get(tmp / "book.fb2.bak") == "version 1");
}

TEST_CASE("backup: every save replaces the backup with the version before it (D2)", "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    put(book, "version 1");
    atomic_file::write_atomic(book, "version 2", kBackup);
    const auto outcome = atomic_file::write_atomic(book, "version 3", kBackup);
    CHECK(outcome.kept);
    CHECK(get(book) == "version 3");
    CHECK(get(tmp / "book.fb2.bak") == "version 2");
}

TEST_CASE("backup: a first save of a new file makes no backup and reports nothing", "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "new.fb2";
    const auto outcome = atomic_file::write_atomic(book, "first", kBackup);
    CHECK_FALSE(outcome.requested);
    CHECK_FALSE(outcome.kept);
    CHECK(outcome.reason.empty());
    CHECK(get(book) == "first");
    CHECK_FALSE(fs::exists(tmp / "new.fb2.bak"));
}

TEST_CASE("backup: switched off, none is made and an old backup stays untouched", "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    put(book, "version 1");
    put(tmp / "book.fb2.bak", "old backup");
    const auto outcome = atomic_file::write_atomic(book, "version 2", atomic_file::WriteOptions{});
    CHECK_FALSE(outcome.requested);
    CHECK(get(book) == "version 2");
    CHECK(get(tmp / "book.fb2.bak") == "old backup");
    // The two-argument form makes no backup either.
    atomic_file::write_atomic(book, "version 3");
    CHECK(get(tmp / "book.fb2.bak") == "old backup");
}

TEST_CASE("backup: a folder in the backup's place - saved anyway, with the reason (D4)",
          "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    put(book, "version 1");
    fs::create_directory(tmp / "book.fb2.bak");
    const auto outcome = atomic_file::write_atomic(book, "version 2", kBackup);
    CHECK(outcome.requested);
    CHECK_FALSE(outcome.kept);
    CHECK_FALSE(outcome.reason.empty());
    CHECK(get(book) == "version 2");
    CHECK(fs::is_directory(tmp / "book.fb2.bak"));
}

#ifdef _WIN32
TEST_CASE("backup: a read-only backup on Windows - saved anyway, with the reason (D4)",
          "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    const fs::path bak = tmp / "book.fb2.bak";
    put(book, "version 1");
    put(bak, "old backup");
    fs::permissions(bak, fs::perms::owner_write | fs::perms::group_write | fs::perms::others_write,
                    fs::perm_options::remove);
    const auto outcome = atomic_file::write_atomic(book, "version 2", kBackup);
    CHECK(get(book) == "version 2");
    CHECK_FALSE(outcome.kept);
    CHECK_FALSE(outcome.reason.empty());
    fs::permissions(bak, fs::perms::owner_write, fs::perm_options::add);
}
#else
TEST_CASE("backup: without hard links the copy fallback keeps the backup", "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    put(book, "version 1");
    atomic_file::set_fault_injection(atomic_file::FaultPoint::no_hard_link);
    const auto outcome = atomic_file::write_atomic(book, "version 2", kBackup);
    CHECK(atomic_file::fault_injection() == atomic_file::FaultPoint::none);
    CHECK(outcome.kept);
    CHECK(get(book) == "version 2");
    CHECK(get(tmp / "book.fb2.bak") == "version 1");
    // A copy, not a second name of the replaced file.
    CHECK(fs::hard_link_count(tmp / "book.fb2.bak") == 1);
}
#endif

TEST_CASE("backup: before_backup - the save goes on without a backup and says why", "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    put(book, "version 1");
    put(tmp / "book.fb2.bak", "old backup");
    atomic_file::set_fault_injection(atomic_file::FaultPoint::before_backup);
    const auto outcome = atomic_file::write_atomic(book, "version 2", kBackup);
    CHECK_FALSE(outcome.kept);
    CHECK(outcome.reason == "injected fault: before_backup");
    CHECK(get(book) == "version 2");
    CHECK(get(tmp / "book.fb2.bak") == "old backup");
}

TEST_CASE("backup: after_backup - the replace fails, the book stays whole and readable",
          "[backup]") {
    test::TempDir tmp;
    const fs::path book = tmp / "book.fb2";
    put(book, "version 1");
    atomic_file::set_fault_injection(atomic_file::FaultPoint::after_backup);
    CHECK_THROWS_AS(atomic_file::write_atomic(book, "version 2", kBackup), atomic_file::WriteError);
    CHECK(get(book) == "version 1");
    CHECK(get(tmp / "book.fb2.bak") == "version 1");
    // No temporary file is left behind beside the book.
    int others = 0;
    for (const auto& entry : fs::directory_iterator(tmp.path())) {
        const auto name = entry.path().filename();
        if (name != "book.fb2" && name != "book.fb2.bak") {
            ++others;
        }
    }
    CHECK(others == 0);
}

TEST_CASE("backup: the earlier fault points leave the book and its backup as they were",
          "[backup]") {
    for (const auto point : {atomic_file::FaultPoint::before_write,
                             atomic_file::FaultPoint::during_write,
                             atomic_file::FaultPoint::before_fsync}) {
        test::TempDir tmp;
        const fs::path book = tmp / "book.fb2";
        put(book, "version 1");
        put(tmp / "book.fb2.bak", "old backup");
        atomic_file::set_fault_injection(point);
        CHECK_THROWS_AS(atomic_file::write_atomic(book, std::string(4096, 'x'), kBackup),
                        atomic_file::WriteError);
        CHECK(get(book) == "version 1");
        CHECK(get(tmp / "book.fb2.bak") == "old backup");
    }
}
