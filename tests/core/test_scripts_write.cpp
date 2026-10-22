// Feature 005 (T024): scripts.write - the segment rule and the limits (invalidParams before
// anything is written), canonical containment, symlinked ancestors and targets (1002), the
// manifest validated first (1031, the id mismatch), 1202 for a bundled id, 1203 unless
// overwrite targets the same folder, all or nothing through the aside folder (old set gone,
// leftovers removed at the next rescan), the default group 90_assistant, the rescan and the
// notification.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/scripts.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

using namespace mfbe;
using Catch::Matchers::EndsWith;
using nlohmann::json;

namespace {

namespace fs = std::filesystem;

const char* const kManifest =
    R"json({"manifestVersion": 1, "id": "assistant/hello", "name": {"en": "Hello"}, "kind": "menu"})json";
const char* const kEntry = "export default async function run() { return 1; }\n";

json file(const std::string& path, const std::string& content) {
    return json{{"path", path}, {"content", content}};
}

json package(const std::string& manifest = kManifest, const std::string& entry = kEntry) {
    return json::array({file("script.json", manifest), file("index.js", entry)});
}

// Every file and folder below `root`, relative, with the file sizes: the state of the tree.
std::map<std::string, std::uintmax_t> tree_of(const fs::path& root) {
    std::map<std::string, std::uintmax_t> out;
    std::error_code ec;
    if (!fs::exists(root, ec)) {
        return out;
    }
    for (fs::recursive_directory_iterator it(root, ec), end; !ec && it != end; it.increment(ec)) {
        std::error_code file_ec;
        const bool regular = it->is_regular_file(file_ec);
        out[platform::utf8_from_path_generic(fs::relative(it->path(), root, file_ec))] =
            regular ? it->file_size(file_ec) : 0;
    }
    return out;
}

struct ServerFixture {
    test::TempDir data{"mfbe-scripts-write"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    // The bundled scripts are the repository's own (18/remove-spaces lives there).
    ServerFixture() {
        options.data_dir = data.path().string();
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    fs::path scripts_root() const { return data / "scripts"; }

    json write(json params) { return ws.call("scripts.write", std::move(params)); }

    // A refused call: the error, with the scripts tree unchanged and no aside folder left
    // (the data folder's log grows with every refusal, so the tree is the scripts root's).
    json refused(json params) {
        const auto before = tree_of(scripts_root());
        const json response = write(std::move(params));
        REQUIRE(response.contains("error"));
        CHECK(tree_of(scripts_root()) == before);
        CHECK(no_aside_folders());
        return response["error"];
    }

    json invalid_params(json params, const std::string& field) {
        const json error = refused(std::move(params));
        CHECK(error["code"] == -32602);
        CHECK(error["data"]["field"] == field);
        return error;
    }

    bool no_aside_folders() const {
        std::error_code ec;
        for (fs::directory_iterator it(data.path(), ec), end; !ec && it != end; it.increment(ec)) {
            if (platform::utf8_from_path(it->path().filename()).rfind(".scripts-write-", 0) == 0) {
                return false;
            }
        }
        return true;
    }
};

}  // namespace

TEST_CASE("scripts.write: the segment rule - every refusal, as a unit and over the wire",
          "[scripts][write]") {
    // The rule itself.
    for (const char* bad :
         {"",        ".",    "..",      "a/b",     "a\\b", "a\tb", "a\x01",     "a\x7f", "a:b",
          "a*b",     "a?b",  "a\"b",    "a<b",     "a>b",  "a|b",  "CON",       "con",   "Con.js",
          "nul.txt", "COM1", "com9.js", "LPT9.js", "PRN",  "AUX",  "aux.tar.gz"}) {
        INFO("segment " << bad);
        CHECK_FALSE(scripts::is_valid_path_segment(bad));
    }
    CHECK_FALSE(scripts::is_valid_path_segment(std::string(256, 'a')));
    CHECK(scripts::is_valid_path_segment(std::string(255, 'a')));
    for (const char* good : {"a", "index.js", "COM10", "LPT0", "CONSOLE", "con-x", "90_assistant",
                             "Мой скрипт", "a b", "a.b.c", ".hidden", "..."}) {
        INFO("segment " << good);
        CHECK(scripts::is_valid_path_segment(good));
    }
    for (const char* bad : {"", "/index.js", "\\index.js", "lib//x.js", "./x.js", "../x.js",
                            "lib/../x.js", "lib/", "C:/x.js", "lib/CON/x.js", "a\\b/c.js"}) {
        INFO("path " << bad);
        CHECK_FALSE(scripts::is_valid_package_path(bad));
    }
    for (const char* good : {"index.js", "lib/util.js", "a/b/c/d.txt", "script.json"}) {
        INFO("path " << good);
        CHECK(scripts::is_valid_package_path(good));
    }
    CHECK(scripts::default_folder_of_id("assistant/my-tool") == "my-tool");
    CHECK(scripts::default_folder_of_id("plain") == "plain");
    CHECK(scripts::default_folder_of_id("a/b:c*d") == "b_c_d");
    CHECK(scripts::default_folder_of_id("x/CON") == "CON");  // still refused by the rule

    // Over the wire: the field names the parameter, nothing is written.
    ServerFixture f;
    const json ok = package();
    for (const char* bad : {"..", "a/b", "a\\b", "a\x01", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b",
                            "a|b", "CON", "nul.txt", "COM1", "LPT9.js", ""}) {
        INFO("group " << bad);
        f.invalid_params(json{{"id", "assistant/hello"}, {"group", bad}, {"files", ok}}, "group");
        INFO("folder " << bad);
        f.invalid_params(json{{"id", "assistant/hello"}, {"folder", bad}, {"files", ok}}, "folder");
    }
    f.invalid_params(
        json{{"id", "assistant/hello"}, {"group", std::string(256, 'g')}, {"files", ok}}, "group");
    for (const char* bad : {"../x.js", "/x.js", "\\x.js", "lib/../x.js", "a\x01.js", "a:b.js",
                            "a*b.js", "a?b.js", "a\"b.js", "a<b.js", "a>b.js", "a|b.js", "CON",
                            "lib/nul.txt", "COM1", "LPT9.js", "", "./x.js", "x/"}) {
        INFO("path " << bad);
        f.invalid_params(json{{"id", "assistant/hello"},
                              {"files", json::array({file("script.json", kManifest),
                                                     file("index.js", kEntry), file(bad, "x")})}},
                         "files[2].path");
    }
    f.invalid_params(
        json{{"id", "assistant/hello"},
             {"files", json::array({file("script.json", kManifest), file("index.js", kEntry),
                                    file(std::string(256, 'p'), "x")})}},
        "files[2].path");
    // A path listed twice, a missing or non-string content, a NUL byte.
    f.invalid_params(
        json{{"id", "assistant/hello"},
             {"files", json::array({file("script.json", kManifest), file("index.js", kEntry),
                                    file("index.js", "again")})}},
        "files[2].path");
    f.invalid_params(
        json{{"id", "assistant/hello"},
             {"files", json::array({file("script.json", kManifest), json{{"path", "index.js"}}})}},
        "files[1].content");
    f.invalid_params(json{{"id", "assistant/hello"},
                          {"files", json::array({file("script.json", kManifest),
                                                 file("index.js", std::string("a\0b", 3))})}},
                     "files[1].content");
    // The id rule.
    for (const char* bad : {"", "/x", "x/", "a//b", "a/../b", "a\\b", "a\tb", " x"}) {
        INFO("id " << bad);
        f.invalid_params(json{{"id", bad}, {"files", ok}}, "id");
    }
    f.invalid_params(json{{"files", ok}}, "id");
    f.invalid_params(json{{"id", 5}, {"files", ok}}, "id");
    // 0 and 65 files, a 1 MiB + 1 file, 4 MiB + 1 in total.
    f.invalid_params(json{{"id", "assistant/hello"}, {"files", json::array()}}, "files");
    f.invalid_params(json{{"id", "assistant/hello"}}, "files");
    json many = package();
    for (int i = 0; i < 63; ++i) {
        many.push_back(file("lib/f" + std::to_string(i) + ".js", "x"));
    }
    REQUIRE(many.size() == 65);
    f.invalid_params(json{{"id", "assistant/hello"}, {"files", many}}, "files");
    json big = package();
    big.push_back(file("lib/big.js", std::string(1024 * 1024 + 1, 'b')));
    f.invalid_params(json{{"id", "assistant/hello"}, {"files", big}}, "files[2].content");
    json total = package();
    for (int i = 0; i < 4; ++i) {
        total.push_back(file("lib/m" + std::to_string(i) + ".js", std::string(1024 * 1024, 'm')));
    }
    f.invalid_params(json{{"id", "assistant/hello"}, {"files", total}}, "files");
    CHECK(f.no_aside_folders());
}

TEST_CASE(
    "scripts.write: canonical containment and symlinked ancestors or targets (1002, "
    "nothing written)",
    "[scripts][write]") {
    ServerFixture f;
    const json params{{"id", "assistant/hello"}, {"files", package()}};
    const fs::path group = f.scripts_root() / "90_assistant";
    test::TempDir elsewhere{"mfbe-scripts-elsewhere"};

    SECTION("a group folder that is a link outside the scripts folder leaves it: invalidParams") {
        fs::create_directories(f.scripts_root());
        fs::create_directory_symlink(elsewhere.path(), group);
        const json error = f.refused(params);
        CHECK(error["code"] == -32602);
        CHECK(error["data"]["field"] == "group");
        CHECK(tree_of(elsewhere.path()).empty());
    }
    SECTION("a group folder that is a link inside the scripts folder: 1002 symlink") {
        fs::create_directories(f.scripts_root() / "other");
        fs::create_directory_symlink(f.scripts_root() / "other", group);
        const json error = f.refused(params);
        CHECK(error["code"] == 1002);
        CHECK(error["data"]["reason"] == "symlink");
        CHECK(fs::path(error["data"]["path"].get<std::string>()).filename() == "90_assistant");
        CHECK(tree_of(f.scripts_root() / "other").empty());
    }
    SECTION("the target folder is a link: 1002 symlink") {
        fs::create_directories(group);
        fs::create_directories(f.scripts_root() / "real");
        fs::create_directory_symlink(f.scripts_root() / "real", group / "hello");
        const json error = f.refused(params);
        CHECK(error["code"] == 1002);
        CHECK(error["data"]["reason"] == "symlink");
        CHECK_THAT(error["data"]["path"].get<std::string>(), EndsWith("hello"));
    }
    SECTION("a link inside an existing target folder: 1002 symlink, even with overwrite") {
        fs::create_directories(group / "hello" / "lib");
        test::write_text(group / "hello" / "script.json", kManifest);
        test::write_text(group / "hello" / "index.js", kEntry);
        test::write_text(elsewhere.path() / "secret.js", "secret");
        fs::create_symlink(elsewhere.path() / "secret.js", group / "hello" / "lib" / "link.js");
        json overwrite = params;
        overwrite["overwrite"] = true;
        const json error = f.refused(overwrite);
        CHECK(error["code"] == 1002);
        CHECK(error["data"]["reason"] == "symlink");
        CHECK_THAT(error["data"]["path"].get<std::string>(), EndsWith("link.js"));
        CHECK(test::read_text(elsewhere.path() / "secret.js") == "secret");
    }
    CHECK(f.no_aside_folders());
}

TEST_CASE(
    "scripts.write: the manifest is validated first (1031, the id mismatch) and conflicts "
    "answer 1202 / 1203",
    "[scripts][write]") {
    ServerFixture f;
    const char* id = "assistant/hello";
    // No script.json, a manifest the loader refuses, an entry not among the files.
    json error = f.refused(json{{"id", id}, {"files", json::array({file("index.js", kEntry)})}});
    CHECK(error["code"] == 1031);
    CHECK(error["data"]["id"] == id);
    CHECK(error["data"]["errors"][0].get<std::string>().rfind("missingManifest", 0) == 0);
    error = f.refused(json{
        {"id", id},
        {"files",
         package(
             R"json({"manifestVersion": 2, "id": "assistant/hello", "name": {"en": "x"}})json")}});
    CHECK(error["code"] == 1031);
    CHECK(error["data"]["errors"][0].get<std::string>().rfind("manifestVersion", 0) == 0);
    error = f.refused(json{{"id", id}, {"files", package("{not json")}});
    CHECK(error["code"] == 1031);
    CHECK(error["data"]["errors"][0].get<std::string>().rfind("invalidJson", 0) == 0);
    error = f.refused(json{
        {"id", id},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/hello", "name": {"en": "x"}, "kind": "menu", "entry": "main.js"})json")}});
    CHECK(error["code"] == 1031);
    CHECK(error["data"]["errors"][0] ==
          "entryMissing: entry module \"main.js\" is not among the files");
    // The manifest's id must be present and equal to the call's.
    error = f.refused(
        json{{"id", id},
             {"files",
              package(R"json({"manifestVersion": 1, "name": {"en": "x"}, "kind": "menu"})json")}});
    CHECK(error["code"] == -32602);
    CHECK(error["data"]["field"] == "files.script.json.id");
    error = f.refused(json{
        {"id", id},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/other", "name": {"en": "x"}, "kind": "menu"})json")}});
    CHECK(error["code"] == -32602);
    CHECK(error["data"]["field"] == "files.script.json.id");
    // A bundled id is never modified: 1202.
    error = f.refused(json{
        {"id", "18/remove-spaces"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "18/remove-spaces", "name": {"en": "x"}, "kind": "menu"})json")}});
    CHECK(error["code"] == 1202);
    CHECK(error["message"] == "ai.scriptIdBundled");
    CHECK(error["data"] == json{{"id", "18/remove-spaces"}});
    CHECK_FALSE(fs::exists(f.scripts_root() / "18_editing"));

    // A first write succeeds; the same id again is 1203 naming the package folder.
    const json first = f.write(json{{"id", id}, {"files", package()}});
    REQUIRE(first.contains("result"));
    const std::string path = first["result"]["path"];
    CHECK(fs::path(path) == f.scripts_root() / "90_assistant" / "hello");
    error = f.refused(json{{"id", id}, {"files", package()}});
    CHECK(error["code"] == 1203);
    CHECK(error["message"] == "ai.scriptExists");
    CHECK(error["data"] == json{{"id", id}, {"path", path}});
    // Another folder for the same id stays 1203 with overwrite (a shadowed duplicate).
    error = f.refused(
        json{{"id", id}, {"folder", "hello-2"}, {"files", package()}, {"overwrite", true}});
    CHECK(error["code"] == 1203);
    CHECK(error["data"]["path"] == path);
    // A same-id package in the settings layer (another layer): 1203 with its folder.
    const fs::path custom = f.data / "custom-scripts";
    test::write_text(
        custom / "05_Mine" / "01_Bye" / "script.json",
        R"json({"manifestVersion": 1, "id": "assistant/bye", "name": {"en": "Bye"}, "kind": "menu"})json");
    test::write_text(custom / "05_Mine" / "01_Bye" / "index.js", kEntry);
    f.ws.call("settings.set", json{{"patch", {{"other", {{"scriptsFolder", custom.string()}}}}}});
    error = f.refused(json{
        {"id", "assistant/bye"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/bye", "name": {"en": "x"}, "kind": "menu"})json")},
        {"overwrite", true}});
    CHECK(error["code"] == 1203);
    CHECK(error["data"]["id"] == "assistant/bye");
    CHECK(fs::path(error["data"]["path"].get<std::string>()) == custom / "05_Mine" / "01_Bye");
    // An existing target folder that holds another package: 1203 with that id, overwrite or
    // not; one without a valid manifest: 1203 with the requested id, lifted by overwrite.
    error = f.refused(json{
        {"id", "assistant/third"},
        {"folder", "hello"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/third", "name": {"en": "x"}, "kind": "menu"})json")},
        {"overwrite", true}});
    CHECK(error["code"] == 1203);
    CHECK(error["data"] == json{{"id", id}, {"path", path}});
    test::write_text(f.scripts_root() / "90_assistant" / "stale" / "notes.txt", "stale");
    error = f.refused(json{
        {"id", "assistant/fresh"},
        {"folder", "stale"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/fresh", "name": {"en": "x"}, "kind": "menu"})json")}});
    CHECK(error["code"] == 1203);
    CHECK(error["data"]["id"] == "assistant/fresh");
    CHECK(fs::path(error["data"]["path"].get<std::string>()) ==
          f.scripts_root() / "90_assistant" / "stale");
    const json lifted = f.write(json{
        {"id", "assistant/fresh"},
        {"folder", "stale"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/fresh", "name": {"en": "x"}, "kind": "menu"})json")},
        {"overwrite", true}});
    REQUIRE(lifted.contains("result"));
    CHECK_FALSE(fs::exists(f.scripts_root() / "90_assistant" / "stale" / "notes.txt"));
    CHECK(fs::exists(f.scripts_root() / "90_assistant" / "stale" / "index.js"));
    CHECK(f.no_aside_folders());
}

