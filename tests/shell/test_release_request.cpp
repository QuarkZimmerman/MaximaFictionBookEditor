// The latest-release request (feature 002 FR-082): the release service learns nothing but the
// request itself - a GET of the latest release with Accept and User-Agent, no cookies or stored
// credentials - and the request ends after 15 seconds.
#include "release_request.h"

#include <catch2/catch_test_macros.hpp>

using mfbe::shell::releaseRequest;

TEST_CASE("release request: the latest release, two headers, no credentials", "[shell]") {
    const auto request = releaseRequest("0.0.2");
    CHECK(request.url ==
          "https://api.github.com/repos/QuarkZimmerman/MaximaFictionBookEditor/releases/latest");
    CHECK(request.method == "GET");
    REQUIRE(request.headers.size() == 2);
    CHECK(request.headers[0] ==
          std::pair<std::string, std::string>{"Accept", "application/vnd.github+json"});
    CHECK(request.headers[1] ==
          std::pair<std::string, std::string>{"User-Agent", "MaximaFictionBookEditor/0.0.2"});
    CHECK_FALSE(request.send_credentials);
    CHECK(request.timeout_ms == 15000);
}
