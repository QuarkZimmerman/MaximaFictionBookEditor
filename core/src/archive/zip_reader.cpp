// Listing a ZIP archive and reading one entry (feature 009, research DP-1 to DP-3). See
// mfbe/archive.hpp.
#include <mfbe/archive.hpp>

#include <algorithm>
#include <archive.h>
#include <archive_entry.h>
#include <cctype>
#include <cstring>
#include <fstream>
#include <memory>
#include <zlib.h>

namespace mfbe::archive {
namespace {

std::uint16_t u16(const unsigned char* p) {
    return static_cast<std::uint16_t>(p[0] | (p[1] << 8));
}
std::uint32_t u32(const unsigned char* p) {
    return static_cast<std::uint32_t>(p[0]) | (static_cast<std::uint32_t>(p[1]) << 8) |
           (static_cast<std::uint32_t>(p[2]) << 16) | (static_cast<std::uint32_t>(p[3]) << 24);
}
std::uint64_t u64(const unsigned char* p) {
    return static_cast<std::uint64_t>(u32(p)) | (static_cast<std::uint64_t>(u32(p + 4)) << 32);
}

[[noreturn]] void damaged(const std::string& detail) {
    throw ArchiveError(Reason::damaged, "", detail);
}

std::string read_range(std::ifstream& in, std::uint64_t offset, std::uint64_t size) {
    std::string out(static_cast<std::size_t>(size), '\0');
    in.clear();
    in.seekg(static_cast<std::streamoff>(offset));
    in.read(out.data(), static_cast<std::streamsize>(size));
    if (static_cast<std::uint64_t>(in.gcount()) != size) {
        damaged("the archive is truncated");
    }
    return out;
}

struct Raw {
    Entry entry;
    bool utf8 = false;
    std::string unicode_path;  // the Info-ZIP Unicode path field's name, when it matches
};

// The central directory's records, in their order (throws ArchiveError).
std::vector<Raw> read_central(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        damaged("the archive cannot be opened");
    }
    in.seekg(0, std::ios::end);
    const auto file_size = static_cast<std::uint64_t>(in.tellg());
    const std::uint64_t tail_size = std::min<std::uint64_t>(file_size, 65535 + 22);
    const std::string tail = read_range(in, file_size - tail_size, tail_size);
    std::size_t at = std::string::npos;
    for (std::size_t i = tail.size() >= 22 ? tail.size() - 22 : std::string::npos;
         i != std::string::npos; i = i == 0 ? std::string::npos : i - 1) {
        if (tail.compare(i, 4, "PK\x05\x06") == 0) {
            at = i;
            break;
        }
    }
    if (at == std::string::npos) {
        damaged("no end of central directory");
    }
    const auto* e = reinterpret_cast<const unsigned char*>(tail.data() + at);
    const std::uint64_t eocd_offset = file_size - tail_size + at;
    std::uint32_t disk = u16(e + 4);
    std::uint32_t cd_disk = u16(e + 6);
    std::uint64_t count = u16(e + 10);
    std::uint64_t cd_size = u32(e + 12);
    std::uint64_t cd_offset = u32(e + 16);
    if (count == 0xFFFF || cd_size == 0xFFFFFFFF || cd_offset == 0xFFFFFFFF) {
        // ZIP64: the locator sits just before the end record.
        if (eocd_offset < 20) {
            damaged("no ZIP64 locator");
        }
        const std::string locator = read_range(in, eocd_offset - 20, 20);
        const auto* l = reinterpret_cast<const unsigned char*>(locator.data());
        if (u32(l) != 0x07064b50) {
            damaged("no ZIP64 locator");
        }
        if (u32(l + 16) > 1) {
            throw ArchiveError(Reason::multi_volume, "", "a multi-volume archive");
        }
        const std::string record = read_range(in, u64(l + 8), 56);
        const auto* r = reinterpret_cast<const unsigned char*>(record.data());
        if (u32(r) != 0x06064b50) {
            damaged("no ZIP64 end of central directory");
        }
        disk = u32(r + 16);
        cd_disk = u32(r + 20);
        count = u64(r + 32);
        cd_size = u64(r + 40);
        cd_offset = u64(r + 48);
    }
    if (disk != 0 || cd_disk != 0) {
        throw ArchiveError(Reason::multi_volume, "", "a multi-volume archive");
    }
    if (cd_offset > file_size || cd_size > file_size - cd_offset) {
        damaged("the central directory lies outside the archive");
    }
    const std::string cd = read_range(in, cd_offset, cd_size);
    std::vector<Raw> out;
    out.reserve(static_cast<std::size_t>(std::min<std::uint64_t>(count, 1u << 20)));
    std::size_t p = 0;
    while (p + 46 <= cd.size() && out.size() < count) {
        const auto* h = reinterpret_cast<const unsigned char*>(cd.data() + p);
        if (u32(h) != 0x02014b50) {
            damaged("a damaged central directory");
        }
        const std::size_t name_len = u16(h + 28);
        const std::size_t extra_len = u16(h + 30);
        const std::size_t comment_len = u16(h + 32);
        if (p + 46 + name_len + extra_len + comment_len > cd.size()) {
            damaged("a damaged central directory");
        }
        Raw raw;
        raw.entry.flags = u16(h + 8);
        raw.entry.method = u16(h + 10);
        raw.entry.crc = u32(h + 16);
        raw.entry.compressed = u32(h + 20);
        raw.entry.size = u32(h + 24);
        raw.entry.offset = u32(h + 42);
        raw.entry.raw_name.assign(cd.data() + p + 46, name_len);
        raw.utf8 = (raw.entry.flags & 0x0800) != 0;
        // Extra fields: ZIP64 sizes and offset (0x0001), the Unicode path (0x7075).
        std::size_t x = p + 46 + name_len;
        const std::size_t x_end = x + extra_len;
        while (x + 4 <= x_end) {
            const auto* f = reinterpret_cast<const unsigned char*>(cd.data() + x);
            const std::uint16_t id = u16(f);
            const std::size_t len = u16(f + 2);
            if (x + 4 + len > x_end) {
                break;
            }
            const auto* d = f + 4;
            if (id == 0x0001) {
                std::size_t q = 0;
                auto take = [&](std::uint64_t& field) {
                    if (field == 0xFFFFFFFF && q + 8 <= len) {
                        field = u64(d + q);
                        q += 8;
                    }
                };
                take(raw.entry.size);
                take(raw.entry.compressed);
                take(raw.entry.offset);
            } else if (id == 0x7075 && len >= 5 && d[0] == 1) {
                const auto crc = static_cast<std::uint32_t>(
                    crc32(0, reinterpret_cast<const Bytef*>(raw.entry.raw_name.data()),
                          static_cast<uInt>(name_len)));
                if (u32(d + 1) == crc) {
                    raw.unicode_path.assign(reinterpret_cast<const char*>(d + 5), len - 5);
                }
            }
            x += 4 + len;
        }
        const std::string& n = raw.entry.raw_name;
        raw.entry.directory = !n.empty() && (n.back() == '/' || n.back() == '\\');
        out.push_back(std::move(raw));
        p += 46 + name_len + extra_len + comment_len;
    }
    if (out.size() != count) {
        damaged("a damaged central directory");
    }
    return out;
}

bool ends_with_ci(const std::string& s, const char* suffix) {
    const std::size_t n = std::strlen(suffix);
    if (s.size() < n) {
        return false;
    }
    for (std::size_t i = 0; i < n; ++i) {
        if (std::tolower(static_cast<unsigned char>(s[s.size() - n + i])) != suffix[i]) {
            return false;
        }
    }
    return true;
}

struct ReaderDeleter {
    void operator()(struct archive* a) const { archive_read_free(a); }
};

}  // namespace

