// Clean-room MOBI 7, joint MOBI 7 + KF8, KF8 (.azw3), and PalmDOC container reader (T027).
#include "mobi/mobi_reader.hpp"

#include "mobi/compression.hpp"
#include "mobi/exth.hpp"
#include "mobi/indx.hpp"
#include "mobi/palmdb.hpp"

#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>
#include <mfbe/single_byte.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <set>
#include <unordered_map>

namespace mfbe::mobi {
namespace {

constexpr std::uint32_t kInvalidIndex = 0xFFFFFFFFU;

std::string trim_ascii(std::string_view s) {
    while (!s.empty() && (s.front() == '\0' || std::isspace(static_cast<unsigned char>(s.front())))) {
        s.remove_prefix(1);
    }
    while (!s.empty() && (s.back() == '\0' || std::isspace(static_cast<unsigned char>(s.back())))) {
        s.remove_suffix(1);
    }
    return std::string(s);
}

bool is_valid_utf8(std::string_view s) {
    std::size_t i = 0;
    const std::size_t n = s.size();
    while (i < n) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        if (c < 0x80U) {
            ++i;
            continue;
        }
        std::size_t len = 0;
        std::uint32_t cp = 0;
        if ((c & 0xE0U) == 0xC0U) {
            len = 2;
            cp = c & 0x1FU;
        } else if ((c & 0xF0U) == 0xE0U) {
            len = 3;
            cp = c & 0x0FU;
        } else if ((c & 0xF8U) == 0xF0U) {
            len = 4;
            cp = c & 0x07U;
        } else {
            return false;
        }
        if (i + len > n) {
            return false;
        }
        for (std::size_t k = 1; k < len; ++k) {
            const unsigned char cc = static_cast<unsigned char>(s[i + k]);
            if ((cc & 0xC0U) != 0x80U) {
                return false;
            }
            cp = (cp << 6) | (cc & 0x3FU);
        }
        if ((len == 2 && cp < 0x80U) || (len == 3 && cp < 0x800U) || (len == 4 && cp < 0x10000U) ||
            cp > 0x10FFFFU || (cp >= 0xD800U && cp <= 0xDFFFU)) {
            return false;
        }
        i += len;
    }
    return true;
}

std::string decode_cp1252(std::string_view raw) {
    if (raw.empty()) {
        return {};
    }
    auto decoded = text::decode_single_byte(raw, "windows-1252");
    return decoded ? std::move(*decoded) : std::string(raw);
}

// Decodes Windows-1252 to UTF-8 while recording a mapping from raw byte index -> UTF-8 byte index.
std::string decode_cp1252_with_map(std::string_view raw, std::vector<std::size_t>& offset_map) {
    offset_map.resize(raw.size() + 1);
    const std::uint16_t* high = text::single_byte_high("windows-1252");
    std::string out;
    out.reserve(raw.size() + raw.size() / 8);
    for (std::size_t i = 0; i < raw.size(); ++i) {
        offset_map[i] = out.size();
        const unsigned char b = static_cast<unsigned char>(raw[i]);
        if (b < 0x80U) {
            out.push_back(static_cast<char>(b));
        } else {
            std::uint32_t cp = (high != nullptr) ? high[b - 0x80U] : 0U;
            if (cp == 0U) {
                cp = 0xFFFDU;
            }
            if (cp < 0x80U) {
                out.push_back(static_cast<char>(cp));
            } else if (cp < 0x800U) {
                out.push_back(static_cast<char>(0xC0U | (cp >> 6)));
                out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
            } else {
                out.push_back(static_cast<char>(0xE0U | (cp >> 12)));
                out.push_back(static_cast<char>(0x80U | ((cp >> 6) & 0x3FU)));
                out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
            }
        }
    }
    offset_map[raw.size()] = out.size();
    return out;
}

std::string ensure_utf8_text(std::string_view raw, bool prefer_1252) {
    if (!prefer_1252 && is_valid_utf8(raw)) {
        return std::string(raw);
    }
    if (prefer_1252) {
        return decode_cp1252(raw);
    }
    return decode_cp1252(raw);
}

bool is_control_record(std::string_view rec) {
    if (rec.size() == 4 && rec[0] == '\xE9' && rec[1] == '\x8E' && rec[2] == '\x0D' &&
        rec[3] == '\x0A') {
        return true;
    }
    if (rec == kBoundaryRecord) {
        return true;
    }
    if (rec.size() >= 4) {
        const std::string_view mag = rec.substr(0, 4);
        if (mag == "FLIS" || mag == "FCIS" || mag == "INDX" || mag == "FDST" || mag == "RESC" ||
            mag == "DATP" || mag == "SRCS" || mag == "CRES" || mag == "FONT" || mag == "AUDI" ||
            mag == "VIDE" || mag == "HUFF" || mag == "CDIC") {
            return true;
        }
    }
    return false;
}

bool looks_like_svg(std::string_view data) {
    std::size_t pos = 0;
    if (data.size() >= 3 && static_cast<unsigned char>(data[0]) == 0xEF &&
        static_cast<unsigned char>(data[1]) == 0xBB && static_cast<unsigned char>(data[2]) == 0xBF) {
        pos = 3;
    }
    while (pos < data.size() && std::isspace(static_cast<unsigned char>(data[pos]))) {
        ++pos;
    }
    const std::string_view head = data.substr(pos, 512);
    return head.rfind("<svg", 0) == 0 ||
           (head.rfind("<?xml", 0) == 0 && head.find("<svg") != std::string_view::npos);
}

std::optional<std::uint64_t> parse_base32(std::string_view s) {
    if (s.empty() || s.size() > 12) {
        return std::nullopt;
    }
    std::uint64_t val = 0;
    for (char c : s) {
        std::uint64_t digit = 0;
        if (c >= '0' && c <= '9') {
            digit = static_cast<std::uint64_t>(c - '0');
        } else if (c >= 'A' && c <= 'V') {
            digit = static_cast<std::uint64_t>(10 + (c - 'A'));
        } else if (c >= 'a' && c <= 'v') {
            digit = static_cast<std::uint64_t>(10 + (c - 'a'));
        } else {
            return std::nullopt;
        }
        val = (val << 5) | digit;
    }
    return val;
}

std::string format_fp_anchor(std::size_t off) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "mfbe-fp-%010zu", off);
    return std::string(buf);
}

