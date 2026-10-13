// T101: script package discovery - manifest validation, group folders and ordering, layer
// precedence/additivity, invalid packages reported but not fatal, the scripts.* RPCs, the
// Last-script memory and the /scripts/{scriptId}/{file} endpoint (path traversal rejected).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/scripts.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <set>

using namespace mfbe;
using nlohmann::json;

namespace {

std::filesystem::path fixtures() {
    return std::filesystem::path(MFBE_TEST_FIXTURES_DIR).parent_path() / "scripts" / "fixtures";
}

resources::Roots roots_with_bundled(const test::TempDir& tmp,
                                    const std::filesystem::path& bundled) {
    resources::Roots roots;
    roots.user_data = tmp / "data";
    roots.bundled_resources = tmp / "resources";
    roots.bundled_scripts = bundled;
    return roots;
}

void copy_tree(const std::filesystem::path& from, const std::filesystem::path& to) {
    std::filesystem::create_directories(to);
    std::filesystem::copy(from, to,
                          std::filesystem::copy_options::recursive |
                              std::filesystem::copy_options::overwrite_existing);
}

std::vector<std::string> ids_of(const scripts::Catalog& catalog) {
    std::vector<std::string> ids;
    for (const scripts::Group& g : catalog.groups()) {
        for (const scripts::ScriptPackage& p : g.scripts) {
            ids.push_back(p.id);
        }
    }
    return ids;
}

std::set<std::string> issue_reasons(const scripts::Catalog& catalog) {
    std::set<std::string> reasons;
    for (const scripts::Issue& i : catalog.issues()) {
        reasons.insert(i.reason);
    }
    return reasons;
}

}  // namespace

