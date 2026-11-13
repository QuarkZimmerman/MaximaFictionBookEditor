// Feature 014 (DP-6, analysis C3; tasks T054): where the fonts the user adds are kept - the
// per-user data folder of an installed editor, the portable editor's user/fonts/, the per-user
// folder again when the portable folder cannot be written - and that names outside ASCII, of the
// user's folders and of the fonts, go through.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/atomic_file.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>

#ifndef _WIN32
#include <unistd.h>
#endif

#include "pdf/fonts.hpp"

using namespace mfbe;
using json = nlohmann::json;

namespace {

std::string mono() {
    return atomic_file::read_file(test::fixtures_dir().parent_path().parent_path() / "resources" /
                                  "fonts" / "DejaVuSansMono.ttf");
}

bool inside(const std::filesystem::path& path, const std::filesystem::path& folder) {
    const auto rel = std::filesystem::relative(path, folder);
    return !rel.empty() && rel.native().front() != '.';
}

}  // namespace

TEST_CASE("pdf fonts dirs: a portable editor keeps its fonts in user/fonts/",
          "[pdf][fonts][dirs]") {
    test::TempDir tmp;
    const auto portable = tmp / "user";
    std::filesystem::create_directories(portable);
    const auto dirs = platform::resolve_dirs("", portable);
    REQUIRE(dirs.data == portable);
    const auto added = pdf::add_font(dirs.data / "fonts", mono(), "ttf", 0, "file", "mono.ttf");
    REQUIRE(added.font);
    CHECK(std::filesystem::exists(portable / "fonts" / added.font->file));
    CHECK(std::filesystem::exists(portable / "fonts" / "fonts.json"));
}

TEST_CASE("pdf fonts dirs: an installed editor keeps them in the per-user data folder",
          "[pdf][fonts][dirs]") {
    const auto dirs = platform::resolve_dirs("", std::nullopt);
    // The per-user data folder, never the program's own folder (where an installer puts the
    // editor).
    CHECK_FALSE(inside(dirs.data / "fonts", test::fixtures_dir().parent_path().parent_path()));
    CHECK(dirs.data / "fonts" != dirs.config);
}

#ifndef _WIN32
TEST_CASE("pdf fonts dirs: a portable folder that cannot be written falls back to the per-user one",
          "[pdf][fonts][dirs]") {
    if (::geteuid() == 0) {
        SKIP("root writes into read-only folders");
    }
    test::TempDir tmp;
    const auto portable = tmp / "user";
    std::filesystem::create_directories(portable);
    std::filesystem::permissions(
        portable, std::filesystem::perms::owner_read | std::filesystem::perms::owner_exec);
    const auto dirs = platform::resolve_dirs("", portable);
    std::filesystem::permissions(portable, std::filesystem::perms::owner_all);
    CHECK(dirs.data == platform::resolve_dirs("", std::nullopt).data);
    CHECK_FALSE(inside(dirs.data / "fonts", portable));
}
#endif

TEST_CASE("pdf fonts dirs: names outside ASCII, of the folders and of the font",
          "[pdf][fonts][dirs][rpc]") {
    test::TempDir tmp;
    const auto data = tmp / platform::path_from_utf8("Пользователь Ünïcode").string();
    std::filesystem::create_directories(data);
    CoreServerOptions options;
    options.data_dir = platform::utf8_from_path(data);
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const auto file = data / platform::path_from_utf8("Шрифт ünï.ttf");
    atomic_file::write_atomic(file, mono());
    const json answer =
        ws.call("pdf.fonts.addFile", json{{"path", platform::utf8_from_path(file)}});
    REQUIRE(answer.contains("result"));
    REQUIRE(answer["result"].contains("font"));
    CHECK(answer["result"]["font"]["name"] == "Шрифт ünï.ttf");
    const std::string id = answer["result"]["font"]["id"];
    CHECK(std::filesystem::exists(data / "fonts" / (id + ".ttf")));
    const auto listed = pdf::added_fonts(data / "fonts");
    REQUIRE(listed.size() == 1);
    CHECK(listed[0].source_name == "Шрифт ünï.ttf");
}
