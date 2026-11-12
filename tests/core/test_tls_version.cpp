// Feature 013 (FR-009, SC-004): the OpenSSL headers the core's tests compile against belong to the
// library they link - the project's own (vcpkg). On the Intel macOS build the HTTPS fixture once
// read Homebrew's headers (/usr/local/include) while it linked vcpkg's library; a drift between the
// two would break the tests for reasons that have nothing to do with the editor. The library's
// version is only known at run time, so this is a test. Windows links no OpenSSL in the tests
// (MFBE_TEST_TLS unset; tests/core/CMakeLists.txt).
#include <catch2/catch_test_macros.hpp>

#if MFBE_TEST_TLS
#include <cstdio>
#include <openssl/crypto.h>
#include <openssl/opensslv.h>
#include <string>

namespace {

// Major, minor and patch of an OpenSSL 3 version number (0xMNN00PP0L).
std::string version_of(unsigned long number) {
    char text[32];
    std::snprintf(text, sizeof text, "%lu.%lu.%lu", (number >> 28) & 0xFUL, (number >> 20) & 0xFFUL,
                  (number >> 4) & 0xFFUL);
    return text;
}

}  // namespace

TEST_CASE("tls: header and library OpenSSL versions agree", "[tls]") {
    INFO("headers: " << OPENSSL_VERSION_TEXT << "; library: " << OpenSSL_version(OPENSSL_VERSION));
    CHECK(version_of(OPENSSL_VERSION_NUMBER) == version_of(OpenSSL_version_num()));
}
#endif
