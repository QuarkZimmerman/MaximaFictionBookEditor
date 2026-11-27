// Feature 022 (T015): FBD ZIP Package RPC create/addFiles/removeEntry/save/close tests.
#include "mobi/mobi_writer.hpp"
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

TEST_CASE("doc.readDescription reads .fb2/.fbd from single-entry and multi-entry ZIPs",
          "[package][rpc][transfer]") {
    PackageRpcFixture f;
    test::TempDir work{"mfbe-read-desc-zip"};

    auto make_zip = [&](const fs::path& p,
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

    const auto make_fb2 = [](const std::string& title) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
               "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\">\n"
               "  <description>\n"
               "    <title-info>\n"
               "      <genre>sf</genre>\n"
               "      <author><first-name>Arthur</first-name><last-name>Clarke</last-name></author>\n"
               "      <book-title>" +
               title +
               "</book-title>\n"
               "      <lang>en</lang>\n"
               "    </title-info>\n"
               "    <document-info>\n"
               "      <author><first-name>A</first-name><last-name>B</last-name></author>\n"
               "      <date value=\"2026-11-27\">2026-11-27</date>\n"
               "      <id>ID-" +
               title +
               "</id>\n"
               "      <version>1.0</version>\n"
               "    </document-info>\n"
               "  </description>\n"
               "  <body><section><p>Text</p></section></body>\n"
               "</FictionBook>\n";
    };

    const json target_doc = f.call("doc.new");
    REQUIRE(target_doc.contains("result"));
    const std::string target_id = target_doc["result"]["docId"].get<std::string>();

    // 1. Single-entry FB2 ZIP auto-loads without needsChoice.
    const fs::path single_fb2_zip = work.path() / "single-fb2.zip";
    make_zip(single_fb2_zip, {{"rama.fb2", make_fb2("Rendezvous with Rama")}});
    const json r1 = f.call(
        "doc.readDescription",
        json{{"docId", target_id}, {"path", platform::utf8_from_path(single_fb2_zip)}});
    REQUIRE(r1.contains("result"));
    CHECK_FALSE(r1["result"].contains("needsChoice"));
    CHECK(r1["result"]["description"]["titleInfo"]["bookTitle"] == "Rendezvous with Rama");
    f.call("doc.close", json{{"docId", r1["result"]["importId"]}});

    // 2. Single-entry FBD inside an FBD ZIP package auto-loads (NOT routed to packageDetected).
    const fs::path fbd_pkg_zip = work.path() / "fbd-package.zip";
    make_zip(fbd_pkg_zip,
             {{"childhood.pdf", "%PDF-1.7 payload"}, {"childhood.fbd", make_fb2("Childhood")}});
    const json r2 =
        f.call("doc.readDescription",
               json{{"docId", target_id}, {"path", platform::utf8_from_path(fbd_pkg_zip)}});
    REQUIRE(r2.contains("result"));
    CHECK_FALSE(r2["result"].contains("needsChoice"));
    CHECK_FALSE(r2["result"].contains("packageDetected"));
    CHECK(r2["result"]["description"]["titleInfo"]["bookTitle"] == "Childhood");
    f.call("doc.close", json{{"docId", r2["result"]["importId"]}});

    // 3. Multi-entry ZIP (fb2 + fbd) returns needsChoice; specifying entry loads that entry.
    const fs::path multi_zip = work.path() / "multi-books.zip";
    make_zip(multi_zip,
             {{"alpha.fb2", make_fb2("Alpha Book")}, {"beta.fbd", make_fb2("Beta Descriptor")}});
    const json r3 = f.call("doc.readDescription",
                           json{{"docId", target_id}, {"path", platform::utf8_from_path(multi_zip)}});
    REQUIRE(r3.contains("result"));
    REQUIRE(r3["result"].contains("needsChoice"));
    CHECK(r3["result"]["needsChoice"]["booksTotal"] == 2);

    const json r3_beta = f.call("doc.readDescription",
                                json{{"docId", target_id},
                                     {"path", platform::utf8_from_path(multi_zip)},
                                     {"entry", "beta.fbd"}});
    REQUIRE(r3_beta.contains("result"));
    CHECK(r3_beta["result"]["description"]["titleInfo"]["bookTitle"] == "Beta Descriptor");
    f.call("doc.close", json{{"docId", r3_beta["result"]["importId"]}});

    // 4. ZIP with zero .fb2/.fbd files returns kArchiveNoBook (1081).
    const fs::path empty_zip = work.path() / "no-books.zip";
    make_zip(empty_zip, {{"notes.pdf", "%PDF-1.7"}});
    const json r4 = f.call("doc.readDescription",
                           json{{"docId", target_id}, {"path", platform::utf8_from_path(empty_zip)}});
    REQUIRE(r4.contains("error"));
    CHECK(r4["error"]["code"] == 1081);

    f.call("doc.close", json{{"docId", target_id}});
}

