// MOBI/KF8 INDX/TAGX/IDXT/CNCX, FDST/SKEL/FRAG/GUIDE, and closing records (T008).
#pragma once

#include <mfbe/mobi.hpp>

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace mfbe::mobi {

struct SkelEntry {
    std::string key;  // e.g. "SKEL0000000000"
    std::uint32_t chunk_count = 0;
    std::uint32_t start_pos = 0;
    std::uint32_t length = 0;
};

struct FragEntry {
    std::string aid;       // entry key (e.g. "0000000000")
    std::string selector;  // CNCX selector string (tag 2)
    std::uint32_t skeleton_index = 0;
    std::uint32_t insert_pos = 0;
    std::uint32_t start_pos = 0;
    std::uint32_t length = 0;
};

struct Kf8SkelFragData {
    std::vector<SkelEntry> skels;
    std::vector<FragEntry> frags;
};

// Forward big-endian 7-bit VWI (stop bit 0x80 on the final byte).
void append_vwi_forward(std::string& dst, std::uint32_t value);
bool read_vwi_forward(std::string_view src, std::size_t& pos, std::uint32_t& out);

// Writers
std::vector<std::string> build_mobi7_ncx(const std::vector<MobiNavEntry>& entries);
std::vector<std::string> build_kf8_ncx(const std::vector<MobiNavEntry>& entries);
std::vector<std::string> build_kf8_skel(const std::vector<SkelEntry>& skels);
std::vector<std::string> build_kf8_frag(const std::vector<FragEntry>& frags);
std::vector<std::string> build_kf8_guide(const std::vector<MobiGuideEntry>& guides);
std::string build_fdst(const std::vector<std::pair<std::uint32_t, std::uint32_t>>& flows);

// Closing records (contracts/mobi-file.md §7)
std::string make_flis_record();
std::string make_fcis_record(std::uint32_t text_length);
std::string make_eof_record();
inline constexpr std::string_view kBoundaryRecord = "BOUNDARY";

// Readers
std::vector<std::pair<std::uint32_t, std::uint32_t>> parse_fdst(std::string_view record,
                                                                std::size_t stream_len);
std::vector<MobiNavEntry> parse_ncx_indx(const std::vector<std::string_view>& records,
                                         std::size_t indx_start);
Kf8SkelFragData parse_kf8_skel_frag(const std::vector<std::string_view>& records,
                                    std::size_t skel_start, std::size_t frag_start);
std::vector<MobiGuideEntry> parse_kf8_guide(const std::vector<std::string_view>& records,
                                            std::size_t guide_start);

}  // namespace mfbe::mobi
