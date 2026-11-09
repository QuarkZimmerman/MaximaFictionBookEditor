// Feature 011 (US8; contracts/styles.md §3): the CSS rule reader and the style issues.
#include "xml/css_rules.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace mfbe;

TEST_CASE("css rules: selectors and declarations, comments and at-rules skipped", "[css]") {
    const css::Sheet sheet = css::read_rules(
        "/* a comment */\n"
        "@charset \"utf-8\";\n"
        "p { text-indent: 1em; margin : 0  1em }\n"
        "@media print { p { color: black; } }\n"
        "section   >  title,  .letter { font-style: italic; content: \"a; b\" }\n");
    REQUIRE_FALSE(sheet.unreadableLine);
    REQUIRE(sheet.rules.size() == 2);
    CHECK(sheet.rules[0].selector == "p");
    CHECK(sheet.rules[0].line == 3);
    REQUIRE(sheet.rules[0].declarations.size() == 2);
    CHECK(sheet.rules[0].declarations[1].property == "margin");
    CHECK(sheet.rules[0].declarations[1].value == "0 1em");
    CHECK(sheet.rules[1].selector == "section>title,.letter");
    REQUIRE(sheet.rules[1].declarations.size() == 2);
    CHECK(sheet.rules[1].declarations[1].value == "\"a; b\"");
}

TEST_CASE("css rules: text the reader cannot follow is unreadable from its line on", "[css]") {
    CHECK(css::read_rules("p { color: red;\n").unreadableLine == 1);
    CHECK(css::read_rules("p { color: red; }\n}\n").unreadableLine == 2);
    CHECK(css::read_rules("p { color: red; }\nsection").unreadableLine == 2);
    CHECK_FALSE(css::read_rules("").unreadableLine);
}

TEST_CASE("style issues: a conflict across stylesheets, none for different properties", "[css]") {
    const std::vector<model::Stylesheet> conflicting = {
        {"text/css", "p { text-indent: 1em; }"},
        {"text/css", "p  { TEXT-INDENT: 2em; color: red; }"},
    };
    const auto issues = css::style_issues(conflicting);
    REQUIRE(issues.size() == 1);
    CHECK(issues[0].code == "style.conflict");
    CHECK(issues[0].severity == model::Severity::error);
    CHECK(issues[0].params.at("selector") == "p");
    CHECK(issues[0].params.at("property") == "text-indent");
    CHECK(issues[0].params.at("values") == nlohmann::json::array({"1em", "2em"}));
    CHECK(issues[0].params.at("sheets") == nlohmann::json::array({1, 2}));

    // The same selector setting different properties, or the same value: no conflict.
    CHECK(css::style_issues({{"text/css", "p { color: red; }"}, {"text/css", "p { margin: 0; }"}})
              .empty());
    CHECK(css::style_issues({{"text/css", "p { color: RED; }"}, {"text/css", "p { color: red }"}})
              .empty());
    // Stylesheets of another type are kept as read and never compared.
    CHECK(css::style_issues({{"text/css", "p { color: red; }"}, {"text/x-other", "p { color: blue; }"}})
              .empty());
}

TEST_CASE("style issues: an unreadable stylesheet is a warning", "[css]") {
    const auto issues = css::style_issues({{"text/css", "p { color: red;"}});
    REQUIRE(issues.size() == 1);
    CHECK(issues[0].code == "style.unreadable");
    CHECK(issues[0].severity == model::Severity::warning);
    CHECK(issues[0].params.at("sheet") == 1);
    CHECK(issues[0].params.at("line") == 1);
}
