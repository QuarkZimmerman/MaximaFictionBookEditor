// Feature 002, research R1: the RPC entry points take and return file and folder names with
// Cyrillic and CJK letters exactly - UTF-8 on the wire, the same files on disk. On the Windows
// CI job the test executable runs with the legacy code page, where a conversion of these names
// through std::filesystem::path(std::string) or path::string() would miss the files.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/dialog_provider.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <string>
#include <thread>
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

// A core server whose data folder and working folder have non-English names.
struct UnicodeServer {
    test::TempDir tmp{"mfbe-unicode"};
    fs::path base = below(tmp.path(), "Тест 书");
    fs::path data = below(base, "данные");
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    UnicodeServer() {
        fs::create_directories(base);
        CoreServerOptions options;
        options.data_dir = utf8(data);
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    json result(const std::string& method, const json& params = json::object()) {
        const json response = ws.call(method, params);
        INFO(method << " -> " << response.dump());
        REQUIRE(response.contains("result"));
        return response["result"];
    }

    // Copies a fixture book to `name` (UTF-8) in the working folder.
    fs::path book(const std::string& name) {
        const fs::path target = below(base, name);
        fs::copy_file(test::fixtures_dir() / "books" / "modern-utf8.fb2", target);
        return target;
    }
};

}  // namespace

TEST_CASE(
    "unicode paths: doc.open, doc.save, doc.openSource, recent files and doc.watch keep "
    "non-English names",
    "[unicode][server][doc]") {
    UnicodeServer f;
    const fs::path original = f.book("книга 书.fb2");
    const json opened = f.result("doc.open", json{{"path", utf8(original)}});
    CHECK(opened["document"]["path"] == utf8(original));
    CHECK(opened["document"]["fileKind"] == "fb2");
    const std::string doc_id = opened["document"]["docId"];

    // Saved under a new name in a new folder, then opened from there.
    const fs::path folder = below(f.base, "Копии 书");
    fs::create_directories(folder);
    const fs::path copy = below(folder, "копия книги.fb2");
    const json saved =
        f.result("doc.save", json{{"docId", doc_id}, {"path", utf8(copy)}, {"force", true}});
    CHECK(saved["path"] == utf8(copy));
    REQUIRE(fs::is_regular_file(copy));
    CHECK(test::read_text(copy).find("<FictionBook") != std::string::npos);
    const json reopened = f.result("doc.open", json{{"path", utf8(copy)}});
    CHECK(reopened["document"]["path"] == utf8(copy));
    const json& title = opened["document"]["description"]["titleInfo"]["bookTitle"];
    CHECK_FALSE(title.get<std::string>().empty());
    CHECK(reopened["document"]["description"]["titleInfo"]["bookTitle"] == title);
    const json source = f.result("doc.openSource", json{{"path", utf8(copy)}});
    CHECK(source["text"].get<std::string>().find("<FictionBook") != std::string::npos);

    // Recent files: newest first, the exact names, present on disk, kept in recent.json.
    const json recent = f.result("doc.recent");
    REQUIRE(recent.size() == 2);
    CHECK(recent[0]["path"] == utf8(copy));
    CHECK(recent[0]["exists"] == true);
    CHECK(recent[1]["path"] == utf8(original));
    CHECK(recent[1]["exists"] == true);
    const json stored = json::parse(test::read_text(f.data / "recent.json"));
    CHECK(stored["items"][0]["path"] == utf8(copy));
    CHECK(stored["items"][1]["path"] == utf8(original));

    // A change by another program is reported with the exact name.
    const std::string watched_id = reopened["document"]["docId"];
    CHECK(f.result("doc.watch", json{{"docId", watched_id}, {"enabled", true}}) == json::object());
    std::this_thread::sleep_for(std::chrono::milliseconds(1100));  // distinct mtime second
    {
        std::ofstream out(copy, std::ios::binary | std::ios::app);
        out << "\n<!-- touched by another application -->\n";
    }
    const auto changed = f.ws.wait_notification("doc.changedOnDisk", 6000);
    REQUIRE(changed);
    CHECK((*changed)["params"]["docId"] == watched_id);
    CHECK((*changed)["params"]["path"] == utf8(copy));

    // A missing file is reported with its exact name.
    const fs::path missing = below(f.base, "нет такой книги.fb2");
    const json failed = f.ws.call("doc.open", json{{"path", utf8(missing)}});
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1002);
    CHECK(failed["error"]["data"]["path"] == utf8(missing));
}

