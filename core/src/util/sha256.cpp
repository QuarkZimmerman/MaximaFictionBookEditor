// SHA-256 as specified in FIPS 180-4 §6.2: 512-bit blocks, eight 32-bit working variables,
// 64 rounds with the first 32 bits of the fractional parts of the cube roots of the first 64
// primes as constants. Straightforward and dependency-free (see sha256.hpp for why).
#include "util/sha256.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace mfbe::util {
namespace {

constexpr std::array<std::uint32_t, 64> kRoundConstants = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

constexpr std::array<std::uint32_t, 8> kInitialState = {
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
};

inline std::uint32_t rotr(std::uint32_t x, unsigned n) {
    return (x >> n) | (x << (32 - n));
}

// One 64-byte block (FIPS 180-4 §6.2.2).
void compress(std::array<std::uint32_t, 8>& state, const unsigned char* block) {
    std::uint32_t w[64];
    for (int t = 0; t < 16; ++t) {
        w[t] = (static_cast<std::uint32_t>(block[4 * t]) << 24) |
               (static_cast<std::uint32_t>(block[4 * t + 1]) << 16) |
               (static_cast<std::uint32_t>(block[4 * t + 2]) << 8) |
               static_cast<std::uint32_t>(block[4 * t + 3]);
    }
    for (int t = 16; t < 64; ++t) {
        const std::uint32_t s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >> 3);
        const std::uint32_t s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >> 10);
        w[t] = w[t - 16] + s0 + w[t - 7] + s1;
    }

    std::uint32_t a = state[0];
    std::uint32_t b = state[1];
    std::uint32_t c = state[2];
    std::uint32_t d = state[3];
    std::uint32_t e = state[4];
    std::uint32_t f = state[5];
    std::uint32_t g = state[6];
    std::uint32_t h = state[7];
    for (int t = 0; t < 64; ++t) {
        const std::uint32_t big_sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const std::uint32_t choice = (e & f) ^ (~e & g);
        const std::uint32_t temp1 = h + big_sigma1 + choice + kRoundConstants[t] + w[t];
        const std::uint32_t big_sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        const std::uint32_t temp2 = big_sigma0 + majority;
        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
}

}  // namespace

std::string sha256_hex(std::string_view bytes) {
    std::array<std::uint32_t, 8> state = kInitialState;
    const auto* data = reinterpret_cast<const unsigned char*>(bytes.data());
    const std::size_t size = bytes.size();

    std::size_t offset = 0;
    for (; offset + 64 <= size; offset += 64) {
        compress(state, data + offset);
    }

    // Padding (§5.1.1): a single 1 bit, zeros up to 56 mod 64, then the bit length big-endian
    // in the last eight bytes - one or two more blocks.
    unsigned char tail[128] = {};
    const std::size_t rest = size - offset;
    std::memcpy(tail, data + offset, rest);
    tail[rest] = 0x80;
    const std::size_t padded = rest < 56 ? 64 : 128;
    const std::uint64_t bit_length = static_cast<std::uint64_t>(size) * 8;
    for (int i = 0; i < 8; ++i) {
        tail[padded - 1 - i] = static_cast<unsigned char>(bit_length >> (8 * i));
    }
    compress(state, tail);
    if (padded == 128) {
        compress(state, tail + 64);
    }

    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    hex.reserve(64);
    for (const std::uint32_t word : state) {
        for (int shift = 28; shift >= 0; shift -= 4) {
            hex.push_back(kHex[(word >> shift) & 0xF]);
        }
    }
    return hex;
}

std::string ai_fingerprint(std::string_view address, std::string_view key, std::string_view model) {
    std::string material;
    material.reserve(address.size() + key.size() + model.size() + 2);
    material.append(address);
    material.push_back('\0');
    material.append(key);
    material.push_back('\0');
    material.append(model);
    return sha256_hex(material);
}

}  // namespace mfbe::util
