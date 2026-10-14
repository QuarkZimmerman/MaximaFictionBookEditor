// JSON-RPC 2.0 router, error table and background jobs (T021) - contracts/rpc-api.md §1.
//
// Wire format
//   request       {"jsonrpc":"2.0","id":1,"method":"app.info","params":{}}
//   response      {"jsonrpc":"2.0","id":1,"result":{...}}
//   error         {"jsonrpc":"2.0","id":1,"error":{"code":1050,"message":"dialog.unavailable",
//                  "data":{...}}}   - `message` is the stable name from the error table unless
//                  the handler supplied a more specific text; `data` carries the documented fields
//   notification  {"jsonrpc":"2.0","method":"settings.changed","params":{...}}  (server -> client)
// Batch requests are not supported (-32600).
//
// Threading: handlers run on the transport thread (the uWebSockets loop) one at a time.
// Long operations use JobManager::start (worker thread, `job.progress/done/failed` through the
// Notifier) or an async handler (`add_async_method`) that responds later via Responder.
#pragma once

#include <nlohmann/json.hpp>

#include <atomic>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace mfbe::rpc {

using json = nlohmann::json;

/* ----------------------------------------------------------------------------------------- */
/* Errors                                                                                     */
/* ----------------------------------------------------------------------------------------- */

namespace codes {
inline constexpr int kParseError = -32700;
inline constexpr int kInvalidRequest = -32600;
inline constexpr int kMethodNotFound = -32601;
inline constexpr int kInvalidParams = -32602;
inline constexpr int kInternalError = -32603;
inline constexpr int kDocNotFound = 1000;
inline constexpr int kDocParseError = 1001;
inline constexpr int kDocIoError = 1002;
inline constexpr int kDocSourceMalformed = 1003;
inline constexpr int kDocNotFictionBook = 1004;
inline constexpr int kBinaryNotFound = 1010;
inline constexpr int kSpellDictionaryUnavailable = 1020;
inline constexpr int kScriptNotFound = 1030;
inline constexpr int kScriptInvalidManifest = 1031;
inline constexpr int kSettingsInvalid = 1040;
inline constexpr int kDialogUnavailable = 1050;
inline constexpr int kReleaseUnavailable = 1060;
inline constexpr int kCancelled = 1090;
}  // namespace codes

// Stable name of an error code ("doc.notFound", "invalidParams", ...); "" for unknown codes.
const char* error_name(int code);

struct RpcError : std::runtime_error {
    explicit RpcError(int code_, std::string message_ = "", json data_ = nullptr);
    int code;
    std::string message;
    json data;

    json to_json() const;  // {"code","message","data"?}
};

// Convenience constructors for the common cases.
RpcError invalid_params(const std::string& detail, json data = nullptr);
RpcError internal_error(const std::string& detail);

/* ----------------------------------------------------------------------------------------- */
/* Params validation helpers                                                                  */
/* ----------------------------------------------------------------------------------------- */

namespace params {
// All throw RpcError(-32602) with data {"field": name} on failure.
const json& object(const json& p);  // params must be an object (null/absent -> empty object)
std::string string(const json& p, const char* name);
std::string string_or(const json& p, const char* name, const std::string& fallback);
std::optional<std::string> opt_string(const json& p, const char* name);
int integer(const json& p, const char* name);
int integer_or(const json& p, const char* name, int fallback);
bool boolean_or(const json& p, const char* name, bool fallback);
std::vector<std::string> string_array_or(const json& p, const char* name);
const json& object_field(const json& p, const char* name);  // required object
const json* opt_field(const json& p, const char* name);     // nullptr when absent/null
}  // namespace params

/* ----------------------------------------------------------------------------------------- */
/* Notifications and responses                                                                */
/* ----------------------------------------------------------------------------------------- */

// Sends server notifications (broadcast to every connected client). Thread-safe.
class Notifier {
public:
    virtual ~Notifier() = default;
    virtual void notify(const std::string& method, const json& params) = 0;
};

// Collects notifications in memory (tests, CLI).
class RecordingNotifier : public Notifier {
public:
    void notify(const std::string& method, const json& params) override;
    std::vector<std::pair<std::string, json>> take();
    std::size_t size() const;

private:
    mutable std::mutex mutex_;
    std::vector<std::pair<std::string, json>> items_;
};