// Extracts an existing id="..." or name="..." on the opening tag starting at `pos` (if any).
std::optional<std::string> existing_id_at_tag(std::string_view html, std::size_t pos) {
    if (pos >= html.size() || html[pos] != '<' ||
        (pos + 1 < html.size() && (html[pos + 1] == '/' || html[pos + 1] == '!' || html[pos + 1] == '?'))) {
        return std::nullopt;
    }
    const std::size_t gt = html.find('>', pos + 1);
    if (gt == std::string_view::npos || gt - pos > 2048) {
        return std::nullopt;
    }
    const std::string_view tag = html.substr(pos, gt - pos);
    for (const std::string_view attr : {" id=\"", " id='", " name=\"", " name='"}) {
        const std::size_t found = tag.find(attr);
        if (found != std::string_view::npos) {
            const char quote = attr.back();
            const std::size_t val_start = found + attr.size();
            const std::size_t val_end = tag.find(quote, val_start);
            if (val_end != std::string_view::npos && val_end > val_start) {
                return std::string(tag.substr(val_start, val_end - val_start));
            }
        }
    }
    return std::nullopt;
}

// Finds a safe insertion byte offset in `html` at or just before `pos`: never inside a `<tag...>`
// or mid UTF-8 multibyte sequence.
std::size_t safe_anchor_position(std::string_view html, std::size_t pos) {
    if (pos > html.size()) {
        pos = html.size();
    }
    // Step back from UTF-8 continuation bytes
    while (pos > 0 && pos < html.size() && (static_cast<unsigned char>(html[pos]) & 0xC0U) == 0x80U) {
        --pos;
    }
    // Check if inside an open tag `<...>` by searching backwards for '<' or '>'
    for (std::size_t i = pos; i > 0; --i) {
        const char ch = html[i - 1];
        if (ch == '>') {
            break;
        }
        if (ch == '<') {
            return i - 1;
        }
    }
    return pos;
}

// Rewrites <mbp:pagebreak/> (and variants) into <hr class="mfbe-pagebreak"/>.
std::string normalize_pagebreaks(std::string_view html) {
    std::string out;
    out.reserve(html.size());
    std::size_t pos = 0;
    while (pos < html.size()) {
        const std::size_t lt = html.find('<', pos);
        if (lt == std::string_view::npos) {
            out.append(html.substr(pos));
            break;
        }
        out.append(html.substr(pos, lt - pos));
        // Case-insensitive match for "<mbp:pagebreak"
        bool match = false;
        if (lt + 14 <= html.size()) {
            static constexpr std::string_view kTag = "<mbp:pagebreak";
            match = true;
            for (std::size_t k = 0; k < kTag.size(); ++k) {
                if (std::tolower(static_cast<unsigned char>(html[lt + k])) != kTag[k]) {
                    match = false;
                    break;
                }
            }
        }
        if (match) {
            const std::size_t gt = html.find('>', lt + 14);
            if (gt != std::string_view::npos) {
                out.append("<hr class=\"mfbe-pagebreak\"/>");
                pos = gt + 1;
                continue;
            }
        }
        out.push_back('<');
        pos = lt + 1;
    }
    return out;
}

// Scans MOBI 7 HTML for `filepos=...` references, injects synthetic `<a id="mfbe-fp-..."></a>`
// anchors (or reuses existing element `id`s), rewrites `filepos=...` to `href="#..."`, and
// updates navigation & guide entries with resolved anchor IDs.
std::string rewrite_mobi7_filepos(std::string_view utf8_html,
                                  const std::vector<std::size_t>* raw_to_utf8_map,
                                  std::vector<MobiNavEntry>& nav,
                                  std::vector<MobiGuideEntry>& guide) {
    auto map_offset = [&](std::size_t raw_off) -> std::size_t {
        if (raw_to_utf8_map != nullptr && !raw_to_utf8_map->empty()) {
            const std::size_t clamped = std::min(raw_off, raw_to_utf8_map->size() - 1);
            return (*raw_to_utf8_map)[clamped];
        }
        return std::min(raw_off, utf8_html.size());
    };

    struct FileposMatch {
        std::size_t attr_start = 0;
        std::size_t attr_end = 0;
        std::size_t raw_offset = 0;
    };
    std::vector<FileposMatch> matches;
    std::set<std::size_t> target_utf8_offsets;

    // 1. Collect all `filepos=...` occurrences inside tags.
    std::size_t scan = 0;
    while (scan < utf8_html.size()) {
        const std::size_t lt = utf8_html.find('<', scan);
        if (lt == std::string_view::npos) {
            break;
        }
        const std::size_t gt = utf8_html.find('>', lt + 1);
        if (gt == std::string_view::npos) {
            break;
        }
        // Search inside tag [lt, gt) for "filepos" case-insensitively.
        for (std::size_t p = lt + 1; p + 8 <= gt; ++p) {
            if (!std::isspace(static_cast<unsigned char>(utf8_html[p - 1]))) {
                continue;
            }
            static constexpr std::string_view kFp = "filepos";
            bool eq = true;
            for (std::size_t k = 0; k < kFp.size(); ++k) {
                if (std::tolower(static_cast<unsigned char>(utf8_html[p + k])) != kFp[k]) {
                    eq = false;
                    break;
                }
            }
            if (!eq) {
                continue;
            }
            std::size_t q = p + kFp.size();
            while (q < gt && std::isspace(static_cast<unsigned char>(utf8_html[q]))) ++q;
            if (q >= gt || utf8_html[q] != '=') {
                continue;
            }
            ++q;
            while (q < gt && std::isspace(static_cast<unsigned char>(utf8_html[q]))) ++q;
            char quote = '\0';
            if (q < gt && (utf8_html[q] == '"' || utf8_html[q] == '\'')) {
                quote = utf8_html[q++];
            }
            const std::size_t num_start = q;
            while (q < gt && std::isdigit(static_cast<unsigned char>(utf8_html[q]))) ++q;
            const std::size_t num_end = q;
            if (quote != '\0' && q < gt && utf8_html[q] == quote) {
                ++q;
            }
            if (num_end > num_start) {
                std::size_t off = 0;
                for (std::size_t d = num_start; d < num_end; ++d) {
                    off = off * 10U + static_cast<std::size_t>(utf8_html[d] - '0');
                }
                matches.push_back(FileposMatch{p, q, off});
                target_utf8_offsets.insert(safe_anchor_position(utf8_html, map_offset(off)));
            }
        }
        scan = gt + 1;
    }

    // 2. Collect nav & guide target positions.
    for (const auto& n : nav) {
        target_utf8_offsets.insert(safe_anchor_position(utf8_html, map_offset(n.offset)));
    }
    for (const auto& g : guide) {
        target_utf8_offsets.insert(safe_anchor_position(utf8_html, map_offset(g.offset)));
    }

    // 3. Map each target UTF-8 offset -> anchor ID (reusing existing element id if present).
    std::map<std::size_t, std::string> offset_to_id;
    std::map<std::size_t, std::string> injections;  // positions needing synthetic `<a id="..."></a>`
    for (const std::size_t pos : target_utf8_offsets) {
        if (auto existing = existing_id_at_tag(utf8_html, pos)) {
            offset_to_id.emplace(pos, std::move(*existing));
        } else {
            const std::string id = format_fp_anchor(pos);
            offset_to_id.emplace(pos, id);
            injections.emplace(pos, "<a id=\"" + id + "\"></a>");
        }
    }

    for (auto& n : nav) {
        const std::size_t pos = safe_anchor_position(utf8_html, map_offset(n.offset));
        if (auto it = offset_to_id.find(pos); it != offset_to_id.end()) {
            n.anchor_id = it->second;
        }
    }
    for (auto& g : guide) {
        const std::size_t pos = safe_anchor_position(utf8_html, map_offset(g.offset));
        if (auto it = offset_to_id.find(pos); it != offset_to_id.end()) {
            g.anchor_id = it->second;
        }
    }

    // 4. Build rewritten HTML in a single ordered pass combining attribute replacements & anchor insertions.
    struct Edit {
        std::size_t start = 0;
        std::size_t end = 0;
        std::string replacement;
    };
    std::vector<Edit> edits;
    edits.reserve(matches.size() + injections.size());
    for (const auto& m : matches) {
        const std::size_t pos = safe_anchor_position(utf8_html, map_offset(m.raw_offset));
        const std::string& id = offset_to_id[pos];
        edits.push_back(Edit{m.attr_start, m.attr_end, "href=\"#" + id + "\""});
    }
    for (const auto& [pos, snippet] : injections) {
        edits.push_back(Edit{pos, pos, snippet});
    }
    std::sort(edits.begin(), edits.end(), [](const Edit& a, const Edit& b) {
        if (a.start != b.start) return a.start < b.start;
        return a.end < b.end;
    });

    std::string out;
    out.reserve(utf8_html.size() + edits.size() * 24);
    std::size_t cursor = 0;
    for (const auto& e : edits) {
        if (e.start < cursor) {
            continue;
        }
        out.append(utf8_html.substr(cursor, e.start - cursor));
        out.append(e.replacement);
        cursor = e.end;
    }
    out.append(utf8_html.substr(cursor));
    return normalize_pagebreaks(out);
}

