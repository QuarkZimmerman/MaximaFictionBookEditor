// Feature 009, User Story 2 (T019): the legacy-name judge (research DP-2, FR-022).
#include "test_support.hpp"

#include <mfbe/archive.hpp>

#include <catch2/catch_test_macros.hpp>

#include <string>
#include <vector>

using namespace mfbe;

namespace {

std::vector<std::string> names_of(const std::string& file) {
    std::vector<std::string> names;
    for (const auto& b : archive::list(test::fixtures_dir() / "archives" / file).books) {
        names.push_back(b.name);
    }
    return names;
}

std::vector<std::string> raw_of(const std::string& file) {
    std::vector<std::string> raw;
    for (const auto& e : archive::list(test::fixtures_dir() / "archives" / file).entries) {
        raw.push_back(e.raw_name);
    }
    return raw;
}

const std::vector<std::string> kCyrillic = {"\xD0\x92\xD0\xBE\xD0\xB9\xD0\xBD\xD0\xB0 \xD0\xB8 "
                                            "\xD0\xBC\xD0\xB8\xD1\x80.fb2",
                                            "\xD0\x90\xD0\xBD\xD0\xBD\xD0\xB0 \xD0\x9A\xD0\xB0\xD1"
                                            "\x80\xD0\xB5\xD0\xBD\xD0\xB8\xD0\xBD\xD0\xB0.fb2"};
const std::vector<std::string> kHebrew = {"\xD7\x9E\xD7\x9C\xD7\x97\xD7\x9E\xD7\x94 \xD7\x95\xD7"
                                          "\xA9\xD7\x9C\xD7\x95\xD7\x9D.fb2",
                                          "\xD7\xA9\xD7\x99\xD7\xA8\xD7\x99\xD7\x9D.fb2"};
const std::vector<std::string> kWestern = {"Caf\xC3\xA9 cr\xC3\xA8me.fb2", "\xC3\x9C" "ber alles.fb2"};

}  // namespace

TEST_CASE("zip names: UTF-8, flagged or not, and the Cyrillic code pages", "[archive]") {
    CHECK(names_of("names-utf8-flag.zip") == kCyrillic);
    CHECK(names_of("names-utf8-noflag.zip") == kCyrillic);
    CHECK(names_of("names-cp866.zip") == kCyrillic);
    CHECK(names_of("names-cp1251.zip") == kCyrillic);
    CHECK(names_of("names-cp437.zip") == kWestern);
}

TEST_CASE("zip names: Hebrew code pages decode as Hebrew", "[archive]") {
    // CP1255's Hebrew letters are CP866's lower-case р-я without а, е, и, о: no Russian word.
    CHECK(archive::decode_names(raw_of("names-cp1255.zip"), archive::default_candidates()).names ==
          kHebrew);
    // CP862's Hebrew letters are CP866's upper-case А-Ъ. Here CP866 makes "ЩЙШЙН" of one name,
    // no Russian word, so Hebrew wins whatever the order; a true tie is in the next case.
    for (const std::vector<int>& order : {std::vector<int>{862, 1255, 866, 1251, 437},
                                          std::vector<int>{866, 1251, 862, 1255, 437}}) {
        const auto decoded = archive::decode_names(raw_of("names-cp862.zip"), order);
        CHECK(decoded.codepage == 862);
        CHECK(decoded.names == kHebrew);
    }
}

TEST_CASE("zip names: ties go to the earlier candidate", "[archive]") {
    const std::vector<std::string> upper = {"\x80\x81\x82\x83.fb2"};  // АБВГ in CP866
    CHECK(archive::decode_names(upper, {866, 1251, 862, 1255, 437}).codepage == 866);
    CHECK(archive::decode_names(upper, {862, 866}).codepage == 862);
    // Valid UTF-8 everywhere needs no judging.
    CHECK(archive::decode_names({"plain.fb2", "\xD0\x9A.fb2"}, {866}).codepage == 65001);
    // The candidates list starts with the system's code pages and always holds the five.
    const auto candidates = archive::default_candidates();
    for (const int cp : {866, 1251, 862, 1255, 437}) {
        CHECK(std::find(candidates.begin(), candidates.end(), cp) != candidates.end());
    }
}
