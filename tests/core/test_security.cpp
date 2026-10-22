// T151 security review - pins the controls listed in docs/architecture.md ("Security review"):
//   * hostile XML never loads external entities or DTDs (XXE, parameter entities, remote DTD),
//     entity expansion, nesting depth and oversized text nodes are bounded and reported as
//     ordinary parse errors instead of hangs or crashes (FR-130);
//   * every HTTP endpoint and the WebSocket handshake require the per-launch token and refuse
//     foreign Origins (contracts/rpc-api.md §1), the UI page carries a strict CSP;
//   * static files are confined to the UI bundle and script files to the script's own folder
//     (plain, URL-encoded and backslash traversal, symlinks pointing outside);
//   * binary uploads are capped with a clear 413 and the server keeps working afterwards;
//   * the errors-only log never receives book text (FR-131).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/binary_store.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/node_ids.hpp>
#include <mfbe/validator.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

using namespace mfbe;
using Catch::Matchers::ContainsSubstring;
using nlohmann::json;

namespace {

namespace fs = std::filesystem;

constexpr const char* kMarker = "SECRET-MARKER-7f3a9c";
constexpr const char* kFb2Ns = "http://www.gribuser.ru/xml/fictionbook/2.0";

std::string file_url(const fs::path& path) {
    std::string generic = path.generic_string();
    if (!generic.empty() && generic.front() != '/') {
        generic.insert(generic.begin(), '/');  // Windows drive letters: file:///C:/...
    }
    return "file://" + generic;
}

std::string book_with_body(const std::string& prolog, const std::string& body) {
    return "<?xml version=\"1.0\"?>" + prolog + "<FictionBook xmlns=\"" + kFb2Ns +
           "\"><description><title-info><genre>sf</genre><author><first-name>A</first-name>"
           "<last-name>B</last-name></author><book-title>T</book-title><lang>en</lang>"
           "</title-info><document-info><author><nickname>n</nickname></author>"
           "<date>2026</date><id>i</id><version>1.0</version></document-info></description>"
           "<body><section>" +
           body + "</section></body></FictionBook>";
}

std::string collect_text(const model::Node& node) {
    if (node.is_text()) {
        return node.text;
    }
    std::string out;
    for (const auto& child : node.content) {
        out += collect_text(child);
    }
    return out;
}

fb2::ReadOptions quick_options() {
    fb2::ReadOptions options;
    options.compute_schema_hint = false;  // no XSD pass: these tests pin the parser only
    return options;
}

// Parses `xml`; returns the body text when the parser accepted it, nullopt on ParseFailure.
// Any other exception (or a crash) fails the test.
std::optional<std::string> parse_text(const std::string& xml) {
    MemoryBinaryStore store;
    model::NodeIdAllocator ids;
    try {
        const fb2::ReadResult result = fb2::read_bytes(xml, store, ids, quick_options());
        std::string text;
        for (const auto& body : result.document.bodies) {
            text += collect_text(body);
        }
        return text;
    } catch (const fb2::ParseFailure& e) {
        CHECK(e.error.line >= 0);
        CHECK_FALSE(e.error.message.empty());
        return std::nullopt;
    }
}

struct Elapsed {
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
    double seconds() const {
        return std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
    }
};

struct ServerFixture {
    test::TempDir root{"mfbe-security"};
    fs::path ui_dir = root / "ui";
    fs::path scripts_dir = root / "scripts";
    fs::path package_dir = scripts_dir / "01_Group" / "01_Probe";
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    ServerFixture() {
        // UI bundle with a sibling secret that must never be served.
        test::write_text(ui_dir / "index.html", "<!doctype html><html><body>MFBE</body></html>");
        test::write_text(ui_dir / "assets" / "app.js", "console.log('ui')");
        test::write_text(root / "secret.txt", kMarker);
        // One script package (manifest + entry) with a secret next to the package folder.
        test::write_text(package_dir / "script.json",
                         R"json({"manifestVersion":1,"id":"sec.probe","name":{"en":"Probe"},)json"
                         R"json("kind":"menu"})json");
        test::write_text(package_dir / "index.js", "export default async function run() {}\n");
        test::write_text(package_dir / "lib" / "util.js", "export const x = 1;\n");
        test::write_text(scripts_dir / "01_Group" / "secret.txt", kMarker);
        test::write_text(scripts_dir / "secret.txt", kMarker);

        options.data_dir = (root / "data").string();
        options.ui_dir = ui_dir.string();
        options.scripts_dir = scripts_dir.string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(port(), "/rpc?token=" + token()) == 101);
    }

