// Feature 002, research R1: per-user folders, the core server's folders and the errors-only log
// with Cyrillic and CJK names. On the Windows CI job the test executable runs with the legacy
// code page, where std::filesystem::path(std::string) and path::string() would turn these names
// into other folders.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/recent_files.hpp>
#include <mfbe/scripts.hpp>
#include <mfbe/validator.hpp>

#include <catch2/catch_test_macros.hpp>
#include <cstdlib>
#include <filesystem>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using namespace mfbe;
using nlohmann::json;

namespace {

namespace fs = std::filesystem;

fs::path below(const fs::path& base, const std::string& name) {
    return base / platform::path_from_utf8(name);
}

std::string utf8(const fs::path& path) {
    return platform::utf8_from_path(path);
}

std::set<std::string> listed(const fs::path& dir) {
    std::set<std::string> names;
    for (const auto& entry : fs::directory_iterator(dir)) {
        names.insert(utf8(entry.path().filename()));
    }
    return names;
}

#ifdef __linux__
struct EnvGuard {
    EnvGuard(const char* name_, const std::string& value) : name(name_) {
        if (const char* old = std::getenv(name_)) {
            previous = old;
        }
        setenv(name_, value.c_str(), 1);
    }
    ~EnvGuard() {
        if (previous) {
            setenv(name, previous->c_str(), 1);
        } else {
            unsetenv(name);
        }
    }
    EnvGuard(const EnvGuard&) = delete;
    EnvGuard& operator=(const EnvGuard&) = delete;

    const char* name;
    std::optional<std::string> previous;
};
#endif

}  // namespace

TEST_CASE("dirs unicode: platform-folders text with Cyrillic and CJK letters gives the folders",
          "[dirs][unicode]") {
    // platform-folders returns UTF-8 text; dirs.cpp converts it with path_from_utf8, which must
    // give the operating system's own spelling: UTF-16 on Windows, the bytes elsewhere.
    struct Sample {
        std::string utf8;
        std::wstring wide;
    };
    const std::vector<Sample> samples = {
        {"C:\\Users\\Тест\\AppData\\Roaming",
         L"C:\\Users\\\u0422\u0435\u0441\u0442\\AppData\\Roaming"},
        {"/home/书/.config", L"/home/\u4e66/.config"},
        {"D:\\Профиль 书\\Local", L"D:\\\u041f\u0440\u043e\u0444\u0438\u043b\u044c \u4e66\\Local"},
    };
    for (const Sample& sample : samples) {
        INFO(sample.utf8);
        const fs::path path = platform::path_from_utf8(sample.utf8);
#ifdef _WIN32
        CHECK(path.native() == sample.wide);
#else
        CHECK(path.native() == sample.utf8);
#endif
        CHECK(utf8(path) == sample.utf8);
    }
    // The application folders below such roots exist under exactly these names.
    test::TempDir tmp{"mfbe-dirs-unicode"};
    const std::set<std::string> roots = {"Тест", "书", "Профиль 书"};
    for (const std::string& root : roots) {
        const fs::path folder = below(tmp.path(), root) / "Maxima Fiction Book Editor";
        fs::create_directories(folder);
        CHECK(fs::is_directory(folder));
    }
    CHECK(listed(tmp.path()) == roots);
}

#ifdef __linux__
TEST_CASE("dirs unicode: XDG folders with Cyrillic and CJK names come through platform-folders",
          "[dirs][unicode]") {
    test::TempDir tmp{"mfbe-dirs-xdg"};
    const fs::path home = below(tmp.path(), "Тест 书");
    EnvGuard config("XDG_CONFIG_HOME", utf8(below(home, "настройки")));
    EnvGuard data("XDG_DATA_HOME", utf8(below(home, "данные")));
    EnvGuard state("XDG_STATE_HOME", utf8(below(home, "состояние")));
    const platform::Dirs dirs = platform::resolve_dirs();
    CHECK(dirs.config == below(home, "настройки") / "maxfbeditor");
    CHECK(dirs.data == below(home, "данные") / "maxfbeditor");
    CHECK(dirs.state == below(home, "состояние") / "maxfbeditor");
    CHECK(dirs.logs == below(home, "состояние") / "maxfbeditor" / "logs");
    platform::ensure_dirs(dirs);
    CHECK(fs::is_directory(dirs.config));
    CHECK(fs::is_directory(dirs.data));
    CHECK(fs::is_directory(dirs.logs));
    CHECK(listed(tmp.path()) == std::set<std::string>{"Тест 书"});
    CHECK(listed(home) == std::set<std::string>{"настройки", "данные", "состояние"});
}
#endif

TEST_CASE("dirs unicode: an override root with Cyrillic and CJK names is used as given",
          "[dirs][unicode]") {
    test::TempDir tmp{"mfbe-dirs-override"};
    const fs::path root = below(tmp.path(), "Тест 书");
    const platform::Dirs dirs = platform::resolve_dirs(utf8(root));
    CHECK(dirs.config == root);
    CHECK(dirs.data == root);
    CHECK(dirs.state == root);
    CHECK(dirs.logs == root / "logs");
    platform::ensure_dirs(dirs);
    CHECK(fs::is_directory(dirs.config));
    CHECK(fs::is_directory(dirs.logs));
    CHECK(listed(tmp.path()) == std::set<std::string>{"Тест 书"});
}

