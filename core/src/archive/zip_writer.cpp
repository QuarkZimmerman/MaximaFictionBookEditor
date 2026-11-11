// Writing a one-book ZIP archive (feature 009, research DP-6). See mfbe/archive.hpp.
#include <mfbe/archive.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <archive.h>
#include <archive_entry.h>
#include <ctime>
#include <memory>

namespace mfbe::archive {
namespace {

la_ssize_t append(struct archive*, void* client, const void* buffer, size_t length) {
    static_cast<std::string*>(client)->append(static_cast<const char*>(buffer), length);
    return static_cast<la_ssize_t>(length);
}

struct WriterDeleter {
    void operator()(struct archive* a) const { archive_write_free(a); }
};
struct EntryDeleter {
    void operator()(archive_entry* e) const { archive_entry_free(e); }
};

bool is_ascii(const std::string& s) {
    return std::all_of(s.begin(), s.end(),
                       [](char c) { return static_cast<unsigned char>(c) < 0x80; });
}

[[noreturn]] void fail(struct archive* a) {
    const char* message = archive_error_string(a);
    throw std::runtime_error(message != nullptr ? message : "the archive cannot be written");
}

}  // namespace

// Sets the "name is UTF-8" flag (bit 11) of every entry whose name is not ASCII, in its central
// record and in its local header, walking the central directory from the end record.
void flag_utf8_names(std::string& zip) {
    const std::size_t end = zip.rfind(std::string("PK\x05\x06", 4));
    if (end == std::string::npos || end + 22 > zip.size()) {
        return;
    }
    const auto u16 = [&](std::size_t at) {
        return static_cast<std::size_t>(static_cast<unsigned char>(zip[at])) |
               static_cast<std::size_t>(static_cast<unsigned char>(zip[at + 1])) << 8;
    };
    const auto u32 = [&](std::size_t at) { return u16(at) | u16(at + 2) << 16; };
    const auto set_flag = [&](std::size_t at) {
        zip[at + 1] = static_cast<char>(static_cast<unsigned char>(zip[at + 1]) | 0x08);
    };
    const std::size_t count = u16(end + 10);
    std::size_t record = u32(end + 16);
    for (std::size_t i = 0; i < count && record + 46 <= zip.size(); ++i) {
        if (zip.compare(record, 4, "PK\x01\x02") != 0) {
            return;
        }
        const std::size_t name_length = u16(record + 28);
        const std::string name = zip.substr(record + 46, name_length);
        if (!is_ascii(name)) {
            set_flag(record + 8);
            const std::size_t local = u32(record + 42);
            if (local + 30 <= zip.size() && zip.compare(local, 4, "PK\x03\x04") == 0) {
                set_flag(local + 6);
            }
        }
        record += 46 + name_length + u16(record + 30) + u16(record + 32);
    }
}

std::string zip_entries(const std::vector<ZipEntry>& entries) {
    std::string out;
    std::unique_ptr<struct archive, WriterDeleter> a(archive_write_new());
    // The names go in as UTF-8 bytes without any of libarchive's locale conversions (built
    // without iconv, it cannot convert names in the C locale): raw on Linux and macOS, as wide
    // characters turned into UTF-8 on Windows, where its default would be the OEM code page.
    // The UTF-8 flag is then set in the headers (resource-formats §5).
    if (archive_write_set_format_zip(a.get()) != ARCHIVE_OK ||
        archive_write_set_format_option(a.get(), "zip", "compression", "deflate") != ARCHIVE_OK ||
#ifdef _WIN32
        archive_write_set_format_option(a.get(), "zip", "hdrcharset", "UTF-8") < ARCHIVE_WARN ||
#endif
        archive_write_set_bytes_in_last_block(a.get(), 1) != ARCHIVE_OK ||
        archive_write_open2(a.get(), &out, nullptr, append, nullptr, nullptr) != ARCHIVE_OK) {
        fail(a.get());
    }
    const std::time_t now = std::time(nullptr);
    for (const ZipEntry& entry : entries) {
        std::unique_ptr<archive_entry, EntryDeleter> e(archive_entry_new());
#ifdef _WIN32
        archive_entry_copy_pathname_w(e.get(), platform::path_from_utf8(entry.name).c_str());
#else
        archive_entry_set_pathname(e.get(), entry.name.c_str());
#endif
        archive_entry_set_size(e.get(), static_cast<la_int64_t>(entry.bytes.size()));
        archive_entry_set_filetype(e.get(), AE_IFREG);
        archive_entry_set_perm(e.get(), 0644);
        if (!entry.untimed) {
            archive_entry_set_mtime(e.get(), now, 0);
        }
        const int method = entry.stored ? archive_write_zip_set_compression_store(a.get())
                                        : archive_write_zip_set_compression_deflate(a.get());
        if (method != ARCHIVE_OK || archive_write_header(a.get(), e.get()) < ARCHIVE_WARN) {
            fail(a.get());
        }
        std::size_t done = 0;
        while (done < entry.bytes.size()) {
            const std::size_t chunk = std::min<std::size_t>(entry.bytes.size() - done, 1u << 20);
            const la_ssize_t n = archive_write_data(a.get(), entry.bytes.data() + done, chunk);
            if (n <= 0) {
                fail(a.get());
            }
            done += static_cast<std::size_t>(n);
        }
    }
    if (archive_write_close(a.get()) != ARCHIVE_OK) {
        fail(a.get());
    }
    flag_utf8_names(out);
    return out;
}

std::string zip_one(const std::string& entry_name, std::string_view bytes) {
    return zip_entries({ZipEntry{entry_name, bytes}});
}

}  // namespace mfbe::archive
