// Permission requests of pages in the shell (feature 002): only the editor's own page, and only
// for the clipboard (Edit > Paste and the right-click menus read it).
#include "permission_policy.h"

#include <catch2/catch_test_macros.hpp>

using mfbe::shell::allowPermission;

namespace {
constexpr const char* kApp = "http://127.0.0.1:54321";
}

TEST_CASE("permissions: the editor's page may read the clipboard", "[permissions]") {
    CHECK(allowPermission(kApp, kApp, true));
    CHECK(allowPermission("http://127.0.0.1:54321/", kApp, true));
    CHECK(allowPermission(kApp, "http://127.0.0.1:54321/", true));
}

TEST_CASE("permissions: anything else is refused", "[permissions]") {
    CHECK_FALSE(allowPermission(kApp, kApp, false));  // more than the clipboard
    CHECK_FALSE(allowPermission("http://127.0.0.1:9999", kApp, true));
    CHECK_FALSE(allowPermission("http://127.0.0.1:54321.example.com", kApp, true));
    CHECK_FALSE(allowPermission("https://example.com", kApp, true));
    CHECK_FALSE(allowPermission("devtools://devtools", kApp, true));
    CHECK_FALSE(allowPermission("", kApp, true));
    CHECK_FALSE(allowPermission(kApp, "", true));  // no page of the editor's yet
}
