// SHA-256 helper (feature 005, T012): the FIPS 180-4 vectors, the padding boundaries, embedded
// NULs and the fingerprint of the custom AI service triple (rpc-api §3.7 invariant).
#include "util/sha256.hpp"

#include <catch2/catch_test_macros.hpp>
#include <cctype>
#include <string>
#include <string_view>

using namespace mfbe;

namespace {

bool is_lower_hex64(const std::string& text) {
    if (text.size() != 64) {
        return false;
    }
    for (const unsigned char c : text) {
        if (!std::isxdigit(c) || (std::isalpha(c) && !std::islower(c))) {
            return false;
        }
    }
    return true;
}

}  // namespace

TEST_CASE("sha256: known vectors and the address\\0key\\0model fingerprint", "[sha256]") {
    SECTION("FIPS 180-4 vectors") {
        // The empty message and "abc" (FIPS 180-4 appendix B.1).
        CHECK(util::sha256_hex("") ==
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        CHECK(util::sha256_hex("abc") ==
              "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        // 56 bytes: the padding needs a second block (appendix B.2).
        CHECK(util::sha256_hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
              "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
        // 112 bytes: a message spanning several 64-byte blocks.
        CHECK(util::sha256_hex("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno"
                               "ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu") ==
              "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
        // One million 'a' (appendix B.3).
        const std::string million(1000000, 'a');
        CHECK(util::sha256_hex(million) ==
              "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    }

    SECTION("padding boundaries around one block") {
        CHECK(util::sha256_hex(std::string(55, 'x')) ==
              "d5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072");
        CHECK(util::sha256_hex(std::string(63, 'x')) ==
              "75220b47218278e656f2013bb8f0c455a25eaf01e86c64924e9d48d89776d6f2");
        CHECK(util::sha256_hex(std::string(64, 'x')) ==
              "7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c");
        CHECK(util::sha256_hex(std::string(65, 'x')) ==
              "9537c5fdf120482f7d58d25e9ed583f52c02b4e304ea814db1633ad565aed7e9");
        // Every byte value, 200 of them.
        std::string bytes;
        for (int i = 0; i < 200; ++i) {
            bytes.push_back(static_cast<char>(i));
        }
        CHECK(util::sha256_hex(bytes) ==
              "1901da1c9f699b48f6b2636e65cbf73abf99d0441ef67f5c540a42f7051dec6f");
    }

    SECTION("embedded NULs are hashed as bytes, not as terminators") {
        const std::string_view with_nuls("a\0b\0\0c", 6);
        REQUIRE(with_nuls.size() == 6);
        CHECK(util::sha256_hex(with_nuls) ==
              "66a2256f272ef4528aa5f2685496a4412d81f1560ad6b1a16bec1560cf23c85d");
        CHECK(util::sha256_hex(with_nuls) != util::sha256_hex("a"));
        CHECK(util::sha256_hex(std::string_view("\0", 1)) != util::sha256_hex(""));
    }

    SECTION("the fingerprint equals Node's createHash('sha256') over address\\0key\\0model") {
        // node -e "require('crypto').createHash('sha256')
        //   .update('https://api.openai.com/v1\u0000sk-test-ключ-0123\u0000gpt-4o-mini', 'utf8')
        //   .digest('hex')"
        const std::string address = "https://api.openai.com/v1";
        const std::string key = "sk-test-ключ-0123";
        const std::string model = "gpt-4o-mini";
        const std::string fingerprint = util::ai_fingerprint(address, key, model);
        CHECK(fingerprint == "429dbcb2d66690b52db115361e4788861e83cda5f71e99b4b9bbb42e5b2aa3f2");
        CHECK(is_lower_hex64(fingerprint));
        CHECK(fingerprint == util::sha256_hex(address + '\0' + key + '\0' + model));

        // An empty key is a legitimate triple (local servers) and still a distinct value:
        // createHash('sha256').update('http://127.0.0.1:11434/v1\u0000\u0000llama3').digest('hex')
        CHECK(util::ai_fingerprint("http://127.0.0.1:11434/v1", "", "llama3") ==
              "7cea4ab6ba17e703c1afd073be2178411e78bf9fdb34a997b9f31f9def3ad5ef");

        // The separators matter: moving characters across them changes the value.
        CHECK(util::ai_fingerprint(address + "x", key, model) != fingerprint);
        CHECK(util::ai_fingerprint(address, key + "x", model) != fingerprint);
        CHECK(util::ai_fingerprint(address, key, model + "x") != fingerprint);
        CHECK(util::ai_fingerprint(address + "s", "k-test-ключ-0123", model) != fingerprint);
        CHECK(util::ai_fingerprint("", "", "") == util::sha256_hex(std::string_view("\0\0", 2)));
    }

    SECTION("the fingerprint never equals or contains the key") {
        const std::string key = "sk-live-0123456789abcdef";
        const std::string fingerprint =
            util::ai_fingerprint("https://api.example.com/v1", key, "model-x");
        CHECK(fingerprint != key);
        CHECK(fingerprint.find(key) == std::string::npos);
        CHECK(fingerprint.find("0123456789abcdef") == std::string::npos);
        CHECK(is_lower_hex64(fingerprint));
        // A hexadecimal key is not reproduced either.
        const std::string hex_key(64, 'a');
        const std::string hex_fingerprint =
            util::ai_fingerprint("https://api.example.com/v1", hex_key, "model-x");
        CHECK(hex_fingerprint != hex_key);
        CHECK(hex_fingerprint.find(hex_key) == std::string::npos);
    }
}
