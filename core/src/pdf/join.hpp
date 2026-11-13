#pragma once
// Feature 014 (plan DP-3, tasks T025): the printed parts of a long book joined into one file before
// it is finished. Measured on the 10 MB test book in A6 (about 7,500 pages): printed as one part,
// the browser engine's processes reached 2.6 GB, beyond the 1.5 GB budget, so the paginator cuts
// parts of 1,000 pages, each printed alone, and the core joins them here.
//
// The later parts are imported into the first one's file: their pages are appended to its page
// tree; their structure elements are appended to its document element, with their parent tree keys
// moved past the first's; and their named destinations are added to its own. The text, the tags and
// the links within the book stay as the engine wrote them.

#include <vector>

namespace mfbe::pdf {

/// The parts, in order, as one file; throws std::runtime_error naming the fault.
std::vector<char> join_parts(std::vector<std::vector<char>> parts);

}  // namespace mfbe::pdf
