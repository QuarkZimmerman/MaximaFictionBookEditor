// Template of new documents (feature 002 FR-004, FR-006, FR-008) - resource-formats §2a: the
// bundled template is the original's, a user blank.fb2 found first in the Settings folder,
// <Data> or the portable folder replaces it, an unusable one gives way to the bundled one.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/templates.hpp>
#include <mfbe/version.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <filesystem>
#include <memory>
#include <string>

using namespace mfbe;
using Catch::Matchers::ContainsSubstring;
using nlohmann::json;

namespace {

std::filesystem::path resources_root() {
    return std::filesystem::path(MFBE_RESOURCES_SOURCE_DIR);
}

// The original editor's blank.fb2 (windows-1251) in UTF-8: the same elements, values and texts,
// tabs and no final newline; only the XML declaration's encoding differs.
const std::string kOriginalBlank = R"FB2(<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
	<description>
		<title-info>
			<genre match="100"/>
			<author>
				<first-name/>
				<middle-name/>
				<last-name/>
			</author>
			<book-title/>
			<annotation>
				<p>Введите сюда краткую аннотацию</p>
			</annotation>
			<date/>
			<coverpage>
				<image l:href=""/>
			</coverpage>
			<lang>ru</lang>
		</title-info>
		<document-info>
			<author>
				<first-name>Your</first-name>
				<last-name>Name</last-name>
			</author>
			<program-used/>
			<date value=""/>
			<src-ocr/>
			<id/>
			<version/>
			<history>
				<p>1.0 — создание файла</p>
			</history>
		</document-info>
		<publish-info>
			<book-name/>
			<publisher/>
			<city/>
			<year/>
			<isbn/>
		</publish-info>
	</description>
	<body>
		<section>
			<p>Чтобы изменить документ по умолчанию, отредактируйте файл &quot;blank.fb2&quot; вручную.</p>
			<empty-line/>
		</section>
	</body>
</FictionBook>)FB2";

const std::string kUserTemplate =
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
    "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
    "xmlns:l=\"http://www.w3.org/1999/xlink\"><description><title-info><genre>sf</genre>"
    "<book-title>User template</book-title><annotation><p>My annotation.</p></annotation>"
    "<lang>en</lang></title-info><document-info><id/><version/></document-info>"
    "</description><body><section><p>From the user.</p></section></body></FictionBook>";

struct Layers {
    test::TempDir tmp{"mfbe-template"};
    resources::ResourceLayers layers{roots()};
    std::filesystem::path settings = tmp / "custom";

    resources::Roots roots() const {
        resources::Roots r;
        r.user_data = tmp / "data";
        r.portable = tmp / "portable";
        r.bundled_resources = resources_root();
        return r;
    }
};

}  // namespace

TEST_CASE("template: the bundled template is the original's blank document in UTF-8",
          "[template]") {
    CHECK(test::read_text(resources_root() / resources::kTemplateFileName) == kOriginalBlank);
}

TEST_CASE("template: Settings folder, then <Data>, then the portable folder, then bundled",
          "[template]") {
    Layers f;
    const auto resolve = [&f](const std::filesystem::path& settings) {
        return resources::resolve_template(f.layers, settings);
    };
    resources::EffectiveTemplate t = resolve(f.settings);
    CHECK(t.layer == resources::LayerName::bundled);
    CHECK(t.path == resources_root() / "blank.fb2");
    CHECK_FALSE(t.issue);
    // A file copied in is found at once (no restart).
    test::write_text(f.tmp / "portable" / "blank.fb2", kUserTemplate);
    CHECK(resolve(f.settings).layer == resources::LayerName::portable);
    test::write_text(f.tmp / "data" / "blank.fb2", kUserTemplate);
    CHECK(resolve(f.settings).layer == resources::LayerName::user);
    test::write_text(f.settings / "blank.fb2", kUserTemplate);
    t = resolve(f.settings);
    CHECK(t.layer == resources::LayerName::settings);
    CHECK(t.path == f.settings / "blank.fb2");
    CHECK(resolve({}).layer == resources::LayerName::user);
    CHECK(resources::template_folder(f.layers, f.settings) == f.settings);
    CHECK(resources::template_folder(f.layers, {}) == f.tmp / "data");
    CHECK(resources::to_json(t) ==
          json{{"path", (f.settings / "blank.fb2").string()}, {"layer", "settings"}});
}

TEST_CASE("template: an unusable user file gives way to the bundled one, with the reason",
          "[template]") {
    const std::vector<std::pair<std::string, std::string>> cases = {
        {"", "empty"},
        {"  \n\t", "empty"},
        {"<FictionBook><body></FictionBook>", "notWellFormed"},
        {"<?xml version=\"1.0\"?><html><body/></html>", "notFictionBook"},
    };
    for (const auto& [text, reason] : cases) {
        Layers f;
        // The first file found decides, even when a later layer holds a good one.
        test::write_text(f.tmp / "portable" / "blank.fb2", kUserTemplate);
        test::write_text(f.tmp / "data" / "blank.fb2", text);
        const resources::EffectiveTemplate t = resources::resolve_template(f.layers, f.settings);
        CHECK(t.layer == resources::LayerName::bundled);
        CHECK(t.path == resources_root() / "blank.fb2");
        REQUIRE(t.issue);
        CHECK(t.issue->path == f.tmp / "data" / "blank.fb2");
        CHECK(t.issue->reason == reason);
        CHECK(resources::to_json(t)["issue"]["reason"] == reason);
    }
}

TEST_CASE("template: doc.new uses the user template as written and reports a rejected one",
          "[template][server]") {
    test::TempDir data{"mfbe-template-server"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    const std::unique_ptr<CoreServer> server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    // The bundled template, with the document details filled in.
    json doc = ws.call("doc.new")["result"];
    CHECK(doc["description"]["titleInfo"]["lang"] == "ru");
    CHECK(doc["filledIn"] == json{"documentInfo.id", "documentInfo.version",
                                  "documentInfo.programUsed", "documentInfo.date.text",
                                  "documentInfo.date.value"});
    CHECK_FALSE(doc.contains("templateIssue"));
    CHECK(ws.call("resources.template")["result"]["layer"] == "bundled");

    // A user template in <Data>: used as written (language, annotation, texts).
    test::write_text(data / "blank.fb2", kUserTemplate);
    CHECK(ws.call("resources.template")["result"] ==
          json{{"path", (data / "blank.fb2").string()}, {"layer", "user"}});
    doc = ws.call("doc.new")["result"];
    CHECK(doc["description"]["titleInfo"]["lang"] == "en");
    CHECK(doc["description"]["titleInfo"]["bookTitle"] == "User template");
    CHECK(doc.dump().find("My annotation.") != std::string::npos);
    CHECK(doc.dump().find("From the user.") != std::string::npos);
    CHECK(doc["description"]["documentInfo"]["version"] == "1.0");
    CHECK(doc["description"]["documentInfo"]["programUsed"] ==
          std::string(version::kProductName) + " " + version::kVersion);

    // A damaged one: the bundled template, and the file and reason reported.
    test::write_text(data / "blank.fb2", "<FictionBook>");
    doc = ws.call("doc.new")["result"];
    CHECK(doc["description"]["titleInfo"]["lang"] == "ru");
    REQUIRE(doc.contains("templateIssue"));
    CHECK(doc["templateIssue"]["path"] == (data / "blank.fb2").string());
    CHECK(doc["templateIssue"]["reason"] == "notWellFormed");
    CHECK_THAT(ws.call("resources.template")["result"]["issue"]["reason"].get<std::string>(),
               ContainsSubstring("notWellFormed"));
}
