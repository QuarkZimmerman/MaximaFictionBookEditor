#pragma once
// Feature 014 (research R3, tasks T025, T027): the printed file made into the exported one - every
// page at its exact size, the ligature maps mended, and the PDF/A-2 level U essentials: an sRGB
// output intent, the XMP metadata with its PDF/A declaration, and the Info dictionary matching it.
// Later tasks add the pictures (R4), the bookmarks (D17), the whole description (D14, D15) and the
// checks (DP-18).

#include <string>
#include <vector>

namespace mfbe::pdf {

struct FinishInput {
    double width_pt = 0;  // the page size of D3, exactly
    double height_pt = 0;
    std::string title;         // UTF-8; the book's title
    std::string lang;          // the book's language, empty when unknown (D22)
    std::string creator_tool;  // the editor's name and version
};

/// Finishes `printed`; throws std::runtime_error naming the fault.
std::vector<char> finish(std::vector<char> printed, const FinishInput& input);

}  // namespace mfbe::pdf
