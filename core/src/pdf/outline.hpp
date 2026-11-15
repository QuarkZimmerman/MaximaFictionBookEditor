#pragma once
// Feature 014 (D17, tasks T040): the PDF's bookmarks, from the page map: the cover page and the
// title page, the titled sections nested as the book nests them, the other bodies and the notes,
// each going to its page at its height (/XYZ). The file opens with them shown (PageMode).

#include <mfbe/pdf.hpp>

#include <string>
#include <vector>

namespace mfbe::pdf {

struct Bookmark {
    std::string title;  // UTF-8
    int page = 0;       // from 0
    double y = 0;       // points from the page's top
    std::vector<Bookmark> children;
};

/// Replaces the document's outline with `bookmarks` (none: no outline). `page_height_pt` is the
/// exact height every page has (D3); Poppler's pages keep the size they were read with.
void write_outline(Document& document, const std::vector<Bookmark>& bookmarks,
                   double page_height_pt);

}  // namespace mfbe::pdf
