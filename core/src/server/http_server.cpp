// Loopback HTTP server: token/Origin checks, static UI bundle, /health (T022).
#include "server/loopback_server.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <system_error>

namespace mfbe::server {
namespace {

namespace fs = std::filesystem;

constexpr std::string_view kTokenCookie = "mfbe_token";

std::string url_decode_impl(std::string_view in) {
    std::string out;
    out.reserve(in.size());
    for (std::size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size() &&
            std::isxdigit(static_cast<unsigned char>(in[i + 1])) &&
            std::isxdigit(static_cast<unsigned char>(in[i + 2]))) {
            out.push_back(
                static_cast<char>(std::stoi(std::string(in.substr(i + 1, 2)), nullptr, 16)));
            i += 2;
        } else if (in[i] == '+') {
            out.push_back(' ');
        } else {
            out.push_back(in[i]);
        }
    }
    return out;
}

std::string query_param(std::string_view query, std::string_view key) {
    std::size_t pos = 0;
    while (pos <= query.size()) {
        const std::size_t amp = query.find('&', pos);
        const std::string_view pair =
            query.substr(pos, amp == std::string_view::npos ? std::string_view::npos : amp - pos);
        const std::size_t eq = pair.find('=');
        const std::string_view k = pair.substr(0, eq);
        if (k == key) {
            return eq == std::string_view::npos ? "" : url_decode_impl(pair.substr(eq + 1));
        }
        if (amp == std::string_view::npos) {
            break;
        }
        pos = amp + 1;
    }
    return "";
}

std::string cookie_value(std::string_view header, std::string_view name) {
    std::size_t pos = 0;
    while (pos < header.size()) {
        while (pos < header.size() && (header[pos] == ' ' || header[pos] == ';')) {
            ++pos;
        }
        const std::size_t end = header.find(';', pos);
        const std::string_view item =
            header.substr(pos, end == std::string_view::npos ? std::string_view::npos : end - pos);
        const std::size_t eq = item.find('=');
        if (eq != std::string_view::npos && item.substr(0, eq) == name) {
            return std::string(item.substr(eq + 1));
        }
        if (end == std::string_view::npos) {
            break;
        }
        pos = end + 1;
    }
    return "";
}

bool constant_time_equal(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) {
        return false;
    }
    unsigned diff = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        diff |= static_cast<unsigned>(a[i] ^ b[i]);
    }
    return diff == 0;
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

