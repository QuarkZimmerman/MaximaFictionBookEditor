// Feature 016 (D16, DP-7; tasks T036): drawings and forms. A chart comes as one drawing with its
// axes and its labels - drawn with the shipped fonts, as the PDF embeds none - while a table's
// rules and the text's lines do not; a form whose fields stand in labelled rows is given as its
// labels and values, any other is drawn.
#include "pdf/import/reader_process.hpp"

#include <mfbe/images.hpp>

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

using namespace std::chrono_literals;
using nlohmann::json;

namespace {

const std::filesystem::path kFixtures = std::filesystem::path(MFBE_TEST_FIXTURES_DIR);
const std::filesystem::path kFonts = kFixtures.parent_path().parent_path() / "resources" / "fonts";

struct Read {
    std::filesystem::path folder;
    std::unique_ptr<mfbe::pdf_import::ReaderProcess> reader;
    json page1;
};

Read read(const std::string& name, bool fonts) {
    Read r;
    r.folder =
        std::filesystem::temp_directory_path() / ("mfbe-drawings-" + name + (fonts ? "-f" : ""));
    std::filesystem::remove_all(r.folder);
    std::filesystem::create_directories(r.folder);
    mfbe::pdf_import::ReaderOptions o;
    o.reader = mfbe::pdf_import::find_reader();
    o.pdf = kFixtures / "pdf" / "import" / (name + ".pdf");
    o.folder = r.folder;
    if (fonts) {
        o.fonts = kFonts;
    }
    std::string error;
    r.reader = mfbe::pdf_import::ReaderProcess::start(o, error);
    REQUIRE(r.reader);
    std::string line;
    while (r.reader->next_event(line, 60s)) {
        if (json::parse(line).value("event", "") == "done") {
            break;
        }
    }
    r.page1 = json::parse(std::ifstream(r.folder / "page-1.json"));
    return r;
}

/// The drawing drawn by the reader, decoded.
mfbe::images::Bitmap draw(Read& r, const std::string& id) {
    REQUIRE(r.reader->send_line(json{{"picture", id}, {"page", 1}}.dump()));
    std::string line;
    REQUIRE(r.reader->next_event(line, 60s));
    const json e = json::parse(line);
    REQUIRE(e["event"] == "picture");
    CHECK(e["contentType"] == "image/png");
    std::ifstream in(r.folder / e["file"].get<std::string>(), std::ios::binary);
    std::stringstream bytes;
    bytes << in.rdbuf();
    return mfbe::images::decode(bytes.str());
}

/// Dark pixels in the bottom tenth of a picture (where the chart's labels stand).
int ink_at_foot(const mfbe::images::Bitmap& b) {
    int dark = 0;
    for (int y = b.height * 9 / 10; y < b.height; ++y) {
        for (int x = 0; x < b.width; ++x) {
            dark += b.rgba[(static_cast<std::size_t>(y) * b.width + x) * 4] < 100 ? 1 : 0;
        }
    }
    return dark;
}

}  // namespace

TEST_CASE("a chart comes as one drawing; rules and table grids do not (D16)", "[pdf][import]") {
    Read r = read("drawing", true);
    REQUIRE(r.page1["drawings"].size() == 1);
    const auto& box = r.page1["drawings"][0]["box"];
    // The chart's area, above the table: the table's rules (y 160 to 200 in the PDF) are not in it.
    CHECK(box[1].get<double>() + box[3].get<double>() < 595.0 - 200.0);
    const mfbe::images::Bitmap picture = draw(r, r.page1["drawings"][0]["id"]);
    // 200 dpi: points times 200 / 72.
    CHECK(picture.width == static_cast<int>(std::ceil(box[2].get<double>() * 200 / 72)));
    CHECK(ink_at_foot(picture) > 0);
}

TEST_CASE("a drawing's text is drawn with the shipped fonts (DP-7)", "[pdf][import]") {
    Read with = read("drawing", true);
    Read without = read("drawing", false);
    const int labelled = ink_at_foot(draw(with, with.page1["drawings"][0]["id"]));
    const int bare = ink_at_foot(draw(without, without.page1["drawings"][0]["id"]));
    // The labels are drawn only with a font to draw them: the axis line alone is left without one.
    CHECK(labelled > bare);
}

TEST_CASE("a form in labelled rows is given as its labels and values; any other is drawn (D16)",
          "[pdf][import]") {
    Read rows = read("forms", true);
    REQUIRE(rows.page1["forms"].size() == 2);
    CHECK(rows.page1["forms"][0]["label"] == "Name:");
    CHECK(rows.page1["forms"][0]["value"] == "Ann Example");
    CHECK(rows.page1["forms"][1]["label"] == "Town:");
    CHECK(rows.page1["forms"][1]["value"] == "Harbourtown");
    CHECK(rows.page1["drawings"].empty());
    Read free = read("form-free", true);
    CHECK(free.page1["forms"].empty());
    REQUIRE(free.page1["drawings"].size() == 1);
    CHECK(draw(free, free.page1["drawings"][0]["id"]).width > 0);
}
