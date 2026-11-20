// PalmDB container reader/writer and big-endian binary helpers (T006, contracts/mobi-file.md §1).
#pragma once

#include <mfbe/mobi.hpp>

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::mobi {

inline std::uint16_t read_u16_be(std::string_view data, std::size_t off) {
    return static_cast<std::uint16_t>(
        (static_cast<std::uint16_t>(static_cast<unsigned char>(data[off])) << 8) |
        static_cast<std::uint16_t>(static_cast<unsigned char>(data[off + 1])));
}

inline std::uint32_t read_u32_be(std::string_view data, std::size_t off) {
    return (static_cast<std::uint32_t>(static_cast<unsigned char>(data[off])) << 24) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(data[off + 1])) << 16) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(data[off + 2])) << 8) |
           static_cast<std::uint32_t>(static_cast<unsigned char>(data[off + 3]));
}

inline void write_u16_be(std::string& dst, std::size_t off, std::uint16_t v) {
    dst[off] = static_cast<char>((v >> 8) & 0xFFU);
    dst[off + 1] = static_cast<char>(v & 0xFFU);
}

inline void write_u32_be(std::string& dst, std::size_t off, std::uint32_t v) {
    dst[off] = static_cast<char>((v >> 24) & 0xFFU);
    dst[off + 1] = static_cast<char>((v >> 16) & 0xFFU);
    dst[off + 2] = static_cast<char>((v >> 8) & 0xFFU);
    dst[off + 3] = static_cast<char>(v & 0xFFU);
}

inline void append_u16_be(std::string& dst, std::uint16_t v) {
    dst.push_back(static_cast<char>((v >> 8) & 0xFFU));
    dst.push_back(static_cast<char>(v & 0xFFU));
}

inline void append_u32_be(std::string& dst, std::uint32_t v) {
    dst.push_back(static_cast<char>((v >> 24) & 0xFFU));
    dst.push_back(static_cast<char>((v >> 16) & 0xFFU));
    dst.push_back(static_cast<char>((v >> 8) & 0xFFU));
    dst.push_back(static_cast<char>(v & 0xFFU));
}

inline std::string encode_u32_be(std::uint32_t v) {
    std::string out;
    out.reserve(4);
    append_u32_be(out, v);
    return out;
}

struct PalmDb {
    std::string name;
    std::string type = "BOOK";
    std::string creator = "MOBI";
    std::uint32_t created_at = 0;
    std::uint32_t modified_at = 0;
    std::vector<std::string> records;
};

// Parses a PalmDB byte stream, enforcing kMaxFileBytes, KFX/FB2 detection, and record bounds.
PalmDb read_palmdb(std::string_view bytes);

// Serializes a PalmDB container (78-byte header + record info table + 2-byte gap + records).
std::string write_palmdb(const PalmDb& db);

}  // namespace mfbe::mobi
