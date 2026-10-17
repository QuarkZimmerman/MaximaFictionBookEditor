// The shell's right-click menu (feature 002 FR-064): a text box keeps the edit menu of a Windows
// text box - Undo, Cut, Copy, Paste, Delete, Select All - and nothing else; every other place
// gets no menu.
#include "context_menu.h"

#include <catch2/catch_test_macros.hpp>
#include <set>
#include <string>
#include <vector>

using mfbe::shell::ContextMenuItem;
using mfbe::shell::contextMenuItems;
using mfbe::shell::contextMenuLabel;
using mfbe::shell::EditCommand;
using mfbe::shell::EditState;

namespace {

// "-" for a separator, else the command and "+" (enabled) or "-" (disabled).
std::vector<std::string> describe(const std::vector<ContextMenuItem>& items) {
    std::vector<std::string> out;
    for (const auto& item : items) {
        if (item.separator) {
            out.emplace_back("-");
            continue;
        }
        std::string name;
        switch (item.command) {
            case EditCommand::Undo:
                name = "undo";
                break;
            case EditCommand::Cut:
                name = "cut";
                break;
            case EditCommand::Copy:
                name = "copy";
                break;
            case EditCommand::Paste:
                name = "paste";
                break;
            case EditCommand::Delete:
                name = "delete";
                break;
            case EditCommand::SelectAll:
                name = "selectAll";
                break;
        }
        out.push_back(name + (item.enabled ? "+" : "-"));
    }
    return out;
}

constexpr EditCommand kCommands[] = {EditCommand::Undo,   EditCommand::Cut,
                                     EditCommand::Copy,   EditCommand::Paste,
                                     EditCommand::Delete, EditCommand::SelectAll};

}  // namespace

TEST_CASE("context menu: a text box keeps the six edit commands", "[shell]") {
    EditState state;
    state.editable = true;
    state.can_undo = true;
    state.can_cut = true;
    state.can_copy = true;
    state.can_paste = true;
    state.can_delete = true;
    state.can_select_all = true;
    CHECK(describe(contextMenuItems(state)) ==
          std::vector<std::string>{"undo+", "-", "cut+", "copy+", "paste+", "delete+", "-",
                                   "selectAll+"});
}

TEST_CASE("context menu: each command is enabled as the browser reports", "[shell]") {
    EditState state;
    state.editable = true;
    CHECK(describe(contextMenuItems(state)) ==
          std::vector<std::string>{"undo-", "-", "cut-", "copy-", "paste-", "delete-", "-",
                                   "selectAll-"});
    state.can_copy = true;
    state.can_select_all = true;
    CHECK(describe(contextMenuItems(state)) ==
          std::vector<std::string>{"undo-", "-", "cut-", "copy+", "paste-", "delete-", "-",
                                   "selectAll+"});
}

TEST_CASE("context menu: nothing outside a text box", "[shell]") {
    EditState state;
    state.can_copy = true;
    state.can_select_all = true;
    CHECK(contextMenuItems(state).empty());
    CHECK(contextMenuItems(EditState{}).empty());
}

TEST_CASE("context menu: labels in the shell's language with distinct accelerators", "[shell]") {
    CHECK(contextMenuLabel(EditCommand::Undo, "en") == "&Undo");
    CHECK(contextMenuLabel(EditCommand::SelectAll, "en") == "Select &All");
    CHECK(contextMenuLabel(EditCommand::Paste, "ru") == "Вст&авить");
    CHECK(contextMenuLabel(EditCommand::Paste, "uk") == "&Вставити");
    CHECK(contextMenuLabel(EditCommand::Copy, "de") == "&Copy");
    CHECK(contextMenuLabel(EditCommand::Copy, "") == "&Copy");
    for (const char* language : {"en", "ru", "uk"}) {
        std::set<std::string> accelerators;
        for (const EditCommand command : kCommands) {
            const std::string label = contextMenuLabel(command, language);
            const auto amp = label.find('&');
            REQUIRE(amp != std::string::npos);
            // The accelerator letter: one character, one or two bytes in UTF-8.
            const auto lead = static_cast<unsigned char>(label[amp + 1]);
            accelerators.insert(label.substr(amp + 1, lead < 0x80 ? 1 : 2));
        }
        CHECK(accelerators.size() == std::size(kCommands));
    }
}