TEST_CASE(
    "scripts.write: all or nothing through the aside folder, the default group, the rescan "
    "and the notification",
    "[scripts][write]") {
    ServerFixture f;
    const char* id = "assistant/hello";
    // A planted leftover of an interrupted write goes at the next rescan and is never a root.
    test::write_text(f.data / ".scripts-write-424242" / "new" / "script.json", kManifest);
    test::write_text(f.data / ".scripts-write-424242" / "new" / "index.js", kEntry);
    f.ws.call("scripts.reload");
    CHECK_FALSE(fs::exists(f.data / ".scripts-write-424242"));
    f.ws.wait_notification("resources.changed");

    // The default group and folder; the warnings are the loader's (a missing `kind`).
    const json written = f.write(json{
        {"id", id},
        {"files",
         json::array(
             {file(
                  "script.json",
                  R"json({"manifestVersion": 1, "id": "assistant/hello", "name": {"en": "Hello"}, "icon": "icon.png"})json"),
              file("index.js", kEntry), file("lib/util.js", "export const x = 1;\n"),
              file("stale.txt", "to be replaced")})}});
    REQUIRE(written.contains("result"));
    const json& result = written["result"];
    CHECK(result["id"] == id);
    CHECK(result["reloaded"] == true);
    const fs::path target = f.scripts_root() / "90_assistant" / "hello";
    CHECK(fs::path(result["path"].get<std::string>()) == target);
    REQUIRE(result["warnings"].is_array());
    bool kind_warning = false;
    bool icon_warning = false;
    for (const json& w : result["warnings"]) {
        kind_warning = kind_warning || w.get<std::string>().rfind("kind:", 0) == 0;
        icon_warning = icon_warning || w.get<std::string>().rfind("iconMissing:", 0) == 0;
    }
    CHECK(kind_warning);
    CHECK(icon_warning);
    CHECK(test::read_text(target / "index.js") == kEntry);
    CHECK(test::read_text(target / "lib" / "util.js") == "export const x = 1;\n");
    CHECK(test::read_text(target / "stale.txt") == "to be replaced");
    CHECK(f.no_aside_folders());
    // The notification and the catalogue: the script under the user layer's rights.
    const auto changed = f.ws.wait_notification("resources.changed");
    REQUIRE(changed.has_value());
    CHECK((*changed)["params"]["what"] == "scripts");
    const json list = f.ws.call("scripts.list")["result"];
    bool found = false;
    for (const json& group : list["groups"]) {
        for (const json& script : group["scripts"]) {
            if (script["id"] == id) {
                found = true;
                CHECK(script["source"] == "user");
                CHECK(script["group"] == "90_assistant");
                CHECK(script["kind"] == "menu");
                CHECK(script["entryUrl"] == "/scripts/assistant%2Fhello/index.js");
                CHECK(group["names"]["en"] == "assistant");
                CHECK(group["order"] == 90);
                CHECK(fs::path(script["dir"].get<std::string>()) == target);
            }
        }
    }
    CHECK(found);
    const json source = f.ws.call("scripts.source", json{{"id", id}});
    REQUIRE(source.contains("result"));
    CHECK(source["result"]["files"] ==
          json::array({"index.js", "lib/util.js", "script.json", "stale.txt"}));

    // Overwrite replaces the whole set: the stale file is gone, the new content in place.
    const json replaced = f.write(json{
        {"id", id},
        {"files",
         json::array({file("script.json", kManifest),
                      file("index.js", "export default async function run() { return 2; }\n")})},
        {"overwrite", true}});
    REQUIRE(replaced.contains("result"));
    CHECK(replaced["result"]["warnings"] == json::array());
    CHECK(
        tree_of(target) ==
        std::map<std::string, std::uintmax_t>{
            {"index.js", std::string("export default async function run() { return 2; }\n").size()},
            {"script.json", std::string(kManifest).size()}});
    CHECK(f.no_aside_folders());
    CHECK(f.ws.call("scripts.source", json{{"id", id}})["result"]["files"] ==
          json::array({"index.js", "script.json"}));
    // Content is written byte for byte: no BOM, line endings as given.
    const json crlf =
        f.write(json{{"id", id},
                     {"files", json::array({file("script.json", kManifest),
                                            file("index.js", "\xEF\xBB\xBFline\r\nnext\n")})},
                     {"overwrite", true}});
    REQUIRE(crlf.contains("result"));
    CHECK(test::read_text(target / "index.js") == "\xEF\xBB\xBFline\r\nnext\n");
    // Another user group and the tree group (default kind tree).
    const json grouped = f.write(json{
        {"id", "mine/tool"},
        {"group", "50_mine"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "mine/tool", "name": {"en": "Tool"}, "kind": "menu"})json")}});
    REQUIRE(grouped.contains("result"));
    CHECK(fs::path(grouped["result"]["path"].get<std::string>()) ==
          f.scripts_root() / "50_mine" / "tool");
    const json tree = f.write(json{
        {"id", "assistant/tree-tool"},
        {"group", "tree"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/tree-tool", "name": {"en": "Tree"}})json")}});
    REQUIRE(tree.contains("result"));
    std::string tree_kind;
    const json listed = f.ws.call("scripts.list")["result"];
    for (const json& group : listed["groups"]) {
        for (const json& script : group["scripts"]) {
            if (script["id"] == "assistant/tree-tool") {
                tree_kind = script["kind"];
            }
        }
    }
    CHECK(tree_kind == "tree");
    // The custom scripts folder of the settings is never the target.
    const fs::path custom = f.data / "custom-scripts";
    fs::create_directories(custom);
    f.ws.call("settings.set", json{{"patch", {{"other", {{"scriptsFolder", custom.string()}}}}}});
    const json still_user = f.write(json{
        {"id", "assistant/second"},
        {"files",
         package(
             R"json({"manifestVersion": 1, "id": "assistant/second", "name": {"en": "Second"}, "kind": "menu"})json")}});
    REQUIRE(still_user.contains("result"));
    CHECK(fs::path(still_user["result"]["path"].get<std::string>()) ==
          f.scripts_root() / "90_assistant" / "second");
    CHECK(tree_of(custom).empty());
    CHECK(f.no_aside_folders());
}
