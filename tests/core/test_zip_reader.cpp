// Feature 009, User Story 2 (T018): listing a ZIP archive and reading one book, within the
// limits of research DP-3 (data-model §3).
#include "test_support.hpp"

#include <mfbe/archive.hpp>

#include <archive.h>
#include <archive_entry.h>
#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

using namespace mfbe;
namespace fs = std::filesystem;

namespace {

fs::path fixture(const std::string& name) {
    return test::fixtures_dir() / "archives" / name;
}

la_ssize_t append(struct archive*, void* client, const void* buffer, size_t length) {
    static_cast<std::string*>(client)->append(static_cast<const char*>(buffer), length);
    return static_cast<la_ssize_t>(length);
}

// An archive of `count` small entries named by `name_of`, written by libarchive (ZIP64 once
// there are more than 65,535 entries).
template <typename NameOf>
std::string many_entries(std::size_t count, NameOf name_of) {
    std::string out;
    struct archive* a = archive_write_new();
    archive_write_set_format_zip(a);
    archive_write_set_format_option(a, "zip", "compression", "store");
    archive_write_set_bytes_in_last_block(a, 1);
    archive_write_open2(a, &out, nullptr, append, nullptr, nullptr);
    const std::string data = "<FictionBook/>";
    for (std::size_t i = 0; i < count; ++i) {
        archive_entry* e = archive_entry_new();
        archive_entry_set_pathname(e, name_of(i).c_str());
        archive_entry_set_size(e, static_cast<la_int64_t>(data.size()));
        archive_entry_set_filetype(e, AE_IFREG);
        archive_entry_set_perm(e, 0644);
        archive_write_header(a, e);
        archive_write_data(a, data.data(), data.size());
        archive_entry_free(e);
    }
    archive_write_close(a);
    archive_write_free(a);
    return out;
}

void set32(std::string& bytes, std::size_t at, std::uint32_t value) {
    for (int i = 0; i < 4; ++i) {
        bytes[at + static_cast<std::size_t>(i)] = static_cast<char>((value >> (8 * i)) & 0xFF);
    }
}

}  // namespace

TEST_CASE("zip reader: books, folders, sizes and other files, in archive order", "[archive]") {
    const auto many = mfbe::archive::list(fixture("many-200.zip"));
    REQUIRE(many.books.size() == 200);
    CHECK(many.books_total == 200);
    CHECK(many.other_files == 2);  // cover.jpg, readme.txt
    CHECK(many.books.front().entry == "folder-01/book-001.fb2");
    CHECK(many.books.front().name == "book-001.fb2");
    CHECK(many.books.front().folder == "folder-01");
    CHECK(many.books.front().kind == "fb2");
    CHECK(many.books.front().size > 0);
    CHECK(many.books.back().entry == "folder-10/book-200.fb2");

    const auto single = mfbe::archive::list(fixture("single.fb2.zip"));
    REQUIRE(single.books.size() == 1);
    CHECK(single.books[0].entry == "book.fb2");
    CHECK(single.books[0].folder.empty());
    // The fixture archive holds the book with LF line ends; a Windows checkout has CRLF.
    const auto lf = [](std::string text) {
        text.erase(std::remove(text.begin(), text.end(), '\r'), text.end());
        return text;
    };
    const std::string book = mfbe::archive::read_entry(fixture("single.fb2.zip"), "book.fb2");
    CHECK(lf(book) == lf(test::read_text(test::fixtures_dir() / "books" / "modern-utf8.fb2")));

    const auto pair = mfbe::archive::list(fixture("book-and-fbd.zip"));
    REQUIRE(pair.books.size() == 2);
    CHECK(pair.books[1].kind == "fbd");

    // An archive inside an archive is another file; its books are not listed.
    const auto nested = mfbe::archive::list(fixture("nested.zip"));
    REQUIRE(nested.books.size() == 1);
    CHECK(nested.books[0].entry == "outer.fb2");
    CHECK(nested.other_files == 1);

    CHECK(mfbe::archive::list(fixture("no-book.zip")).books.empty());
}

TEST_CASE("zip reader: '..' and absolute names are shown as they are, never used as paths",
          "[archive]") {
    for (const auto& [file, entry] :
         {std::pair{"dotdot-names.zip", "../evil.fb2"}, std::pair{"absolute-names.zip",
                                                                  "/abs/evil.fb2"}}) {
        const auto listing = mfbe::archive::list(fixture(file));
        REQUIRE(listing.books.size() == 1);
        CHECK(listing.books[0].entry == entry);
        CHECK_FALSE(mfbe::archive::read_entry(fixture(file), entry).empty());
    }
    CHECK_FALSE(fs::exists(fixture("../evil.fb2")));
}

