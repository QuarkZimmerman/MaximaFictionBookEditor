// Feature 014 (D7, FR-006, research R5; tasks T030, T031): the shipped fonts' coverage.

#include "pdf/coverage.hpp"

#include "pdf/fonts.hpp"

#include <mfbe/atomic_file.hpp>

#include <cstdint>
#include <map>
#include <mutex>

namespace mfbe::pdf {
namespace {

std::uint16_t u16(const std::string& b, std::size_t at) {
    if (at + 2 > b.size())
        return 0;
    return static_cast<std::uint16_t>((static_cast<unsigned char>(b[at]) << 8) |
                                      static_cast<unsigned char>(b[at + 1]));
}

std::uint32_t u32(const std::string& b, std::size_t at) {
    return (static_cast<std::uint32_t>(u16(b, at)) << 16) | u16(b, at + 2);
}

void format4(const std::string& b, std::size_t at, std::set<char32_t>& out) {
    const std::size_t segments = u16(b, at + 6) / 2;
    const std::size_t ends = at + 14;
    const std::size_t starts = ends + segments * 2 + 2;
    const std::size_t deltas = starts + segments * 2;
    const std::size_t ranges = deltas + segments * 2;
    if (ranges + segments * 2 > b.size())
        return;
    for (std::size_t s = 0; s < segments; ++s) {
        const std::uint32_t end = u16(b, ends + s * 2);
        const std::uint32_t start = u16(b, starts + s * 2);
        const std::uint16_t delta = u16(b, deltas + s * 2);
        const std::uint16_t range = u16(b, ranges + s * 2);
        for (std::uint32_t code = start; code <= end && code != 0xFFFF; ++code) {
            std::uint16_t glyph = 0;
            if (range == 0) {
                glyph = static_cast<std::uint16_t>(code + delta);
            } else {
                const std::size_t index = ranges + s * 2 + range + (code - start) * 2;
                const std::uint16_t g = u16(b, index);
                glyph = g == 0 ? 0 : static_cast<std::uint16_t>(g + delta);
            }
            if (glyph != 0)
                out.insert(static_cast<char32_t>(code));
        }
    }
}

void format12(const std::string& b, std::size_t at, std::set<char32_t>& out) {
    const std::uint32_t groups = u32(b, at + 12);
    for (std::uint32_t g = 0; g < groups; ++g) {
        const std::size_t group = at + 16 + static_cast<std::size_t>(g) * 12;
        if (group + 12 > b.size())
            return;
        const std::uint32_t start = u32(b, group);
        const std::uint32_t end = u32(b, group + 4);
        const std::uint32_t glyph = u32(b, group + 8);
        if (end < start || end > 0x10FFFF || end - start > 0x10000)
            continue;
        for (std::uint32_t code = start; code <= end; ++code) {
            if (glyph + (code - start) != 0)
                out.insert(static_cast<char32_t>(code));
        }
    }
}

std::u32string decode_utf8(const std::string& s) {
    std::u32string out;
    for (std::size_t i = 0; i < s.size();) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        int extra = c < 0x80           ? 0
                    : (c >> 5) == 0x6  ? 1
                    : (c >> 4) == 0xE  ? 2
                    : (c >> 3) == 0x1E ? 3
                                       : -1;
        if (extra < 0 || i + static_cast<std::size_t>(extra) >= s.size()) {
            ++i;
            continue;
        }
        char32_t cp = extra == 0 ? c : c & (0x3F >> extra);
        for (int k = 1; k <= extra; ++k)
            cp = (cp << 6) | (static_cast<unsigned char>(s[i + k]) & 0x3F);
        out.push_back(cp);
        i += static_cast<std::size_t>(extra) + 1;
    }
    return out;
}

bool counted(char32_t c) {
    if (c < 0x20 || (c >= 0x7F && c < 0xA0))
        return false;  // control characters
    switch (c) {
        case 0x20:
        case 0xA0:
        case 0xAD:  // soft hyphen: never drawn mid-line
        case 0x2028:
        case 0x2029:
        case 0xFEFF:
            return false;
        default:
            return !(c >= 0x200B && c <= 0x200F);  // zero-width spaces and marks
    }
}

}  // namespace

std::set<char32_t> font_coverage(const std::filesystem::path& font_file) {
    std::set<char32_t> out;
    std::string b;
    try {
        b = atomic_file::read_file(font_file);
    } catch (const std::exception&) {
        return out;
    }
    const std::size_t tables = u16(b, 4);
    std::size_t cmap = 0;
    for (std::size_t i = 0; i < tables && 12 + i * 16 + 16 <= b.size(); ++i) {
        const std::size_t record = 12 + i * 16;
        if (b.compare(record, 4, "cmap") == 0)
            cmap = u32(b, record + 8);
    }
    if (cmap == 0 || cmap + 4 > b.size())
        return out;
    const std::size_t subtables = u16(b, cmap + 2);
    for (std::size_t i = 0; i < subtables; ++i) {
        const std::size_t record = cmap + 4 + i * 8;
        const std::size_t at = cmap + u32(b, record + 4);
        const std::uint16_t platform = u16(b, record);
        const std::uint16_t encoding = u16(b, record + 2);
        // Unicode subtables only (Unicode platform, or Windows Unicode BMP / full repertoire).
        if (!(platform == 0 || (platform == 3 && (encoding == 1 || encoding == 10))))
            continue;
        const std::uint16_t format = u16(b, at);
        if (format == 4)
            format4(b, at, out);
        else if (format == 12)
            format12(b, at, out);
    }
    return out;
}

std::u32string uncovered_characters(const std::vector<std::string>& texts,
                                    const std::filesystem::path& fonts_dir, std::size_t limit) {
    // The shipped fonts' coverage, read once per folder.
    static std::mutex mutex;
    static std::map<std::filesystem::path, std::set<char32_t>> cache;
    std::set<char32_t> covered;
    {
        std::lock_guard lock(mutex);
        auto it = cache.find(fonts_dir);
        if (it == cache.end()) {
            std::set<char32_t> all;
            for (const ShippedFamily& family : shipped_families(fonts_dir)) {
                for (const auto& [style, file] : family.styles) {
                    const auto chars = font_coverage(fonts_dir / file);
                    all.insert(chars.begin(), chars.end());
                }
            }
            it = cache.emplace(fonts_dir, std::move(all)).first;
        }
        covered = it->second;
    }
    std::u32string out;
    std::set<char32_t> seen;
    for (const std::string& text : texts) {
        for (char32_t c : decode_utf8(text)) {
            if (!counted(c) || covered.contains(c) || !seen.insert(c).second)
                continue;
            out.push_back(c);
            if (out.size() >= limit)
                return out;
        }
    }
    return out;
}

std::string utf8(const std::u32string& text) {
    std::string out;
    for (char32_t c : text) {
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
    }
    return out;
}

}  // namespace mfbe::pdf
