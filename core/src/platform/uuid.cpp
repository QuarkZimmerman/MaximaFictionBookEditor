// UUID v4 generation via stduuid (T015).
#include <mfbe/platform.hpp>

#include <uuid.h>

#include <array>
#include <cctype>
#include <random>

namespace mfbe::uuid {

std::string generate_v4() {
    thread_local std::mt19937 engine = [] {
        std::random_device rd;
        std::array<std::uint32_t, std::mt19937::state_size> seed_data{};
        for (auto& v : seed_data) {
            v = rd();
        }
        std::seed_seq seq(seed_data.begin(), seed_data.end());
        return std::mt19937(seq);
    }();
    uuids::basic_uuid_random_generator<std::mt19937> gen(engine);
    return uuids::to_string(gen());
}

bool is_valid(std::string_view text) {
    if (text.size() != 36) {
        return false;
    }
    for (std::size_t i = 0; i < text.size(); ++i) {
        const char c = text[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') {
                return false;
            }
        } else if (!std::isxdigit(static_cast<unsigned char>(c))) {
            return false;
        }
    }
    return true;
}

}  // namespace mfbe::uuid