// Reassembles KF8 HTML from Flow[0] using SKEL + FRAG tables, keeping a fid -> base offset map
// in the reassembled HTML so `kindle:pos:fid:XXXX:off:YYYYYYYYYY` and NCX/GUIDE entries resolve.
struct ReassembledKf8 {
    std::string html;
    std::unordered_map<std::uint32_t, std::size_t> fid_base_offsets;
};

ReassembledKf8 reassemble_kf8_flow0(std::string_view flow0, const Kf8SkelFragData& sf) {
    ReassembledKf8 res;
    if (sf.skels.empty() || sf.frags.empty()) {
        res.html = std::string(flow0);
        res.fid_base_offsets[0] = 0;
        return res;
    }

    // Group fragments by skeleton_index.
    std::unordered_map<std::uint32_t, std::vector<std::size_t>> skel_frags;
    for (std::size_t fi = 0; fi < sf.frags.size(); ++fi) {
        skel_frags[sf.frags[fi].skeleton_index].push_back(fi);
    }

    std::vector<std::string> assembled_skels;
    std::vector<std::vector<std::pair<std::uint32_t, std::size_t>>> skel_fid_local_offsets;
    assembled_skels.reserve(sf.skels.size());
    skel_fid_local_offsets.resize(sf.skels.size());

    for (std::size_t si = 0; si < sf.skels.size(); ++si) {
        const auto& sk = sf.skels[si];
        if (sk.start_pos > flow0.size() || sk.start_pos + sk.length > flow0.size()) {
            continue;
        }
        std::string doc(flow0.substr(sk.start_pos, sk.length));
        const std::size_t frag_pool_base = static_cast<std::size_t>(sk.start_pos) + sk.length;
        const auto it = skel_frags.find(static_cast<std::uint32_t>(si));
        if (it != skel_frags.end()) {
            // Compute insertion position inside `doc` for each fragment of this skeleton.
            struct PendingFrag {
                std::size_t fid = 0;
                std::size_t insert_in_skel = 0;
                std::string_view content;
            };
            std::vector<PendingFrag> pending;
            for (const std::size_t fi : it->second) {
                const auto& fr = sf.frags[fi];
                std::size_t f_start = frag_pool_base + fr.start_pos;
                if (f_start + fr.length > flow0.size()) {
                    // Fallback: treat start_pos as absolute in flow0 if relative overflows
                    if (fr.start_pos + fr.length <= flow0.size()) {
                        f_start = fr.start_pos;
                    } else {
                        continue;
                    }
                }
                // Fragment key (`aid`) is decimal absolute insert position in skeleton (Calibre & MFBE).
                std::size_t insert_at = fr.insert_pos;
                if (!fr.aid.empty() &&
                    std::all_of(fr.aid.begin(), fr.aid.end(),
                                [](unsigned char c) { return std::isdigit(c); })) {
                    std::size_t parsed = 0;
                    for (char c : fr.aid) {
                        parsed = parsed * 10U + static_cast<std::size_t>(c - '0');
                    }
                    if (parsed >= sk.start_pos && parsed - sk.start_pos <= doc.size()) {
                        insert_at = parsed - sk.start_pos;
                    }
                }
                if (insert_at > doc.size()) {
                    const std::size_t bc = doc.rfind("</body>");
                    insert_at = (bc != std::string::npos) ? bc : doc.size();
                }
                pending.push_back(PendingFrag{fi, insert_at, flow0.substr(f_start, fr.length)});
            }
            // Sort stably by insert_in_skel, insert cumulatively so offsets shift accurately.
            std::stable_sort(pending.begin(), pending.end(),
                             [](const PendingFrag& a, const PendingFrag& b) {
                                 return a.insert_in_skel < b.insert_in_skel;
                             });
            std::string merged;
            merged.reserve(doc.size() + 4096);
            std::size_t doc_pos = 0;
            for (const auto& pf : pending) {
                if (pf.insert_in_skel > doc_pos) {
                    merged.append(doc.data() + doc_pos, pf.insert_in_skel - doc_pos);
                    doc_pos = pf.insert_in_skel;
                }
                const std::size_t placed_at = merged.size();
                merged.append(pf.content);
                skel_fid_local_offsets[si].emplace_back(static_cast<std::uint32_t>(pf.fid),
                                                        placed_at);
            }
            merged.append(doc.data() + doc_pos, doc.size() - doc_pos);
            doc = std::move(merged);
        }
        assembled_skels.push_back(std::move(doc));
    }

    if (assembled_skels.empty()) {
        res.html = std::string(flow0);
        res.fid_base_offsets[0] = 0;
        return res;
    }

    if (assembled_skels.size() == 1) {
        // Single-skeleton KF8 (matches MobiWriter byte-for-byte!).
        res.html = std::move(assembled_skels[0]);
        for (const auto& [fid, local_off] : skel_fid_local_offsets[0]) {
            res.fid_base_offsets[fid] = local_off;
        }
        return res;
    }

    // Multi-skeleton KF8 (Calibre / KindleGen): splice subsequent skeletons' <body> inner HTML
    // right before the first skeleton's closing </body>, separated by a pagebreak marker.
    std::string combined = std::move(assembled_skels[0]);
    for (const auto& [fid, local_off] : skel_fid_local_offsets[0]) {
        res.fid_base_offsets[fid] = local_off;
    }
    std::size_t tail_pos = combined.rfind("</body>");
    std::string suffix;
    if (tail_pos != std::string::npos) {
        suffix = combined.substr(tail_pos);
        combined.resize(tail_pos);
    }
    for (std::size_t si = 1; si < assembled_skels.size(); ++si) {
        combined.append("<hr class=\"mfbe-pagebreak\"/>");
        const std::string& sk = assembled_skels[si];
        std::size_t bopen = sk.find("<body");
        std::size_t inner_start = 0;
        if (bopen != std::string::npos) {
            const std::size_t bgt = sk.find('>', bopen);
            if (bgt != std::string::npos) {
                inner_start = bgt + 1;
            }
        }
        std::size_t inner_end = sk.rfind("</body>");
        if (inner_end == std::string::npos || inner_end < inner_start) {
            inner_end = sk.size();
        }
        const std::size_t placed_base = combined.size();
        combined.append(sk.data() + inner_start, inner_end - inner_start);
        for (const auto& [fid, local_off] : skel_fid_local_offsets[si]) {
            const std::size_t adjusted =
                (local_off >= inner_start) ? (placed_base + (local_off - inner_start)) : placed_base;
            res.fid_base_offsets[fid] = adjusted;
        }
    }
    combined.append(suffix);
    res.html = std::move(combined);
    return res;
}

