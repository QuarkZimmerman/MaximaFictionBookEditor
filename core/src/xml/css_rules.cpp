// Feature 011 (US8): the CSS rule reader and the style issues. See css_rules.hpp.
#include "xml/css_rules.hpp"

#include <algorithm>
#include <cctype>
#include <map>

namespace mfbe::css {
namespace {

bool is_space(char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f';
}

std::string collapse(std::string_view text) {
    std::string out;
    bool space = false;
    for (const char c : text) {
        if (is_space(c)) {
            space = !out.empty();
            continue;
        }
        if (space) {
            out += ' ';
            space = false;
        }
        out += c;
    }
    return out;
}

std::string lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

// A value for comparison: white space collapsed; keywords compared without regard to case, so
// a value without strings or URLs is compared in lower case.
std::string comparable_value(const std::string& value) {
    if (value.find_first_of("\"'") != std::string::npos ||
        lower(value).find("url(") != std::string::npos) {
        return value;
    }
    return lower(value);
}

void add_declarations(std::string_view block, Rule& rule) {
    std::size_t start = 0;
    int depth = 0;
    char quote = 0;
    const auto take = [&](std::size_t end) {
        const std::string_view part = block.substr(start, end - start);
        const std::size_t colon = part.find(':');
        if (colon != std::string_view::npos) {
            std::string property = lower(collapse(part.substr(0, colon)));
            std::string value = collapse(part.substr(colon + 1));
            if (!property.empty()) {
                rule.declarations.push_back({std::move(property), std::move(value)});
            }
        }
        start = end + 1;
    };
    for (std::size_t i = 0; i < block.size(); ++i) {
        const char c = block[i];
        if (quote != 0) {
            if (c == '\\') {
                ++i;
            } else if (c == quote) {
                quote = 0;
            }
        } else if (c == '"' || c == '\'') {
            quote = c;
        } else if (c == '(') {
            ++depth;
        } else if (c == ')' && depth > 0) {
            --depth;
        } else if (c == ';' && depth == 0) {
            take(i);
        }
    }
    if (start < block.size()) {
        take(block.size());
    }
}

}  // namespace

std::string normalize_selector(std::string_view selector) {
    const std::string collapsed = collapse(selector);
    std::string out;
    for (std::size_t i = 0; i < collapsed.size(); ++i) {
        const char c = collapsed[i];
        if (c == '>' || c == '+' || c == '~' || c == ',') {
            while (!out.empty() && out.back() == ' ') {
                out.pop_back();
            }
            out += c;
            if (i + 1 < collapsed.size() && collapsed[i + 1] == ' ') {
                ++i;
            }
            continue;
        }
        out += c;
    }
    return out;
}

Sheet read_rules(std::string_view css) {
    Sheet sheet;
    int line = 1;
    std::size_t i = 0;
    const auto advance_to = [&](std::size_t to) {
        for (; i < to && i < css.size(); ++i) {
            if (css[i] == '\n') {
                ++line;
            }
        }
    };
    const auto skip_comment = [&]() -> bool {
        if (css.compare(i, 2, "/*") != 0) {
            return false;
        }
        const std::size_t end = css.find("*/", i + 2);
        advance_to(end == std::string_view::npos ? css.size() : end + 2);
        return true;
    };
    // The end of a balanced {...} block starting at `open` (npos when unbalanced).
    const auto block_end = [&](std::size_t open) {
        int depth = 0;
        char quote = 0;
        for (std::size_t j = open; j < css.size(); ++j) {
            const char c = css[j];
            if (quote != 0) {
                if (c == '\\') {
                    ++j;
                } else if (c == quote) {
                    quote = 0;
                }
                continue;
            }
            if (c == '"' || c == '\'') {
                quote = c;
            } else if (c == '/' && j + 1 < css.size() && css[j + 1] == '*') {
                const std::size_t end = css.find("*/", j + 2);
                if (end == std::string_view::npos) {
                    return std::string_view::npos;
                }
                j = end + 1;
            } else if (c == '{') {
                ++depth;
            } else if (c == '}') {
                if (--depth == 0) {
                    return j;
                }
            }
        }
        return std::string_view::npos;
    };
    while (i < css.size()) {
        if (is_space(css[i])) {
            advance_to(i + 1);
            continue;
        }
        if (skip_comment()) {
            continue;
        }
        if (css[i] == '}') {
            sheet.unreadableLine = line;
            return sheet;
        }
        if (css[i] == '@') {
            // An at-rule: a statement up to ';' or a block - skipped whole.
            const std::size_t semi = css.find(';', i);
            const std::size_t open = css.find('{', i);
            if (open != std::string_view::npos && (semi == std::string_view::npos || open < semi)) {
                const std::size_t end = block_end(open);
                if (end == std::string_view::npos) {
                    sheet.unreadableLine = line;
                    return sheet;
                }
                advance_to(end + 1);
            } else {
                advance_to(semi == std::string_view::npos ? css.size() : semi + 1);
            }
            continue;
        }
        const std::size_t open = css.find('{', i);
        if (open == std::string_view::npos) {
            sheet.unreadableLine = line;
            return sheet;
        }
        const std::size_t end = block_end(open);
        if (end == std::string_view::npos) {
            sheet.unreadableLine = line;
            return sheet;
        }
        Rule rule;
        rule.line = line;
        std::string selector(css.substr(i, open - i));
        // Comments inside the selector part are not part of it.
        for (std::size_t c = selector.find("/*"); c != std::string::npos; c = selector.find("/*")) {
            const std::size_t e = selector.find("*/", c + 2);
            selector.erase(c, e == std::string::npos ? std::string::npos : e + 2 - c);
        }
        rule.selector = normalize_selector(selector);
        std::string block(css.substr(open + 1, end - open - 1));
        for (std::size_t c = block.find("/*"); c != std::string::npos; c = block.find("/*")) {
            const std::size_t e = block.find("*/", c + 2);
            block.erase(c, e == std::string::npos ? std::string::npos : e + 2 - c);
        }
        if (block.find('{') != std::string::npos) {
            // Nested blocks are no plain CSS rule.
            sheet.unreadableLine = line;
            return sheet;
        }
        add_declarations(block, rule);
        if (!rule.selector.empty()) {
            sheet.rules.push_back(std::move(rule));
        }
        advance_to(end + 1);
    }
    return sheet;
}

std::vector<model::ValidationIssue> style_issues(const std::vector<model::Stylesheet>& sheets) {
    std::vector<model::ValidationIssue> out;
    // selector -> property -> (sheet, value, raw value) of the first stylesheet that sets it.
    struct Seen {
        int sheet;
        std::string comparable;
        std::string value;
    };
    std::map<std::string, std::map<std::string, Seen>> seen;
    for (std::size_t index = 0; index < sheets.size(); ++index) {
        const model::Stylesheet& stylesheet = sheets[index];
        if (lower(stylesheet.type).find("css") == std::string::npos) {
            continue;
        }
        const Sheet sheet = read_rules(stylesheet.content);
        if (sheet.unreadableLine) {
            model::ValidationIssue issue;
            issue.severity = model::Severity::warning;
            issue.code = "style.unreadable";
            issue.params = {{"sheet", static_cast<int>(index) + 1},
                            {"line", *sheet.unreadableLine}};
            out.push_back(std::move(issue));
        }
        std::map<std::string, std::map<std::string, Seen>> mine;
        for (const Rule& rule : sheet.rules) {
            for (const Declaration& declaration : rule.declarations) {
                mine[rule.selector][declaration.property] =
                    Seen{static_cast<int>(index), comparable_value(declaration.value),
                         declaration.value};
            }
        }
        for (const auto& [selector, properties] : mine) {
            auto& earlier = seen[selector];
            for (const auto& [property, now] : properties) {
                const auto it = earlier.find(property);
                if (it == earlier.end()) {
                    earlier.emplace(property, now);
                    continue;
                }
                if (it->second.comparable != now.comparable) {
                    model::ValidationIssue issue;
                    issue.severity = model::Severity::error;
                    issue.code = "style.conflict";
                    issue.params = {
                        {"selector", selector},
                        {"property", property},
                        {"values", nlohmann::json::array({it->second.value, now.value})},
                        {"sheets", nlohmann::json::array({it->second.sheet + 1, now.sheet + 1})}};
                    out.push_back(std::move(issue));
                }
            }
        }
    }
    return out;
}

}  // namespace mfbe::css
