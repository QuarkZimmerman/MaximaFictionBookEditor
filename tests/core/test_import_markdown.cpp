// Feature 010 (US8, T055): the Markdown import's core side - the text judge (DP-15) and the
// methods import.readMarkdown, template.xml and doc.newFromXml (rpc-api).
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/encodings.hpp>
#include <mfbe/text_encoding.hpp>

#include <catch2/catch_test_macros.hpp>
#include <string>

using namespace mfbe;
using json = nlohmann::json;

namespace {

const std::string kPangram =
    "\xD0\xA1\xD1\x8A\xD0\xB5\xD1\x88\xD1\x8C \xD0\xB6\xD0\xB5 \xD0\xB5\xD1\x89\xD1\x91 "
    "\xD1\x8D\xD1\x82\xD0\xB8\xD1\x85 \xD0\xBC\xD1\x8F\xD0\xB3\xD0\xBA\xD0\xB8\xD1\x85 "
    "\xD1\x84\xD1\x80\xD0\xB0\xD0\xBD\xD1\x86\xD1\x83\xD0\xB7\xD1\x81\xD0\xBA\xD0\xB8\xD1\x85 "
    "\xD0\xB1\xD1\x83\xD0\xBB\xD0\xBE\xD0\xBA \xD0\xB4\xD0\xB0 \xD0\xB2\xD1\x8B\xD0\xBF\xD0\xB5"
    "\xD0\xB9 \xD1\x87\xD0\xB0\xD1\x8E. \xD0\x9F\xD1\x80\xD0\xB8\xD0\xB2\xD0\xB5\xD1\x82, "
    "\xD0\xBC\xD0\xB8\xD1\x80!";

// "# Глава\n\n" + the pangram: a Markdown file with a Russian heading and paragraph.
std::string markdown_text() {
    return "# \xD0\x93\xD0\xBB\xD0\xB0\xD0\xB2\xD0\xB0\n\n" + kPangram + "\n";
}

// UTF-8 Cyrillic (U+0400-U+045F) to CP866, byte by byte; ASCII stays.
std::string to_cp866(const std::string& utf8) {
    std::string out;
    for (std::size_t i = 0; i < utf8.size(); ++i) {
        const auto c = static_cast<unsigned char>(utf8[i]);
        if (c < 0x80) {
            out.push_back(static_cast<char>(c));
            continue;
        }
        const auto c2 = static_cast<unsigned char>(utf8[++i]);
        const unsigned cp = ((c & 0x1Fu) << 6) | (c2 & 0x3Fu);
        if (cp >= 0x410 && cp <= 0x42F) {
            out.push_back(static_cast<char>(0x80 + (cp - 0x410)));  // А-Я
        } else if (cp >= 0x430 && cp <= 0x43F) {
            out.push_back(static_cast<char>(0xA0 + (cp - 0x430)));  // а-п
        } else if (cp >= 0x440 && cp <= 0x44F) {
            out.push_back(static_cast<char>(0xE0 + (cp - 0x440)));  // р-я
        } else if (cp == 0x451) {
            out.push_back(static_cast<char>(0xF1));  // ё
        } else {
            out.push_back('?');
        }
    }
    return out;
}

}  // namespace

TEST_CASE("text judge: UTF-8, the byte-order marks and the legacy encodings of a Russian text",
          "[import][markdown]") {
    const std::string text = markdown_text();

    const text::TextReading utf8 = text::read_text(text);
    CHECK(utf8.decided);
    CHECK(utf8.encoding == "utf-8");
    CHECK(utf8.source == "utf8");
    CHECK(utf8.utf8 == text);

    const text::TextReading bom = text::read_text("\xEF\xBB\xBF" + text);
    CHECK(bom.decided);
    CHECK(bom.source == "bom");
    CHECK(bom.utf8 == text);

    // "utf-16" writes little endian with a byte-order mark.
    const std::string utf16 = encoding::encode_from_utf8(text, "utf-16").bytes;
    const text::TextReading wide = text::read_text(utf16);
    CHECK(wide.decided);
    CHECK(wide.source == "bom");
    CHECK(wide.utf8 == text);
    CHECK_FALSE(text::looks_binary(utf16));  // NUL bytes, but a byte-order mark: text

    struct Case {
        const char* encoding;
        std::string bytes;
    };
    for (const Case& c :
         {Case{"windows-1251", encoding::encode_from_utf8(text, "windows-1251").bytes},
          Case{"koi8-r", encoding::encode_from_utf8(text, "koi8-r").bytes},
          Case{"cp866", to_cp866(text)}}) {
        INFO(c.encoding);
        const text::TextReading judged = text::read_text(c.bytes);
        CHECK(judged.decided);
        CHECK(judged.source == "judged");
        CHECK(judged.encoding == c.encoding);
        CHECK(judged.utf8 == text);
        REQUIRE(text::decode_text(c.bytes, c.encoding).has_value());
        CHECK(*text::decode_text(c.bytes, c.encoding) == text);
    }

    // "caf\xE9": windows-1252 and ISO-8859-2 both read "café" - no clear lead, so it asks.
    const text::TextReading unsure = text::read_text("A caf\xE9 in town.\n");
    CHECK_FALSE(unsure.decided);
    REQUIRE(unsure.candidates.size() >= 2);
    CHECK(unsure.candidates[0] == "windows-1252");
    CHECK(unsure.candidates[1] == "iso-8859-2");

    CHECK(text::looks_binary(std::string("\x89PNG\r\n\x1A\n\0\0\0\x0DIHDR", 16)));
    CHECK_FALSE(text::looks_binary(text));
    CHECK_FALSE(text::decode_text("abc", "no-such-encoding").has_value());
}

