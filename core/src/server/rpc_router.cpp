// JSON-RPC 2.0 router, errors and jobs (T021). See mfbe/rpc.hpp.
#include <mfbe/log.hpp>
#include <mfbe/rpc.hpp>

#include <chrono>
#include <condition_variable>
#include <thread>

namespace mfbe::rpc {

/* ----------------------------------------------------------------------------------------- */
/* Errors                                                                                     */
/* ----------------------------------------------------------------------------------------- */

const char* error_name(int code) {
    switch (code) {
        case codes::kParseError:
            return "parseError";
        case codes::kInvalidRequest:
            return "invalidRequest";
        case codes::kMethodNotFound:
            return "methodNotFound";
        case codes::kInvalidParams:
            return "invalidParams";
        case codes::kInternalError:
            return "internalError";
        case codes::kDocNotFound:
            return "doc.notFound";
        case codes::kDocParseError:
            return "doc.parseError";
        case codes::kDocIoError:
            return "doc.ioError";
        case codes::kDocSourceMalformed:
            return "doc.sourceMalformed";
        case codes::kDocNotFictionBook:
            return "doc.notFictionBook";
        case codes::kDocPositionsStale:
            return "doc.positionsStale";
        case codes::kDocSameAsOpenFile:
            return "doc.sameAsOpenFile";
        case codes::kBinaryNotFound:
            return "binary.notFound";
        case codes::kSpellDictionaryUnavailable:
            return "spell.dictionaryUnavailable";
        case codes::kScriptNotFound:
            return "script.notFound";
        case codes::kScriptInvalidManifest:
            return "script.invalidManifest";
        case codes::kSettingsInvalid:
            return "settings.invalid";
        case codes::kDialogUnavailable:
            return "dialog.unavailable";
        case codes::kReleaseUnavailable:
            return "app.releaseUnavailable";
        case codes::kRestartUnavailable:
            return "app.restartUnavailable";
        case codes::kRestartFailed:
            return "app.restartFailed";
        case codes::kCancelled:
            return "cancelled";
        case codes::kAiNoService:
            return "ai.noService";
        case codes::kAiFragmentNotAllowed:
            return "ai.fragmentNotAllowed";
        case codes::kAiScriptIdBundled:
            return "ai.scriptIdBundled";
        case codes::kAiScriptExists:
            return "ai.scriptExists";
        default:
            return "";
    }
}

RpcError::RpcError(int code_, std::string message_, json data_)
    : std::runtime_error(message_.empty() ? error_name(code_) : message_),
      code(code_),
      message(message_.empty() ? error_name(code_) : std::move(message_)),
      data(std::move(data_)) {}

json RpcError::to_json() const {
    json j;
    j["code"] = code;
    j["message"] = message;
    if (!data.is_null()) {
        j["data"] = data;
    }
    return j;
}

RpcError invalid_params(const std::string& detail, json data) {
    return RpcError(codes::kInvalidParams, "invalidParams: " + detail, std::move(data));
}

RpcError internal_error(const std::string& detail) {
    return RpcError(codes::kInternalError, "internalError: " + detail);
}

/* ----------------------------------------------------------------------------------------- */
/* Failure logging (FR-131, T152)                                                             */
/* ----------------------------------------------------------------------------------------- */

namespace {

// Where a failure comes from: the RPC method, its docId / path parameters and, for failures
// raised on a worker thread, the job id. Never the parameters themselves (they may carry the
// document) - only these identifiers.
struct Origin {
    std::string method;
    std::string doc_id;
    std::string path;
    std::string job_id;
};

std::string string_param(const json& p, const char* name) {
    if (p.is_object()) {
        auto it = p.find(name);
        if (it != p.end() && it->is_string()) {
            return it->get<std::string>();
        }
    }
    return "";
}

Origin origin_of(const std::string& method, const json& p) {
    return Origin{method, string_param(p, "docId"), string_param(p, "path"), ""};
}

// The origin of the handler running on this thread; jobs started by it inherit the origin for
// their own failure entries (the job thread has no other way to know the method).
thread_local Origin* t_current_origin = nullptr;

struct OriginScope {
    Origin* previous;
    explicit OriginScope(Origin& origin) : previous(t_current_origin) {
        t_current_origin = &origin;
    }
    ~OriginScope() { t_current_origin = previous; }
    OriginScope(const OriginScope&) = delete;
    OriginScope& operator=(const OriginScope&) = delete;
};

// Error data keys copied into the log context. Everything else (words, text, documents) is
// dropped so the log never carries book text; `message` is kept for parse errors only
// (libxml2 well-formedness messages name elements and entities, not content).
constexpr std::string_view kContextKeys[] = {"path",     "reason", "line",   "column",  "field",
                                             "id",       "lang",   "tag",    "docId",   "jobId",
                                             "scriptId", "nodeId", "format", "encoding"};

bool is_context_key(const std::string& key, int code) {
    if (key == "message") {
        return code == codes::kDocParseError;
    }
    for (std::string_view candidate : kContextKeys) {
        if (candidate == key) {
            return true;
        }
    }
    return false;
}

std::string scalar_text(const json& value) {
    if (value.is_string()) {
        const std::string text = value.get<std::string>();
        return text.size() > 300 ? text.substr(0, 300) + "..." : text;
    }
    return value.dump();
}

// Outcomes that are normal operation rather than failures: user cancellations, the
// malformed-XML feedback of the Source view (the user is typing XML; the UI shows the error),
// app.restart without a shell (browser/dev mode: the UI reloads its page, by design) and the
// AI assistant's fragment feedback (feature 005: a model's mistake - XML that is not
// well-formed or an element its parent cannot hold - is fed back to the model, not logged).
bool is_expected_outcome(const std::string& method, int code) {
    if (code == codes::kCancelled || code == codes::kRestartUnavailable) {
        return true;
    }
    if (code == codes::kDocParseError || code == codes::kDocSourceMalformed) {
        return method == "doc.fromXml" || method == "doc.validate" || method == "doc.toXml" ||
               method == "doc.fragmentFromXml";
    }
    if (code == codes::kAiFragmentNotAllowed) {
        return method == "doc.fragmentFromXml";
    }
    return false;
}

log::Level failure_level(int code) {
    switch (code) {
        case codes::kInternalError:
        case codes::kDocIoError:
        case codes::kDocParseError:
        case codes::kDocSourceMalformed:
            return log::Level::error;
        default:
            return log::Level::warning;  // protocol misuse, stale ids, unavailable resources
    }
}

// One log entry per failure reported to the client: code `rpc.<error name>`, the stable
// message, method/docId/path/jobId of the origin and the scalar identifiers of the error data.
void log_failure(const Origin& origin, int code, const std::string& message, const json& data) {
    if (is_expected_outcome(origin.method, code)) {
        return;
    }
    log::Context ctx;
    if (!origin.doc_id.empty()) {
        ctx.docId = origin.doc_id;
    }
    ctx.extra["method"] = origin.method.empty() ? "job" : origin.method;
    ctx.extra["rpcCode"] = std::to_string(code);
    if (!origin.path.empty()) {
        ctx.extra["path"] = origin.path;
    }
    if (!origin.job_id.empty()) {
        ctx.extra["jobId"] = origin.job_id;
    }
    if (data.is_object()) {
        for (const auto& [key, value] : data.items()) {
            if (!is_context_key(key, code) || value.is_object() || value.is_array()) {
                continue;
            }
            if (key == "docId" && value.is_string() && !ctx.docId) {
                ctx.docId = value.get<std::string>();
            } else if (key == "nodeId" && value.is_string()) {
                ctx.nodeId = value.get<std::string>();
            } else {
                ctx.extra[key] = scalar_text(value);
            }
        }
    }
    const char* name = error_name(code);
    const std::string log_code = std::string("rpc.") + (*name != '\0' ? name : "error");
    if (failure_level(code) == log::Level::error) {
        log::error("core", log_code, message, ctx);
    } else {
        log::warning("core", log_code, message, ctx);
    }
}

void log_failure(const Origin& origin, const RpcError& error) {
    log_failure(origin, error.code, error.message, error.data);
}

// Wraps a responder sink so an error response produced later (asynchronous handlers,
// provider callbacks) is logged exactly like a synchronous one.
Responder::Sink logging_sink(Responder::Sink sink, Origin origin) {
    return [sink = std::move(sink), origin = std::move(origin)](json response) {
        auto error = response.find("error");
        if (error != response.end() && error->is_object()) {
            log_failure(origin, error->value("code", 0), error->value("message", ""),
                        error->value("data", json()));
        }
        if (sink) {
            sink(std::move(response));
        }
    };
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Params helpers                                                                             */
/* ----------------------------------------------------------------------------------------- */

namespace params {
namespace {
const json& empty_object() {
    static const json empty = json::object();
    return empty;
}
RpcError field_error(const char* name, const std::string& detail) {
    return invalid_params(std::string(name) + " " + detail, json{{"field", name}});
}
}  // namespace

const json& object(const json& p) {
    if (p.is_null()) {
        return empty_object();
    }
    if (!p.is_object()) {
        throw invalid_params("params must be an object");
    }
    return p;
}

std::string string(const json& p, const char* name) {
    const json& o = object(p);
    auto it = o.find(name);
    if (it == o.end() || it->is_null()) {
        throw field_error(name, "is required");
    }
    if (!it->is_string()) {
        throw field_error(name, "must be a string");
    }
    return it->get<std::string>();
}

std::string string_or(const json& p, const char* name, const std::string& fallback) {
    return opt_string(p, name).value_or(fallback);
}

std::optional<std::string> opt_string(const json& p, const char* name) {
    const json& o = object(p);
    auto it = o.find(name);
    if (it == o.end() || it->is_null()) {
        return std::nullopt;
    }
    if (!it->is_string()) {
        throw field_error(name, "must be a string");
    }
    return it->get<std::string>();
}

int integer(const json& p, const char* name) {
    const json& o = object(p);
    auto it = o.find(name);
    if (it == o.end() || it->is_null()) {
        throw field_error(name, "is required");
    }
    if (!it->is_number_integer()) {
        throw field_error(name, "must be an integer");
    }
    return it->get<int>();
}

int integer_or(const json& p, const char* name, int fallback) {
    const json& o = object(p);
    auto it = o.find(name);
    if (it == o.end() || it->is_null()) {
        return fallback;
    }
    if (!it->is_number_integer()) {
        throw field_error(name, "must be an integer");
    }
    return it->get<int>();
}

bool boolean_or(const json& p, const char* name, bool fallback) {
    const json& o = object(p);
    auto it = o.find(name);
    if (it == o.end() || it->is_null()) {
        return fallback;
    }
    if (!it->is_boolean()) {
        throw field_error(name, "must be a boolean");
    }
    return it->get<bool>();
}

std::vector<std::string> string_array_or(const json& p, const char* name) {
    const json& o = object(p);
    auto it = o.find(name);
    std::vector<std::string> out;
    if (it == o.end() || it->is_null()) {
        return out;
    }
    if (!it->is_array()) {
        throw field_error(name, "must be an array of strings");
    }
    for (const auto& item : *it) {
        if (!item.is_string()) {
            throw field_error(name, "must be an array of strings");
        }
        out.push_back(item.get<std::string>());
    }
    return out;
}

const json& object_field(const json& p, const char* name) {
    const json& o = object(p);
    auto it = o.find(name);
    if (it == o.end() || it->is_null()) {
        throw field_error(name, "is required");
    }
    if (!it->is_object()) {
        throw field_error(name, "must be an object");
    }
    return *it;
}

const json* opt_field(const json& p, const char* name) {
    const json& o = object(p);
    auto it = o.find(name);
    if (it == o.end() || it->is_null()) {
        return nullptr;
    }
    return &*it;
}
}  // namespace params

/* ----------------------------------------------------------------------------------------- */
/* RecordingNotifier                                                                          */
/* ----------------------------------------------------------------------------------------- */

void RecordingNotifier::notify(const std::string& method, const json& p) {
    std::lock_guard<std::mutex> lock(mutex_);
    items_.emplace_back(method, p);
}

std::vector<std::pair<std::string, json>> RecordingNotifier::take() {
    std::lock_guard<std::mutex> lock(mutex_);
    auto out = std::move(items_);
    items_.clear();
    return out;
}

std::size_t RecordingNotifier::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return items_.size();
}

/* ----------------------------------------------------------------------------------------- */
/* Responder                                                                                  */
/* ----------------------------------------------------------------------------------------- */

struct Responder::State {
    json id;
    Sink sink;
    std::mutex mutex;
    bool done = false;

