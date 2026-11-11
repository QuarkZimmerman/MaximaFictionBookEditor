// Feature 012 (T042; D23, D29; SC-009, SC-010; contracts/rpc-api.md §1): the core's side of the
// hostile EPUBs, over the real loopback server - every one gives a message or a book's parts, never
// a crash, a hang or a read outside the file - and the pictures of an EPUB put into a document
// (epub.picture): JPEG and PNG byte for byte, the rest PNG when transparent or of few colours, else
// JPEG, nothing past 100 megapixels.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/epub.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <string>
#include <tuple>

using namespace mfbe;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-epub-hostile"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }
    static std::string epub(const char* name) {
        return platform::utf8_from_path((test::fixtures_dir() / "epub" / name).lexically_normal());
    }
    json call(const std::string& method, const json& params = json::object()) {
        return ws.call(method, params, 30000);
    }
    json result(const std::string& method, const json& params = json::object()) {
        const json response = call(method, params);
        INFO(response.dump());
        REQUIRE(response.contains("result"));
        return response["result"];
    }
    std::string new_document() { return result("doc.new")["docId"]; }
};

int error_code(const json& response) {
    return response.contains("error") ? response["error"]["code"].get<int>() : 0;
}

std::string reason(const json& response) {
    return response.contains("error") ? response["error"]["data"].value("reason", "") : "";
}

// A 24-bit BMP of `w` x `h` pixels coloured by `colour(x, y)` -> {r, g, b}.
template <typename Colour>
std::string bmp(int w, int h, Colour colour) {
    const int row = ((w * 3 + 3) / 4) * 4;
    const std::uint32_t data = static_cast<std::uint32_t>(row * h);
    std::string b(54 + data, '\0');
    const auto put = [&](std::size_t at, std::uint32_t value, int size) {
        for (int i = 0; i < size; ++i) {
            b[at + i] = static_cast<char>((value >> (8 * i)) & 0xFF);
        }
    };
    b[0] = 'B';
    b[1] = 'M';
    put(2, 54 + data, 4);
    put(10, 54, 4);
    put(14, 40, 4);
    put(18, static_cast<std::uint32_t>(w), 4);
    put(22, static_cast<std::uint32_t>(h), 4);
    put(26, 1, 2);
    put(28, 24, 2);
    put(34, data, 4);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const auto [r, g, bl] = colour(x, y);
            const std::size_t at = 54 + static_cast<std::size_t>((h - 1 - y) * row + x * 3);
            b[at] = static_cast<char>(bl);
            b[at + 1] = static_cast<char>(g);
            b[at + 2] = static_cast<char>(r);
        }
    }
    return b;
}

const char* kContainer =
    "<?xml version=\"1.0\"?>\n<container version=\"1.0\" "
    "xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile "
    "full-path=\"EPUB/package.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles>"
    "</container>\n";

const char* kPackage =
    "<?xml version=\"1.0\"?>\n<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" "
    "unique-identifier=\"uid\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">"
    "<dc:identifier id=\"uid\">x</dc:identifier><dc:title>t</dc:title><dc:language>en"
    "</dc:language></metadata><manifest/><spine/></package>\n";

}  // namespace

TEST_CASE("epub hostile: DRM, a non-ZIP, a password ZIP and a ZIP bomb are messages", "[epub]") {
    Fixture f;
    const std::tuple<const char*, const char*> cases[] = {
        {"drm-adept.epub", "epub.protected"},
        {"not-zip.epub", "epub.notZip"},
        {"password-zip.epub", "epub.encryptedZip"},
        {"zip-bomb.epub", "epub.zipBomb"},
    };
    for (const auto& [file, why] : cases) {
        INFO(file);
        const json opened = f.call("epub.open", json{{"path", Fixture::epub(file)}});
        CHECK(error_code(opened) == 1110);
        CHECK(reason(opened) == why);
    }
}

TEST_CASE("epub hostile: a name leading outside the EPUB is listed and never read", "[epub]") {
    Fixture f;
    const json opened = f.result("epub.open", json{{"path", Fixture::epub("path-escape.epub")}});
    CHECK(opened["outside"] == json::array({"../../escape.txt"}));
    const std::string doc = f.new_document();
    const json picture = f.call("epub.picture", json{{"token", opened["token"]},
                                                     {"entry", "../../escape.txt"},
                                                     {"docId", doc},
                                                     {"suggestedId", "x"}});
    CHECK(error_code(picture) == 1110);
    CHECK(reason(picture) == "epub.noEntry");
}