Listing list(const std::filesystem::path& archive_path) {
    std::vector<Raw> raws = read_central(archive_path);
    // The unflagged names without a Unicode path are judged together (DP-2).
    std::vector<std::string> legacy;
    for (const Raw& r : raws) {
        if (!r.utf8 && r.unicode_path.empty()) {
            legacy.push_back(r.entry.raw_name);
        }
    }
    const Decoded decoded = decode_names(legacy, default_candidates());
    std::size_t next = 0;
    Listing listing;
    listing.entries.reserve(raws.size());
    for (Raw& r : raws) {
        Entry e = std::move(r.entry);
        if (r.utf8) {
            e.name = convert_codepage(e.raw_name, 65001);
            if (e.name.empty()) {
                e.name = e.raw_name;
            }
        } else if (!r.unicode_path.empty()) {
            e.name = r.unicode_path;
        } else {
            e.name = decoded.names[next++];
        }
        if (!e.directory) {
            const bool fb2 = ends_with_ci(e.name, ".fb2");
            if (fb2 || ends_with_ci(e.name, ".fbd")) {
                ++listing.books_total;
                if (listing.books.size() < kMaxListedBooks) {
                    const std::size_t slash = e.name.find_last_of('/');
                    Book b;
                    b.entry = e.name;
                    b.name = slash == std::string::npos ? e.name : e.name.substr(slash + 1);
                    b.folder = slash == std::string::npos ? "" : e.name.substr(0, slash);
                    b.size = e.size;
                    b.kind = fb2 ? "fb2" : "fbd";
                    listing.books.push_back(std::move(b));
                }
            } else {
                ++listing.other_files;
            }
        }
        listing.entries.push_back(std::move(e));
    }
    return listing;
}

