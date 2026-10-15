// The one network request the editor makes (feature 002 FR-080 to FR-082, decision D15): the
// latest published release, asked only when the user chooses Help > Check for new version. The
// description is a pure function (tests/shell/test_release_request.cpp); the shell sends it with
// CEF's own network stack (dialog_provider.cpp) and the core reads the answer
// (mfbe::release_from_github).
#pragma once

#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace mfbe::shell {

struct ReleaseRequest {
    std::string url;
    std::string method;
    // The only headers sent: Accept and User-Agent.
    std::vector<std::pair<std::string, std::string>> headers;
    // Cookies and stored credentials are never sent.
    bool send_credentials = false;
    // The request is cancelled after this time (the answer is then "timeout").
    int timeout_ms = 0;
};

// The request for the latest release, sent by this editor version.
ReleaseRequest releaseRequest(std::string_view version);

}  // namespace mfbe::shell
