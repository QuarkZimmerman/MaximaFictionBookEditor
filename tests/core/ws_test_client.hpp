// Minimal blocking HTTP/WebSocket client over plain sockets for the server tests (RFC 6455
// subset: handshake, masked text frames, ping/pong, close). Chosen over an external
// dependency or a Node subprocess so `ctest` stays hermetic on every CI platform.
#pragma once

#include <nlohmann/json.hpp>

#include <chrono>
#include <cstdint>
#include <cstring>
#include <map>
#include <optional>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
using socket_t = SOCKET;
#define MFBE_INVALID_SOCKET INVALID_SOCKET
#define MFBE_CLOSE_SOCKET closesocket
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_t = int;
#define MFBE_INVALID_SOCKET (-1)
#define MFBE_CLOSE_SOCKET ::close
#endif

namespace mfbe::test {

struct HttpResponse {
    int status = 0;
    std::map<std::string, std::string> headers;  // lower-case keys
    std::string body;
};

class TcpClient {
public:
    TcpClient() {
#ifdef _WIN32
        static bool initialised = [] {
            WSADATA data;
            return WSAStartup(MAKEWORD(2, 2), &data) == 0;
        }();
        (void)initialised;
#endif
    }
    ~TcpClient() { close(); }
    TcpClient(const TcpClient&) = delete;
    TcpClient& operator=(const TcpClient&) = delete;

    void connect(int port) {
        sock_ = ::socket(AF_INET, SOCK_STREAM, 0);
        if (sock_ == MFBE_INVALID_SOCKET) {
            throw std::runtime_error("socket() failed");
        }
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<std::uint16_t>(port));
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (::connect(sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            close();
            throw std::runtime_error("connect() failed");
        }
        int one = 1;
        ::setsockopt(sock_, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&one),
                     sizeof(one));
    }

    void close() {
        if (sock_ != MFBE_INVALID_SOCKET) {
            MFBE_CLOSE_SOCKET(sock_);
            sock_ = MFBE_INVALID_SOCKET;
        }
    }

    bool connected() const { return sock_ != MFBE_INVALID_SOCKET; }

    void send_all(const std::string& data) {
        std::size_t sent = 0;
        while (sent < data.size()) {
            const auto n =
                ::send(sock_, data.data() + sent, static_cast<int>(data.size() - sent), 0);
            if (n <= 0) {
                throw std::runtime_error("send() failed");
            }
            sent += static_cast<std::size_t>(n);
        }
    }

    // Returns false on timeout, throws on EOF/error.
    bool read_some(std::string& buffer, int timeout_ms) {
        fd_set set;
        FD_ZERO(&set);
        FD_SET(sock_, &set);
        timeval tv{};
        tv.tv_sec = timeout_ms / 1000;
        tv.tv_usec = (timeout_ms % 1000) * 1000;
        const int ready = ::select(static_cast<int>(sock_ + 1), &set, nullptr, nullptr, &tv);
        if (ready == 0) {
            return false;
        }
        char chunk[16384];
        const auto n = ::recv(sock_, chunk, sizeof(chunk), 0);
        if (n == 0) {
            throw std::runtime_error("connection closed by peer");
        }
        if (n < 0) {
            throw std::runtime_error("recv() failed");
        }
        buffer.append(chunk, static_cast<std::size_t>(n));
        return true;
    }

    // Reads until the peer closes or the timeout elapses; returns everything received.
    std::string read_until_close(int timeout_ms) {
        std::string data;
        const auto deadline =
            std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        try {
            while (std::chrono::steady_clock::now() < deadline) {
                if (!read_some(data, 50)) {
                    continue;
                }
            }
        } catch (const std::runtime_error&) {
        }
        return data;
    }

protected:
    socket_t sock_ = MFBE_INVALID_SOCKET;
};

inline HttpResponse parse_http_response(const std::string& raw, std::size_t* header_end = nullptr) {
    HttpResponse r;
    const auto end = raw.find("\r\n\r\n");
    if (end == std::string::npos) {
        throw std::runtime_error("incomplete HTTP response: " + raw);
    }
    if (header_end != nullptr) {
        *header_end = end + 4;
    }
    const std::string head = raw.substr(0, end);
    std::size_t pos = 0;
    std::size_t line_end = head.find("\r\n");
    const std::string status_line = head.substr(0, line_end);
    if (status_line.size() < 12) {
        throw std::runtime_error("bad status line: " + status_line);
    }
    r.status = std::stoi(status_line.substr(9, 3));
    pos = line_end == std::string::npos ? head.size() : line_end + 2;
    while (pos < head.size()) {
        line_end = head.find("\r\n", pos);
        const std::string line =
            head.substr(pos, line_end == std::string::npos ? std::string::npos : line_end - pos);
        const auto colon = line.find(':');
        if (colon != std::string::npos) {
            std::string key = line.substr(0, colon);
            for (auto& c : key) {
                c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            }
            std::string value = line.substr(colon + 1);
            while (!value.empty() && value.front() == ' ') {
                value.erase(value.begin());
            }
            r.headers[key] = value;
        }
        if (line_end == std::string::npos) {
            break;
        }
        pos = line_end + 2;
    }
    r.body = raw.substr(end + 4);
    return r;
}

