// Feature 017 (D33, DP-11): letter case set aside in file names - ASCII, Latin-1, Latin Extended-A,
// Greek and Cyrillic letters (the scripts of the editor's languages and of European names); any
// other character stays as it is. Used where the FBD beside a file is matched by its name.
#pragma once

#include <string>
#include <string_view>

namespace mfbe::text {

// `utf8` with its capital letters of the scripts above as small ones; invalid bytes stay as they
// are.
std::string fold_case(std::string_view utf8);

}  // namespace mfbe::text
