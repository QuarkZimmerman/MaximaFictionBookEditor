// Deterministic corpus sampler compatible with tests/corpus/sample.py (test hook support).
//
// Reproduces CPython's `random.Random(seed).shuffle(candidates)` bit for bit (MT19937 seeded
// through init_by_array, `_randbelow` via getrandbits) so a C++ caller and the Python tool
// select the same books for the same (seed, count).
#pragma once

#include <array>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace mfbe::corpus {

// CPython-compatible Mersenne Twister.
class PyRandom {
public:
    explicit PyRandom(std::uint64_t seed);
    std::uint32_t genrand_uint32();
    std::uint64_t getrandbits(int k);  // k in 1..64
    std::uint64_t randbelow(std::uint64_t n);
    template <typename T>
    void shuffle(std::vector<T>& items) {
        if (items.size() < 2) {
            return;
        }
        for (std::size_t i = items.size() - 1; i > 0; --i) {
            const std::size_t j = static_cast<std::size_t>(randbelow(i + 1));
            std::swap(items[i], items[j]);
        }
    }

private:
    void init_genrand(std::uint32_t s);
    void init_by_array(const std::vector<std::uint32_t>& key);
    static constexpr int kN = 624;
    std::array<std::uint32_t, kN> mt_{};
    int mti_ = kN + 1;
};

// Walks <root>/<range>/<sub>/<id>/ exactly like sample.py (sorted ranges/subs/books,
// directory order inside a book folder) and returns candidate files (.fb2, optionally .fbd).
// `max_scan` = 0 means the whole library.
std::vector<std::string> scan_candidates(const std::filesystem::path& root, bool include_fbd,
                                         std::size_t max_scan = 0);

// Seeded shuffle + first `count` + sorted, like sample.py.
std::vector<std::string> sample(std::vector<std::string> candidates, std::uint64_t seed,
                                std::size_t count);

}  // namespace mfbe::corpus
