// WebSocket /rpc endpoint: JSON-RPC requests/responses and server notifications (T022).
#include "server/loopback_server.hpp"

#include <mfbe/log.hpp>

#include <algorithm>
#include <chrono>
#include <libusockets.h>

namespace mfbe::server {
namespace {

constexpr unsigned int kMaxPayloadBytes = 512u * 1024u * 1024u;  // big Document JSONs
constexpr unsigned int kMaxBackpressureBytes = 1024u * 1024u * 1024u;

}  // namespace

void LoopbackServer::setup_ws() {
    uWS::App::WebSocketBehavior<WsClient> behavior;
    behavior.compression = uWS::DISABLED;
    behavior.maxPayloadLength = kMaxPayloadBytes;
    behavior.idleTimeout = 0;  // the desktop UI may be idle for hours (and paused in a debugger)
    behavior.maxBackpressure = kMaxBackpressureBytes;
    behavior.closeOnBackpressureLimit = false;
    behavior.resetIdleTimeoutOnSend = true;
    behavior.sendPingsAutomatically = false;
    behavior.upgrade = [this](uWS::HttpResponse<false>* res, uWS::HttpRequest* req,
                              us_socket_context_t* context) {
        if (stopping_) {
            res->writeStatus("503 Service Unavailable")->end("shutting down");
            return;
        }
        if (!check_auth(res, req)) {
            return;
        }
        WsClient client;
        client.id = next_client_id_++;
        res->template upgrade<WsClient>(std::move(client), req->getHeader("sec-websocket-key"),
                                        req->getHeader("sec-websocket-protocol"),
                                        req->getHeader("sec-websocket-extensions"), context);
    };
    behavior.open = [this](WebSocketPtr ws) {
        clients_[ws->getUserData()->id] = ws;
        // Feature 010 (test.holdStartup): this connection's requests wait out the hold.
        if (const int hold = services_.hold_next_connection_ms.exchange(0); hold > 0) {
            ws->getUserData()->held_until =
                std::chrono::steady_clock::now() + std::chrono::milliseconds(hold);
        }
        log::debug("server", "client connected: " + std::to_string(ws->getUserData()->id));
        deliver_pending_open_paths();
        for (const auto& request : pending_open_requests_) {
            broadcast(rpc::RpcRouter::wire_text(
                rpc::RpcRouter::make_notification("app.openRequest", request)));
        }
        pending_open_requests_.clear();
    };
    behavior.message = [this](WebSocketPtr ws, std::string_view message, uWS::OpCode op) {
        if (op != uWS::OpCode::TEXT) {
            return;  // binary payloads never travel over the RPC channel
        }
        WsClient* client = ws->getUserData();
        const auto now = std::chrono::steady_clock::now();
        if (client->held_until > now) {
            // Feature 010 (test.holdStartup): queued in order, answered when a loop timer fires;
            // nothing else waits.
            std::deque<std::string>& queue = held_messages_[client->id];
            const bool first = queue.empty();
            queue.emplace_back(message);
            if (first) {
                struct HoldTimer {
                    LoopbackServer* server;
                    std::uint64_t client;
                };
                const auto left =
                    std::chrono::duration_cast<std::chrono::milliseconds>(client->held_until - now)
                        .count();
                us_timer_t* timer =
                    us_create_timer(reinterpret_cast<us_loop_t*>(loop_), 0, sizeof(HoldTimer));
                *static_cast<HoldTimer*>(us_timer_ext(timer)) = HoldTimer{this, client->id};
                us_timer_set(
                    timer,
                    [](us_timer_t* t) {
                        const HoldTimer hold = *static_cast<HoldTimer*>(us_timer_ext(t));
                        us_timer_close(t);
                        hold.server->release_held(hold.client);
                    },
                    static_cast<int>(std::max<long long>(1, left)), 0);
            }
            return;
        }
        on_message(ws, message);
    };
    behavior.close = [this](WebSocketPtr ws, int /*code*/, std::string_view /*reason*/) {
        clients_.erase(ws->getUserData()->id);
        held_messages_.erase(ws->getUserData()->id);
        log::debug("server", "client disconnected: " + std::to_string(ws->getUserData()->id));
    };
    app_->ws<WsClient>("/rpc", std::move(behavior));
}

void LoopbackServer::on_message(WebSocketPtr ws, std::string_view message) {
    const std::uint64_t client_id = ws->getUserData()->id;
    rpc::RpcContext ctx{services_.notifier, services_.jobs, std::to_string(client_id)};
    // Asynchronous responses are marshalled back to the loop thread and dropped when the
    // client is gone.
    auto sink = [this, client_id](nlohmann::json response) {
        std::string text = rpc::RpcRouter::wire_text(response);
        services_.post([this, client_id, text = std::move(text)] { send_to(client_id, text); });
    };
    auto response = router_.dispatch_text(message, ctx, sink);
    if (response) {
        ws->send(rpc::RpcRouter::wire_text(*response), uWS::OpCode::TEXT);
    }
}

void LoopbackServer::release_held(std::uint64_t client_id) {
    auto queued = held_messages_.find(client_id);
    if (queued == held_messages_.end()) {
        return;
    }
    std::deque<std::string> messages = std::move(queued->second);
    held_messages_.erase(queued);
    auto it = clients_.find(client_id);
    if (it == clients_.end()) {
        return;
    }
    it->second->getUserData()->held_until = {};
    for (const std::string& message : messages) {
        on_message(it->second, message);
    }
}

void LoopbackServer::broadcast(const std::string& text) {
    for (auto& [id, ws] : clients_) {
        ws->send(text, uWS::OpCode::TEXT);
    }
}

bool LoopbackServer::send_to(std::uint64_t client_id, const std::string& text) {
    auto it = clients_.find(client_id);
    if (it == clients_.end()) {
        return false;
    }
    it->second->send(text, uWS::OpCode::TEXT);
    return true;
}

void LoopbackServer::notify_open_paths(const std::vector<std::string>& paths) {
    if (paths.empty()) {
        return;
    }
    if (clients_.empty()) {
        pending_open_paths_.insert(pending_open_paths_.end(), paths.begin(), paths.end());
        return;
    }
    broadcast(rpc::RpcRouter::wire_text(
        rpc::RpcRouter::make_notification("app.openPaths", {{"paths", paths}})));
}

void LoopbackServer::notify_open_request(const nlohmann::json& request) {
    if (clients_.empty()) {
        pending_open_requests_.push_back(request);
        return;
    }
    broadcast(
        rpc::RpcRouter::wire_text(rpc::RpcRouter::make_notification("app.openRequest", request)));
}

void LoopbackServer::deliver_pending_open_paths() {
    if (pending_open_paths_.empty()) {
        return;
    }
    std::vector<std::string> paths;
    paths.swap(pending_open_paths_);
    broadcast(rpc::RpcRouter::wire_text(
        rpc::RpcRouter::make_notification("app.openPaths", {{"paths", paths}})));
}

}  // namespace mfbe::server
