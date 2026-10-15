// Document details filled in on load (feature 002 FR-005, data-model §2): the original filled
// in the id, version, program used and date whenever it loaded a document.
#include <mfbe/document_details.hpp>
#include <mfbe/platform.hpp>
#include <mfbe/version.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <cctype>
#include <string>
#include <vector>

using namespace mfbe;

namespace {

model::DetailsContext context(bool is_new, int day = 14) {
    model::DetailsContext c;
    c.program = "Maxima Fiction Book Editor 9.8.7";
    c.year = 2026;
    c.month = 10;
    c.day = day;
    c.is_new = is_new;
    c.new_id = [n = 0]() mutable { return "ID-" + std::to_string(++n); };
    return c;
}

const std::vector<std::string> kEveryDetail = {"documentInfo.id", "documentInfo.version",
                                               "documentInfo.programUsed", "documentInfo.date.text",
                                               "documentInfo.date.value"};

}  // namespace

TEST_CASE("document details: a new document gets them all, a new id even when it has one",
          "[details]") {
    model::Document doc;
    doc.description.documentInfo.id = "template-id";
    CHECK(model::fill_in_document_details(doc, context(true)) == kEveryDetail);
    const auto& info = doc.description.documentInfo;
    CHECK(info.id == "ID-1");
    CHECK(info.version == "1.0");
    CHECK(info.programUsed == "Maxima Fiction Book Editor 9.8.7");
    CHECK(info.date.text == "14 October 2026");
    CHECK(info.date.value == "2026-10-14");
}

TEST_CASE("document details: a loaded book keeps what it has", "[details]") {
    model::Document doc;
    auto& info = doc.description.documentInfo;
    info.id = "book-id";
    info.version = "2.3";
    info.programUsed = "FB Tools, Maxima Fiction Book Editor 0.0.1";
    info.date.text = "2001";
    info.date.value = "2001-01-01";
    const model::Document before = doc;
    CHECK(model::fill_in_document_details(doc, context(false)).empty());
    CHECK(doc == before);
}

TEST_CASE("document details: empty fields are filled, another program is followed by this one",
          "[details]") {
    model::Document doc;
    auto& info = doc.description.documentInfo;
    info.programUsed = "FictionBook Editor Release 2.6";
    info.date.text = "весна 2001";
    CHECK(model::fill_in_document_details(doc, context(false, 9)) ==
          std::vector<std::string>{"documentInfo.id", "documentInfo.version",
                                   "documentInfo.programUsed", "documentInfo.date.value"});
    CHECK(info.id == "ID-1");
    CHECK(info.programUsed == "FictionBook Editor Release 2.6, Maxima Fiction Book Editor 9.8.7");
    CHECK(info.date.text == "весна 2001");
    CHECK(info.date.value == "2026-10-09");

    // The date text as the original wrote it: two-digit day, English month.
    model::Document other;
    model::fill_in_document_details(other, context(false, 9));
    CHECK(other.description.documentInfo.date.text == "09 October 2026");
}

TEST_CASE("document details: now = this editor, today's date and an upper-case UUID", "[details]") {
    const model::DetailsContext now = model::details_context_now(true);
    CHECK(now.program == std::string(version::kProductName) + " " + version::kVersion);
    CHECK(now.year >= 2026);
    CHECK((now.month >= 1 && now.month <= 12));
    CHECK((now.day >= 1 && now.day <= 31));
    CHECK(now.is_new);
    const std::string id = now.new_id();
    CHECK(uuid::is_valid(id));
    CHECK(std::none_of(id.begin(), id.end(), [](unsigned char c) { return std::islower(c) != 0; }));
    CHECK(now.new_id() != id);
}
