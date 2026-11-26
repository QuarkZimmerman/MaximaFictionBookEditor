// Feature 020 (T019): OCR language pack catalog discovery, higher-layer override precedence,
// binary header validation, portable readme staging, and ocr.report / resources.openOcrFolder RPC.
#include "test_support.hpp"
#include "ws_test_client.hpp"

#include <mfbe/core_server.hpp>
#include <mfbe/ocr.hpp>
#include <mfbe/resources.hpp>

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <vector>

using namespace mfbe;
using json = nlohmann::json;

namespace {

// Builds a minimal structurally valid TessdataManager binary header (count = 24, 1 component).
void write_valid_traineddata(const std::filesystem::path& path, std::size_t extra_payload = 128) {
    std::filesystem::create_directories(path.parent_path());
    constexpr std::int32_t kCount = 24;
    constexpr std::int64_t kHeaderSize = 4 + kCount * 8;
    std::vector<unsigned char> buf(static_cast<std::size_t>(kHeaderSize) + extra_payload, 0xAB);
    buf[0] = static_cast<unsigned char>(kCount & 0xFF);
    buf[1] = static_cast<unsigned char>((kCount >> 8) & 0xFF);
    buf[2] = static_cast<unsigned char>((kCount >> 16) & 0xFF);
    buf[3] = static_cast<unsigned char>((kCount >> 24) & 0xFF);
    for (int i = 0; i < kCount; ++i) {
        const std::int64_t off = (i == 0) ? kHeaderSize : -1;
        for (int b = 0; b < 8; ++b) {
            buf[static_cast<std::size_t>(4 + i * 8 + b)] =
                static_cast<unsigned char>((static_cast<std::uint64_t>(off) >> (b * 8)) & 0xFF);
        }
    }
    std::ofstream out(path, std::ios::binary);
    out.write(reinterpret_cast<const char*>(buf.data()), static_cast<std::streamsize>(buf.size()));
}

const ocr::LanguagePack* find_pack(const ocr::CatalogReport& report, const std::string& code) {
    for (const auto& p : report.packs) {
        if (p.code == code) {
            return &p;
        }
    }
    return nullptr;
}

}  // namespace

TEST_CASE("ocr catalog: layered override precedence, validation, osd and passedOver", "[ocr][020]") {
    test::TempDir tmp;
    resources::Roots roots;
    roots.user_data = tmp / "user-data";
    roots.portable = tmp / "portable";
    roots.bundled_resources = tmp / "bundled";
    roots.bundled_scripts = tmp / "bundled-scripts";
    roots.settings_ocr = tmp / "custom-ocr";

    // Bundled layer: eng, rus, osd
    write_valid_traineddata(tmp / "bundled" / "ocr" / "eng.traineddata", 100);
    write_valid_traineddata(tmp / "bundled" / "ocr" / "rus.traineddata", 120);
    write_valid_traineddata(tmp / "bundled" / "ocr" / "osd.traineddata", 80);
    test::write_text(tmp / "bundled" / "user-readme" / "ocr.md", "# OCR readme\n");
    test::write_text(tmp / "bundled" / "user-readme" / "data.md", "# Data readme\n");

    // User layer: custom pack ces + empty file + corrupt file + unsupported file + ignored readme/txt
    write_valid_traineddata(tmp / "user-data" / "ocr" / "ces.traineddata", 200);
    test::write_text(tmp / "user-data" / "ocr" / "empty.traineddata", "");
    test::write_text(tmp / "user-data" / "ocr" / "broken.traineddata",
                     std::string(256, '\x7F'));
    test::write_text(tmp / "user-data" / "ocr" / "archive.zip", "PK\x03\x04");
    test::write_text(tmp / "user-data" / "ocr" / "README.md", "user readme");
    test::write_text(tmp / "user-data" / "ocr" / "notes.txt", "ignored txt");

    // Custom (settings) layer: overrides bundled rus with a larger (tessdata_best-sized) file
    write_valid_traineddata(tmp / "custom-ocr" / "rus.traineddata", 900);

    resources::ResourceLayers layers(roots);
    layers.place_readmes();
    CHECK(std::filesystem::exists(tmp / "user-data" / "ocr" / "readme.md"));

    const ocr::CatalogReport report =
        ocr::build_catalog(layers, (tmp / "custom-ocr").string());

    CHECK(report.osd_available);
    REQUIRE(report.osd_layer.has_value());
    CHECK(*report.osd_layer == resources::LayerName::bundled);
    CHECK_FALSE(report.custom_folder_issue.has_value());
    CHECK(report.active_folder == tmp / "custom-ocr");

    // osd must never appear in user-selectable packs
    CHECK(find_pack(report, "osd") == nullptr);
    REQUIRE(report.packs.size() == 3);

    const auto* eng = find_pack(report, "eng");
    REQUIRE(eng != nullptr);
    CHECK(eng->fb2_lang == "en");
    CHECK(eng->script == "latin");
    CHECK(eng->layer == resources::LayerName::bundled);
    CHECK(eng->bundled);
    CHECK_FALSE(eng->overrides_bundled);

    const auto* rus = find_pack(report, "rus");
    REQUIRE(rus != nullptr);
    CHECK(rus->fb2_lang == "ru");
    CHECK(rus->script == "cyrillic");
    CHECK(rus->layer == resources::LayerName::settings);
    CHECK(rus->bundled);
    CHECK(rus->overrides_bundled);
    CHECK(rus->size_bytes > eng->size_bytes);

    const auto* ces = find_pack(report, "ces");
    REQUIRE(ces != nullptr);
    CHECK(ces->fb2_lang == "cs");
    CHECK(ces->layer == resources::LayerName::user);
    CHECK_FALSE(ces->bundled);
    CHECK_FALSE(ces->overrides_bundled);

    // passedOver flags empty, corrupt, and unsupportedFile, while ignoring README.md and *.txt
    std::map<std::string, std::string> passed;
    for (const auto& item : report.passed_over) {
        passed[item.path.filename().string()] = item.reason;
    }
    CHECK(passed.size() == 3);
    CHECK(passed["empty.traineddata"] == "empty");
    CHECK(passed["broken.traineddata"] == "corrupt");
    CHECK(passed["archive.zip"] == "unsupportedFile");

    // Removing the custom override immediately restores bundled rus
    std::filesystem::remove(tmp / "custom-ocr" / "rus.traineddata");
    const ocr::CatalogReport after = ocr::build_catalog(layers, (tmp / "custom-ocr").string());
    const auto* rus_after = find_pack(after, "rus");
    REQUIRE(rus_after != nullptr);
    CHECK(rus_after->layer == resources::LayerName::bundled);
    CHECK_FALSE(rus_after->overrides_bundled);
}

