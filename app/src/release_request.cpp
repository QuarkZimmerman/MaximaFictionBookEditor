#include "release_request.h"

namespace mfbe::shell {

ReleaseRequest releaseRequest(std::string_view version) {
    ReleaseRequest request;
    request.url =
        "https://api.github.com/repos/QuarkZimmerman/MaximaFictionBookEditor/releases/latest";
    request.method = "GET";
    request.headers = {{"Accept", "application/vnd.github+json"},
                       {"User-Agent", "MaximaFictionBookEditor/" + std::string(version)}};
    request.send_credentials = false;
    request.timeout_ms = 15000;
    return request;
}

}  // namespace mfbe::shell