TEST_CASE(
    "unicode paths: binary.add, binary.export and the clipboard hook with non-English "
    "file names",
    "[unicode][server][binary]") {
    UnicodeServer f;
    const json opened = f.result("doc.open", json{{"path", utf8(f.book("книга.fb2"))}});
    const std::string doc_id = opened["document"]["docId"];
    const fs::path image = below(f.base, "картинка_书.png");
    fs::copy_file(test::fixtures_dir() / "images" / "tiny.png", image);

    // The id is the file name; the export lands at the exact name with the same bytes.
    const json added = f.result("binary.add", json{{"docId", doc_id}, {"path", utf8(image)}});
    CHECK(added["id"] == "картинка_书.png");
    CHECK(added["contentType"] == "image/png");
    const fs::path exported = below(below(f.base, "Экспорт 书"), "экспорт.png");
    fs::create_directories(exported.parent_path());
    CHECK(f.result("binary.export",
                   json{{"docId", doc_id}, {"id", "картинка_书.png"}, {"path", utf8(exported)}}) ==
          json::object());
    REQUIRE(fs::is_regular_file(exported));
    CHECK(test::read_text(exported) == test::read_text(image));
    const fs::path nowhere = below(below(f.base, "нет такой папки"), "экспорт.png");
    const json no_folder =
        f.ws.call("binary.export",
                  json{{"docId", doc_id}, {"id", "картинка_书.png"}, {"path", utf8(nowhere)}});
    REQUIRE(no_folder.contains("error"));
    CHECK(no_folder["error"]["data"]["path"] == utf8(nowhere));

    // The test clipboard reads the image from a file with a non-English name.
    CHECK(f.result("test.enqueueClipboardImage", json{{"path", utf8(image)}})["queued"] == 1);
    const json pasted = f.result("binary.addFromClipboard", json{{"docId", doc_id}});
    CHECK_FALSE(pasted["id"].get<std::string>().empty());
}

TEST_CASE(
    "unicode paths: genre, script and dictionary folders with non-English names take "
    "effect",
    "[unicode][server][settings]") {
    UnicodeServer f;

    // other.genresFolder: its files join the catalogue; the folder opens as given.
    const fs::path genres = below(f.base, "Жанры 书");
    test::write_text(genres / "extra.genres.tsv", "extra_one\tsf\tExtra\tЭкстра\n");
    f.result("settings.set", json{{"patch", {{"other", {{"genresFolder", utf8(genres)}}}}}});
    const json catalog = f.result("resources.genres");
    bool found = false;
    for (const json& entry : catalog["entries"]) {
        if (entry["code"] == "extra_one") {
            found = true;
            CHECK(entry["file"] == utf8(genres / "extra.genres.tsv"));
        }
    }
    CHECK(found);
    const json layers = f.result("resources.layers");
    CHECK(layers[0]["layer"] == "settings");
    CHECK(layers[0]["path"] == utf8(genres));
    CHECK(layers[0]["exists"] == true);

    // other.scriptsFolder: a package with non-English folder names is listed and served.
    const fs::path scripts = below(f.base, "Скрипты 书");
    const fs::path package = below(below(scripts, "01_Группа"), "01_Скрипт");
    test::write_text(package / "script.json",
                     R"({"manifestVersion": 1, "name": {"en": "Unicode", "ru": "Юникод"},)"
                     R"( "kind": "menu"})");
    test::write_text(package / "index.js", "// Юникод\n");
    f.result("settings.set", json{{"patch", {{"other", {{"scriptsFolder", utf8(scripts)}}}}}});
    const json list = f.result("scripts.list");
    CHECK(list["folders"]["custom"] == utf8(scripts));
    json script;
    for (const json& group : list["groups"]) {
        for (const json& s : group["scripts"]) {
            if (s["id"] == "01_Группа/01_Скрипт") {
                script = s;
            }
        }
    }
    REQUIRE(script.is_object());
    CHECK(script["dir"] == utf8(package));
    CHECK(script["folder"] == "01_Скрипт");
    const test::HttpResponse entry = test::http_get(
        f.server->port(), script["entryUrl"].get<std::string>() + "?token=" + f.server->token());
    CHECK(entry.status == 200);
    CHECK(entry.body == "// Юникод\n");

    // view.customDictionaryPath: added words land in the named file.
    const fs::path custom = below(below(f.base, "Словари 书"), "мой словарь.dic");
    f.result("settings.set", json{{"patch", {{"view", {{"customDictionaryPath", utf8(custom)}}}}}});
    CHECK(f.result("spell.addWord", json{{"word", "Тестослово"}})["added"] == true);
    REQUIRE(fs::is_regular_file(custom));
    CHECK(test::read_text(custom).find("Тестослово") != std::string::npos);
    CHECK(f.result("spell.customDictionaryPath")["path"] == utf8(custom));
    const fs::path other = below(f.base, "другой 书.dic");
    CHECK(f.result("spell.customDictionaryPath", json{{"path", utf8(other)}})["path"] ==
          utf8(other));
    CHECK(f.result("settings.get")["view"]["customDictionaryPath"] == utf8(other));

    // A dictionary pair in the data folder is opened by Hunspell.
    test::write_text(f.data / "dictionaries" / "uk_UA.aff", "SET UTF-8\n");
    test::write_text(f.data / "dictionaries" / "uk_UA.dic", "2\nслово\nмова\n");
    const json dictionaries = f.result("spell.dictionaries");
    REQUIRE(dictionaries.size() == 3);
    CHECK(dictionaries[2]["path"] == utf8(f.data / "dictionaries" / "uk_UA.aff"));
    CHECK(f.result("spell.check", json{{"words", {"слово", "слва"}},
                                       {"langs", {"uk"}}})["misspelled"] == json::array({"слва"}));
}

