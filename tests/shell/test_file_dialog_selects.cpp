// Feature 018 (T011, contracts/rpc-api.md §4): multi-select dropdowns and live extension/filter
// switching in the shell's file dialog logic.
#include "file_dialog_request.h"

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

using namespace mfbe::shell;

namespace {

FileDialogRequest mobiSaveRequest(const std::string& format = "mobi7", bool zip = false) {
    FileDialogRequest r;
    r.mode = FileDialogMode::kSave;
    r.filters = {
        {"MOBI books (*.mobi)", {"mobi"}},
        {"KF8 books (*.azw3)", {"azw3"}},
        {"ZIP archives (*.zip)", {"zip"}},
    };
    r.selected_filter = zip ? 2 : (format == "kf8" ? 1 : 0);
    r.zip_label = "Save in ZIP archive";
    r.zip_checked = zip;
    r.zip_rename = FileDialogRequest::ZipRename::kReplace;
    r.zip_filter = 2;
    r.selects = {
        {"format",
         "Format:",
         {
             {"mobi7", "MOBI 7 (.mobi)", "mobi"},
             {"joint", "MOBI 7 + KF8 (joint .mobi)", "mobi"},
             {"kf8", "KF8 (.azw3)", "azw3"},
         },
         format},
        {"tocPlacement",
         "Table of contents:",
         {
             {"afterTitle", "After title page", ""},
             {"end", "At the end", ""},
             {"none", "None", ""},
         },
         "afterTitle"},
    };
    return r;
}

}  // namespace

TEST_CASE("file dialogs selects: choice index, Windows item ids, and active extension",
          "[shell][dialogs][mobi]") {
    const FileDialogRequest req = mobiSaveRequest("kf8", false);
    CHECK(selectedSelectChoiceIndex(req.selects[0]) == 2);
    CHECK(selectedSelectChoiceIndex(req.selects[1]) == 0);
    CHECK(activeSelectExtension(req) == "azw3");

    // Windows item IDs round-trip back to choice values per select index
    const unsigned id0 = selectItemId(0, 1);
    const unsigned id1 = selectItemId(1, 2);
    CHECK(selectValueOfItem(req.selects[0], 0, id0) == "joint");
    CHECK(selectValueOfItem(req.selects[1], 1, id1) == "none");
    CHECK(selectValueOfItem(req.selects[0], 0, id1).empty());
}

TEST_CASE("file dialogs selects: live filename and filter updates follow format and ZIP",
          "[shell][dialogs][mobi]") {
    const FileDialogRequest req = mobiSaveRequest("mobi7", false);

    // Switching format mobi7 -> kf8 renames .mobi -> .azw3 and picks KF8 filter (index 1)
    CHECK(selectFollowName(req, "Novel.mobi", "azw3", false) == "Novel.azw3");
    CHECK(selectFollowFilter(req, "azw3", false) == 1);

    // Switching back kf8 -> joint renames .azw3 -> .mobi and picks MOBI filter (index 0)
    CHECK(selectFollowName(req, "Novel.azw3", "mobi", false) == "Novel.mobi");
    CHECK(selectFollowFilter(req, "mobi", false) == 0);

    // Ticking ZIP with active KF8 replaces .azw3 -> .zip and picks ZIP filter (index 2)
    CHECK(selectFollowName(req, "Novel.azw3", "azw3", true) == "Novel.zip");
    CHECK(selectFollowFilter(req, "azw3", true) == 2);

    // Unticking ZIP restores active KF8 (.azw3) rather than stale .mobi
    CHECK(selectFollowName(req, "Novel.zip", "azw3", false) == "Novel.azw3");
    CHECK(selectFollowFilter(req, "azw3", false) == 1);

    // Empty name stays empty
    CHECK(selectFollowName(req, "", "azw3", false).empty());
}
