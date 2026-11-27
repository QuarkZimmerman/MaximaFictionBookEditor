// Feature 022 (T015): FBD ZIP Package RPC create/addFiles/removeEntry/save/close tests.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/core_server.hpp>
#include <mfbe/fb2_reader.hpp>
#include <mfbe/fbd_package.hpp>
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
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(20);
        while (std::chrono::steady_clock::now() < deadline) {
            for (std::size_t i = 0; i < ws.inbox.size(); ++i) {
                const std::string m = ws.inbox[i].value("method", "");
                if ((m == "job.done" || m == "job.failed") &&
                    ws.inbox[i]["params"]["jobId"] == job_id) {
                    json params_out = ws.inbox[i]["params"];
                    ws.inbox.erase(ws.inbox.begin() + static_cast<std::ptrdiff_t>(i));
                    return params_out;
                }
            }
            const auto msg = ws.receive_json(5000);
            REQUIRE(msg.has_value());
            const std::string m = msg->value("method", "");
            if ((m == "job.done" || m == "job.failed") && (*msg)["params"]["jobId"] == job_id) {
                return (*msg)["params"];
            }
            ws.inbox.push_back(*msg);
        }
        FAIL("timed out waiting for job " << job_id);
        return json::object();
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

TEST_CASE("package RPC US2: doc.open detection routing and package.open round-trip, body-less FBD, and refusals",
          "[package][rpc]") {
    PackageRpcFixture f;
    test::TempDir work("mfbe-pkg-rpc-us2");

    auto make_zip = [](const fs::path& p,
                       const std::vector<std::pair<std::string, std::string>>& items) {
        package::PackageZipWritePlan plan;
        plan.targetZipPath = p;
        for (const auto& [name, data] : items) {
            package::PackageZipWriteEntry e;
            e.entryName = name;
            e.isMemory = true;
            e.memoryBytes = data;
            e.compressDeflate = true;
            plan.managedEntries.push_back(std::move(e));
        }
        package::write_package_zip_atomic(plan);
    };

    const std::string bodyless_fbd =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\">\n"
        "  <description>\n"
        "    <title-info>\n"
        "      <genre>sf</genre>\n"
        "      <author><first-name>Stanislaw</first-name><last-name>Lem</last-name></author>\n"
        "      <book-title>Solaris</book-title>\n"
        "      <lang>en</lang>\n"
        "    </title-info>\n"
        "    <document-info>\n"
        "      <author><first-name>A</first-name><last-name>B</last-name></author>\n"
        "      <date value=\"2026-11-27\">2026-11-27</date>\n"
        "      <id>SOLARIS-1</id>\n"
        "      <version>1.0</version>\n"
        "    </document-info>\n"
        "  </description>\n"
        "</FictionBook>\n";

    // 1. Valid FBD ZIP package with subfolder + body-less FBD + unpaired second book.
    const fs::path pkg_zip = work.path() / "solaris-pack.zip";
    make_zip(pkg_zip, {
                          {"extra/notes.txt", "Keep me!"},
                          {"Solaris.PDF", "%PDF-1.7 solaris payload"},
                          {"Solaris.fbd", bodyless_fbd},
                          {"Bonus.txt", "Unpaired text book"},
                      });

    // doc.open detects FBD ZIP package and returns {packageDetected: true, path}.
    const json detect = f.call("doc.open", json{{"path", platform::utf8_from_path(pkg_zip)}});
    REQUIRE(detect.contains("result"));
    CHECK(detect["result"]["packageDetected"] == true);
    CHECK(detect["result"]["path"] == platform::utf8_from_path(pkg_zip.lexically_normal()));

    // files.inspect marks isFbdPackage: true and does not claim onlyBook.
    const json inspected = f.call("files.inspect", json{{"path", platform::utf8_from_path(pkg_zip)}});
    REQUIRE(inspected.contains("result"));
    CHECK(inspected["result"]["isFbdPackage"] == true);
    CHECK_FALSE(inspected["result"].contains("onlyBook"));

    // package.open loads both entries, normalizes body-less FBD, tracks 1 preserved entry.
    const json opened = f.run_job("package.open", json{{"path", platform::utf8_from_path(pkg_zip)}});
    REQUIRE(opened.contains("result"));
    const std::string pkg_id = opened["result"]["packageId"].get<std::string>();
    CHECK(opened["result"]["preservedEntryCount"] == 1);
    REQUIRE(opened["result"]["entries"].size() == 2);
    CHECK(opened["result"]["entries"][0]["fileName"] == "Solaris.pdf");
    CHECK(opened["result"]["entries"][0]["hadFbd"] == true);
    CHECK(opened["result"]["entries"][0]["document"]["description"]["titleInfo"]["bookTitle"] ==
          "Solaris");
    CHECK(opened["result"]["entries"][1]["fileName"] == "Bonus.txt");
    CHECK(opened["result"]["entries"][1]["hadFbd"] == false);

    // Edit and save in place -> subfolder survives intact!
    json doc0 = opened["result"]["entries"][0]["document"];
    json doc1 = opened["result"]["entries"][1]["document"];
    doc0["description"]["titleInfo"]["bookTitle"] = "Solaris (Edited)";
    make_valid_title_info(doc1, "Bonus Story");
    const json resaved = f.run_job(
        "package.save",
        json{{"packageId", pkg_id},
             {"path", platform::utf8_from_path(pkg_zip)},
             {"entries",
              json::array({json{{"entryId", opened["result"]["entries"][0]["entryId"]},
                                {"document", doc0}},
                           json{{"entryId", opened["result"]["entries"][1]["entryId"]},
                                {"document", doc1}}})}});
    REQUIRE(resaved.contains("result"));
    CHECK(resaved["result"]["totalErrorCount"] == 0);
    CHECK(archive::read_entry(pkg_zip, "extra/notes.txt") == "Keep me!");
    CHECK(archive::read_entry(pkg_zip, "Solaris.pdf") == "%PDF-1.7 solaris payload");
    CHECK(archive::read_entry(pkg_zip, "Solaris.fbd").find("Solaris (Edited)") != std::string::npos);

    // Save As to a new path writes a clean package (omitting extra/notes.txt).
    const fs::path clean_zip = work.path() / "solaris-clean.zip";
    const json saved_as = f.run_job(
        "package.save",
        json{{"packageId", pkg_id},
             {"path", platform::utf8_from_path(clean_zip)},
             {"entries",
              json::array({json{{"entryId", opened["result"]["entries"][0]["entryId"]},
                                {"document", doc0}},
                           json{{"entryId", opened["result"]["entries"][1]["entryId"]},
                                {"document", doc1}}})}});
    REQUIRE(saved_as.contains("result"));
    CHECK(archive::list(clean_zip).entries.size() == 4);
    REQUIRE(f.call("package.close", json{{"packageId", pkg_id}}).contains("result"));

    // 2. Standalone .fbd in ZIP stays FB2 mode (NOT packageDetected).
    const fs::path standalone_fbd_zip = work.path() / "standalone-fbd.zip";
    make_zip(standalone_fbd_zip, {{"only.fbd", bodyless_fbd}});
    const json alone_open =
        f.call("doc.open", json{{"path", platform::utf8_from_path(standalone_fbd_zip)}});
    REQUIRE(alone_open.contains("result"));
    CHECK_FALSE(alone_open["result"].contains("packageDetected"));
    REQUIRE(alone_open["result"].contains("document"));
    f.call("doc.close", json{{"docId", alone_open["result"]["document"]["docId"]}});

    // 3. Plain ZIP with zero .fbd -> doc.open throws 1081, package.open throws 1123 (noFbd).
    const fs::path no_fbd_zip = work.path() / "no-fbd.zip";
    make_zip(no_fbd_zip, {{"doc.pdf", "%PDF-1.7"}});
    const json doc_no_fbd = f.call("doc.open", json{{"path", platform::utf8_from_path(no_fbd_zip)}});
    REQUIRE(doc_no_fbd.contains("error"));
    CHECK(doc_no_fbd["error"]["code"] == 1081);
    const json pkg_no_fbd =
        f.run_job("package.open", json{{"path", platform::utf8_from_path(no_fbd_zip)}});
    REQUIRE(pkg_no_fbd.contains("error"));
    CHECK(pkg_no_fbd["error"]["code"] == 1123);
    CHECK(pkg_no_fbd["error"]["data"]["reason"] == "noFbd");

    // 4. Damaged XML in .fbd -> package.open throws 1123 (fbdParseError).
    const fs::path bad_fbd_zip = work.path() / "bad-fbd.zip";
    make_zip(bad_fbd_zip, {{"book.pdf", "%PDF-1.7"}, {"book.fbd", "<FictionBook><broken"}});
    const json pkg_bad_fbd =
        f.run_job("package.open", json{{"path", platform::utf8_from_path(bad_fbd_zip)}});
    REQUIRE(pkg_bad_fbd.contains("error"));
    CHECK(pkg_bad_fbd["error"]["code"] == 1123);
    CHECK(pkg_bad_fbd["error"]["data"]["reason"] == "fbdParseError");

    // 5. Duplicate root stems -> package.open throws 1123 (duplicateStem).
    const fs::path dup_zip = work.path() / "dup-root.zip";
    make_zip(dup_zip, {{"Same.pdf", "%PDF-1.7"}, {"same.txt", "txt"}, {"Same.fbd", bodyless_fbd}});
    const json pkg_dup = f.run_job("package.open", json{{"path", platform::utf8_from_path(dup_zip)}});
    REQUIRE(pkg_dup.contains("error"));
    CHECK(pkg_dup["error"]["code"] == 1123);
    CHECK(pkg_dup["error"]["data"]["reason"] == "duplicateStem");
}

