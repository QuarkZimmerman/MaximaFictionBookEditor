// The AI assistant's address rule (feature 005). See mfbe/ai_address.hpp.
#include <mfbe/ai_address.hpp>
#include <mfbe/unicode.hpp>

#include <algorithm>
#include <cctype>
#include <string>

namespace mfbe::ai {
namespace {

bool is_control(char32_t cp) {
    return cp < 0x20 || cp == 0x7F || (cp >= 0x80 && cp <= 0x9F);
}

bool is_space(char32_t cp) {
    return cp == 0x20 || cp == 0xA0 || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200A) ||
           cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000 ||
           cp == 0xFEFF;
}

std::string ascii_lower(std::string_view text) {
    std::string out(text);
    for (auto& c : out) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return out;
}

bool is_hostname_char(char c) {
    const auto u = static_cast<unsigned char>(c);
    return std::isalnum(u) != 0 || c == '-' || c == '.';
}

bool is_ipv6_char(char c) {
    const auto u = static_cast<unsigned char>(c);
    return std::isxdigit(u) != 0 || c == ':' || c == '.';
}

bool is_port(std::string_view text) {
    if (text.empty() || text.size() > 5 ||
        !std::all_of(text.begin(), text.end(),
                     [](unsigned char c) { return std::isdigit(c) != 0; })) {
        return false;
    }
    const int port = std::stoi(std::string(text));
    return port >= 1 && port <= 65535;
}

// Decimal octet of an IPv4 literal: 1-3 digits, 0-255.
bool octet(std::string_view text, int& value) {
    if (text.empty() || text.size() > 3 ||
        !std::all_of(text.begin(), text.end(),
                     [](unsigned char c) { return std::isdigit(c) != 0; })) {
        return false;
    }
    value = std::stoi(std::string(text));
    return value <= 255;
}

bool is_loopback_ipv4(std::string_view hostname) {
    int octets[4];
    std::size_t start = 0;
    for (int i = 0; i < 4; ++i) {
        const std::size_t dot = i == 3 ? hostname.size() : hostname.find('.', start);
        if (dot == std::string_view::npos) {
            return false;
        }
        if (!octet(hostname.substr(start, dot - start), octets[i])) {
            return false;
        }
        start = dot + 1;
    }
    return octets[0] == 127;
}

}  // namespace

bool has_control_characters(std::string_view text) {
    for (char32_t cp : unicode::decode_utf8(text)) {
        if (is_control(cp)) {
            return true;
        }
    }
    return false;
}

bool has_whitespace_or_control(std::string_view text) {
    for (char32_t cp : unicode::decode_utf8(text)) {
        if (is_control(cp) || is_space(cp)) {
            return true;
        }
    }
    return false;
}

bool is_local_hostname(std::string_view hostname) {
    std::string name = ascii_lower(hostname);
    if (name.size() >= 2 && name.front() == '[' && name.back() == ']') {
        name = name.substr(1, name.size() - 2);
    }
    return name == "localhost" || name == "::1" || is_loopback_ipv4(name);
}

std::optional<ParsedAddress> parse_address(std::string_view address) {
    if (address.empty() || !unicode::is_valid_utf8(address) ||
        unicode::length(address) > kMaxAddressLength || has_whitespace_or_control(address)) {
        return std::nullopt;
    }
    const std::size_t scheme_end = address.find("://");
    if (scheme_end == std::string_view::npos) {
        return std::nullopt;
    }
    const std::string scheme = ascii_lower(address.substr(0, scheme_end));
    if (scheme != "http" && scheme != "https") {
        return std::nullopt;
    }
    const std::string_view rest = address.substr(scheme_end + 3);
    if (rest.find_first_of("?#") != std::string_view::npos) {
        return std::nullopt;  // no query, no fragment
    }
    const std::size_t slash = rest.find('/');
    const std::string_view authority = rest.substr(0, slash);
    if (authority.empty() || authority.find('@') != std::string_view::npos) {
        return std::nullopt;  // a host is required; user information is refused
    }
    std::string hostname;
    bool has_port = false;
    std::string_view port;
    if (authority.front() == '[') {
        const std::size_t close = authority.find(']');
        if (close == std::string_view::npos || close < 3) {
            return std::nullopt;
        }
        const std::string_view literal = authority.substr(1, close - 1);
        if (!std::all_of(literal.begin(), literal.end(), is_ipv6_char) ||
            literal.find(':') == std::string_view::npos) {
            return std::nullopt;
        }
        const std::string_view after = authority.substr(close + 1);
        if (!after.empty()) {
            if (after.front() != ':') {
                return std::nullopt;
            }
            has_port = true;
            port = after.substr(1);
        }
        hostname = ascii_lower(literal);
    } else {
        const std::size_t colon = authority.find(':');
        const std::string_view name = authority.substr(0, colon);
        if (name.empty() || !std::all_of(name.begin(), name.end(), is_hostname_char) ||
            name.front() == '.' || name.back() == '.' ||
            name.find("..") != std::string_view::npos) {
            return std::nullopt;
        }
        if (colon != std::string_view::npos) {
            has_port = true;
            port = authority.substr(colon + 1);
        }
        hostname = ascii_lower(name);
    }
    if (has_port && !is_port(port)) {
        return std::nullopt;
    }
    ParsedAddress parsed;
    parsed.scheme = scheme;
    parsed.host = std::string(authority);
    parsed.hostname = std::move(hostname);
    parsed.plain_http = scheme == "http";
    parsed.local = is_local_hostname(parsed.hostname);
    std::string base(address);
    while (base.size() > scheme_end + 3 + authority.size() && base.back() == '/') {
        base.pop_back();
    }
    parsed.base = std::move(base);
    return parsed;
}

}  // namespace mfbe::ai
