// The shell's right-click menu (feature 002 FR-064): no browser options anywhere. A text box gets
// the edit menu of a Windows text box, as the original's text boxes had - Undo, Cut, Copy,
// Paste, Delete and Select All, labelled in the shell's language - and every other place gets
// nothing: the interface shows its own menus where the original had one and cancels the
// browser's elsewhere. The browser's own text box menu lacks Undo and Delete and adds browser
// items (search, print, inspect...), so the menu is built anew. Pure functions
// (tests/shell/test_context_menu.cpp); mfbe_client.cpp builds CEF's menu from them and runs
// the commands on the frame.
#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace mfbe::shell {

enum class EditCommand { Undo, Cut, Copy, Paste, Delete, SelectAll };

// What the browser reports for the place right-clicked.
struct EditState {
    bool editable = false;
    bool can_undo = false;
    bool can_cut = false;
    bool can_copy = false;
    bool can_paste = false;
    bool can_delete = false;
    bool can_select_all = false;
};

struct ContextMenuItem {
    bool separator = false;
    EditCommand command = EditCommand::Undo;  // not a separator
    bool enabled = false;
};

// The menu for a right-click: the edit menu on a text box, nothing elsewhere.
std::vector<ContextMenuItem> contextMenuItems(const EditState& state);

// A command's label with its `&` accelerator: Russian for the shell language "ru", English
// otherwise.
std::string contextMenuLabel(EditCommand command, std::string_view language);

}  // namespace mfbe::shell