// Resolves `kindle:pos:fid:XXXX:off:YYYYYYYYYY` links and KF8 NCX/GUIDE fid+off entries to `#id`.
std::string rewrite_kf8_positions(std::string_view html,
                                  const std::unordered_map<std::uint32_t, std::size_t>& fid_bases,
                                  std::vector<MobiNavEntry>& nav,
                                  std::vector<MobiGuideEntry>& guide) {
    auto resolve_pos = [&](std::uint32_t fid, std::uint32_t off) -> std::size_t {
        std::size_t base = 0;
        if (auto it = fid_bases.find(fid); it != fid_bases.end()) {
            base = it->second;
        }
        // Special case: single-skeleton document where fid==0 & base > 0, check whether `off`
        // was written relative to document start (like MobiWriter) or relative to fragment start.
        if (fid == 0 && base > 0 && off >= base && off < html.size() &&
            existing_id_at_tag(html, off).has_value()) {
            return off;
        }
        const std::size_t candidate = base + off;
        if (candidate < html.size()) {
            return safe_anchor_position(html, candidate);
        }
        return safe_anchor_position(html, std::min<std::size_t>(off, html.size()));
    };

    struct PosRef {
        std::size_t start = 0;
        std::size_t end = 0;
        std::size_t target = 0;
    };
    std::vector<PosRef> refs;
    std::set<std::size_t> targets;

    static constexpr std::string_view kPrefix = "kindle:pos:fid:";
    std::size_t scan = 0;
    while (scan < html.size()) {
        const std::size_t at = html.find(kPrefix, scan);
        if (at == std::string_view::npos) {
            break;
        }
        const std::size_t fid_start = at + kPrefix.size();
        const std::size_t off_tag = html.find(":off:", fid_start);
        if (off_tag == std::string_view::npos || off_tag - fid_start > 8) {
            scan = fid_start;
            continue;
        }
        const std::size_t off_start = off_tag + 5;
        std::size_t off_end = off_start;
        while (off_end < html.size() &&
               (std::isalnum(static_cast<unsigned char>(html[off_end])) != 0)) {
            ++off_end;
        }
        const auto fid = parse_base32(html.substr(fid_start, off_tag - fid_start));
        const auto off = parse_base32(html.substr(off_start, off_end - off_start));
        if (fid.has_value() && off.has_value()) {
            const std::size_t tgt = resolve_pos(static_cast<std::uint32_t>(*fid),
                                                static_cast<std::uint32_t>(*off));
            refs.push_back(PosRef{at, off_end, tgt});
            targets.insert(tgt);
        }
        scan = off_end;
    }

    for (const auto& n : nav) {
        const std::size_t tgt =
            (n.fid > 0 || n.fid_offset > 0) ? resolve_pos(n.fid, n.fid_offset)
                                            : safe_anchor_position(html, n.offset);
        targets.insert(tgt);
    }
    for (const auto& g : guide) {
        const std::size_t tgt =
            (g.fid > 0 || g.fid_offset > 0) ? resolve_pos(g.fid, g.fid_offset)
                                            : safe_anchor_position(html, g.offset);
        targets.insert(tgt);
    }

    std::map<std::size_t, std::string> offset_to_id;
    std::map<std::size_t, std::string> injections;
    for (const std::size_t pos : targets) {
        if (auto existing = existing_id_at_tag(html, pos)) {
            offset_to_id.emplace(pos, std::move(*existing));
        } else {
            const std::string id = format_fp_anchor(pos);
            offset_to_id.emplace(pos, id);
            injections.emplace(pos, "<a id=\"" + id + "\"></a>");
        }
    }

    for (auto& n : nav) {
        const std::size_t tgt =
            (n.fid > 0 || n.fid_offset > 0) ? resolve_pos(n.fid, n.fid_offset)
                                            : safe_anchor_position(html, n.offset);
        if (auto it = offset_to_id.find(tgt); it != offset_to_id.end()) {
            n.anchor_id = it->second;
        }
    }
    for (auto& g : guide) {
        const std::size_t tgt =
            (g.fid > 0 || g.fid_offset > 0) ? resolve_pos(g.fid, g.fid_offset)
                                            : safe_anchor_position(html, g.offset);
        if (auto it = offset_to_id.find(tgt); it != offset_to_id.end()) {
            g.anchor_id = it->second;
        }
    }

    if (refs.empty() && injections.empty()) {
        return std::string(html);
    }

    struct Edit {
        std::size_t start = 0;
        std::size_t end = 0;
        std::string replacement;
    };
    std::vector<Edit> edits;
    edits.reserve(refs.size() + injections.size());
    for (const auto& r : refs) {
        edits.push_back(Edit{r.start, r.end, "#" + offset_to_id[r.target]});
    }
    for (const auto& [pos, snippet] : injections) {
        edits.push_back(Edit{pos, pos, snippet});
    }
    std::sort(edits.begin(), edits.end(), [](const Edit& a, const Edit& b) {
        if (a.start != b.start) return a.start < b.start;
        return a.end < b.end;
    });

    std::string out;
    out.reserve(html.size() + edits.size() * 20);
    std::size_t cursor = 0;
    for (const auto& e : edits) {
        if (e.start < cursor) {
            continue;
        }
        out.append(html.substr(cursor, e.start - cursor));
        out.append(e.replacement);
        cursor = e.end;
    }
    out.append(html.substr(cursor));
    return out;
}