TEST_CASE(
    "dirs unicode: the core server starts with data, resources, scripts and UI folders "
    "named in Cyrillic and CJK",
    "[dirs][unicode][server]") {
    test::TempDir tmp{"mfbe-server-unicode"};
    const fs::path base = below(tmp.path(), "Тест 书");
    const fs::path data = below(base, "данные");
    const fs::path resources = below(base, "ресурсы");
    const fs::path scripts = below(base, "скрипты");
    const fs::path ui = below(base, "интерфейс");
    fs::create_directories(base);
    fs::copy(platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR), resources,
             fs::copy_options::recursive);
    fs::create_directories(scripts);
    test::write_text(ui / "index.html", "<!doctype html><title>Тест</title>");
    test::write_text(below(ui, "заметка 书.txt"), "текст");

    CoreServerOptions options;
    options.data_dir = utf8(data);
    options.resources_dir = utf8(resources);
    options.scripts_dir = utf8(scripts);
    options.ui_dir = utf8(ui);
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    // The folders are the given ones and exist; app.info carries them as UTF-8.
    const json info = ws.call("app.info")["result"];
    CHECK(info["dataDir"] == utf8(data));
    CHECK(info["configDir"] == utf8(data));
    CHECK(info["logDir"] == utf8(data / "logs"));
    CHECK(info["resourcesDir"] == utf8(resources));
    CHECK(info["scriptsDir"] == utf8(scripts));
    CHECK(fs::is_directory(data / "logs"));
    CHECK(listed(base) == std::set<std::string>{"данные", "ресурсы", "скрипты", "интерфейс"});

    // Every resource is read from that folder: blank template, schema, genres, dictionaries.
    const json created = ws.call("doc.new");
    REQUIRE(created.contains("result"));
    std::string schema_error;
    CHECK(validation::schema_ready(&schema_error));
    CHECK(schema_error.empty());
    CHECK(validation::schema_dir() == resources / "schema");
    const json report = ws.call(
        "doc.validate",
        json{{"docId", created["result"]["docId"]},
             {"text", test::read_text(test::fixtures_dir() / "books" / "modern-utf8.fb2")}});
    REQUIRE(report.contains("result"));
    CHECK(report["result"]["errorCount"] == 0);
    CHECK(ws.call("resources.genres")["result"]["entries"].size() == 192);
    const json dictionaries = ws.call("spell.dictionaries")["result"];
    REQUIRE(dictionaries.size() == 3);
    CHECK(dictionaries[1]["path"] == utf8(resources / "dictionaries" / "ru_RU.aff"));
    const json checked = ws.call("spell.check", json{{"words", {"превет", "привет", "мир", "teh"}},
                                                     {"langs", {"ru", "en"}}});
    CHECK(checked["result"]["misspelled"] == json::array({"превет", "teh"}));

    // The UI bundle is served from its folder, a file with a non-English name too.
    const std::string token = "?token=" + server->token();
    const test::HttpResponse page = test::http_get(server->port(), "/" + token);
    CHECK(page.status == 200);
    CHECK(page.body == "<!doctype html><title>Тест</title>");
    const test::HttpResponse note =
        test::http_get(server->port(), "/" + scripts::url_encode_segment("заметка 书.txt") + token);
    CHECK(note.status == 200);
    CHECK(note.body == "текст");
}

TEST_CASE("dirs unicode: error-log entries with Cyrillic and CJK paths are valid UTF-8 JSON lines",
          "[dirs][unicode][log]") {
    test::TempDir tmp{"mfbe-log-unicode"};
    const fs::path logs = tmp.path() / "logs";
    log::init(logs);
    REQUIRE(log::log_file_path() == logs / "mfbe-errors.log");
    // An entry with a path in its context, and one a store writes for an unreadable file.
    const fs::path folder = below(tmp.path(), "Тест 书");
    const fs::path book = below(folder, "книга 书.fb2");
    log::error("test", "test.unicodePath", "cannot open the book",
               log::extras({{"path", utf8(book)}, {"reason", "нет доступа"}}));
    test::write_text(folder / "recent.json", "{ not json");
    settings::RecentFiles recent(folder / "recent.json");
    recent.load();
    log::shutdown();

    std::istringstream lines(test::read_text(logs / "mfbe-errors.log"));
    std::vector<json> entries;
    for (std::string line; std::getline(lines, line);) {
        INFO(line);
        REQUIRE_NOTHROW(entries.push_back(json::parse(line)));  // invalid UTF-8 would throw
    }
    REQUIRE(entries.size() == 2);
    CHECK(entries[0]["context"]["path"] == utf8(book));
    CHECK(entries[0]["context"]["reason"] == "нет доступа");
    CHECK(platform::path_from_utf8(entries[0]["context"]["path"].get<std::string>()) == book);
    CHECK(entries[1]["code"] == "recent.unreadable");
    CHECK(entries[1]["context"]["path"] == utf8(folder / "recent.json"));
}