TEST_CASE("zip reader: the refusals and their reasons", "[archive]") {
    auto reason_of = [](const std::string& file, const std::string& entry) {
        try {
            if (entry.empty()) {
                mfbe::archive::list(fixture(file));
            } else {
                mfbe::archive::read_entry(fixture(file), entry);
            }
        } catch (const mfbe::archive::ArchiveError& e) {
            return std::string(mfbe::archive::reason_name(e.reason));
        }
        return std::string("read");
    };
    CHECK(reason_of("encrypted.zip", "book.fb2") == "encrypted");
    CHECK(reason_of("method-unknown.zip", "book.fb2") == "method");
    CHECK(reason_of("truncated.zip", "") == "damaged");
    CHECK(reason_of("crc-bad.zip", "book.fb2") == "damaged");
    CHECK(reason_of("single.fb2.zip", "not-there.fb2") == "missing");
}

TEST_CASE("zip reader: every compression method this build reads (DP-3 as revised)",
          "[archive]") {
    const std::string expected = mfbe::archive::read_entry(fixture("method-bzip2.zip"), "book.fb2");
    CHECK(expected.find("\xD0\x9A\xD0\xB0\xD0\xB6\xD0\xB4\xD1\x8B\xD0\xB9") != std::string::npos);
    for (const char* file : {"method-lzma.zip", "method-xz.zip", "method-zstd.zip"}) {
        INFO(file);
        CHECK(mfbe::archive::read_entry(fixture(file), "book.fb2") == expected);
    }
    // Deflate64 is not read by libarchive 3.8 (T003): refused as "compressed in a way the
    // editor does not read".
    try {
        mfbe::archive::read_entry(fixture("method-deflate64.zip"), "book.fb2");
        FAIL("deflate64 was read: update research DP-3 and this test");
    } catch (const mfbe::archive::ArchiveError& e) {
        CHECK(e.reason == mfbe::archive::Reason::method);
    }
}

TEST_CASE("zip reader: an entry larger than 512 MiB is refused, declared or found",
          "[archive][slow]") {
    test::TempDir tmp;
    // Declared: a central directory that says 600 MiB.
    std::string declared = test::read_text(fixture("single.fb2.zip"));
    const std::size_t cd = declared.rfind(std::string("PK\x01\x02", 4));
    REQUIRE(cd != std::string::npos);
    set32(declared, cd + 24, 600u * 1024 * 1024);
    test::write_text(tmp / "declared.zip", declared);
    try {
        mfbe::archive::read_entry(tmp / "declared.zip", "book.fb2");
        FAIL("expected tooLarge");
    } catch (const mfbe::archive::ArchiveError& e) {
        CHECK(e.reason == mfbe::archive::Reason::too_large);
    }

    // Found: an entry that declares 1 KiB and expands without end (a "bomb").
    std::string bomb;
    {
        struct archive* a = archive_write_new();
        archive_write_set_format_zip(a);
        archive_write_set_format_option(a, "zip", "compression", "deflate");
        archive_write_set_bytes_in_last_block(a, 1);
        archive_write_open2(a, &bomb, nullptr, append, nullptr, nullptr);
        archive_entry* e = archive_entry_new();
        archive_entry_set_pathname(e, "bomb.fb2");
        const std::size_t total = 520u * 1024 * 1024;
        archive_entry_set_size(e, static_cast<la_int64_t>(total));
        archive_entry_set_filetype(e, AE_IFREG);
        archive_entry_set_perm(e, 0644);
        archive_write_header(a, e);
        const std::string zeros(1 << 20, '\0');
        for (std::size_t done = 0; done < total; done += zeros.size()) {
            archive_write_data(a, zeros.data(), zeros.size());
        }
        archive_entry_free(e);
        archive_write_close(a);
        archive_write_free(a);
    }
    const std::size_t bomb_cd = bomb.rfind(std::string("PK\x01\x02", 4));
    REQUIRE(bomb_cd != std::string::npos);
    set32(bomb, bomb_cd + 24, 1024);
    test::write_text(tmp / "bomb.zip", bomb);
    REQUIRE(mfbe::archive::list(tmp / "bomb.zip").books.at(0).size == 1024);
    try {
        mfbe::archive::read_entry(tmp / "bomb.zip", "bomb.fb2");
        FAIL("expected a refusal");
    } catch (const mfbe::archive::ArchiveError& e) {
        // libarchive either stops at the declared size (the CRC then fails) or the editor's
        // own limit stops it; either way nothing past 512 MiB is held.
        CHECK((e.reason == mfbe::archive::Reason::too_large || e.reason == mfbe::archive::Reason::damaged));
    }
}

TEST_CASE("zip reader: a ZIP64 archive of 100,005 books lists 100,000 and counts the rest",
          "[archive][slow]") {
    test::TempDir tmp;
    const std::string zip =
        many_entries(100005, [](std::size_t i) { return "b/" + std::to_string(i) + ".fb2"; });
    test::write_text(tmp / "big.zip", zip);
    const auto listing = mfbe::archive::list(tmp / "big.zip");
    CHECK(listing.entries.size() == 100005);
    CHECK(listing.books_total == 100005);
    CHECK(listing.books.size() == mfbe::archive::kMaxListedBooks);
    CHECK(mfbe::archive::read_entry(tmp / "big.zip", "b/100004.fb2") == "<FictionBook/>");
}
