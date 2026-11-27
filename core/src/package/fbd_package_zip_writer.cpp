// Streaming ZIP64-capable temp-file atomic writer with raw-slice pass-through (feature 022, D2).
//
// Preserved entries from an existing ZIP (unchanged payload files and ignored subfolders/extra
// files) are copied raw from the source archive's compressed byte range with zero decompression
// and zero recompression; newly added disk files stream through 64 KB buffers using STORE (for
// already-compressed book formats) or DEFLATE (for plain text); managed .fbd entries are deflated
// as UTF-8. The finished temporary sibling file replaces the target atomically.
#include <mfbe/atomic_file.hpp>
#include <mfbe/fbd_package.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <array>
#include <cstdint>
#include <ctime>
#include <fstream>
#include <limits>
#include <map>
#include <string>
#include <string_view>
#include <vector>
#include <zlib.h>

namespace mfbe::package {
namespace {

namespace fs = std::filesystem;

constexpr std::uint32_t kZip32Max = 0xFFFFFFFFu;
constexpr std::uint16_t kZip16Max = 0xFFFFu;
constexpr std::size_t kChunkBytes = 64 * 1024;

std::uint16_t read_u16(const unsigned char* p) {
    return static_cast<std::uint16_t>(p[0]) | (static_cast<std::uint16_t>(p[1]) << 8);
}

std::uint32_t read_u32(const unsigned char* p) {
    return static_cast<std::uint32_t>(p[0]) | (static_cast<std::uint32_t>(p[1]) << 8) |
           (static_cast<std::uint32_t>(p[2]) << 16) | (static_cast<std::uint32_t>(p[3]) << 24);
}

std::uint64_t read_u64(const unsigned char* p) {
    return static_cast<std::uint64_t>(read_u32(p)) |
           (static_cast<std::uint64_t>(read_u32(p + 4)) << 32);
}

void push_u16(std::string& out, std::uint16_t v) {
    out.push_back(static_cast<char>(v & 0xFFu));
    out.push_back(static_cast<char>((v >> 8) & 0xFFu));
}

void push_u32(std::string& out, std::uint32_t v) {
    out.push_back(static_cast<char>(v & 0xFFu));
    out.push_back(static_cast<char>((v >> 8) & 0xFFu));
    out.push_back(static_cast<char>((v >> 16) & 0xFFu));
    out.push_back(static_cast<char>((v >> 24) & 0xFFu));
}

void push_u64(std::string& out, std::uint64_t v) {
    push_u32(out, static_cast<std::uint32_t>(v & 0xFFFFFFFFu));
    push_u32(out, static_cast<std::uint32_t>((v >> 32) & 0xFFFFFFFFu));
}

bool is_ascii(std::string_view s) {
    return std::all_of(s.begin(), s.end(),
                       [](char c) { return static_cast<unsigned char>(c) < 0x80; });
}

void current_dos_datetime(std::uint16_t& dos_time, std::uint16_t& dos_date) {
    const std::time_t now = std::time(nullptr);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &now);
#else
    localtime_r(&now, &tm);
#endif
    const int year = std::clamp(tm.tm_year + 1900, 1980, 2107);
    dos_date =
        static_cast<std::uint16_t>(((year - 1980) << 9) | ((tm.tm_mon + 1) << 5) | tm.tm_mday);
    dos_time = static_cast<std::uint16_t>((tm.tm_hour << 11) | (tm.tm_min << 5) | (tm.tm_sec / 2));
}

// Strips any ZIP64 (0x0001) extra block from an extra field sequence so a clean updated ZIP64
// block can be emitted when offsets or sizes cross the 32-bit threshold.
std::string strip_zip64_extra(std::string_view extra) {
    std::string out;
    out.reserve(extra.size());
    std::size_t pos = 0;
    while (pos + 4 <= extra.size()) {
        const auto* p = reinterpret_cast<const unsigned char*>(extra.data() + pos);
        const std::uint16_t tag = read_u16(p);
        const std::uint16_t len = read_u16(p + 2);
        if (pos + 4 + len > extra.size()) {
            break;
        }
        if (tag != 0x0001u) {
            out.append(extra.substr(pos, 4 + len));
        }
        pos += 4 + len;
    }
    return out;
}

struct SourceCdRecord {
    std::uint16_t version_made = 20;
    std::uint16_t version_needed = 20;
    std::uint16_t flags = 0;
    std::uint16_t method = 0;
    std::uint16_t dos_time = 0;
    std::uint16_t dos_date = 0;
    std::uint32_t crc32 = 0;
    std::uint64_t compressed_size = 0;
    std::uint64_t uncompressed_size = 0;
    std::uint16_t internal_attr = 0;
    std::uint32_t external_attr = 0;
    std::uint64_t local_header_offset = 0;
    std::string raw_name;
    std::string extra;
    std::string comment;
};

// Parses every Central Directory header of an existing ZIP (supporting ZIP32 and ZIP64).
std::vector<SourceCdRecord> read_source_central_directory(std::ifstream& in,
                                                          std::uint64_t file_size,
                                                          const std::string& zip_label) {
    if (file_size < 22) {
        throw ZipWriteError("sourceUnreadable", zip_label, "source ZIP is truncated");
    }
    const std::uint64_t tail_len = std::min<std::uint64_t>(file_size, 65557);
    const std::uint64_t tail_start = file_size - tail_len;
    std::string tail(static_cast<std::size_t>(tail_len), '\0');
    in.seekg(static_cast<std::streamoff>(tail_start));
    in.read(tail.data(), static_cast<std::streamsize>(tail_len));
    if (!in || static_cast<std::uint64_t>(in.gcount()) != tail_len) {
        throw ZipWriteError("sourceUnreadable", zip_label, "failed to read source ZIP EOCD");
    }

    const auto* tb = reinterpret_cast<const unsigned char*>(tail.data());
    std::size_t eocd_pos = std::string::npos;
    for (std::size_t i = tail.size() - 22;; --i) {
        if (tb[i] == 0x50 && tb[i + 1] == 0x4B && tb[i + 2] == 0x05 && tb[i + 3] == 0x06) {
            const std::uint16_t comment_len = read_u16(tb + i + 20);
            if (i + 22 + comment_len == tail.size()) {
                eocd_pos = i;
                break;
            }
        }
        if (i == 0) {
            break;
        }
    }
    if (eocd_pos == std::string::npos) {
        throw ZipWriteError("sourceUnreadable", zip_label, "source ZIP has no EOCD record");
    }

    std::uint64_t cd_entries = read_u16(tb + eocd_pos + 10);
    std::uint64_t cd_size = read_u32(tb + eocd_pos + 12);
    std::uint64_t cd_offset = read_u32(tb + eocd_pos + 16);

    // Check for ZIP64 EOCD locator immediately preceding the EOCD.
    if (eocd_pos >= 20 && tb[eocd_pos - 20] == 0x50 && tb[eocd_pos - 19] == 0x4B &&
        tb[eocd_pos - 18] == 0x06 && tb[eocd_pos - 17] == 0x07) {
        const std::uint64_t z64_eocd_offset = read_u64(tb + eocd_pos - 12);
        if (z64_eocd_offset + 56 <= file_size) {
            unsigned char z64[56];
            in.seekg(static_cast<std::streamoff>(z64_eocd_offset));
            in.read(reinterpret_cast<char*>(z64), sizeof(z64));
            if (in && in.gcount() == sizeof(z64) && z64[0] == 0x50 && z64[1] == 0x4B &&
                z64[2] == 0x06 && z64[3] == 0x06) {
                cd_entries = read_u64(z64 + 32);
                cd_size = read_u64(z64 + 40);
                cd_offset = read_u64(z64 + 48);
            }
        }
    }

    if (cd_offset + cd_size > file_size || cd_size > 256ull * 1024 * 1024) {
        throw ZipWriteError("sourceUnreadable", zip_label,
                            "source ZIP central directory is out of bounds");
    }

    std::string cd(static_cast<std::size_t>(cd_size), '\0');
    in.seekg(static_cast<std::streamoff>(cd_offset));
    in.read(cd.data(), static_cast<std::streamsize>(cd_size));
    if (!in || static_cast<std::uint64_t>(in.gcount()) != cd_size) {
        throw ZipWriteError("sourceUnreadable", zip_label, "failed to read central directory");
    }

    std::vector<SourceCdRecord> records;
    records.reserve(static_cast<std::size_t>(std::min<std::uint64_t>(cd_entries, 100000)));
    const auto* cb = reinterpret_cast<const unsigned char*>(cd.data());
    std::size_t pos = 0;
    while (pos + 46 <= cd.size()) {
        if (cb[pos] != 0x50 || cb[pos + 1] != 0x4B || cb[pos + 2] != 0x01 || cb[pos + 3] != 0x02) {
            break;
        }
        SourceCdRecord r;
        r.version_made = read_u16(cb + pos + 4);
        r.version_needed = read_u16(cb + pos + 6);
        r.flags = read_u16(cb + pos + 8);
        r.method = read_u16(cb + pos + 10);
        r.dos_time = read_u16(cb + pos + 12);
        r.dos_date = read_u16(cb + pos + 14);
        r.crc32 = read_u32(cb + pos + 16);
        r.compressed_size = read_u32(cb + pos + 20);
        r.uncompressed_size = read_u32(cb + pos + 24);
        const std::uint16_t name_len = read_u16(cb + pos + 28);
        const std::uint16_t extra_len = read_u16(cb + pos + 30);
        const std::uint16_t comment_len = read_u16(cb + pos + 32);
        r.internal_attr = read_u16(cb + pos + 36);
        r.external_attr = read_u32(cb + pos + 38);
        r.local_header_offset = read_u32(cb + pos + 42);
        if (pos + 46 + name_len + extra_len + comment_len > cd.size()) {
            throw ZipWriteError("sourceUnreadable", zip_label, "truncated central directory entry");
        }
        r.raw_name.assign(cd.data() + pos + 46, name_len);
        r.extra.assign(cd.data() + pos + 46 + name_len, extra_len);
        r.comment.assign(cd.data() + pos + 46 + name_len + extra_len, comment_len);

        // Decode ZIP64 extended information extra block (0x0001) when sentinel values appear.
        std::size_t epos = 0;
        const auto* eb = reinterpret_cast<const unsigned char*>(r.extra.data());
        while (epos + 4 <= r.extra.size()) {
            const std::uint16_t tag = read_u16(eb + epos);
            const std::uint16_t len = read_u16(eb + epos + 2);
            if (epos + 4 + len > r.extra.size()) {
                break;
            }
            if (tag == 0x0001u) {
                std::size_t off = epos + 4;
                const std::size_t end = off + len;
                if (r.uncompressed_size == kZip32Max && off + 8 <= end) {
                    r.uncompressed_size = read_u64(eb + off);
                    off += 8;
                }
                if (r.compressed_size == kZip32Max && off + 8 <= end) {
                    r.compressed_size = read_u64(eb + off);
                    off += 8;
                }
                if (r.local_header_offset == kZip32Max && off + 8 <= end) {
                    r.local_header_offset = read_u64(eb + off);
                    off += 8;
                }
                break;
            }
            epos += 4 + len;
        }
        records.push_back(std::move(r));
        pos += 46 + name_len + extra_len + comment_len;
    }
    return records;
}

struct WrittenCdRecord {
    std::uint16_t version_made = 20;
    std::uint16_t version_needed = 20;
    std::uint16_t flags = 0;
    std::uint16_t method = 0;
    std::uint16_t dos_time = 0;
    std::uint16_t dos_date = 0;
    std::uint32_t crc32 = 0;
    std::uint64_t compressed_size = 0;
    std::uint64_t uncompressed_size = 0;
    std::uint16_t internal_attr = 0;
    std::uint32_t external_attr = 0;
    std::uint64_t local_header_offset = 0;
    std::string raw_name;
    std::string extra_without_z64;
    std::string comment;
};

class StreamingZipFile {
public:
    StreamingZipFile(const fs::path& temp_path, const std::string& target_label,
                     ZipProgressCallback progress, ZipCancelCheck cancel, std::uint64_t total_bytes)
        : temp_path_(temp_path),
          target_label_(target_label),
          progress_(std::move(progress)),
          cancel_(std::move(cancel)),
          total_bytes_(total_bytes) {
        out_.open(temp_path_, std::ios::binary | std::ios::out | std::ios::trunc);
        if (!out_) {
            throw ZipWriteError("ioError", target_label_, "cannot create temporary ZIP file");
        }
        current_dos_datetime(now_time_, now_date_);
    }

