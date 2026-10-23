// Feature 005 T017: the AI service list loader (resource-formats.md §A, rpc-api.md §3.12
// "services", data-model §1) over the fixtures of tests/fixtures/ai-services/.
#include "test_support.hpp"

#include <mfbe/ai_services.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/log.hpp>
#include <mfbe/platform.hpp>

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <sstream>
#include <string>
#include <vector>

using namespace mfbe;
using nlohmann::json;

namespace {

namespace fs = std::filesystem;

// The bundled list in the spelling the core gives its resources folder (a canonical path:
// core_server's resolve_resources_dir); CMake spells the source folder with forward slashes on
// Windows, which the canonical form - and the loader's lexical normalisation - turn into the
// preferred separators. The same file, compared in the same form.
fs::path bundled_file() {
    const fs::path file = platform::path_from_utf8(MFBE_RESOURCES_SOURCE_DIR) / "ai-services.json";
    std::error_code ec;
    const fs::path canonical = fs::weakly_canonical(file, ec);
    return ec ? file.lexically_normal() : canonical;
}

fs::path fixture(const char* name) {
    return test::fixtures_dir() / "ai-services" / name;
}

// A user layer whose data file is `fixture_name` copied into a temporary folder (the loader
// reads the fixture bytes exactly as the journeys copy them into core.dataDir).
struct Layered {
    test::TempDir tmp{"mfbe-ai-services"};
    fs::path data = tmp.path() / "data";
    fs::path portable_dir = tmp.path() / "portable";

    ai::UserLayer layer() const {
        ai::UserLayer l;
        l.user = data / "ai-services.json";
        l.portable = portable_dir / "ai-services.json";
        return l;
    }
    void put_user(const char* name) const {
        fs::create_directories(data);
        fs::copy_file(fixture(name), data / "ai-services.json",
                      fs::copy_options::overwrite_existing);
    }
    void put_portable(const char* name) const {
        fs::create_directories(portable_dir);
        fs::copy_file(fixture(name), portable_dir / "ai-services.json",
                      fs::copy_options::overwrite_existing);
    }
    ai::ServiceList load() const { return ai::ServiceList::load(bundled_file(), layer()); }
};

std::vector<std::string> ids(const ai::ServiceList& list) {
    std::vector<std::string> out;
    for (const auto& entry : list.services) {
        out.push_back(entry.id);
    }
    return out;
}

std::vector<json> issues_json(const ai::ServiceList& list) {
    std::vector<json> out;
    for (const auto& issue : list.issues) {
        out.push_back(issue.to_json());
    }
    return out;
}

std::vector<json> log_entries(const fs::path& logs) {
    std::vector<json> entries;
    const fs::path file = logs / "mfbe-errors.log";
    if (!fs::exists(file)) {
        return entries;
    }
    std::istringstream lines(test::read_text(file));
    for (std::string line; std::getline(lines, line);) {
        if (!line.empty()) {
            entries.push_back(json::parse(line));
        }
    }
    return entries;
}

}  // namespace

