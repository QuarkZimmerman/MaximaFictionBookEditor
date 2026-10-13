// WebSocket /rpc endpoint: JSON-RPC requests/responses and server notifications (T022).
#include "server/loopback_server.hpp"

#include <mfbe/log.hpp>

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
        log::debug("server", "client connected: " + std::to_string(ws->getUserData()->id));
        deliver_pending_open_paths();
    };
    behavior.message = [this](WebSocketPtr ws, std::string_view message, uWS::OpCode op) {
        if (op != uWS::OpCode::TEXT) {
            return;  // binary payloads never travel over the RPC channel
        }
        on_message(ws, message);
    };
    behavior.close = [this](WebSocketPtr ws, int /*code*/, std::string_view /*reason*/) {
        clients_.erase(ws->getUserData()->id);
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
        std::string text = response.dump();
        services_.post([this, client_id, text = std::move(text)] { send_to(client_id, text); });
    };
    auto response = router_.dispatch_text(message, ctx, sink);
    if (response) {
        ws->send(response->dump(), uWS::OpCode::TEXT);
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
    broadcast(rpc::RpcRouter::make_notification("app.openPaths", {{"paths", paths}}).dump());
}

void LoopbackServer::deliver_pending_open_paths() {
    if (pending_open_paths_.empty()) {
        return;
    }
    std::vector<std::string> paths;
    paths.swap(pending_open_paths_);
    broadcast(rpc::RpcRouter::make_notification("app.openPaths", {{"paths", paths}}).dump());
}

}  // namespace mfbe::server