// One HTTP/1.1 request (connection closed afterwards). `body` is sent with a Content-Length.
inline HttpResponse http_request(int port, const std::string& method,
                                 const std::string& path_and_query,
                                 const std::map<std::string, std::string>& headers = {},
                                 const std::string& body = "") {
    TcpClient client;
    client.connect(port);
    std::string request = method + " " + path_and_query +
                          " HTTP/1.1\r\nHost: 127.0.0.1:" + std::to_string(port) +
                          "\r\nConnection: close\r\n";
    for (const auto& [k, v] : headers) {
        request += k + ": " + v + "\r\n";
    }
    if (!body.empty() || method == "POST" || method == "PUT") {
        request += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    }
    request += "\r\n";
    request += body;
    client.send_all(request);
    std::string raw;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    std::optional<std::size_t> expected_total;
    while (std::chrono::steady_clock::now() < deadline) {
        try {
            if (!client.read_some(raw, 100)) {
                continue;
            }
        } catch (const std::runtime_error&) {
            break;  // peer closed
        }
        if (!expected_total) {
            const auto end = raw.find("\r\n\r\n");
            if (end != std::string::npos) {
                const HttpResponse head = parse_http_response(raw.substr(0, end + 4));
                auto it = head.headers.find("content-length");
                if (it != head.headers.end()) {
                    expected_total = end + 4 + static_cast<std::size_t>(std::stoul(it->second));
                }
            }
        }
        if (expected_total && raw.size() >= *expected_total) {
            break;
        }
    }
    return parse_http_response(raw);
}

inline HttpResponse http_get(int port, const std::string& path_and_query,
                             const std::map<std::string, std::string>& headers = {},
                             const std::string& method = "GET") {
    return http_request(port, method, path_and_query, headers);
}

class WsClient : public TcpClient {
public:
    struct Frame {
        int opcode = 0;  // 1 text, 2 binary, 8 close, 9 ping, 10 pong
        std::string payload;
    };

    // Performs the upgrade; returns the HTTP status (101 on success).
    int open(int port, const std::string& path_and_query,
             const std::map<std::string, std::string>& headers = {}) {
        connect(port);
        std::string request = "GET " + path_and_query +
                              " HTTP/1.1\r\nHost: 127.0.0.1:" + std::to_string(port) +
                              "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                              "Sec-WebSocket-Version: 13\r\n";
        for (const auto& [k, v] : headers) {
            request += k + ": " + v + "\r\n";
        }
        request += "\r\n";
        send_all(request);
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (buffer_.find("\r\n\r\n") == std::string::npos) {
            if (std::chrono::steady_clock::now() > deadline) {
                throw std::runtime_error("handshake timeout");
            }
            try {
                read_some(buffer_, 100);
            } catch (const std::runtime_error&) {
                break;
            }
        }
        std::size_t header_end = 0;
        const HttpResponse response = parse_http_response(buffer_, &header_end);
        buffer_.erase(0, header_end);
        status_ = response.status;
        if (status_ != 101) {
            close();
        }
        return status_;
    }

    void send_text(const std::string& text) { send_frame(1, text); }
    void send_close(std::uint16_t code = 1000) {
        std::string payload;
        payload.push_back(static_cast<char>(code >> 8));
        payload.push_back(static_cast<char>(code & 0xff));
        send_frame(8, payload);
    }