std::vector<MobiReadPicture> extract_pictures(const PalmDb& pdb, std::size_t pic_start,
                                              std::size_t pic_limit_end) {
    std::vector<MobiReadPicture> pics;
    if (pic_start >= pdb.records.size() || pic_start >= pic_limit_end) {
        return pics;
    }
    const std::size_t end = std::min(pic_limit_end, pdb.records.size());
    for (std::size_t r = pic_start; r < end; ++r) {
        const std::string& rec = pdb.records[r];
        if (is_control_record(rec)) {
            break;
        }
        if (rec.empty()) {
            continue;
        }
        const std::uint32_t idx = static_cast<std::uint32_t>((r - pic_start) + 1U);
        MobiReadPicture pic;
        pic.index = idx;
        pic.bytes = rec;
        pic.size = rec.size();

        if (looks_like_svg(rec)) {
            pic.content_type = "image/svg+xml";
        } else {
            const images::Probe probe = images::probe(rec);
            pic.content_type = probe.contentType;
            pic.width = probe.width;
            pic.height = probe.height;
            if (probe.width && probe.height) {
                const std::uint64_t pixels =
                    static_cast<std::uint64_t>(*probe.width) * static_cast<std::uint64_t>(*probe.height);
                if (pixels > static_cast<std::uint64_t>(images::kMaxPixels)) {
                    pic.too_large = true;
                }
            }
        }
        pics.push_back(std::move(pic));
    }
    return pics;
}

struct ParsedPart {
    bool is_kf8 = false;
    std::string encoding;
    std::string html;
    std::vector<std::string> css_flows;
    std::vector<MobiReadPicture> pictures;
    std::optional<std::uint32_t> cover_index;
    std::optional<std::uint32_t> thumbnail_index;
    MobiMetadata metadata;
    std::vector<MobiNavEntry> navigation;
    std::vector<MobiGuideEntry> guide;
    MfbeDecodeResult mfbe;
    std::optional<std::uint32_t> kf8_boundary_rec;
    std::optional<std::size_t> first_image_abs;
    std::optional<std::size_t> image_limit_abs;
};

