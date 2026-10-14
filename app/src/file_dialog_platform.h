// The platform's own file dialogs (feature 002, decision D14), shown instead of CEF's dialog,
// which drops named file types, cannot preselect one and loses the Save As folder:
//
//   Windows  Common Item Dialog (IFileOpenDialog / IFileSaveDialog) - file_dialog_win.cpp
//   Linux    GTK 3 GtkFileChooserNative, loaded at run time (portal-aware) - file_dialog_gtk.cpp
//   macOS    NSOpenPanel / NSSavePanel with a file-type pop-up - file_dialog_mac.mm
//
// Each shows the named types in order with the selected one active, the folder and name of the
// request and, for Save As, the encoding choice inside the dialog. Plain C++ (no CEF types);
// compiled into mfbe_app_bridge, one implementation per platform.
#pragma once

#include "file_dialog_request.h"

#include <cstdint>
#include <string>
#include <vector>

namespace mfbe::shell {

// Shows the platform dialog for `request`; called on the CEF UI thread with the owner window's
// native handle (HWND, X11 window id or NSView*; 0 when unknown). `done` runs exactly once on
// the UI thread - before the return on Windows, later on Linux and macOS. Returns false, without
// calling `done`, when the platform dialog cannot be used; `why` then says why and the caller
// shows CEF's own dialog.
bool runPlatformFileDialog(std::uintptr_t owner, const FileDialogRequest& request,
                           FileDialogCallback done, std::string* why);

#if defined(__linux__)
// Self-test hooks (MFBE_SHELL_SELFTEST=openfile), UI thread: the type names and the active type
// of the open GTK dialog as GTK reports them and whether its window is on the screen; cancelling
// it from code. False when no GTK dialog is open.
bool describeOpenGtkFileDialog(std::vector<std::string>* type_names, std::string* active_type,
                               bool* shown);
bool cancelOpenGtkFileDialog();
#endif

}  // namespace mfbe::shell
