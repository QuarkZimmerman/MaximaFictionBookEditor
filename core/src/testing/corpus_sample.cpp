// CPython-compatible seeded sampling of the book corpus. See mfbe/corpus_sample.hpp.
#include <mfbe/corpus_sample.hpp>

#include <algorithm>
#include <cctype>
#include <system_error>

namespace mfbe::corpus {
namespace {

namespace fs = std::filesystem;

constexpr std::uint32_t kMatrixA = 0x9908b0dfU;
constexpr std::uint32_t kUpperMask = 0x80000000U;
constexpr std::uint32_t kLowerMask = 0x7fffffffU;
constexpr int kM = 397;

int bit_length(std::uint64_t n) {
    int bits = 0;
    while (n != 0) {
        ++bits;
        n >>= 1;
    }
    return bits;
}

std::string lower_ext(const fs::path& p) {
    std::string ext = p.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return ext;
}

std::vector<fs::directory_entry> sorted_dirs(const fs::path& parent) {
    std::vector<fs::directory_entry> dirs;
    std::error_code ec;
    for (fs::directory_iterator it(parent, ec), end; !ec && it != end; it.increment(ec)) {
        std::error_code dir_ec;
        if (it->is_directory(dir_ec)) {
            dirs.push_back(*it);
        }
    }
    std::sort(dirs.begin(), dirs.end(),
              [](const fs::directory_entry& a, const fs::directory_entry& b) {
                  return a.path().filename().string() < b.path().filename().string();
              });
    return dirs;
}

}  // namespace

PyRandom::PyRandom(std::uint64_t seed) {
    // CPython: key = abs(seed) as 32-bit little-endian words (at least one word).
    std::vector<std::uint32_t> key;
    do {
        key.push_back(static_cast<std::uint32_t>(seed & 0xffffffffU));
        seed >>= 32;
    } while (seed != 0);
    init_by_array(key);
}

void PyRandom::init_genrand(std::uint32_t s) {
    mt_[0] = s;
    for (mti_ = 1; mti_ < kN; ++mti_) {
        mt_[static_cast<std::size_t>(mti_)] =
            1812433253U * (mt_[static_cast<std::size_t>(mti_ - 1)] ^
                           (mt_[static_cast<std::size_t>(mti_ - 1)] >> 30)) +
            static_cast<std::uint32_t>(mti_);
    }
}

void PyRandom::init_by_array(const std::vector<std::uint32_t>& key) {
    init_genrand(19650218U);
    std::size_t i = 1;
    std::size_t j = 0;
    const std::size_t key_length = key.size();
    std::size_t k = std::max<std::size_t>(kN, key_length);
    for (; k > 0; --k) {
        mt_[i] = (mt_[i] ^ ((mt_[i - 1] ^ (mt_[i - 1] >> 30)) * 1664525U)) + key[j] +
                 static_cast<std::uint32_t>(j);
        ++i;
        ++j;
        if (i >= static_cast<std::size_t>(kN)) {
            mt_[0] = mt_[kN - 1];
            i = 1;
        }
        if (j >= key_length) {
            j = 0;
        }
    }
    for (k = kN - 1; k > 0; --k) {
        mt_[i] = (mt_[i] ^ ((mt_[i - 1] ^ (mt_[i - 1] >> 30)) * 1566083941U)) -
                 static_cast<std::uint32_t>(i);
        ++i;
        if (i >= static_cast<std::size_t>(kN)) {
            mt_[0] = mt_[kN - 1];
            i = 1;
        }
    }
    mt_[0] = 0x80000000U;
    mti_ = kN;
}

std::uint32_t PyRandom::genrand_uint32() {
    static const std::uint32_t mag01[2] = {0x0U, kMatrixA};
    std::uint32_t y;
    if (mti_ >= kN) {
        int kk;
        for (kk = 0; kk < kN - kM; ++kk) {
            y = (mt_[static_cast<std::size_t>(kk)] & kUpperMask) |
                (mt_[static_cast<std::size_t>(kk + 1)] & kLowerMask);
            mt_[static_cast<std::size_t>(kk)] =
                mt_[static_cast<std::size_t>(kk + kM)] ^ (y >> 1) ^ mag01[y & 0x1U];
        }
        for (; kk < kN - 1; ++kk) {
            y = (mt_[static_cast<std::size_t>(kk)] & kUpperMask) |
                (mt_[static_cast<std::size_t>(kk + 1)] & kLowerMask);
            mt_[static_cast<std::size_t>(kk)] =
                mt_[static_cast<std::size_t>(kk + (kM - kN))] ^ (y >> 1) ^ mag01[y & 0x1U];
        }
        y = (mt_[kN - 1] & kUpperMask) | (mt_[0] & kLowerMask);
        mt_[kN - 1] = mt_[kM - 1] ^ (y >> 1) ^ mag01[y & 0x1U];
        mti_ = 0;
    }
    y = mt_[static_cast<std::size_t>(mti_++)];
    y ^= (y >> 11);
    y ^= (y << 7) & 0x9d2c5680U;
    y ^= (y << 15) & 0xefc60000U;
    y ^= (y >> 18);
    return y;
}

std::uint64_t PyRandom::getrandbits(int k) {
    if (k <= 0) {
        return 0;
    }
    if (k <= 32) {
        return genrand_uint32() >> (32 - k);
    }
    // CPython fills 32-bit words little-endian; the last word is truncated.
    std::uint64_t result = 0;
    int shift = 0;
    while (k > 0) {
        std::uint32_t r = genrand_uint32();
        if (k < 32) {
            r >>= (32 - k);
        }
        result |= static_cast<std::uint64_t>(r) << shift;
        shift += 32;
        k -= 32;
    }
    return result;
}

std::uint64_t PyRandom::randbelow(std::uint64_t n) {
    if (n == 0) {
        return 0;
    }
    const int k = bit_length(n);
    std::uint64_t r = getrandbits(k);
    while (r >= n) {
        r = getrandbits(k);
    }
    return r;
}

std::vector<std::string> scan_candidates(const fs::path& root, bool include_fbd,
                                         std::size_t max_scan) {
    std::vector<std::string> candidates;
    for (const auto& range : sorted_dirs(root)) {
        for (const auto& sub : sorted_dirs(range.path())) {
            for (const auto& book : sorted_dirs(sub.path())) {
                std::error_code ec;
                for (fs::directory_iterator it(book.path(), ec), end; !ec && it != end;
                     it.increment(ec)) {
                    const std::string ext = lower_ext(it->path());
                    if (ext == ".fb2" || (include_fbd && ext == ".fbd")) {
                        candidates.push_back(it->path().string());
                        if (max_scan != 0 && candidates.size() >= max_scan) {
                            return candidates;
                        }
                    }
                }
            }
        }
    }
    return candidates;
}

std::vector<std::string> sample(std::vector<std::string> candidates, std::uint64_t seed,
                                std::size_t count) {
    if (candidates.empty()) {
        return candidates;
    }
    PyRandom rng(seed);
    rng.shuffle(candidates);
    if (candidates.size() > count) {
        candidates.resize(count);
    }
    std::sort(candidates.begin(), candidates.end());
    return candidates;
}

}  // namespace mfbe::corpus
