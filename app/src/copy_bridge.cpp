// See copy_bridge.h.
#include "copy_bridge.h"

#include "relaunch.h"

#include <mfbe/copy_launch.hpp>
#include <mfbe/copy_registry.hpp>
#include <mfbe/utf8_paths.hpp>

#include <chrono>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <set>

namespace mfbe::shell {

namespace {
std::unique_ptr<mfbe::copies::CopyRegistry>& registry() {
    static std::unique_ptr<mfbe::copies::CopyRegistry> instance;
    return instance;
}
}  // namespace

CopyStart decideCopyStart(const std::filesystem::path& data_dir,
                          const std::vector<std::string>& books, bool force_new_copy,
                          int forced_slot) {
    CopyStart start;
    try {
        auto reg = std::make_unique<mfbe::copies::CopyRegistry>(data_dir);
        const auto others = reg->records(true);
        if (!books.empty() && !force_new_copy) {
            const std::string first_id =
                mfbe::copies::file_identity(mfbe::platform::path_from_utf8(books.front()));
            const auto target =
                mfbe::copies::choose_target(others, first_id, std::chrono::system_clock::now());
            if (target.relay) {
                mfbe::copies::OpenRequest request;
                request.kind = target.kind;
                request.request_id = mfbe::copies::new_request_id();
                request.paths = books;
                request.target = target.target;
                start.relay = true;
                start.slot = target.slot;
                start.payload = mfbe::copies::encode_request(request);
                start.profile_dir = mfbe::copies::profile_dir(data_dir, target.slot);
                return start;
            }
        }
        const bool taken = forced_slot > 0 ? reg->acquire_slot(forced_slot) : reg->acquire();
        if (!taken) {
            start.ok = false;
            return start;
        }
        start.slot = reg->slot();
        start.profile_dir = mfbe::copies::profile_dir(data_dir, start.slot);
        // The place beside the copy used last (research R6); the shell clamps it to the screen.
        const mfbe::copies::Record* last = nullptr;
        for (const auto& r : others) {
            if (r.window && (last == nullptr || r.last_active_at > last->last_active_at))
                last = &r;
        }
        if (last != nullptr) {
            const auto w = mfbe::copies::place_new_window(last->window, mfbe::copies::WorkArea{},
                                                          mfbe::copies::WindowRect{});
            start.placement = CopyWindowRect{w.x, w.y, w.w, w.h, w.maximized};
        }
        registry() = std::move(reg);
    } catch (const std::exception&) {
        start.ok = false;
    }
    return start;
}

std::string activationPayload(const std::string& path) {
    try {
        mfbe::copies::OpenRequest request;
        request.kind = "activate";
        request.request_id = mfbe::copies::new_request_id();
        request.paths = {path};
        return mfbe::copies::encode_request(request);
    } catch (const std::exception&) {
        return {};
    }
}

std::optional<RelayedRequest> parseRelayedRequest(const std::vector<std::string>& argv) {
    try {
        const auto r = mfbe::copies::parse_relayed_request(argv);
        if (!r)
            return std::nullopt;
        return RelayedRequest{r->kind, r->request_id, r->paths, r->origin, r->target};
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

mfbe::copies::CopyRegistry* copyRegistry() {
    return registry().get();
}

void copyHeartbeat() {
    if (auto* reg = copyRegistry())
        reg->heartbeat();
}

void copyActivated() {
    if (auto* reg = copyRegistry())
        reg->set_active();
}

void copyWindowChanged(const CopyWindowRect& window) {
    if (auto* reg = copyRegistry()) {
        reg->set_window(
            mfbe::copies::WindowRect{window.x, window.y, window.w, window.h, window.maximized});
    }
}

void releaseCopy() {
    registry().reset();
}

namespace {
std::mutex g_ack_mutex;
std::set<std::string> g_expected;
std::set<std::string> g_acked;
}  // namespace

void expectAck(const std::string& request_id) {
    std::lock_guard<std::mutex> lock(g_ack_mutex);
    g_expected.insert(request_id);
}

void markAcked(const std::string& request_id) {
    std::lock_guard<std::mutex> lock(g_ack_mutex);
    if (g_expected.count(request_id) != 0)
        g_acked.insert(request_id);
}

bool takeAcked(const std::string& request_id) {
    std::lock_guard<std::mutex> lock(g_ack_mutex);
    g_expected.erase(request_id);
    return g_acked.erase(request_id) != 0;
}

bool spawnCopy(const std::vector<std::string>& books, std::string* reason) {
    const char* appimage = std::getenv("APPIMAGE");
    const std::string program =
        relaunchProgram(appimage != nullptr ? appimage : "", currentExecutable());
    std::vector<std::string> args = {"--mfbe-new-copy"};
    args.insert(args.end(), books.begin(), books.end());
    return spawnDetached(program, args, reason);
}

}  // namespace mfbe::shell