    int port() const { return server->port(); }
    const std::string& token() const { return server->token(); }
    std::string own_origin() const { return "http://127.0.0.1:" + std::to_string(port()); }
    std::string with_token(const std::string& path) const {
        return path + (path.find('?') == std::string::npos ? "?" : "&") + "token=" + token();
    }
    test::HttpResponse get(const std::string& path,
                           const std::map<std::string, std::string>& headers = {},
                           const std::string& method = "GET") const {
        return test::http_get(port(), path, headers, method);
    }
    std::string log_text() const {
        const fs::path log = root / "data" / "logs" / "mfbe-errors.log";
        return fs::exists(log) ? test::read_text(log) : std::string();
    }
    std::string new_document() {
        const json created = ws.call("doc.new");
        REQUIRE(created.contains("result"));
        return created["result"]["docId"].get<std::string>();
    }
};

// Creates `link` -> `target` and reports whether the platform allowed it (Windows needs a
// privilege for symlinks; the test skips the symlink probe there).
bool try_symlink(const fs::path& target, const fs::path& link) {
    std::error_code ec;
    fs::create_symlink(target, link, ec);
    return !ec && fs::is_symlink(link, ec);
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* XML hardening                                                                              */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("security: external entities and DTDs are never loaded by the FB2 parser",
          "[security][xml]") {
    test::TempDir tmp{"mfbe-xxe"};
    test::write_text(tmp / "secret.txt", kMarker);
    test::write_text(tmp / "evil.dtd", std::string("<!ENTITY leak \"") + kMarker + "\">\n");
    const std::string secret_url = file_url(tmp / "secret.txt");
    const std::string dtd_url = file_url(tmp / "evil.dtd");

    SECTION("general external entity in content") {
        const std::string xml =
            book_with_body("<!DOCTYPE FictionBook [<!ENTITY ext SYSTEM \"" + secret_url + "\">]>",
                           "<p>before &ext; after</p>");
        Elapsed timer;
        const auto text = parse_text(xml);
        CHECK(timer.seconds() < 5.0);
        if (text) {
            CHECK(text->find(kMarker) == std::string::npos);
        }
    }

    SECTION("parameter entity in the internal subset") {
        const std::string xml = book_with_body(
            "<!DOCTYPE FictionBook [<!ENTITY % ext SYSTEM \"" + secret_url + "\"> %ext;]>",
            "<p>text</p>");
        const auto text = parse_text(xml);
        if (text) {
            CHECK(text->find(kMarker) == std::string::npos);
        }
    }

    SECTION("external DTD subset defining an entity") {
        const std::string xml = book_with_body("<!DOCTYPE FictionBook SYSTEM \"" + dtd_url + "\">",
                                               "<p>x &leak; y</p>");
        const auto text = parse_text(xml);
        if (text) {
            CHECK(text->find(kMarker) == std::string::npos);
        }
    }

    SECTION("network DTD location is not contacted (XML_PARSE_NONET + refusing loader)") {
        // Port 1 is never listening; a parser that tried to connect would stall or error out
        // differently. The document must be answered within the usual parse time.
        const std::string xml = book_with_body(
            "<!DOCTYPE FictionBook SYSTEM \"http://127.0.0.1:1/fb2.dtd\">", "<p>text</p>");
        Elapsed timer;
        const auto text = parse_text(xml);
        CHECK(timer.seconds() < 5.0);
        if (text) {
            CHECK(text->find(kMarker) == std::string::npos);
        }
    }

    SECTION("validator and well-formedness check take the same hardened path") {
        const std::string xml = book_with_body(
            "<!DOCTYPE FictionBook [<!ENTITY ext SYSTEM \"" + secret_url + "\">]>", "<p>&ext;</p>");
        const model::ValidationReport report = validation::validate_xml_text(xml);
        for (const auto& issue : report.issues) {
            for (const auto& param : issue.params) {
                CHECK(param.second.dump().find(kMarker) == std::string::npos);
            }
        }
        const auto error = fb2::check_well_formed(xml);
        if (error) {
            CHECK(error->message.find(kMarker) == std::string::npos);
        }
    }
}

TEST_CASE("security: entity expansion, nesting depth and huge text nodes are bounded",
          "[security][xml]") {
    SECTION("billion laughs stays small or is rejected") {
        std::string prolog = "<!DOCTYPE FictionBook [<!ENTITY a \"" + std::string(50, 'a') + "\">";
        const char* names = "bcdefg";
        char previous = 'a';
        for (const char* n = names; *n != '\0'; ++n) {
            prolog += "<!ENTITY " + std::string(1, *n) + " \"";
            for (int i = 0; i < 10; ++i) {
                prolog += "&" + std::string(1, previous) + ";";
            }
            prolog += "\">";
            previous = *n;
        }
        prolog += "]>";
        const std::string xml =
            book_with_body(prolog, "<p>&g;</p>");  // 50 * 10^6 bytes if expanded
        Elapsed timer;
        const auto text = parse_text(xml);
        CHECK(timer.seconds() < 5.0);
        if (text) {
            CHECK(text->size() < 1024 * 1024);
        }
    }

    SECTION("300 nested sections are refused as a parse error, not a stack overflow") {
        std::string body;
        for (int i = 0; i < 300; ++i) {
            body += "<section>";
        }
        body += "<p>deep</p>";
        for (int i = 0; i < 300; ++i) {
            body += "</section>";
        }
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        CHECK_THROWS_AS(fb2::read_bytes(book_with_body("", body), store, ids, quick_options()),
                        fb2::ParseFailure);
    }

    SECTION("a text node above libxml2's 10 MB limit is a parse error") {
        const std::string xml =
            book_with_body("", "<p>" + std::string(11 * 1000 * 1000, 'a') + "</p>");
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        CHECK_THROWS_AS(fb2::read_bytes(xml, store, ids, quick_options()), fb2::ParseFailure);
    }

    SECTION("a binary payload above that limit is decoded from SAX chunks and accepted") {
        const std::size_t base64_length = 11 * 1000 * 1000;  // multiple of 4
        const std::string xml =
            "<?xml version=\"1.0\"?><FictionBook xmlns=\"" + std::string(kFb2Ns) +
            "\"><description><title-info><genre>sf</genre><author><first-name>A</first-name>"
            "<last-name>B</last-name></author><book-title>T</book-title><lang>en</lang>"
            "</title-info><document-info><author><nickname>n</nickname></author><date>2026</date>"
            "<id>i</id><version>1.0</version></document-info></description><body><section>"
            "<p>t</p></section></body><binary id=\"big.bin\" content-type=\"image/png\">" +
            std::string(base64_length, 'A') + "</binary></FictionBook>";
        MemoryBinaryStore store;
        model::NodeIdAllocator ids;
        const fb2::ReadResult result = fb2::read_bytes(xml, store, ids, quick_options());
        REQUIRE(store.size() == 1);
        const auto meta = store.meta("big.bin");
        REQUIRE(meta.has_value());
        CHECK(meta->size == static_cast<std::int64_t>(base64_length / 4 * 3));
        CHECK(result.document.binaries.size() == 1);
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Loopback server: authentication                                                           */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("security: every HTTP endpoint and the WebSocket handshake need the token",
          "[security][server]") {
    ServerFixture f;
    const std::string doc_id = f.new_document();
    const json added = f.ws.call(
        "binary.add",
        json{{"docId", doc_id}, {"path", (test::fixtures_dir() / "images" / "tiny.png").string()}});
    REQUIRE(added.contains("result"));
    const std::string binary_id = added["result"]["id"];
    const std::string png = test::read_text(test::fixtures_dir() / "images" / "tiny.png");

    const std::string binary_path = "/binary/" + doc_id + "/" + binary_id;
    const std::string preview_path = binary_path + "/preview?w=4";
    const std::string script_path = "/scripts/sec.probe/index.js";

    SECTION("without a token every entry point answers 401 and leaks nothing") {
        for (const std::string& path :
             {binary_path, preview_path, script_path, std::string("/health"), std::string("/"),
              std::string("/index.html"), std::string("/assets/app.js")}) {
            const test::HttpResponse response = f.get(path);
            INFO(path);
            CHECK(response.status == 401);
            CHECK(response.body.find(f.token()) == std::string::npos);
            CHECK_FALSE(response.headers.count("set-cookie"));
            CHECK(f.get(path, {}, "HEAD").status == 401);
        }
        CHECK(test::http_request(f.port(), "POST", "/binary/" + doc_id,
                                 {{"Content-Type", "image/png"}}, png)
                  .status == 401);
        // Wrong, truncated and differently-cased tokens are all refused.
        CHECK(f.get(binary_path + "?token=" + std::string(32, '0')).status == 401);
        CHECK(f.get(binary_path + "?token=" + f.token().substr(1)).status == 401);
        std::string upper = f.token();
        for (char& c : upper) {
            c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        }
        if (upper != f.token()) {
            CHECK(f.get(binary_path + "?token=" + upper).status == 401);
        }
        test::WsClient no_token;
        CHECK(no_token.open(f.port(), "/rpc") == 401);
        test::WsClient wrong_token;
        CHECK(wrong_token.open(f.port(), "/rpc?token=" + std::string(32, 'f')) == 401);
    }

    SECTION("the token is accepted from the query, the header and the cookie") {
        CHECK(f.get(f.with_token(binary_path)).status == 200);
        CHECK(f.get(binary_path, {{"X-MFBE-Token", f.token()}}).status == 200);
        CHECK(f.get(binary_path, {{"Cookie", "mfbe_token=" + f.token()}}).status == 200);
        CHECK(f.get(f.with_token(preview_path)).status == 200);
        CHECK(f.get(f.with_token(script_path)).status == 200);
        CHECK(f.get(f.with_token(script_path)).body.find("run()") != std::string::npos);
    }

    SECTION("a foreign Origin is refused on every entry point even with a valid token") {
        const std::vector<std::string> foreign = {
            "http://evil.example",
            "null",
            "https://127.0.0.1:" + std::to_string(f.port()),  // scheme must match
            "http://127.0.0.1:" + std::to_string(f.port()) + ".evil.example",
            "http://127.0.0.1:" + std::to_string(f.port() == 65535 ? 1 : f.port() + 1),
            "http://localhost",
        };
        for (const std::string& origin : foreign) {
            for (const std::string& path : {binary_path, preview_path, script_path,
                                            std::string("/health"), std::string("/")}) {
                INFO(origin << " -> " << path);
                CHECK(f.get(f.with_token(path), {{"Origin", origin}}).status == 403);
            }
            CHECK(test::http_request(f.port(), "POST", f.with_token("/binary/" + doc_id),
                                     {{"Content-Type", "image/png"}, {"Origin", origin}}, png)
                      .status == 403);
            test::WsClient ws;
            CHECK(ws.open(f.port(), "/rpc?token=" + f.token(), {{"Origin", origin}}) == 403);
        }
        // The core's own origins (127.0.0.1 and localhost on its port) pass.
        for (const std::string& origin :
             {f.own_origin(), "http://localhost:" + std::to_string(f.port())}) {
            CHECK(f.get(f.with_token(binary_path), {{"Origin", origin}}).status == 200);
            CHECK(f.get(f.with_token(script_path), {{"Origin", origin}}).status == 200);
            test::WsClient ws;
            CHECK(ws.open(f.port(), "/rpc?token=" + f.token(), {{"Origin", origin}}) == 101);
        }
    }

    SECTION("the UI page carries the strict CSP and a locked-down token cookie") {
        const test::HttpResponse index = f.get(f.with_token("/"));
        REQUIRE(index.status == 200);
        const std::string csp = index.headers.at("content-security-policy");
        CHECK(csp.find("default-src 'self'") != std::string::npos);
        CHECK(csp.find("script-src 'self'") != std::string::npos);
        CHECK(csp.find("connect-src 'self' ws://127.0.0.1:" + std::to_string(f.port()) +
                       " http://127.0.0.1:" + std::to_string(f.port())) != std::string::npos);
        CHECK(csp.find("worker-src 'self' blob:") != std::string::npos);
        CHECK(csp.find("unsafe-eval") == std::string::npos);
        CHECK(csp.find("*") == std::string::npos);
        CHECK(csp.find("https:") == std::string::npos);
        const std::string cookie = index.headers.at("set-cookie");
        CHECK(cookie.rfind("mfbe_token=" + f.token() + ";", 0) == 0);
        CHECK(cookie.find("HttpOnly") != std::string::npos);
        CHECK(cookie.find("SameSite=Strict") != std::string::npos);
        CHECK(index.headers.at("x-content-type-options") == "nosniff");
        CHECK(index.headers.at("referrer-policy") == "no-referrer");
        CHECK(index.headers.at("cache-control") == "no-store");
        // Binary responses are never sniffed and never cached across sessions.
        const test::HttpResponse binary = f.get(f.with_token(binary_path));
        CHECK(binary.headers.at("x-content-type-options") == "nosniff");
        CHECK(binary.headers.at("cache-control") == "private, no-cache");
        // Script modules are served with a JavaScript MIME type (module loading refuses others).
        CHECK(f.get(f.with_token(script_path)).headers.at("content-type") ==
              "text/javascript; charset=utf-8");
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Loopback server: path confinement                                                         */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("security: served files are confined to the UI bundle and to the script's folder",
          "[security][server]") {
    ServerFixture f;
    const bool symlinks = try_symlink(f.root / "secret.txt", f.ui_dir / "leak.txt") &&
                          try_symlink(f.scripts_dir / "secret.txt", f.package_dir / "leak.js");

    auto refused = [&](const std::string& path) {
        const test::HttpResponse response = f.get(f.with_token(path));
        INFO(path << " -> " << response.status << " " << response.body);
        CHECK(response.status == 404);
        CHECK(response.body.find(kMarker) == std::string::npos);
    };

    SECTION("UI bundle") {
        CHECK(f.get(f.with_token("/assets/app.js")).status == 200);
        for (const char* path : {
                 "/../secret.txt",
                 "/assets/../../secret.txt",
                 "/%2e%2e/secret.txt",
                 "/%2E%2E%2Fsecret.txt",
                 "/assets/%2e%2e/%2e%2e/secret.txt",
                 "/assets/..%2f..%2fsecret.txt",
                 "/..%5csecret.txt",
                 "/assets/..%5c..%5csecret.txt",
                 "/assets%2f..%2f..%2fsecret.txt",
                 "/assets/app.js%00/../../secret.txt",
                 "/%00secret.txt",
                 "//secret.txt",
                 "/assets/",
                 "/assets",
             }) {
            refused(path);
        }
        if (symlinks) {
            refused("/leak.txt");
        }
        // Only GET and HEAD reach the bundle.
        CHECK(f.get(f.with_token("/index.html"), {}, "POST").status == 405);
        CHECK(f.get(f.with_token("/index.html"), {}, "DELETE").status == 405);
    }

    SECTION("script packages") {
        CHECK(f.get(f.with_token("/scripts/sec.probe/index.js")).status == 200);
        CHECK(f.get(f.with_token("/scripts/sec.probe/lib/util.js")).status == 200);
        CHECK(f.get(f.with_token("/scripts/sec.probe/script.json")).status == 200);
        for (const char* path : {
                 "/scripts/sec.probe/../secret.txt",
                 "/scripts/sec.probe/../../secret.txt",
                 "/scripts/sec.probe/lib/../../secret.txt",
                 "/scripts/sec.probe/..%2fsecret.txt",
                 "/scripts/sec.probe/%2e%2e/secret.txt",
                 "/scripts/sec.probe/%2E%2E%2F%2E%2E%2Fsecret.txt",
                 "/scripts/sec.probe/..%5csecret.txt",
                 "/scripts/sec.probe/lib%2f..%2f..%2fsecret.txt",
                 "/scripts/sec.probe/index.js%00.txt",
                 "/scripts/sec.probe//secret.txt",
                 "/scripts/sec.probe/./index.js",
                 "/scripts/sec.probe/",
                 "/scripts/sec.probe",
                 "/scripts/../secret.txt",
                 "/scripts/%2e%2e/secret.txt",
                 "/scripts/unknown.script/index.js",
             }) {
            refused(path);
        }
        if (symlinks) {
            refused("/scripts/sec.probe/leak.js");
        }
        // An absolute path hidden in the file part is refused on every platform.
        refused("/scripts/sec.probe/C:/Windows/win.ini");
        refused("/scripts/sec.probe/%2fetc%2fpasswd");
    }
}

/* ----------------------------------------------------------------------------------------- */
/* Loopback server: upload cap                                                               */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("security: an upload above 256 MB is refused with a clear 413 and the server lives on",
          "[security][server]") {
#ifndef _WIN32
    // Should the server ever close early, a write must fail with EPIPE instead of killing the
    // test process (a no-op handler avoids the old-style cast hidden in SIG_IGN).
    std::signal(SIGPIPE, +[](int) {});
#endif
    ServerFixture f;
    const std::string doc_id = f.new_document();

    // Exactly one byte above the cap: the rejection happens on the last chunk, after the whole
    // body has been received, so the 413 is delivered before the server closes the connection.
    const std::size_t limit = 256ULL * 1024 * 1024;
    const std::size_t total = limit + 1;
    const std::string chunk(1024 * 1024, 'x');

    test::TcpClient client;
    client.connect(f.port());
    client.send_all("POST /binary/" + doc_id + "?token=" + f.token() +
                    " HTTP/1.1\r\nHost: 127.0.0.1:" + std::to_string(f.port()) +
                    "\r\nConnection: close\r\nContent-Type: image/png\r\nContent-Length: " +
                    std::to_string(total) + "\r\n\r\n");
    std::string raw;
    std::size_t sent = 0;
    bool send_failed = false;
    Elapsed timer;
    while (sent < total) {
        const std::size_t n = std::min(chunk.size(), total - sent);
        try {
            client.send_all(chunk.substr(0, n));
        } catch (const std::runtime_error&) {
            send_failed = true;  // the server already answered and went away
            break;
        }
        sent += n;
        // Pick up an early answer without blocking the upload.
        try {
            client.read_some(raw, 0);
        } catch (const std::runtime_error&) {
            break;
        }
        if (raw.find("\r\n\r\n") != std::string::npos) {
            break;
        }
    }
    // Drain the response (the server closes the connection after it).
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (std::chrono::steady_clock::now() < deadline) {
        try {
            if (!client.read_some(raw, 100)) {
                if (raw.find("\r\n\r\n") != std::string::npos) {
                    const test::HttpResponse head = test::parse_http_response(raw);
                    const auto it = head.headers.find("content-length");
                    if (it != head.headers.end() &&
                        head.body.size() >= static_cast<std::size_t>(std::stoul(it->second))) {
                        break;
                    }
                }
                continue;
            }
        } catch (const std::runtime_error&) {
            break;
        }
    }
    INFO("sent " << sent << " of " << total << " bytes in " << timer.seconds() << " s"
                 << (send_failed ? " (send failed)" : ""));
    REQUIRE(raw.find("\r\n\r\n") != std::string::npos);
    const test::HttpResponse response = test::parse_http_response(raw);
    CHECK(response.status == 413);
    CHECK_THAT(response.body, ContainsSubstring("256 MB"));
    CHECK(timer.seconds() < 30.0);

    // Nothing was stored and the server still answers normally.
    CHECK(f.ws.call("binary.list", json{{"docId", doc_id}})["result"].size() == 0);
    CHECK(f.get(f.with_token("/health")).status == 200);
    const std::string png = test::read_text(test::fixtures_dir() / "images" / "tiny.png");
    CHECK(test::http_request(f.port(), "POST", f.with_token("/binary/" + doc_id),
                             {{"Content-Type", "image/png"}}, png)
              .status == 201);
}

/* ----------------------------------------------------------------------------------------- */
/* Errors-only log                                                                           */
/* ----------------------------------------------------------------------------------------- */

TEST_CASE("security: the errors-only log never receives book text", "[security][log]") {
    ServerFixture f;
    const std::string doc_id = f.new_document();
    const std::string sentence = "Zq-unique-book-sentence-83c1 never leaves the document";

    // Parse failures of Source text: reported to the client with line/column, not logged with
    // the text.
    const json failed = f.ws.call(
        "doc.fromXml",
        json{{"docId", doc_id},
             {"text", "<FictionBook xmlns=\"" + std::string(kFb2Ns) + "\"><body><section><p>" +
                          sentence + "</section></body></FictionBook>"}});
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1001);
    CHECK(failed["error"]["data"]["line"].is_number());

    // A malformed file on disk opened through doc.open / doc.openSource.
    const json opened = f.ws.call(
        "doc.open", json{{"path", (test::fixtures_dir() / "books" / "malformed.fb2").string()}});
    CHECK(opened.contains("error"));
    const json source =
        f.ws.call("doc.openSource",
                  json{{"path", (test::fixtures_dir() / "books" / "malformed.fb2").string()}});
    REQUIRE(source.contains("result"));
    CHECK_THAT(source["result"]["text"].get<std::string>(),
               ContainsSubstring("This paragraph is never closed"));

    // Validation of hostile text and a UI-side error report with document context.
    f.ws.call("doc.validate", json{{"docId", doc_id},
                                   {"text", "<FictionBook xmlns=\"" + std::string(kFb2Ns) +
                                                "\"><body><section><p>" + sentence +
                                                "</p></section></body></FictionBook>"}});
    f.ws.call("log.error", json{{"source", "ui"},
                                {"code", "ui.securityTest"},
                                {"message", "command failed"},
                                {"context", {{"docId", doc_id}, {"view", "body"}}}});

    const std::string log = f.log_text();
    CHECK(log.find("ui.securityTest") != std::string::npos);  // the log itself works
    CHECK(log.find(sentence) == std::string::npos);
    CHECK(log.find("Zq-unique") == std::string::npos);
    CHECK(log.find("This paragraph is never closed") == std::string::npos);
    CHECK(log.find(f.token()) == std::string::npos);  // nor the session token
}

// Feature 005 (rpc-api.md "Logging", FR-100): a 1200 ai.noService refusal reaches the router's
// log with its allow-listed data only - never the `service` value (the agreement key carries
// the address) - and a failed exchange writes one `ai.<kind>` entry holding the method, the
// target kind, the host and the status, never the key, the model, the instruction or the body.
TEST_CASE(
    "security: ai.* refusals and failures leave no service text, key or instruction in "
    "the log",
    "[security][log][ai]") {
    ServerFixture f;
    const std::string address = "http://ai.standin.test:8787/v1";
    const std::string key = "sk-security-probe-key-4421";
    const std::string instruction = "Rewrite the chapter about the marker " + std::string(kMarker);
    f.ws.call(
        "settings.set",
        json{{"patch",
              {{"ai",
                {{"mode", "custom"},
                 {"custom", {{"address", address}, {"key", key}, {"model", "probe-model"}}}}}}}});
    const json body{{"messages", json::array({json{{"role", "user"}, {"content", instruction}}})}};

    // Hosted address, no agreement: 1200 {reason: noAgreement, service: 'custom:<address>'}.
    const json refused =
        f.ws.call("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", body}});
    REQUIRE(refused.contains("error"));
    CHECK(refused["error"]["code"] == 1200);
    CHECK(refused["error"]["data"] ==
          json{{"reason", "noAgreement"}, {"service", "custom:" + address}});
    std::string log = f.log_text();
    CHECK(log.find("rpc.ai.noService") != std::string::npos);
    CHECK(log.find("\"reason\":\"noAgreement\"") != std::string::npos);
    CHECK(log.find("custom:") == std::string::npos);
    CHECK(log.find("ai.standin.test") == std::string::npos);

    // With the agreement the request goes out; whatever its outcome, the log holds the kind,
    // the host and the status only.
    f.ws.call("settings.set", json{{"patch",
                                    {{"ai",
                                      {{"agreements",
                                        {json{{"service", "custom:" + address},
                                              {"host", "ai.standin.test:8787"},
                                              {"at", "2026-10-22T10:00:00Z"}}}}}}}}});
    const json started =
        f.ws.call("ai.complete", json{{"target", {{"kind", "custom"}}}, {"body", body}});
    REQUIRE(started.contains("result"));
    const std::string job_id = started["result"]["jobId"].get<std::string>();
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    std::optional<json> ended;
    while (!ended && std::chrono::steady_clock::now() < deadline) {
        auto message = f.ws.receive_json(500);
        if (message &&
            (message->value("method", "") == "job.done" ||
             message->value("method", "") == "job.failed") &&
            (*message)["params"]["jobId"] == job_id) {
            ended = message;
        }
    }
    REQUIRE(ended);
    log = f.log_text();
    for (const char* secret :
         {kMarker, "sk-security-probe-key", "probe-model", "Rewrite the", "chat/completions"}) {
        INFO(secret);
        CHECK(log.find(secret) == std::string::npos);
    }
    CHECK(log.find(f.token()) == std::string::npos);
    if (log.find("\"code\":\"ai.") != std::string::npos) {
        // One errors-only entry per failed outcome with the allowed context only.
        CHECK(log.find("\"method\":\"ai.complete\"") != std::string::npos);
        CHECK(log.find("\"targetKind\":\"custom\"") != std::string::npos);
        CHECK(log.find("\"host\":\"ai.standin.test:8787\"") != std::string::npos);
    }
}