std::string read_entry(const std::filesystem::path& archive_path, const std::string& entry_name) {
    const Listing listing = list(archive_path);
    const auto found = std::find_if(listing.entries.begin(), listing.entries.end(),
                                    [&](const Entry& e) { return e.name == entry_name; });
    if (found == listing.entries.end()) {
        throw ArchiveError(Reason::missing, entry_name, "the entry is not in the archive");
    }
    if ((found->flags & 0x0001) != 0) {
        throw ArchiveError(Reason::encrypted, entry_name, "the entry is encrypted");
    }
    if (found->size > kMaxBookBytes) {
        throw ArchiveError(Reason::too_large, entry_name, "the entry is too large");
    }
    std::unique_ptr<struct archive, ReaderDeleter> a(archive_read_new());
    archive_read_support_format_zip_seekable(a.get());
#ifdef _WIN32
    int r = archive_read_open_filename_w(a.get(), archive_path.c_str(), 1 << 16);
#else
    int r = archive_read_open_filename(a.get(), archive_path.c_str(), 1 << 16);
#endif
    if (r != ARCHIVE_OK) {
        throw ArchiveError(Reason::damaged, entry_name, "the archive cannot be read");
    }
    // The seekable reader walks the entries by local-header offset (macOS resource forks under
    // "__MACOSX/" merged into their files). The entry is matched by its name where libarchive
    // can present one; built without iconv it cannot present a flagged UTF-8 name in the C
    // locale, so the entry's place in that order, with its size, decides then.
    std::size_t place = 0;
    for (const Entry& e : listing.entries) {
        if (e.offset < found->offset && e.name.rfind("__MACOSX/", 0) != 0) {
            ++place;
        }
    }
    archive_entry* header = nullptr;
    for (std::size_t i = 0;; ++i) {
        r = archive_read_next_header(a.get(), &header);
        if (r == ARCHIVE_EOF) {
            throw ArchiveError(Reason::damaged, entry_name, "the entry cannot be found");
        }
        if (r < ARCHIVE_WARN) {
            throw ArchiveError(Reason::damaged, entry_name, "the archive cannot be read");
        }
        const char* raw = archive_entry_pathname(header);
        const char* utf8 = archive_entry_pathname_utf8(header);
        if ((raw != nullptr && found->raw_name == raw) || (utf8 != nullptr && entry_name == utf8)) {
            break;
        }
        if (i == place && archive_entry_size(header) == static_cast<la_int64_t>(found->size)) {
            break;
        }
    }
    if (archive_entry_is_encrypted(header)) {
        throw ArchiveError(Reason::encrypted, entry_name, "the entry is encrypted");
    }
    std::string data;
    data.reserve(static_cast<std::size_t>(std::min<std::uint64_t>(found->size, kMaxBookBytes)));
    char buffer[1 << 16];
    for (;;) {
        const la_ssize_t n = archive_read_data(a.get(), buffer, sizeof buffer);
        if (n == 0) {
            break;
        }
        if (n < 0) {
            const char* message = archive_error_string(a.get());
            const std::string text = message != nullptr ? message : "";
            const bool unsupported = text.find("nsupported") != std::string::npos ||
                                     text.find("not supported") != std::string::npos;
            throw ArchiveError(unsupported ? Reason::method : Reason::damaged, entry_name, text);
        }
        if (data.size() + static_cast<std::size_t>(n) > kMaxBookBytes) {
            throw ArchiveError(Reason::too_large, entry_name, "the entry is too large");
        }
        data.append(buffer, static_cast<std::size_t>(n));
    }
    return data;
}

