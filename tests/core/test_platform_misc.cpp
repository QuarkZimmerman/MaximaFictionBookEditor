// T015: UUID v4, OS opener, Unicode helpers.
#include "test_support.hpp"

#include <mfbe/platform.hpp>
#include <mfbe/unicode.hpp>

#include <catch2/catch_test_macros.hpp>
#include <set>

using namespace mfbe;

TEST_CASE("uuid: generate_v4 produces canonical, unique version-4 ids", "[uuid]") {
    std::set<std::string> seen;
    for (int i = 0; i < 200; ++i) {
        const std::string id = uuid::generate_v4();
        REQUIRE(id.size() == 36);
        CHECK(uuid::is_valid(id));
        CHECK(id[14] == '4');                                          // version nibble
        CHECK(std::string("89ab").find(id[19]) != std::string::npos);  // RFC 4122 variant
        for (char c : id) {
            CHECK_FALSE((c >= 'A' && c <= 'Z'));  // lower-case
        }
        seen.insert(id);
    }
    CHECK(seen.size() == 200);
}

TEST_CASE("uuid: is_valid rejects malformed strings", "[uuid]") {
    CHECK(uuid::is_valid("3f0a4b7e-2d31-4b0b-9a1e-6b7f2c9d1e22"));
    CHECK_FALSE(uuid::is_valid("3f0a4b7e2d314b0b9a1e6b7f2c9d1e22"));
    CHECK_FALSE(uuid::is_valid("3f0a4b7e-2d31-4b0b-9a1e-6b7f2c9d1e2g"));
    CHECK_FALSE(uuid::is_valid(""));
}

TEST_CASE("process: opener commands are built per platform and validated", "[process]") {
    test::TempDir tmp;
    std::vector<std::vector<std::string>> calls;
    process::set_command_runner_for_tests([&](const std::vector<std::string>& argv) {
        calls.push_back(argv);
        return true;
    });
    CHECK(process::open_folder(tmp.path()));
    CHECK_FALSE(process::open_folder(tmp / "does-not-exist"));
    CHECK(process::open_url("https://example.org/x"));
    CHECK_FALSE(process::open_url("file:///etc/passwd"));
    CHECK_FALSE(process::open_url("javascript:alert(1)"));
    process::set_command_runner_for_tests(nullptr);

    REQUIRE(calls.size() == 2);
#ifdef _WIN32
    CHECK(calls[0][0] == "explorer");
#elif defined(__APPLE__)
    CHECK(calls[0][0] == "open");
#else
    CHECK(calls[0][0] == "xdg-open");
#endif
    CHECK(calls[0][1] == std::filesystem::absolute(tmp.path()).string());
    CHECK(calls[1][1] == "https://example.org/x");
}

TEST_CASE("unicode: UTF-8 decoding and letter classification", "[unicode]") {
    bool ok = false;
    auto cps = unicode::decode_utf8("a\xC3\xA9\xD0\xB6\xE2\x82\xAC\xF0\x9F\x98\x80", &ok);
    CHECK(ok);
    REQUIRE(cps.size() == 5);
    CHECK(cps[0] == U'a');
    CHECK(cps[1] == 0xE9);
    CHECK(cps[2] == 0x436);
    CHECK(cps[3] == 0x20AC);
    CHECK(cps[4] == 0x1F600);

    CHECK_FALSE(unicode::is_valid_utf8("\xFF"));
    CHECK_FALSE(unicode::is_valid_utf8("\xC3"));          // truncated
    CHECK_FALSE(unicode::is_valid_utf8("\xC0\x80"));      // overlong
    CHECK_FALSE(unicode::is_valid_utf8("\xED\xA0\x80"));  // surrogate
    CHECK(unicode::length("\xD0\xB6\xD0\xB8") == 2);

    CHECK(unicode::is_letter(U'A'));
    CHECK(unicode::is_letter(U'z'));
    CHECK(unicode::is_letter(0x0439));  // й
    CHECK(unicode::is_letter(0x0451));  // ё
    CHECK(unicode::is_letter(0x00E9));  // é
    CHECK(unicode::is_letter(0x03B1));  // α
    CHECK(unicode::is_letter(0x4E2D));  // 中
    CHECK_FALSE(unicode::is_letter(U'1'));
    CHECK_FALSE(unicode::is_letter(U'-'));
    CHECK_FALSE(unicode::is_letter(U' '));
    CHECK_FALSE(unicode::is_letter(0x0301));  // combining acute
    CHECK_FALSE(unicode::is_letter(0x20AC));  // €

    std::string out;
    unicode::append_utf8(out, 0x436);
    unicode::append_utf8(out, 0x1F600);
    CHECK(out == "\xD0\xB6\xF0\x9F\x98\x80");
}
