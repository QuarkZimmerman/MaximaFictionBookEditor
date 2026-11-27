// Feature 022 (T015): FBD ZIP Package RPC create/addFiles/removeEntry/save/close tests.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/images.hpp>
#include <mfbe/utf8_paths.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>
#include <string>

using namespace mfbe;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {

struct PackageRpcFixture {
    test::TempDir data{"mfbe-pkg-rpc"};
    CoreServerOptions options;
    std::unique_ptr<CoreServer> server;
    test::WsClient ws;

    PackageRpcFixture() {
        options.data_dir = platform::utf8_from_path(data.path());
        options.test_hooks = true;
        server = CoreServer::start(options);
        REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);
    }

    json call(const std::string& method, const json& params = json::object()) {
        return ws.call(method, params, 20000);
    }

    json run_job(const std::string& method, const json& params = json::object()) {
        const json resp = call(method, params);
        if (resp.contains("error")) {
            return resp;
        }
        REQUIRE(resp.contains("result"));
        if (!resp["result"].contains("jobId")) {
            return resp;
        }
        const std::string job_id = resp["result"]["jobId"].get<std::string>();
        for (;;) {
            const auto note = ws.wait_notification("job.done", 20000);
            REQUIRE(note.has_value());
            if ((*note)["params"]["jobId"] == job_id) {
                return (*note)["params"];
            }
        }
    }
};

fs::path write_file(const fs::path& p, const std::string& bytes) {
    fs::create_directories(p.parent_path());
    std::ofstream out(p, std::ios::binary | std::ios::trunc);
    REQUIRE(out.good());
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    out.close();
    return p;
}

std::string make_valid_png_bytes() {
    images::Bitmap bmp;
    bmp.width = 4;
    bmp.height = 4;
    bmp.has_alpha = false;
    bmp.rgba.assign(4 * 4 * 4, 200);
    return images::encode_png(bmp);
}

void make_valid_title_info(json& doc, const std::string& title) {
    doc["description"]["titleInfo"]["genres"] = json::array({json{{"code", "sf"}}});
    doc["description"]["titleInfo"]["authors"] =
        json::array({json{{"firstName", "Jane"}, {"lastName", "Doe"}}});
    doc["description"]["titleInfo"]["bookTitle"] = title;
    doc["description"]["titleInfo"]["lang"] = "en";
}

}  // namespace

