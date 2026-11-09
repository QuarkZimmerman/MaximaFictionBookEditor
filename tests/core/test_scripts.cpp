// T101: script package discovery - manifest validation, group folders and ordering, layer
// precedence/additivity, invalid packages reported but not fatal, the scripts.* RPCs, the
// Last-script memory and the /scripts/{scriptId}/{file} endpoint (path traversal rejected).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/resources.hpp>
#include <mfbe/scripts.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <map>
#include <regex>
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
    CHECK(bad_kind.errors[0].find("treeRows") != std::string::npos);
    // Feature 011 (US11, D41; formats 1.10): a script of the tree bar's Scripts menu, which lists
    // places as rows of the Document tree.
    auto tree_rows = scripts::parse_manifest(
        json{{"manifestVersion", 1}, {"name", {{"en", "N"}}}, {"kind", "treeRows"}}, "tree/x",
        "tree");
    REQUIRE(tree_rows.manifest.has_value());
    CHECK(tree_rows.errors.empty());
    CHECK(tree_rows.warnings.empty());
    CHECK(tree_rows.manifest->kind == "treeRows");
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
    CHECK(ids_of(catalog) == std::vector<std::string>{"test.case.upper",
                                                      "test.case.lower",
                                                      "test.dialogs.form",
                                                      "test.dialogs.message",
                                                      "test.errors.throws",
                                                      "test.errors.infinite",
                                                      "test.errors.sandbox",
                                                      "test.model.append",
                                                      "test.model.replaceAll",
                                                      "runs.bulk",
                                                      "runs.busy",
                                                      "runs.prompt",
                                                      "runs.failing",
                                                      "runs.longProgress",
                                                      "runs.longSilent",
                                                      "runs.prompting",
                                                      "runs.short",
                                                      "tables.read",
                                                      "tables.toggleRegular",
                                                      "test.invalid.warnings",
                                                      "test.tree.mark"});
    REQUIRE(catalog.groups().size() == 9);
    CHECK(catalog.groups()[0].id == "01_Case");
    CHECK(catalog.groups()[0].order == 1);
    CHECK(catalog.groups()[0].names.at("en") == "Case");  // group.json
    CHECK(catalog.groups()[0].names.at("ru") == "Регистр");
    CHECK(catalog.groups()[1].names.at("en") == "Dialogs");  // folder name without prefix
    CHECK(catalog.groups()[1].names.count("ru") == 0);
    CHECK(catalog.groups()[5].id == "06_Runs");
    CHECK(catalog.groups()[5].names.at("en") == "Long runs");
    CHECK(catalog.groups()[6].id == "07_Tables");  // feature 006: the table fixture scripts
    CHECK(catalog.groups()[6].names.at("en") == "Tables");
    CHECK(catalog.groups()[6].names.at("ru") == "Таблицы");
    CHECK(catalog.groups()[7].id == "invalid");
    CHECK(catalog.groups()[7].order == 10000);  // unnumbered after numbered
    CHECK(catalog.groups()[8].id == "tree");

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
    // The fixture root also holds the book folders of the 2.7.9 conversion (`279/<NN>/`, feature
    // 007), folders without a manifest too: the group `invalid` has exactly one.
    int invalid_without_manifest = 0;
    for (const scripts::Issue& issue : catalog.issues()) {
        if (issue.reason == "missingManifest") {
            CHECK(issue.severity == "warning");
            if (issue.path.parent_path() == fixtures() / "invalid") {
                ++invalid_without_manifest;
                CHECK(issue.path == fixtures() / "invalid" / "01_NoManifest");
            }
        }
        if (issue.reason == "entryMissing") {
            CHECK(issue.id == "test.invalid.noentry");
            CHECK(issue.severity == "error");
        }
    }
    CHECK(invalid_without_manifest == 1);
    CHECK(catalog.find("test.invalid.noentry") == nullptr);
    CHECK(catalog.find("test.invalid.noname") == nullptr);

    // JSON shape of scripts.list.
    const json j = catalog.to_json();
    CHECK(j["groups"].size() == 9);
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