TEST_CASE("import.readMarkdown, template.xml and doc.newFromXml over RPC (feature 010)",
          "[import][markdown][server]") {
    test::TempDir data{"mfbe-import-markdown"};
    CoreServerOptions options;
    options.data_dir = data.path().string();
    options.test_hooks = true;
    auto server = CoreServer::start(options);
    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    // A windows-1251 file is judged and converted without a question.
    const auto cp1251 = data / "book-1251.md";
    test::write_text(cp1251, encoding::encode_from_utf8(markdown_text(), "windows-1251").bytes);
    const json judged = ws.call("import.readMarkdown", json{{"path", cp1251.string()}});
    REQUIRE(judged.contains("result"));
    CHECK(judged["result"]["encoding"] == "windows-1251");
    CHECK(judged["result"]["encodingSource"] == "judged");
    CHECK(judged["result"]["text"] == markdown_text());

    // The user's choice is honoured as given.
    const json chosen =
        ws.call("import.readMarkdown", json{{"path", cp1251.string()}, {"encoding", "koi8-r"}});
    REQUIRE(chosen.contains("result"));
    CHECK(chosen["result"]["encodingSource"] == "chosen");

    // Unsure: the candidates to ask about.
    const auto unsure = data / "unsure.md";
    test::write_text(unsure, "A caf\xE9 in town.\n");
    const json asked = ws.call("import.readMarkdown", json{{"path", unsure.string()}});
    REQUIRE(asked.contains("result"));
    CHECK(asked["result"]["needsEncoding"]["candidates"].size() >= 2);

    // A missing file and a binary file are refused.
    const json missing =
        ws.call("import.readMarkdown", json{{"path", (data / "nothing.md").string()}});
    REQUIRE(missing.contains("error"));
    CHECK(missing["error"]["code"] == 1002);
    const auto binary = data / "picture.md";
    test::write_text(binary, std::string("\x89PNG\r\n\x1A\n\0\0\0\x0DIHDR", 16));
    const json refused = ws.call("import.readMarkdown", json{{"path", binary.string()}});
    REQUIRE(refused.contains("error"));
    CHECK(refused["error"]["code"] == 1100);

    // The template's FB2 text, then a new untitled document from it.
    const json tmpl = ws.call("template.xml", json::object());
    REQUIRE(tmpl.contains("result"));
    const std::string xml = tmpl["result"]["xml"];
    CHECK(xml.find("<FictionBook") != std::string::npos);
    const json created = ws.call("doc.newFromXml", json{{"xml", xml}});
    REQUIRE(created.contains("result"));
    const json& document = created["result"]["document"];
    CHECK_FALSE(document["docId"].get<std::string>().empty());
    CHECK_FALSE(document.contains("path"));
    CHECK(document["bodies"].size() >= 1);

    // Text that is no FictionBook makes no document.
    const json wrong = ws.call("doc.newFromXml", json{{"xml", "<html><body/></html>"}});
    REQUIRE(wrong.contains("error"));
}

TEST_CASE("text judge on the committed Markdown fixtures (feature 010, T052)",
          "[import][markdown]") {
    const auto dir = test::fixtures_dir() / "markdown";
    const std::string utf8 = test::read_text(dir / "russian-utf8.md");
    struct Case {
        const char* file;
        const char* encoding;
        const char* source;
    };
    for (const Case& c : {Case{"russian-utf8.md", "utf-8", "utf8"},
                          Case{"russian-windows-1251.md", "windows-1251", "judged"},
                          Case{"russian-koi8-r.md", "koi8-r", "judged"},
                          Case{"russian-cp866.md", "cp866", "judged"},
                          Case{"russian-utf16.md", "utf-16le", "bom"}}) {
        INFO(c.file);
        const text::TextReading reading = text::read_text(test::read_text(dir / c.file));
        CHECK(reading.decided);
        CHECK(reading.encoding == c.encoding);
        CHECK(reading.source == c.source);
        CHECK(reading.utf8 == utf8);
    }
}