TEST_CASE("ocr catalog: missing custom folder reports customFolderIssue and portable layer label",
          "[ocr][020]") {
    test::TempDir tmp;
    resources::Roots roots;
    roots.user_data = tmp / "portable" / "user";
    roots.portable = tmp / "portable" / "user";  // portable mode: data dir IS portable dir
    roots.bundled_resources = tmp / "bundled";
    roots.settings_ocr = tmp / "does-not-exist";

    write_valid_traineddata(tmp / "bundled" / "ocr" / "eng.traineddata", 100);
    write_valid_traineddata(tmp / "portable" / "user" / "ocr" / "eng.traineddata", 500);

    resources::ResourceLayers layers(roots);
    const ocr::CatalogReport report =
        ocr::build_catalog(layers, (tmp / "does-not-exist").string());
    REQUIRE(report.custom_folder_issue.has_value());
    CHECK(*report.custom_folder_issue == "missing");

    const auto* eng = find_pack(report, "eng");
    REQUIRE(eng != nullptr);
    CHECK(eng->layer == resources::LayerName::portable);
    CHECK(eng->overrides_bundled);
}

TEST_CASE("ocr RPC: ocr.report, resources.openOcrFolder and resources.passedOver(ocr)",
          "[ocr][rpc][020]") {
    test::TempDir tmp;
    CoreServerOptions opts;
    opts.port = 0;
    opts.data_dir = (tmp / "data").string();
    opts.test_hooks = true;
    auto server = CoreServer::start(opts);
    REQUIRE(server != nullptr);

    test::WsClient ws;
    REQUIRE(ws.open(server->port(), "/rpc?token=" + server->token()) == 101);

    const json info = ws.call("app.info")["result"];
    CHECK(info["apiMinor"].get<int>() >= 18);

    // Bundled 10 packs + osd from MFBE_RESOURCES_SOURCE_DIR
    const json rep = ws.call("ocr.report")["result"];
    CHECK(rep["osdAvailable"] == true);
    CHECK(rep["osdLayer"] == "bundled");
    REQUIRE(rep["packs"].is_array());
    CHECK(rep["packs"].size() >= 10);

    // resources.openOcrFolder creates <Data>/ocr with readme.md and returns its path
    const json opened = ws.call("resources.openOcrFolder")["result"];
    const std::filesystem::path ocr_dir = opened["path"].get<std::string>();
    CHECK(std::filesystem::is_directory(ocr_dir));
    CHECK(std::filesystem::is_regular_file(ocr_dir / "readme.md"));

    // Drop a corrupt file into <Data>/ocr and verify both ocr.report and resources.passedOver
    test::write_text(ocr_dir / "bad.traineddata", "not-tessdata");
    const json po = ws.call("resources.passedOver", json{{"kind", "ocr"}})["result"]["items"];
    REQUIRE(po.size() == 1);
    CHECK(po[0]["kind"] == "ocr");
    CHECK(po[0]["reason"] == "corrupt");
}