TEST_CASE(
    "ai.services: the bundled file holds exactly the three entries in order with three "
    "limits languages and no key requirement",
    "[ai][services]") {
    Layered env;  // no user file
    const ai::ServiceList list = env.load();
    CHECK(list.issues.empty());
    CHECK(list.hidden.empty());
    CHECK(ids(list) == std::vector<std::string>{"ovhcloud", "pollinations", "llm7"});
    for (const auto& entry : list.services) {
        INFO(entry.id);
        CHECK(entry.source == ai::Layer::bundled);
        CHECK_FALSE(entry.replaced);
        CHECK_FALSE(entry.key_required);
        CHECK_FALSE(entry.has_key());
        CHECK(entry.tools);
        CHECK_FALSE(entry.local);
        CHECK_FALSE(entry.plain_http);
        CHECK_FALSE(entry.limits.en.empty());
        CHECK_FALSE(entry.limits.ru.empty());
        CHECK_FALSE(entry.limits.uk.empty());
        CHECK(entry.limits.ru != entry.limits.en);  // written, not filled from en
        CHECK(entry.limits.uk != entry.limits.en);
        REQUIRE(entry.terms_url.has_value());
        CHECK(entry.terms_url->rfind("https://", 0) == 0);
        CHECK(entry.base == entry.address);  // no trailing slash in the bundled addresses
    }
    CHECK(list.services[0].address == "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1");
    CHECK(list.services[0].model == "gpt-oss-120b");
    CHECK(list.services[0].host == "oai.endpoints.kepler.ai.cloud.ovh.net");
    CHECK(list.services[0].context_length == 131072);
    CHECK(list.services[1].address == "https://text.pollinations.ai/openai");
    CHECK(list.services[1].model == "openai-fast");
    CHECK_FALSE(list.services[1].context_length.has_value());
    CHECK(list.services[2].address == "https://api.llm7.io/v1");
    CHECK(list.services[2].model == "minimax-m2.7");
    CHECK(list.services[2].terms_url == "https://llm7.io/privacy");
    CHECK(list.services[2].context_length == 180000);

    // The AiServicesResult shape.
    const json j = list.to_json();
    CHECK(j["services"].size() == 3);
    CHECK(j["hidden"] == json::array());
    CHECK(j["issues"] == json::array());
    CHECK(j["files"]["bundled"] == platform::utf8_from_path(bundled_file()));
    CHECK(j["files"]["user"] == platform::utf8_from_path(env.data / "ai-services.json"));
    CHECK(j["files"]["userExists"] == false);
    CHECK_FALSE(j["files"].contains("portable"));
    const json& first = j["services"][0];
    CHECK(first == json{{"id", "ovhcloud"},
                        {"name", "OVHcloud AI Endpoints"},
                        {"address", "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1"},
                        {"model", "gpt-oss-120b"},
                        {"keyRequired", false},
                        {"hasKey", false},
                        {"tools", true},
                        {"termsUrl", "https://www.ovhcloud.com/en/terms-and-conditions/"},
                        {"limits", list.services[0].to_json()["limits"]},
                        {"contextLength", 131072},
                        {"source", "bundled"},
                        {"replaced", false},
                        {"local", false},
                        {"plainHttp", false}});
    CHECK_FALSE(j["services"][1].contains("contextLength"));
    for (const auto& entry : j["services"]) {
        CHECK_FALSE(entry.contains("key"));
        CHECK_FALSE(entry.contains("hidden"));
    }
}

TEST_CASE(
    "ai.services: union of bundled and user lists by id, hidden removes, replaced is "
    "flagged, user-only entries last",
    "[ai][services]") {
    SECTION("a user entry with a bundled id replaces it whole and keeps its position") {
        Layered env;
        env.put_user("user-override.json");
        const ai::ServiceList list = env.load();
        CHECK(list.issues.empty());
        CHECK(ids(list) == std::vector<std::string>{"ovhcloud", "pollinations", "llm7"});
        const ai::ServiceEntry& ovh = list.services[0];
        CHECK(ovh.name == "OVHcloud AI Endpoints (stand-in)");
        CHECK(ovh.address == "http://127.0.0.1:8787/v1");
        CHECK(ovh.model == "standin-chat");
        CHECK(ovh.source == ai::Layer::user);
        CHECK(ovh.replaced);
        CHECK(ovh.local);
        CHECK(ovh.plain_http);
        CHECK(ovh.host == "127.0.0.1:8787");
        CHECK(ovh.terms_url == "http://127.0.0.1:8787/terms");
        CHECK(ovh.limits.en == "none");
        CHECK(ovh.limits.ru == "нет");
        CHECK(ovh.limits.uk == "немає");
        CHECK(list.services[1].source == ai::Layer::bundled);
        CHECK_FALSE(list.services[1].replaced);
        CHECK(list.files.user_exists);
        CHECK(list.to_json()["services"][0]["source"] == "user");
        CHECK(list.to_json()["services"][0]["replaced"] == true);
    }
    SECTION("hidden: true removes the bundled entry and lists its id") {
        Layered env;
        env.put_user("user-hidden-pollinations.json");
        const ai::ServiceList list = env.load();
        CHECK(list.issues.empty());
        CHECK(ids(list) == std::vector<std::string>{"ovhcloud", "llm7"});
        CHECK(list.hidden == std::vector<std::string>{"pollinations"});
        CHECK(list.find("pollinations") == nullptr);
        CHECK(list.find("llm7") != nullptr);
        CHECK(list.to_json()["hidden"] == json::array({"pollinations"}));
    }
    SECTION("user-only entries follow the bundled ones in user-file order; limits as a string") {
        Layered env;
        env.put_user("user-added-no-tools.json");
        const ai::ServiceList list = env.load();
        CHECK(list.issues.empty());
        CHECK(ids(list) ==
              std::vector<std::string>{"ovhcloud", "pollinations", "llm7", "my-local"});
        const ai::ServiceEntry& local = list.services.back();
        CHECK(local.source == ai::Layer::user);
        CHECK_FALSE(local.replaced);
        CHECK_FALSE(local.tools);
        CHECK(local.local);
        CHECK(local.plain_http);
        CHECK(local.limits.en == "no limits: the model runs on this computer");
        CHECK(local.limits.ru == local.limits.en);  // filled from en
        CHECK(local.limits.uk == local.limits.en);
        CHECK_FALSE(local.terms_url.has_value());
        CHECK_FALSE(local.context_length.has_value());
        const json j = local.to_json();
        CHECK(j["tools"] == false);
        CHECK(j["local"] == true);
        CHECK(j["plainHttp"] == true);
        CHECK_FALSE(j.contains("termsUrl"));
    }
    SECTION("within one file the first entry with an id wins; the later one is duplicateId") {
        Layered env;
        env.put_user("user-duplicate-id.json");
        const ai::ServiceList list = env.load();
        REQUIRE(list.issues.size() == 1);
        CHECK(list.issues[0].reason == "duplicateId");
        CHECK(list.issues[0].index == 1);
        CHECK(list.issues[0].file == env.data / "ai-services.json");
        CHECK_FALSE(list.issues[0].field.has_value());
        REQUIRE(list.find("standin") != nullptr);
        CHECK(list.find("standin")->name == "Stand-in (first entry wins)");
        CHECK(list.find("standin")->address == "http://127.0.0.1:8787/v1");
        CHECK(list.services.size() == 4);
    }
    SECTION("a user entry replacing a bundled id with a hosted name and a trailing slash") {
        Layered env;
        test::write_text(env.data / "ai-services.json", R"({"version": 1, "services": [
            {"id": "ovhcloud", "name": "Redirected", "address": "http://ai.standin.test:8080/v1///",
             "model": "standin-chat"}]})");
        const ai::ServiceList list = env.load();
        CHECK(list.issues.empty());
        const ai::ServiceEntry& ovh = list.services[0];
        CHECK(ovh.address == "http://ai.standin.test:8080/v1///");
        CHECK(ovh.base == "http://ai.standin.test:8080/v1");  // trailing slashes removed on use
        CHECK(ovh.host == "ai.standin.test:8080");
        CHECK_FALSE(ovh.local);  // the rule is textual: a LAN or test name is hosted
        CHECK(ovh.plain_http);
        CHECK(ovh.replaced);
    }
}

