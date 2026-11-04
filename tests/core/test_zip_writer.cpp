// Feature 009, User Story 2 (T020): a new one-book archive (research DP-6, resource-formats §5).
#include "test_support.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>

#include <catch2/catch_test_macros.hpp>

#include <string>

using namespace mfbe;

TEST_CASE("zip writer: one deflated top-level entry, its name in flagged UTF-8, no comment",
          "[archive]") {
    test::TempDir tmp;
    const std::string book = test::read_text(test::fixtures_dir() / "books" / "modern-utf8.fb2");
    const std::string name = "\xD0\x92\xD0\xBE\xD0\xB9\xD0\xBD\xD0\xB0.fb2";  // Война.fb2
    const std::string zip = archive::zip_one(name, book);
    test::write_text(tmp / "out.zip", zip);

    const auto listing = archive::list(tmp / "out.zip");
    REQUIRE(listing.entries.size() == 1);
    const auto& entry = listing.entries[0];
    CHECK(entry.name == name);
    CHECK(entry.raw_name == name);
    CHECK((entry.flags & 0x0800) != 0);  // UTF-8 flag
    CHECK(entry.method == 8);            // deflate
    CHECK(entry.size == book.size());
    CHECK(listing.books.at(0).folder.empty());
    CHECK(archive::read_entry(tmp / "out.zip", name) == book);
    // The end record closes the file: its comment length is zero.
    REQUIRE(zip.size() > 22);
    CHECK(zip.compare(zip.size() - 2, 2, std::string("\0\0", 2)) == 0);

    // An ASCII name is not flagged.
    const std::string ascii = archive::zip_one("book.fb2", "x");
    test::write_text(tmp / "ascii.zip", ascii);
    CHECK((archive::list(tmp / "ascii.zip").entries.at(0).flags & 0x0800) == 0);
}

TEST_CASE("zip writer: replacing an archive keeps it whole as its backup", "[archive][backup]") {
    test::TempDir tmp;
    const auto target = tmp / "book.fb2.zip";
    const std::string old_archive = archive::zip_one("book.fb2", "old version");
    test::write_text(target, old_archive);
    const auto outcome = atomic_file::write_atomic(target, archive::zip_one("book.fb2", "new"),
                                                   atomic_file::WriteOptions{true});
    CHECK(outcome.kept);
    CHECK(test::read_text(tmp / "book.fb2.zip.bak") == old_archive);
    CHECK(archive::read_entry(target, "book.fb2") == "new");
}