    void deliver(json response) {
        Sink s;
        {
            std::lock_guard<std::mutex> lock(mutex);
            if (done) {
                return;
            }
            done = true;
            s = std::move(sink);
        }
        if (s) {
            s(std::move(response));
        }
    }

    ~State() {
        if (!done && sink) {
            deliver(RpcRouter::make_error(id, internal_error("handler did not respond")));
        }
    }
};

Responder::Responder(json id, Sink sink) : state_(std::make_shared<State>()) {
    state_->id = std::move(id);
    state_->sink = std::move(sink);
}

void Responder::ok(json result) const {
    state_->deliver(RpcRouter::make_result(state_->id, std::move(result)));
}

void Responder::fail(const RpcError& error) const {
    state_->deliver(RpcRouter::make_error(state_->id, error));
}

const json& Responder::id() const {
    return state_->id;
}

/* ----------------------------------------------------------------------------------------- */
/* Jobs                                                                                       */
/* ----------------------------------------------------------------------------------------- */

void JobControl::check_cancelled() const {
    if (cancelled()) {
        throw RpcError(codes::kCancelled, "", json{{"jobId", id()}});
    }
}

struct JobManager::Job : JobControl {
    std::string job_id;
    Origin origin;  // RPC method (+ docId/path) that started the job, for the error log
    std::atomic<bool> cancel_flag{false};
    std::atomic<bool> finished{false};
    Notifier* notifier = nullptr;
    std::thread thread;