    void check_cancel() const {
        if (cancel_ && cancel_()) {
            throw ZipWriteError("cancelled", target_label_, "cancelled");
        }
    }

    void write_bytes(const void* data, std::size_t size) {
        if (size == 0) {
            return;
        }
        out_.write(static_cast<const char*>(data), static_cast<std::streamsize>(size));
        if (!out_) {
            throw ZipWriteError("ioError", target_label_, "failed to write ZIP output");
        }
        offset_ += size;
    }

    void report_progress(std::uint64_t delta) {
        done_bytes_ += delta;
        if (progress_) {
            progress_(done_bytes_, total_bytes_);
        }
    }

    // Raw-slice pass-through from source ZIP without decompressing or re-compressing.
    void write_raw_from_source(std::ifstream& src, const SourceCdRecord& rec,
                               const std::string& override_utf8_name = "") {
        check_cancel();
        unsigned char lfh[30];
        src.seekg(static_cast<std::streamoff>(rec.local_header_offset));
        src.read(reinterpret_cast<char*>(lfh), sizeof(lfh));
        if (!src || src.gcount() != sizeof(lfh) || lfh[0] != 0x50 || lfh[1] != 0x4B ||
            lfh[2] != 0x03 || lfh[3] != 0x04) {
            throw ZipWriteError("sourceUnreadable", rec.raw_name,
                                "source ZIP local header is damaged");
        }
        const std::uint16_t lfh_name_len = read_u16(lfh + 26);
        const std::uint16_t lfh_extra_len = read_u16(lfh + 28);
        std::string lfh_name(lfh_name_len, '\0');
        std::string lfh_extra(lfh_extra_len, '\0');
        if (lfh_name_len > 0) {
            src.read(lfh_name.data(), lfh_name_len);
        }
        if (lfh_extra_len > 0) {
            src.read(lfh_extra.data(), lfh_extra_len);
        }
        if (!src) {
            throw ZipWriteError("sourceUnreadable", rec.raw_name,
                                "source ZIP local header is truncated");
        }

        const std::string out_name = override_utf8_name.empty() ? rec.raw_name : override_utf8_name;
        std::uint16_t flags = static_cast<std::uint16_t>(rec.flags & ~0x0008u);
        if (!override_utf8_name.empty() && !is_ascii(override_utf8_name)) {
            flags = static_cast<std::uint16_t>(flags | 0x0800u);
        }

        const bool need_z64_sizes =
            rec.compressed_size >= kZip32Max || rec.uncompressed_size >= kZip32Max;
        std::string clean_lfh_extra = strip_zip64_extra(lfh_extra);
        if (need_z64_sizes) {
            push_u16(clean_lfh_extra, 0x0001u);
            push_u16(clean_lfh_extra, 16u);
            push_u64(clean_lfh_extra, rec.uncompressed_size);
            push_u64(clean_lfh_extra, rec.compressed_size);
        }

        const std::uint16_t ver_needed =
            need_z64_sizes ? std::max<std::uint16_t>(rec.version_needed, 45u) : rec.version_needed;
        const std::uint64_t new_lh_offset = offset_;

        std::string header;
        header.reserve(30 + out_name.size() + clean_lfh_extra.size());
        push_u32(header, 0x04034B50u);
        push_u16(header, ver_needed);
        push_u16(header, flags);
        push_u16(header, rec.method);
        push_u16(header, rec.dos_time);
        push_u16(header, rec.dos_date);
        push_u32(header, rec.crc32);
        push_u32(header,
                 need_z64_sizes ? kZip32Max : static_cast<std::uint32_t>(rec.compressed_size));
        push_u32(header,
                 need_z64_sizes ? kZip32Max : static_cast<std::uint32_t>(rec.uncompressed_size));
        push_u16(header, static_cast<std::uint16_t>(out_name.size()));
        push_u16(header, static_cast<std::uint16_t>(clean_lfh_extra.size()));
        header.append(out_name);
        header.append(clean_lfh_extra);
        write_bytes(header.data(), header.size());

        std::array<char, kChunkBytes> buf{};
        std::uint64_t remaining = rec.compressed_size;
        while (remaining > 0) {
            check_cancel();
            const std::size_t step =
                static_cast<std::size_t>(std::min<std::uint64_t>(remaining, buf.size()));
            src.read(buf.data(), static_cast<std::streamsize>(step));
            if (!src || static_cast<std::size_t>(src.gcount()) != step) {
                throw ZipWriteError("sourceUnreadable", rec.raw_name,
                                    "source ZIP payload stream ended unexpectedly");
            }
            write_bytes(buf.data(), step);
            remaining -= step;
            report_progress(step);
        }

        WrittenCdRecord cd;
        cd.version_made = rec.version_made;
        cd.version_needed = ver_needed;
        cd.flags = flags;
        cd.method = rec.method;
        cd.dos_time = rec.dos_time;
        cd.dos_date = rec.dos_date;
        cd.crc32 = rec.crc32;
        cd.compressed_size = rec.compressed_size;
        cd.uncompressed_size = rec.uncompressed_size;
        cd.internal_attr = rec.internal_attr;
        cd.external_attr = rec.external_attr;
        cd.local_header_offset = new_lh_offset;
        cd.raw_name = out_name;
        cd.extra_without_z64 = strip_zip64_extra(rec.extra);
        cd.comment = rec.comment;
        cd_records_.push_back(std::move(cd));
    }

