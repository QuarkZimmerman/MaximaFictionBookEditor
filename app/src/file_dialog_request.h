// The shell's file dialog request and its conversion into each platform dialog's terms (feature
// 002, decision D14): Windows filter specs and the 1-based type index, GTK glob patterns that
// ignore letter case, macOS extension lists, the folder and name Save As opens on, the encoding
// choice of Save As and the accept filters of CEF's own dialog (the fallback).
//
// Plain C++ without CEF types or exceptions (library mfbe_shell_logic): used by the platform
// dialogs (file_dialog_win.cpp, file_dialog_gtk.cpp, file_dialog_mac.mm), by dialog_provider.cpp
// and by tests/shell/test_file_dialogs.cpp.
#pragma once

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

namespace mfbe::shell {

struct FileFilter {
    std::string name;                     // shown as written: "FictionBook files (*.fb2)"
    std::vector<std::string> extensions;  // without the dot ("fb2"); "*" = all files
};

enum class FileDialogMode { kOpen, kOpenMultiple, kSave, kFolder };

struct FileDialogRequest {
    FileDialogMode mode = FileDialogMode::kOpen;
    std::string title;                   // empty = the platform's default title
    std::vector<FileFilter> filters;     // in display order
    int selected_filter = 0;             // index of the type selected when the dialog opens
    std::string folder;                  // where the dialog opens ("" = the platform's choice)
    std::string default_path;            // Save: the current file, or a name without a folder
    std::vector<std::string> encodings;  // Save As: the "Encoding:" choice, the first selected
    std::string encoding_label;          // label of that choice
    bool document_dialog = false;        // Open / Save As of a document: one remembered folder
};

struct FileDialogResult {
    bool cancelled = true;           // true when dismissed without a selection
    std::vector<std::string> paths;  // UTF-8; one entry except for kOpenMultiple
    std::string encoding;            // Save As: the chosen encoding ("" when none was offered)
};

using FileDialogCallback = std::function<void(FileDialogResult)>;

// The index of the type selected when the dialog opens: `selected_filter` when it names a type,
// otherwise 0.
std::size_t selectedFilterIndex(const FileDialogRequest& request);

// "fb2", ".fb2" and "*.fb2" -> "fb2"; "*" and "*.*" -> "*".
std::string bareExtension(const std::string& extension);

// True when the type lists every file ("*").
bool listsAllFiles(const FileFilter& filter);

// Windows COMDLG_FILTERSPEC pattern: "*.jpg;*.jpeg;*.png", "*.*" for all files.
std::string windowsFilterSpec(const FileFilter& filter);

// IFileDialog::SetFileTypeIndex counts from 1.
unsigned windowsFileTypeIndex(const FileDialogRequest& request);

// The extension a save dialog adds to a name typed without one: the selected type's first
// extension ("fb2"); "" for all files and for open dialogs.
std::string defaultExtension(const FileDialogRequest& request);

// GTK 3 matches glob patterns case-sensitively: every letter of the extension matches both
// cases, "fb2" -> "*.[fF][bB]2"; "*" -> "*".
std::string gtkPattern(const std::string& extension);
std::vector<std::string> gtkPatterns(const FileFilter& filter);

// macOS: the lower-case extensions of a type; empty for all files.
std::vector<std::string> macExtensions(const FileFilter& filter);

// Where a save dialog opens and the name it proposes: the folder and name of `default_path`, or
// `folder` and a name without a folder (or no name).
struct SavePlace {
    std::string folder;
    std::string name;
};
SavePlace savePlace(const FileDialogRequest& request);

// Label of the Save As encoding choice in the shell's language, as the original's IDS_ENCODING.
std::string encodingLabel(const std::string& language);

// Windows IFileDialogCustomize items of the encoding choice: 1100 + index, as the original.
inline constexpr unsigned kEncodingItemBase = 1100;
// The encoding of an item id; "" when the id names none.
std::string encodingOfItem(const FileDialogRequest& request, unsigned item_id);

// CEF's own dialog (the fallback) accepts only ".ext" filters - CEF 150 passes "Name|.ext"
// unchanged to Chromium, which drops it: the selected type's extensions; none for all files.
std::vector<std::string> cefAcceptFilters(const FileDialogRequest& request);

}  // namespace mfbe::shell
