// A minimal blocking HTTPS server for the core's TLS tests (feature 005, T010; review decision
// F3: no real-host probe in CI, a local self-signed HTTPS stand-in instead). `vcpkg.json` lists
// `uwebsockets` without its `ssl` feature, so `uWS::SSLApp` is not available; the fixture
// accepts loopback connections itself, runs `SSL_accept` on each one and writes one canned
// HTTP/1.1 answer per connection. The test CA and a leaf certificate for 127.0.0.1 (SAN
// `IP:127.0.0.1,DNS:localhost`) are generated through the OpenSSL X509 API at construction
// into a temporary folder - no `openssl` binary is assumed on the runners; the CA's PEM is
// what a test points `SSL_CERT_FILE` at. A `min_version` / `max_version` pair lets a test
// configure a TLS 1.0/1.1-only server the client must refuse.
//
// Compiled under MFBE_TEST_TLS (tests/core/CMakeLists.txt links OpenSSL on Linux and macOS,
// where libcurl is OpenSSL-backed). Elsewhere - Windows, Schannel, no OpenSSL linked -
// `TlsTestServer::available()` is false, the constructor throws and the HTTPS cases skip with
// the explicit mark "manual: test CA not installed in the runner's user store".
#pragma once

#include "test_http_server.hpp"  // ScriptedResponse, RecordedRequest, http_status_line
#include "test_support.hpp"      // TempDir

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#if MFBE_TEST_TLS
#include <arpa/inet.h>
#include <csignal>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>
#endif

namespace mfbe::test {

// Protocol versions as OpenSSL numbers them (TLS1_VERSION ... TLS1_3_VERSION), so that the
// options compile where OpenSSL is not linked.
enum class TlsVersion : int { tls1_0 = 0x0301, tls1_1 = 0x0302, tls1_2 = 0x0303, tls1_3 = 0x0304 };

struct TlsServerOptions {
    TlsVersion min_version = TlsVersion::tls1_2;
    TlsVersion max_version = TlsVersion::tls1_3;
    // Extra DNS names for the leaf certificate's subjectAltName (beside IP:127.0.0.1 and
    // DNS:localhost), e.g. the name a test resolves to the loopback through CURLOPT_RESOLVE.
    std::vector<std::string> dns_names;
};

#if MFBE_TEST_TLS

class TlsTestServer {
public:
    static constexpr bool available() { return true; }

    // Generates the certificates, binds 127.0.0.1:0 and starts the accept thread; throws
    // std::runtime_error when OpenSSL or the socket layer refuses.
    explicit TlsTestServer(TlsServerOptions options = {}) : options_(std::move(options)) {
        ignore_sigpipe_once();
        generate_certificates();
        create_context();
        listen_loopback();
        thread_ = std::thread([this] { run(); });
    }
    ~TlsTestServer() {
        stop();
        if (ctx_ != nullptr) {
            SSL_CTX_free(ctx_);
        }
        X509_free(ca_cert_);
        X509_free(other_ca_cert_);
        X509_free(leaf_cert_);
        EVP_PKEY_free(ca_key_);
        EVP_PKEY_free(other_ca_key_);
        EVP_PKEY_free(leaf_key_);
    }
    TlsTestServer(const TlsTestServer&) = delete;
    TlsTestServer& operator=(const TlsTestServer&) = delete;

    int port() const { return port_; }
    std::string base_url() const { return "https://127.0.0.1:" + std::to_string(port_); }
    std::string url(const std::string& path) const { return base_url() + path; }

    // PEM files in the temporary folder: the CA that signed the server's certificate (for
    // SSL_CERT_FILE), an unrelated CA for the "wrong CA" case, the leaf and its key.
    std::filesystem::path ca_file() const { return dir_ / "ca.pem"; }
    std::filesystem::path other_ca_file() const { return dir_ / "other-ca.pem"; }
    std::filesystem::path server_cert_file() const { return dir_ / "server.pem"; }
    std::filesystem::path server_key_file() const { return dir_ / "server-key.pem"; }

    // One-shot answers consumed in order; the default answer serves when the queue is empty.
    void enqueue(ScriptedResponse response) {
        std::lock_guard<std::mutex> lock(mutex_);
        queue_.push_back(std::move(response));
    }
    void set_default(ScriptedResponse response) {
        std::lock_guard<std::mutex> lock(mutex_);
        default_ = std::move(response);
    }