TEST_CASE(
    "epub picture: JPEG and PNG as they are, the core's formats converted, the rest left "
    "to the interface (D23)",
    "[epub]") {
    Fixture f;
    const std::string doc = f.new_document();
    const json opened = f.result("epub.open", json{{"path", Fixture::epub("everything.epub")}});
    const auto picture = [&](const char* entry, const char* id) {
        return f.call(
            "epub.picture",
            json{
                {"token", opened["token"]}, {"entry", entry}, {"docId", doc}, {"suggestedId", id}});
    };
    const json poster = picture("EPUB/poster.png", "poster")["result"];
    CHECK(poster["converted"] == false);
    CHECK(poster["from"] == "image/png");
    CHECK(poster["binary"]["id"] == "poster");
    CHECK(poster["binary"]["contentType"] == "image/png");
    for (const char* entry : {"EPUB/i.webp", "EPUB/a.gif", "EPUB/i.bmp", "EPUB/i.tif"}) {
        INFO(entry);
        const json converted = picture(entry, "converted")["result"];
        CHECK(converted["converted"] == true);
        const std::string type = converted["binary"]["contentType"];
        CHECK((type == "image/png" || type == "image/jpeg"));
    }
    // The same suggested id twice: the second is made unique.
    CHECK(picture("EPUB/poster.png", "poster")["result"]["binary"]["id"] != "poster");
    for (const char* entry : {"EPUB/i.avif", "EPUB/d.svg"}) {
        INFO(entry);
        CHECK(error_code(picture(entry, "drawn")) == 1013);
    }
}

TEST_CASE("epub picture: PNG for few colours, JPEG for many (D23)", "[epub]") {
    test::TempDir dir{"mfbe-epub-colours"};
    const fs::path file = dir.path() / "colours.epub";
    {
        epub::Writer writer(file);
        writer.add("META-INF/container.xml", kContainer);
        writer.add("EPUB/package.opf", kPackage);
        writer.add("EPUB/two.bmp", bmp(64, 64, [](int x, int) {
                       return x < 32 ? std::tuple{255, 0, 0} : std::tuple{0, 0, 255};
                   }));
        writer.add("EPUB/many.bmp",
                   bmp(64, 64, [](int x, int y) { return std::tuple{x * 4, y * 4, (x + y) * 2}; }));
        writer.commit();
    }
    Fixture f;
    const std::string doc = f.new_document();
    const json opened =
        f.result("epub.open", json{{"path", platform::utf8_from_path(file.lexically_normal())}});
    const auto type_of = [&](const char* entry) {
        const json r = f.result("epub.picture", json{{"token", opened["token"]},
                                                     {"entry", entry},
                                                     {"docId", doc},
                                                     {"suggestedId", "p"}});
        CHECK(r["converted"] == true);
        return r["binary"]["contentType"].get<std::string>();
    };
    CHECK(type_of("EPUB/two.bmp") == "image/png");
    CHECK(type_of("EPUB/many.bmp") == "image/jpeg");
}

TEST_CASE("epub hostile: a picture past 100 megapixels is refused before it is decoded", "[epub]") {
    Fixture f;
    const std::string doc = f.new_document();
    const json opened = f.result("epub.open", json{{"path", Fixture::epub("huge-picture.epub")}});
    const json picture = f.call("epub.picture", json{{"token", opened["token"]},
                                                     {"entry", "EPUB/huge.png"},
                                                     {"docId", doc},
                                                     {"suggestedId", "huge"}});
    CHECK(error_code(picture) == 1110);
    CHECK(reason(picture) == "epub.pictureTooLarge");
    CHECK(picture["error"]["data"]["pixels"] == 10001ull * 10000ull);
}

TEST_CASE("epub hostile: 10,000 pages open and are read within the budget", "[epub]") {
    test::TempDir dir{"mfbe-epub-pages"};
    const fs::path file = dir.path() / "pages.epub";
    {
        epub::Writer writer(file);
        writer.add("META-INF/container.xml", kContainer);
        writer.add("EPUB/package.opf", kPackage);
        for (int n = 0; n < 10000; ++n) {
            writer.add("EPUB/p" + std::to_string(n) + ".xhtml",
                       "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>" +
                           std::to_string(n) + "</p></body></html>");
        }
        writer.commit();
    }
    const auto started = std::chrono::steady_clock::now();
    const epub::Source source = epub::open(file);
    CHECK(source.entries.size() == 10003);  // mimetype, the container, the package, the pages
    std::size_t bytes = 0;
    for (const epub::Entry& entry : source.entries) {
        bytes += epub::read(source, entry.name).size();
    }
    CHECK(bytes > 0);
    // SC-010's budgets are the release build's; this bound only catches a hang.
    CHECK(std::chrono::steady_clock::now() - started < std::chrono::seconds(60));
}
