// Embeddable core server (T011/T022): loopback HTTP + WebSocket JSON-RPC on 127.0.0.1.
//
// Used by `mfbe-core serve` and, in-process, by the CEF shell. The server runs its event loop
// on a dedicated thread; start() returns once the port is bound. URL for the UI:
//   http://127.0.0.1:<port>/?token=<token>      (WebSocket: ws://127.0.0.1:<port>/rpc?token=…)
#pragma once

#include <cstddef>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace mfbe {

// Folders and file names are UTF-8 text (mfbe/utf8_paths.hpp).
struct CoreServerOptions {
    std::string ui_dir;         // static UI bundle dir ("" = none)
    std::string data_dir;       // override per-user config/data root ("" = platform default)
    std::string resources_dir;  // bundled resources root ("" = auto: next to exe
                                // ../share/mfbe/resources or MFBE_RESOURCES_SOURCE_DIR)
    std::string scripts_dir;    // bundled scripts root ("" = auto)
    int port = 0;               // 0 = OS-assigned
    std::string token;          // "" = generate 128-bit random hex
    bool test_hooks = false;    // enable test.* methods and the queued dialog provider
                                // (only if compiled with MFBE_TEST_HOOKS)
    std::vector<std::string> open_paths;  // documents to open at start (app.openPaths)
};

class DialogProvider;     // mfbe/dialog_provider.hpp
class ClipboardProvider;  // mfbe/clipboard_provider.hpp

class CoreServer {
public:
    // Starts the server; throws std::runtime_error on failure (port in use, bad data dir...).
    static std::unique_ptr<CoreServer> start(const CoreServerOptions& options);
    ~CoreServer();
    CoreServer(const CoreServer&) = delete;
    CoreServer& operator=(const CoreServer&) = delete;

    int port() const;
    const std::string& token() const;
    std::string url() const;  // http://127.0.0.1:<port>/?token=<token>

    void set_dialog_provider(std::shared_ptr<DialogProvider> provider);
    // Shell hook for binary.addFromClipboard (headless: none -> 1050 dialog.unavailable).
    void set_clipboard_provider(std::shared_ptr<ClipboardProvider> provider);
    // Emits the app.openPaths notification (queued for the first client when none is
    // connected yet).
    void notify_open_paths(const std::vector<std::string>& paths);
    // Shell close handshake (feature 003 FR-013, rpc-api.md §3.1): emits app.closeRequested to
    // every connected UI; the UI runs its quit flow (cancel-script prompt, save prompt) and ends
    // it with app.quit. `on_delivered` - optional, called on the server thread, or at once
    // when the server is not running - tells whether any client was connected to receive the
    // request, so the shell closes right away when nobody can answer.
    void request_close(std::function<void(bool delivered)> on_delivered = {});
    // Reports the number of connected UI clients to `on_result` (server thread; at once with 0
    // when the server is not running). The shell's close handshake uses it to tell a UI that
    // declined to close from one that cannot answer any more.
    void count_clients(std::function<void(std::size_t count)> on_result);

    void stop();  // idempotent; also triggered by app.quit
    void wait();  // blocks until stopped
    bool stopped() const;

private:
    CoreServer();
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mfbe
