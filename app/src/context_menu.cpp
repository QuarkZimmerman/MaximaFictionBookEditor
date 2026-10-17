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
    const bool ukrainian = language == "uk";
    switch (command) {
        case EditCommand::Undo:
            return russian ? "&Отменить" : ukrainian ? "&Скасувати дію" : "&Undo";
        case EditCommand::Cut:
            return russian ? "&Вырезать" : ukrainian ? "Ви&різати" : "Cu&t";
        case EditCommand::Copy:
            return russian ? "&Копировать" : ukrainian ? "&Копіювати" : "&Copy";
        case EditCommand::Paste:
            return russian ? "Вст&авить" : ukrainian ? "&Вставити" : "&Paste";
        case EditCommand::Delete:
            return russian ? "&Удалить" : ukrainian ? "Ви&далити" : "&Delete";
        case EditCommand::SelectAll:
            return russian ? "Выделить &все" : ukrainian ? "Виділити вс&е" : "Select &All";
    }
    return {};
}

}  // namespace mfbe::shell
