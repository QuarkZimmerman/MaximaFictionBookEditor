// Feature 008: the receiving copy's window comes to the front when a book is opened from the file
// manager (Windows foreground rules). A start from the file manager may take the foreground;
// a copy running in the background may not, so the start that relays the book hands its right
// on and raises the receiving copy's window itself. No-ops on Linux and macOS, where the window
// manager or LaunchServices activate the window.
#pragma once

namespace mfbe::shell {

// Before relaying: lets the process `pid` take the foreground.
void allowForeground(long long pid);

// After relaying: brings the main window of the process `pid` to the front, restored when
// minimised; does nothing when the process has no visible top-level window.
void bringProcessWindowToFront(long long pid);

}  // namespace mfbe::shell
