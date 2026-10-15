#include "context_menu.h"

namespace mfbe::shell {

std::vector<ContextMenuItem> contextMenuItems(const EditState& state) {
    if (!state.editable) {
        return {};
    }
    const auto item = [](EditCommand command, bool enabled) {
        return ContextMenuItem{false, command, enabled};
    };
    const ContextMenuItem separator{true, EditCommand::Undo, false};
    return {
        item(EditCommand::Undo, state.can_undo),
        separator,
        item(EditCommand::Cut, state.can_cut),
        item(EditCommand::Copy, state.can_copy),
        item(EditCommand::Paste, state.can_paste),
        item(EditCommand::Delete, state.can_delete),
        separator,
        item(EditCommand::SelectAll, state.can_select_all),
    };
}

std::string contextMenuLabel(EditCommand command, std::string_view language) {
    const bool russian = language == "ru";
    switch (command) {
        case EditCommand::Undo:
            return russian ? "&Отменить" : "&Undo";
        case EditCommand::Cut:
            return russian ? "&Вырезать" : "Cu&t";
        case EditCommand::Copy:
            return russian ? "&Копировать" : "&Copy";
        case EditCommand::Paste:
            return russian ? "Вст&авить" : "&Paste";
        case EditCommand::Delete:
            return russian ? "&Удалить" : "&Delete";
        case EditCommand::SelectAll:
            return russian ? "Выделить &все" : "Select &All";
    }
    return {};
}

}  // namespace mfbe::shell
