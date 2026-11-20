// Feature 017 (D33, DP-11). See mfbe/case_fold.hpp.

#include <mfbe/case_fold.hpp>

namespace mfbe::text {
namespace {

char32_t lower(char32_t c) {
    if (c >= 'A' && c <= 'Z')
        return c + 0x20;
    if ((c >= 0xC0 && c <= 0xDE && c != 0xD7))
        return c + 0x20;             // Latin-1
    if (c >= 0x100 && c <= 0x17F) {  // Latin Extended-A pairs
        if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E))
            return (c % 2 == 1) ? c + 1 : c;
        if (c == 0x130 || c == 0x131 || c == 0x138 || c == 0x149 || c == 0x17F)
            return c;
        if (c == 0x178)
            return 0xFF;
        return (c % 2 == 0) ? c + 1 : c;
    }
    if (c >= 0x391 && c <= 0x3AB && c != 0x3A2)
        return c + 0x20;  // Greek
    if (c >= 0x400 && c <= 0x40F)
        return c + 0x50;  // Cyrillic Ѐ-Џ
    if (c >= 0x410 && c <= 0x42F)
        return c + 0x20;  // Cyrillic А-Я
    if ((c >= 0x460 && c <= 0x481) || (c >= 0x48A && c <= 0x4BF) || (c >= 0x4D0 && c <= 0x52F)) {
        return (c % 2 == 0) ? c + 1 : c;
    }
    return c;
}

}  // namespace

std::string fold_case(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size();) {
        const auto b0 = static_cast<unsigned char>(s[i]);
        std::size_t len = b0 < 0x80           ? 1
                          : (b0 >> 5) == 0x6  ? 2
                          : (b0 >> 4) == 0xE  ? 3
                          : (b0 >> 3) == 0x1E ? 4
                                              : 0;
        if (len == 0 || i + len > s.size()) {
            out.push_back(s[i++]);
            continue;
        }
        char32_t c = len == 1   ? b0
                     : len == 2 ? (b0 & 0x1Fu)
                     : len == 3 ? (b0 & 0x0Fu)
                                : (b0 & 0x07u);
        bool valid = true;
        for (std::size_t k = 1; k < len; ++k) {
            const auto b = static_cast<unsigned char>(s[i + k]);
            if ((b & 0xC0u) != 0x80u) {
                valid = false;
                break;
            }
            c = (c << 6) | (b & 0x3Fu);
        }
        if (!valid) {
            out.push_back(s[i++]);
            continue;
        }
        c = lower(c);
        if (c < 0x80) {
            out.push_back(static_cast<char>(c));
        } else if (c < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (c >> 6)));
            out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
        } else if (c < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (c >> 12)));
            out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (c >> 18)));
            out.push_back(static_cast<char>(0x80 | ((c >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
        }
        i += len;
    }
    return out;
}

}  // namespace mfbe::text
