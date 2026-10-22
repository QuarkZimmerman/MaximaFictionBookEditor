// SHA-256 (FIPS 180-4) for the AI assistant's verification fingerprint (feature 005, rpc-api
// §3.7 invariant). A project implementation rather than a library call: OpenSSL is linked on
// Linux and macOS only (Windows builds libcurl on Schannel), and the hash is needed on every
// platform by the settings store and the `ai.test` handler.
#pragma once

#include <string>
#include <string_view>

namespace mfbe::util {

// The SHA-256 digest of `bytes` as 64 lower-case hexadecimal digits.
std::string sha256_hex(std::string_view bytes);

// The fingerprint of a custom service triple: sha256_hex over the UTF-8 bytes of
// `address + '\0' + key + '\0' + model` (rpc-api §3.7, data-model §2.2). Never the key itself.
std::string ai_fingerprint(std::string_view address, std::string_view key, std::string_view model);

}  // namespace mfbe::util