    // Streams bytes from `read_chunk` callback into a fresh ZIP entry (STORE or DEFLATE), then
    // seeks back to patch CRC-32 and final sizes in the Local File Header.
    template <typename ReaderFn>
    void write_streamed_entry(const std::string& utf8_name, bool deflate,
                              std::uint64_t expected_uncompressed, ReaderFn&& read_chunk) {
        check_cancel();
        const std::uint16_t flags = is_ascii(utf8_name) ? 0u : 0x0800u;
        const std::uint16_t method = deflate ? 8u : 0u;
        // Reserve a ZIP64 extra slot upfront whenever the file could cross 4 GiB so patching the
        // LFH never shifts following data bytes.
        const bool reserve_z64 = expected_uncompressed >= (kZip32Max - 1024u * 1024u);
        const std::uint16_t ver_needed = reserve_z64 ? 45u : 20u;
        const std::uint64_t lh_offset = offset_;

        std::string extra;
        if (reserve_z64) {
            push_u16(extra, 0x0001u);
            push_u16(extra, 16u);
            push_u64(extra, 0u);
            push_u64(extra, 0u);
        }

        std::string header;
        header.reserve(30 + utf8_name.size() + extra.size());
        push_u32(header, 0x04034B50u);
        push_u16(header, ver_needed);
        push_u16(header, flags);
        push_u16(header, method);
        push_u16(header, now_time_);
        push_u16(header, now_date_);
        push_u32(header, 0u);  // patched CRC-32
        push_u32(header, reserve_z64 ? kZip32Max : 0u);
        push_u32(header, reserve_z64 ? kZip32Max : 0u);
        push_u16(header, static_cast<std::uint16_t>(utf8_name.size()));
        push_u16(header, static_cast<std::uint16_t>(extra.size()));
        header.append(utf8_name);
        header.append(extra);
        write_bytes(header.data(), header.size());

        const std::uint64_t data_start = offset_;
        uLong crc = ::crc32(0L, Z_NULL, 0);
        std::uint64_t uncompressed = 0;

        if (!deflate) {
            std::array<char, kChunkBytes> buf{};
            for (;;) {
                check_cancel();
                const std::size_t n = read_chunk(buf.data(), buf.size());
                if (n == 0) {
                    break;
                }
                crc =
                    ::crc32(crc, reinterpret_cast<const Bytef*>(buf.data()), static_cast<uInt>(n));
                write_bytes(buf.data(), n);
                uncompressed += n;
                report_progress(n);
            }
        } else {
            z_stream zs{};
            if (deflateInit2(&zs, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -MAX_WBITS, 8,
                             Z_DEFAULT_STRATEGY) != Z_OK) {
                throw ZipWriteError("ioError", utf8_name, "zlib deflateInit2 failed");
            }
            struct ZGuard {
                z_stream* s;
                ~ZGuard() { deflateEnd(s); }
            } guard{&zs};

            std::array<char, kChunkBytes> in_buf{};
            std::array<unsigned char, kChunkBytes> out_buf{};
            bool eof = false;
            while (!eof) {
                check_cancel();
                const std::size_t n = read_chunk(in_buf.data(), in_buf.size());
                if (n == 0) {
                    eof = true;
                } else {
                    crc = ::crc32(crc, reinterpret_cast<const Bytef*>(in_buf.data()),
                                  static_cast<uInt>(n));
                    uncompressed += n;
                    report_progress(n);
                }
                zs.next_in = reinterpret_cast<Bytef*>(in_buf.data());
                zs.avail_in = static_cast<uInt>(n);
                const int flush = eof ? Z_FINISH : Z_NO_FLUSH;
                for (;;) {
                    zs.next_out = out_buf.data();
                    zs.avail_out = static_cast<uInt>(out_buf.size());
                    const int ret = ::deflate(&zs, flush);
                    if (ret == Z_STREAM_ERROR) {
                        throw ZipWriteError("ioError", utf8_name, "zlib deflate failed");
                    }
                    const std::size_t produced = out_buf.size() - zs.avail_out;
                    if (produced > 0) {
                        write_bytes(out_buf.data(), produced);
                    }
                    if (zs.avail_out != 0) {
                        break;
                    }
                }
            }
        }

        const std::uint64_t compressed = offset_ - data_start;
        const std::uint64_t end_offset = offset_;

        // Patch CRC-32 and sizes in the Local File Header.
        out_.seekp(static_cast<std::streamoff>(lh_offset + 14));
        std::string patch;
        push_u32(patch, static_cast<std::uint32_t>(crc));
        push_u32(patch, reserve_z64 ? kZip32Max : static_cast<std::uint32_t>(compressed));
        push_u32(patch, reserve_z64 ? kZip32Max : static_cast<std::uint32_t>(uncompressed));
        out_.write(patch.data(), static_cast<std::streamsize>(patch.size()));
        if (reserve_z64) {
            out_.seekp(static_cast<std::streamoff>(lh_offset + 30 + utf8_name.size() + 4));
            std::string z64_patch;
            push_u64(z64_patch, uncompressed);
            push_u64(z64_patch, compressed);
            out_.write(z64_patch.data(), static_cast<std::streamsize>(z64_patch.size()));
        }
        out_.seekp(static_cast<std::streamoff>(end_offset));
        if (!out_) {
            throw ZipWriteError("ioError", target_label_, "failed to patch ZIP local header");
        }

        WrittenCdRecord cd;
        cd.version_made = static_cast<std::uint16_t>((3u << 8) | ver_needed);
        cd.version_needed = ver_needed;
        cd.flags = flags;
        cd.method = method;
        cd.dos_time = now_time_;
        cd.dos_date = now_date_;
        cd.crc32 = static_cast<std::uint32_t>(crc);
        cd.compressed_size = compressed;
        cd.uncompressed_size = uncompressed;
        cd.internal_attr = 0;
        cd.external_attr = 0100644u << 16;
        cd.local_header_offset = lh_offset;
        cd.raw_name = utf8_name;
        cd_records_.push_back(std::move(cd));
    }