TEST_CASE("scripts: manifest validation per script-manifest.md section 2", "[scripts]") {
    const json full = json::parse(R"json({
        "manifestVersion": 1, "id": "fbe.case.upper",
        "name": {"en": "To upper case", "ru": "К верхнему регистру"},
        "description": {"en": "d"}, "kind": "menu", "entry": "index.js", "icon": "icon.png",
        "defaultHotkey": "Ctrl+Alt+U", "needsSelection": true,
        "undoLabel": {"en": "Upper case"},
        "legacy": {"source": "01_Регистр/01_Верхний регистр.js", "fbeVersion": "2.7"}})json");
    auto parsed = scripts::parse_manifest(full, "x/y", "menu");
    REQUIRE(parsed.manifest.has_value());
    CHECK(parsed.errors.empty());
    CHECK(parsed.warnings.empty());
    CHECK(parsed.manifest->id == "fbe.case.upper");
    CHECK(parsed.manifest->name.at("ru") == "К верхнему регистру");
    CHECK(parsed.manifest->kind == "menu");
    CHECK(parsed.manifest->entry == "index.js");
    CHECK(parsed.manifest->icon == "icon.png");
    CHECK(parsed.manifest->defaultHotkey == "Ctrl+Alt+U");
    CHECK(parsed.manifest->needsSelection);
    CHECK(parsed.manifest->undoLabel.at("en") == "Upper case");
    REQUIRE(parsed.manifest->legacy.has_value());
    CHECK(parsed.manifest->legacy->source == "01_Регистр/01_Верхний регистр.js");
    CHECK(parsed.manifest->legacy->fbeVersion == "2.7");

    // Defaults: id from the folders, entry index.js, kind by folder (warning), no icon.
    auto minimal = scripts::parse_manifest(json{{"manifestVersion", 1}, {"name", {{"en", "N"}}}},
                                           "01_Group/02_Script", "tree");
    REQUIRE(minimal.manifest.has_value());
    CHECK(minimal.manifest->id == "01_Group/02_Script");
    CHECK(minimal.manifest->kind == "tree");
    CHECK(minimal.manifest->entry == "index.js");
    CHECK(minimal.manifest->icon.empty());
    CHECK_FALSE(minimal.manifest->needsSelection);
    REQUIRE(minimal.warnings.size() == 1);
    CHECK(minimal.warnings[0].rfind("kind:", 0) == 0);

    // A plain string name is accepted as the English name.
    auto plain = scripts::parse_manifest(
        json{{"manifestVersion", 1}, {"name", "Plain"}, {"kind", "menu"}}, "a", "menu");
    REQUIRE(plain.manifest.has_value());
    CHECK(plain.manifest->name.at("en") == "Plain");

    // Errors: version, missing/non-English name, bad kind, unsafe entry, bad id.
    auto bad_version = scripts::parse_manifest(
        json{{"manifestVersion", 2}, {"name", {{"en", "N"}}}, {"kind", "menu"}}, "a", "menu");
    CHECK_FALSE(bad_version.manifest.has_value());
    CHECK(bad_version.errors[0].rfind("manifestVersion:", 0) == 0);
    auto no_version =
        scripts::parse_manifest(json{{"name", {{"en", "N"}}}, {"kind", "menu"}}, "a", "menu");
    CHECK_FALSE(no_version.manifest.has_value());
    auto no_name =
        scripts::parse_manifest(json{{"manifestVersion", 1}, {"kind", "menu"}}, "a", "menu");
    CHECK_FALSE(no_name.manifest.has_value());
    CHECK(no_name.errors[0].rfind("name:", 0) == 0);
    auto ru_only = scripts::parse_manifest(
        json{{"manifestVersion", 1}, {"name", {{"ru", "Имя"}}}, {"kind", "menu"}}, "a", "menu");
    CHECK_FALSE(ru_only.manifest.has_value());
    auto bad_kind = scripts::parse_manifest(
        json{{"manifestVersion", 1}, {"name", {{"en", "N"}}}, {"kind", "popup"}}, "a", "menu");
    CHECK_FALSE(bad_kind.manifest.has_value());
    CHECK(bad_kind.errors[0].rfind("kind:", 0) == 0);
    for (const char* entry : {"../x.js", "/etc/passwd", "lib/../../x.js", "C:/x.js", "a\\b.js"}) {
        auto bad_entry = scripts::parse_manifest(json{{"manifestVersion", 1},
                                                      {"name", {{"en", "N"}}},
                                                      {"kind", "menu"},
                                                      {"entry", entry}},
                                                 "a", "menu");
        INFO(entry);
        CHECK_FALSE(bad_entry.manifest.has_value());
    }
    auto sub_entry = scripts::parse_manifest(json{{"manifestVersion", 1},
                                                  {"name", {{"en", "N"}}},
                                                  {"kind", "menu"},
                                                  {"entry", "src/main.js"}},
                                             "a", "menu");
    REQUIRE(sub_entry.manifest.has_value());
    CHECK(sub_entry.manifest->entry == "src/main.js");
    for (const char* id : {"", "/abs", "a//b", "a/../b", "tail/", "with\\slash", " space"}) {
        auto bad_id = scripts::parse_manifest(
            json{{"manifestVersion", 1}, {"name", {{"en", "N"}}}, {"kind", "menu"}, {"id", id}},
            "a", "menu");
        INFO(id);
        CHECK_FALSE(bad_id.manifest.has_value());
    }

    // Warnings keep the package: bad hotkey, bad icon type, non-boolean needsSelection,
    // malformed legacy.
    auto warned = scripts::parse_manifest(json{{"manifestVersion", 1},
                                               {"name", {{"en", "N"}}},
                                               {"kind", "menu"},
                                               {"defaultHotkey", "Ctrl+Alt+Nope"},
                                               {"icon", "icon.bmp"},
                                               {"needsSelection", "yes"},
                                               {"legacy", "01_x.js"}},
                                          "a", "menu");
    REQUIRE(warned.manifest.has_value());
    CHECK(warned.manifest->defaultHotkey.empty());
    CHECK(warned.manifest->icon.empty());
    CHECK_FALSE(warned.manifest->needsSelection);
    CHECK_FALSE(warned.manifest->legacy.has_value());
    CHECK(warned.warnings.size() == 4);

    // Text entry point: BOM tolerated, broken JSON reported as invalidJson.
    auto bom = scripts::parse_manifest_text(
        "\xEF\xBB\xBF{\"manifestVersion\":1,\"name\":{\"en\":\"N\"},\"kind\":\"menu\"}", "a",
        "menu");
    CHECK(bom.manifest.has_value());
    auto broken = scripts::parse_manifest_text("{\"manifestVersion\": 1,", "a", "menu");
    CHECK_FALSE(broken.manifest.has_value());
    CHECK(broken.errors[0].rfind("invalidJson:", 0) == 0);
}

