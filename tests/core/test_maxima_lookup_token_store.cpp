// Feature 021 (T010): Uniform AES-256-GCM primitives (NIST SP 800-38D KATs) and
// MaximaLookupTokenStore persistence, 0600 permissions, zero plaintext leakage, and tamper safety.
#include "test_support.hpp"

#include <mfbe/maxima_lookup_token_store.hpp>

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#ifndef _WIN32
#include <sys/stat.h>
#endif

using namespace mfbe::lookup;
using nlohmann::json;

namespace {

std::vector<std::uint8_t> from_hex(std::string_view hex) {
    std::vector<std::uint8_t> out;
    out.reserve(hex.size() / 2);
    auto nibble = [](char c) -> std::uint8_t {
        if (c >= '0' && c <= '9') return static_cast<std::uint8_t>(c - '0');
        if (c >= 'a' && c <= 'f') return static_cast<std::uint8_t>(10 + (c - 'a'));
        if (c >= 'A' && c <= 'F') return static_cast<std::uint8_t>(10 + (c - 'A'));
        return 0;
    };
    for (std::size_t i = 0; i + 1 < hex.size(); i += 2) {
        out.push_back(static_cast<std::uint8_t>((nibble(hex[i]) << 4) | nibble(hex[i + 1])));
    }
    return out;
}

std::string to_hex(std::string_view bytes) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out;
    out.reserve(bytes.size() * 2);
    for (unsigned char c : bytes) {
        out.push_back(kHex[c >> 4]);
        out.push_back(kHex[c & 0x0f]);
    }
    return out;
}

template <std::size_t N>
std::array<std::uint8_t, N> array_from_hex(std::string_view hex) {
    const auto vec = from_hex(hex);
    REQUIRE(vec.size() == N);
    std::array<std::uint8_t, N> arr{};
    for (std::size_t i = 0; i < N; ++i) {
        arr[i] = vec[i];
    }
    return arr;
}

}  // namespace

TEST_CASE("AES-256-GCM matches NIST SP 800-38D known-answer test vectors",
          "[maxima_lookup][crypto]") {
    // NIST GCM Test Case 16 (256-bit key, 96-bit IV, plaintext + AAD).
    const auto key = array_from_hex<32>(
        "feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308");
    const auto iv = array_from_hex<12>("cafebabefacedbaddecaf888");
    const auto aad_vec = from_hex("feedfacedeadbeeffeedfacedeadbeefabaddad2");
    const auto pt_vec = from_hex(
        "d9313225f88406e5a55909c5aff5269a"
        "86a7a9531534f7da2e4c303d8a318a72"
        "1c3c0c95956809532fcf0e2449a6b525"
        "b16aedf5aa0de657ba637b39");
    const std::string aad(reinterpret_cast<const char*>(aad_vec.data()), aad_vec.size());
    const std::string pt(reinterpret_cast<const char*>(pt_vec.data()), pt_vec.size());

    std::string ct;
    std::array<std::uint8_t, 16> tag{};
    REQUIRE(aes256_gcm_encrypt(key, iv, aad, pt, ct, tag));

    CHECK(to_hex(ct) ==
          "522dc1f099567d07f47f37a32a84427d"
          "643a8cdcbfe5c0c97598a2bd2555d1aa"
          "8cb08e48590dbb3da7b08b1056828838"
          "c5f61e6393ba7a0abcc9f662");
    CHECK(to_hex(std::string_view(reinterpret_cast<const char*>(tag.data()), tag.size())) ==
          "76fc6ece0f4e1768cddf8853bb2d551b");

    std::string decrypted;
    REQUIRE(aes256_gcm_decrypt(key, iv, aad, ct, tag, decrypted));
    CHECK(decrypted == pt);

    // Flipping 1 bit in tag or AAD must fail authentication.
    auto bad_tag = tag;
    bad_tag[0] ^= 0x01;
    std::string bad_pt;
    CHECK_FALSE(aes256_gcm_decrypt(key, iv, aad, ct, bad_tag, bad_pt));
    CHECK_FALSE(aes256_gcm_decrypt(key, iv, aad + "x", ct, tag, bad_pt));
}

TEST_CASE("MaximaLookupTokenStore encrypts at rest, sets 0600 permissions, and rejects tampering",
          "[maxima_lookup][token_store]") {
    mfbe::test::TempDir dir("mfbe-lookup-token");
    MaximaLookupTokenStore store(dir.path());

    // Initially absent.
    const auto initial = store.load();
    CHECK(initial.state == MaximaLookupTokenReadState::absent);
    CHECK(initial.token.empty());

    const std::string secret = "secret_lookup_token_value_1234567890_abcdef";
    REQUIRE(store.save(secret));
    REQUIRE(std::filesystem::exists(store.token_file_path()));
    REQUIRE(std::filesystem::exists(store.key_file_path()));

    // On-disk token JSON must never contain plaintext token bytes and must carry scheme metadata.
    const std::string raw_json = mfbe::test::read_text(store.token_file_path());
    CHECK(raw_json.find(secret) == std::string::npos);
    const json parsed = json::parse(raw_json);
    CHECK(parsed.value("version", 0) == 1);
    CHECK(parsed.value("scheme", "") == "aes256gcm-keyfile");
    CHECK(parsed.contains("iv"));
    CHECK(parsed.contains("tag"));
    CHECK(parsed.contains("ciphertext"));

#ifndef _WIN32
    struct stat st_token{};
    REQUIRE(::stat(store.token_file_path().c_str(), &st_token) == 0);
    CHECK((st_token.st_mode & 0777) == 0600);
    struct stat st_key{};
    REQUIRE(::stat(store.key_file_path().c_str(), &st_key) == 0);
    CHECK((st_key.st_mode & 0777) == 0600);
#endif

    // Round-trip decrypts cleanly.
    const auto loaded = store.load();
    CHECK(loaded.state == MaximaLookupTokenReadState::ok);
    CHECK(loaded.token == secret);

    // Re-saving uses a fresh random IV so ciphertext differs.
    REQUIRE(store.save(secret));
    const std::string raw_json_2 = mfbe::test::read_text(store.token_file_path());
    CHECK(raw_json_2 != raw_json);
    CHECK(store.load().token == secret);

    // Tampered ciphertext -> unreadable without throwing.
    {
        json tampered = json::parse(raw_json_2);
        std::string ct = tampered["ciphertext"].get<std::string>();
        ct[0] = (ct[0] == 'A') ? 'B' : 'A';
        tampered["ciphertext"] = ct;
        std::ofstream out(store.token_file_path(), std::ios::binary | std::ios::trunc);
        out << tampered.dump(2);
    }
    CHECK(store.load().state == MaximaLookupTokenReadState::unreadable);

    // Re-saving recovers cleanly.
    REQUIRE(store.save(secret));
    CHECK(store.load().state == MaximaLookupTokenReadState::ok);

    // Missing keyfile -> unreadable without throwing.
    std::filesystem::remove(store.key_file_path());
    CHECK(store.load().state == MaximaLookupTokenReadState::unreadable);

    // Remove clears token file cleanly -> absent.
    REQUIRE(store.remove());
    CHECK(store.load().state == MaximaLookupTokenReadState::absent);
}
