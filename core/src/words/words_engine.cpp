// Words tool engine (T135). See mfbe/words.hpp.
#include <mfbe/unicode.hpp>
#include <mfbe/words.hpp>

#include <algorithm>
#include <chrono>
#include <unordered_map>

namespace mfbe::words {
namespace {

bool is_combining_mark(char32_t cp) {
    return (cp >= 0x0300 && cp <= 0x036F) || (cp >= 0x0483 && cp <= 0x0489) ||
           (cp >= 0x0591 && cp <= 0x05BD) || (cp >= 0x064B && cp <= 0x065F) ||
           (cp >= 0x1AB0 && cp <= 0x1AFF) || (cp >= 0x1DC0 && cp <= 0x1DFF) ||
           (cp >= 0x20D0 && cp <= 0x20FF) || (cp >= 0xFE20 && cp <= 0xFE2F);
}

bool is_digit(char32_t cp) {
    return cp >= '0' && cp <= '9';
}

bool is_word_char(char32_t cp) {
    return unicode::is_letter(cp) || is_combining_mark(cp) || is_digit(cp);
}

bool is_connector(char32_t cp) {
    return cp == 0x27 || cp == 0x2019 || cp == 0x02BC ||  // apostrophes
           cp == 0x2D || cp == 0x2010 || cp == 0x2011;    // hyphens
}

}  // namespace

std::vector<std::string> segment(std::string_view text) {
    std::vector<std::string> out;
    const std::vector<char32_t> cps = unicode::decode_utf8(text);
    std::string current;
    bool has_non_digit = false;
    const auto flush = [&] {
        if (!current.empty() && has_non_digit) {
            out.push_back(current);
        }
        current.clear();
        has_non_digit = false;
    };
    for (std::size_t i = 0; i < cps.size(); ++i) {
        const char32_t cp = cps[i];
        if (cp == 0xAD) {
            continue;  // soft hyphen: invisible join
        }
        if (is_word_char(cp)) {
            unicode::append_utf8(current, cp);
            if (!is_digit(cp)) {
                has_non_digit = true;
            }
            continue;
        }
        if (is_connector(cp) && !current.empty()) {
            // Part of the word only when the next significant character continues it.
            std::size_t next = i + 1;
            while (next < cps.size() && cps[next] == 0xAD) {
                ++next;
            }
            if (next < cps.size() && is_word_char(cps[next])) {
                unicode::append_utf8(current, cp);
                continue;
            }
        }
        flush();
    }
    flush();
    return out;
}

namespace {

void visit_node_text(const model::Node& node,
                     const std::function<void(std::string_view)>& visitor) {
    if (node.is_text()) {
        if (!node.text.empty()) {
            visitor(node.text);
        }
        return;
    }
    for (const model::Node& child : node.content) {
        visit_node_text(child, visitor);
    }
}

void visit_person(const model::Person& person,
                  const std::function<void(std::string_view)>& visitor) {
    for (const auto& field :
         {person.firstName, person.middleName, person.lastName, person.nickname}) {
        if (field && !field->empty()) {
            visitor(*field);
        }
    }
}

void visit_sequences(const std::vector<model::Sequence>& sequences,
                     const std::function<void(std::string_view)>& visitor) {
    for (const model::Sequence& s : sequences) {
        if (!s.name.empty()) {
            visitor(s.name);
        }
        visit_sequences(s.children, visitor);
    }
}

void visit_title_info(const model::TitleInfo& info,
                      const std::function<void(std::string_view)>& visitor) {
    for (const model::Person& p : info.authors) {
        visit_person(p, visitor);
    }
    if (!info.bookTitle.empty()) {
        visitor(info.bookTitle);
    }
    if (info.annotation) {
        visit_node_text(*info.annotation, visitor);
    }
    if (info.keywords && !info.keywords->empty()) {
        visitor(*info.keywords);
    }
    if (info.date && !info.date->text.empty()) {
        visitor(info.date->text);
    }
    for (const model::Person& p : info.translators) {
        visit_person(p, visitor);
    }
    visit_sequences(info.sequences, visitor);
}

}  // namespace

void visit_text_runs(const model::Document& document,
                     const std::function<void(std::string_view)>& visitor) {
    for (const model::Node& body : document.bodies) {
        visit_node_text(body, visitor);
    }
    const model::Description& d = document.description;
    visit_title_info(d.titleInfo, visitor);
    if (d.srcTitleInfo) {
        visit_title_info(*d.srcTitleInfo, visitor);
    }
    for (const model::Person& p : d.documentInfo.authors) {
        visit_person(p, visitor);
    }
    if (d.documentInfo.history) {
        visit_node_text(*d.documentInfo.history, visitor);
    }
    for (const model::Person& p : d.documentInfo.publishers) {
        visit_person(p, visitor);
    }
    if (d.publishInfo) {
        for (const auto& field :
             {d.publishInfo->bookName, d.publishInfo->publisher, d.publishInfo->city}) {
            if (field && !field->empty()) {
                visitor(*field);
            }
        }
        visit_sequences(d.publishInfo->sequences, visitor);
    }
    for (const model::CustomInfo& c : d.customInfo) {
        if (!c.text.empty()) {
            visitor(c.text);
        }
    }
}

AnalyzeResult analyze(const model::Document& document, const AnalyzeOptions& options) {
    const auto started = std::chrono::steady_clock::now();
    AnalyzeResult result;
    std::unordered_map<std::string, std::int64_t> counts;
    visit_text_runs(document, [&](std::string_view text) {
        for (std::string& word : segment(text)) {
            ++result.total_words;
            ++counts[std::move(word)];
        }
    });
    result.words.reserve(counts.size());
    for (auto& [word, count] : counts) {
        const bool excluded = options.is_excluded && options.is_excluded(word);
        if (excluded && !options.include_exclusions) {
            continue;
        }
        result.words.push_back(WordStat{word, count, excluded});
    }
    std::sort(result.words.begin(), result.words.end(),
              [](const WordStat& a, const WordStat& b) { return a.word < b.word; });
    result.duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - started)
                             .count();
    return result;
}

}  // namespace mfbe::words