TEST_CASE(
    "ai.services: malformed user file and bad entries are reported per file and index; "
    "the rest stays usable",
    "[ai][services]") {
    SECTION("an entry without a model is missingField {model}; the bundled list stays") {
        Layered env;
        env.put_user("user-missing-model.json");
        const ai::ServiceList list = env.load();
        CHECK(list.services.size() == 3);
        REQUIRE(list.issues.size() == 1);
        CHECK(list.issues[0].to_json() ==
              json{{"file", platform::utf8_from_path(env.data / "ai-services.json")},
                   {"index", 0},
                   {"reason", "missingField"},
                   {"field", "model"}});
    }
    SECTION("a truncated file is invalidJson and contributes nothing") {
        Layered env;
        env.put_user("user-truncated.json");
        const ai::ServiceList list = env.load();
        CHECK(ids(list) == std::vector<std::string>{"ovhcloud", "pollinations", "llm7"});
        REQUIRE(list.issues.size() == 1);
        CHECK(list.issues[0].reason == "invalidJson");
        CHECK_FALSE(list.issues[0].index.has_value());
        CHECK(list.files.user_exists);
    }
    SECTION("version 2 is badVersion and the file is ignored whole") {
        Layered env;
        env.put_user("user-bad-version.json");
        const ai::ServiceList list = env.load();
        CHECK(list.services.size() == 3);
        CHECK(list.find("standin") == nullptr);
        REQUIRE(list.issues.size() == 1);
        CHECK(list.issues[0].reason == "badVersion");
        CHECK_FALSE(list.issues[0].index.has_value());
    }
    SECTION("optional members of the wrong type are badField per member and the entry is kept") {
        Layered env;
        env.put_user("user-bad-fields.json");
        const ai::ServiceList list = env.load();
        REQUIRE(list.find("bad-fields") != nullptr);
        const ai::ServiceEntry& entry = *list.find("bad-fields");
        CHECK(entry.tools);  // the default
        CHECK_FALSE(entry.terms_url.has_value());
        CHECK(entry.limits.en == "one request per second");
        CHECK(entry.limits.ru == "one request per second");  // the bad ru falls back to en
        CHECK(entry.limits.uk == "one request per second");
        CHECK_FALSE(entry.context_length.has_value());
        std::vector<std::string> fields;
        for (const auto& issue : list.issues) {
            CHECK(issue.reason == "badField");
            CHECK(issue.index == 0);
            fields.push_back(issue.field.value_or("-"));
        }
        CHECK(fields ==
              std::vector<std::string>{"tools", "termsUrl", "limits.ru", "contextLength"});
    }
    SECTION("the bundled layer ignores key and hidden with badField {field}") {
        Layered env;
        const ai::ServiceList list =
            ai::ServiceList::load(fixture("bundled-with-key-and-hidden.json"), env.layer());
        REQUIRE(list.services.size() == 1);
        CHECK(list.services[0].id == "bundled-keyed-hidden");
        CHECK_FALSE(list.services[0].has_key());
        CHECK_FALSE(list.services[0].hidden);
        CHECK(list.hidden.empty());
        std::vector<std::string> fields;
        for (const auto& issue : list.issues) {
            CHECK(issue.reason == "badField");
            CHECK(issue.index == 0);
            // The issue names the file in the loader's normalised spelling (the fixture root
            // is spelled with forward slashes on Windows).
            CHECK(issue.file == fixture("bundled-with-key-and-hidden.json").lexically_normal());
            fields.push_back(issue.field.value_or("-"));
        }
        CHECK(fields == std::vector<std::string>{"hidden", "key"});
    }
    SECTION(
        "file-level shapes: not an object, services missing, a non-object entry, badId, "
        "badAddress") {
        Layered env;
        const fs::path file = env.data / "ai-services.json";
        test::write_text(file, "[1, 2]");
        CHECK(issues_json(env.load()) ==
              std::vector<json>{
                  json{{"file", platform::utf8_from_path(file)}, {"reason", "notObject"}}});
        test::write_text(file, R"({"version": 1})");
        CHECK(issues_json(env.load()) ==
              std::vector<json>{json{{"file", platform::utf8_from_path(file)},
                                     {"reason", "missingField"},
                                     {"field", "services"}}});
        test::write_text(file, R"({"version": "1", "services": []})");
        CHECK(env.load().issues[0].reason == "badVersion");
        test::write_text(file, R"({"version": 1, "services": [7,
            {"id": "Bad Id", "name": "x", "address": "http://127.0.0.1/v1", "model": "m"},
            {"id": "a:b", "name": "x", "address": "http://127.0.0.1/v1", "model": "m"},
            {"id": "noaddr", "name": "x", "address": "127.0.0.1/v1", "model": "m"},
            {"id": "query", "name": "x", "address": "http://127.0.0.1/v1?x=1", "model": "m"},
            {"id": "noname", "name": "   ", "address": "http://127.0.0.1/v1", "model": "m"},
            {"id": "ok", "name": "Fine", "address": "http://127.0.0.1/v1/", "model": "m"}]})");
        const ai::ServiceList list = env.load();
        std::vector<std::string> reasons;
        std::vector<int> indices;
        for (const auto& issue : list.issues) {
            reasons.push_back(issue.reason);
            indices.push_back(issue.index.value_or(-1));
        }
        CHECK(reasons == std::vector<std::string>{"notObject", "badId", "badId", "badAddress",
                                                  "badAddress", "missingField"});
        CHECK(indices == std::vector<int>{0, 1, 2, 3, 4, 5});
        CHECK(list.issues[5].field == "name");
        REQUIRE(list.find("ok") != nullptr);
        CHECK(list.find("ok")->base == "http://127.0.0.1/v1");
        // A BOM is accepted and skipped.
        test::write_text(file, std::string("\xEF\xBB\xBF") + R"({"version": 1, "services": []})");
        CHECK(env.load().issues.empty());
    }
    SECTION("a directory in the user file's place is unreadable; the bundled list is used") {
        Layered env;
        fs::create_directories(env.data / "ai-services.json");
        const ai::ServiceList list = env.load();
        CHECK(list.services.size() == 3);
        REQUIRE(list.issues.size() == 1);
        CHECK(list.issues[0].reason == "unreadable");  // never invalidJson: the kind is checked
        CHECK(list.issues[0].file == env.data / "ai-services.json");
        CHECK_FALSE(list.issues[0].index.has_value());
        CHECK(list.files.user_exists);
        // The same rule for the bundled path: a folder there is unreadable on every platform.
        fs::create_directories(env.tmp.path() / "bundled-folder");
        const ai::ServiceList both =
            ai::ServiceList::load(env.tmp.path() / "bundled-folder", env.layer());
        CHECK(both.services.empty());
        REQUIRE(both.issues.size() == 2);
        CHECK(both.issues[0].reason == "unreadable");
        CHECK(both.issues[0].file == env.tmp.path() / "bundled-folder");
        CHECK(both.issues[1].reason == "unreadable");
        CHECK(both.issues[1].file == env.data / "ai-services.json");
    }
    SECTION("the files and the issues are named in one normalised spelling") {
        Layered env;
        env.put_user("user-truncated.json");
        // The caller's spelling: a `.` segment in the bundled path, a `..` one in the user path.
        ai::UserLayer layer = env.layer();
        layer.user = env.data / ".." / "data" / "ai-services.json";
        const ai::ServiceList list =
            ai::ServiceList::load(bundled_file().parent_path() / "." / "ai-services.json", layer);
        CHECK(list.files.bundled == bundled_file());
        CHECK(list.files.user == env.data / "ai-services.json");
        CHECK(list.files.user_exists);
        CHECK(list.services.size() == 3);
        REQUIRE(list.issues.size() == 1);
        CHECK(list.issues[0].reason == "invalidJson");
        CHECK(list.issues[0].file == env.data / "ai-services.json");
        const json j = list.to_json();
        CHECK(j["files"]["bundled"] == platform::utf8_from_path(bundled_file()));
        CHECK(j["files"]["user"] == platform::utf8_from_path(env.data / "ai-services.json"));
        CHECK(j["issues"][0]["file"] == platform::utf8_from_path(env.data / "ai-services.json"));
    }
    SECTION("an unusable bundled file gives the user layer alone") {
        Layered env;
        env.put_user("user-added-no-tools.json");
        const ai::ServiceList list =
            ai::ServiceList::load(env.tmp.path() / "missing-bundled.json", env.layer());
        CHECK(ids(list) == std::vector<std::string>{"my-local"});
        CHECK_FALSE(list.services[0].replaced);
        REQUIRE(list.issues.size() == 1);
        CHECK(list.issues[0].reason == "unreadable");
        CHECK(list.issues[0].file == env.tmp.path() / "missing-bundled.json");
    }
    SECTION("every issue is logged once as aiServices.<reason> with path, index and field only") {
        Layered env;
        const fs::path logs = env.tmp.path() / "logs";
        log::init(logs);
        env.put_user("user-bad-fields.json");
        const ai::ServiceList list = env.load();
        log::shutdown();
        const std::vector<json> entries = log_entries(logs);
        REQUIRE(entries.size() == list.issues.size());
        for (std::size_t i = 0; i < entries.size(); ++i) {
            INFO(entries[i].dump());
            CHECK(entries[i]["level"] == "warning");
            CHECK(entries[i]["code"] == "aiServices.badField");
            CHECK(entries[i]["context"]["path"] ==
                  platform::utf8_from_path(env.data / "ai-services.json"));
            CHECK(entries[i]["context"]["index"] == "0");
            CHECK(entries[i]["context"]["field"] == list.issues[i].field);
        }
        const std::string text = test::read_text(logs / "mfbe-errors.log");
        CHECK(text.find("one request per second") == std::string::npos);  // never a value
        CHECK(text.find("8787") == std::string::npos);
    }
}

