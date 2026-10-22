// test.* handlers (T025) - compiled only with MFBE_TEST_HOOKS, registered only with
// --test-hooks: test.enqueueDialog, test.corpusSample, test.metrics, test.injectFault,
// test.enqueueClipboardImage; feature 002: test.dialogRequests, test.beeps,
// test.enqueueRelease; feature 003: test.requests, test.restartRequests, test.requestClose;
// feature 004: test.setKeyboardLayouts, test.keyboardLayoutRequests; feature 005:
// test.aiRequests, test.resetAiRequests, test.setAiResolve, test.setAiTimeouts.
#ifdef MFBE_TEST_HOOKS

#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/corpus_sample.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>

#include <map>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace mfbe::server {
namespace {

using nlohmann::json;

constexpr const char* kDefaultCorpusRoot = "/book_disk/books";

// Candidate lists are expensive to compute (hundreds of thousands of folders); cache them per
// (root, includeFbd) for the lifetime of the process.
struct CorpusCache {
    std::mutex mutex;
    std::map<std::string, std::vector<std::string>> candidates;
};

CorpusCache& corpus_cache() {
    static CorpusCache cache;
    return cache;
}

std::optional<atomic_file::FaultPoint> fault_point_from_string(const std::string& name) {
    using atomic_file::FaultPoint;
    if (name == "none") {
        return FaultPoint::none;
    }
    if (name == "before_write" || name == "beforeWrite") {
        return FaultPoint::before_write;
    }
    if (name == "during_write" || name == "duringWrite") {
        return FaultPoint::during_write;
    }
    if (name == "before_fsync" || name == "beforeFsync") {
        return FaultPoint::before_fsync;
    }
    if (name == "before_rename" || name == "beforeRename") {
        return FaultPoint::before_rename;
    }
    return std::nullopt;
}

}  // namespace

