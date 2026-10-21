// Position map and the inline scanner (feature 004 US7). See mfbe/position_map.hpp.
//
// The scanner mirrors the reader's `convert_inline_children` (fb2_reader.cpp): over the content
// of a text container it yields tokens with their model width - a literal character 1 unit (2
// for a code point >= U+10000), `\r\n` 1 (libxml2 normalises it), an entity its decoded
// character, CDATA its literal content, a comment or processing instruction 1 (an inline
// raw-xml atom; 0 inside `date`), a mark tag (strong, emphasis, strikethrough, sub, sup, code,
// style, a) 0 with its content scanned, `<image/>` 1, any other element 1 and skipped whole
// (inside `date` every element is transparent). Both directions of `doc.mapPositions` walk the
// same tokens, so toModel(toSource(p)) == p for every text position.
#include <mfbe/position_map.hpp>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <numeric>

namespace mfbe::fb2 {
namespace {

using Text = std::string_view;

/* ----------------------------------------------------------------------------------------- */
/* UTF-8 / UTF-16                                                                            */
/* ----------------------------------------------------------------------------------------- */

bool is_continuation(unsigned char c) {
    return (c & 0xC0) == 0x80;
}

// Byte length of the UTF-8 sequence starting with `lead` (1 for an invalid lead byte).
std::size_t sequence_length(unsigned char lead) {
    if (lead < 0x80) {
        return 1;
    }
    if (lead >= 0xF0) {
        return 4;
    }
    if (lead >= 0xE0) {
        return 3;
    }
    if (lead >= 0xC0) {
        return 2;
    }
    return 1;  // a stray continuation byte
}

// The character at `pos`: its byte length (clamped to `end`) and its UTF-16 width.
struct Char {
    std::size_t bytes;
    std::size_t units;
};

Char char_at(Text text, std::size_t pos, std::size_t end) {
    const auto lead = static_cast<unsigned char>(text[pos]);
    std::size_t bytes = sequence_length(lead);
    if (pos + bytes > end) {
        bytes = end - pos;
    }
    // Only a complete sequence counts its continuation bytes; invalid bytes count one each.
    for (std::size_t i = 1; i < bytes; ++i) {
        if (!is_continuation(static_cast<unsigned char>(text[pos + i]))) {
            bytes = i;
            break;
        }
    }
    return {bytes, (lead >= 0xF0 && bytes == 4) ? std::size_t{2} : std::size_t{1}};
}

std::size_t utf16_width(char32_t cp) {
    return cp >= 0x10000 ? 2 : 1;
}

/* ----------------------------------------------------------------------------------------- */
/* Tokens                                                                                    */
/* ----------------------------------------------------------------------------------------- */

struct Token {
    std::size_t begin;  // bytes
    std::size_t end;    // bytes (exclusive)
    std::size_t units;  // model width
};

bool starts_with(Text text, std::size_t pos, const char* literal) {
    const std::size_t n = std::strlen(literal);
    return text.size() >= pos + n && text.compare(pos, n, literal) == 0;
}

// Position after `terminator` searched from `from`; the text's end when missing.
std::size_t skip_past(Text text, std::size_t from, const char* terminator, std::size_t end) {
    const std::size_t found = text.find(terminator, from);
    if (found == Text::npos || found >= end) {
        return end;
    }
    return std::min(found + std::strlen(terminator), end);
}

bool is_name_char(unsigned char c) {
    return std::isalnum(c) != 0 || c == '-' || c == '_' || c == '.' || c == ':' || c >= 0x80;
}

// The start tag at `pos` (`text[pos] == '<'`, a name follows): its local name, the position
// after its `>` and whether it closes itself. Attribute values are skipped quote-aware.
struct StartTag {
    std::string name;  // local name (any prefix stripped)
    std::size_t end;   // after `>`
    bool selfClosing;
};

StartTag parse_start_tag(Text text, std::size_t pos, std::size_t limit) {
    std::size_t i = pos + 1;
    std::size_t name_begin = i;
    while (i < limit && is_name_char(static_cast<unsigned char>(text[i]))) {
        ++i;
    }
    std::string name(text.substr(name_begin, i - name_begin));
    if (const auto colon = name.find(':'); colon != std::string::npos) {
        name.erase(0, colon + 1);
    }
    bool self_closing = false;
    char quote = 0;
    while (i < limit) {
        const char c = text[i];
        if (quote != 0) {
            if (c == quote) {
                quote = 0;
            }
            ++i;
            continue;
        }
        if (c == '"' || c == '\'') {
            quote = c;
            ++i;
            continue;
        }
        if (c == '>') {
            self_closing = i > pos && text[i - 1] == '/';
            ++i;
            break;
        }
        ++i;
    }
    return {std::move(name), i, self_closing};
}

// The position after the end tag that closes the element whose start tag ended at `from`
// (nesting included; comments, CDATA and processing instructions skipped as wholes).
std::size_t skip_element(Text text, std::size_t from, std::size_t limit) {
    int depth = 1;
    std::size_t i = from;
    while (i < limit && depth > 0) {
        const std::size_t lt = text.find('<', i);
        if (lt == Text::npos || lt >= limit) {
            return limit;
        }
        if (starts_with(text, lt, "<!--")) {
            i = skip_past(text, lt + 4, "-->", limit);
        } else if (starts_with(text, lt, "<![CDATA[")) {
            i = skip_past(text, lt + 9, "]]>", limit);
        } else if (starts_with(text, lt, "<?")) {
            i = skip_past(text, lt + 2, "?>", limit);
        } else if (lt + 1 < limit && text[lt + 1] == '/') {
            i = skip_past(text, lt + 2, ">", limit);
            --depth;
        } else {
            const StartTag tag = parse_start_tag(text, lt, limit);
            i = tag.end;
            if (!tag.selfClosing) {
                ++depth;
            }
        }
    }
    return i;
}

bool is_mark(const std::string& name) {
    return name == "strong" || name == "emphasis" || name == "strikethrough" || name == "sub" ||
           name == "sup" || name == "code" || name == "style" || name == "a";
}

// Decoded width of the entity reference at `pos` (`text[pos] == '&'`); its end. A reference
// without a `;` within its name is a literal ampersand.
Token entity_token(Text text, std::size_t pos, std::size_t limit) {
    std::size_t i = pos + 1;
    while (i < limit && text[i] != ';' &&
           (is_name_char(static_cast<unsigned char>(text[i])) || text[i] == '#')) {
        ++i;
    }
    if (i >= limit || text[i] != ';' || i == pos + 1) {
        return {pos, pos + 1, 1};  // a stray `&`
    }
    const Text name = text.substr(pos + 1, i - pos - 1);
    std::size_t units = 1;
    if (!name.empty() && name[0] == '#') {
        char32_t cp = 0;
        const bool hex = name.size() > 1 && (name[1] == 'x' || name[1] == 'X');
        for (std::size_t k = hex ? 2 : 1; k < name.size(); ++k) {
            const char d = name[k];
            int v = -1;
            if (d >= '0' && d <= '9') {
                v = d - '0';
            } else if (hex && d >= 'a' && d <= 'f') {
                v = d - 'a' + 10;
            } else if (hex && d >= 'A' && d <= 'F') {
                v = d - 'A' + 10;
            }
            if (v < 0) {
                cp = 0;
                break;
            }
            cp = cp * (hex ? 16 : 10) + static_cast<char32_t>(v);
            if (cp > 0x10FFFF) {
                cp = 0x10FFFF;
            }
        }
        units = utf16_width(cp);
    }
    return {pos, i + 1, units};
}

// The inline scanner: calls `fn(token)` for every token of `[begin, end)`; `fn` returns false
// to stop. `date`: the content of a <date> element (elements transparent, no inline atoms).
template <typename Fn>
void scan_inline(Text text, std::size_t begin, std::size_t end, bool date, Fn fn) {
    std::size_t i = begin;
    bool cdata = false;
    while (i < end) {
        const char c = text[i];
        if (cdata) {
            if (starts_with(text, i, "]]>")) {
                if (!fn(Token{i, i + 3, 0})) {
                    return;
                }
                i += 3;
                cdata = false;
                continue;
            }
            // Literal content; the line-end normalisation applies inside CDATA as well.
            if (c == '\r') {
                const std::size_t after = (i + 1 < end && text[i + 1] == '\n') ? i + 2 : i + 1;
                if (!fn(Token{i, after, 1})) {
                    return;
                }
                i = after;
                continue;
            }
            const Char ch = char_at(text, i, end);
            if (!fn(Token{i, i + ch.bytes, ch.units})) {
                return;
            }
            i += ch.bytes;
            continue;
        }
        if (c == '<') {
            if (starts_with(text, i, "<![CDATA[")) {
                if (!fn(Token{i, i + 9, 0})) {
                    return;
                }
                i += 9;
                cdata = true;
                continue;
            }
            if (starts_with(text, i, "<!--")) {
                const std::size_t after = skip_past(text, i + 4, "-->", end);
                if (!fn(Token{i, after, date ? std::size_t{0} : std::size_t{1}})) {
                    return;
                }
                i = after;
                continue;
            }
            if (starts_with(text, i, "<?")) {
                const std::size_t after = skip_past(text, i + 2, "?>", end);
                if (!fn(Token{i, after, date ? std::size_t{0} : std::size_t{1}})) {
                    return;
                }
                i = after;
                continue;
            }
            if (i + 1 < end && text[i + 1] == '/') {
                // An end tag: of a mark (or any element inside `date`) - no width.
                const std::size_t after = skip_past(text, i + 2, ">", end);
                if (!fn(Token{i, after, 0})) {
                    return;
                }
                i = after;
                continue;
            }
            const StartTag tag = parse_start_tag(text, i, end);
            if (date || is_mark(tag.name)) {
                if (!fn(Token{i, tag.end, 0})) {
                    return;
                }
                i = tag.end;
                continue;
            }
            // An inline image or any other element: one atom, skipped whole.
            const std::size_t after = tag.selfClosing ? tag.end : skip_element(text, tag.end, end);
            if (!fn(Token{i, after, 1})) {
                return;
            }
            i = after;
            continue;
        }
        if (c == '&') {
            const Token t = entity_token(text, i, end);
            if (!fn(t)) {
                return;
            }
            i = t.end;
            continue;
        }
        if (c == '\r') {
            const std::size_t after = (i + 1 < end && text[i + 1] == '\n') ? i + 2 : i + 1;
            if (!fn(Token{i, after, 1})) {
                return;
            }
            i = after;
            continue;
        }
        const Char ch = char_at(text, i, end);
        if (!fn(Token{i, i + ch.bytes, ch.units})) {
            return;
        }
        i += ch.bytes;
    }
}

bool has_inline_content(PositionKind kind) {
    return kind == PositionKind::text || kind == PositionKind::date;
}

// The byte position right after the token that brings the count to `offset` (contentBegin for
// 0, contentEnd when the content is shorter).
std::size_t byte_of_offset(const PositionMap& map, const PositionEntry& e, std::size_t offset) {
    if (offset == 0) {
        return e.contentBegin;
    }
    std::size_t units = 0;
    std::size_t answer = e.contentEnd;
    scan_inline(map.text, e.contentBegin, e.contentEnd, e.kind == PositionKind::date,
                [&](const Token& t) {
                    if (t.units == 0) {
                        return true;
                    }
                    units += t.units;
                    if (units >= offset) {
                        answer = t.end;
                        return false;
                    }
                    return true;
                });
    return answer;
}

// The model units of the tokens that end at or before `byte` (a token containing `byte`
// counts as after it).
std::size_t offset_of_byte(const PositionMap& map, const PositionEntry& e, std::size_t byte) {
    std::size_t units = 0;
    scan_inline(map.text, e.contentBegin, e.contentEnd, e.kind == PositionKind::date,
                [&](const Token& t) {
                    if (t.end > byte) {
                        return false;
                    }
                    units += t.units;
                    return true;
                });
    return units;
}

// The byte position `units` UTF-16 units after `from` (a unit in the middle of an astral
// character stops before it).
std::size_t advance_units(Text text, std::size_t from, std::size_t units) {
    std::size_t i = from;
    std::size_t counted = 0;
    while (i < text.size() && counted < units) {
        const Char ch = char_at(text, i, text.size());
        if (counted + ch.units > units) {
            break;
        }
        counted += ch.units;
        i += ch.bytes;
    }
    return i;
}

// Index of the last entry whose tagBegin16 <= offset16 (-1 when none).
int last_entry_before(const PositionMap& map, std::size_t offset16) {
    auto it = std::upper_bound(
        map.entries.begin(), map.entries.end(), offset16,
        [](std::size_t value, const PositionEntry& e) { return value < e.tagBegin16; });
    if (it == map.entries.begin()) {
        return -1;
    }
    return static_cast<int>(std::distance(map.entries.begin(), it) - 1);
}

// Index of the first entry whose tagBegin >= byte (entries.size() when none).
std::size_t first_entry_at(const PositionMap& map, std::size_t byte) {
    auto it = std::lower_bound(
        map.entries.begin(), map.entries.end(), byte,
        [](const PositionEntry& e, std::size_t value) { return e.tagBegin < value; });
    return static_cast<std::size_t>(std::distance(map.entries.begin(), it));
}

std::size_t content_length(const PositionMap& map, const PositionEntry& e) {
    return inline_content_length(map.text, e.contentBegin, e.contentEnd, e.kind);
}

// The end of a node: {N, length} for a text container, the end of the last text container
// in a container's subtree ({N, 0} when it has none), {N, 0} for an atom.
ModelPoint end_of(const PositionMap& map, std::size_t index) {
    const PositionEntry& e = map.entries[index];
    if (has_inline_content(e.kind)) {
        return {e.nodeId, content_length(map, e)};
    }
    if (e.kind == PositionKind::container) {
        // The subtree follows the entry in pre-order up to its end: its last text container.
        std::optional<std::size_t> last;
        for (std::size_t i = index + 1; i < map.entries.size() && map.entries[i].tagBegin < e.end;
             ++i) {
            if (has_inline_content(map.entries[i].kind)) {
                last = i;
            }
        }
        if (last) {
            return {map.entries[*last].nodeId, content_length(map, map.entries[*last])};
        }
    }
    return {e.nodeId, 0};
}

}  // namespace

/* ----------------------------------------------------------------------------------------- */
/* Public API                                                                                */
/* ----------------------------------------------------------------------------------------- */

PositionKind position_kind(const model::Node& node) {
    const std::string& type = node.type;
    if (type == "p" || type == "subtitle" || type == "text-author" || type == "v" || type == "td" ||
        type == "th") {
        return PositionKind::text;
    }
    if (type == "date") {
        return PositionKind::date;
    }
    if (type == "inline-image") {
        return PositionKind::inlineAtom;
    }
    if (type == "raw-xml") {
        auto it = node.attrs.find("inline");
        const bool inline_ =
            it != node.attrs.end() && it->second.is_boolean() && it->second.get<bool>();
        return inline_ ? PositionKind::inlineAtom : PositionKind::blockAtom;
    }
    if (type == "image" || type == "empty-line") {
        return PositionKind::blockAtom;
    }
    return PositionKind::container;
}

const PositionEntry* PositionMap::find(const std::string& node_id) const {
    auto it = byId.find(node_id);
    return it == byId.end() ? nullptr : &entries[it->second];
}

std::size_t utf16_length(std::string_view utf8) {
    std::size_t units = 0;
    for (const char c : utf8) {
        const auto u = static_cast<unsigned char>(c);
        if (!is_continuation(u)) {
            units += (u >= 0xF0) ? 2 : 1;
        }
    }
    return units;
}

std::size_t inline_content_length(std::string_view text, std::size_t begin, std::size_t end,
                                  PositionKind kind) {
    if (!has_inline_content(kind)) {
        return 0;
    }
    std::size_t units = 0;
    scan_inline(text, begin, std::min(end, text.size()), kind == PositionKind::date,
                [&](const Token& t) {
                    units += t.units;
                    return true;
                });
    return units;
}

void finalize_position_map(PositionMap& map, std::string_view text, bool compute_utf16) {
    std::vector<PositionEntry>& entries = map.entries;
    // Document order: sort by tagBegin (stable: a parent precedes the children that start at
    // the same byte, which cannot happen for distinct tags, but keep it deterministic).
    std::vector<std::size_t> order(entries.size());
    std::iota(order.begin(), order.end(), 0);
    std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
        return entries[a].tagBegin < entries[b].tagBegin;
    });
    std::vector<int> inverse(entries.size(), -1);
    for (std::size_t i = 0; i < order.size(); ++i) {
        inverse[order[i]] = static_cast<int>(i);
    }
    std::vector<PositionEntry> sorted;
    sorted.reserve(entries.size());
    for (const std::size_t old_index : order) {
        PositionEntry e = std::move(entries[old_index]);
        e.parent = e.parent >= 0 ? inverse[static_cast<std::size_t>(e.parent)] : -1;
        sorted.push_back(std::move(e));
    }
    entries = std::move(sorted);
    if (compute_utf16) {
        std::size_t units = 0;
        std::size_t pos = 0;
        for (PositionEntry& e : entries) {
            const std::size_t target = std::min(e.tagBegin, text.size());
            units += utf16_length(text.substr(pos, target - pos));
            pos = target;
            e.tagBegin16 = units;
        }
        units += utf16_length(text.substr(pos));
        map.length16 = units;
    }
    map.byId.clear();
    map.byId.reserve(entries.size());
    for (std::size_t i = 0; i < entries.size(); ++i) {
        map.byId.emplace(entries[i].nodeId, i);
    }
}