TEST_CASE("ai.services: hasKey is reported and the key never leaves the loader", "[ai][services]") {
    Layered env;
    const fs::path logs = env.tmp.path() / "logs";
    log::init(logs);
    env.put_user("user-with-key.json");
    const ai::ServiceList list = env.load();
    log::shutdown();
    REQUIRE(list.find("keyed") != nullptr);
    const ai::ServiceEntry& keyed = *list.find("keyed");
    CHECK(keyed.key_required);
    CHECK(keyed.has_key());
    CHECK(keyed.key == "sk-user");  // the request builder's member
    const json j = list.to_json();
    CHECK(j.dump().find("sk-user") == std::string::npos);
    const json& view = j["services"].back();
    CHECK(view["id"] == "keyed");
    CHECK(view["hasKey"] == true);
    CHECK(view["keyRequired"] == true);
    CHECK_FALSE(view.contains("key"));
    CHECK(log_entries(logs).empty());
}

TEST_CASE("ai.services: the portable layer is chosen only when <Data> has no file",
          "[ai][services]") {
    Layered env;
    env.put_portable("user-added-no-tools.json");
    const ai::ServiceList portable = env.load();
    CHECK(ids(portable) ==
          std::vector<std::string>{"ovhcloud", "pollinations", "llm7", "my-local"});
    CHECK(portable.services.back().source == ai::Layer::portable);
    CHECK(portable.files.portable == env.portable_dir / "ai-services.json");
    CHECK_FALSE(portable.files.user_exists);
    CHECK(portable.to_json()["files"]["portable"] ==
          platform::utf8_from_path(env.portable_dir / "ai-services.json"));
    CHECK(portable.to_json()["services"].back()["source"] == "portable");

    // The data file wins whole: the portable entries stop being in effect and the result says
    // which file is.
    env.put_user("user-hidden-pollinations.json");
    const ai::ServiceList data = env.load();
    CHECK(ids(data) == std::vector<std::string>{"ovhcloud", "llm7"});
    CHECK(data.files.user_exists);
    CHECK_FALSE(data.files.portable.has_value());
    CHECK_FALSE(data.to_json()["files"].contains("portable"));

    // UserLayer::of: the data folder's file and the read-only portable file; a writable
    // portable folder is `data` itself and adds no layer.
    platform::Dirs dirs;
    dirs.data = env.data;
    CHECK(ai::UserLayer::of(dirs).user == env.data / "ai-services.json");
    CHECK_FALSE(ai::UserLayer::of(dirs).portable.has_value());
    dirs.portable = env.portable_dir;
    CHECK(ai::UserLayer::of(dirs).portable == env.portable_dir / "ai-services.json");
    dirs.portable = env.data;
    CHECK_FALSE(ai::UserLayer::of(dirs).portable.has_value());
}