ParsedPart parse_mobi_part(const PalmDb& pdb, std::size_t base_rec,
                           std::optional<std::size_t> shared_pic_start,
                           std::optional<std::size_t> shared_pic_end,
                           const ReadProgressFn& progress, const ReadCancelFn& check_cancelled) {
    if (check_cancelled) check_cancelled();
    if (base_rec >= pdb.records.size()) {
        throw MobiError("damaged", "MOBI header record index out of bounds");
    }
    const std::string_view r0 = pdb.records[base_rec];
    if (r0.size() < 132 || r0.substr(16, 4) != "MOBI") {
        throw MobiError("notMobi", "missing MOBI header magic");
    }

    const std::uint16_t compression = read_u16_be(r0, 0);
    const std::uint32_t text_length = read_u32_be(r0, 4);
    const std::uint16_t text_rec_cnt = read_u16_be(r0, 8);
    const std::uint16_t encryption = read_u16_be(r0, 12);

    // Immediate DRM refusal (FR-033): never attempt decryption or bypass.
    if (encryption != 0U) {
        throw MobiError("encrypted", "MOBI encryption is enabled");
    }

    const std::uint32_t header_len = read_u32_be(r0, 20);
    if (header_len < 116U || 16ULL + header_len > r0.size()) {
        throw MobiError("damaged", "MOBI header length out of bounds");
    }

    if (header_len >= 168U && r0.size() >= 184U) {
        const std::uint32_t drm_off = read_u32_be(r0, 168);
        const std::uint32_t drm_cnt = read_u32_be(r0, 172);
        const std::uint32_t drm_size = read_u32_be(r0, 176);
        if (drm_off != kInvalidIndex && drm_cnt > 0U && drm_size > 0U) {
            throw MobiError("encrypted", "MOBI DRM header present");
        }
    }

    const std::uint32_t text_encoding = read_u32_be(r0, 28);
    const std::uint32_t file_version = read_u32_be(r0, 36);
    const std::uint32_t full_name_off = read_u32_be(r0, 84);
    const std::uint32_t full_name_len = read_u32_be(r0, 88);
    const std::uint32_t locale = read_u32_be(r0, 92);
    const std::uint32_t first_img_rel = read_u32_be(r0, 108);
    const std::uint32_t huff_off = read_u32_be(r0, 112);
    const std::uint32_t huff_cnt = read_u32_be(r0, 116);
    const std::uint32_t exth_flags = read_u32_be(r0, 128);

    const std::uint32_t fdst_rel =
        (header_len >= 184U && r0.size() >= 200U) ? read_u32_be(r0, 192) : kInvalidIndex;
    const std::uint32_t fdst_cnt =
        (header_len >= 184U && r0.size() >= 200U) ? read_u32_be(r0, 196) : 0U;
    const std::uint32_t extra_data_flags =
        (header_len >= 228U && r0.size() >= 244U) ? read_u32_be(r0, 240) : 0U;
    const std::uint32_t ncx_rel =
        (header_len >= 232U && r0.size() >= 248U) ? read_u32_be(r0, 244) : kInvalidIndex;
    const std::uint32_t frag_rel =
        (header_len >= 236U && r0.size() >= 252U) ? read_u32_be(r0, 248) : kInvalidIndex;
    const std::uint32_t skel_rel =
        (header_len >= 240U && r0.size() >= 256U) ? read_u32_be(r0, 252) : kInvalidIndex;
    const std::uint32_t guide_rel =
        (header_len >= 248U && r0.size() >= 264U) ? read_u32_be(r0, 260) : kInvalidIndex;

    const bool prefer_1252 = (text_encoding == 1252U);

    std::string header_title;
    if (full_name_len > 0U && full_name_off + full_name_len <= r0.size()) {
        header_title = ensure_utf8_text(r0.substr(full_name_off, full_name_len), prefer_1252);
    } else {
        header_title = ensure_utf8_text(pdb.name, prefer_1252);
    }

    // Parse EXTH block if present.
    std::vector<ExthEntry> exth;
    std::optional<std::string_view> raw_mfbe_payload;
    std::optional<std::uint32_t> cover_off;
    std::optional<std::uint32_t> thumb_off;
    std::optional<std::uint32_t> kf8_boundary;
    std::optional<std::uint32_t> resource_count_exth;
    if ((exth_flags & 0x40U) != 0U && 16ULL + header_len + 12ULL <= r0.size() &&
        r0.substr(16U + header_len, 4) == "EXTH") {
        exth = parse_exth(r0.substr(16U + header_len));
        for (auto& e : exth) {
            if (e.type == 209U && !e.data.empty()) {
                throw MobiError("encrypted", "DRM tamper-proof keys EXTH 209 present");
            }
            if (e.type == 121U && e.data.size() == 4) {
                kf8_boundary = read_u32_be(e.data, 0);
            } else if (e.type == 125U && e.data.size() == 4) {
                resource_count_exth = read_u32_be(e.data, 0);
            } else if (e.type == 201U && e.data.size() == 4) {
                const std::uint32_t v = read_u32_be(e.data, 0);
                if (v != kInvalidIndex) cover_off = v;
            } else if (e.type == 202U && e.data.size() == 4) {
                const std::uint32_t v = read_u32_be(e.data, 0);
                if (v != kInvalidIndex) thumb_off = v;
            } else if (e.type == kExthMfbeType) {
                raw_mfbe_payload = e.data;
            } else if (prefer_1252 &&
                       (e.type == 100U || e.type == 101U || e.type == 103U || e.type == 104U ||
                        e.type == 105U || e.type == 106U || e.type == 108U || e.type == 109U ||
                        e.type == 112U || e.type == 503U || e.type == 524U)) {
                e.data = ensure_utf8_text(e.data, true);
            }
        }
    }

    ParsedPart part;
    part.is_kf8 = (file_version >= 8U);
    part.kf8_boundary_rec = kf8_boundary;
    part.metadata = metadata_from_exth(exth, header_title, locale);

    if (progress) progress("decompress", 1, 3);
    if (check_cancelled) check_cancelled();

    // Validate and decompress text records.
    if (base_rec + 1U + text_rec_cnt > pdb.records.size()) {
        throw MobiError("damaged", "text record count exceeds PalmDB records");
    }
    std::vector<std::string_view> text_recs;
    text_recs.reserve(text_rec_cnt);
    for (std::uint16_t i = 0; i < text_rec_cnt; ++i) {
        text_recs.push_back(pdb.records[base_rec + 1U + i]);
    }

    std::string raw_stream;
    if (compression == 17480U) {
        if (huff_cnt < 2U || base_rec + huff_off + huff_cnt > pdb.records.size()) {
            throw MobiError("damaged", "HUFF/CDIC record range out of bounds");
        }
        std::vector<std::string_view> huff_recs;
        huff_recs.reserve(huff_cnt);
        for (std::uint32_t i = 0; i < huff_cnt; ++i) {
            huff_recs.push_back(pdb.records[base_rec + huff_off + i]);
        }
        const HuffCdicDecoder huff = HuffCdicDecoder::parse(huff_recs);
        raw_stream =
            decompress_text_records(compression, text_recs, extra_data_flags, text_length, &huff);
    } else {
        raw_stream =
            decompress_text_records(compression, text_recs, extra_data_flags, text_length, nullptr);
    }

    if (progress) progress("index", 2, 3);
    if (check_cancelled) check_cancelled();

    // Build part-local view slice starting at `base_rec`.
    std::vector<std::string_view> part_views;
    part_views.reserve(pdb.records.size() - base_rec);
    for (std::size_t i = base_rec; i < pdb.records.size(); ++i) {
        part_views.push_back(pdb.records[i]);
    }

    // Parse native NCX navigation index if present (non-fatal if absent/corrupt in foreign MOBIs).
    if (ncx_rel != kInvalidIndex && ncx_rel < part_views.size()) {
        try {
            part.navigation = parse_ncx_indx(part_views, ncx_rel);
        } catch (const MobiError&) {
            part.navigation.clear();
        }
    }

    if (part.is_kf8) {
        // Parse FDST flows.
        std::string flow0_raw;
        std::vector<std::string> extra_flows;
        if (fdst_rel != kInvalidIndex && fdst_cnt > 0U && fdst_rel < part_views.size() &&
            part_views[fdst_rel].substr(0, 4) == "FDST") {
            const auto flows = parse_fdst(part_views[fdst_rel], raw_stream.size());
            if (!flows.empty()) {
                flow0_raw = raw_stream.substr(flows[0].first, flows[0].second - flows[0].first);
                for (std::size_t fi = 1; fi < flows.size(); ++fi) {
                    const std::string_view slice =
                        std::string_view(raw_stream)
                            .substr(flows[fi].first, flows[fi].second - flows[fi].first);
                    if (!slice.empty()) {
                        extra_flows.emplace_back(slice);
                    }
                }
            } else {
                flow0_raw = std::move(raw_stream);
            }
        } else {
            flow0_raw = std::move(raw_stream);
        }

        const bool use_1252 = prefer_1252 && !is_valid_utf8(flow0_raw);
        part.encoding = use_1252 ? "windows-1252" : "utf-8";
        std::string flow0 = use_1252 ? decode_cp1252(flow0_raw) : std::move(flow0_raw);

        for (const auto& ef : extra_flows) {
            // Keep textual CSS flows (skip binary/SVG/XML flows).
            if (looks_like_svg(ef)) {
                continue;
            }
            const bool has_nul = (ef.find('\0') != std::string::npos);
            if (!has_nul) {
                part.css_flows.push_back(use_1252 ? decode_cp1252(ef) : ef);
            }
        }

        // Parse SKEL + FRAG and GUIDE.
        Kf8SkelFragData sf;
        if (skel_rel != kInvalidIndex && frag_rel != kInvalidIndex && skel_rel < part_views.size() &&
            frag_rel < part_views.size()) {
            sf = parse_kf8_skel_frag(part_views, skel_rel, frag_rel);
        }
        if (guide_rel != kInvalidIndex && guide_rel < part_views.size()) {
            try {
                part.guide = parse_kf8_guide(part_views, guide_rel);
            } catch (const MobiError&) {
                part.guide.clear();
            }
        }

        auto reassembled = reassemble_kf8_flow0(flow0, sf);

        // Verify MFBE EXTH 59901 against the canonical reassembled HTML BEFORE rewriting links!
        if (raw_mfbe_payload.has_value()) {
            part.mfbe = decode_and_verify_mfbe(*raw_mfbe_payload, reassembled.html, part.metadata);
        }

        part.html = rewrite_kf8_positions(reassembled.html, reassembled.fid_base_offsets,
                                          part.navigation, part.guide);
    } else {
        // MOBI 7
        std::string utf8_html;
        std::vector<std::size_t> offset_map;
        const bool use_1252 = prefer_1252 && !is_valid_utf8(raw_stream);
        if (use_1252) {
            part.encoding = "windows-1252";
            utf8_html = decode_cp1252_with_map(raw_stream, offset_map);
        } else {
            part.encoding = "utf-8";
            utf8_html = std::move(raw_stream);
        }

        // Verify MFBE EXTH 59901 against the canonical MOBI 7 HTML BEFORE rewriting filepos!
        if (raw_mfbe_payload.has_value()) {
            part.mfbe = decode_and_verify_mfbe(*raw_mfbe_payload, utf8_html, part.metadata);
        }

        part.html = rewrite_mobi7_filepos(utf8_html, use_1252 ? &offset_map : nullptr,
                                          part.navigation, part.guide);
    }

    // Extract pictures (either shared MOBI 7 pool for joint KF8 or this part's own image pool).
    std::optional<std::size_t> pic_start;
    std::size_t pic_end = pdb.records.size();
    if (shared_pic_start.has_value()) {
        pic_start = shared_pic_start;
        if (shared_pic_end.has_value()) {
            pic_end = *shared_pic_end;
        }
    } else if (first_img_rel != kInvalidIndex && base_rec + first_img_rel < pdb.records.size()) {
        pic_start = base_rec + first_img_rel;
        if (resource_count_exth.has_value() && *resource_count_exth > 0U) {
            pic_end = std::min(pdb.records.size(), *pic_start + static_cast<std::size_t>(*resource_count_exth) + 4U);
        }
    }

    if (pic_start.has_value()) {
        part.first_image_abs = pic_start;
        part.image_limit_abs = pic_end;
        part.pictures = extract_pictures(pdb, *pic_start, pic_end);
    }

    auto has_pic_index = [&](std::uint32_t idx) {
        return std::any_of(part.pictures.begin(), part.pictures.end(),
                           [idx](const MobiReadPicture& p) { return p.index == idx; });
    };
    if (cover_off.has_value() && has_pic_index(*cover_off + 1U)) {
        part.cover_index = *cover_off + 1U;
    }
    if (thumb_off.has_value() && has_pic_index(*thumb_off + 1U)) {
        part.thumbnail_index = *thumb_off + 1U;
    }

    return part;
}