// Delivers an asynchronous response exactly once. Copyable; thread-safe; a Responder that is
// destroyed without responding answers with an internal error.
class Responder {
public:
    using Sink = std::function<void(json response)>;  // receives a full JSON-RPC response
    Responder(json id, Sink sink);
    void ok(json result) const;
    void fail(const RpcError& error) const;
    const json& id() const;

private:
    struct State;
    std::shared_ptr<State> state_;
};

/* ----------------------------------------------------------------------------------------- */
/* Jobs                                                                                       */
/* ----------------------------------------------------------------------------------------- */

class JobControl {
public:
    virtual ~JobControl() = default;
    virtual const std::string& id() const = 0;
    virtual bool cancelled() const = 0;
    // Emits job.progress {jobId, phase, done, total}.
    virtual void progress(const std::string& phase, std::int64_t done, std::int64_t total) = 0;
    // Throws RpcError(1090) when cancelled - call at convenient points.
    void check_cancelled() const;
};

// Runs on a worker thread; returns the job result (-> job.done {jobId, result}); throwing
// RpcError -> job.failed {jobId, error}; any other exception -> internal error.
using JobFunction = std::function<json(JobControl& control)>;

class JobManager {
public:
    explicit JobManager(Notifier& notifier);
    ~JobManager();
    JobManager(const JobManager&) = delete;
    JobManager& operator=(const JobManager&) = delete;

    // Starts `fn` on a new worker thread and returns its jobId ("j<counter>").
    std::string start(JobFunction fn);
    // Requests cancellation; the job observes it via JobControl. False when unknown/finished.
    bool cancel(const std::string& job_id);
    bool running(const std::string& job_id) const;
    std::size_t running_count() const;
    // Cancels everything and joins all workers.
    void shutdown();
    // Waits (polling) until no job is running or the timeout elapses; returns true when idle.
    bool wait_idle(int timeout_ms);

private:
    struct Job;
    void reap_finished();
    Notifier& notifier_;
    mutable std::mutex mutex_;
    std::map<std::string, std::shared_ptr<Job>> jobs_;
    std::uint64_t next_id_ = 1;
    std::atomic<bool> shutting_down_{false};
};

/* ----------------------------------------------------------------------------------------- */
/* Router                                                                                     */
/* ----------------------------------------------------------------------------------------- */

struct RpcContext {
    Notifier& notifier;     // broadcast notifications
    JobManager& jobs;       // long operations
    std::string client_id;  // transport connection id ("" for in-process dispatch)
};

using Handler = std::function<json(const json& params, RpcContext& ctx)>;
using AsyncHandler = std::function<void(const json& params, RpcContext& ctx, Responder respond)>;

class RpcRouter {
public:
    void add_method(const std::string& name, Handler handler);
    void add_async_method(const std::string& name, AsyncHandler handler);
    bool has_method(const std::string& name) const;
    std::vector<std::string> methods() const;

    // Dispatches one raw message. Synchronous responses are returned; asynchronous ones go
    // through `sink` later (the sink is also used when `respond` is needed after return).
    // Returns nullopt for notifications (requests without id) and for async handlers.
    std::optional<json> dispatch_text(std::string_view message, RpcContext& ctx,
                                      Responder::Sink sink) const;
    std::optional<json> dispatch(const json& request, RpcContext& ctx, Responder::Sink sink) const;

    // Convenience for in-process callers/tests: dispatches a request object synchronously
    // (async handlers are awaited) and returns the full response.
    json call(const std::string& method, const json& params, RpcContext& ctx) const;

    static json make_result(const json& id, json result);
    static json make_error(const json& id, const RpcError& error);
    static json make_notification(const std::string& method, const json& params);
    // Text of a message on the wire. A string that is not valid UTF-8 (an operating-system
    // message in a legacy code page) gets U+FFFD instead of ending the reply with an exception.
    static std::string wire_text(const json& message);

private:
    struct Entry {
        Handler sync;
        AsyncHandler async;
    };
    std::map<std::string, Entry> methods_;
};

}  // namespace mfbe::rpc
