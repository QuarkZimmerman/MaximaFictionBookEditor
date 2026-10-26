// Feature 006 (T057; FR-061; I24; C35; resource-formats.md §12, Tests; research R4.1, R4.8): the
// content-model automata that tools/fb2-schema-elements.py writes into the Source view's table
// ui/src/views/source/fb2Elements.json (the member `model`) pinned to libxml2. For section,
// cite, annotation and history - the elements that may hold a table - every sequence of 0 to 4
// children over the element's `children` is put into a minimal valid book at the element's
// place, and the bundled schema (validation::validate_xml_text) accepts the book exactly when the
// automaton, run from state 0, ends in a final state.
#include "test_support.hpp"

#include <mfbe/validator.hpp>

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <cstddef>
#include <functional>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

using namespace mfbe;
using nlohmann::json;

namespace {

std::filesystem::path repo_root() {
    return test::fixtures_dir().parent_path().parent_path();
}

// A minimal valid instance of each child element.
const std::map<std::string, std::string>& instances() {
    static const std::map<std::string, std::string> map = {
        {"annotation", "<annotation><p>a</p></annotation>"},
        {"cite", "<cite><p>c</p></cite>"},
        {"empty-line", "<empty-line/>"},
        {"epigraph", "<epigraph><p>e</p></epigraph>"},
        {"image", "<image l:href=\"#i.png\"/>"},
        {"p", "<p>p</p>"},
        {"poem", "<poem><stanza><v>v</v></stanza></poem>"},
        {"section", "<section><p>s</p></section>"},
        {"subtitle", "<subtitle>s</subtitle>"},
        {"table", "<table><tr><td>x</td></tr></table>"},
        {"text-author", "<text-author>a</text-author>"},
        {"title", "<title><p>t</p></title>"},
    };
    return map;
}

// The book with `content` as the children of the element at its place: a section in the body, a
// cite in a section, the title-info's annotation and the document-info's history.
std::string book_for(const std::string& element, const std::string& content) {
    if (element == "section") {
        return test::minimal_book("<section>" + content + "</section>");
    }
    if (element == "cite") {
        return test::minimal_book("<section><cite>" + content + "</cite></section>");
    }
    const std::string head =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" "
        "xmlns:l=\"http://www.w3.org/1999/xlink\"><description><title-info>"
        "<genre>prose_classic</genre><author><first-name>Ann</first-name>"
        "<last-name>Writer</last-name></author><book-title>Book</book-title>";
    const std::string document_info =
        "<document-info><author><nickname>fixture</nickname></author><date>2026</date>"
        "<id>feature-006-models</id><version>1.0</version>";
    const std::string tail = "<body><section><p>s</p></section></body></FictionBook>\n";
    if (element == "annotation") {
        return head + "<annotation>" + content + "</annotation><lang>en</lang></title-info>" +
               document_info + "</document-info></description>" + tail;
    }
    if (element == "history") {
        return head + "<lang>en</lang></title-info>" + document_info + "<history>" + content +
               "</history></document-info></description>" + tail;
    }
    FAIL("no place for " << element);
    return {};
}

struct Automaton {
    std::vector<int> final_states;
    std::vector<std::map<std::string, int>> next;

    bool accepts(const std::vector<std::string>& sequence) const {
        int state = 0;
        for (const std::string& child : sequence) {
            if (state < 0 || static_cast<std::size_t>(state) >= next.size()) {
                return false;
            }
            const auto found = next[static_cast<std::size_t>(state)].find(child);
            if (found == next[static_cast<std::size_t>(state)].end()) {
                return false;
            }
            state = found->second;
        }
        return std::find(final_states.begin(), final_states.end(), state) != final_states.end();
    }
};

std::optional<Automaton> automaton_of(const json& entry) {
    if (!entry.contains("model")) {
        return std::nullopt;
    }
    Automaton automaton;
    for (const json& state : entry["model"]["final"]) {
        automaton.final_states.push_back(state.get<int>());
    }
    for (const json& row : entry["model"]["next"]) {
        std::map<std::string, int> transitions;
        for (const auto& [child, target] : row.items()) {
            transitions[child] = target.get<int>();
        }
        automaton.next.push_back(std::move(transitions));
    }
    return automaton;
}

std::string joined(const std::vector<std::string>& sequence) {
    std::string out = "[";
    for (std::size_t i = 0; i < sequence.size(); ++i) {
        out += (i == 0 ? "" : ", ") + sequence[i];
    }
    return out + "]";
}

}  // namespace

TEST_CASE(
    "content models: for section, cite, annotation and history libxml2 accepts exactly the child "
    "sequences the automata of fb2Elements.json accept, up to length 4",
    "[schema][content-models]") {
    REQUIRE(validation::schema_ready());
    const json table = json::parse(
        test::read_text(repo_root() / "ui" / "src" / "views" / "source" / "fb2Elements.json"));

    std::size_t validations = 0;
    for (const std::string element : {"section", "cite", "annotation", "history"}) {
        INFO(element);
        REQUIRE(table["elements"].contains(element));
        const json& entry = table["elements"][element];
        const std::optional<Automaton> automaton = automaton_of(entry);
        REQUIRE(automaton.has_value());
        std::vector<std::string> alphabet;
        for (const json& child : entry["children"]) {
            alphabet.push_back(child.get<std::string>());
            REQUIRE(instances().count(alphabet.back()) == 1);
        }

        // The valid minimal book itself, and the element's place in it.
        REQUIRE(validation::validate_xml_text(book_for(element, "<p>p</p>")).errorCount == 0);

        std::vector<std::string> mismatches;
        std::size_t accepted = 0;
        std::vector<std::string> sequence;
        const std::function<void()> visit = [&]() {
            std::string content;
            for (const std::string& child : sequence) {
                content += instances().at(child);
            }
            const model::ValidationReport report =
                validation::validate_xml_text(book_for(element, content));
            ++validations;
            const bool schema_accepts = report.errorCount == 0;
            const bool automaton_accepts = automaton->accepts(sequence);
            if (automaton_accepts) {
                ++accepted;
            }
            if (schema_accepts != automaton_accepts) {
                std::ostringstream line;
                line << element << " " << joined(sequence) << ": automaton "
                     << (automaton_accepts ? "accepts" : "refuses") << ", libxml2 "
                     << report.errorCount << " error(s)";
                if (!report.issues.empty()) {
                    const model::ValidationIssue& issue = report.issues.front();
                    const auto message = issue.params.find("message");
                    line << " (" << issue.code;
                    if (message != issue.params.end()) {
                        line << ": " << message->second.dump();
                    }
                    line << ")";
                }
                mismatches.push_back(line.str());
            }
            if (sequence.size() == 4) {
                return;
            }
            for (const std::string& child : alphabet) {
                sequence.push_back(child);
                visit();
                sequence.pop_back();
            }
        };
        visit();

        std::string listed;
        for (std::size_t i = 0; i < mismatches.size() && i < 40; ++i) {
            listed += mismatches[i] + "\n";
        }
        INFO(mismatches.size() << " mismatch(es):\n" << listed);
        CHECK(mismatches.empty());
        CHECK(accepted > 0);
    }
    // 16,105 sequences of section's 11 children and 1,555 of each other element's 6.
    CHECK(validations == 16105 + 3 * 1555);
}
