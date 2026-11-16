// Feature 016 (contracts/page-model.md; tasks T010): what mfbe-pdf-reader writes for the generated
// fixtures, 014's format fixtures and the reference book as 0.0.11 exported it.
#include "pdf/import/reader_process.hpp"

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>

using namespace std::chrono_literals;
using mfbe::pdf_import::ReaderEnd;
using mfbe::pdf_import::ReaderOptions;
using mfbe::pdf_import::ReaderProcess;
using nlohmann::json;

namespace {

const std::filesystem::path kFixtures = std::filesystem::path(MFBE_TEST_FIXTURES_DIR) / "pdf";

struct Read {
    std::filesystem::path folder;
    std::vector<json> events;
    std::unique_ptr<ReaderProcess> reader;

    json document() const { return json::parse(std::ifstream(folder / "document.json")); }
    json page(int n) const {
        return json::parse(std::ifstream(folder / ("page-" + std::to_string(n) + ".json")));
    }

    /// Asks for a picture and returns its event.
    json picture(const std::string& id, int page) {
        reader->send_line(json{{"picture", id}, {"page", page}}.dump());
        std::string line;
        while (reader->next_event(line, 10s)) {
            json e = json::parse(line);
            if (e.value("id", "") == id) {
                return e;
            }
        }
        return {};
    }
};

Read read(const std::filesystem::path& pdf, const std::vector<std::string>& passwords = {}) {
    Read r;
    r.folder =
        std::filesystem::temp_directory_path() / ("mfbe-reader-model-" + pdf.stem().string());
    std::filesystem::remove_all(r.folder);
    std::filesystem::create_directories(r.folder);
    ReaderOptions o;
    o.reader = mfbe::pdf_import::find_reader();
    o.pdf = pdf;
    o.folder = r.folder;
    std::string error;
    r.reader = ReaderProcess::start(o, error);
    REQUIRE(r.reader);
    std::size_t next_password = 0;
    std::string line;
    while (r.reader->next_event(line, 30s)) {
        json e = json::parse(line);
        r.events.push_back(e);
        const std::string event = e.value("event", "");
        if (event == "needs-password" || event == "wrong-password" || event == "owner-password") {
            r.reader->send_line(next_password < passwords.size() ? passwords[next_password++] : "");
        }
        if (event == "done" || event == "failed") {
            break;
        }
    }
    return r;
}

std::string all_words(const json& page) {
    std::string out;
    for (const auto& w : page["words"]) {
        out += w["t"].get<std::string>() + " ";
    }
    return out;
}

}  // namespace

TEST_CASE("the reader gives a text PDF's words, fonts, links, bookmarks and information",
          "[pdf][import]") {
    Read r = read(kFixtures / "import" / "text-untagged.pdf");
    REQUIRE(r.events.back()["event"] == "done");
    const json doc = r.document();
    CHECK(doc["pages"] == 2);
    CHECK(doc["metadata"]["info"]["Title"] == "The Generated Book");
    CHECK(doc["metadata"]["info"]["Author"] == "Ann Example");
    REQUIRE(doc["outline"].size() == 2);
    CHECK(doc["outline"][1]["title"] == "Chapter Two");
    CHECK(doc["outline"][1]["page"] == 2);
    const json p1 = r.page(1);
    CHECK(all_words(p1).find("harbour") != std::string::npos);
    REQUIRE(p1["links"].size() == 1);
    CHECK(p1["links"][0]["uri"] == "https://example.org/");
    bool bold = false;
    for (const auto& f : p1["fonts"]) {
        bold = bold || (f["bold"] == true ||
                        f["name"].get<std::string>().find("Bold") != std::string::npos);
    }
    CHECK(bold);
    REQUIRE(p1["pictures"].size() == 1);
    CHECK(p1["pictures"][0]["jpeg"] == true);
}

TEST_CASE("the reader passes a JPEG on byte for byte and converts JBIG2, JPEG 2000 and CCITT",
          "[pdf][import]") {
    Read r = read(kFixtures / "import" / "text-untagged.pdf");
    const std::string id = r.page(1)["pictures"][0]["id"];
    const json e = r.picture(id, 1);
    REQUIRE(e["event"] == "picture");
    CHECK(e["contentType"] == "image/jpeg");
    for (const char* name : {"jbig2", "jpx", "ccitt"}) {
        Read f = read(kFixtures / (std::string(name) + ".pdf"));
        const std::string pid = f.page(1)["pictures"][0]["id"];
        const json pe = f.picture(pid, 1);
        INFO(name);
        REQUIRE(pe["event"] == "picture");
        CHECK(std::filesystem::file_size(f.folder / pe["file"].get<std::string>()) > 0);
    }
}

TEST_CASE("the reader keeps soft hyphens and the invisible text of a scan", "[pdf][import]") {
    Read r = read(kFixtures / "import" / "scan-invisible.pdf");
    REQUIRE(r.events.back()["event"] == "done");
    const std::string words = all_words(r.page(2));
    CHECK(words.find("harbour") != std::string::npos);
    CHECK(words.find("hyphen\xC2\xAD") != std::string::npos);
}

TEST_CASE("the reader gives a tagged PDF's structure and the marked content outside it",
          "[pdf][import]") {
    Read r = read(kFixtures / "import" / "tagged.pdf");
    const json doc = r.document();
    REQUIRE(doc.contains("structure"));
    const std::string dump = doc["structure"].dump();
    for (const char* text : {"Heading One", "First item", "Cell one"}) {
        CHECK(dump.find(text) != std::string::npos);
    }
    CHECK(dump.find("\"alt\":\"A figure\"") != std::string::npos);
    CHECK(doc["orphans"].dump().find("strong") != std::string::npos);
}

TEST_CASE("the reader gives the editor's record of its own PDF", "[pdf][import]") {
    Read r = read(kFixtures / "import" / "reference-0.0.11-a5.pdf");
    const json doc = r.document();
    REQUIRE(doc.contains("record"));
    CHECK(doc["record"]["version"] == 1);
    CHECK_FALSE(doc["record"]["hints"].get<std::string>().empty());
    CHECK_FALSE(doc["record"]["description"].get<std::string>().empty());
}

TEST_CASE("the reader opens protected PDFs with the passwords it is given", "[pdf][import]") {
    Read user = read(kFixtures / "import" / "password-user.pdf", {"wrong", "secret"});
    CHECK(user.events.back()["event"] == "done");
    CHECK(user.events[1]["event"] == "wrong-password");
    Read cancelled = read(kFixtures / "import" / "password-user.pdf", {});
    CHECK(cancelled.events.back()["reason"] == "passwordCancelled");
    Read owner = read(kFixtures / "import" / "copy-restricted.pdf", {"owner"});
    CHECK(owner.events.back()["event"] == "done");
    Read refused = read(kFixtures / "import" / "copy-restricted.pdf", {});
    CHECK(refused.events.back()["reason"] == "copyForbidden");
}

TEST_CASE("the reader gives form fields and counts what the import drops", "[pdf][import]") {
    Read forms = read(kFixtures / "import" / "forms.pdf");
    const json doc = forms.document();
    REQUIRE(doc["forms"].size() == 2);
    CHECK(doc["forms"][1]["value"] == "Harbourtown");
    Read hostile = read(kFixtures / "import" / "hostile" / "deep-outline-scripts.pdf");
    const json hd = hostile.document();
    CHECK(hd["dropped"]["attachments"] == 1);
}