TEST_CASE("scripts: hotkey chord grammar, ids, order prefixes and URLs", "[scripts]") {
    for (const char* ok : {"Ctrl+Alt+U", "Mod+Shift+F5", "F12", "Alt+Shift+;", "Ctrl++",
                           "Meta+Enter", "Unicode:00A0", "Ctrl+Alt+Я", "ctrl+b", "PageDown"}) {
        INFO(ok);
        CHECK(scripts::is_valid_hotkey_chord(ok));
    }
    for (const char* bad : {"", "Ctrl+", "Ctrl+Ctrl+A", "Foo+A", "Ctrl+F13", "Ctrl+Nope",
                            "Ctrl+Unicode:ZZ", "Alt+Alt"}) {
        INFO(bad);
        CHECK_FALSE(scripts::is_valid_hotkey_chord(bad));
    }
    CHECK(scripts::is_valid_script_id("fbe.case.upper"));
    CHECK(scripts::is_valid_script_id("01_Регистр/01_Верхний регистр"));
    CHECK_FALSE(scripts::is_valid_script_id("a/./b"));
    CHECK_FALSE(scripts::is_valid_script_id("a\tb"));

    std::optional<int> order;
    CHECK(scripts::strip_order_prefix("01_Регистр", &order) == "Регистр");
    CHECK(order == 1);
    CHECK(scripts::strip_order_prefix("609_Комментарии из [! !]", &order) ==
          "Комментарии из [! !]");
    CHECK(order == 609);
    CHECK(scripts::strip_order_prefix("tree", &order) == "tree");
    CHECK_FALSE(order.has_value());
    CHECK(scripts::strip_order_prefix("12", &order) == "12");
    CHECK_FALSE(order.has_value());
    CHECK(scripts::strip_order_prefix("_x", &order) == "_x");

    CHECK(scripts::url_encode_segment("a b/c") == "a%20b%2Fc");
    CHECK(scripts::url_encode_segment("fbe.case-upper_1~") == "fbe.case-upper_1~");
    CHECK(scripts::package_url("01_Группа/x", "lib/util.js") ==
          "/scripts/01_%D0%93%D1%80%D1%83%D0%BF%D0%BF%D0%B0%2Fx/lib/util.js");
}

TEST_CASE("scripts: discovery walks groups in NN order and reports invalid packages", "[scripts]") {
    test::TempDir tmp{"mfbe-scripts"};
    const resources::ResourceLayers layers(roots_with_bundled(tmp, fixtures()));
    const scripts::Catalog catalog = scripts::load_catalog(layers);

    // Valid packages, in group order, tree group last.
    CHECK(ids_of(catalog) == std::vector<std::string>{"test.case.upper", "test.case.lower",
                                                      "test.dialogs.form", "test.dialogs.message",
                                                      "test.errors.throws", "test.errors.infinite",
                                                      "test.errors.sandbox", "test.model.append",
                                                      "test.model.replaceAll",
                                                      "test.invalid.warnings", "test.tree.mark"});
    REQUIRE(catalog.groups().size() == 6);
    CHECK(catalog.groups()[0].id == "01_Case");
    CHECK(catalog.groups()[0].order == 1);
    CHECK(catalog.groups()[0].names.at("en") == "Case");  // group.json
    CHECK(catalog.groups()[0].names.at("ru") == "Регистр");
    CHECK(catalog.groups()[1].names.at("en") == "Dialogs");  // folder name without prefix
    CHECK(catalog.groups()[1].names.count("ru") == 0);
    CHECK(catalog.groups()[4].id == "invalid");
    CHECK(catalog.groups()[4].order == 10000);  // unnumbered after numbered
    CHECK(catalog.groups()[5].id == "tree");

    const scripts::ScriptPackage* upper = catalog.find("test.case.upper");
    REQUIRE(upper != nullptr);
    CHECK(upper->group == "01_Case");
    CHECK(upper->layer == resources::LayerName::bundled);
    CHECK(upper->dir == fixtures() / "01_Case" / "01_Upper");
    CHECK(upper->manifest.kind == "menu");
    CHECK(upper->manifest.needsSelection);
    CHECK(upper->manifest.defaultHotkey == "Ctrl+Alt+U");
    CHECK(upper->manifest.icon == "icon.png");
    CHECK(upper->warnings.empty());
    const scripts::ScriptPackage* tree = catalog.find("test.tree.mark");
    REQUIRE(tree != nullptr);
    CHECK(tree->manifest.kind == "tree");

    // Invalid packages are reported, not fatal; warnings keep the package.
    const auto reasons = issue_reasons(catalog);
    CHECK(reasons.count("missingManifest") == 1);
    CHECK(reasons.count("invalidJson") == 1);
    CHECK(reasons.count("invalidManifest") == 1);
    CHECK(reasons.count("entryMissing") == 1);
    CHECK(reasons.count("iconMissing") == 1);
    CHECK(reasons.count("defaultHotkey") == 1);
    CHECK(reasons.count("needsSelection") == 1);
    CHECK(reasons.count("kind") == 1);
    const scripts::ScriptPackage* warned = catalog.find("test.invalid.warnings");
    REQUIRE(warned != nullptr);
    CHECK(warned->manifest.icon.empty());
    CHECK(warned->manifest.defaultHotkey.empty());
    CHECK(warned->warnings.size() == 4);
    for (const scripts::Issue& issue : catalog.issues()) {
        if (issue.reason == "missingManifest") {
            CHECK(issue.path == fixtures() / "invalid" / "01_NoManifest");
            CHECK(issue.severity == "warning");
        }
        if (issue.reason == "entryMissing") {
            CHECK(issue.id == "test.invalid.noentry");
            CHECK(issue.severity == "error");
        }
    }
    CHECK(catalog.find("test.invalid.noentry") == nullptr);
    CHECK(catalog.find("test.invalid.noname") == nullptr);

    // JSON shape of scripts.list.
    const json j = catalog.to_json();
    CHECK(j["groups"].size() == 6);
    const json& first = j["groups"][0]["scripts"][0];
    CHECK(first["id"] == "test.case.upper");
    CHECK(first["name"]["ru"] == "К верхнему регистру");
    CHECK(first["source"] == "bundled");
    CHECK(first["entryUrl"] == "/scripts/test.case.upper/index.js");
    CHECK(first["iconUrl"] == "/scripts/test.case.upper/icon.png");
    CHECK(first["legacy"]["source"] == "01_Регистр/01_Верхний регистр.js");
    CHECK(first["needsSelection"] == true);
    CHECK(first["group"] == "01_Case");
    CHECK(j["groups"][0]["names"]["ru"] == "Регистр");
    CHECK(j["folders"]["bundled"] == fixtures().string());
    CHECK(j["folders"]["user"] == (tmp / "data" / "scripts").string());
    CHECK(j["issues"].size() == catalog.issues().size());
}