TEST_CASE("scripts: layers add up, a higher layer's same-id script replaces the lower one",
          "[scripts]") {
    test::TempDir tmp{"mfbe-scripts"};
    resources::Roots roots = roots_with_bundled(tmp, fixtures());
    roots.settings_scripts = tmp / "custom";
    // User layer: a new group, a new script in an existing group and a bundled-id copy - which
    // replaces the bundled script since feature 007 (FR-085; until then the bundled one won).
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
    CHECK(upper->layer == resources::LayerName::user);  // the copy replaced the bundled script
    CHECK(upper->dir == tmp / "data" / "scripts" / "01_Case" / "01_Upper");
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
    CHECK(case_group->scripts.size() == 3);  // the copy in the bundled one's place + the addition
    CHECK(case_group->scripts[0].id == "test.case.upper");
    CHECK(case_group->scripts[2].id == "mine.title");
    CHECK(case_group->names.at("ru") == "Регистр");
    const scripts::Group* mine = catalog.group("05_Mine");
    REQUIRE(mine != nullptr);
    CHECK(mine->names.at("ru") == "Мои");
    CHECK(mine->order == 5);
    CHECK(mine->scripts.size() == 1);

    // Both replacements are reported as `overridden` (info), none as a duplicate.
    int overridden = 0;
    for (const scripts::Issue& issue : catalog.issues()) {
        CHECK(issue.reason != "duplicateId");
        if (issue.reason == "overridden") {
            ++overridden;
            CHECK(issue.severity == "info");
            CHECK((issue.id == "test.case.upper" || issue.id == "mine.hello"));
        }
    }
    CHECK(overridden == 2);
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
    CHECK(list["groups"].size() == 9);
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
    CHECK(reloaded["result"]["count"] == 22);
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

// Feature 007 (T004, contracts/rpc-api.md §2 and §3.6 of the feature): the legacy source
// version is forwarded, every script names its origin, and a package's modules may load only
// their own package's files - decided by the request's referrer.
TEST_CASE("scripts: legacy source versions and origins (feature 007)", "[scripts]") {
    const json manifest = json::parse(R"json({"manifestVersion": 1, "id": "13/glava-1",
        "name": {"en": "Chapter titles"}, "kind": "menu",
        "legacy": {"source": "13_Заголовки/30_Привести заголовки глав к виду 'Глава 1'.js",
                   "fbeVersion": "2.7.9", "sourceVersion": "1.2"}})json");
    const auto parsed = scripts::parse_manifest(manifest, "a", "menu");
    REQUIRE(parsed.manifest.has_value());
    REQUIRE(parsed.manifest->legacy.has_value());
    CHECK(parsed.manifest->legacy->sourceVersion == "1.2");
    CHECK(parsed.warnings.empty());

    scripts::ScriptPackage package;
    package.manifest = *parsed.manifest;
    package.id = package.manifest.id;
    package.group = "13_subtitles";
    package.dir = std::filesystem::path("scripts") / "13_subtitles" / "30_glava-1";
    const json out = scripts::Catalog::package_to_json(package);
    CHECK(out["legacy"] ==
          json{{"source", "13_Заголовки/30_Привести заголовки глав к виду 'Глава 1'.js"},
               {"fbeVersion", "2.7.9"},
               {"sourceVersion", "1.2"}});
    CHECK(out["origin"] == "bundled");

    // Without sourceVersion the field is absent; a non-string one is ignored like fbeVersion.
    const auto plain = scripts::parse_manifest(
        json::parse(R"json({"manifestVersion": 1, "name": {"en": "N"}, "kind": "menu",
            "legacy": {"source": "x.js", "sourceVersion": 3}})json"),
        "a", "menu");
    REQUIRE(plain.manifest.has_value());
    REQUIRE(plain.manifest->legacy.has_value());
    CHECK(plain.manifest->legacy->sourceVersion.empty());
    package.manifest = *plain.manifest;
    CHECK_FALSE(scripts::Catalog::package_to_json(package)["legacy"].contains("sourceVersion"));

    // The other paths of the same classic script (feature 007): a package unchanged since
    // 2.7beta1 keeps that source and names its 2.7.9 path, so a 2.7.9 script list finds it.
    const auto aliased = scripts::parse_manifest(
        json::parse(R"json({"manifestVersion": 1, "name": {"en": "N"}, "kind": "menu",
            "legacy": {"source": "01_Регистр/01_Верхний регистр.js", "fbeVersion": "2.7",
                       "aliases": ["01_Регистр/01_В верхний регистр.js"]}})json"),
        "a", "menu");
    REQUIRE(aliased.manifest.has_value());
    CHECK(aliased.warnings.empty());
    CHECK(aliased.manifest->legacy->aliases ==
          std::vector<std::string>{"01_Регистр/01_В верхний регистр.js"});
    package.manifest = *aliased.manifest;
    CHECK(scripts::Catalog::package_to_json(package)["legacy"]["aliases"] ==
          json::array({"01_Регистр/01_В верхний регистр.js"}));
    // Not an array of strings: ignored, with a warning; the rest of the legacy block stays.
    const auto bad_aliases = scripts::parse_manifest(
        json::parse(R"json({"manifestVersion": 1, "name": {"en": "N"}, "kind": "menu",
            "legacy": {"source": "x.js", "aliases": ["y.js", 5]}})json"),
        "a", "menu");
    REQUIRE(bad_aliases.manifest.has_value());
    CHECK(bad_aliases.manifest->legacy->source == "x.js");
    CHECK(bad_aliases.manifest->legacy->aliases.empty());
    CHECK_FALSE(bad_aliases.warnings.empty());
    package.manifest = *bad_aliases.manifest;
    CHECK_FALSE(scripts::Catalog::package_to_json(package)["legacy"].contains("aliases"));

    // Every script names its origin: the layer, or `assistant` for the assistant's folder.
    test::TempDir tmp{"mfbe-scripts-origin"};
    resources::Roots roots = roots_with_bundled(tmp, fixtures());
    roots.settings_scripts = tmp / "custom";
    roots.portable = tmp / "portable";
    const auto add = [](const std::filesystem::path& dir, const std::string& id) {
        copy_tree(fixtures() / "01_Case" / "01_Upper", dir);
        test::write_text(dir / "script.json", R"json({"manifestVersion":1,"id":")json" + id +
                                                  R"json(","name":{"en":"N"},"kind":"menu"})json");
    };
    add(tmp / "data" / "scripts" / "09_User" / "01_Added", "user.added");
    add(tmp / "data" / "scripts" / "90_assistant" / "mine", "assistant/mine");
    add(tmp / "custom" / "08_Custom" / "01_One", "custom.one");
    add(tmp / "portable" / "scripts" / "07_Portable" / "01_One", "portable.one");
    const resources::ResourceLayers layers(roots);
    const scripts::Catalog catalog = scripts::load_catalog(layers);
    const json list = catalog.to_json();
    std::map<std::string, std::string> origins;
    for (const json& group : list["groups"]) {
        for (const json& script : group["scripts"]) {
            REQUIRE(script.contains("origin"));
            origins[script["id"].get<std::string>()] = script["origin"].get<std::string>();
        }
    }
    CHECK(origins.at("test.case.upper") == "bundled");
    CHECK(origins.at("user.added") == "user");
    CHECK(origins.at("assistant/mine") == "assistant");
    CHECK(origins.at("custom.one") == "settings");
    CHECK(origins.at("portable.one") == "portable");
}

