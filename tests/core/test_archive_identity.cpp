// Feature 009, User Story 2 (T033): a book from a ZIP archive is known by the archive and its
// entry in the recent files and the remembered positions (research DP-4, resource formats 1.8).
#include "test_support.hpp"

#include <mfbe/positions.hpp>
#include <mfbe/recent_files.hpp>

#include <catch2/catch_test_macros.hpp>

#include <string>

using namespace mfbe;
using nlohmann::json;

TEST_CASE("archive identity: recent files keep each book of an archive apart", "[archive]") {
    test::TempDir tmp;
    const auto file = tmp / "recent.json";
    const std::string zip = (tmp / "books.zip").string();
    const std::string plain = (tmp / "plain.fb2").string();
    {
        settings::RecentFiles recent(file);
        recent.touch(plain);
        recent.touch(zip, std::string("a/one.fb2"));
        recent.touch(zip, std::string("b/two.fb2"));
        recent.touch(zip, std::string("a/one.fb2"));  // moves to the front, not duplicated
        REQUIRE(recent.items().size() == 3);
        CHECK(recent.items()[0].entry == std::optional<std::string>("a/one.fb2"));
        CHECK(recent.items()[1].entry == std::optional<std::string>("b/two.fb2"));
        CHECK_FALSE(recent.items()[2].entry.has_value());
        CHECK(recent.to_json()[0]["entry"] == "a/one.fb2");
        CHECK_FALSE(recent.to_json()[2].contains("entry"));
    }
    settings::RecentFiles reloaded(file);
    reloaded.load();
    REQUIRE(reloaded.items().size() == 3);
    CHECK(reloaded.items()[1].entry == std::optional<std::string>("b/two.fb2"));
    // One book of the archive goes alone; the archive's path takes the rest with it.
    CHECK(reloaded.remove(zip, std::string("b/two.fb2")));
    CHECK(reloaded.items().size() == 2);
    CHECK(reloaded.remove(zip));
    REQUIRE(reloaded.items().size() == 1);
    CHECK(reloaded.items()[0].path == plain);
    settings::RecentFiles after(file);
    after.load();
    CHECK(after.items().size() == 1);
}

TEST_CASE("archive identity: positions are remembered per book of an archive", "[archive]") {
    test::TempDir tmp;
    const auto file = tmp / "positions.json";
    const std::string zip = (tmp / "books.zip").string();
    const settings::Position first{"body[1]/section[2]", 5};
    const settings::Position second{"body[1]/section[7]", 9};
    {
        settings::Positions positions(file);
        positions.set(zip, first, std::string("a/one.fb2"));
        positions.set(zip, second, std::string("b/two.fb2"));
        CHECK(positions.get(zip, std::string("a/one.fb2")) == first);
        CHECK(positions.get(zip, std::string("b/two.fb2")) == second);
        CHECK_FALSE(positions.get(zip).has_value());
    }
    settings::Positions reloaded(file);
    reloaded.load();
    CHECK(reloaded.get(zip, std::string("a/one.fb2")) == first);
    CHECK(reloaded.get(zip, std::string("b/two.fb2")) == second);
    const json saved = json::parse(test::read_text(file));
    bool has_entry = false;
    for (const auto& item : saved["items"]) {
        has_entry = has_entry || item.value("entry", "") == "a/one.fb2";
    }
    CHECK(has_entry);
}
