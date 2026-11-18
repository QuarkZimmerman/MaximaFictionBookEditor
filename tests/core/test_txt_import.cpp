// Feature 017 (T033, T051; D23 to D26, D31, D36, DP-9, DP-10): the TXT import's session - a text file
// or an archive's TXT read with its encoding judged or asked, the refusals, and the session's end.

#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/single_byte.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>

using nlohmann::json;
using namespace mfbe;

namespace {

struct Fixture {
    test::TempDir data{"mfbe-txt-import"};
    test::TempDir files{"mfbe-txt-import-files"};
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    Fixture() {
        CoreServerOptions options;
        options.data_dir = platform::utf8_from_path(data.path());
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    std::filesystem::path write(const std::string& name, const std::string& bytes) {
        const auto file = files.path() / name;
        std::ofstream(file, std::ios::binary) << bytes;
        return file;
    }

    json begin(const std::filesystem::path& file, const std::string& entry = "") {
        json params{{"path", platform::utf8_from_path(file)}};
        if (!entry.empty()) params["entry"] = entry;
        return ws.call("txtImport.begin", params);
    }

    json read(const std::filesystem::path& file, const std::string& encoding = "") {
        const json begun = begin(file);
        REQUIRE(begun.contains("result"));
        json params{{"token", begun["result"]["token"]}};
        if (!encoding.empty()) params["encoding"] = encoding;
        json answer = ws.call("txtImport.read", params);
        ws.call("txtImport.end", json{{"token", begun["result"]["token"]}});
        return answer;
    }
};

const std::string kRussian =
    "\xD0\x9C\xD0\xB0\xD1\x88\xD0\xB0\x20\xD0\xB6\xD0\xB8\xD0\xBB\xD0\xB0\x20\xD0\xB2\x20\xD0\x9C\xD0"
    "\xBE\xD1\x81\xD0\xBA\xD0\xB2\xD0\xB5\x2E\x20\xD0\x92\x20\xD1\x87\xD0\xB5\xD1\x82\xD0\xB2\xD0\xB5"
    "\xD1\x80\xD0\xB3\x2C\x20\xD0\xB2\x20\xD1\x87\xD0\xB5\xD1\x82\xD1\x8B\xD1\x80\xD0\xB5\x20\xD1\x87"
    "\xD0\xB0\xD1\x81\xD0\xB0\x20\xD0\xB2\xD0\xB5\xD1\x87\xD0\xB5\xD1\x80\xD0\xB0\x2C\x20\xD0\x9C\xD0"
    "\xB0\xD1\x88\xD0\xB0\x20\xD1\x88\xD0\xBB\xD0\xB0\x20\xD0\xB4\xD0\xBE\xD0\xBC\xD0\xBE\xD0\xB9\x20"
    "\xD0\xBF\xD0\xBE\x20\xD1\x82\xD0\xB8\xD1\x85\xD0\xBE\xD0\xB9\x20\xD1\x83\xD0\xBB\xD0\xB8\xD1\x86"
    "\xD0\xB5\x2E\x20\xD0\x9F\xD0\xB5\xD1\x82\xD1\x8F\x20\xD0\xB6\xD0\xB4\xD0\xB0\xD0\xBB\x20\xD0\xB5"
    "\xD1\x91\x20\xD1\x83\x20\xD0\xB4\xD0\xBE\xD0\xBC\xD0\xB0\x2E\x20\xD0\x9E\xD0\xBD\xD0\xB8\x20\xD0"
    "\xBF\xD0\xBE\xD1\x88\xD0\xBB\xD0\xB8\x20\xD0\xB2\x20\xD0\xBF\xD0\xB0\xD1\x80\xD0\xBA\x2C\x20\xD0"
    "\xB3\xD0\xB4\xD0\xB5\x20\xD0\xB8\xD0\xB3\xD1\x80\xD0\xB0\xD0\xBB\xD0\xB8\x20\xD0\xB4\xD0\xB5\xD1"
    "\x82\xD0\xB8\x2E\x20\xD0\x92\xD0\xB5\xD1\x87\xD0\xB5\xD1\x80\xD0\xBE\xD0\xBC\x20\xD0\x9C\xD0\xB0"
    "\xD1\x88\xD0\xB0\x20\xD1\x87\xD0\xB8\xD1\x82\xD0\xB0\xD0\xBB\xD0\xB0\x20\xD0\xBA\xD0\xBD\xD0\xB8"
    "\xD0\xB3\xD1\x83\x2E\x0A";  // "Маша жила в Москве. В четверг, в четыре часа вечера, Маша шла домой по тихой улице. Петя ждал её у дома. Они пошли в парк, где играли дети. Вечером Маша читала книгу."

}  // namespace

TEST_CASE("txtImport reads UTF-8, a byte-order mark and judged single-byte encodings", "[txt][import][rpc]") {
    Fixture f;
    const json utf8 = f.read(f.write("utf8.txt", kRussian));
    CHECK(utf8["result"]["text"] == kRussian);
    CHECK(utf8["result"]["source"] == "utf8");
    const json bom = f.read(f.write("bom.txt", "\xEF\xBB\xBF" + kRussian));
    CHECK(bom["result"]["source"] == "bom");
    for (const std::string encoding : {"windows-1251", "koi8-r", "ibm866"}) {
        INFO(encoding);
        const auto bytes = text::encode_single_byte(kRussian, encoding)->bytes;
        const json judged = f.read(f.write(encoding + ".txt", bytes + bytes + bytes));
        REQUIRE(judged.contains("result"));
        if (judged["result"].contains("needsEncoding")) {
            FAIL("asked for " << encoding << ": " << judged["result"].dump());
        }
        CHECK(judged["result"]["source"] == "judged");
        CHECK(judged["result"]["text"] == kRussian + kRussian + kRussian);
    }
    // An encoding chosen by the user reads as chosen.
    const auto koi = text::encode_single_byte(kRussian, "koi8-u")->bytes;
    const json chosen = f.read(f.write("chosen.txt", koi), "koi8-u");
    CHECK(chosen["result"]["source"] == "chosen");
    CHECK(chosen["result"]["text"] == kRussian);
}

TEST_CASE("txtImport refuses binary, empty, too large and FictionBook files (D26, D36)", "[txt][import][rpc]") {
    Fixture f;
    const auto reason = [&](const json& answer) {
        REQUIRE(answer.contains("error"));
        CHECK(answer["error"]["code"] == 1115);
        return answer["error"]["data"]["reason"].get<std::string>();
    };
    CHECK(reason(f.read(f.write("nul.txt", std::string("a\0b\0c", 5)))) == "binary");
    CHECK(reason(f.read(f.write("empty.txt", ""))) == "empty");
    CHECK(reason(f.read(f.write("blank.txt", " \n\t\n"))) == "empty");
    CHECK(reason(f.read(f.write("book.txt", "<?xml version=\"1.0\"?>\n<FictionBook xmlns=\"x\"/>"))) ==
          "fictionBook");
    const auto large = f.files.path() / "large.txt";
    {
        std::ofstream out(large, std::ios::binary);
        out.seekp(128LL * 1024 * 1024);
        out.put('x');
    }
    CHECK(reason(f.read(large)) == "tooLarge");
    CHECK(f.ws.call("txtImport.read", json{{"token", "nope"}})["error"]["code"] == 1116);
}

TEST_CASE("txtImport lists an archive's TXT and FBD files and reads the one chosen (D31, D32)",
          "[txt][import][rpc]") {
    Fixture f;
    const auto zip = f.files.path() / "books.zip";
    {
        std::ofstream out(zip, std::ios::binary);
        out << archive::zip_entries({{"one.txt", kRussian, false, false},
                                     {"two.TXT", "Second\n", false, false},
                                     {"one.fbd", "<FictionBook/>", false, false}});
    }
    const json listed = f.begin(zip);
    REQUIRE(listed["result"].contains("archive"));
    CHECK(listed["result"]["archive"]["txts"].size() == 2);
    CHECK(listed["result"]["archive"]["fbds"].size() == 1);
    const json begun = f.begin(zip, "one.txt");
    const std::string token = begun["result"]["token"];
    CHECK(f.ws.call("txtImport.read", json{{"token", token}})["result"]["text"] == kRussian);
    const json fbd = f.ws.call("txtImport.extractFbd", json{{"token", token}, {"entry", "one.fbd"}});
    const auto fbd_path = platform::path_from_utf8(fbd["result"]["path"].get<std::string>());
    CHECK(std::filesystem::exists(fbd_path));
    f.ws.call("txtImport.end", json{{"token", token}});
    CHECK_FALSE(std::filesystem::exists(fbd_path));
    // An archive without a TXT is refused.
    const auto none = f.files.path() / "none.zip";
    {
        std::ofstream out(none, std::ios::binary);
        out << archive::zip_entries({{"one.fbd", "<FictionBook/>", false, false}});
    }
    const json refused = f.begin(none);
    REQUIRE(refused.contains("error"));
    CHECK(refused["error"]["data"]["reason"] == "noTxtInArchive");
}
