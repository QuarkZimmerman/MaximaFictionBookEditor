#include "permission_policy.h"

namespace mfbe::shell {

namespace {

std::string_view withoutTrailingSlash(std::string_view origin) {
    if (!origin.empty() && origin.back() == '/') {
        origin.remove_suffix(1);
    }
    return origin;
}

}  // namespace

bool allowPermission(std::string_view requesting_origin, std::string_view app_origin,
                     bool clipboard_only) {
    const std::string_view own = withoutTrailingSlash(app_origin);
    return clipboard_only && !own.empty() && withoutTrailingSlash(requesting_origin) == own;
}

}  // namespace mfbe::shell