TEST_CASE("package RPC: create, addFiles (partial accept/reject), cover sync, save, second save, close",
          "[package][rpc]") {
    PackageRpcFixture f;
    test::TempDir work("mfbe-pkg-work");

    // Create sample files including Cyrillic UTF-8 filename and uppercase extension.
    const std::string pdf_bytes = "%PDF-1.7\nFirst sample book binary payload 1234567890.\n";
    const std::string txt_bytes = "Second book plain text content.\nLine 2.\n";
    const fs::path pdf_path = write_file(work.path() / platform::path_from_utf8("Книга Один.PDF"),
                                         pdf_bytes);
    const fs::path txt_path = write_file(work.path() / "Second Book.TXT", txt_bytes);
    const fs::path fb2_path = write_file(work.path() / "bad.fb2", "<FictionBook/>");
    const fs::path dup_path = write_file(work.path() / "second book.rtf", "{\\rtf1 hi}");
    const fs::path cover_path = write_file(work.path() / "my_cover.png", make_valid_png_bytes());

    const json created = f.call("package.create");
    REQUIRE(created.contains("result"));
    const std::string pkg_id = created["result"]["packageId"].get<std::string>();
    CHECK(created["result"]["path"].is_null());
    CHECK(created["result"]["entries"].empty());

    // Saving an empty package fails cleanly with kPackageSaveFailed (1124 / emptyPackage).
    const fs::path out_zip = work.path() / "output-package.zip";
    const json empty_save = f.call(
        "package.save",
        json{{"packageId", pkg_id}, {"path", platform::utf8_from_path(out_zip)}, {"entries", json::array()}});
    REQUIRE(empty_save.contains("error"));
    CHECK(empty_save["error"]["code"] == 1124);
    CHECK(empty_save["error"]["data"]["reason"] == "emptyPackage");

    // Batch add: 2 accepted, 2 rejected (forbiddenFb2 + duplicateStem).
    const json added = f.call("package.addFiles",
                              json{{"packageId", pkg_id},
                                   {"paths", json::array({platform::utf8_from_path(pdf_path),
                                                          platform::utf8_from_path(txt_path),
                                                          platform::utf8_from_path(fb2_path),
                                                          platform::utf8_from_path(dup_path)})}});
    REQUIRE(added.contains("result"));
    REQUIRE(added["result"]["added"].size() == 2);
    REQUIRE(added["result"]["rejected"].size() == 2);

    const json& e0 = added["result"]["added"][0];
    const json& e1 = added["result"]["added"][1];
    CHECK(e0["fileName"] == "Книга Один.pdf");
    CHECK(e0["stem"] == "Книга Один");
    CHECK(e0["extension"] == "pdf");
    CHECK(e0["size"] == pdf_bytes.size());
    CHECK(e1["fileName"] == "Second Book.txt");

    CHECK(added["result"]["rejected"][0]["reason"] == "forbiddenFb2");
    CHECK(added["result"]["rejected"][1]["reason"] == "duplicateStem");
    CHECK(added["result"]["rejected"][1]["conflictWith"] == "Second Book.txt");

    // Add a PNG cover to entry 0 using binary.add.
    const std::string doc0_id = e0["docId"].get<std::string>();
    const json bin_res =
        f.call("binary.add", json{{"docId", doc0_id},
                                  {"path", platform::utf8_from_path(cover_path)},
                                  {"suggestedId", "cover.png"},
                                  {"imagesOnly", true},
                                  {"convertNow", true}});
    REQUIRE(bin_res.contains("result"));
    CHECK(bin_res["result"]["id"] == "cover.png");
    CHECK(bin_res["result"]["contentType"] == "image/png");

    // First save with empty descriptions triggers validation confirmation (writes nothing to disk).
    json doc0 = e0["document"];
    json doc1 = e1["document"];
    const json unconfirmed = f.run_job(
        "package.save",
        json{{"packageId", pkg_id},
             {"path", platform::utf8_from_path(out_zip)},
             {"entries", json::array({json{{"entryId", e0["entryId"]}, {"document", doc0}},
                                      json{{"entryId", e1["entryId"]}, {"document", doc1}}})}});
    REQUIRE(unconfirmed.contains("result"));
    CHECK(unconfirmed["result"]["needsConfirmation"] == true);
    CHECK(unconfirmed["result"]["totalErrorCount"].get<int>() > 0);
    CHECK_FALSE(fs::exists(out_zip));

    // Populate valid FB2 2.1 metadata + cover on entry 0, valid metadata on entry 1, and save.
    make_valid_title_info(doc0, "Книга Один");
    doc0["description"]["titleInfo"]["coverpage"] = json::array({json{{"href", "#cover.png"}}});
    make_valid_title_info(doc1, "Second Book");

    const json saved = f.run_job(
        "package.save",
        json{{"packageId", pkg_id},
             {"path", platform::utf8_from_path(out_zip)},
             {"entries", json::array({json{{"entryId", e0["entryId"]}, {"document", doc0}},
                                      json{{"entryId", e1["entryId"]}, {"document", doc1}}})}});
    REQUIRE(saved.contains("result"));
    INFO("entryValidations: " << saved["result"]["entryValidations"].dump());
    CHECK(saved["result"]["needsConfirmation"] == false);
    CHECK(saved["result"]["totalErrorCount"] == 0);
    REQUIRE(fs::exists(out_zip));

    // Inspect resulting ZIP: 4 exact root entries, byte-identical payloads, valid UTF-8 FB2 2.1 FBDs.
    const archive::Listing listing = archive::list(out_zip);
    REQUIRE(listing.entries.size() == 4);
    CHECK(archive::read_entry(out_zip, "Книга Один.pdf") == pdf_bytes);
    CHECK(archive::read_entry(out_zip, "Second Book.txt") == txt_bytes);

    const std::string fbd0_bytes = archive::read_entry(out_zip, "Книга Один.fbd");
    BinaryStore verify_store;
    model::NodeIdAllocator verify_ids;
    const fb2::ReadResult parsed0 = fb2::read_bytes(fbd0_bytes, verify_store, verify_ids);
    CHECK(parsed0.document.description.titleInfo.bookTitle == "Книга Один");
    REQUIRE(parsed0.document.description.titleInfo.coverpage.size() == 1);
    CHECK(parsed0.document.description.titleInfo.coverpage[0].href == "#cover.png");
    CHECK(verify_store.ids() == std::vector<std::string>{"cover.png"});
    CHECK(parsed0.document.stylesheets.empty());
    REQUIRE(parsed0.document.bodies.size() == 1);

    // Delete original disk source files, remove entry 1, edit entry 0, and perform second in-place save.
    // Because entry 0 transitioned to sourceKind == zipEntry on save, saving still succeeds!
    fs::remove(pdf_path);
    fs::remove(txt_path);

    const json removed = f.call("package.removeEntry",
                                json{{"packageId", pkg_id}, {"entryId", e1["entryId"]}});
    REQUIRE(removed.contains("result"));

    doc0["description"]["titleInfo"]["bookTitle"] = "Книга Один (Updated)";
    const json saved2 = f.run_job(
        "package.save",
        json{{"packageId", pkg_id},
             {"path", platform::utf8_from_path(out_zip)},
             {"entries", json::array({json{{"entryId", e0["entryId"]}, {"document", doc0}}})}});
    REQUIRE(saved2.contains("result"));
    CHECK(saved2["result"]["totalErrorCount"] == 0);

    const archive::Listing listing2 = archive::list(out_zip);
    REQUIRE(listing2.entries.size() == 2);
    CHECK(archive::read_entry(out_zip, "Книга Один.pdf") == pdf_bytes);
    const std::string fbd0_updated = archive::read_entry(out_zip, "Книга Один.fbd");
    CHECK(fbd0_updated.find("Книга Один (Updated)") != std::string::npos);

    // Saved package appears in Recent Files.
    const json recent = f.call("doc.recent");
    REQUIRE(recent.contains("result"));
    REQUIRE_FALSE(recent["result"].empty());
    CHECK(recent["result"][0]["path"] == platform::utf8_from_path(out_zip.lexically_normal()));

    // Closing the package releases all entry docIds and is idempotent.
    REQUIRE(f.call("package.close", json{{"packageId", pkg_id}}).contains("result"));
    REQUIRE(f.call("package.close", json{{"packageId", pkg_id}}).contains("result"));
    const json closed_doc = f.call("binary.list", json{{"docId", doc0_id}});
    REQUIRE(closed_doc.contains("error"));
}