MobiReadResult part_to_result(ContainerKind kind, ParsedPart&& part, bool fell_back) {
    MobiReadResult out;
    out.container_kind = kind;
    out.active_part = part.is_kf8 ? "kf8" : "mobi7";
    out.fell_back_to_mobi7 = fell_back;
    out.encoding = std::move(part.encoding);
    out.html_bytes = std::move(part.html);
    out.css_flows = std::move(part.css_flows);
    out.pictures = std::move(part.pictures);
    out.cover_index = part.cover_index;
    out.thumbnail_index = part.thumbnail_index;
    out.metadata = std::move(part.metadata);
    out.navigation = std::move(part.navigation);
    out.guide = std::move(part.guide);
    out.mfbe_status = part.mfbe.status;
    out.mfbe_html_matches = part.mfbe.html_matches;
    out.mfbe_meta_matches = part.mfbe.meta_matches;
    out.mfbe_json = std::move(part.mfbe.json);
    return out;
}

}  // namespace

std::string container_kind_to_string(ContainerKind kind) {
    switch (kind) {
        case ContainerKind::mobi7:
            return "mobi7";
        case ContainerKind::joint:
            return "joint";
        case ContainerKind::kf8:
            return "kf8";
        case ContainerKind::palmdoc:
            return "palmdoc";
        case ContainerKind::kfx:
            return "kfx";
        case ContainerKind::fictionBook:
            return "fictionBook";
        case ContainerKind::unknown:
            break;
    }
    return "unknown";
}

std::string mfbe_status_to_string(MfbeStatus status) {
    switch (status) {
        case MfbeStatus::none:
            return "none";
        case MfbeStatus::valid:
            return "valid";
        case MfbeStatus::externally_modified:
            return "externallyModified";
        case MfbeStatus::corrupt:
            return "corrupt";
    }
    return "none";
}