std::optional<std::size_t> resolve_to_source(const PositionMap& map, const ModelPoint& point) {
    const PositionEntry* e = map.find(point.nodeId);
    if (e == nullptr) {
        return std::nullopt;
    }
    std::size_t byte = e->tagBegin;
    if (has_inline_content(e->kind)) {
        byte = byte_of_offset(map, *e, point.offset);
    }
    return e->tagBegin16 +
           utf16_length(std::string_view(map.text).substr(e->tagBegin, byte - e->tagBegin));
}

std::optional<ModelPoint> resolve_to_model(const PositionMap& map, std::size_t offset16) {
    const int anchor = last_entry_before(map, offset16);
    if (anchor < 0) {
        return std::nullopt;
    }
    const PositionEntry& a = map.entries[static_cast<std::size_t>(anchor)];
    const std::size_t byte = advance_units(map.text, a.tagBegin, offset16 - a.tagBegin16);
    // The deepest entry whose element holds the byte: the anchor or one of its ancestors.
    int index = anchor;
    while (index >= 0 && byte >= map.entries[static_cast<std::size_t>(index)].end) {
        index = map.entries[static_cast<std::size_t>(index)].parent;
    }
    if (index < 0) {
        return std::nullopt;
    }
    const PositionEntry* n = &map.entries[static_cast<std::size_t>(index)];
    std::size_t b = byte;
    if (n->kind == PositionKind::inlineAtom) {
        // Before the atom, in its text container.
        if (n->parent < 0 ||
            !has_inline_content(map.entries[static_cast<std::size_t>(n->parent)].kind)) {
            return ModelPoint{n->nodeId, 0};
        }
        b = n->tagBegin;
        index = n->parent;
        n = &map.entries[static_cast<std::size_t>(index)];
    }
    if (has_inline_content(n->kind)) {
        if (b < n->contentBegin) {
            return ModelPoint{n->nodeId, 0};
        }
        if (b >= n->contentEnd) {
            return ModelPoint{n->nodeId, content_length(map, *n)};
        }
        return ModelPoint{n->nodeId, offset_of_byte(map, *n, b)};
    }
    if (n->kind == PositionKind::blockAtom) {
        return ModelPoint{n->nodeId, 0};
    }
    // A container.
    if (b < n->contentBegin) {
        return ModelPoint{n->nodeId, 0};
    }
    if (b >= n->contentEnd) {
        return end_of(map, static_cast<std::size_t>(index));
    }
    // Between the children: the next child starts at or after the byte ...
    const std::size_t next = first_entry_at(map, b);
    if (next < map.entries.size() && map.entries[next].parent == index) {
        return ModelPoint{map.entries[next].nodeId, 0};
    }
    // ... else the end of the previous child, the ancestor of the anchor right below n.
    int previous = anchor;
    while (previous >= 0 && map.entries[static_cast<std::size_t>(previous)].parent != index) {
        previous = map.entries[static_cast<std::size_t>(previous)].parent;
    }
    if (previous < 0 || previous == index) {
        return ModelPoint{n->nodeId, 0};
    }
    return end_of(map, static_cast<std::size_t>(previous));
}

}  // namespace mfbe::fb2
