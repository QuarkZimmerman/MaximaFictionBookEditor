// PalmDOC LZ77, HuffCDIC decoder, UTF-8 chunking, and trailing entries (T006,
// contracts/mobi-file.md §3).
#include "mobi/compression.hpp"

#include "mobi/palmdb.hpp"

#include <algorithm>
#include <array>

namespace mfbe::mobi {
namespace {

constexpr std::size_t kHashBits = 12;
constexpr std::size_t kHashSize = 1U << kHashBits;
constexpr std::size_t kWindowSize = 2047;
constexpr std::size_t kMaxProbe = 24;

inline std::size_t hash3(const unsigned char* p) {
    const std::uint32_t v = (static_cast<std::uint32_t>(p[0]) << 16) |
                            (static_cast<std::uint32_t>(p[1]) << 8) |
                            static_cast<std::uint32_t>(p[2]);
    return ((v * 2654435761U) >> (32 - kHashBits)) & (kHashSize - 1);
}

inline bool is_direct_literal(unsigned char b) {
    return b == 0x00 || (b >= 0x09 && b <= 0x7F);
}

// Peeks 32 big-endian bits starting at bit position `bit_pos` inside `buf` (zero-padded past end).
std::uint32_t peek_bits_32(std::string_view buf, std::size_t bit_pos) {
    const std::size_t byte_pos = bit_pos >> 3;
    const unsigned shift = static_cast<unsigned>(bit_pos & 7U);
    std::uint64_t acc = 0;
    for (std::size_t k = 0; k < 5; ++k) {
        acc <<= 8;
        if (byte_pos + k < buf.size()) {
            acc |= static_cast<unsigned char>(buf[byte_pos + k]);
        }
    }
    return static_cast<std::uint32_t>((acc >> (8 - shift)) & 0xFFFFFFFFULL);
}

}  // namespace

std::string palmdoc_compress(std::string_view input) {
    std::string out;
    out.reserve(input.size());
    const std::size_t n = input.size();
    const auto* data = reinterpret_cast<const unsigned char*>(input.data());

    std::array<int, kHashSize> head{};
    head.fill(-1);
    std::vector<int> prev(n, -1);

    auto insert_pos = [&](std::size_t pos) {
        if (pos + 2 < n) {
            const std::size_t h = hash3(data + pos);
            prev[pos] = head[h];
            head[h] = static_cast<int>(pos);
        }
    };

    std::size_t i = 0;
    while (i < n) {
        std::size_t best_len = 0;
        std::size_t best_dist = 0;

        if (i + 2 < n) {
            const std::size_t h = hash3(data + i);
            int cur = head[h];
            std::size_t probes = 0;
            const std::size_t max_len = std::min<std::size_t>(10, n - i);
            while (cur >= 0 && probes < kMaxProbe) {
                const std::size_t pos = static_cast<std::size_t>(cur);
                const std::size_t dist = i - pos;
                if (dist > kWindowSize) {
                    break;
                }
                if (data[pos] == data[i] && data[pos + 1] == data[i + 1] &&
                    data[pos + 2] == data[i + 2]) {
                    std::size_t len = 3;
                    while (len < max_len && data[pos + len] == data[i + len]) {
                        ++len;
                    }
                    if (len > best_len) {
                        best_len = len;
                        best_dist = dist;
                        if (best_len == max_len) {
                            break;
                        }
                    }
                }
                cur = prev[pos];
                ++probes;
            }
        }

        if (best_len >= 3) {
            const std::uint16_t pair = static_cast<std::uint16_t>(
                0x8000U | ((best_dist & 0x7FFU) << 3) | ((best_len - 3U) & 0x7U));
            out.push_back(static_cast<char>((pair >> 8) & 0xFFU));
            out.push_back(static_cast<char>(pair & 0xFFU));
            for (std::size_t k = 0; k < best_len; ++k) {
                insert_pos(i + k);
            }
            i += best_len;
            continue;
        }

        const unsigned char b = data[i];
        // Space + [0x40..0x7F] pair -> single byte (next ^ 0x80).
        if (b == 0x20 && i + 1 < n && data[i + 1] >= 0x40 && data[i + 1] <= 0x7F) {
            out.push_back(static_cast<char>(data[i + 1] ^ 0x80U));
            insert_pos(i);
            insert_pos(i + 1);
            i += 2;
            continue;
        }

        if (is_direct_literal(b)) {
            out.push_back(static_cast<char>(b));
            insert_pos(i);
            ++i;
            continue;
        }

        // Literal run of 1..8 non-direct bytes (0x01..0x08 or 0x80..0xFF).
        std::size_t run_end = i + 1;
        while (run_end < n && (run_end - i) < 8 && !is_direct_literal(data[run_end])) {
            ++run_end;
        }
        const std::size_t run_len = run_end - i;
        out.push_back(static_cast<char>(run_len));
        for (std::size_t k = i; k < run_end; ++k) {
            out.push_back(static_cast<char>(data[k]));
            insert_pos(k);
        }
        i = run_end;
    }
    return out;
}

std::string palmdoc_decompress(std::string_view input, std::size_t max_output_bytes) {
    std::string out;
    out.reserve(std::min<std::size_t>(input.size() * 2, max_output_bytes));

    std::size_t i = 0;
    const std::size_t n = input.size();
    while (i < n) {
        const unsigned char b = static_cast<unsigned char>(input[i++]);
        if (b == 0x00 || (b >= 0x09 && b <= 0x7F)) {
            if (out.size() + 1 > max_output_bytes) {
                throw MobiError("decompressBomb", "PalmDOC output exceeded limit");
            }
            out.push_back(static_cast<char>(b));
        } else if (b >= 0x01 && b <= 0x08) {
            if (i + b > n) {
                throw MobiError("damaged", "truncated PalmDOC literal run");
            }
            if (out.size() + b > max_output_bytes) {
                throw MobiError("decompressBomb", "PalmDOC output exceeded limit");
            }
            out.append(input.substr(i, b));
            i += b;
        } else if (b >= 0x80 && b <= 0xBF) {
            if (i >= n) {
                throw MobiError("damaged", "truncated PalmDOC back-reference");
            }
            const unsigned char b2 = static_cast<unsigned char>(input[i++]);
            const std::uint16_t pair =
                static_cast<std::uint16_t>(((static_cast<std::uint16_t>(b) << 8) | b2) & 0x3FFFU);
            const std::size_t dist = pair >> 3;
            const std::size_t len = (pair & 0x07U) + 3U;
            if (dist == 0 || dist > out.size()) {
                throw MobiError("damaged", "invalid PalmDOC back-reference distance");
            }
            if (out.size() + len > max_output_bytes) {
                throw MobiError("decompressBomb", "PalmDOC output exceeded limit");
            }
            for (std::size_t k = 0; k < len; ++k) {
                out.push_back(out[out.size() - dist]);
            }
        } else {
            // 0xC0..0xFF -> space + (b ^ 0x80)
            if (out.size() + 2 > max_output_bytes) {
                throw MobiError("decompressBomb", "PalmDOC output exceeded limit");
            }
            out.push_back(' ');
            out.push_back(static_cast<char>(b ^ 0x80U));
        }
    }
    return out;
}

std::vector<std::string> split_utf8_chunks(std::string_view utf8, std::size_t max_chunk) {
    if (max_chunk < 4) {
        max_chunk = 4;
    }
    std::vector<std::string> chunks;
    if (utf8.empty()) {
        chunks.emplace_back();
        return chunks;
    }
    std::size_t pos = 0;
    while (pos < utf8.size()) {
        std::size_t end = std::min(utf8.size(), pos + max_chunk);
        if (end < utf8.size()) {
            // Walk back at most 3 bytes if `end` lands in the middle of a multi-byte UTF-8
            // sequence.
            std::size_t back = 0;
            while (end > pos && back < 4 &&
                   (static_cast<unsigned char>(utf8[end]) & 0xC0U) == 0x80U) {
                --end;
                ++back;
            }
            if (end == pos) {
                end = std::min(utf8.size(), pos + max_chunk);
            }
        }
        chunks.emplace_back(utf8.substr(pos, end - pos));
        pos = end;
    }
    return chunks;
}

std::string_view strip_trailing_entries(std::string_view record, std::uint32_t extra_data_flags) {
    if (extra_data_flags == 0) {
        return record;
    }
    // Strip bits 15 down to 1: each set bit uses a backward VWI giving total bytes to remove.
    for (int bit = 15; bit >= 1; --bit) {
        if ((extra_data_flags & (1U << bit)) == 0) {
            continue;
        }
        if (record.empty()) {
            throw MobiError("damaged", "missing trailing extra-data entry");
        }
        std::size_t size = 0;
        unsigned shift = 0;
        bool found_start = false;
        std::size_t pos = record.size();
        for (int k = 0; k < 4 && pos > 0; ++k) {
            --pos;
            const unsigned char b = static_cast<unsigned char>(record[pos]);
            size |= static_cast<std::size_t>(b & 0x7FU) << shift;
            shift += 7;
            if ((b & 0x80U) != 0) {
                found_start = true;
                break;
            }
        }
        if (!found_start || size == 0 || size > record.size()) {
            throw MobiError("damaged", "invalid backward VWI in trailing extra data");
        }
        record.remove_suffix(size);
    }

    // Strip bit 0 (multibyte UTF-8 overlap): (last_byte & 0x03) + 1 bytes.
    if ((extra_data_flags & 1U) != 0) {
        if (record.empty()) {
            throw MobiError("damaged", "missing multibyte trailing byte");
        }
        const std::size_t overlap = (static_cast<unsigned char>(record.back()) & 0x03U) + 1U;
        if (overlap > record.size()) {
            throw MobiError("damaged", "multibyte trailing overlap exceeds record size");
        }
        record.remove_suffix(overlap);
    }
    return record;
}

HuffCdicDecoder HuffCdicDecoder::parse(const std::vector<std::string_view>& huff_cdic_records) {
    if (huff_cdic_records.size() < 2) {
        throw MobiError("damaged", "HuffCDIC requires at least HUFF + CDIC records");
    }
    const std::string_view huff = huff_cdic_records[0];
    if (huff.size() < 24 || huff.substr(0, 4) != "HUFF") {
        throw MobiError("damaged", "invalid HUFF header");
    }
    const std::uint32_t offset1 = read_u32_be(huff, 8);
    const std::uint32_t offset2 = read_u32_be(huff, 12);
    if (static_cast<std::size_t>(offset1) + 256U * 4U > huff.size() ||
        static_cast<std::size_t>(offset2) + 64U * 4U > huff.size()) {
        throw MobiError("damaged", "HUFF tables exceed record size");
    }

    HuffCdicDecoder dec;
    for (std::size_t i = 0; i < 256; ++i) {
        dec.table1_[i] = read_u32_be(huff, offset1 + i * 4U);
    }
    dec.mincode_[0] = 0;
    dec.maxcode_[0] = 0;
    for (std::size_t L = 1; L <= 32; ++L) {
        const std::uint64_t raw_min = read_u32_be(huff, offset2 + (L - 1) * 8U);
        const std::uint64_t raw_max = read_u32_be(huff, offset2 + (L - 1) * 8U + 4U);
        const unsigned shift = static_cast<unsigned>(32 - L);
        dec.mincode_[L] = raw_min << shift;
        dec.maxcode_[L] = ((raw_max + 1ULL) << shift) - 1ULL;
    }

    std::size_t remaining_phrases = 0;
    for (std::size_t rec_idx = 1; rec_idx < huff_cdic_records.size(); ++rec_idx) {
        const std::string_view cdic = huff_cdic_records[rec_idx];
        if (cdic.size() < 16 || cdic.substr(0, 4) != "CDIC") {
            throw MobiError("damaged", "invalid CDIC header");
        }
        const std::uint32_t hdr_len = read_u32_be(cdic, 4);
        const std::uint32_t phrases = read_u32_be(cdic, 8);
        const std::uint32_t code_len = read_u32_be(cdic, 12);
        if (hdr_len < 16 || hdr_len > cdic.size() || code_len == 0 || code_len > 20) {
            throw MobiError("damaged", "invalid CDIC header parameters");
        }
        if (rec_idx == 1) {
            dec.code_length_ = code_len;
            remaining_phrases = phrases;
            if (remaining_phrases > (1ULL << 22)) {
                throw MobiError("damaged", "CDIC phrase count exceeds limit");
            }
            dec.dictionary_.reserve(remaining_phrases);
        }
        const std::size_t max_in_rec = static_cast<std::size_t>(1U) << code_len;
        const std::size_t count = std::min(remaining_phrases, max_in_rec);
        if (static_cast<std::size_t>(hdr_len) + count * 2U > cdic.size()) {
            throw MobiError("damaged", "CDIC offset table exceeds record size");
        }
        for (std::size_t i = 0; i < count; ++i) {
            const std::uint16_t rel_off = read_u16_be(cdic, hdr_len + i * 2U);
            const std::size_t entry_off = static_cast<std::size_t>(hdr_len) + rel_off;
            if (entry_off + 2U > cdic.size()) {
                throw MobiError("damaged", "CDIC entry offset out of bounds");
            }
            const std::uint16_t flag_len = read_u16_be(cdic, entry_off);
            const bool is_term = (flag_len & 0x8000U) != 0;
            const std::size_t blen = flag_len & 0x7FFFU;
            if (entry_off + 2U + blen > cdic.size()) {
                throw MobiError("damaged", "CDIC entry payload exceeds record size");
            }
            dec.dictionary_.push_back(
                CdicEntry{is_term, std::string(cdic.substr(entry_off + 2U, blen))});
        }
        remaining_phrases -= count;
    }

    if (dec.dictionary_.empty()) {
        throw MobiError("damaged", "empty CDIC dictionary");
    }
    return dec;
}

void HuffCdicDecoder::decode_into(std::string_view record, std::string& out,
                                  std::size_t max_total_bytes) const {
    decode_slice(record, out, max_total_bytes, 0);
}

void HuffCdicDecoder::decode_slice(std::string_view slice, std::string& out,
                                   std::size_t max_total_bytes, int depth) const {
    if (depth > kMaxHuffDepth) {
        throw MobiError("damaged", "HuffCDIC recursion depth exceeded 32");
    }
    const std::size_t total_bits = slice.size() * 8U;
    std::size_t bit_pos = 0;

    while (bit_pos < total_bits) {
        const std::size_t bits_left = total_bits - bit_pos;
        const std::uint32_t word = peek_bits_32(slice, bit_pos);
        const std::uint32_t t1 = table1_[word >> 24];
        std::uint32_t codelen = t1 & 0x1FU;
        const bool cached_term = (t1 & 0x80U) != 0;
        std::uint64_t maxcode_val = 0;

        if (codelen == 0) {
            throw MobiError("damaged", "zero-length HuffCDIC code");
        }
        if (cached_term) {
            const std::uint64_t raw_max = t1 >> 8;
            const unsigned shift = static_cast<unsigned>(32 - codelen);
            maxcode_val = ((raw_max + 1ULL) << shift) - 1ULL;
        } else {
            while (codelen < 32 && static_cast<std::uint64_t>(word) < mincode_[codelen]) {
                ++codelen;
            }
            if (codelen > 32) {
                throw MobiError("damaged", "HuffCDIC code length out of range");
            }
            maxcode_val = maxcode_[codelen];
        }

        if (codelen > bits_left) {
            // Trailing zero-padding bits at the end of the slice.
            break;
        }
        if (static_cast<std::uint64_t>(word) > maxcode_val) {
            throw MobiError("damaged", "HuffCDIC word exceeds maxcode");
        }
        const std::uint64_t dict_idx =
            (maxcode_val - static_cast<std::uint64_t>(word)) >> (32 - codelen);
        bit_pos += codelen;

        if (dict_idx >= dictionary_.size()) {
            throw MobiError("damaged", "HuffCDIC symbol index out of bounds");
        }
        const CdicEntry& entry = dictionary_[static_cast<std::size_t>(dict_idx)];
        if (entry.terminal) {
            if (out.size() + entry.bytes.size() > max_total_bytes) {
                throw MobiError("decompressBomb", "HuffCDIC output exceeded limit");
            }
            out.append(entry.bytes);
        } else {
            decode_slice(entry.bytes, out, max_total_bytes, depth + 1);
        }
    }
}

std::string decompress_text_records(std::uint16_t compression,
                                    const std::vector<std::string_view>& text_records,
                                    std::uint32_t extra_data_flags,
                                    std::size_t expected_text_length, const HuffCdicDecoder* huff) {
    if (compression != 1 && compression != 2 && compression != 17480) {
        throw MobiError("damaged", "unsupported MOBI compression type");
    }
    if (compression == 17480 && huff == nullptr) {
        throw MobiError("damaged", "HuffCDIC compression without HUFF/CDIC tables");
    }

    std::size_t total_compressed = 0;
    for (std::string_view rec : text_records) {
        total_compressed += rec.size();
    }
    const std::size_t ratio_cap =
        std::max<std::size_t>(kMinBombBaselineBytes, total_compressed * kMaxExpansionRatio);
    const std::size_t max_bytes = std::min<std::size_t>(kMaxDecompressedBytes, ratio_cap);

    std::string result;
    result.reserve(std::min<std::size_t>(expected_text_length, max_bytes));

    for (std::string_view raw_rec : text_records) {
        const std::string_view rec = strip_trailing_entries(raw_rec, extra_data_flags);
        if (compression == 1) {
            if (result.size() + rec.size() > max_bytes) {
                throw MobiError("decompressBomb", "uncompressed text exceeded cap");
            }
            result.append(rec);
        } else if (compression == 2) {
            const std::size_t remaining = max_bytes - result.size();
            const std::string chunk = palmdoc_decompress(rec, remaining);
            result.append(chunk);
        } else {
            huff->decode_into(rec, result, max_bytes);
        }
    }

    if (expected_text_length > 0 && result.size() > expected_text_length) {
        // Standard Mobipocket pads the final record occasionally; trim to header text_length
        // when it is strictly smaller than the decoded buffer.
        result.resize(expected_text_length);
    }
    return result;
}

}  // namespace mfbe::mobi