TEST_CASE("unicode paths: folder openers and the corpus sample take non-English folders exactly",
          "[unicode][server]") {
    UnicodeServer f;
    auto dialogs = std::make_shared<QueuedDialogProvider>();
    f.server->set_dialog_provider(dialogs);
    const fs::path folder = below(f.base, "Папка 书");
    fs::create_directories(folder);
    CHECK(f.result("app.openFolder", json{{"path", utf8(folder)}}) == json::object());
    const fs::path missing = below(f.base, "нет такой папки");
    const json failed = f.ws.call("app.openFolder", json{{"path", utf8(missing)}});
    REQUIRE(failed.contains("error"));
    CHECK(failed["error"]["code"] == 1002);
    CHECK(failed["error"]["data"]["path"] == utf8(missing));
    CHECK(f.result("app.openLogFolder") == json::object());
    CHECK(f.result("resources.openGenresFolder")["path"] == utf8(f.data / "genres"));
    CHECK(dialogs->opened_paths() ==
          std::vector<std::string>{utf8(folder), utf8(f.data / "logs"), utf8(f.data / "genres")});

    // <root>/<range>/<sub>/<id>/<book> with non-English names.
    const fs::path corpus = below(f.base, "Корпус 书");
    const fs::path book =
        below(below(below(below(corpus, "00000001-00000100"), "а"), "книга1"), "книга 书.fb2");
    test::write_text(book, "<FictionBook/>");
    const json sample =
        f.result("test.corpusSample", json{{"count", 1}, {"seed", 1}, {"root", utf8(corpus)}});
    CHECK(sample["scanned"] == 1);
    CHECK(sample["paths"] == json::array({utf8(book)}));
}

#if defined(__linux__)
namespace {

// Sets an environment variable for the lifetime of the object, then restores the old value.
class ScopedEnv {
public:
    ScopedEnv(const char* name, const std::string& value) : name_(name) {
        if (const char* old = std::getenv(name)) {
            old_ = old;
        }
        ::setenv(name, value.c_str(), 1);
    }
    ~ScopedEnv() {
        if (old_) {
            ::setenv(name_, old_->c_str(), 1);
        } else {
            ::unsetenv(name_);
        }
    }
    ScopedEnv(const ScopedEnv&) = delete;
    ScopedEnv& operator=(const ScopedEnv&) = delete;

private:
    const char* name_;
    std::optional<std::string> old_;
};

}  // namespace

TEST_CASE(
    "unicode paths: with no folder kept, Open and Save As open in the user's documents folder",
    "[unicode][server][dialogs]") {
    test::TempDir xdg{"mfbe-xdg"};
    const fs::path documents = below(xdg.path(), "Документы 书");
    fs::create_directories(documents);
    test::write_text(xdg.path() / "user-dirs.dirs",
                     "XDG_DOCUMENTS_DIR=\"" + utf8(documents) + "\"\n");
    const ScopedEnv config_home("XDG_CONFIG_HOME", utf8(xdg.path()));
    REQUIRE(platform::documents_dir() == documents);

    UnicodeServer f;
    const json documents_types =
        json::array({{{"name", "FictionBook files (*.fb2)"}, {"extensions", {"fb2"}}},
                     {{"name", "All files (*.*)"}, {"extensions", {"*"}}}});
    f.result("test.enqueueDialog",
             json{{"method", "dialog.openFile"}, {"result", {{"paths", json::array()}}}});
    f.result("dialog.openFile", json{{"title", "Open"}, {"filters", documents_types}});
    f.result("test.enqueueDialog", json{{"method", "dialog.saveFile"}, {"result", json::object()}});
    f.result("dialog.saveFile", json{{"title", "Save As"}, {"filters", documents_types}});
    f.result("test.enqueueDialog",
             json{{"method", "dialog.openFile"}, {"result", {{"paths", json::array()}}}});
    f.result("dialog.openFile",
             json{{"title", "Image"},
                  {"filters", json::array({{{"name", "PNG (*.png)"}, {"extensions", {"png"}}}})}});

    const json requests = f.result("test.dialogRequests");
    REQUIRE(requests.size() == 3);
    CHECK(requests[0]["folder"] == utf8(documents));
    CHECK(requests[1]["folder"] == utf8(documents));
    CHECK_FALSE(requests[2].contains("folder"));  // other dialogs: the platform's own choice
}
#endif  // __linux__

