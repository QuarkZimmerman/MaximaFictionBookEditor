#pragma once
// Feature 014 (D12, research R4, tasks T026): the core draws the book's pictures into the boxes the
// paginator left empty. Each binary becomes one image object, whatever the number of pages that
// show it. A JPEG goes in as its own bytes; any other picture goes in with its exact pixels.

#include <mfbe/pdf.hpp>

#include <map>
#include <string>
#include <vector>

namespace mfbe::pdf {

struct PlacedPicture {
    int page = 0;  // from 0
    double x = 0;  // points from the page's top left
    double y = 0;
    double width = 0;
    double height = 0;
    std::string binary_id;
};

/// Draws `pictures` from `binaries` (id -> bytes). Returns the ids left out: no data, not a
/// picture, more than 100 megapixels (DP-19).
std::vector<std::string> draw_pictures(Document& document,
                                       const std::vector<PlacedPicture>& pictures,
                                       const std::map<std::string, std::string>& binaries);

}  // namespace mfbe::pdf