    const std::string& id() const override { return job_id; }
    bool cancelled() const override { return cancel_flag.load(); }
    void progress(const std::string& phase, std::int64_t done, std::int64_t total) override {
        if (notifier != nullptr) {
            notifier->notify(
                "job.progress",
                json{{"jobId", job_id}, {"phase", phase}, {"done", done}, {"total", total}});
        }
    }
};

JobManager::JobManager(Notifier& notifier) : notifier_(notifier) {}

JobManager::~JobManager() {
    shutdown();
}

std::string JobManager::start(JobFunction fn) {
    if (shutting_down_.load()) {
        throw RpcError(codes::kCancelled, "server is shutting down");
    }
    reap_finished();
    auto job = std::make_shared<Job>();
    job->notifier = &notifier_;
    if (t_current_origin != nullptr) {
        job->origin = *t_current_origin;
    }
    // The thread member is assigned under the lock so reap_finished()/shutdown() never
    // observe a half-moved std::thread.
    std::lock_guard<std::mutex> lock(mutex_);
    job->job_id = "j" + std::to_string(next_id_++);
    job->origin.job_id = job->job_id;
    jobs_[job->job_id] = job;
    const std::string id = job->job_id;
    job->thread = std::thread([this, job, fn = std::move(fn)]() mutable {
        try {
            json result = fn(*job);
            if (job->cancelled()) {
                throw RpcError(codes::kCancelled, "", json{{"jobId", job->job_id}});
            }
            notifier_.notify("job.done",
                             json{{"jobId", job->job_id}, {"result", std::move(result)}});
        } catch (const RpcError& e) {
            log_failure(job->origin, e);
            notifier_.notify("job.failed", json{{"jobId", job->job_id}, {"error", e.to_json()}});
        } catch (const std::exception& e) {
            log::error(
                "core", "job.crashed", "job raised an unexpected exception",
                log::extras({{"jobId", job->job_id},
                             {"method", job->origin.method.empty() ? "job" : job->origin.method},
                             {"what", e.what()}}));
            notifier_.notify("job.failed", json{{"jobId", job->job_id},
                                                {"error", internal_error(e.what()).to_json()}});
        }
        job->finished.store(true);
    });
    return id;
}

bool JobManager::cancel(const std::string& job_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = jobs_.find(job_id);
    if (it == jobs_.end() || it->second->finished.load()) {
        return false;
    }
    it->second->cancel_flag.store(true);
    return true;
}

bool JobManager::running(const std::string& job_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = jobs_.find(job_id);
    return it != jobs_.end() && !it->second->finished.load();
}

std::size_t JobManager::running_count() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::size_t n = 0;
    for (const auto& [id, job] : jobs_) {
        if (!job->finished.load()) {
            ++n;
        }
    }
    return n;
}

void JobManager::shutdown() {
    shutting_down_.store(true);
    std::map<std::string, std::shared_ptr<Job>> jobs;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        jobs.swap(jobs_);
    }
    for (auto& [id, job] : jobs) {
        job->cancel_flag.store(true);
    }
    for (auto& [id, job] : jobs) {
        if (job->thread.joinable()) {
            job->thread.join();
        }
    }
}

