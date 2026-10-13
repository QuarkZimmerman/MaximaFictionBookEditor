// Native dialog provider interface (T025) - contracts/rpc-api.md §3.9.
//
// The shell (CEF) implements DialogProvider with native dialogs; headless/test runs attach the
// QueuedDialogProvider fed by `test.enqueueDialog`. All calls are asynchronous: the provider
// invokes the callback exactly once, from any thread; the core marshals the result back to
// its transport thread. Without a provider every dialog.* RPC fails with 1050
// `dialog.unavailable`.
//
// JSON shapes (as on the wire):
//   openFile   {title, filters: [{name, extensions: ["fb2","fbd"]}], multiple?} -> {paths: []}
//   saveFile   {title, filters, defaultPath?, encodingChoices?: []} -> {path?, encoding?}
//   pickFolder {title} -> {path?}
//   message    {text, caption, buttons: ["OK","Cancel"]} -> {button}
#pragma once

#include <nlohmann/json.hpp>

#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace mfbe {

struct FileFilter {
    std::string name;                     // e.g. "FictionBook files"
    std::vector<std::string> extensions;  // without dot, e.g. {"fb2", "fbd"}
};

struct OpenFileRequest {
    std::string title;
    std::vector<FileFilter> filters;
    bool multiple = false;
};
struct OpenFileResult {
    std::vector<std::string> paths;  // empty = cancelled
};

struct SaveFileRequest {
    std::string title;
    std::vector<FileFilter> filters;
    std::optional<std::string> defaultPath;
    std::vector<std::string> encodingChoices;  // the "Encoding:" extra control
};
struct SaveFileResult {
    std::optional<std::string> path;  // nullopt = cancelled
    std::optional<std::string> encoding;
};

struct PickFolderRequest {
    std::string title;
};
struct PickFolderResult {
    std::optional<std::string> path;
};

struct MessageRequest {
    std::string text;
    std::string caption;
    std::vector<std::string> buttons;
};
struct MessageResult {
    std::string button;
};

nlohmann::json to_json(const FileFilter& f);
nlohmann::json to_json(const OpenFileRequest& r);
nlohmann::json to_json(const OpenFileResult& r);
nlohmann::json to_json(const SaveFileRequest& r);
nlohmann::json to_json(const SaveFileResult& r);
nlohmann::json to_json(const PickFolderRequest& r);
nlohmann::json to_json(const PickFolderResult& r);
nlohmann::json to_json(const MessageRequest& r);
nlohmann::json to_json(const MessageResult& r);

// Tolerant parsers (missing fields -> defaults); throw std::invalid_argument on wrong types.
OpenFileRequest open_file_request_from_json(const nlohmann::json& j);
OpenFileResult open_file_result_from_json(const nlohmann::json& j);
SaveFileRequest save_file_request_from_json(const nlohmann::json& j);
SaveFileResult save_file_result_from_json(const nlohmann::json& j);
PickFolderRequest pick_folder_request_from_json(const nlohmann::json& j);
PickFolderResult pick_folder_result_from_json(const nlohmann::json& j);
MessageRequest message_request_from_json(const nlohmann::json& j);
MessageResult message_result_from_json(const nlohmann::json& j);

// Thrown synchronously by a provider that cannot show the dialog right now (no window, no
// queued test answer); the RPC fails with 1050 `dialog.unavailable` {reason}.
struct DialogUnavailable : std::runtime_error {
    using std::runtime_error::runtime_error;
};

class DialogProvider {
public:
    virtual ~DialogProvider() = default;

    template <typename R>
    using Callback = std::function<void(R)>;

    virtual void open_file(const OpenFileRequest& request, Callback<OpenFileResult> done) = 0;
    virtual void save_file(const SaveFileRequest& request, Callback<SaveFileResult> done) = 0;
    virtual void pick_folder(const PickFolderRequest& request, Callback<PickFolderResult> done) = 0;
    virtual void message(const MessageRequest& request, Callback<MessageResult> done) = 0;

    // Shell-delegated "open this folder in the file manager" (app.openFolder/openLogFolder).
    // Return false to let the core fall back to the OS default opener (xdg-open/explorer/open).
    virtual bool open_path(const std::string& /*path*/) { return false; }
};

// Answers dialogs from a FIFO queue of pre-recorded results (`test.enqueueDialog`).
// Thread-safe; callbacks are invoked synchronously inside the call. A call whose queue head
// is missing or belongs to another method throws DialogUnavailable (and records the miss)
// so tests see 1050 instead of a silent "cancelled".
class QueuedDialogProvider : public DialogProvider {
public:
    struct Queued {
        std::string method;     // "dialog.openFile" | "dialog.saveFile" | "dialog.pickFolder" |
                                // "dialog.message"
        nlohmann::json result;  // the result object to return
    };

    // Returns the queue length after enqueueing.
    std::size_t enqueue(const std::string& method, nlohmann::json result);
    std::size_t pending() const;
    void clear();
    // Dialog calls that found no queued answer (method names), for diagnostics.
    std::vector<std::string> missed() const;
    // Paths passed to open_path (recorded, nothing is opened).
    std::vector<std::string> opened_paths() const;

    void open_file(const OpenFileRequest& request, Callback<OpenFileResult> done) override;
    void save_file(const SaveFileRequest& request, Callback<SaveFileResult> done) override;
    void pick_folder(const PickFolderRequest& request, Callback<PickFolderResult> done) override;
    void message(const MessageRequest& request, Callback<MessageResult> done) override;
    bool open_path(const std::string& path) override;

private:
    std::optional<nlohmann::json> take(const std::string& method);
    mutable std::mutex mutex_;
    std::deque<Queued> queue_;
    std::vector<std::string> missed_;
    std::vector<std::string> opened_paths_;
};

}  // namespace mfbe
