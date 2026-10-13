// OS-level actions performed by the shell (T139): external URLs, "open this folder in the
// file manager" (DialogProvider::open_path for app.openLogFolder / app.openFolder /
// resources.openGenresFolder / openScriptsFolder), clipboard image bytes for
// `binary.addFromClipboard` and the document-path test used by the drag-and-drop handler.
//
// Plain C++, no CEF, no exceptions. The macOS clipboard reader lives in
// native_actions_mac.mm (Objective-C++); everything else is in native_actions.cpp.
#pragma once

#include <optional>
#include <string>

namespace mfbe::shell {

// Opens an http(s)/mailto URL in the user's default browser/mail client (xdg-open, open,
// ShellExecute). Other schemes are refused. Never blocks on the launched application.
bool openExternalUrl(const std::string& url);

// Shows an existing directory in the OS file manager (xdg-open / open / Explorer).
// Returns false when the path is not a directory or the launcher could not be started.
bool openFolderInFileManager(const std::string& path);

struct ClipboardImageData {
    std::string bytes;         // encoded image exactly as the clipboard provided it
    std::string content_type;  // "image/png", "image/jpeg", "image/bmp" or "" (sniff)
};

// Reads an image from the OS clipboard; nullopt when there is none (or no clipboard).
//   Windows: "PNG" registered format first, then CF_DIBV5/CF_DIB wrapped as a BMP file.
//            Any thread.
//   macOS:   NSPasteboard PNG, otherwise TIFF re-encoded as PNG. Any thread.
//   Linux:   GTK 3 loaded at run time with dlopen (no link-time dependency; Chromium has
//            already loaded and initialised it in the browser process): "image/png" or
//            "image/jpeg" selection targets first, otherwise the pixbuf encoded as PNG.
//            MUST be called on the main (CEF UI) thread; the bridge marshals the call.
std::optional<ClipboardImageData> readClipboardImage();

// True for paths the editor opens as documents: .fb2, .fbd, .xml (case-insensitive).
bool isDocumentPath(const std::string& path);

// Windows: tells Explorer that file associations changed (SHChangeNotify SHCNE_ASSOCCHANGED)
// so .fb2/.fbd icons and "Open with" entries written by the MSI appear without a log-off.
// The shell calls it once per installed build (marker file in the data folder). No-op
// elsewhere.
void notifyFileAssociationsChanged();

}  // namespace mfbe::shell