TEST_CASE("scripts: a package's modules load only their own package's files (feature 007)",
          "[scripts][server]") {
    test::TempDir data{"mfbe-scripts-isolation"};
    // A user package whose entry imports a module of its own; its id holds a slash, so it is
    // percent-encoded as one segment in every URL.
    const std::filesystem::path own = data / "scripts" / "09_User" / "01_WithLib";
    copy_tree(fixtures() / "01_Case" / "01_Upper", own);
    test::write_text(own / "script.json",
                     R"json({"manifestVersion":1,"id":"09/with-lib","name":{"en":"N"},)json"
                     R"json("kind":"menu"})json");
    test::write_text(own / "lib" / "util.js", "export const util = 1;\n");
    test::write_text(own / "lib" / "deep.js", "export const deep = 2;\n");
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.scripts_dir = fixtures().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    const std::string origin = "http://127.0.0.1:" + std::to_string(server->port());
    const std::string token = "?token=" + server->token();
    const auto get = [&](const std::string& path, const std::string& referer) {
        std::map<std::string, std::string> headers;
        if (!referer.empty()) {
            headers["Referer"] = referer;
        }
        return test::http_get(server->port(), path + token, headers).status;
    };
    const std::string own_entry = origin + "/scripts/09%2Fwith-lib/index.js";

    // The entry of a run or of an mfbe.scripts.run callee: a worker made from a blob: URL
    // sends no referrer.
    CHECK(get("/scripts/09%2Fwith-lib/index.js", "") == 200);
    CHECK(get("/scripts/test.case.upper/index.js", "") == 200);
    // The host page and its own scripts (the assistant's read_script, the scripts feature).
    CHECK(get("/scripts/test.case.upper/index.js", origin + "/") == 200);
    CHECK(get("/scripts/test.case.upper/icon.png", origin + "/index.html") == 200);
    CHECK(get("/scripts/09%2Fwith-lib/lib/util.js", origin + "/assets/index-abc.js") == 200);
    // The package's own imports, from its entry and from its own nested modules.
    CHECK(get("/scripts/09%2Fwith-lib/lib/util.js", own_entry) == 200);
    CHECK(get("/scripts/09%2Fwith-lib/lib/deep.js",
              origin + "/scripts/09%2Fwith-lib/lib/util.js") == 200);
    CHECK(get("/scripts/09%2Fwith-lib/lib/util.js", own_entry + "?token=x#f") == 200);
    // Another package's files are refused to a module of this one, and the other way round.
    CHECK(get("/scripts/test.case.upper/index.js", own_entry) == 404);
    CHECK(get("/scripts/test.case.upper/icon.png", own_entry) == 404);
    CHECK(get("/scripts/09%2Fwith-lib/lib/util.js", origin + "/scripts/test.case.upper/index.js") ==
          404);
    // A referrer under /scripts/ that names no package file is no package's own.
    CHECK(get("/scripts/test.case.upper/index.js", origin + "/scripts/") == 404);
    CHECK(get("/scripts/test.case.upper/index.js", origin + "/scripts/test.case.upper") == 404);
    // HEAD follows the same rule.
    CHECK(test::http_get(server->port(), "/scripts/test.case.upper/index.js" + token,
                         {{"Referer", own_entry}}, "HEAD")
              .status == 404);
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 007, User Story 9 (T112): the layers' precedence with the assistant's folder on    */
/* top, overrides in the replaced script's place, replacing writes from the assistant's folder */
/* with a dated backup, and the backups' list and restore (data-model §7.2, §9;                */
/* contracts/rpc-api.md §3.6 and §4 of the feature).                                           */
/* ----------------------------------------------------------------------------------------- */

namespace {

namespace fs = std::filesystem;

// A copy of the fixture package `01_Case/01_Upper` at `dir` under the manifest `id` and the
// English name `name`; without its icon when `icon` is false.
void package_at(const fs::path& dir, const std::string& id, const std::string& name,
                bool icon = true) {
    copy_tree(fixtures() / "01_Case" / "01_Upper", dir);
    if (!icon) {
        fs::remove(dir / "icon.png");
    }
    test::write_text(dir / "script.json", json{{"manifestVersion", 1},
                                               {"id", id},
                                               {"name", {{"en", name}}},
                                               {"kind", "menu"},
                                               {"icon", "icon.png"}}
                                              .dump());
}

// The ids of one group of `scripts.list`, in menu order.
std::vector<std::string> ids_in(const json& list, const std::string& group) {
    std::vector<std::string> ids;
    for (const json& g : list["groups"]) {
        if (g["id"] == group) {
            for (const json& s : g["scripts"]) {
                ids.push_back(s["id"].get<std::string>());
            }
        }
    }
    return ids;
}

// One script of `scripts.list` by id (null when absent).
json script_of(const json& list, const std::string& id) {
    for (const json& g : list["groups"]) {
        for (const json& s : g["scripts"]) {
            if (s["id"] == id) {
                return s;
            }
        }
    }
    return nullptr;
}

bool has_group(const json& list, const std::string& group) {
    for (const json& g : list["groups"]) {
        if (g["id"] == group) {
            return true;
        }
    }
    return false;
}

// The issues of one reason and id, as `scripts.list` gives them.
std::vector<json> issues_of(const json& list, const std::string& reason, const std::string& id) {
    std::vector<json> out;
    for (const json& issue : list["issues"]) {
        if (issue["reason"] == reason && issue.value("id", "") == id) {
            out.push_back(issue);
        }
    }
    return out;
}

// Every file below `root`, relative, with its bytes: the state of a package or a backup.
std::map<std::string, std::string> files_of(const fs::path& root) {
    std::map<std::string, std::string> out;
    std::error_code ec;
    for (fs::recursive_directory_iterator it(root, ec), end; !ec && it != end; it.increment(ec)) {
        std::error_code file_ec;
        if (it->is_regular_file(file_ec)) {
            out[fs::relative(it->path(), root, file_ec).generic_string()] =
                test::read_text(it->path());
        }
    }
    return out;
}

bool is_backup_id(const std::string& text) {
    static const std::regex stamp(R"(\d{8}T\d{6}Z(-\d+)?)");
    return std::regex_match(text, stamp);
}

json package_files(const std::string& manifest, const std::string& entry) {
    return json::array({json{{"path", "script.json"}, {"content", manifest}},
                        json{{"path", "index.js"}, {"content", entry}}});
}

}  // namespace

TEST_CASE(
    "scripts: precedence - the assistant's folder, settings, user, portable, bundled "
    "(feature 007)",
    "[scripts]") {
    test::TempDir tmp{"mfbe-scripts-precedence"};
    resources::Roots roots = roots_with_bundled(tmp, fixtures());
    roots.settings_scripts = tmp / "custom";
    roots.portable = tmp / "portable";
    const fs::path bundled = fixtures() / "01_Case" / "01_Upper";
    const fs::path portable = tmp / "portable" / "scripts" / "03_Portable" / "01_Upper";
    const fs::path user = tmp / "data" / "scripts" / "05_Mine" / "01_Upper";
    const fs::path settings = tmp / "custom" / "06_Custom" / "01_Upper";
    const fs::path assistant = tmp / "data" / "scripts" / "90_assistant" / "test.case.upper";
    package_at(portable, "test.case.upper", "portable");
    package_at(user, "test.case.upper", "user");
    package_at(settings, "test.case.upper", "settings");
    package_at(assistant, "test.case.upper", "assistant");

    struct Level {
        fs::path dir;
        std::string name;    // the English name of the copy in effect
        std::string origin;  // its origin
    };
    // Highest first: each step removes the copy in effect and the next one down takes over.
    const std::vector<Level> levels = {{assistant, "assistant", "assistant"},
                                       {settings, "settings", "settings"},
                                       {user, "user", "user"},
                                       {portable, "portable", "portable"},
                                       {bundled, "To upper case", "bundled"}};
    for (std::size_t i = 0; i < levels.size(); ++i) {
        INFO("in effect: " << levels[i].origin);
        const scripts::Catalog catalog = scripts::load_catalog(resources::ResourceLayers(roots));
        const json list = catalog.to_json();
        const json upper = script_of(list, "test.case.upper");
        REQUIRE(upper.is_object());
        CHECK(upper["name"]["en"] == levels[i].name);
        CHECK(upper["origin"] == levels[i].origin);
        CHECK(fs::path(upper["dir"].get<std::string>()) == levels[i].dir);
        // In the bundled script's group and place, whatever folder it lives in.
        CHECK(upper["group"] == "01_Case");
        CHECK(ids_in(list, "01_Case") ==
              std::vector<std::string>{"test.case.upper", "test.case.lower"});
        for (const char* group : {"03_Portable", "05_Mine", "06_Custom", "90_assistant"}) {
            CHECK_FALSE(has_group(list, group));
        }
        // It names the version right under it; every replaced one is an `overridden` issue.
        const std::vector<json> overridden = issues_of(list, "overridden", "test.case.upper");
        CHECK(overridden.size() == levels.size() - 1 - i);
        for (const json& issue : overridden) {
            CHECK(issue["severity"] == "info");
        }
        if (i + 1 < levels.size()) {
            REQUIRE(upper.contains("overrides"));
            CHECK(upper["overrides"]["origin"] == levels[i + 1].origin);
            CHECK(fs::path(upper["overrides"]["dir"].get<std::string>()) == levels[i + 1].dir);
            std::set<fs::path> replaced;
            for (const json& issue : overridden) {
                replaced.insert(fs::path(issue["path"].get<std::string>()));
            }
            for (std::size_t j = i + 1; j < levels.size(); ++j) {
                CHECK(replaced.count(levels[j].dir) == 1);
            }
            fs::remove_all(levels[i].dir);
        } else {
            CHECK_FALSE(upper.contains("overrides"));
        }
        CHECK(issues_of(list, "duplicateId", "test.case.upper").empty());
    }
}

TEST_CASE(
    "scripts: user groups merge by folder name, an override keeps the replaced script's "
    "group and place, one id twice at one precedence is a duplicate (feature 007)",
    "[scripts]") {
    test::TempDir tmp{"mfbe-scripts-overrides"};
    const fs::path user = tmp / "data" / "scripts";
    // FR-031: a user group folder named like a bundled group merges into it, and a user script
    // with its own id keeps its group and its place.
    package_at(user / "01_Case" / "03_Title", "mine.title", "Title");
    package_at(user / "05_Mine" / "01_Hello", "mine.hello", "Hello");
    // FR-085: a user script with a bundled script's id, in a group of its own and without an
    // icon of its own, replaces the bundled one in its group and place, with its icon.
    package_at(user / "07_Elsewhere" / "99_Upper", "test.case.upper", "Upper (mine)", false);
    // The same id twice in one layer: the first loaded wins, the second is a duplicate.
    package_at(user / "06_Other" / "01_Hello", "mine.hello", "Hello again");

    const scripts::Catalog catalog =
        scripts::load_catalog(resources::ResourceLayers(roots_with_bundled(tmp, fixtures())));
    const json list = catalog.to_json();
    CHECK(ids_in(list, "01_Case") ==
          std::vector<std::string>{"test.case.upper", "test.case.lower", "mine.title"});
    CHECK(ids_in(list, "05_Mine") == std::vector<std::string>{"mine.hello"});
    CHECK_FALSE(has_group(list, "06_Other"));
    CHECK_FALSE(has_group(list, "07_Elsewhere"));
    const json title = script_of(list, "mine.title");
    CHECK(title["group"] == "01_Case");
    CHECK(title["origin"] == "user");
    CHECK_FALSE(title.contains("overrides"));
    CHECK(script_of(list, "mine.hello")["name"]["en"] == "Hello");

    const json upper = script_of(list, "test.case.upper");
    CHECK(upper["name"]["en"] == "Upper (mine)");
    CHECK(upper["group"] == "01_Case");
    CHECK(upper["folder"] == "99_Upper");
    CHECK(upper["origin"] == "user");
    CHECK(upper["source"] == "user");
    CHECK(fs::path(upper["dir"].get<std::string>()) == user / "07_Elsewhere" / "99_Upper");
    REQUIRE(upper.contains("overrides"));
    CHECK(upper["overrides"]["origin"] == "bundled");
    CHECK(fs::path(upper["overrides"]["dir"].get<std::string>()) ==
          fixtures() / "01_Case" / "01_Upper");
    // The icon of the place: the replaced script's, served under the override's id.
    CHECK(upper["iconUrl"] == "/scripts/test.case.upper/icon.png");

    const std::vector<json> overridden = issues_of(list, "overridden", "test.case.upper");
    REQUIRE(overridden.size() == 1);
    CHECK(overridden[0]["severity"] == "info");
    CHECK(fs::path(overridden[0]["path"].get<std::string>()) ==
          fixtures() / "01_Case" / "01_Upper");
    CHECK(issues_of(list, "iconMissing", "test.case.upper").empty());
    const std::vector<json> duplicates = issues_of(list, "duplicateId", "mine.hello");
    REQUIRE(duplicates.size() == 1);
    CHECK(fs::path(duplicates[0]["path"].get<std::string>()) == user / "06_Other" / "01_Hello");
    CHECK(issues_of(list, "overridden", "mine.hello").empty());
}

TEST_CASE(
    "scripts.write: from the assistant's folder a script in effect gets a replacing copy "
    "after a dated backup (feature 007)",
    "[scripts][write]") {
    test::TempDir data{"mfbe-scripts-replace"};
    // A user script whose id holds a slash, so its backups' folder is percent-encoded.
    package_at(data / "scripts" / "09_User" / "01_WithLib", "09/with-lib", "With lib");
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.scripts_dir = fixtures().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const fs::path bundled = fixtures() / "01_Case" / "01_Upper";
    const auto bundled_before = files_of(fixtures() / "01_Case");
    const fs::path target = data / "scripts" / "90_assistant" / "test.case.upper";
    const std::string manifest =
        R"json({"manifestVersion": 1, "id": "test.case.upper", "name": {"en": "Upper (changed)"},)json"
        R"json( "kind": "menu", "icon": "icon.png", "needsSelection": true})json";
    const std::string entry = "export default async function run() { return 'changed'; }\n";

    // A bundled id into the assistant's folder: a replacing copy, no 1202.
    const json written = ws.call("scripts.write", json{{"id", "test.case.upper"},
                                                       {"files", package_files(manifest, entry)}});
    REQUIRE(written.contains("result"));
    CHECK(fs::path(written["result"]["path"].get<std::string>()) == target);
    REQUIRE(written["result"].contains("backupId"));
    const std::string first = written["result"]["backupId"];
    CHECK(is_backup_id(first));
    // The backup: <Data>/script-backups/<id percent-encoded>/<yyyymmddThhmmssZ>/, the files as
    // they were and backup.json.
    const fs::path first_dir = data / "script-backups" / "test.case.upper" / first;
    const json meta = json::parse(test::read_text(first_dir / "backup.json"));
    CHECK(meta["id"] == "test.case.upper");
    CHECK(meta["origin"] == "bundled");
    CHECK(fs::path(meta["sourceDir"].get<std::string>()) == bundled);
    CHECK(meta["reason"] == "assistantChange");
    CHECK(std::regex_match(meta["createdAt"].get<std::string>(),
                           std::regex(R"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)")));
    auto backed_up = files_of(first_dir);
    backed_up.erase("backup.json");
    CHECK(backed_up == files_of(bundled));
    CHECK(files_of(target) ==
          std::map<std::string, std::string>{{"index.js", entry}, {"script.json", manifest}});
    // The bundled files are untouched; the copy is in effect in the bundled script's place,
    // with the bundled icon.
    CHECK(files_of(fixtures() / "01_Case") == bundled_before);
    json list = ws.call("scripts.list")["result"];
    json upper = script_of(list, "test.case.upper");
    CHECK(upper["name"]["en"] == "Upper (changed)");
    CHECK(upper["origin"] == "assistant");
    CHECK(upper["group"] == "01_Case");
    CHECK(ids_in(list, "01_Case").front() == "test.case.upper");
    REQUIRE(upper.contains("overrides"));
    CHECK(upper["overrides"]["origin"] == "bundled");
    CHECK(fs::path(upper["overrides"]["dir"].get<std::string>()) == bundled);
    REQUIRE(upper.contains("iconUrl"));
    const std::string token = "?token=" + server->token();
    const test::HttpResponse icon =
        test::http_get(server->port(), upper["iconUrl"].get<std::string>() + token);
    CHECK(icon.status == 200);
    CHECK(icon.headers.at("content-type") == "image/png");
    CHECK(icon.body == test::read_text(bundled / "icon.png"));
    CHECK(test::http_get(server->port(), "/scripts/test.case.upper/index.js" + token).body ==
          entry);

    // The same id again without overwrite: 1203, the assistant's copy exists.
    const json again = ws.call("scripts.write", json{{"id", "test.case.upper"},
                                                     {"files", package_files(manifest, entry)}});
    REQUIRE(again.contains("error"));
    CHECK(again["error"]["code"] == 1203);
    // Overwriting the assistant's copy backs it up first.
    const std::string entry2 = "export default async function run() { return 'twice'; }\n";
    const json overwritten =
        ws.call("scripts.write", json{{"id", "test.case.upper"},
                                      {"files", package_files(manifest, entry2)},
                                      {"overwrite", true}});
    REQUIRE(overwritten.contains("result"));
    REQUIRE(overwritten["result"].contains("backupId"));
    const std::string second = overwritten["result"]["backupId"];
    CHECK(is_backup_id(second));
    CHECK(second != first);
    const fs::path second_dir = data / "script-backups" / "test.case.upper" / second;
    const json meta2 = json::parse(test::read_text(second_dir / "backup.json"));
    CHECK(meta2["origin"] == "assistant");
    CHECK(fs::path(meta2["sourceDir"].get<std::string>()) == target);
    auto copy_backed_up = files_of(second_dir);
    copy_backed_up.erase("backup.json");
    CHECK(copy_backed_up ==
          std::map<std::string, std::string>{{"index.js", entry}, {"script.json", manifest}});
    CHECK(test::read_text(target / "index.js") == entry2);

    // A user script's id: a replacing copy too, its backup under the percent-encoded id.
    const std::string lib_manifest =
        R"json({"manifestVersion": 1, "id": "09/with-lib", "name": {"en": "With lib (changed)"},)json"
        R"json( "kind": "menu"})json";
    const json lib = ws.call("scripts.write", json{{"id", "09/with-lib"},
                                                   {"files", package_files(lib_manifest, entry)}});
    REQUIRE(lib.contains("result"));
    REQUIRE(lib["result"].contains("backupId"));
    const fs::path lib_backup =
        data / "script-backups" / "09%2Fwith-lib" / lib["result"]["backupId"].get<std::string>();
    CHECK(json::parse(test::read_text(lib_backup / "backup.json"))["origin"] == "user");
    list = ws.call("scripts.list")["result"];
    CHECK(script_of(list, "09/with-lib")["group"] == "09_User");
    CHECK(script_of(list, "09/with-lib")["origin"] == "assistant");

    // Any other folder keeps 1202 for a bundled id, and writes nothing.
    const std::string lower =
        R"json({"manifestVersion": 1, "id": "test.case.lower", "name": {"en": "x"}, "kind": "menu"})json";
    const json refused = ws.call("scripts.write", json{{"id", "test.case.lower"},
                                                       {"group", "50_mine"},
                                                       {"files", package_files(lower, entry)}});
    REQUIRE(refused.contains("error"));
    CHECK(refused["error"]["code"] == 1202);
    CHECK_FALSE(fs::exists(data / "scripts" / "50_mine"));
    CHECK_FALSE(fs::exists(data / "script-backups" / "test.case.lower"));
    // A new id makes no backup.
    const std::string fresh =
        R"json({"manifestVersion": 1, "id": "assistant/fresh", "name": {"en": "x"}, "kind": "menu"})json";
    const json created = ws.call(
        "scripts.write", json{{"id", "assistant/fresh"}, {"files", package_files(fresh, entry)}});
    REQUIRE(created.contains("result"));
    CHECK_FALSE(created["result"].contains("backupId"));
    CHECK_FALSE(fs::exists(data / "script-backups" / "assistant%2Ffresh"));
}

TEST_CASE("scripts.backups.list and scripts.backups.restore (feature 007)", "[scripts][write]") {
    test::TempDir data{"mfbe-scripts-backups"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.scripts_dir = fixtures().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const fs::path bundled = fixtures() / "01_Case" / "01_Upper";
    const fs::path target = data / "scripts" / "90_assistant" / "test.case.upper";
    const std::string manifest =
        R"json({"manifestVersion": 1, "id": "test.case.upper", "name": {"en": "Upper (changed)"},)json"
        R"json( "kind": "menu"})json";
    const std::string entry1 = "export default async function run() { return 1; }\n";
    const std::string entry2 = "export default async function run() { return 2; }\n";
    const json one = ws.call("scripts.write", json{{"id", "test.case.upper"},
                                                   {"files", package_files(manifest, entry1)}});
    REQUIRE(one.contains("result"));
    const json two = ws.call("scripts.write", json{{"id", "test.case.upper"},
                                                   {"files", package_files(manifest, entry2)},
                                                   {"overwrite", true}});
    REQUIRE(two.contains("result"));
    REQUIRE(one["result"].contains("backupId"));
    REQUIRE(two["result"].contains("backupId"));
    const std::string of_bundled = one["result"]["backupId"];
    const std::string of_copy = two["result"]["backupId"];

    // Newest first, {backupId, origin, createdAt}; an id without backups lists none.
    json listed = ws.call("scripts.backups.list", json{{"id", "test.case.upper"}});
    REQUIRE(listed.contains("result"));
    REQUIRE(listed["result"]["backups"].size() == 2);
    CHECK(listed["result"]["backups"][0]["backupId"] == of_copy);
    CHECK(listed["result"]["backups"][0]["origin"] == "assistant");
    CHECK(listed["result"]["backups"][1]["backupId"] == of_bundled);
    CHECK(listed["result"]["backups"][1]["origin"] == "bundled");
    CHECK(listed["result"]["backups"][1]["createdAt"].is_string());
    CHECK(
        ws.call("scripts.backups.list", json{{"id", "test.case.lower"}}).value("result", json()) ==
        json{{"backups", json::array()}});
    CHECK(ws.call("scripts.backups.list", json{{"id", "a/../b"}})
              .value("error", json::object())
              .value("code", 0) == -32602);

    // A backup of the bundled version: the assistant's copy goes, the bundled script is in
    // effect again; the copy itself is kept as a backup first, nothing is lost.
    ws.inbox.clear();
    const json restored = ws.call("scripts.backups.restore",
                                  json{{"id", "test.case.upper"}, {"backupId", of_bundled}});
    REQUIRE(restored.contains("result"));
    CHECK(restored["result"]["restored"] == true);
    CHECK_FALSE(fs::exists(target));
    REQUIRE(ws.wait_notification("resources.changed").has_value());
    json list = ws.call("scripts.list")["result"];
    json upper = script_of(list, "test.case.upper");
    CHECK(upper["origin"] == "bundled");
    CHECK(upper["name"]["en"] == "To upper case");
    CHECK_FALSE(upper.contains("overrides"));
    CHECK(issues_of(list, "overridden", "test.case.upper").empty());
    REQUIRE(restored["result"].contains("backupId"));
    const fs::path kept = data / "script-backups" / "test.case.upper" /
                          restored["result"]["backupId"].get<std::string>();
    CHECK(test::read_text(kept / "index.js") == entry2);
    CHECK(json::parse(test::read_text(kept / "backup.json"))["origin"] == "assistant");

    // A backup of an assistant's copy: the version in effect (now the bundled one) is backed
    // up, then the backup's files become the assistant's copy again.
    ws.inbox.clear();
    const json back =
        ws.call("scripts.backups.restore", json{{"id", "test.case.upper"}, {"backupId", of_copy}});
    REQUIRE(back.contains("result"));
    CHECK(back["result"]["restored"] == true);
    REQUIRE(back["result"].contains("backupId"));
    const fs::path before_restore =
        data / "script-backups" / "test.case.upper" / back["result"]["backupId"].get<std::string>();
    CHECK(json::parse(test::read_text(before_restore / "backup.json"))["origin"] == "bundled");
    CHECK(test::read_text(target / "index.js") == entry1);
    CHECK(test::read_text(target / "script.json") == manifest);
    REQUIRE(ws.wait_notification("resources.changed").has_value());
    list = ws.call("scripts.list")["result"];
    upper = script_of(list, "test.case.upper");
    CHECK(upper["origin"] == "assistant");
    CHECK(upper["group"] == "01_Case");
    CHECK(ids_in(list, "01_Case").front() == "test.case.upper");
    CHECK(ws.call("scripts.backups.list", json{{"id", "test.case.upper"}})["result"]["backups"]
              .size() == 4);

    // An unknown backup: 1204 script.backupNotFound {id, backupId}; a malformed one is refused.
    const json unknown = ws.call("scripts.backups.restore",
                                 json{{"id", "test.case.upper"}, {"backupId", "20000101T000000Z"}});
    REQUIRE(unknown.contains("error"));
    CHECK(unknown["error"]["code"] == 1204);
    CHECK(unknown["error"]["message"] == "script.backupNotFound");
    CHECK(unknown["error"]["data"] ==
          json{{"id", "test.case.upper"}, {"backupId", "20000101T000000Z"}});
    const json other =
        ws.call("scripts.backups.restore", json{{"id", "test.case.lower"}, {"backupId", of_copy}});
    REQUIRE(other.contains("error"));
    CHECK(other["error"]["code"] == 1204);
    const json traversal =
        ws.call("scripts.backups.restore", json{{"id", "test.case.upper"}, {"backupId", "../x"}});
    REQUIRE(traversal.contains("error"));
    CHECK(traversal["error"]["code"] == -32602);
    CHECK(traversal["error"]["data"]["field"] == "backupId");
    CHECK(test::read_text(target / "index.js") == entry1);
}

/* ----------------------------------------------------------------------------------------- */
/* Feature 007, User Story 8 (T123): group icons - the merged group's `iconUrl` and the route */
/* GET/HEAD /script-groups/:groupFolder/icon (contracts/rpc-api.md §2 of the feature,          */
/* data-model §6).                                                                             */
/* ----------------------------------------------------------------------------------------- */

namespace {

// A 16 x 16 PNG's bytes are not needed here: any distinct bytes stand for a layer's icon file.
const std::string kBundledIcon = std::string("\x89PNG\r\n\x1a\n", 8) + "bundled group icon";
const std::string kUserIcon = std::string("\x89PNG\r\n\x1a\n", 8) + "user group icon";
const std::string kMineIcon = std::string("\x89PNG\r\n\x1a\n", 8) + "mine group icon";

json group_of(const json& list, const std::string& id) {
    for (const json& g : list["groups"]) {
        if (g["id"] == id) {
            return g;
        }
    }
    return nullptr;
}

}  // namespace

TEST_CASE(
    "scripts: a group's declared icon gets an iconUrl, served by /script-groups/:groupFolder/icon "
    "from the layer whose declaration the merged group uses (feature 007)",
    "[scripts][server]") {
    test::TempDir tmp{"mfbe-scripts-group-icons"};
    const fs::path bundled = tmp / "bundled";
    const fs::path user = tmp / "data" / "scripts";
    // Bundled: 01_Case declares its icon; 02_Dialogs declares none; 03_Broken declares a file
    // it does not have.
    copy_tree(fixtures() / "01_Case", bundled / "01_Case");
    test::write_text(bundled / "01_Case" / "icon.png", kBundledIcon);
    test::write_text(bundled / "01_Case" / "group.json",
                     R"json({"names": {"en": "Case", "ru": "Регистр"}, "icon": "icon.png"})json");
    copy_tree(fixtures() / "02_Dialogs", bundled / "02_Dialogs");
    copy_tree(fixtures() / "04_Model", bundled / "03_Broken");
    test::write_text(bundled / "03_Broken" / "group.json", R"json({"icon": "missing.png"})json");
    // The user layer: the same 01_Case with an icon of its own (the bundled declaration stays
    // the merged group's), 02_Dialogs with one (the merged group has none: it takes the user's)
    // and a group of the user's own with a Cyrillic folder name.
    package_at(user / "01_Case" / "03_Title", "mine.title", "Title");
    test::write_text(user / "01_Case" / "icon.png", kUserIcon);
    test::write_text(user / "01_Case" / "group.json", R"json({"icon": "icon.png"})json");
    package_at(user / "02_Dialogs" / "03_Extra", "mine.extra", "Extra");
    test::write_text(user / "02_Dialogs" / "user-icon.png", kUserIcon);
    test::write_text(user / "02_Dialogs" / "group.json", R"json({"icon": "user-icon.png"})json");
    // UTF-8 text made a path the editor's way (a narrow literal would go through the legacy
    // code page on Windows).
    const fs::path mine_folder = user / platform::path_from_utf8("06_Мои");
    package_at(mine_folder / "01_Hello", "mine.hello", "Hello");
    test::write_text(mine_folder / "icon.png", kMineIcon);
    test::write_text(mine_folder / "group.json", R"json({"icon": "icon.png"})json");

    CoreServerOptions options;
    options.data_dir = (tmp / "data").string();
    options.scripts_dir = bundled.string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    const json list = ws.call("scripts.list")["result"];

    const json case_group = group_of(list, "01_Case");
    REQUIRE(case_group.is_object());
    CHECK(case_group.value("icon", "") == "icon.png");
    CHECK(case_group.value("iconUrl", "") == "/script-groups/01_Case/icon");
    const json dialogs = group_of(list, "02_Dialogs");
    REQUIRE(dialogs.is_object());
    CHECK(dialogs.value("iconUrl", "") == "/script-groups/02_Dialogs/icon");
    const json broken = group_of(list, "03_Broken");
    REQUIRE(broken.is_object());
    CHECK_FALSE(broken.contains("icon"));
    CHECK_FALSE(broken.contains("iconUrl"));
    const json mine = group_of(list, "06_Мои");
    REQUIRE(mine.is_object());
    const std::string mine_url =
        "/script-groups/" + scripts::url_encode_segment("06_Мои") + "/icon";
    CHECK(mine.value("iconUrl", "") == mine_url);

    const std::string token = "?token=" + server->token();
    const auto get = [&](const std::string& path, const std::string& method = "GET") {
        return test::http_get(server->port(), path + token, {}, method);
    };
    // The merged group's icon is the bundled declaration's file, not the user's.
    const test::HttpResponse icon = get("/script-groups/01_Case/icon");
    CHECK(icon.status == 200);
    CHECK(icon.body == kBundledIcon);
    CHECK(icon.headers.at("content-type") == "image/png");
    CHECK(icon.headers.at("x-content-type-options") == "nosniff");
    CHECK(icon.headers.at("cache-control") == "no-cache");
    const test::HttpResponse head = get("/script-groups/01_Case/icon", "HEAD");
    CHECK(head.status == 200);
    CHECK(head.body.empty());
    CHECK(get("/script-groups/02_Dialogs/icon").body == kUserIcon);
    CHECK(get(mine_url).body == kMineIcon);
    // No icon, no group, no token: 404, 404, 401.
    CHECK(get("/script-groups/03_Broken/icon").status == 404);
    CHECK(get("/script-groups/tree/icon").status == 404);
    CHECK(get("/script-groups/99_Nothing/icon").status == 404);
    CHECK(get("/script-groups/..%2F01_Case/icon").status == 404);
    CHECK(test::http_get(server->port(), "/script-groups/01_Case/icon").status == 401);
}
