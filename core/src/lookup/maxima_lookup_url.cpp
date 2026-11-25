#include <mfbe/maxima_lookup_url.hpp>

#include "util/sha256.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>

namespace mfbe::lookup {

namespace {

bool is_ascii_space(unsigned char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

std::string_view trim_ascii(std::string_view s) {
    while (!s.empty() && is_ascii_space(static_cast<unsigned char>(s.front()))) {
        s.remove_prefix(1);
    }
    while (!s.empty() && is_ascii_space(static_cast<unsigned char>(s.back()))) {
        s.remove_suffix(1);
    }
    return s;
}

std::string to_lower_ascii(std::string_view s) {
    std::string out(s);
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

bool is_ipv4_loopback(std::string_view host) {
    int parts[4] = {0, 0, 0, 0};
    std::size_t pos = 0;
    for (int i = 0; i < 4; ++i) {
        const std::size_t dot = (i < 3) ? host.find('.', pos) : std::string_view::npos;
        if (i < 3 && dot == std::string_view::npos) {
            return false;
        }
        std::string_view seg = (dot == std::string_view::npos)
                                   ? host.substr(pos)
                                   : host.substr(pos, dot - pos);
        if (seg.empty() || seg.size() > 3) {
            return false;
        }
        int val = -1;
        auto [ptr, ec] = std::from_chars(seg.data(), seg.data() + seg.size(), val);
        if (ec != std::errc{} || ptr != seg.data() + seg.size() || val < 0 || val > 255) {
            return false;
        }
        parts[i] = val;
        if (i < 3) {
            pos = dot + 1;
        }
    }
    return parts[0] == 127;
}

bool is_loopback_or_onion_host(std::string_view host_lower) {
    if (host_lower == "localhost" || host_lower == "::1" || is_ipv4_loopback(host_lower)) {
        return true;
    }
    constexpr std::string_view kOnion = ".onion";
    if (host_lower.size() > kOnion.size() &&
        host_lower.substr(host_lower.size() - kOnion.size()) == kOnion &&
        host_lower[host_lower.size() - kOnion.size() - 1] != '.') {
        return true;
    }
    return false;
}

bool is_valid_host_chars(std::string_view host) {
    if (host.empty()) {
        return false;
    }
    for (unsigned char c : host) {
        if (std::isalnum(c) || c == '-' || c == '.' || c == ':') {
            continue;
        }
        return false;
    }
    return true;
}

}  // namespace

MaximaDomainCheckResult normalize_and_validate_domain(std::string_view raw) {
    MaximaDomainCheckResult res;
    std::string_view s = trim_ascii(raw);
    if (s.empty() || s.size() > kMaxDomainLength) {
        res.code = "invalidDomain";
        return res;
    }
    for (unsigned char c : s) {
        if (c < 0x20 || c == 0x7f || is_ascii_space(c)) {
            res.code = "invalidDomain";
            return res;
        }
    }
    if (s.find('?') != std::string_view::npos || s.find('#') != std::string_view::npos) {
        res.code = "invalidDomain";
        return res;
    }

    const std::size_t sep = s.find("://");
    if (sep == std::string_view::npos) {
        res.code = "invalidDomain";
        return res;
    }
    const std::string scheme = to_lower_ascii(s.substr(0, sep));
    if (scheme != "https" && scheme != "http") {
        res.code = "invalidDomain";
        return res;
    }

    const std::string_view rest = s.substr(sep + 3);
    const std::size_t slash = rest.find('/');
    const std::string_view authority =
        (slash == std::string_view::npos) ? rest : rest.substr(0, slash);
    std::string_view path = (slash == std::string_view::npos) ? std::string_view{} : rest.substr(slash);

    if (authority.empty() || authority.find('@') != std::string_view::npos) {
        res.code = "invalidDomain";
        return res;
    }

    std::string host_lower;
    std::string_view port_part;
    bool is_ipv6_literal = false;
    if (authority.front() == '[') {
        const std::size_t close = authority.find(']');
        if (close == std::string_view::npos || close <= 1) {
            res.code = "invalidDomain";
            return res;
        }
        host_lower = to_lower_ascii(authority.substr(1, close - 1));
        is_ipv6_literal = true;
        if (!is_valid_host_chars(host_lower) || host_lower.find(':') == std::string::npos) {
            res.code = "invalidDomain";
            return res;
        }
        if (close + 1 < authority.size()) {
            if (authority[close + 1] != ':') {
                res.code = "invalidDomain";
                return res;
            }
            port_part = authority.substr(close + 2);
        }
    } else {
        const std::size_t colon = authority.rfind(':');
        if (colon != std::string_view::npos) {
            host_lower = to_lower_ascii(authority.substr(0, colon));
            port_part = authority.substr(colon + 1);
        } else {
            host_lower = to_lower_ascii(authority);
        }
        if (!is_valid_host_chars(host_lower) || host_lower.find(':') != std::string::npos ||
            host_lower.front() == '.' || host_lower.back() == '.') {
            res.code = "invalidDomain";
            return res;
        }
    }

    if (!port_part.empty()) {
        if (port_part.size() > 5) {
            res.code = "invalidDomain";
            return res;
        }
        int port = 0;
        auto [ptr, ec] = std::from_chars(port_part.data(), port_part.data() + port_part.size(), port);
        if (ec != std::errc{} || ptr != port_part.data() + port_part.size() || port < 1 ||
            port > 65535) {
            res.code = "invalidDomain";
            return res;
        }
    } else if ((!is_ipv6_literal && authority.back() == ':') ||
               (is_ipv6_literal && authority.size() > host_lower.size() + 2 &&
                authority.back() == ':')) {
        res.code = "invalidDomain";
        return res;
    }

    if (scheme == "http" && !is_loopback_or_onion_host(host_lower)) {
        res.code = "httpsRequired";
        res.host = host_lower;
        return res;
    }

    while (!path.empty() && path.back() == '/') {
        path.remove_suffix(1);
    }

    std::string normalized = scheme + "://";
    if (is_ipv6_literal) {
        normalized += "[" + host_lower + "]";
    } else {
        normalized += host_lower;
    }
    if (!port_part.empty()) {
        normalized += ":";
        normalized.append(port_part);
    }
    normalized.append(path);

    res.ok = true;
    res.normalized_domain = std::move(normalized);
    res.host = std::move(host_lower);
    return res;
}

std::string build_lookup_v2_endpoint(std::string_view normalized_domain) {
    while (!normalized_domain.empty() && normalized_domain.back() == '/') {
        normalized_domain.remove_suffix(1);
    }
    std::string out(normalized_domain);
    out += "/index.php?option=com_maxlib&controller=lookupv2";
    return out;
}

std::string build_token_page_url(std::string_view normalized_domain) {
    while (!normalized_domain.empty() && normalized_domain.back() == '/') {
        normalized_domain.remove_suffix(1);
    }
    std::string out(normalized_domain);
    out += "/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token";
    return out;
}

std::string compute_verified_fingerprint(std::string_view normalized_domain,
                                         std::string_view plaintext_token) {
    std::string input;
    input.reserve(normalized_domain.size() + 1 + plaintext_token.size());
    input.append(normalized_domain);
    input.push_back('\0');
    input.append(plaintext_token);
    return util::sha256_hex(input);
}

bool is_valid_fingerprint_hex(std::string_view fp) {
    if (fp.size() != 64) {
        return false;
    }
    for (unsigned char c : fp) {
        const bool is_digit = c >= '0' && c <= '9';
        const bool is_lower_hex = c >= 'a' && c <= 'f';
        if (!is_digit && !is_lower_hex) {
            return false;
        }
    }
    return true;
}

}  // namespace mfbe::lookup