void end_with_status(uWS::HttpResponse<false>* res, const char* status, const std::string& body) {
    res->writeStatus(status);
    res->writeHeader("Content-Type", "text/plain; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body);
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Pure helpers                                                                               */
/* ----------------------------------------------------------------------------------------- */

int LoopbackServer::authorize(std::string_view query, std::string_view token_header,
                              std::string_view cookie_header, std::string_view origin_header,
                              const std::string& token, int port, std::string_view host_header) {
    if (!origin_header.empty()) {
        const std::string own = "http://127.0.0.1:" + std::to_string(port);
        const std::string own_localhost = "http://localhost:" + std::to_string(port);
        if (origin_header != own && origin_header != own_localhost) {
            return 403;
        }
    }
    // Defence in depth against DNS rebinding: the Host header must name the loopback server.
    if (!host_header.empty()) {
        const std::string host_ip = "127.0.0.1:" + std::to_string(port);
        const std::string host_local = "localhost:" + std::to_string(port);
        if (host_header != host_ip && host_header != host_local) {
            return 403;
        }
    }
    std::string presented = query_param(query, "token");
    if (presented.empty()) {
        presented = std::string(token_header);
    }
    if (presented.empty()) {
        presented = cookie_value(cookie_header, kTokenCookie);
    }
    if (presented.empty() || !constant_time_equal(presented, token)) {
        return 401;
    }
    return 0;
}

std::string LoopbackServer::url_decode(std::string_view in) {
    return url_decode_impl(in);
}

std::string LoopbackServer::mime_type(const std::string& extension) {
    static const std::map<std::string, std::string> kTypes = {
        {".html", "text/html; charset=utf-8"},
        {".htm", "text/html; charset=utf-8"},
        {".js", "text/javascript; charset=utf-8"},
        {".mjs", "text/javascript; charset=utf-8"},
        {".css", "text/css; charset=utf-8"},
        {".json", "application/json; charset=utf-8"},
        {".map", "application/json; charset=utf-8"},
        {".svg", "image/svg+xml"},
        {".png", "image/png"},
        {".jpg", "image/jpeg"},
        {".jpeg", "image/jpeg"},
        {".gif", "image/gif"},
        {".webp", "image/webp"},
        {".ico", "image/x-icon"},
        {".woff", "font/woff"},
        {".woff2", "font/woff2"},
        {".ttf", "font/ttf"},
        {".otf", "font/otf"},
        {".wasm", "application/wasm"},
        {".txt", "text/plain; charset=utf-8"},
        {".xml", "application/xml; charset=utf-8"},
        {".fb2", "application/xml; charset=utf-8"},
        {".webmanifest", "application/manifest+json"},
    };
    auto it = kTypes.find(lower(extension));
    return it == kTypes.end() ? "application/octet-stream" : it->second;
}

std::string LoopbackServer::csp_header(int port) {
    const std::string origin = "127.0.0.1:" + std::to_string(port);
    return "default-src 'self'; connect-src 'self' ws://" + origin + " http://" + origin +
           "; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
           "worker-src 'self' blob:; script-src 'self'";
}

fs::path LoopbackServer::resolve_static(const std::string& root, std::string_view url_path) {
    if (root.empty()) {
        return {};
    }
    std::string decoded = url_decode_impl(url_path);
    if (decoded.empty() || decoded.front() != '/') {
        return {};
    }
    if (decoded == "/") {
        decoded = "/index.html";
    }
    if (decoded.find('\0') != std::string::npos || decoded.find('\\') != std::string::npos) {
        return {};
    }
    // Reject any ".." segment outright.
    std::size_t pos = 0;
    while (pos < decoded.size()) {
        const std::size_t next = decoded.find('/', pos + 1);
        const std::string segment =
            decoded.substr(pos + 1, next == std::string::npos ? std::string::npos : next - pos - 1);
        if (segment == "..") {
            return {};
        }
        if (next == std::string::npos) {
            break;
        }
        pos = next;
    }
    // The root and the decoded URL (percent-encoded UTF-8) are UTF-8 text.
    std::error_code ec;
    const fs::path base = fs::weakly_canonical(platform::path_from_utf8(root), ec);
    if (ec) {
        return {};
    }
    const fs::path candidate =
        fs::weakly_canonical(base / platform::path_from_utf8(decoded.substr(1)), ec);
    if (ec) {
        return {};
    }
    const std::string base_str = platform::utf8_from_path_generic(base);
    const std::string cand_str = platform::utf8_from_path_generic(candidate);
    if (cand_str.size() < base_str.size() || cand_str.compare(0, base_str.size(), base_str) != 0 ||
        (cand_str.size() > base_str.size() && cand_str[base_str.size()] != '/')) {
        return {};
    }
    if (!fs::is_regular_file(candidate, ec)) {
        return {};
    }
    return candidate;
}

/* ----------------------------------------------------------------------------------------- */
/* Lifecycle                                                                                  */
/* ----------------------------------------------------------------------------------------- */

LoopbackServer::LoopbackServer(Services& services, const rpc::RpcRouter& router)
    : services_(services), router_(router) {
    loop_ = uWS::Loop::get();
    app_ = std::make_unique<uWS::App>();
    setup_http();
    setup_ws();
}

LoopbackServer::~LoopbackServer() = default;

bool LoopbackServer::listen() {
    us_listen_socket_t* socket = nullptr;
    app_->listen("127.0.0.1", services_.options.port, LIBUS_LISTEN_EXCLUSIVE_PORT,
                 [&](us_listen_socket_t* s) { socket = s; });
    if (socket == nullptr) {
        return false;
    }
    listen_socket_ = socket;
    services_.port = us_socket_local_port(0, reinterpret_cast<us_socket_t*>(socket));
    return services_.port > 0;
}

void LoopbackServer::run() {
    app_->run();
}

void LoopbackServer::stop() {
    if (stopping_) {
        return;
    }
    stopping_ = true;
    if (listen_socket_ != nullptr) {
        us_listen_socket_close(0, listen_socket_);
        listen_socket_ = nullptr;
    }
    // Say goodbye to WebSocket clients, then close whatever is left (idle keep-alive HTTP
    // connections would otherwise keep the loop alive) after the close frames went out.
    auto clients = clients_;
    for (auto& [id, ws] : clients) {
        ws->end(1001, "server shutting down");
    }
    struct TimerData {
        LoopbackServer* self;
    };
    us_timer_t* timer = us_create_timer(reinterpret_cast<us_loop_t*>(loop_), 0, sizeof(TimerData));
    static_cast<TimerData*>(us_timer_ext(timer))->self = this;
    us_timer_set(
        timer,
        [](us_timer_t* t) {
            auto* data = static_cast<TimerData*>(us_timer_ext(t));
            LoopbackServer* self = data->self;
            us_timer_close(t);
            self->app_->close();
        },
        100, 0);
}

/* ----------------------------------------------------------------------------------------- */
/* HTTP                                                                                       */
/* ----------------------------------------------------------------------------------------- */

bool LoopbackServer::check_auth(uWS::HttpResponse<false>* res, uWS::HttpRequest* req) {
    const int status = authorize(req->getQuery(), req->getHeader("x-mfbe-token"),
                                 req->getHeader("cookie"), req->getHeader("origin"),
                                 services_.token, services_.port, req->getHeader("host"));
    if (status == 0) {
        return true;
    }
    // Security-relevant failure (FR-131): the request path only - never the token or query.
    log::warning(
        "core", status == 403 ? "http.forbidden" : "http.unauthorized",
        status == 403 ? "request rejected: origin not allowed"
                      : "request rejected: missing or wrong session token",
        log::extras({{"path", std::string(req->getUrl())}, {"status", std::to_string(status)}}));
    if (status == 403) {
        end_with_status(res, "403 Forbidden", "forbidden: origin not allowed");
    } else {
        end_with_status(res, "401 Unauthorized", "unauthorized: token required");
    }
    return false;
}

void LoopbackServer::setup_http() {
    app_->get("/health", [this](auto* res, auto* req) { serve_health(res, req); });
    register_binary_http(*this, services_);
    register_scripts_http(*this, services_);
    app_->any("/*", [this](auto* res, auto* req) {
        if (!check_auth(res, req)) {
            return;
        }
        if (req->getMethod() != "get" && req->getMethod() != "head") {
            end_with_status(res, "405 Method Not Allowed", "method not allowed");
            return;
        }
        serve_static(res, req);
    });
}

void LoopbackServer::serve_health(uWS::HttpResponse<false>* res, uWS::HttpRequest* req) {
    if (!check_auth(res, req)) {
        return;
    }
    nlohmann::json body{
        {"version", version::kVersion},      {"build", version::kBuildId},
        {"pid", platform::current_pid()},    {"uptime", services_.uptime_ms() / 1000},
        {"uptimeMs", services_.uptime_ms()}, {"apiVersion", version::kApiVersion}};
    res->writeStatus("200 OK");
    res->writeHeader("Content-Type", "application/json; charset=utf-8");
    res->writeHeader("Cache-Control", "no-store");
    res->end(body.dump());
}

void LoopbackServer::serve_static(uWS::HttpResponse<false>* res, uWS::HttpRequest* req) {
    const std::string url(req->getUrl());
    if (services_.options.ui_dir.empty()) {
        end_with_status(res, "404 Not Found", "no UI bundle configured (start with --ui <dir>)");
        return;
    }
    const fs::path file = resolve_static(services_.options.ui_dir, url);
    if (file.empty()) {
        end_with_status(res, "404 Not Found", "not found");
        return;
    }
    std::string content;
    try {
        content = atomic_file::read_file(file);
    } catch (const atomic_file::WriteError& e) {
        log::warning("core", "http.staticReadFailed", "cannot read UI asset",
                     log::extras({{"path", e.path}, {"reason", e.reason}}));
        end_with_status(res, "500 Internal Server Error", "cannot read file");
        return;
    }
    const std::string type = mime_type(platform::utf8_from_path(file.extension()));
    const bool is_html = type.rfind("text/html", 0) == 0;
    res->writeStatus("200 OK");
    res->writeHeader("Content-Type", type);
    res->writeHeader("X-Content-Type-Options", "nosniff");
    if (is_html) {
        res->writeHeader("Content-Security-Policy", csp_header(services_.port));
        res->writeHeader("Cache-Control", "no-store");
        res->writeHeader("Referrer-Policy", "no-referrer");
        // Sub-resource requests (scripts, styles, images, WebSocket) carry the token through
        // this cookie; the UI itself reads the token from the page URL.
        res->writeHeader("Set-Cookie", std::string(kTokenCookie) + "=" + services_.token +
                                           "; Path=/; SameSite=Strict; HttpOnly");
    } else {
        res->writeHeader("Cache-Control", "no-cache");
    }
    if (req->getMethod() == "head") {
        res->endWithoutBody(content.size());
        return;
    }
    res->end(content);
}

}  // namespace mfbe::server
