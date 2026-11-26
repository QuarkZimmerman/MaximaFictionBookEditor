// Maxima Library domain validation, endpoint builders, and verification fingerprint (feature 021).
#pragma once

#include <string>
#include <string_view>

namespace mfbe::lookup {

inline constexpr std::string_view kDefaultMaximaLibraryDomain = "https://maxima-library.com";
inline constexpr std::size_t kMaxDomainLength = 2048;

struct MaximaDomainCheckResult {
    bool ok = false;
    // Empty on success; otherwise "invalidDomain" or "httpsRequired".
    std::string code;
    // Canonical lower-cased scheme/host, trimmed, trailing '/' removed.
    std::string normalized_domain;
    // Lower-cased host (without brackets for IPv6), useful for logging without paths/secrets.
    std::string host;
};

// Trims, normalizes, and validates a Maxima Library base URL. Remote non-local hosts require
// https://; http:// is permitted strictly for loopback (localhost, 127.0.0.0/8, [::1]) and .onion.
MaximaDomainCheckResult normalize_and_validate_domain(std::string_view raw);

// Builds POST endpoint `<normalized_domain>/index.php?option=com_maxlib&controller=lookupv2`.
std::string build_lookup_v2_endpoint(std::string_view normalized_domain);

// Builds external token settings URL
// `<normalized_domain>/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token`.
std::string build_token_page_url(std::string_view normalized_domain);

// Returns SHA-256 hex digest of `normalized_domain + '\0' + plaintext_token`.
std::string compute_verified_fingerprint(std::string_view normalized_domain,
                                         std::string_view plaintext_token);

// True if `fp` is exactly 64 lower-case hexadecimal characters.
bool is_valid_fingerprint_hex(std::string_view fp);

}  // namespace mfbe::lookup