std::string read_entry_at(const std::filesystem::path& archive_path, const Entry& entry) {
    if ((entry.flags & 0x0001) != 0) {
        throw ArchiveError(Reason::encrypted, entry.name, "the entry is encrypted");
    }
    if (entry.method != 0 && entry.method != 8) {
        throw ArchiveError(Reason::method, entry.name, "neither stored nor deflated");
    }
    std::ifstream in(archive_path, std::ios::binary);
    if (!in) {
        throw ArchiveError(Reason::damaged, entry.name, "the archive cannot be opened");
    }
    const std::string local = read_range(in, entry.offset, 30);
    const auto* h = reinterpret_cast<const unsigned char*>(local.data());
    if (u32(h) != 0x04034b50) {
        throw ArchiveError(Reason::damaged, entry.name, "no local header at the entry's offset");
    }
    // The local header's own name and extra lengths, which may differ from the central record's.
    const std::uint64_t data_at = entry.offset + 30 + u16(h + 26) + u16(h + 28);
    const std::string packed = read_range(in, data_at, entry.compressed);
    std::string data;
    if (entry.method == 0) {
        if (entry.compressed != entry.size) {
            throw ArchiveError(Reason::damaged, entry.name, "a stored entry of two sizes");
        }
        data = packed;
    } else {
        // Inflated into exactly the declared size: data that run past it are refused unread.
        data.resize(static_cast<std::size_t>(entry.size));
        z_stream z{};
        if (inflateInit2(&z, -MAX_WBITS) != Z_OK) {
            throw ArchiveError(Reason::damaged, entry.name, "the inflater cannot start");
        }
        z.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(packed.data()));
        z.avail_in = static_cast<uInt>(packed.size());
        z.next_out = reinterpret_cast<Bytef*>(data.data());
        z.avail_out = static_cast<uInt>(data.size());
        int r = inflate(&z, Z_FINISH);
        if (r == Z_BUF_ERROR && z.avail_out == 0) {
            // The output is full before the stream's end (zlib may hold output even when all the
            // input is read): only an end of stream, with no byte more, may follow.
            unsigned char probe = 0;
            z.next_out = &probe;
            z.avail_out = 1;
            r = inflate(&z, Z_FINISH);
            inflateEnd(&z);
            if (r != Z_STREAM_END || z.avail_out == 0) {
                throw ArchiveError(Reason::too_large, entry.name,
                                   "the entry unpacks beyond its declared size");
            }
        } else {
            inflateEnd(&z);
        }
        if (r != Z_STREAM_END || z.total_out != entry.size) {
            throw ArchiveError(Reason::damaged, entry.name, "the entry's data are damaged");
        }
    }
    const auto crc = static_cast<std::uint32_t>(
        crc32(0, reinterpret_cast<const Bytef*>(data.data()), static_cast<uInt>(data.size())));
    if (crc != entry.crc) {
        throw ArchiveError(Reason::damaged, entry.name, "the entry's data fail their check");
    }
    return data;
}

}  // namespace mfbe::archive