TEST_CASE("package.addFiles automatically extracts/generates covers for PDF, EPUB, and MOBI "
          "respecting Settings.package auto-cover toggles",
          "[package][rpc][cover]") {
    PackageRpcFixture f;
    test::TempDir work{"mfbe-pkg-auto-cover"};

    // Verify default package auto-cover settings are all true.
    const json initial_settings = f.call("settings.get");
    REQUIRE(initial_settings.contains("result"));
    CHECK(initial_settings["result"]["package"]["autoCoverPdf"] == true);
    CHECK(initial_settings["result"]["package"]["autoCoverEpub"] == true);
    CHECK(initial_settings["result"]["package"]["autoCoverMobi"] == true);

    // Helper: create a tiny valid 4x6 JPEG bytes buffer.
    images::Bitmap bmp;
    bmp.width = 4;
    bmp.height = 6;
    bmp.rgba.assign(static_cast<std::size_t>(4 * 6 * 4), 200);
    const std::string sample_jpeg = images::encode_jpeg(bmp, 85);
    const std::string sample_png = images::encode_png(bmp);

    auto make_zip = [&](const fs::path& p,
                        const std::vector<std::pair<std::string, std::string>>& items) {
        package::PackageZipWritePlan plan;
        plan.targetZipPath = p;
        for (const auto& [name, data] : items) {
            package::PackageZipWriteEntry e;
            e.entryName = name;
            e.isMemory = true;
            e.memoryBytes = data;
            e.compressDeflate = (name != "mimetype");
            plan.managedEntries.push_back(std::move(e));
        }
        package::write_package_zip_atomic(plan);
    };

    // 1. Build EPUB 3 (properties="cover-image") and EPUB 2 (<meta name="cover">) fixtures.
    const fs::path epub3_path = work.path() / "book-epub3.epub";
    make_zip(
        epub3_path,
        {
            {"mimetype", "application/epub+zip"},
            {"META-INF/container.xml",
             "<?xml version=\"1.0\"?><container version=\"1.0\" "
             "xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">"
             "<rootfiles><rootfile full-path=\"OEBPS/content.opf\" "
             "media-type=\"application/oebps-package+xml\"/></rootfiles></container>"},
            {"OEBPS/content.opf",
             "<?xml version=\"1.0\"?><package version=\"3.0\" "
             "xmlns=\"http://www.idpf.org/2007/opf\"><metadata/><manifest>"
             "<item id=\"c\" href=\"images/front.png\" media-type=\"image/png\" "
             "properties=\"cover-image\"/></manifest><spine/></package>"},
            {"OEBPS/images/front.png", sample_png},
        });

    const fs::path epub2_path = work.path() / "book-epub2.epub";
    make_zip(
        epub2_path,
        {
            {"mimetype", "application/epub+zip"},
            {"META-INF/container.xml",
             "<?xml version=\"1.0\"?><container version=\"1.0\" "
             "xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">"
             "<rootfiles><rootfile full-path=\"content.opf\" "
             "media-type=\"application/oebps-package+xml\"/></rootfiles></container>"},
            {"content.opf",
             "<?xml version=\"1.0\"?><package version=\"2.0\" "
             "xmlns=\"http://www.idpf.org/2007/opf\"><metadata>"
             "<meta name=\"cover\" content=\"cover-img\"/></metadata><manifest>"
             "<item id=\"cover-img\" href=\"front.jpg\" media-type=\"image/jpeg\"/>"
             "</manifest><spine/></package>"},
            {"front.jpg", sample_jpeg},
        });

    // 2. Build a real MOBI (joint MOBI 7 + KF8) with an embedded cover via MobiWriter.
    const fs::path mobi_path = work.path() / "book-cover.mobi";
    {
        mobi::MobiWriter writer(mobi_path, mobi::MobiExportFormat::joint);
        images::ConversionPolicy policy;
        (void)writer.add_picture(sample_jpeg, policy, /*is_cover=*/true);
        writer.set_mobi7_html("<html><body><p>Hello MOBI</p></body></html>");
        writer.set_kf8_html(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>Hello KF8</p></body></html>");
        mobi::MobiCommitInput commit;
        commit.metadata.title = "MOBI Cover Book";
        commit.metadata.language = "en";
        (void)writer.commit(commit);
    }

    // 3. Real PDF fixture + copy-restricted PDF + password-protected PDF + plain TXT.
    const fs::path pdf_path = test::fixtures_dir() / "pdf" / "import" / "tagged.pdf";
    const fs::path copy_restricted_pdf =
        test::fixtures_dir() / "pdf" / "ocr" / "copy-restricted-scan.pdf";
    const fs::path encrypted_pdf = test::fixtures_dir() / "pdf" / "import" / "password-user.pdf";
    const fs::path txt_path = work.path() / "plain.txt";
    write_file(txt_path, "Plain text book without automatic cover");

    const json created = f.call("package.create");
    REQUIRE(created.contains("result"));
    const std::string pkg_id = created["result"]["packageId"].get<std::string>();

    // Add PDF, copy-restricted PDF, encrypted PDF, EPUB 3, EPUB 2, MOBI, and TXT with all enabled.
    const json added = f.call(
        "package.addFiles",
        json{{"packageId", pkg_id},
             {"paths",
              json::array({platform::utf8_from_path(pdf_path),
                           platform::utf8_from_path(copy_restricted_pdf),
                           platform::utf8_from_path(encrypted_pdf),
                           platform::utf8_from_path(epub3_path),
                           platform::utf8_from_path(epub2_path),
                           platform::utf8_from_path(mobi_path),
                           platform::utf8_from_path(txt_path)})}});
    REQUIRE(added.contains("result"));
    REQUIRE(added["result"]["rejected"].empty());
    REQUIRE(added["result"]["added"].size() == 7);

    // PDF: rendered page 1 at 1024 px width as JPEG cover.jpg.
    const json& pdf_entry = added["result"]["added"][0];
    REQUIRE(pdf_entry["document"]["binaries"].size() == 1);
    CHECK(pdf_entry["document"]["binaries"][0]["id"] == "cover.jpg");
    CHECK(pdf_entry["document"]["binaries"][0]["contentType"] == "image/jpeg");
    CHECK(pdf_entry["document"]["binaries"][0]["width"] == 1024);
    CHECK(pdf_entry["document"]["description"]["titleInfo"]["coverpage"] ==
          json::array({json{{"href", "#cover.jpg"}}}));

    // Copy-restricted PDF still generates its cover image cleanly.
    const json& copy_pdf_entry = added["result"]["added"][1];
    REQUIRE(copy_pdf_entry["document"]["binaries"].size() == 1);
    CHECK(copy_pdf_entry["document"]["binaries"][0]["id"] == "cover.jpg");

    // Password-protected PDF fails fast without blocking and attaches with no cover.
    const json& enc_pdf_entry = added["result"]["added"][2];
    CHECK(enc_pdf_entry["document"]["binaries"].empty());

    // EPUB 3 PNG cover extracted as cover.png.
    const json& epub3_entry = added["result"]["added"][3];
    REQUIRE(epub3_entry["document"]["binaries"].size() == 1);
    CHECK(epub3_entry["document"]["binaries"][0]["id"] == "cover.png");
    CHECK(epub3_entry["document"]["binaries"][0]["contentType"] == "image/png");
    CHECK(epub3_entry["document"]["description"]["titleInfo"]["coverpage"] ==
          json::array({json{{"href", "#cover.png"}}}));

    // EPUB 2 JPEG cover extracted as cover.jpg.
    const json& epub2_entry = added["result"]["added"][4];
    REQUIRE(epub2_entry["document"]["binaries"].size() == 1);
    CHECK(epub2_entry["document"]["binaries"][0]["id"] == "cover.jpg");
    CHECK(epub2_entry["document"]["binaries"][0]["contentType"] == "image/jpeg");

    // MOBI cover extracted as cover.jpg.
    const json& mobi_entry = added["result"]["added"][5];
    REQUIRE(mobi_entry["document"]["binaries"].size() == 1);
    CHECK(mobi_entry["document"]["binaries"][0]["id"] == "cover.jpg");
    CHECK(mobi_entry["document"]["binaries"][0]["contentType"] == "image/jpeg");

    // TXT never auto-extracts a cover.
    const json& txt_entry = added["result"]["added"][6];
    CHECK(txt_entry["document"]["binaries"].empty());

    f.call("package.close", json{{"packageId", pkg_id}});

    // Disable all three auto-cover checkboxes and verify zero covers are attached on add.
    const json updated = f.call(
        "settings.set",
        json{{"patch",
              {{"package",
                {{"autoCoverPdf", false}, {"autoCoverEpub", false}, {"autoCoverMobi", false}}}}}});
    REQUIRE(updated.contains("result"));
    CHECK(updated["result"]["settings"]["package"]["autoCoverPdf"] == false);
    CHECK(updated["result"]["settings"]["package"]["autoCoverEpub"] == false);
    CHECK(updated["result"]["settings"]["package"]["autoCoverMobi"] == false);

    const json created2 = f.call("package.create");
    const std::string pkg_id2 = created2["result"]["packageId"].get<std::string>();
    const json added_off = f.call("package.addFiles",
                                  json{{"packageId", pkg_id2},
                                       {"paths",
                                        json::array({platform::utf8_from_path(pdf_path),
                                                     platform::utf8_from_path(epub3_path),
                                                     platform::utf8_from_path(mobi_path)})}});
    REQUIRE(added_off.contains("result"));
    REQUIRE(added_off["result"]["added"].size() == 3);
    CHECK(added_off["result"]["added"][0]["document"]["binaries"].empty());
    CHECK(added_off["result"]["added"][1]["document"]["binaries"].empty());
    CHECK(added_off["result"]["added"][2]["document"]["binaries"].empty());

    f.call("package.close", json{{"packageId", pkg_id2}});
}