MobiReadResult read_mobi_bytes(std::string_view bytes, const ReadProgressFn& progress,
                               const ReadCancelFn& check_cancelled) {
    if (check_cancelled) check_cancelled();
    if (bytes.size() > kMaxFileBytes) {
        throw MobiError("tooLarge", "file exceeds 150 MB limit");
    }
    if (progress) progress("open", 0, 3);

    const PalmDb pdb = read_palmdb(bytes);

    // Plain PalmDOC (TEXt / REAd)
    if (pdb.type == "TEXt" && pdb.creator == "REAd") {
        if (pdb.records.empty() || pdb.records[0].size() < 16) {
            throw MobiError("damaged", "truncated PalmDOC header");
        }
        const std::string_view r0 = pdb.records[0];
        const std::uint16_t comp = read_u16_be(r0, 0);
        const std::uint32_t text_len = read_u32_be(r0, 4);
        const std::uint16_t rec_cnt = read_u16_be(r0, 8);
        if (comp != 1U && comp != 2U) {
            throw MobiError("damaged", "unsupported PalmDOC compression");
        }
        if (1U + rec_cnt > pdb.records.size()) {
            throw MobiError("damaged", "PalmDOC record count out of bounds");
        }
        if (progress) progress("decompress", 1, 3);
        if (check_cancelled) check_cancelled();

        std::vector<std::string_view> trecs;
        trecs.reserve(rec_cnt);
        for (std::uint16_t i = 0; i < rec_cnt; ++i) {
            trecs.push_back(pdb.records[1U + i]);
        }
        const std::string raw = decompress_text_records(comp, trecs, 0U, text_len, nullptr);

        MobiReadResult res;
        res.container_kind = ContainerKind::palmdoc;
        res.active_part = "palmdoc";
        if (is_valid_utf8(raw)) {
            res.encoding = "utf-8";
            res.html_bytes = raw;
        } else {
            res.encoding = "windows-1252";
            res.html_bytes = decode_cp1252(raw);
        }
        res.metadata.title = trim_ascii(ensure_utf8_text(pdb.name, res.encoding == "windows-1252"));
        if (progress) progress("index", 3, 3);
        return res;
    }

    if (pdb.type != "BOOK" || pdb.creator != "MOBI") {
        throw MobiError("notMobi", "unsupported PalmDB type/creator");
    }

    if (pdb.records.empty() || pdb.records[0].size() < 132 ||
        pdb.records[0].substr(16, 4) != "MOBI") {
        throw MobiError("notMobi", "missing MOBI header in record 0");
    }

    // Peek record 0 to detect standalone KF8 vs MOBI 7 vs Joint MOBI 7 + KF8.
    const std::string_view r0 = pdb.records[0];
    const std::uint16_t enc0 = read_u16_be(r0, 12);
    if (enc0 != 0U) {
        throw MobiError("encrypted", "MOBI encryption is enabled");
    }
    const std::uint32_t ver0 = read_u32_be(r0, 36);
    if (ver0 >= 8U) {
        auto kf8 = parse_mobi_part(pdb, 0, std::nullopt, std::nullopt, progress, check_cancelled);
        if (progress) progress("index", 3, 3);
        return part_to_result(ContainerKind::kf8, std::move(kf8), false);
    }

    // MOBI 7 or Joint: check EXTH 121 for KF8 boundary.
    std::optional<std::size_t> kf8_base;
    const std::uint32_t hlen0 = read_u32_be(r0, 20);
    const std::uint32_t exth_flags0 = read_u32_be(r0, 128);
    if ((exth_flags0 & 0x40U) != 0U && 16ULL + hlen0 + 12ULL <= r0.size() &&
        r0.substr(16U + hlen0, 4) == "EXTH") {
        try {
            const auto exth0 = parse_exth(r0.substr(16U + hlen0));
            for (const auto& e : exth0) {
                if (e.type == 121U && e.data.size() == 4) {
                    const std::uint32_t b = read_u32_be(e.data, 0);
                    if (b != kInvalidIndex && b < pdb.records.size()) {
                        if (pdb.records[b] == kBoundaryRecord && b + 1U < pdb.records.size()) {
                            kf8_base = b + 1U;
                        } else {
                            kf8_base = b;
                        }
                    }
                }
            }
        } catch (const MobiError&) {
            // Let MOBI 7 parser surface any EXTH corruption cleanly.
        }
    }

    if (!kf8_base.has_value()) {
        auto m7 = parse_mobi_part(pdb, 0, std::nullopt, std::nullopt, progress, check_cancelled);
        if (progress) progress("index", 3, 3);
        return part_to_result(ContainerKind::mobi7, std::move(m7), false);
    }

    // Joint MOBI 7 + KF8: shared picture pool starts at Record 0's first_image_index and stops
    // before the BOUNDARY / KF8 header.
    const std::uint32_t first_img0 = read_u32_be(r0, 108);
    std::optional<std::size_t> shared_start;
    std::optional<std::size_t> shared_end;
    if (first_img0 != kInvalidIndex && first_img0 < *kf8_base) {
        shared_start = first_img0;
        shared_end = (*kf8_base > 0 && pdb.records[*kf8_base - 1U] == kBoundaryRecord)
                         ? (*kf8_base - 1U)
                         : *kf8_base;
    }

    // Prefer KF8 half; fall back to MOBI 7 automatically if KF8 half is damaged (never bypass DRM/bomb!).
    try {
        auto kf8 = parse_mobi_part(pdb, *kf8_base, shared_start, shared_end, progress, check_cancelled);
        if (progress) progress("index", 3, 3);
        return part_to_result(ContainerKind::joint, std::move(kf8), false);
    } catch (const MobiError& e) {
        if (e.reason == "encrypted" || e.reason == "decompressBomb") {
            throw;
        }
        auto m7 = parse_mobi_part(pdb, 0, shared_start, shared_end, progress, check_cancelled);
        if (progress) progress("index", 3, 3);
        return part_to_result(ContainerKind::joint, std::move(m7), true);
    }
}

MobiReadResult read_mobi_file(const std::filesystem::path& path, const ReadProgressFn& progress,
                              const ReadCancelFn& check_cancelled) {
    if (check_cancelled) check_cancelled();
    std::error_code ec;
    const auto sz = std::filesystem::file_size(path, ec);
    if (ec) {
        throw MobiError("damaged", "cannot stat file");
    }
    if (sz > kMaxFileBytes) {
        throw MobiError("tooLarge", "file exceeds 150 MB limit");
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw MobiError("damaged", "cannot open file");
    }
    std::string bytes(static_cast<std::size_t>(sz), '\0');
    if (sz > 0 && !in.read(bytes.data(), static_cast<std::streamsize>(sz))) {
        throw MobiError("damaged", "cannot read file");
    }
    return read_mobi_bytes(bytes, progress, check_cancelled);
}

}  // namespace mfbe::mobi