    std::vector<RecordedRequest> requests() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return requests_;
    }
    std::size_t request_count() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return requests_.size();
    }
    bool wait_for_requests(std::size_t count, int timeout_ms = 5000) const {
        std::unique_lock<std::mutex> lock(mutex_);
        return cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                            [&] { return requests_.size() >= count; });
    }
    // Connections whose TLS handshake failed (the client refused the certificate or the
    // protocol version), and the OpenSSL text of the last failure.
    std::size_t handshake_failures() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return handshake_failures_;
    }
    std::string last_handshake_error() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return last_handshake_error_;
    }
    // Waits until `count` connections were accepted (handshake done or failed).
    bool wait_for_connections(std::size_t count, int timeout_ms = 5000) const {
        std::unique_lock<std::mutex> lock(mutex_);
        return cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                            [&] { return connections_ >= count; });
    }
    void clear_requests() {
        std::lock_guard<std::mutex> lock(mutex_);
        requests_.clear();
    }

    // Stops accepting, finishes the connection in progress and joins the thread. Idempotent.
    void stop() {
        stop_ = true;
        if (thread_.joinable()) {
            thread_.join();
        }
        if (listen_fd_ >= 0) {
            ::close(listen_fd_);
            listen_fd_ = -1;
        }
    }

private:
    static void ignore_sigpipe_once() {
        // A client that closes early makes SSL_write hit a dead socket; without this the
        // whole test process would die of SIGPIPE (Linux has no SO_NOSIGPIPE).
        static const bool ignored = [] {
            std::signal(SIGPIPE, SIG_IGN);
            return true;
        }();
        (void)ignored;
    }

    [[noreturn]] static void fail(const std::string& what) {
        std::string text = "TLS test fixture: " + what;
        if (const unsigned long code = ERR_peek_last_error(); code != 0) {
            char buffer[256];
            ERR_error_string_n(code, buffer, sizeof(buffer));
            text += " (";
            text += buffer;
            text += ")";
        }
        ERR_clear_error();
        throw std::runtime_error(text);
    }

    static EVP_PKEY* generate_key() {
        EVP_PKEY* key = EVP_PKEY_Q_keygen(nullptr, nullptr, "EC", "P-256");
        if (key == nullptr) {
            fail("EVP_PKEY_Q_keygen failed");
        }
        return key;
    }

    static void add_extension(X509* cert, X509V3_CTX* ctx, int nid, const std::string& value) {
        X509_EXTENSION* ext = X509V3_EXT_conf_nid(nullptr, ctx, nid, value.c_str());
        if (ext == nullptr) {
            fail("X509V3_EXT_conf_nid failed for " + value);
        }
        X509_add_ext(cert, ext, -1);
        X509_EXTENSION_free(ext);
    }

    static void set_name(X509_NAME* name, const char* common_name) {
        const auto add = [&](const char* field, const char* text) {
            if (X509_NAME_add_entry_by_txt(name, field, MBSTRING_ASC,
                                           reinterpret_cast<const unsigned char*>(text), -1, -1,
                                           0) != 1) {
                fail("X509_NAME_add_entry_by_txt failed");
            }
        };
        add("O", "Maxima Fiction Book Editor tests");
        add("CN", common_name);
    }

    // A certificate for `subject_key`; self-signed when `issuer` is null.
    static X509* make_certificate(EVP_PKEY* subject_key, const char* common_name, X509* issuer,
                                  EVP_PKEY* issuer_key, long serial, bool is_ca,
                                  const std::string& subject_alt_names) {
        X509* cert = X509_new();
        if (cert == nullptr) {
            fail("X509_new failed");
        }
        X509_set_version(cert, X509_VERSION_3);
        ASN1_INTEGER_set(X509_get_serialNumber(cert), serial);
        X509_gmtime_adj(X509_getm_notBefore(cert), -3600);
        X509_gmtime_adj(X509_getm_notAfter(cert), 2 * 24 * 3600);
        if (X509_set_pubkey(cert, subject_key) != 1) {
            fail("X509_set_pubkey failed");
        }
        set_name(X509_get_subject_name(cert), common_name);
        X509_set_issuer_name(
            cert, issuer != nullptr ? X509_get_subject_name(issuer) : X509_get_subject_name(cert));
        X509V3_CTX ctx;
        X509V3_set_ctx_nodb(&ctx);
        X509V3_set_ctx(&ctx, issuer != nullptr ? issuer : cert, cert, nullptr, nullptr, 0);
        add_extension(cert, &ctx, NID_basic_constraints, is_ca ? "critical,CA:TRUE" : "CA:FALSE");
        add_extension(
            cert, &ctx, NID_key_usage,
            is_ca ? "critical,keyCertSign,cRLSign" : "critical,digitalSignature,keyEncipherment");
        add_extension(cert, &ctx, NID_subject_key_identifier, "hash");
        if (!is_ca) {
            add_extension(cert, &ctx, NID_ext_key_usage, "serverAuth");
            add_extension(cert, &ctx, NID_subject_alt_name, subject_alt_names);
            add_extension(cert, &ctx, NID_authority_key_identifier, "keyid:always");
        }
        if (X509_sign(cert, issuer_key, EVP_sha256()) == 0) {
            fail("X509_sign failed");
        }
        return cert;
    }

    // The text of a memory BIO.
    static std::string drain(BIO* bio) {
        std::string text;
        char chunk[4096];
        for (;;) {
            const int n = BIO_read(bio, chunk, sizeof(chunk));
            if (n <= 0) {
                break;
            }
            text.append(chunk, static_cast<std::size_t>(n));
        }
        BIO_free(bio);
        return text;
    }

    static std::string pem_of(X509* cert) {
        BIO* bio = BIO_new(BIO_s_mem());
        if (bio == nullptr || PEM_write_bio_X509(bio, cert) != 1) {
            fail("PEM_write_bio_X509 failed");
        }
        return drain(bio);
    }

    static std::string pem_of(EVP_PKEY* key) {
        BIO* bio = BIO_new(BIO_s_mem());
        if (bio == nullptr ||
            PEM_write_bio_PrivateKey(bio, key, nullptr, nullptr, 0, nullptr, nullptr) != 1) {
            fail("PEM_write_bio_PrivateKey failed");
        }
        return drain(bio);
    }

    static void write_file(const std::filesystem::path& path, const std::string& text) {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        out << text;
        if (!out) {
            fail("cannot write a PEM file into the temporary folder");
        }
    }

    void generate_certificates() {
        ca_key_ = generate_key();
        ca_cert_ = make_certificate(ca_key_, "MFBE Test CA", nullptr, ca_key_, 1, true, "");
        other_ca_key_ = generate_key();
        other_ca_cert_ = make_certificate(other_ca_key_, "MFBE Other Test CA", nullptr,
                                          other_ca_key_, 1, true, "");
        std::string san = "IP:127.0.0.1,DNS:localhost";
        for (const auto& name : options_.dns_names) {
            san += ",DNS:" + name;
        }
        leaf_key_ = generate_key();
        leaf_cert_ = make_certificate(leaf_key_, "127.0.0.1", ca_cert_, ca_key_, 2, false, san);
        write_file(ca_file(), pem_of(ca_cert_));
        write_file(other_ca_file(), pem_of(other_ca_cert_));
        write_file(server_cert_file(), pem_of(leaf_cert_));
        write_file(server_key_file(), pem_of(leaf_key_));
    }

    void create_context() {
        ctx_ = SSL_CTX_new(TLS_server_method());
        if (ctx_ == nullptr) {
            fail("SSL_CTX_new failed");
        }
        const int min_version = static_cast<int>(options_.min_version);
        const int max_version = static_cast<int>(options_.max_version);
        if (min_version < TLS1_2_VERSION || max_version < TLS1_2_VERSION) {
            // OpenSSL 3 keeps TLS 1.0 and 1.1 (SHA-1/MD5 PRF) for security level 0 only.
            SSL_CTX_set_security_level(ctx_, 0);
        }
        if (SSL_CTX_set_min_proto_version(ctx_, min_version) != 1 ||
            SSL_CTX_set_max_proto_version(ctx_, max_version) != 1) {
            fail("cannot set the protocol versions");
        }
        if (SSL_CTX_use_certificate(ctx_, leaf_cert_) != 1 ||
            SSL_CTX_use_PrivateKey(ctx_, leaf_key_) != 1 || SSL_CTX_check_private_key(ctx_) != 1) {
            fail("cannot install the server certificate");
        }
    }

    void listen_loopback() {
        listen_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
        if (listen_fd_ < 0) {
            fail("socket() failed");
        }
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = 0;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (::bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 ||
            ::listen(listen_fd_, 16) != 0) {
            fail("cannot bind 127.0.0.1:0");
        }
        socklen_t length = sizeof(addr);
        if (::getsockname(listen_fd_, reinterpret_cast<sockaddr*>(&addr), &length) != 0) {
            fail("getsockname() failed");
        }
        port_ = ntohs(addr.sin_port);
    }

    // Accept thread: one connection at a time, each served to completion; `stop()` is seen
    // within one 100 ms tick.
    void run() {
        while (!stop_) {
            pollfd waiting{};
            waiting.fd = listen_fd_;
            waiting.events = POLLIN;
            if (::poll(&waiting, 1, 100) <= 0) {
                continue;
            }
            const int fd = ::accept(listen_fd_, nullptr, nullptr);
            if (fd < 0) {
                continue;
            }
            serve(fd);
            ::close(fd);
        }
    }

    // Blocking reads and writes give up after `seconds`, so a peer that stalls cannot hang
    // the fixture (and the test) for good.
    static void set_socket_timeouts(int fd, int seconds) {
        timeval tv{};
        tv.tv_sec = seconds;
        ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
        int one = 1;
        ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
#ifdef SO_NOSIGPIPE
        ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#endif
    }

    void serve(int fd) {
        set_socket_timeouts(fd, 10);
        SSL* ssl = SSL_new(ctx_);
        if (ssl == nullptr) {
            return;
        }
        SSL_set_fd(ssl, fd);
        if (SSL_accept(ssl) != 1) {
            std::string text = "handshake failed";
            if (const unsigned long code = ERR_peek_last_error(); code != 0) {
                char buffer[256];
                ERR_error_string_n(code, buffer, sizeof(buffer));
                text = buffer;
            }
            ERR_clear_error();
            {
                std::lock_guard<std::mutex> lock(mutex_);
                ++connections_;
                ++handshake_failures_;
                last_handshake_error_ = text;
            }
            cv_.notify_all();
            SSL_free(ssl);
            return;
        }
        {
            std::lock_guard<std::mutex> lock(mutex_);
            ++connections_;
        }
        cv_.notify_all();

        RecordedRequest request;
        if (read_request(ssl, request)) {
            ScriptedResponse answer;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                requests_.push_back(request);
                if (!queue_.empty()) {
                    answer = std::move(queue_.front());
                    queue_.pop_front();
                } else {
                    answer = default_;
                }
            }
            cv_.notify_all();
            for (int waited = 0; waited < answer.delay_ms && !stop_; waited += 10) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }
            if (!answer.close_without_reply && !stop_) {
                write_answer(ssl, answer);
                SSL_shutdown(ssl);  // close_notify; a peer already gone is not an error here
                ERR_clear_error();
            }
        }
        SSL_free(ssl);
    }

    // Reads one HTTP/1.1 request (headers, then Content-Length bytes of body). False when the
    // peer went away before the headers were complete.
    static bool read_request(SSL* ssl, RecordedRequest& request) {
        std::string raw;
        std::size_t header_end = std::string::npos;
        std::size_t expected_total = 0;
        char chunk[16384];
        for (;;) {
            if (header_end != std::string::npos && raw.size() >= expected_total) {
                break;
            }
            const int n = SSL_read(ssl, chunk, sizeof(chunk));
            if (n <= 0) {
                ERR_clear_error();
                return false;
            }
            raw.append(chunk, static_cast<std::size_t>(n));
            if (header_end == std::string::npos) {
                header_end = raw.find("\r\n\r\n");
                if (header_end == std::string::npos) {
                    continue;
                }
                parse_head(raw.substr(0, header_end), request);
                header_end += 4;
                const std::string length = request.header("content-length");
                expected_total = header_end + (length.empty() ? 0 : std::stoul(length));
                if (request.header("expect") == "100-continue" && raw.size() < expected_total) {
                    const std::string go_on = "HTTP/1.1 100 Continue\r\n\r\n";
                    SSL_write(ssl, go_on.data(), static_cast<int>(go_on.size()));
                }
            }
        }
        request.body = raw.substr(header_end, expected_total - header_end);
        return true;
    }

    static void parse_head(const std::string& head, RecordedRequest& request) {
        std::size_t line_end = head.find("\r\n");
        const std::string request_line = head.substr(0, line_end);
        const std::size_t sp1 = request_line.find(' ');
        const std::size_t sp2 = request_line.find(' ', sp1 + 1);
        request.method = request_line.substr(0, sp1);
        std::string target = request_line.substr(sp1 + 1, sp2 - sp1 - 1);
        const std::size_t question = target.find('?');
        if (question != std::string::npos) {
            request.query = target.substr(question + 1);
            target.erase(question);
        }
        request.path = target;
        std::size_t pos = line_end == std::string::npos ? head.size() : line_end + 2;
        while (pos < head.size()) {
            line_end = head.find("\r\n", pos);
            const std::string line = head.substr(
                pos, line_end == std::string::npos ? std::string::npos : line_end - pos);
            const std::size_t colon = line.find(':');
            if (colon != std::string::npos) {
                std::string name = line.substr(0, colon);
                for (auto& c : name) {
                    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                }
                std::string value = line.substr(colon + 1);
                while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) {
                    value.erase(value.begin());
                }
                auto it = request.headers.find(name);
                if (it == request.headers.end()) {
                    request.headers.emplace(name, value);
                } else {
                    it->second += ", " + value;
                }
            }
            if (line_end == std::string::npos) {
                break;
            }
            pos = line_end + 2;
        }
    }

    static void write_answer(SSL* ssl, const ScriptedResponse& answer) {
        std::string head = "HTTP/1.1 " + http_status_line(answer.status) + "\r\n";
        for (const auto& [name, value] : answer.headers) {
            head += name + ": " + value + "\r\n";
        }
        head += "Content-Length: " + std::to_string(answer.body.size()) + "\r\n";
        head += "Connection: close\r\n\r\n";
        if (!write_all(ssl, head)) {
            return;
        }
        write_all(ssl, answer.body);
    }

    static bool write_all(SSL* ssl, const std::string& data) {
        std::size_t sent = 0;
        while (sent < data.size()) {
            const std::size_t piece = std::min<std::size_t>(data.size() - sent, 1 << 20);
            const int n = SSL_write(ssl, data.data() + sent, static_cast<int>(piece));
            if (n <= 0) {
                ERR_clear_error();
                return false;
            }
            sent += static_cast<std::size_t>(n);
        }
        return true;
    }

    TlsServerOptions options_;
    TempDir dir_{"mfbe-tls"};
    EVP_PKEY* ca_key_ = nullptr;
    EVP_PKEY* other_ca_key_ = nullptr;
    EVP_PKEY* leaf_key_ = nullptr;
    X509* ca_cert_ = nullptr;
    X509* other_ca_cert_ = nullptr;
    X509* leaf_cert_ = nullptr;
    SSL_CTX* ctx_ = nullptr;
    int listen_fd_ = -1;
    int port_ = 0;
    std::thread thread_;
    std::atomic<bool> stop_{false};

    mutable std::mutex mutex_;
    mutable std::condition_variable cv_;
    std::deque<ScriptedResponse> queue_;
    ScriptedResponse default_ = ScriptedResponse::json(
        500, "{\"error\":{\"message\":\"TLS test server: no scripted answer\"}}");
    std::vector<RecordedRequest> requests_;
    std::size_t connections_ = 0;
    std::size_t handshake_failures_ = 0;
    std::string last_handshake_error_;
};