TEST_CASE("Settings.other.startupMode default, persistence, validation, and sanitization",
          "[package][rpc][settings]") {
    test::TempDir shared_data{"mfbe-pkg-startup-mode"};
    const std::string data_dir_utf8 = platform::utf8_from_path(shared_data.path());

    // 1. Default is "fb2", invalid value rejected with 1040, valid "package" persisted.
    {
        CoreServerOptions opts;
        opts.data_dir = data_dir_utf8;
        opts.test_hooks = true;
        auto srv = CoreServer::start(opts);
        test::WsClient ws;
        REQUIRE(ws.open(srv->port(), "/rpc?token=" + srv->token()) == 101);

        const json got = ws.call("settings.get", json::object(), 10000);
        REQUIRE(got.contains("result"));
        CHECK(got["result"]["other"]["startupMode"] == "fb2");

        const json bad =
            ws.call("settings.set", json{{"patch", {{"other", {{"startupMode", "invalid"}}}}}}, 10000);
        REQUIRE(bad.contains("error"));
        CHECK(bad["error"]["code"] == 1040);

        const json set_pkg =
            ws.call("settings.set", json{{"patch", {{"other", {{"startupMode", "package"}}}}}}, 10000);
        REQUIRE(set_pkg.contains("result"));
        CHECK(set_pkg["result"]["settings"]["other"]["startupMode"] == "package");
    }

    // 2. Restarting against the same data_dir preserves "package".
    {
        CoreServerOptions opts;
        opts.data_dir = data_dir_utf8;
        opts.test_hooks = true;
        auto srv = CoreServer::start(opts);
        test::WsClient ws;
        REQUIRE(ws.open(srv->port(), "/rpc?token=" + srv->token()) == 101);

        const json got = ws.call("settings.get", json::object(), 10000);
        REQUIRE(got.contains("result"));
        CHECK(got["result"]["other"]["startupMode"] == "package");
    }

    // 3. Corrupt value on disk is sanitized back to default "fb2" on load.
    const fs::path settings_file = shared_data.path() / "settings.json";
    {
        std::ifstream in(settings_file, std::ios::binary);
        REQUIRE(in.good());
        json disk = json::parse(in);
        disk["other"]["startupMode"] = "corrupted_mode";
        in.close();
        write_file(settings_file, disk.dump(2));
    }
    {
        CoreServerOptions opts;
        opts.data_dir = data_dir_utf8;
        opts.test_hooks = true;
        auto srv = CoreServer::start(opts);
        test::WsClient ws;
        REQUIRE(ws.open(srv->port(), "/rpc?token=" + srv->token()) == 101);

        const json got = ws.call("settings.get", json::object(), 10000);
        REQUIRE(got.contains("result"));
        CHECK(got["result"]["other"]["startupMode"] == "fb2");
    }
}
