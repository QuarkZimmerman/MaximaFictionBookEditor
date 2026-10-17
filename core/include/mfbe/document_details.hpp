// Document details filled in on load (feature 002 FR-005, data-model §2). The original editor
// filled them in whenever it loaded a document (main.js SetupDescription) without marking it
// changed: they reach the file at the next save.
#pragma once

#include <mfbe/document.hpp>

#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::model {

struct DetailsContext {
    // "Maxima Fiction Book Editor <version>".
    std::string program;
    // Today's local date.
    int year = 1970;
    int month = 1;
    int day = 1;
    // A new document (from a template) always gets a new id; a loaded book only without one.
    bool is_new = false;
    // Interface language ("en", "ru", "uk") whose long date form the date text takes when the
    // system's regional settings cannot be determined (feature 003 FR-050).
    std::string ui_language = "en";
    // Document id generator: an upper-case UUID as the original's.
    std::function<std::string()> new_id;
};

// This editor's name and version, today's local date, a UUID generator and the interface
// language: `ui_language` is the `view.uiLanguage` setting, "system" resolved through
// platform::system_language().
DetailsContext details_context_now(bool is_new, std::string_view ui_language = "system");

// Fills in exactly what the original filled in: the document id (always for a new document,
// else when empty), the version "1.0" when empty, the program used (this editor when empty;
// appended after ", " when the value does not name this editor), and when empty the date text
// and value ("2026-10-09"). The text is the long date of the system's regional settings
// without the day of the week - platform::format_long_date, the function behind the Today
// button's doc.formatDate (feature 003 FR-051; the original wrote "09 October 2026"). Returns
// the filled fields as paths of the document model ("documentInfo.id", "documentInfo.version",
// "documentInfo.programUsed", "documentInfo.date.text", "documentInfo.date.value").
std::vector<std::string> fill_in_document_details(Document& doc, const DetailsContext& context);

}  // namespace mfbe::model
