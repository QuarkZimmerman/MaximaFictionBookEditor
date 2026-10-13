// Internal: uWebSockets loopback server (HTTP static/health + WebSocket JSON-RPC) - T022.
// Everything in this class runs on the loop thread unless stated otherwise.
#pragma once

#include "server/services.hpp"

#include <mfbe/rpc.hpp>

#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <uwebsockets/App.h>
#include <vector>

namespace mfbe::server {

struct WsClient {
    std::uint64_t id = 0;
};

using WebSocketPtr = uWS::WebSocket<false, true, WsClient>*;

class LoopbackServer {
public:
    LoopbackServer(Services& services, const rpc::RpcRouter& router);
    ~LoopbackServer();

    // Binds 127.0.0.1:<services.options.port>; returns false on failure. Fills services.port.
    bool listen();
    // Runs the loop until stop() completed.
    void run();
    // Begins an orderly shutdown (loop thread).
    void stop();

    // Loop-thread only.
    void broadcast(const std::string& text);
    bool send_to(std::uint64_t client_id, const std::string& text);
    std::size_t client_count() const { return clients_.size(); }
    // Queues app.openPaths for the next client when nobody is connected.
    void notify_open_paths(const std::vector<std::string>& paths);

    uWS::Loop* loop() const { return loop_; }
    uWS::App& app() { return *app_; }

    // Returns true when the request may proceed, otherwise an error response was sent.
    bool check_auth(uWS::HttpResponse<false>* res, uWS::HttpRequest* req);

    // --- security helpers (pure; exposed for tests) ---------------------------------------
    // 0 = OK, 401 = missing/invalid token, 403 = foreign Origin or Host (DNS rebinding).
    static int authorize(std::string_view query, std::string_view token_header,
                         std::string_view cookie_header, std::string_view origin_header,
                         const std::string& token, int port, std::string_view host_header = {});
    static std::string mime_type(const std::string& extension);
    static std::string csp_header(int port);
    // Maps a URL path to a file below `root`; empty when invalid or escaping the root.
    static std::string resolve_static(const std::string& root, std::string_view url_path);
    // Percent-decoding of URL components ('+' becomes a space).
    static std::string url_decode(std::string_view in);

private:
    void setup_http();
    void setup_ws();
    void serve_static(uWS::HttpResponse<false>* res, uWS::HttpRequest* req);
    void serve_health(uWS::HttpResponse<false>* res, uWS::HttpRequest* req);
    void on_message(WebSocketPtr ws, std::string_view message);
    void deliver_pending_open_paths();

    Services& services_;
    const rpc::RpcRouter& router_;
    uWS::Loop* loop_ = nullptr;
    std::unique_ptr<uWS::App> app_;
    us_listen_socket_t* listen_socket_ = nullptr;
    std::map<std::uint64_t, WebSocketPtr> clients_;
    std::uint64_t next_client_id_ = 1;
    std::vector<std::string> pending_open_paths_;
    bool stopping_ = false;
};

// Registers GET/HEAD/POST /binary/... (binary_handlers.cpp); called before the catch-all.
void register_binary_http(LoopbackServer& server, Services& services);
// Registers GET/HEAD /scripts/{scriptId}/{file} (scripts_handlers.cpp).
void register_scripts_http(LoopbackServer& server, Services& services);

}  // namespace mfbe::server