TEST_CASE(
    "unicode paths: Open and Save As share the folder last used on Linux and macOS; every "
    "dialog that names no folder opens there",
    "[unicode][server][dialogs]") {
    UnicodeServer f;
    const fs::path books = below(f.base, "Книги 书");
    fs::create_directories(books);
    const json documents =
        json::array({{{"name", "FictionBook files (*.fb2)"}, {"extensions", {"fb2"}}},
                     {{"name", "FictionBook descriptors (*.fbd)"}, {"extensions", {"fbd"}}},
                     {{"name", "All files (*.*)"}, {"extensions", {"*"}}}});
    const json images = json::array({{{"name", "Supported images (*.jpg;*.jpeg;*.png)"},
                                      {"extensions", {"jpg", "jpeg", "png"}}}});
    auto answer = [&](const char* method, const json& result) {
        f.result("test.enqueueDialog", json{{"method", method}, {"result", result}});
    };

    answer("dialog.openFile", json{{"paths", {utf8(below(books, "книга.fb2"))}}});
    f.result("dialog.openFile", json{{"title", "Open"}, {"filters", documents}});
    // An image chosen elsewhere does not move the remembered folder.
    answer("dialog.openFile", json{{"paths", {utf8(below(f.base, "картинка.png"))}}});
    f.result("dialog.openFile", json{{"title", "Image"}, {"filters", images}});
    answer("dialog.openFile", json{{"paths", json::array()}});
    f.result("dialog.openFile", json{{"title", "Open"}, {"filters", documents}});
    answer("dialog.saveFile", json::object());  // Save As of a document never saved
    f.result("dialog.saveFile", json{{"title", "Save As"}, {"filters", documents}});
    answer("dialog.saveFile", json::object());  // Save image as: a name without a folder
    f.result("dialog.saveFile", json{{"title", "Save image"}, {"defaultPath", "обложка.jpg"}});
    // Save As of a saved document: its own folder; the chosen file's folder is remembered.
    const fs::path elsewhere = below(f.base, "Другая папка");
    answer("dialog.saveFile", json{{"path", utf8(below(elsewhere, "копия.fb2"))}});
    f.result("dialog.saveFile", json{{"title", "Save As"},
                                     {"filters", documents},
                                     {"defaultPath", utf8(below(books, "книга.fb2"))}});
    answer("dialog.openFile", json{{"paths", json::array()}});
    f.result("dialog.openFile", json{{"title", "Open"}, {"filters", documents}});

    const json requests = f.result("test.dialogRequests");
    REQUIRE(requests.size() == 7);
    const json session = f.result("settings.get")["session"];
#if defined(_WIN32)
    // Windows keeps the folder in the dialogs themselves (the shell's client GUID).
    for (const json& request : requests) {
        CHECK_FALSE(request.contains("folder"));
    }
    CHECK(session["lastFileDialogFolder"] == "");
#else
    // Nothing kept yet: Open opens in the user's documents folder, when there is one.
    const fs::path user_documents = platform::documents_dir();
    std::error_code ec;
    const std::string start =
        !user_documents.empty() && fs::is_directory(user_documents, ec) ? utf8(user_documents) : "";
    CHECK(requests[0].value("folder", "") == start);
    CHECK(requests[1]["folder"] == utf8(books));
    CHECK(requests[2]["folder"] == utf8(books));
    CHECK(requests[3]["folder"] == utf8(books));
    CHECK(requests[4]["folder"] == utf8(books));
    CHECK_FALSE(requests[5].contains("folder"));  // the document's own folder
    CHECK(requests[5]["defaultPath"] == utf8(below(books, "книга.fb2")));
    CHECK(session["lastFileDialogFolder"] == utf8(elsewhere));
    // The kept folder no longer exists (it was never created): not offered.
    CHECK(requests[6].value("folder", "") == start);
    const json stored = json::parse(test::read_text(f.data / "settings.json"));
    CHECK(stored["session"]["lastFileDialogFolder"] == utf8(elsewhere));
#endif

    // A proposed file names its own folder: no other folder is added.
    const fs::path dictionary = below(below(f.base, "Словари"), "мой.dic");
    answer("dialog.openFile", json{{"paths", json::array()}});
    f.result("dialog.openFile",
             json{{"title", "Dictionary"},
                  {"filters",
                   json::array({{{"name", "Dictionaries (*.dic)"}, {"extensions", {"dic"}}}})},
                  {"defaultPath", utf8(dictionary)}});
    const json proposed = f.result("test.dialogRequests").back();
    CHECK(proposed["defaultPath"] == utf8(dictionary));
    CHECK_FALSE(proposed.contains("folder"));
}