TEST_CASE(
    "ai.createUserServices: copies the bundled file once, never overwrites; the bundled "
    "file's bytes never change (FR-011)",
    "[ai][services]") {
    Layered env;
    const std::string bundled_before = test::read_text(bundled_file());
    REQUIRE_FALSE(bundled_before.empty());
    const fs::path user = env.data / "ai-services.json";

    // Loading changes nothing in the bundled file.
    (void)env.load();
    CHECK(test::read_text(bundled_file()) == bundled_before);

    // The first copy creates the folder and the file byte for byte.
    REQUIRE_FALSE(fs::exists(env.data));
    const ai::UserCopy first = ai::create_user_copy(bundled_file(), user);
    CHECK(first.created);
    CHECK(first.path == user);
    CHECK(test::read_text(user) == bundled_before);
    // After it every entry comes from the user's file and replaces the bundled one.
    const ai::ServiceList copied = env.load();
    CHECK(copied.issues.empty());
    CHECK(copied.files.user_exists);
    CHECK(ids(copied) == std::vector<std::string>{"ovhcloud", "pollinations", "llm7"});
    for (const auto& entry : copied.services) {
        CHECK(entry.source == ai::Layer::user);
        CHECK(entry.replaced);
    }
    CHECK(test::read_text(bundled_file()) == bundled_before);

    // A second press writes nothing - the user's edits survive.
    test::write_text(user, R"({"version": 1, "services": []})");
    const ai::UserCopy second = ai::create_user_copy(bundled_file(), user);
    CHECK_FALSE(second.created);
    CHECK(second.path == user);
    CHECK(test::read_text(user) == R"({"version": 1, "services": []})");
    CHECK(test::read_text(bundled_file()) == bundled_before);

    // A user layer that replaces every entry leaves the bundled file alone too.
    test::write_text(user, R"({"version": 1, "services": [
        {"id": "ovhcloud", "name": "A", "address": "http://127.0.0.1:1/v1", "model": "m"},
        {"id": "pollinations", "name": "B", "address": "http://127.0.0.1:2/v1", "model": "m"},
        {"id": "llm7", "name": "C", "address": "http://127.0.0.1:3/v1", "model": "m"}]})");
    const ai::ServiceList replaced = env.load();
    CHECK(replaced.services.size() == 3);
    for (const auto& entry : replaced.services) {
        CHECK(entry.replaced);
        CHECK(entry.local);
    }
    CHECK(test::read_text(bundled_file()) == bundled_before);

    // An unreadable bundled file makes the copy fail with the writer's error (1002 upstream).
    fs::remove(user);
    CHECK_THROWS_AS(ai::create_user_copy(env.tmp.path() / "absent.json", user),
                    atomic_file::WriteError);
    CHECK_FALSE(fs::exists(user));
}
