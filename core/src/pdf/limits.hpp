#pragma once
// Feature 014 (plan DP-19, FR-043; tasks T045): what the PDF export refuses, or caps, so that a
// hostile book cannot exhaust the memory or the time of the editor. The interface receives the
// numbers with pdf.export.begin's answer and refuses before printing; the core enforces them again.

#include <cstddef>
#include <cstdint>

namespace mfbe::pdf {

/// A book of more pages than this is refused before printing.
inline constexpr int kMaxPages = 20'000;
/// A book of more notes than this is refused before printing.
inline constexpr int kMaxNotes = 100'000;
/// Sections deeper than this are drawn and bookmarked at this level.
inline constexpr int kMaxNesting = 64;
/// A picture of more pixels than this is left out and listed, never decoded.
inline constexpr std::uint64_t kMaxPixels = 100'000'000;
/// An added font file larger than this is refused.
inline constexpr std::size_t kMaxAddedFontBytes = 64u * 1024 * 1024;

}  // namespace mfbe::pdf