    // Next complete frame (pings are answered transparently). nullopt on timeout.
    std::optional<Frame> receive(int timeout_ms = 5000) {
        const auto deadline =
            std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        for (;;) {
            if (auto frame = parse_frame()) {
                if (frame->opcode == 9) {
                    send_frame(10, frame->payload);
                    continue;
                }
                return frame;
            }
            const auto now = std::chrono::steady_clock::now();
            if (now >= deadline) {
                return std::nullopt;
            }
            const int remaining = static_cast<int>(
                std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now).count());
            if (!read_some(buffer_, std::min(remaining, 100))) {
                continue;
            }
        }
    }

    // Convenience: next text frame parsed as JSON (skips non-text frames).
    std::optional<nlohmann::json> receive_json(int timeout_ms = 5000) {
        for (;;) {
            auto frame = receive(timeout_ms);
            if (!frame) {
                return std::nullopt;
            }
            if (frame->opcode == 1) {
                return nlohmann::json::parse(frame->payload);
            }
            if (frame->opcode == 8) {
                return std::nullopt;
            }
        }
    }

    // JSON-RPC call: sends the request and waits for the response with the same id; other
    // messages (notifications) are collected into `inbox`.
    nlohmann::json call(const std::string& method,
                        const nlohmann::json& params = nlohmann::json::object(),
                        int timeout_ms = 5000) {
        const int id = next_id_++;
        send_text(
            nlohmann::json{{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", params}}
                .dump());
        const auto deadline =
            std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        while (std::chrono::steady_clock::now() < deadline) {
            auto msg = receive_json(timeout_ms);
            if (!msg) {
                break;
            }
            if (msg->contains("id") && (*msg)["id"] == id) {
                return *msg;
            }
            inbox.push_back(*msg);
        }
        throw std::runtime_error("no response for " + method);
    }

    // Waits for a notification with `method` (already received ones count).
    std::optional<nlohmann::json> wait_notification(const std::string& method,
                                                    int timeout_ms = 5000) {
        for (std::size_t i = 0; i < inbox.size(); ++i) {
            if (inbox[i].value("method", "") == method) {
                auto n = inbox[i];
                inbox.erase(inbox.begin() + static_cast<std::ptrdiff_t>(i));
                return n;
            }
        }
        const auto deadline =
            std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        while (std::chrono::steady_clock::now() < deadline) {
            auto msg = receive_json(timeout_ms);
            if (!msg) {
                break;
            }
            if (msg->value("method", "") == method) {
                return *msg;
            }
            inbox.push_back(*msg);
        }
        return std::nullopt;
    }

    int status() const { return status_; }
    std::vector<nlohmann::json> inbox;

private:
    void send_frame(int opcode, const std::string& payload) {
        std::string frame;
        frame.push_back(static_cast<char>(0x80 | opcode));
        const std::size_t len = payload.size();
        if (len < 126) {
            frame.push_back(static_cast<char>(0x80 | len));
        } else if (len < 65536) {
            frame.push_back(static_cast<char>(0x80 | 126));
            frame.push_back(static_cast<char>(len >> 8));
            frame.push_back(static_cast<char>(len & 0xff));
        } else {
            frame.push_back(static_cast<char>(0x80 | 127));
            for (int i = 7; i >= 0; --i) {
                frame.push_back(
                    static_cast<char>((static_cast<std::uint64_t>(len) >> (i * 8)) & 0xff));
            }
        }
        std::uint8_t mask[4];
        for (auto& m : mask) {
            m = static_cast<std::uint8_t>(rng_());
        }
        frame.append(reinterpret_cast<const char*>(mask), 4);
        for (std::size_t i = 0; i < len; ++i) {
            frame.push_back(static_cast<char>(static_cast<std::uint8_t>(payload[i]) ^ mask[i % 4]));
        }
        send_all(frame);
    }

    std::optional<Frame> parse_frame() {
        if (buffer_.size() < 2) {
            return std::nullopt;
        }
        const auto b0 = static_cast<std::uint8_t>(buffer_[0]);
        const auto b1 = static_cast<std::uint8_t>(buffer_[1]);
        const bool fin = (b0 & 0x80) != 0;
        const int opcode = b0 & 0x0f;
        const bool masked = (b1 & 0x80) != 0;
        std::uint64_t len = b1 & 0x7f;
        std::size_t pos = 2;
        if (len == 126) {
            if (buffer_.size() < 4) {
                return std::nullopt;
            }
            len = (static_cast<std::uint64_t>(static_cast<std::uint8_t>(buffer_[2])) << 8) |
                  static_cast<std::uint8_t>(buffer_[3]);
            pos = 4;
        } else if (len == 127) {
            if (buffer_.size() < 10) {
                return std::nullopt;
            }
            len = 0;
            for (int i = 0; i < 8; ++i) {
                len = (len << 8) |
                      static_cast<std::uint8_t>(buffer_[2 + static_cast<std::size_t>(i)]);
            }
            pos = 10;
        }
        if (masked) {
            pos += 4;  // servers never mask; tolerate anyway
        }
        if (buffer_.size() < pos + len) {
            return std::nullopt;
        }
        std::string payload = buffer_.substr(pos, static_cast<std::size_t>(len));
        buffer_.erase(0, pos + static_cast<std::size_t>(len));
        if (opcode == 0 || !fin) {
            // Continuation handling: accumulate until FIN.
            fragment_ += payload;
            if (opcode != 0) {
                fragment_opcode_ = opcode;
            }
            if (!fin) {
                return parse_frame();
            }
            Frame f{fragment_opcode_, fragment_};
            fragment_.clear();
            return f;
        }
        return Frame{opcode, std::move(payload)};
    }

    std::string buffer_;
    std::string fragment_;
    int fragment_opcode_ = 1;
    int status_ = 0;
    int next_id_ = 1;
    std::mt19937 rng_{12345};
};

}  // namespace mfbe::test