bool JobManager::wait_idle(int timeout_ms) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    while (running_count() > 0) {
        if (std::chrono::steady_clock::now() >= deadline) {
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    reap_finished();
    return true;
}

void JobManager::reap_finished() {
    std::vector<std::shared_ptr<Job>> finished;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (auto it = jobs_.begin(); it != jobs_.end();) {
            if (it->second->finished.load()) {
                finished.push_back(it->second);
                it = jobs_.erase(it);
            } else {
                ++it;
            }
        }
    }
    for (auto& job : finished) {
        if (job->thread.joinable()) {
            job->thread.join();
        }
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Router                                                                                     */
/* ----------------------------------------------------------------------------------------- */

void RpcRouter::add_method(const std::string& name, Handler handler) {
    methods_[name] = Entry{std::move(handler), nullptr};
}

void RpcRouter::add_async_method(const std::string& name, AsyncHandler handler) {
    methods_[name] = Entry{nullptr, std::move(handler)};
}

bool RpcRouter::has_method(const std::string& name) const {
    return methods_.count(name) != 0;
}

std::vector<std::string> RpcRouter::methods() const {
    std::vector<std::string> names;
    names.reserve(methods_.size());
    for (const auto& [name, entry] : methods_) {
        names.push_back(name);
    }
    return names;
}

json RpcRouter::make_result(const json& id, json result) {
    return json{{"jsonrpc", "2.0"}, {"id", id}, {"result", std::move(result)}};
}

json RpcRouter::make_error(const json& id, const RpcError& error) {
    return json{{"jsonrpc", "2.0"}, {"id", id}, {"error", error.to_json()}};
}

namespace {

// Protocol-level failures (malformed frames, unknown methods) are logged like handler ones.
json protocol_error(const json& id, const std::string& method, const RpcError& error) {
    log_failure(Origin{method, "", "", ""}, error);
    return RpcRouter::make_error(id, error);
}

}  // namespace

json RpcRouter::make_notification(const std::string& method, const json& p) {
    return json{{"jsonrpc", "2.0"}, {"method", method}, {"params", p}};
}

std::string RpcRouter::wire_text(const json& message) {
    return message.dump(-1, ' ', false, json::error_handler_t::replace);
}

std::optional<json> RpcRouter::dispatch_text(std::string_view message, RpcContext& ctx,
                                             Responder::Sink sink) const {
    json request = json::parse(message, nullptr, false);
    if (request.is_discarded()) {
        return protocol_error(nullptr, "",
                              RpcError(codes::kParseError, "parseError: invalid JSON"));
    }
    return dispatch(request, ctx, std::move(sink));
}

std::optional<json> RpcRouter::dispatch(const json& request, RpcContext& ctx,
                                        Responder::Sink sink) const {
    if (request.is_array()) {
        return protocol_error(
            nullptr, "",
            RpcError(codes::kInvalidRequest, "invalidRequest: batches are not supported"));
    }
    if (!request.is_object()) {
        return protocol_error(nullptr, "",
                              RpcError(codes::kInvalidRequest, "invalidRequest: not an object"));
    }
    json id = request.contains("id") ? request["id"] : json(nullptr);
    const bool is_notification = !request.contains("id");
    if (!id.is_null() && !id.is_string() && !id.is_number()) {
        return protocol_error(nullptr, "",
                              RpcError(codes::kInvalidRequest, "invalidRequest: bad id"));
    }
    auto version = request.find("jsonrpc");
    if (version == request.end() || !version->is_string() || version->get<std::string>() != "2.0") {
        return protocol_error(
            id, "", RpcError(codes::kInvalidRequest, "invalidRequest: jsonrpc must be \"2.0\""));
    }
    auto method_it = request.find("method");
    if (method_it == request.end() || !method_it->is_string()) {
        return protocol_error(
            id, "", RpcError(codes::kInvalidRequest, "invalidRequest: method must be a string"));
    }
    const std::string method = method_it->get<std::string>();
    json p = request.contains("params") ? request["params"] : json::object();
    if (!p.is_object() && !p.is_null()) {
        return protocol_error(id, method, invalid_params("params must be an object"));
    }
    auto entry = methods_.find(method);
    if (entry == methods_.end()) {
        if (is_notification) {
            return std::nullopt;
        }
        return protocol_error(id, method,
                              RpcError(codes::kMethodNotFound, "methodNotFound: " + method));
    }
    Origin origin = origin_of(method, p);
    const OriginScope scope(origin);
    if (entry->second.sync) {
        try {
            json result = entry->second.sync(p, ctx);
            if (is_notification) {
                return std::nullopt;
            }
            return make_result(id, std::move(result));
        } catch (const RpcError& e) {
            log_failure(origin, e);
            if (is_notification) {
                return std::nullopt;
            }
            return make_error(id, e);
        } catch (const std::exception& e) {
            log::error("core", "rpc.handlerCrashed", "handler raised an unexpected exception",
                       log::extras({{"method", method}, {"what", e.what()}}));
            if (is_notification) {
                return std::nullopt;
            }
            return make_error(id, internal_error(e.what()));
        }
    }
    // Asynchronous handler: every outcome (including synchronous exceptions) travels through
    // the responder so exactly one response is produced; error responses are logged by the
    // wrapped sink whenever they are delivered.
    Responder responder(
        id, logging_sink(is_notification ? Responder::Sink([](json) {}) : std::move(sink), origin));
    try {
        entry->second.async(p, ctx, responder);
    } catch (const RpcError& e) {
        responder.fail(e);
    } catch (const std::exception& e) {
        log::error("core", "rpc.handlerCrashed", "handler raised an unexpected exception",
                   log::extras({{"method", method}, {"what", e.what()}}));
        responder.fail(internal_error(e.what()));
    }
    return std::nullopt;
}

json RpcRouter::call(const std::string& method, const json& p, RpcContext& ctx) const {
    json request{{"jsonrpc", "2.0"}, {"id", 1}, {"method", method}, {"params", p}};
    std::mutex mutex;
    std::condition_variable cv;
    std::optional<json> async_response;
    auto sink = [&](json response) {
        std::lock_guard<std::mutex> lock(mutex);
        async_response = std::move(response);
        cv.notify_all();
    };
    auto response = dispatch(request, ctx, sink);
    if (response) {
        return *response;
    }
    std::unique_lock<std::mutex> lock(mutex);
    cv.wait(lock, [&] { return async_response.has_value(); });
    return *async_response;
}

}  // namespace mfbe::rpc
