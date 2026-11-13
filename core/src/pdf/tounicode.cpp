// Feature 014 (D5, research R3 step 3, tasks T025): ligature characters in ToUnicode CMaps.

#include "pdf/tounicode.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <sstream>
#include <vector>

namespace mfbe::pdf {
namespace {

// Unicode's compatibility decompositions of the Latin ligatures (U+FB00..U+FB06), as UTF-16 hex.
std::optional<std::string> letters(std::uint32_t code) {
    switch (code) {
        case 0xFB00:
            return "00660066";
        case 0xFB01:
            return "00660069";
        case 0xFB02:
            return "0066006C";
        case 0xFB03:
            return "006600660069";
        case 0xFB04:
            return "00660066006C";
        case 0xFB05:
        case 0xFB06:
            return "00730074";
        default:
            return std::nullopt;
    }
}

// The hex strings <...> of a line, in order.
std::vector<std::string> hex_tokens(const std::string& line) {
    std::vector<std::string> out;
    std::size_t at = 0;
    while ((at = line.find('<', at)) != std::string::npos) {
        const std::size_t end = line.find('>', at);
        if (end == std::string::npos)
            break;
        out.push_back(line.substr(at + 1, end - at - 1));
        at = end + 1;
    }
    return out;
}

std::optional<std::uint32_t> hex_value(const std::string& hex, std::size_t max_digits) {
    if (hex.empty() || hex.size() > max_digits)
        return std::nullopt;
    for (char c : hex) {
        if (!std::isxdigit(static_cast<unsigned char>(c)))
            return std::nullopt;
    }
    return static_cast<std::uint32_t>(std::stoul(hex, nullptr, 16));
}

std::string hex_of(std::uint32_t value, std::size_t digits) {
    char buffer[16];
    std::snprintf(buffer, sizeof buffer, "%0*X", static_cast<int>(digits), value);
    return buffer;
}

void write_section(std::string& out, const char* kind, const std::vector<std::string>& entries) {
    // A CMap section holds at most 100 entries (Adobe Technical Note #5411).
    for (std::size_t i = 0; i < entries.size(); i += 100) {
        const std::size_t n = std::min<std::size_t>(100, entries.size() - i);
        out += std::to_string(n) + " begin" + kind + "\n";
        for (std::size_t j = i; j < i + n; ++j)
            out += entries[j] + "\n";
        out += std::string("end") + kind + "\n";
    }
}

}  // namespace

std::string decompose_ligatures(const std::string& cmap) {
    std::istringstream in(cmap);
    std::string line;
    std::string out;
    enum class Section { none, bfchar, bfrange } section = Section::none;
    std::vector<std::string> chars;
    std::vector<std::string> ranges;
    std::vector<std::string> split;  // bfchar entries written out of ranges
    bool changed = false;
    while (std::getline(in, line)) {
        if (line.find("beginbfchar") != std::string::npos) {
            section = Section::bfchar;
            chars.clear();
            continue;
        }
        if (line.find("beginbfrange") != std::string::npos) {
            section = Section::bfrange;
            ranges.clear();
            continue;
        }
        if (line.find("endbfchar") != std::string::npos) {
            write_section(out, "bfchar", chars);
            section = Section::none;
            continue;
        }
        if (line.find("endbfrange") != std::string::npos) {
            write_section(out, "bfrange", ranges);
            section = Section::none;
            continue;
        }
        if (section == Section::bfchar) {
            const auto tokens = hex_tokens(line);
            if (tokens.size() == 2) {
                if (const auto code = hex_value(tokens[1], 4); code && letters(*code)) {
                    chars.push_back("<" + tokens[0] + "> <" + *letters(*code) + ">");
                    changed = true;
                    continue;
                }
            }
            chars.push_back(line);
            continue;
        }
        if (section == Section::bfrange) {
            const auto tokens = hex_tokens(line);
            if (tokens.size() == 3 && line.find('[') == std::string::npos) {
                const auto lo = hex_value(tokens[0], 8);
                const auto hi = hex_value(tokens[1], 8);
                const auto start = hex_value(tokens[2], 4);
                if (lo && hi && start && *hi >= *lo && *hi - *lo < 0x10000) {
                    const std::uint32_t last = *start + (*hi - *lo);
                    if (last >= 0xFB00 && *start <= 0xFB06) {
                        for (std::uint32_t g = *lo; g <= *hi; ++g) {
                            const std::uint32_t u = *start + (g - *lo);
                            const auto mapped = letters(u);
                            split.push_back("<" + hex_of(g, tokens[0].size()) + "> <" +
                                            (mapped ? *mapped : hex_of(u, 4)) + ">");
                        }
                        changed = true;
                        continue;
                    }
                }
            }
            ranges.push_back(line);
            continue;
        }
        if (!split.empty() && line.find("endcmap") != std::string::npos) {
            write_section(out, "bfchar", split);
            split.clear();
        }
        out += line + "\n";
    }
    return changed ? out : cmap;
}

}  // namespace mfbe::pdf