void register_test_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("test.enqueueDialog", [&services](const json& params, rpc::RpcContext&) {
        const std::string method = rpc::params::string(params, "method");
        if (method.rfind("dialog.", 0) != 0) {
            throw rpc::invalid_params("method must be a dialog.* method",
                                      json{{"field", "method"}});
        }
        const json* result = rpc::params::opt_field(params, "result");
        if (!services.queued_dialogs) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "queued dialog provider not active"}});
        }
        const std::size_t queued =
            services.queued_dialogs->enqueue(method, result != nullptr ? *result : json::object());
        return json{{"queued", queued}};
    });

    // Every file dialog request since start, answered or not (journeys assert the offered types,
    // the selected type and the folder).
    router.add_method("test.dialogRequests", [&services](const json&, rpc::RpcContext&) {
        if (!services.queued_dialogs) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "queued dialog provider not active"}});
        }
        return json(services.queued_dialogs->dialog_requests());
    });

    router.add_method("test.beeps", [&services](const json&, rpc::RpcContext&) {
        if (!services.queued_dialogs) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "queued dialog provider not active"}});
        }
        return json{{"count", services.queued_dialogs->beeps()}};
    });

    // test.enqueueRelease({result: {tag, version?, url?}} | {error: {reason}}) -> {queued}:
    // pre-answers the next app.latestRelease (the checks never contact the release service).
    router.add_method("test.enqueueRelease", [&services](const json& params, rpc::RpcContext&) {
        if (!services.queued_dialogs) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "queued dialog provider not active"}});
        }
        ReleaseResult result;
        try {
            result = release_result_from_json(rpc::params::object(params));
        } catch (const std::invalid_argument& e) {
            throw rpc::invalid_params(e.what());
        }
        return json{{"queued", services.queued_dialogs->enqueue_release(std::move(result))}};
    });

    // test.requests() -> [{method, at}]: the shell-delegated network requests
    // (app.latestRelease) made since start, answered or not, so journeys assert that "never"
    // and a not-yet-due schedule make none.
    router.add_method("test.requests", [&services](const json&, rpc::RpcContext&) {
        if (!services.queued_dialogs) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "queued dialog provider not active"}});
        }
        return json(services.queued_dialogs->network_requests());
    });

    // test.restartRequests() -> [{reopen?, argv}]: the app.restart calls the test provider
    // recorded (headless mode answers them with error 1070 after recording).
    router.add_method("test.restartRequests", [&services](const json&, rpc::RpcContext&) {
        if (!services.queued_dialogs) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "queued dialog provider not active"}});
        }
        return json(services.queued_dialogs->restart_requests());
    });

    // test.requestClose() -> {}: emits app.closeRequested to every client exactly as the
    // shell's close handshake does, so the window-close path runs headless.
    router.add_method("test.requestClose", [](const json&, rpc::RpcContext& ctx) {
        ctx.notifier.notify("app.closeRequested", json::object());
        return json::object();
    });

    // The recording stand-in answers the test methods only while it is the provider in effect:
    // a shell that attached its own provider (the CEF shell under --test-hooks) makes them 1050.
    const auto recording_layouts =
        [&services]() -> std::shared_ptr<RecordingKeyboardLayoutProvider> {
        if (!services.recording_layouts ||
            services.keyboard_layouts() != services.recording_layouts) {
            throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                json{{"reason", "recording keyboard layout provider not active"}});
        }
        return services.recording_layouts;
    };

    // test.setKeyboardLayouts({supported, reason?, layouts: [{id, name}], current?}) -> {}:
    // reseeds the recording keyboard layout stand-in (feature 004 US11); 1050 when a shell with
    // a real provider is attached instead.
    router.add_method("test.setKeyboardLayouts",
                      [recording_layouts](const json& params, rpc::RpcContext&) {
                          auto provider = recording_layouts();
                          KeyboardLayoutList list;
                          try {
                              list = keyboard_layout_list_from_json(rpc::params::object(params));
                          } catch (const std::invalid_argument& e) {
                              throw rpc::invalid_params(e.what());
                          }
                          provider->seed(std::move(list));
                          return json::object();
                      });

    // test.keyboardLayoutRequests() -> [{id, at, activated}]: every system.activateKeyboardLayout
    // the stand-in received since start, so journeys assert "exactly one request per document
    // opened, none with the option off" (SC-011).
    router.add_method("test.keyboardLayoutRequests",
                      [recording_layouts](const json&, rpc::RpcContext&) {
                          return json(recording_layouts()->requests());
                      });

    // Feature 005 (rpc-api.md §5): the AI request record and the HTTP client's overrides.
    // test.aiRequests() -> AiRequestRecord[]: every ai.complete / ai.models / ai.test call
    // since start or the last reset - a 1200 refusal as `refused`, a job.cancel as
    // `cancelled`; never a body, a header, a key, the model or the answer.
    router.add_method("test.aiRequests", [&services](const json&, rpc::RpcContext&) {
        json out = json::array();
        for (const auto& record : services.ai.records()) {
            out.push_back(record.to_json());
        }
        return out;
    });
    router.add_method("test.resetAiRequests", [&services](const json&, rpc::RpcContext&) {
        services.ai.reset_records();
        return json::object();
    });
    // test.setAiResolve({entries}) -> {}: CURLOPT_RESOLVE entries "host:port:address" applied
    // to every later request; [] clears them (a hosted name for the loopback stand-in).
    router.add_method("test.setAiResolve", [&services](const json& params, rpc::RpcContext&) {
        const json* entries = rpc::params::opt_field(params, "entries");
        if (entries == nullptr || !entries->is_array()) {
            throw rpc::invalid_params("entries must be an array of \"host:port:address\"",
                                      json{{"field", "entries"}});
        }
        std::vector<std::string> resolved;
        for (const auto& entry : *entries) {
            if (!entry.is_string()) {
                throw rpc::invalid_params("entries must be an array of \"host:port:address\"",
                                          json{{"field", "entries"}});
            }
            const std::string text = entry.get<std::string>();
            const auto first = text.find(':');
            const auto second = first == std::string::npos ? first : text.find(':', first + 1);
            if (first == std::string::npos || first == 0 || second == std::string::npos ||
                second + 1 >= text.size() || second == first + 1) {
                throw rpc::invalid_params("entries must be an array of \"host:port:address\"",
                                          json{{"field", "entries"}});
            }
            resolved.push_back(text);
        }
        services.ai.set_resolve_entries(std::move(resolved));
        return json::object();
    });
    // test.setAiTimeouts({connectMs, totalMs}) -> {}: replaces the connect and the total
    // time-out for every later exchange until the core exits (every core start begins with
    // the Definitions' 20 s / 120 s; nothing else can change them).
    router.add_method("test.setAiTimeouts", [&services](const json& params, rpc::RpcContext&) {
        const int connect_ms = rpc::params::integer(params, "connectMs");
        const int total_ms = rpc::params::integer(params, "totalMs");
        if (connect_ms <= 0) {
            throw rpc::invalid_params("connectMs must be a positive integer",
                                      json{{"field", "connectMs"}});
        }
        if (total_ms <= 0) {
            throw rpc::invalid_params("totalMs must be a positive integer",
                                      json{{"field", "totalMs"}});
        }
        services.ai.set_timeouts(connect_ms, total_ms);
        return json::object();
    });

    router.add_async_method(
        "test.corpusSample", [](const json& params, rpc::RpcContext&, rpc::Responder respond) {
            const int count = rpc::params::integer_or(params, "count", 50);
            const int seed = rpc::params::integer_or(params, "seed", 1);
            const bool include_fbd = rpc::params::boolean_or(params, "includeFbd", false);
            const int max_scan = rpc::params::integer_or(params, "maxScan", 0);
            const std::string root = rpc::params::string_or(params, "root", kDefaultCorpusRoot);
            if (count < 0 || seed < 0 || max_scan < 0) {
                throw rpc::invalid_params("count, seed and maxScan must be non-negative");
            }
            const std::filesystem::path root_dir = platform::path_from_utf8(root);
            std::error_code ec;
            if (!std::filesystem::is_directory(root_dir, ec)) {
                throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                    json{{"path", root}, {"reason", "corpus root not found"}});
            }
            // Scanning can take minutes on the full library: run it off the loop thread.
            std::thread([=] {
                const std::string key =
                    root + "|" + (include_fbd ? "fbd" : "fb2") + "|" + std::to_string(max_scan);
                std::vector<std::string> candidates;
                {
                    std::lock_guard<std::mutex> lock(corpus_cache().mutex);
                    auto it = corpus_cache().candidates.find(key);
                    if (it != corpus_cache().candidates.end()) {
                        candidates = it->second;
                    }
                }
                if (candidates.empty()) {
                    candidates = corpus::scan_candidates(root_dir, include_fbd,
                                                         static_cast<std::size_t>(max_scan));
                    std::lock_guard<std::mutex> lock(corpus_cache().mutex);
                    corpus_cache().candidates[key] = candidates;
                }
                const std::size_t scanned = candidates.size();
                auto paths = corpus::sample(std::move(candidates), static_cast<std::uint64_t>(seed),
                                            static_cast<std::size_t>(count));
                respond.ok(
                    json{{"paths", paths}, {"scanned", scanned}, {"seed", seed}, {"count", count}});
            }).detach();
        });

    router.add_method("test.metrics", [&services](const json&, rpc::RpcContext&) {
        return json{
            {"memoryBytes", platform::resident_memory_bytes()},
            {"uptimeMs", services.uptime_ms()},
            {"openDocuments", services.documents.size()},
            {"runningJobs", services.jobs.running_count()},
            {"pendingDialogs", services.queued_dialogs ? services.queued_dialogs->pending() : 0},
            {"openDurations", json::array()}};
    });

    router.add_method("test.injectFault", [](const json& params, rpc::RpcContext&) {
        const std::string point = rpc::params::string_or(params, "point", "none");
        const auto fault = fault_point_from_string(point);
        if (!fault) {
            throw rpc::invalid_params("unknown fault point: " + point, json{{"field", "point"}});
        }
        atomic_file::set_fault_injection(*fault);
        log::debug("test", "fault injection armed: " + point);
        return json::object();
    });

    // test.enqueueClipboardImage({path, contentType?}) -> {queued}: the next
    // binary.addFromClipboard call receives the bytes of this file (binary payloads never
    // travel inside JSON-RPC, hence a path).
    router.add_method(
        "test.enqueueClipboardImage", [&services](const json& params, rpc::RpcContext&) {
            const std::string path = rpc::params::string(params, "path");
            if (!services.queued_clipboard) {
                throw rpc::RpcError(rpc::codes::kDialogUnavailable, "",
                                    json{{"reason", "queued clipboard provider not active"}});
            }
            std::string bytes;
            try {
                bytes = fb2::read_file_bytes(platform::path_from_utf8(path));
            } catch (const fb2::IoFailure& e) {
                throw rpc::RpcError(rpc::codes::kDocIoError, "",
                                    json{{"path", e.path}, {"reason", e.reason}});
            }
            ClipboardImage image;
            image.bytes = std::move(bytes);
            image.contentType = rpc::params::string_or(params, "contentType", "");
            return json{{"queued", services.queued_clipboard->enqueue(std::move(image))}};
        });
}

}  // namespace mfbe::server

#endif  // MFBE_TEST_HOOKS