    void finish() {
        check_cancel();
        const std::uint64_t cd_start = offset_;
        for (const WrittenCdRecord& r : cd_records_) {
            const bool z64_uncomp = r.uncompressed_size >= kZip32Max;
            const bool z64_comp = r.compressed_size >= kZip32Max;
            const bool z64_off = r.local_header_offset >= kZip32Max;
            std::string extra = r.extra_without_z64;
            if (z64_uncomp || z64_comp || z64_off) {
                std::string z64_body;
                if (z64_uncomp) {
                    push_u64(z64_body, r.uncompressed_size);
                }
                if (z64_comp) {
                    push_u64(z64_body, r.compressed_size);
                }
                if (z64_off) {
                    push_u64(z64_body, r.local_header_offset);
                }
                push_u16(extra, 0x0001u);
                push_u16(extra, static_cast<std::uint16_t>(z64_body.size()));
                extra.append(z64_body);
            }
            const std::uint16_t ver_needed = (z64_uncomp || z64_comp || z64_off)
                                                 ? std::max<std::uint16_t>(r.version_needed, 45u)
                                                 : r.version_needed;
            std::string cd;
            cd.reserve(46 + r.raw_name.size() + extra.size() + r.comment.size());
            push_u32(cd, 0x02014B50u);
            push_u16(cd, r.version_made);
            push_u16(cd, ver_needed);
            push_u16(cd, r.flags);
            push_u16(cd, r.method);
            push_u16(cd, r.dos_time);
            push_u16(cd, r.dos_date);
            push_u32(cd, r.crc32);
            push_u32(cd, z64_comp ? kZip32Max : static_cast<std::uint32_t>(r.compressed_size));
            push_u32(cd, z64_uncomp ? kZip32Max : static_cast<std::uint32_t>(r.uncompressed_size));
            push_u16(cd, static_cast<std::uint16_t>(r.raw_name.size()));
            push_u16(cd, static_cast<std::uint16_t>(extra.size()));
            push_u16(cd, static_cast<std::uint16_t>(r.comment.size()));
            push_u16(cd, 0u);  // disk number start
            push_u16(cd, r.internal_attr);
            push_u32(cd, r.external_attr);
            push_u32(cd, z64_off ? kZip32Max : static_cast<std::uint32_t>(r.local_header_offset));
            cd.append(r.raw_name);
            cd.append(extra);
            cd.append(r.comment);
            write_bytes(cd.data(), cd.size());
        }
        const std::uint64_t cd_size = offset_ - cd_start;
        const std::uint64_t count = cd_records_.size();
        const bool need_z64_eocd =
            count >= kZip16Max || cd_size >= kZip32Max || cd_start >= kZip32Max;

        if (need_z64_eocd) {
            const std::uint64_t z64_eocd_offset = offset_;
            std::string z64;
            push_u32(z64, 0x06064B50u);
            push_u64(z64, 44u);
            push_u16(z64, 45u);
            push_u16(z64, 45u);
            push_u32(z64, 0u);
            push_u32(z64, 0u);
            push_u64(z64, count);
            push_u64(z64, count);
            push_u64(z64, cd_size);
            push_u64(z64, cd_start);
            write_bytes(z64.data(), z64.size());

            std::string loc;
            push_u32(loc, 0x07064B50u);
            push_u32(loc, 0u);
            push_u64(loc, z64_eocd_offset);
            push_u32(loc, 1u);
            write_bytes(loc.data(), loc.size());
        }

        std::string eocd;
        push_u32(eocd, 0x06054B50u);
        push_u16(eocd, 0u);
        push_u16(eocd, 0u);
        push_u16(eocd, count >= kZip16Max ? kZip16Max : static_cast<std::uint16_t>(count));
        push_u16(eocd, count >= kZip16Max ? kZip16Max : static_cast<std::uint16_t>(count));
        push_u32(eocd, cd_size >= kZip32Max ? kZip32Max : static_cast<std::uint32_t>(cd_size));
        push_u32(eocd, cd_start >= kZip32Max ? kZip32Max : static_cast<std::uint32_t>(cd_start));
        push_u16(eocd, 0u);
        write_bytes(eocd.data(), eocd.size());

        out_.flush();
        out_.close();
        if (!out_) {
            throw ZipWriteError("ioError", target_label_, "failed to flush temporary ZIP");
        }
    }

private:
    fs::path temp_path_;
    std::string target_label_;
    std::ofstream out_;
    std::uint64_t offset_ = 0;
    std::uint16_t now_time_ = 0;
    std::uint16_t now_date_ = 0;
    std::vector<WrittenCdRecord> cd_records_;
    ZipProgressCallback progress_;
    ZipCancelCheck cancel_;
    std::uint64_t total_bytes_ = 0;
    std::uint64_t done_bytes_ = 0;
};

}  // namespace

