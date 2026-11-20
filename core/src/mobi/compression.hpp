// PalmDOC LZ77, HuffCDIC decoder, UTF-8 chunking, and trailing entries (T006, contracts/mobi-file.md §3).
#pragma once

#include <mfbe/mobi.hpp>

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::mobi {

// PalmDOC LZ77 compression (contracts/mobi-file.md §3).
std::string palmdoc_compress(std::string_view input);

// PalmDOC LZ77 decompression with strict back-reference and output size cap.
std::string palmdoc_decompress(std::string_view input, std::size_t max_output_bytes);

// Splits UTF-8 text into <= max_chunk byte chunks without splitting multi-byte UTF-8 sequences.
std::vector<std::string> split_utf8_chunks(std::string_view utf8, std::size_t max_chunk = 4096);

// Strips trailing extra data from a text record according to MOBI header extra_data_flags.
std::string_view strip_trailing_entries(std::string_view record, std::uint32_t extra_data_flags);

// Read-only HuffCDIC decoder (compression == 17480) with depth <= 32 and bomb cap.
class HuffCdicDecoder {
public:
    static HuffCdicDecoder parse(const std::vector<std::string_view>& huff_cdic_records);

    void decode_into(std::string_view record, std::string& out,
                     std::size_t max_total_bytes) const;

private:
    struct CdicEntry {
        bool terminal = true;
        std::string bytes;
    };

    void decode_slice(std::string_view slice, std::string& out, std::size_t max_total_bytes,
                      int depth) const;

    std::array<std::uint32_t, 256> table1_{};
    std::array<std::uint64_t, 33> mincode_{};
    std::array<std::uint64_t, 33> maxcode_{};
    std::uint32_t code_length_ = 0;
    std::vector<CdicEntry> dictionary_;
};

// Decompresses a sequence of MOBI/PalmDOC text records enforcing bomb caps (<= 256 MB & <= 100x).
std::string decompress_text_records(std::uint16_t compression,
                                    const std::vector<std::string_view>& text_records,
                                    std::uint32_t extra_data_flags,
                                    std::size_t expected_text_length,
                                    const HuffCdicDecoder* huff = nullptr);

}  // namespace mfbe::mobi
