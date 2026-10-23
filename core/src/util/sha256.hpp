// SHA-256 (FIPS 180-4) and the fingerprint of the custom AI service entry (feature 005, T012;
// rpc-api §3.7 invariant, review decision A2).
//
// The settings keep `ai.customVerified.fingerprint` = SHA-256 over the stored triple
// `address \0 key \0 model`, so that a verified entry turns red again the moment the user
// edits any of the three, and a client cannot fake a green state. The hash is written here
// rather than taken from a library: OpenSSL is not linked on Windows (libcurl uses Schannel
// there) and the core must not depend on a TLS library for a 64-character digest.
#pragma once

#include <string>
#include <string_view>

namespace mfbe::util {

// SHA-256 of `bytes` as 64 lower-case hexadecimal digits.
std::string sha256_hex(std::string_view bytes);

// The fingerprint of a custom service triple: sha256_hex(address + '\0' + key + '\0' + model)
// over the UTF-8 bytes as stored (no trimming, no normalisation).
std::string ai_fingerprint(std::string_view address, std::string_view key, std::string_view model);

}  // namespace mfbe::util