#else  // !MFBE_TEST_TLS

// Windows (Schannel, no OpenSSL linked): the fixture reports itself unavailable; a test
// skips its HTTPS case with the explicit mark
// "manual: test CA not installed in the runner's user store".
class TlsTestServer {
public:
    static constexpr bool available() { return false; }

    explicit TlsTestServer(TlsServerOptions = {}) {
        throw std::runtime_error(
            "TLS test fixture unavailable: this build links no OpenSSL (MFBE_TEST_TLS unset)");
    }
    TlsTestServer(const TlsTestServer&) = delete;
    TlsTestServer& operator=(const TlsTestServer&) = delete;

    int port() const { return 0; }
    std::string base_url() const { return {}; }
    std::string url(const std::string&) const { return {}; }
    std::filesystem::path ca_file() const { return {}; }
    std::filesystem::path other_ca_file() const { return {}; }
    std::filesystem::path server_cert_file() const { return {}; }
    std::filesystem::path server_key_file() const { return {}; }
    void enqueue(ScriptedResponse) {}
    void set_default(ScriptedResponse) {}
    std::vector<RecordedRequest> requests() const { return {}; }
    std::size_t request_count() const { return 0; }
    bool wait_for_requests(std::size_t, int = 5000) const { return false; }
    std::size_t handshake_failures() const { return 0; }
    std::string last_handshake_error() const { return {}; }
    bool wait_for_connections(std::size_t, int = 5000) const { return false; }
    void clear_requests() {}
    void stop() {}
};

#endif  // MFBE_TEST_TLS

}  // namespace mfbe::test
