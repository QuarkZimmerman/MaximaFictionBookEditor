// Feature 011 (US8; D42 clarify; contracts/styles.md §3; research DP-14): the core's reader of a CSS
// stylesheet's rules, the one source of the style issues of Validate and of styles.check. It reads
// selectors and declarations and skips comments and at-rules; it does not judge properties or
// values (the Styles view does, with the CSS grammar). Two issues come from it:
//   style.conflict   (error)   the same selector in two stylesheets sets one property to different
//                              values;
//   style.unreadable (warning) a stylesheet whose text the reader cannot follow (unbalanced braces,
//                              a selector without its block).
#pragma once

#include <mfbe/document.hpp>

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::css {

struct Declaration {
    std::string property;  // lower case
    std::string value;     // white space collapsed
};

struct Rule {
    std::string selector;  // white space normalised
    std::vector<Declaration> declarations;
    int line = 1;
};

struct Sheet {
    std::vector<Rule> rules;
    // The line where the reader could not go on (the rules before it are kept).
    std::optional<int> unreadableLine;
};

// The rules of a CSS text.
Sheet read_rules(std::string_view css);

// A selector with its white space normalised: runs collapsed, none around combinators and commas.
std::string normalize_selector(std::string_view selector);

// The style issues of a document's stylesheets (CSS ones only; others are kept as read).
std::vector<model::ValidationIssue> style_issues(const std::vector<model::Stylesheet>& sheets);

}  // namespace mfbe::css
