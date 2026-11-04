// libarchive spike (feature 009, T003, research R1): does the seekable ZIP reader hand back a
// legacy (non-UTF-8, unflagged) entry name as its raw bytes, and which ZIP compression methods
// does this build write and read back? The name bytes decide how DP-2's judge gets its input.

#include <archive.h>
#include <archive_entry.h>
#include <catch2/catch_test_macros.hpp>

#include <clocale>
#include <cstdint>
#include <string>
#include <vector>

namespace {

void put16(std::string& out, std::uint16_t v) {
    out.push_back(static_cast<char>(v & 0xFF));
    out.push_back(static_cast<char>((v >> 8) & 0xFF));
}

void put32(std::string& out, std::uint32_t v) {
    for (int i = 0; i < 4; ++i) {
        out.push_back(static_cast<char>((v >> (8 * i)) & 0xFF));
    }
}

std::uint32_t crc32_of(const std::string& data) {
    std::uint32_t crc = 0xFFFFFFFFu;
    for (unsigned char c : data) {
        crc ^= c;
        for (int k = 0; k < 8; ++k) {
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
        }
    }
    return ~crc;
}

// A one-entry ZIP with a stored (uncompressed) entry, written byte by byte so that the name's
// bytes and the general-purpose flags are exactly what the test says (no UTF-8 flag: bit 11 off).
std::string stored_zip(const std::string& name, const std::string& data) {
    const std::uint32_t crc = crc32_of(data);
    std::string zip;
    put32(zip, 0x04034b50);  // local file header
    put16(zip, 10);          // version needed
    put16(zip, 0);           // flags
    put16(zip, 0);           // method: stored
    put16(zip, 0);           // time
    put16(zip, 0x21);        // date
    put32(zip, crc);
    put32(zip, static_cast<std::uint32_t>(data.size()));
    put32(zip, static_cast<std::uint32_t>(data.size()));
    put16(zip, static_cast<std::uint16_t>(name.size()));
    put16(zip, 0);
    zip += name;
    zip += data;
    const auto central = static_cast<std::uint32_t>(zip.size());
    put32(zip, 0x02014b50);  // central directory header
    put16(zip, 20);
    put16(zip, 10);
    put16(zip, 0);
    put16(zip, 0);
    put16(zip, 0);
    put16(zip, 0x21);
    put32(zip, crc);
    put32(zip, static_cast<std::uint32_t>(data.size()));
    put32(zip, static_cast<std::uint32_t>(data.size()));
    put16(zip, static_cast<std::uint16_t>(name.size()));
    put16(zip, 0);
    put16(zip, 0);
    put16(zip, 0);
    put16(zip, 0);
    put32(zip, 0);
    put32(zip, 0);  // offset of the local header
    zip += name;
    const auto central_size = static_cast<std::uint32_t>(zip.size()) - central;
    put32(zip, 0x06054b50);  // end of central directory
    put16(zip, 0);
    put16(zip, 0);
    put16(zip, 1);
    put16(zip, 1);
    put32(zip, central_size);
    put32(zip, central);
    put16(zip, 0);
    return zip;
}

struct ReadBack {
    bool ok = false;
    std::string pathname;  // archive_entry_pathname()
    std::string data;
};

ReadBack read_first(const std::string& zip) {
    ReadBack result;
    archive* a = archive_read_new();
    archive_read_support_format_zip_seekable(a);
    if (archive_read_open_memory(a, zip.data(), zip.size()) == ARCHIVE_OK) {
        archive_entry* entry = nullptr;
        if (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
            const char* name = archive_entry_pathname(entry);
            result.pathname = name ? name : "";
            char buffer[4096];
            la_ssize_t n = 0;
            while ((n = archive_read_data(a, buffer, sizeof buffer)) > 0) {
                result.data.append(buffer, static_cast<std::size_t>(n));
            }
            result.ok = n == 0;
        }
    }
    archive_read_free(a);
    return result;
}

// Writes `data` as one ZIP entry with libarchive's writer and the given `compression` option;
// returns the archive, or an empty string when this build refuses the method.
std::string libarchive_zip(const std::string& compression, const std::string& data) {
    std::vector<char> buffer(1 << 20);
    std::size_t used = 0;
    archive* a = archive_write_new();
    archive_write_set_format_zip(a);
    std::string result;
    if (archive_write_set_format_option(a, "zip", "compression", compression.c_str()) ==
            ARCHIVE_OK &&
        archive_write_open_memory(a, buffer.data(), buffer.size(), &used) == ARCHIVE_OK) {
        archive_entry* entry = archive_entry_new();
        archive_entry_set_pathname(entry, "book.fb2");
        archive_entry_set_size(entry, static_cast<la_int64_t>(data.size()));
        archive_entry_set_filetype(entry, AE_IFREG);
        archive_entry_set_perm(entry, 0644);
        if (archive_write_header(a, entry) == ARCHIVE_OK &&
            archive_write_data(a, data.data(), data.size()) ==
                static_cast<la_ssize_t>(data.size()) &&
            archive_write_close(a) == ARCHIVE_OK) {
            result.assign(buffer.data(), used);
        }
        archive_entry_free(entry);
    }
    archive_write_free(a);
    return result;
}

}  // namespace

TEST_CASE("libarchive spike: a legacy entry name comes back as its raw bytes", "[archive][spike]") {
    // «Книга.fb2» in CP866, without the UTF-8 flag.
    const std::string cp866_name = "\x8A\xAD\xA8\xA3\xA0.fb2";
    const std::string zip = stored_zip(cp866_name, "<FictionBook/>");

    std::setlocale(LC_ALL, "C");
    const ReadBack in_c = read_first(zip);
    REQUIRE(in_c.ok);
    CHECK(in_c.data == "<FictionBook/>");
    CHECK(in_c.pathname == cp866_name);

#ifndef _WIN32
    if (std::setlocale(LC_ALL, "C.UTF-8") != nullptr) {
        const ReadBack in_utf8 = read_first(zip);
        REQUIRE(in_utf8.ok);
        CHECK(in_utf8.pathname == cp866_name);
    } else {
        WARN("C.UTF-8 locale unavailable; only the C locale was checked");
    }
    std::setlocale(LC_ALL, "C");
#endif
}

TEST_CASE("libarchive spike: the ZIP compression methods this build writes and reads back",
          "[archive][spike]") {
    std::string data;
    for (int i = 0; i < 2000; ++i) {
        data += "<p>Paragraph " + std::to_string(i) + " of the book.</p>\n";
    }
    // deflate and store are required (every ZIP tool writes them); the others are reported so
    // research DP-3 can record which methods this build handles (bzip2, lzma, xz, zstd).
    for (const std::string method : {"deflate", "store"}) {
        const std::string zip = libarchive_zip(method, data);
        REQUIRE_FALSE(zip.empty());
        const ReadBack back = read_first(zip);
        REQUIRE(back.ok);
        CHECK(back.data == data);
    }
    for (const std::string method : {"bzip2", "lzma", "xz", "zstd"}) {
        const std::string zip = libarchive_zip(method, data);
        if (zip.empty()) {
            WARN("libarchive does not write ZIP method " << method << " in this build");
            continue;
        }
        const ReadBack back = read_first(zip);
        CHECK(back.ok);
        CHECK(back.data == data);
        WARN("ZIP method " << method << ": written and read back " << (back.ok ? "OK" : "FAILED"));
    }
}