void write_package_zip_atomic(const PackageZipWritePlan& plan,
                              const ZipProgressCallback& on_progress,
                              const ZipCancelCheck& is_cancelled) {
    const std::string target_label = platform::utf8_from_path(plan.targetZipPath);

    // Pre-open source ZIP (if needed) and validate disk sources before creating any temp file.
    std::ifstream source_stream;
    std::map<std::string, SourceCdRecord> source_by_raw_name;
    const bool needs_source =
        plan.sourceZipPath.has_value() &&
        (plan.preserveNonManaged ||
         std::any_of(plan.managedEntries.begin(), plan.managedEntries.end(),
                     [](const PackageZipWriteEntry& e) {
                         return !e.isMemory && e.sourceKind == PayloadSourceKind::zip_entry;
                     }));

    if (needs_source) {
        const fs::path& sp = *plan.sourceZipPath;
        const std::string sp_utf8 = platform::utf8_from_path(sp);
        std::error_code ec;
        const auto sz = fs::file_size(sp, ec);
        if (ec) {
            throw ZipWriteError("sourceMissing", sp_utf8, "source package ZIP is no longer found");
        }
        source_stream.open(sp, std::ios::binary);
        if (!source_stream) {
            throw ZipWriteError("sourceUnreadable", sp_utf8, "cannot open source package ZIP");
        }
        for (SourceCdRecord& rec : read_source_central_directory(source_stream, sz, sp_utf8)) {
            source_by_raw_name.emplace(rec.raw_name, std::move(rec));
        }
    }

    // Compute total byte budget for smooth progress notifications.
    std::uint64_t total_bytes = 0;
    if (plan.preserveNonManaged) {
        for (const FbdPackagePreservedZipEntry& p : plan.preservedEntries) {
            const auto it = source_by_raw_name.find(p.rawName);
            if (it != source_by_raw_name.end()) {
                total_bytes += it->second.compressed_size;
            }
        }
    }
    for (const PackageZipWriteEntry& e : plan.managedEntries) {
        if (e.isMemory) {
            total_bytes += e.memoryBytes.size();
        } else if (e.sourceKind == PayloadSourceKind::zip_entry) {
            if (!e.sourceZipRawName || !source_by_raw_name.contains(*e.sourceZipRawName)) {
                throw ZipWriteError("sourceMissing", e.entryName,
                                    "retained payload entry is missing from source ZIP");
            }
            total_bytes += source_by_raw_name.at(*e.sourceZipRawName).compressed_size;
        } else {
            if (!e.diskPath) {
                throw ZipWriteError("sourceMissing", e.entryName, "missing source disk path");
            }
            std::error_code ec;
            if (!fs::is_regular_file(*e.diskPath, ec)) {
                throw ZipWriteError("sourceMissing", e.entryName,
                                    "source file is no longer available on disk");
            }
            const auto sz = fs::file_size(*e.diskPath, ec);
            if (ec) {
                throw ZipWriteError("sourceUnreadable", e.entryName,
                                    "source file size cannot be read");
            }
            total_bytes += static_cast<std::uint64_t>(sz);
        }
    }

    fs::path temp_path;
    try {
        temp_path = atomic_file::make_sibling_temp_path(plan.targetZipPath);
    } catch (const atomic_file::WriteError& e) {
        throw ZipWriteError("ioError", target_label, e.what());
    }

    auto cleanup_temp = [&] {
        std::error_code rm_ec;
        if (!temp_path.empty()) {
            fs::remove(temp_path, rm_ec);
        }
    };

    try {
        {
            StreamingZipFile writer(temp_path, target_label, on_progress, is_cancelled,
                                    total_bytes);

            if (plan.preserveNonManaged) {
                for (const FbdPackagePreservedZipEntry& p : plan.preservedEntries) {
                    const auto it = source_by_raw_name.find(p.rawName);
                    if (it != source_by_raw_name.end()) {
                        writer.write_raw_from_source(source_stream, it->second);
                    }
                }
            }

            for (const PackageZipWriteEntry& e : plan.managedEntries) {
                if (e.isMemory) {
                    std::size_t pos = 0;
                    writer.write_streamed_entry(
                        e.entryName, e.compressDeflate, e.memoryBytes.size(),
                        [&](char* dst, std::size_t cap) -> std::size_t {
                            const std::size_t n =
                                std::min<std::size_t>(cap, e.memoryBytes.size() - pos);
                            if (n > 0) {
                                std::copy_n(e.memoryBytes.data() + pos, n, dst);
                                pos += n;
                            }
                            return n;
                        });
                } else if (e.sourceKind == PayloadSourceKind::zip_entry) {
                    const SourceCdRecord& rec = source_by_raw_name.at(*e.sourceZipRawName);
                    writer.write_raw_from_source(source_stream, rec, e.entryName);
                } else {
                    std::ifstream disk_in(*e.diskPath, std::ios::binary);
                    if (!disk_in) {
                        throw ZipWriteError("sourceUnreadable", e.entryName,
                                            "cannot open source file for reading");
                    }
                    std::error_code ec;
                    const auto sz = fs::file_size(*e.diskPath, ec);
                    writer.write_streamed_entry(
                        e.entryName, e.compressDeflate, ec ? 0u : static_cast<std::uint64_t>(sz),
                        [&](char* dst, std::size_t cap) -> std::size_t {
                            disk_in.read(dst, static_cast<std::streamsize>(cap));
                            const std::streamsize got = disk_in.gcount();
                            if (got == 0 && disk_in.bad()) {
                                throw ZipWriteError("sourceUnreadable", e.entryName,
                                                    "failed while reading source file");
                            }
                            return static_cast<std::size_t>(got);
                        });
                }
            }

            writer.finish();
        }

        // Close source stream before atomic replace (required on Windows when overwriting source).
        if (source_stream.is_open()) {
            source_stream.close();
        }

        try {
            atomic_file::replace_from_temp(plan.targetZipPath, temp_path);
        } catch (const atomic_file::WriteError& e) {
            throw ZipWriteError("ioError", target_label, e.what());
        }
    } catch (...) {
        if (source_stream.is_open()) {
            source_stream.close();
        }
        cleanup_temp();
        throw;
    }
}

}  // namespace mfbe::package
