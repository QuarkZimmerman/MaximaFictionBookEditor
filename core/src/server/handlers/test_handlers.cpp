// test.* handlers (T025) - compiled only with MFBE_TEST_HOOKS, registered only with
// --test-hooks: test.enqueueDialog, test.corpusSample, test.metrics, test.injectFault,
// test.enqueueClipboardImage; feature 002: test.dialogRequests, test.beeps,
// test.enqueueRelease; feature 003: test.requests, test.restartRequests, test.requestClose.
#ifdef MFBE_TEST_HOOKS

#include "server/services.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/corpus_sample.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>

#include <map>
#include <mutex>
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
