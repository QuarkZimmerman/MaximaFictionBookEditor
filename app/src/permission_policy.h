// Permission requests of pages in the shell (feature 002): the editor's own page may read the
// clipboard - Edit > Paste and the right-click menus paste its contents, as the original's did -
// and every other request is refused, so the browser never shows a permission prompt. Pure
// functions (tests/shell/test_permissions.cpp); mfbe_client.cpp answers CEF's prompts with them.
#pragma once

#include <string_view>

namespace mfbe::shell {

// True when a page of `requesting_origin` may have what it asked for: the clipboard alone
// (`clipboard_only`), asked by the editor's own page (`app_origin`, "http://127.0.0.1:<port>";
// a trailing slash on either is ignored).
bool allowPermission(std::string_view requesting_origin, std::string_view app_origin,
                     bool clipboard_only);

}  // namespace mfbe::shell