TEST_CASE("scripts: layers are additive, bundled ids win conflicts", "[scripts]") {
    test::TempDir tmp{"mfbe-scripts"};
    resources::Roots roots = roots_with_bundled(tmp, fixtures());
    roots.settings_scripts = tmp / "custom";
    // User layer: a new group, a new script in an existing group and a bundled-id clone.
    copy_tree(fixtures() / "01_Case" / "01_Upper",
              tmp / "data" / "scripts" / "05_Mine" / "01_Hello");
    test::write_text(
        tmp / "data" / "scripts" / "05_Mine" / "01_Hello" / "script.json",
        R"json({"manifestVersion":1,"id":"mine.hello","name":{"en":"Hello"},"kind":"menu"})json");
    copy_tree(fixtures() / "01_Case" / "02_Lower",
              tmp / "data" / "scripts" / "01_Case" / "03_Title");
    test::write_text(
        tmp / "data" / "scripts" / "01_Case" / "03_Title" / "script.json",
        R"json({"manifestVersion":1,"id":"mine.title","name":{"en":"Title"},"kind":"menu"})json");
    copy_tree(fixtures() / "01_Case" / "01_Upper",
              tmp / "data" / "scripts" / "01_Case" / "01_Upper");
    // Settings (custom) layer beats the user layer for a non-bundled id.
    copy_tree(fixtures() / "01_Case" / "01_Upper", tmp / "custom" / "05_Mine" / "01_Hello");
    const std::string custom_manifest =
        R"json({"manifestVersion":1,"id":"mine.hello","name":{"en":"Hello (custom)"},)json"
        R"json("kind":"menu"})json";
    test::write_text(tmp / "custom" / "05_Mine" / "01_Hello" / "script.json", custom_manifest);
    test::write_text(tmp / "custom" / "05_Mine" / "group.json",
                     R"json({"names":{"en":"Mine","ru":"Мои"}})json");

    const resources::ResourceLayers layers(roots);
    const scripts::Catalog catalog = scripts::load_catalog(layers);

    const scripts::ScriptPackage* upper = catalog.find("test.case.upper");
    REQUIRE(upper != nullptr);
    CHECK(upper->layer == resources::LayerName::bundled);  // the clone was ignored
    const scripts::ScriptPackage* hello = catalog.find("mine.hello");
    REQUIRE(hello != nullptr);
    CHECK(hello->layer == resources::LayerName::settings);  // settings beats user
    CHECK(hello->manifest.name.at("en") == "Hello (custom)");
    const scripts::ScriptPackage* title = catalog.find("mine.title");
    REQUIRE(title != nullptr);
    CHECK(title->layer == resources::LayerName::user);
    CHECK(title->group == "01_Case");
    const scripts::Group* case_group = catalog.group("01_Case");
    REQUIRE(case_group != nullptr);
    CHECK(case_group->scripts.size() == 3);  // bundled two + the user addition
    CHECK(case_group->scripts[2].id == "mine.title");
    CHECK(case_group->names.at("ru") == "Регистр");
    const scripts::Group* mine = catalog.group("05_Mine");
    REQUIRE(mine != nullptr);
    CHECK(mine->names.at("ru") == "Мои");
    CHECK(mine->order == 5);
    CHECK(mine->scripts.size() == 1);

    int duplicates = 0;
    for (const scripts::Issue& issue : catalog.issues()) {
        if (issue.reason == "duplicateId") {
            ++duplicates;
            CHECK((issue.id == "test.case.upper" || issue.id == "mine.hello"));
        }
    }
    CHECK(duplicates == 2);
    CHECK(catalog.folders().at("custom") == tmp / "custom");
    CHECK(catalog.folders().at("user") == tmp / "data" / "scripts");
    CHECK(catalog.folders().at("bundled") == fixtures());
}

