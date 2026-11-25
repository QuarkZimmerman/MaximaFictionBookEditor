// Uniform AES-256-GCM encrypted storage for Maxima Library Lookup Service v2 Access Token
// (feature 021, data-model.md §2). Keeps token ciphertext in `<dataDir>/maxima-lookup-token.json`
// and its 32-byte random key in `<dataDir>/maxima-lookup.key` (0600 on POSIX), separate from
// settings.json and without OS keyring popups.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>

namespace mfbe::lookup {

inline constexpr std::size_t kLookupAesKeyBytes = 32;
inline constexpr std::size_t kLookupAesIvBytes = 12;
inline constexpr std::size_t kLookupAesTagBytes = 16;
inline constexpr std::string_view kLookupTokenAad = "maxima-lookup-token-v1";

enum class MaximaLookupTokenReadState { absent, ok, unreadable };

struct MaximaLookupTokenReadResult {
    MaximaLookupTokenReadState state = MaximaLookupTokenReadState::absent;
    // Plaintext token strictly in memory when state == ok; never log.
    std::string token;
};

// Low-level NIST SP 800-38D AES-256-GCM + CSPRNG primitives (implemented via Windows CNG bcrypt
// on Windows and OpenSSL libcrypto on Linux/macOS; exposed so Catch2 tests can verify NIST KATs).
bool aes256_gcm_random_bytes(std::uint8_t* out, std::size_t len);
bool aes256_gcm_encrypt(const std::array<std::uint8_t, kLookupAesKeyBytes>& key,
                        const std::array<std::uint8_t, kLookupAesIvBytes>& iv, std::string_view aad,
                        std::string_view plaintext, std::string& ciphertext_out,
                        std::array<std::uint8_t, kLookupAesTagBytes>& tag_out);
bool aes256_gcm_decrypt(const std::array<std::uint8_t, kLookupAesKeyBytes>& key,
                        const std::array<std::uint8_t, kLookupAesIvBytes>& iv, std::string_view aad,
                        std::string_view ciphertext,
                        const std::array<std::uint8_t, kLookupAesTagBytes>& tag,
                        std::string& plaintext_out);

class MaximaLookupTokenStore {
public:
    explicit MaximaLookupTokenStore(std::filesystem::path data_dir);

    std::filesystem::path token_file_path() const;
    std::filesystem::path key_file_path() const;

    // Reads and authenticates the stored token. Never throws; returns absent or unreadable safely.
    MaximaLookupTokenReadResult load() const;

    // Generates a 32-byte key if absent (0600 on POSIX), encrypts `plaintext_token` with a fresh
    // random 12-byte IV, and writes `maxima-lookup-token.json` atomically (0600 on POSIX).
    // Returns false and logs an opaque error (never the token) on I/O or crypto failure.
    bool save(std::string_view plaintext_token) const;

    // Removes `maxima-lookup-token.json` if present (leaves keyfile untouched or removes if desired).
    bool remove() const;

private:
    std::filesystem::path data_dir_;
};

}  // namespace mfbe::lookup
