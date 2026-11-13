// Feature 014 (research R3 step 9, plan DP-18, tasks T028): the export's own check.

#include "pdf/check.hpp"

#include <mfbe/pdf.hpp>

#include <cctype>

namespace mfbe::pdf {

std::string comparable(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); ++i) {
        const unsigned char c = static_cast<unsigned char>(text[i]);
        if (std::isspace(c))
            continue;
        // No-break spaces (U+00A0) and the soft hyphen (U+00AD) count as whitespace too.
        if (c == 0xC2 && i + 1 < text.size() &&
            (static_cast<unsigned char>(text[i + 1]) == 0xA0 ||
             static_cast<unsigned char>(text[i + 1]) == 0xAD)) {
            ++i;
            continue;
        }
        out.push_back(text[i]);
    }
    return out;
}

std::vector<std::string> check_finished(const std::vector<char>& finished,
                                        const std::vector<std::string>& page_texts) {
    std::vector<std::string> faults;
    std::string error;
    auto doc = Document::open_bytes(finished, &error);
    if (!doc)
        return {"the finished file cannot be read back: " + error};
    if (doc->encrypted())
        faults.emplace_back("the finished file is encrypted");
    if (!page_texts.empty() && doc->page_count() != static_cast<int>(page_texts.size())) {
        faults.push_back("the file has " + std::to_string(doc->page_count()) +
                         " pages, the page map " + std::to_string(page_texts.size()));
    }
    for (int i = 0; i < doc->page_count(); ++i) {
        for (const FontInfo& font : doc->page_info(i).fonts) {
            if (!font.embedded || !font.to_unicode) {
                faults.push_back("page " + std::to_string(i + 1) + ": font " + font.base_font +
                                 (font.embedded ? " has no ToUnicode map" : " is not embedded"));
            }
        }
        if (i >= static_cast<int>(page_texts.size()))
            continue;
        // The page number at the foot is drawn but is not page map text: it may follow.
        const std::string expected = comparable(page_texts[static_cast<std::size_t>(i)]);
        std::string read = comparable(doc->page_text(i));
        // The page number at the foot is drawn but is not the page map's text; Poppler reads it in
        // wherever its position falls in the page's reading order, so it is accepted once there.
        const std::string number = std::to_string(i + 1);
        if (read != expected && read.size() == expected.size() + number.size()) {
            std::size_t at = 0;
            while (at < expected.size() && read[at] == expected[at])
                ++at;
            if (read.compare(at, number.size(), number) == 0 &&
                read.compare(at + number.size(), std::string::npos, expected, at) == 0) {
                read = expected;
            }
        }
        if (read != expected) {
            std::size_t at = 0;
            while (at < read.size() && at < expected.size() && read[at] == expected[at])
                ++at;
            // Back to the start of a UTF-8 character, then a short stretch of each.
            while (at > 0 && (static_cast<unsigned char>(expected[at]) & 0xC0) == 0x80)
                --at;
            faults.push_back("page " + std::to_string(i + 1) +
                             ": its text differs from the page at \"" + expected.substr(at, 80) +
                             "\" (read: \"" + read.substr(at, 80) + "\")");
        }
        if (faults.size() > 20)
            break;
    }
    return faults;
}

}  // namespace mfbe::pdf