TEST_CASE("scripts: package files are confined to the package folder", "[scripts]") {
    test::TempDir tmp{"mfbe-scripts"};
    const resources::ResourceLayers layers(roots_with_bundled(tmp, fixtures()));
    const scripts::Catalog catalog = scripts::load_catalog(layers);
    const scripts::ScriptPackage* upper = catalog.find("test.case.upper");
    REQUIRE(upper != nullptr);
    CHECK(scripts::resolve_package_file(*upper, "index.js") == upper->dir / "index.js");
    CHECK(scripts::resolve_package_file(*upper, "icon.png") == upper->dir / "icon.png");
    for (const char* bad : {"", "../02_Lower/index.js", "..", "/etc/passwd", "index.js/..",
                            "./index.js", "lib//x.js", "a\\b", "missing.js", "script.json/"}) {
        INFO(bad);
        CHECK(scripts::resolve_package_file(*upper, bad).empty());
    }
    CHECK(scripts::package_files(*upper) ==
          std::vector<std::string>{"icon.png", "index.js", "script.json"});
}

TEST_CASE("scripts: scripts.* RPCs, Last script memory and the /scripts endpoint",
          "[scripts][server]") {
    test::TempDir data{"mfbe-scripts-rpc"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.scripts_dir = fixtures().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    json list = ws.call("scripts.list")["result"];
    REQUIRE(list.contains("groups"));
    CHECK(list["groups"].size() == 6);
    CHECK(list["groups"][0]["scripts"][0]["id"] == "test.case.upper");
    // Paths are compared as paths: separators and the UTF-8/native spelling differ per OS.
    CHECK(std::filesystem::path(list["folders"]["bundled"].get<std::string>()).lexically_normal() ==
          fixtures().lexically_normal());
    CHECK(std::filesystem::path(list["folders"]["user"].get<std::string>()).lexically_normal() ==
          (data / "scripts").lexically_normal());
    CHECK(list["issues"].size() >= 5);

    // scripts.source: entry URL and file list; unknown id -> 1030.
    const json source = ws.call("scripts.source", json{{"scriptId", "test.case.upper"}});
    REQUIRE(source.contains("result"));
    CHECK(source["result"]["entryUrl"] == "/scripts/test.case.upper/index.js");
    CHECK(source["result"]["entry"] == "index.js");
    CHECK(source["result"]["files"] == json::array({"icon.png", "index.js", "script.json"}));
    const json by_id = ws.call("scripts.source", json{{"id", "test.case.lower"}});
    CHECK(by_id["result"]["entryUrl"] == "/scripts/test.case.lower/index.js");
    const json missing = ws.call("scripts.source", json{{"scriptId", "nope"}});
    REQUIRE(missing.contains("error"));
    CHECK(missing["error"]["code"] == 1030);

    // Last script: empty until a run was reported, then remembered across list rebuilds.
    CHECK(ws.call("scripts.lastRun")["result"] == json::object());
    const json remembered = ws.call("scripts.lastRun", json{{"scriptId", "test.model.append"}});
    CHECK(remembered["result"]["scriptId"] == "test.model.append");
    CHECK(remembered["result"]["id"] == "test.model.append");
    CHECK(ws.call("scripts.lastRun")["result"]["scriptId"] == "test.model.append");
    CHECK(ws.call("settings.get")["result"]["session"]["lastScript"] == "test.model.append");
    // An id that no longer exists is not offered.
    ws.call("scripts.lastRun", json{{"scriptId", "gone.script"}});
    CHECK(ws.call("scripts.lastRun")["result"] == json::object());

    // The endpoint serves only files inside the package, with the right MIME type.
    const std::string token = "?token=" + server->token();
    auto get = [&](const std::string& path) {
        return test::http_get(server->port(), path + token);
    };
    const test::HttpResponse entry = get("/scripts/test.case.upper/index.js");
    CHECK(entry.status == 200);
    CHECK(entry.headers.at("content-type") == "text/javascript; charset=utf-8");
    CHECK(entry.headers.at("x-content-type-options") == "nosniff");
    CHECK(entry.body.find("export default async function run") != std::string::npos);
    const test::HttpResponse icon = get("/scripts/test.case.upper/icon.png");
    CHECK(icon.status == 200);
    CHECK(icon.headers.at("content-type") == "image/png");
    CHECK(icon.body.compare(0, 4, "\x89PNG") == 0);
    CHECK(get("/scripts/test.case.upper/script.json").status == 200);
    CHECK(get("/scripts/test.case.upper/missing.js").status == 404);
    CHECK(get("/scripts/nope/index.js").status == 404);
    CHECK(get("/scripts/test.case.upper/../02_Lower/index.js").status == 404);
    CHECK(get("/scripts/test.case.upper/..%2F02_Lower%2Findex.js").status == 404);
    CHECK(get("/scripts/test.case.upper/%2E%2E/02_Lower/index.js").status == 404);
    CHECK(get("/scripts/test.case.upper//etc/passwd").status == 404);
    CHECK(get("/scripts/test.case.upper/").status == 404);
    // HEAD and the token requirement.
    const test::HttpResponse head =
        test::http_get(server->port(), "/scripts/test.case.upper/index.js" + token, {}, "HEAD");
    CHECK(head.status == 200);
    CHECK(head.body.empty());
    CHECK(test::http_get(server->port(), "/scripts/test.case.upper/index.js").status == 401);

    // A package dropped into <Data>/scripts is picked up by scripts.reload (notification) and
    // served without a restart.
    copy_tree(fixtures() / "04_Model" / "01_Append", data / "scripts" / "09_User" / "01_Added");
    test::write_text(
        data / "scripts" / "09_User" / "01_Added" / "script.json",
        R"json({"manifestVersion":1,"id":"user.added","name":{"en":"Added"},"kind":"menu"})json");
    const json reloaded = ws.call("scripts.reload");
    CHECK(reloaded["result"]["count"] == 12);
    const auto changed = ws.wait_notification("resources.changed");
    REQUIRE(changed.has_value());
    CHECK((*changed)["params"]["what"] == "scripts");
    list = ws.call("scripts.list")["result"];
    bool saw_user = false;
    for (const json& g : list["groups"]) {
        for (const json& s : g["scripts"]) {
            if (s["id"] == "user.added") {
                saw_user = true;
                CHECK(s["source"] == "user");
                CHECK(g["id"] == "09_User");
            }
        }
    }
    CHECK(saw_user);
    CHECK(get("/scripts/user.added/index.js").status == 200);

    // openScriptsFolder: the user folder (created on demand), or the custom one from settings.
    const json opened = ws.call("resources.openScriptsFolder");
    REQUIRE(opened.contains("result"));
    CHECK(opened["result"]["path"] == (data / "scripts").string());
    std::filesystem::create_directories(data / "custom-scripts");
    ws.call("settings.set",
            json{{"patch", {{"other", {{"scriptsFolder", (data / "custom-scripts").string()}}}}}});
    CHECK(ws.call("resources.openScriptsFolder")["result"]["path"] ==
          (data / "custom-scripts").string());
    CHECK(ws.call("scripts.list")["result"]["folders"]["custom"] ==
          (data / "custom-scripts").string());
}
