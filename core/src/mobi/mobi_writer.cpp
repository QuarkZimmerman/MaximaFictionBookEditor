// MOBI 7, joint MOBI 7 + KF8, and KF8 (.azw3) container writer (T018, contracts/mobi-file.md).
#include "mobi/mobi_writer.hpp"

#include "mobi/compression.hpp"
#include "mobi/exth.hpp"
#include "mobi/indx.hpp"
#include "mobi/jpeg_norm.hpp"
#include "mobi/palmdb.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <unordered_map>

namespace mfbe::mobi {
namespace {

constexpr std::uint32_t kPalmEpochOffset = 2082844800U;  // 1904-01-01 to 1970-01-01 seconds

std::uint32_t current_palm_time() {
    const auto now = std::chrono::system_clock::now();
    const auto secs =
        std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
    return static_cast<std::uint32_t>(secs + kPalmEpochOffset);
}

std::string safe_pdb_name(std::string_view title) {
    std::string out;
    out.reserve(31);
    for (char c : title) {
        if (out.size() >= 31) {
            break;
        }
        const unsigned char u = static_cast<unsigned char>(c);
        if ((u >= 'A' && u <= 'Z') || (u >= 'a' && u <= 'z') || (u >= '0' && u <= '9') ||
            c == '-' || c == '_') {
            out.push_back(c);
        } else if (c == ' ') {
            out.push_back('_');
        }
    }
    return out.empty() ? std::string("Book") : out;
}

std::string to_base32_padded(std::uint32_t val, int width) {
    static constexpr char kDigits[] = "0123456789ABCDEFGHIJKLMNOPQRSTUV";
    std::string out(static_cast<std::size_t>(width), '0');
    for (int i = width - 1; i >= 0; --i) {
        out[static_cast<std::size_t>(i)] = kDigits[val & 31U];
        val >>= 5;
    }
    return out;
}

// Scans HTML for id="..." and name="..." attributes, recording the opening '<' byte offset
// of the enclosing element for each anchor id.
std::unordered_map<std::string, std::uint32_t> collect_anchor_offsets(std::string_view html) {
    std::unordered_map<std::string, std::uint32_t> anchors;
    std::size_t pos = 0;
    while (pos < html.size()) {
        const std::size_t lt = html.find('<', pos);
        if (lt == std::string_view::npos) {
            break;
        }
        if (lt + 1 < html.size() &&
            (html[lt + 1] == '/' || html[lt + 1] == '!' || html[lt + 1] == '?')) {
            const std::size_t gt = html.find('>', lt + 1);
            pos = (gt == std::string_view::npos) ? html.size() : gt + 1;
            continue;
        }
        const std::size_t gt = html.find('>', lt + 1);
        if (gt == std::string_view::npos) {
            break;
        }
        const std::string_view tag = html.substr(lt, gt - lt);
        // Look for ` id="..."` or ` name="..."`
        for (const std::string_view attr_name : {" id=\"", " name=\""}) {
            std::size_t a = tag.find(attr_name);
            while (a != std::string_view::npos) {
                const std::size_t val_start = a + attr_name.size();
                const std::size_t val_end = tag.find('"', val_start);
                if (val_end != std::string_view::npos && val_end > val_start) {
                    const std::string id(tag.substr(val_start, val_end - val_start));
                    anchors.try_emplace(id, static_cast<std::uint32_t>(lt));
                }
                a = tag.find(attr_name, val_start);
            }
        }
        pos = gt + 1;
    }
    return anchors;
}

// Strips ` data-target="..."` from `filepos="0000000000" data-target="ID"` placeholders in MOBI 7
// HTML, computes exact byte offsets on the final cleaned HTML, and overwrites the 10-digit
// `filepos` numbers in place (zero offset drift).
struct PatchedMobi7 {
    std::string html;
    std::unordered_map<std::string, std::uint32_t> anchors;
};

PatchedMobi7 patch_mobi7_filepos(std::string_view input) {
    struct PatchSite {
        std::size_t digits_pos;
        std::string target_id;
    };
    std::vector<PatchSite> sites;
    std::string clean;
    clean.reserve(input.size());

    static constexpr std::string_view kMarker = "filepos=\"0000000000\" data-target=\"";
    std::size_t pos = 0;
    while (pos < input.size()) {
        const std::size_t hit = input.find(kMarker, pos);
        if (hit == std::string_view::npos) {
            clean.append(input.substr(pos));
            break;
        }
        clean.append(input.substr(pos, hit - pos));
        const std::size_t id_start = hit + kMarker.size();
        const std::size_t id_end = input.find('"', id_start);
        if (id_end == std::string_view::npos) {
            clean.append(input.substr(hit));
            break;
        }
        const std::size_t digits_pos = clean.size() + 9;  // after `filepos="`
        clean.append("filepos=\"0000000000\"");
        sites.push_back(
            PatchSite{digits_pos, std::string(input.substr(id_start, id_end - id_start))});
        pos = id_end + 1;
    }

    auto anchors = collect_anchor_offsets(clean);
    char buf[16];
    for (const auto& site : sites) {
        const auto it = anchors.find(site.target_id);
        const std::uint32_t off = (it != anchors.end()) ? it->second : 0U;
        std::snprintf(buf, sizeof(buf), "%010u", off);
        std::memcpy(clean.data() + site.digits_pos, buf, 10);
    }

    return PatchedMobi7{std::move(clean), std::move(anchors)};
}

// Splits a complete KF8 XHTML5 document (`...<body ...>INNER</body></html>`) into a Calibre/Kindle
// compatible skeleton (`...<body aid="0"></body></html>`) and fragment (`INNER`), and resolves
// `data-kf8-target="ID"` placeholders to exact `kindle:pos:fid:0000:off:YYYYYYYYYY` URIs.
struct PreparedKf8 {
    std::string canonical_html;  // Complete reconstructed XHTML5 (for MFBE htmlSha256)
    std::string flow0;           // skeleton + fragment bytes
    std::uint32_t skel_len = 0;
    std::uint32_t insert_pos = 0;
    std::uint32_t frag_len = 0;
    std::unordered_map<std::string, std::uint32_t> anchors;  // offsets within canonical_html
};

PreparedKf8 prepare_kf8_document(std::string_view input) {
    // First strip ` data-kf8-target="ID"` and replace `href="#..."` (or placeholder) with
    // fixed-width `href="kindle:pos:fid:0000:off:0000000000"` so patching never shifts offsets!
    struct Kf8Site {
        std::size_t off_pos;  // position of 10-char base32 offset inside canonical_html
        std::string target_id;
    };
    std::vector<Kf8Site> sites;
    std::string html;
    html.reserve(input.size() + 1024);

    static constexpr std::string_view kTargetAttr = " data-kf8-target=\"";
    std::size_t pos = 0;
    while (pos < input.size()) {
        const std::size_t hit = input.find(kTargetAttr, pos);
        if (hit == std::string_view::npos) {
            html.append(input.substr(pos));
            break;
        }
        const std::size_t id_start = hit + kTargetAttr.size();
        const std::size_t id_end = input.find('"', id_start);
        if (id_end == std::string_view::npos) {
            html.append(input.substr(pos));
            break;
        }
        const std::string target_id(input.substr(id_start, id_end - id_start));
        // Look backwards from `hit` within the same `<a ...>` tag for `href="..."`
        const std::size_t tag_open = input.rfind('<', hit);
        const std::size_t href_pos = (tag_open != std::string_view::npos && tag_open >= pos)
                                         ? input.find("href=\"", tag_open)
                                         : std::string_view::npos;
        if (href_pos != std::string_view::npos && href_pos < hit) {
            const std::size_t href_end = input.find('"', href_pos + 6);
            if (href_end != std::string_view::npos && href_end < hit) {
                html.append(input.substr(pos, href_pos - pos));
                html.append("href=\"kindle:pos:fid:0000:off:");
                const std::size_t off_pos = html.size();
                html.append("0000000000\"");
                html.append(input.substr(href_end + 1, hit - (href_end + 1)));
                sites.push_back(Kf8Site{off_pos, target_id});
                pos = id_end + 1;
                continue;
            }
        }
        html.append(input.substr(pos, hit - pos));
        pos = id_end + 1;
    }

    // Ensure `<body` carries `aid="0"` for Calibre/Kindle SKEL/FRAG XPath selector
    // `P-//*[@aid='0']`.
    std::size_t body_open = html.find("<body");
    if (body_open != std::string::npos) {
        const std::size_t body_gt = html.find('>', body_open);
        if (body_gt != std::string::npos) {
            const std::string_view btag =
                std::string_view(html).substr(body_open, body_gt - body_open);
            if (btag.find("aid=") == std::string_view::npos) {
                const std::size_t insert_at = body_gt;
                const std::string_view aid = " aid=\"0\"";
                html.insert(insert_at, aid);
                for (auto& s : sites) {
                    if (s.off_pos >= insert_at) {
                        s.off_pos += aid.size();
                    }
                }
            }
        }
    }

    // Locate `<body>` boundaries first so we know fragment 0's `insert_pos` (= `prefix.size()`).
    // In KF8, `pos_fid` offsets (`kindle:pos:fid:0000:off:...`, NCX tag 6, GUIDE tag 6) are byte
    // offsets relative to the fragment start (`insert_pos`), NOT relative to document start.
    const std::size_t body_gt_final =
        (body_open != std::string::npos) ? html.find('>', body_open) : std::string::npos;
    const std::size_t body_close = html.rfind("</body>");
    const bool has_split = body_gt_final != std::string::npos && body_close != std::string::npos &&
                           body_close >= body_gt_final + 1;
    const std::uint32_t insert_pos = has_split ? static_cast<std::uint32_t>(body_gt_final + 1) : 0U;

    // Compute exact byte offsets on `html` and patch `kindle:pos:fid:0000:off:YYYYYYYYYY` in place.
    auto anchors = collect_anchor_offsets(html);
    for (const auto& s : sites) {
        const auto it = anchors.find(s.target_id);
        const std::uint32_t abs_off = (it != anchors.end()) ? it->second : insert_pos;
        const std::uint32_t frag_off = (abs_off >= insert_pos) ? (abs_off - insert_pos) : 0U;
        const std::string b32 = to_base32_padded(frag_off, 10);
        std::memcpy(html.data() + s.off_pos, b32.data(), 10);
    }

    PreparedKf8 out;
    out.canonical_html = html;
    out.anchors = std::move(anchors);

    // Split into skeleton (`...<body ...></body></html>`) + fragment (`INNER`).
    if (has_split) {
        const std::string_view prefix = std::string_view(html).substr(0, body_gt_final + 1);
        const std::string_view inner =
            std::string_view(html).substr(body_gt_final + 1, body_close - (body_gt_final + 1));
        const std::string_view suffix = std::string_view(html).substr(body_close);
        std::string skel;
        skel.reserve(prefix.size() + suffix.size());
        skel.append(prefix);
        skel.append(suffix);
        out.insert_pos = insert_pos;
        out.skel_len = static_cast<std::uint32_t>(skel.size());
        out.frag_len = static_cast<std::uint32_t>(inner.size());
        out.flow0.reserve(skel.size() + inner.size());
        out.flow0.append(skel);
        out.flow0.append(inner);
    } else {
        // Fallback: single-piece Flow[0] with empty fragment
        out.insert_pos = static_cast<std::uint32_t>(html.size());
        out.skel_len = static_cast<std::uint32_t>(html.size());
        out.frag_len = 0;
        out.flow0 = html;
    }
    return out;
}

std::vector<MobiNavEntry> resolve_nav_entries(
    const std::vector<MobiNavEntry>& raw_nav,
    const std::unordered_map<std::string, std::uint32_t>& anchors, std::uint32_t total_len,
    bool compute_hierarchy, std::uint32_t frag_insert_pos = 0) {
    std::vector<MobiNavEntry> nav = raw_nav;
    for (auto& e : nav) {
        if (!e.anchor_id.empty()) {
            if (auto it = anchors.find(e.anchor_id); it != anchors.end()) {
                e.offset = it->second;
                e.fid = 0;
                e.fid_offset =
                    (it->second >= frag_insert_pos) ? (it->second - frag_insert_pos) : 0U;
            }
        }
    }
    // Compute section lengths and optional KF8 parent / first_child / last_child indices.
    for (std::size_t i = 0; i < nav.size(); ++i) {
        std::uint32_t end = total_len;
        for (std::size_t j = i + 1; j < nav.size(); ++j) {
            if (nav[j].depth <= nav[i].depth && nav[j].offset >= nav[i].offset) {
                end = nav[j].offset;
                break;
            }
        }
        nav[i].length = (end >= nav[i].offset) ? (end - nav[i].offset) : 0U;
        if (compute_hierarchy) {
            nav[i].parent = -1;
            nav[i].first_child = -1;
            nav[i].last_child = -1;
            for (int p = static_cast<int>(i) - 1; p >= 0; --p) {
                if (nav[static_cast<std::size_t>(p)].depth < nav[i].depth) {
                    nav[i].parent = p;
                    break;
                }
            }
            for (std::size_t j = i + 1; j < nav.size(); ++j) {
                if (nav[j].depth <= nav[i].depth) {
                    break;
                }
                if (nav[j].depth == nav[i].depth + 1) {
                    if (nav[i].first_child < 0) {
                        nav[i].first_child = static_cast<int>(j);
                    }
                    nav[i].last_child = static_cast<int>(j);
                }
            }
        }
    }
    return nav;
}

std::vector<MobiGuideEntry> resolve_guide_entries(
    const std::vector<MobiGuideEntry>& raw_guide,
    const std::unordered_map<std::string, std::uint32_t>& anchors,
    std::uint32_t frag_insert_pos = 0) {
    std::vector<MobiGuideEntry> out;
    for (auto g : raw_guide) {
        if (!g.anchor_id.empty()) {
            if (auto it = anchors.find(g.anchor_id); it != anchors.end()) {
                g.offset = it->second;
                g.fid = 0;
                g.fid_offset =
                    (it->second >= frag_insert_pos) ? (it->second - frag_insert_pos) : 0U;
                out.push_back(std::move(g));
            }
        }
    }
    return out;
}

std::vector<std::string> compress_text_chunks(std::string_view text) {
    const auto chunks = split_utf8_chunks(text, 4096);
    std::vector<std::string> recs;
    recs.reserve(chunks.size());
    for (const auto& ch : chunks) {
        std::string comp = palmdoc_compress(ch);
        // extra_data_flags = 1 (multibyte UTF-8 overlap marker: 0x00 = clean UTF-8 boundary)
        comp.push_back('\0');
        recs.push_back(std::move(comp));
    }
    return recs;
}

struct HeaderParams {
    std::uint32_t text_length = 0;
    std::uint16_t text_record_count = 0;
    std::uint32_t header_length = 232;
    std::uint32_t file_version = 6;
    std::uint32_t locale = 0;
    std::uint32_t first_non_book_index = 0xFFFFFFFFU;
    std::uint32_t first_image_index = 0xFFFFFFFFU;
    std::uint32_t first_content_or_fdst = 1;
    std::uint32_t last_content_or_fdst_cnt = 0xFFFFFFFFU;
    std::uint32_t fcis_record = 0xFFFFFFFFU;
    std::uint32_t flis_record = 0xFFFFFFFFU;
    std::uint32_t indx_record = 0xFFFFFFFFU;
    std::uint32_t frag_record = 0xFFFFFFFFU;
    std::uint32_t skel_record = 0xFFFFFFFFU;
    std::uint32_t guide_record = 0xFFFFFFFFU;
    std::string full_name;
    std::vector<ExthEntry> exth;
};

std::string build_mobi_header_record(const HeaderParams& p) {
    std::string buf(16 + p.header_length, '\0');
    // PalmDOC header (0..15)
    write_u16_be(buf, 0, 2);  // PalmDOC LZ77
    write_u16_be(buf, 2, 0);
    write_u32_be(buf, 4, p.text_length);
    write_u16_be(buf, 8, p.text_record_count);
    write_u16_be(buf, 10, 4096);
    write_u16_be(buf, 12, 0);  // unencrypted
    write_u16_be(buf, 14, 0);

    // MOBI header (16..)
    buf.replace(16, 4, "MOBI");
    write_u32_be(buf, 20, p.header_length);
    write_u32_be(buf, 24, 2);       // Book
    write_u32_be(buf, 28, 65001U);  // UTF-8
    write_u32_be(buf, 32, 0x4D464245U);
    write_u32_be(buf, 36, p.file_version);
    for (std::size_t off = 40; off < 80; off += 4) {
        write_u32_be(buf, off, 0xFFFFFFFFU);
    }
    write_u32_be(buf, 80, p.first_non_book_index);
    write_u32_be(buf, 92, p.locale);
    write_u32_be(buf, 104, p.file_version);
    write_u32_be(buf, 108, p.first_image_index);
    write_u32_be(buf, 128, 0x50U);        // EXTH present (bit 6)
    write_u32_be(buf, 168, 0xFFFFFFFFU);  // drm_offset
    write_u32_be(buf, 172, 0);            // drm_count
    write_u32_be(buf, 176, 0);            // drm_size
    write_u32_be(buf, 180, 0);            // drm_flags
    write_u32_be(buf, 192, p.first_content_or_fdst);
    write_u32_be(buf, 196, p.last_content_or_fdst_cnt);
    write_u32_be(buf, 200, p.fcis_record);
    write_u32_be(buf, 204, p.fcis_record != 0xFFFFFFFFU ? 1U : 0U);
    write_u32_be(buf, 208, p.flis_record);
    write_u32_be(buf, 212, p.flis_record != 0xFFFFFFFFU ? 1U : 0U);
    if (p.header_length >= 232) {
        write_u32_be(buf, 240, 1U);  // extra_data_flags = bit 0 multibyte overlap
        write_u32_be(buf, 244, p.indx_record);
    }
    if (p.header_length >= 264) {
        write_u32_be(buf, 248, p.frag_record);
        write_u32_be(buf, 252, p.skel_record);
        write_u32_be(buf, 256, 0xFFFFFFFFU);  // datp
        write_u32_be(buf, 260, p.guide_record);
    }

    buf.append(serialize_exth(p.exth));

    const std::uint32_t fn_off = static_cast<std::uint32_t>(buf.size());
    const std::uint32_t fn_len = static_cast<std::uint32_t>(p.full_name.size());
    write_u32_be(buf, 84, fn_off);
    write_u32_be(buf, 88, fn_len);
    buf.append(p.full_name);
    buf.push_back('\0');
    buf.push_back('\0');
    while ((buf.size() % 4U) != 0) {
        buf.push_back('\0');
    }

    if (buf.size() > 65535U) {
        throw MobiError("checkFailed", "MOBI header record exceeds 65,535 bytes");
    }
    return buf;
}

// Builds a standalone or joint KF8 record block (starting with its header record at rel index 0).
std::vector<std::string> build_kf8_block(const PreparedKf8& kf8, const std::string& css,
                                         const MobiCommitInput& input,
                                         const std::vector<std::string>& own_pictures,
                                         std::optional<std::uint32_t> shared_pic_count,
                                         std::optional<std::uint32_t> cover_off,
                                         std::optional<std::uint32_t> thumb_off,
                                         std::optional<std::string_view> mfbe_payload) {
    const std::string effective_css = css.empty() ? std::string("body { margin: 0; }\n") : css;
    std::string stream;
    stream.reserve(kf8.flow0.size() + effective_css.size());
    stream.append(kf8.flow0);
    stream.append(effective_css);

    const auto text_recs = compress_text_chunks(stream);
    std::vector<std::string> recs;
    recs.emplace_back();  // placeholder for KF8 header record (rel 0)
    recs.insert(recs.end(), text_recs.begin(), text_recs.end());

    const std::uint32_t first_non_book = static_cast<std::uint32_t>(recs.size());

    // FRAG index
    char aid_buf[16];
    std::snprintf(aid_buf, sizeof(aid_buf), "%010u", kf8.insert_pos);
    const std::vector<FragEntry> frags = {
        FragEntry{aid_buf, "P-//*[@aid='0']", 0, 0, 0, kf8.frag_len},
    };
    const std::uint32_t frag_rec = static_cast<std::uint32_t>(recs.size());
    for (auto& r : build_kf8_frag(frags)) {
        recs.push_back(std::move(r));
    }

    // SKEL index
    const std::vector<SkelEntry> skels = {
        SkelEntry{"SKEL0000000000", 1, 0, kf8.skel_len},
    };
    const std::uint32_t skel_rec = static_cast<std::uint32_t>(recs.size());
    for (auto& r : build_kf8_skel(skels)) {
        recs.push_back(std::move(r));
    }

    // GUIDE index (optional)
    const auto resolved_guide = resolve_guide_entries(input.guide, kf8.anchors, kf8.insert_pos);
    std::uint32_t guide_rec = 0xFFFFFFFFU;
    if (!resolved_guide.empty()) {
        guide_rec = static_cast<std::uint32_t>(recs.size());
        for (auto& r : build_kf8_guide(resolved_guide)) {
            recs.push_back(std::move(r));
        }
    }

    // NCX navigation index (written whenever nav is non-empty, independent of inline TOC)
    const auto resolved_nav = resolve_nav_entries(
        input.nav, kf8.anchors, static_cast<std::uint32_t>(kf8.canonical_html.size()),
        /*compute_hierarchy=*/true, kf8.insert_pos);
    std::uint32_t indx_rec = 0xFFFFFFFFU;
    if (!resolved_nav.empty()) {
        indx_rec = static_cast<std::uint32_t>(recs.size());
        for (auto& r : build_kf8_ncx(resolved_nav)) {
            recs.push_back(std::move(r));
        }
    }

    // Standalone KF8 owns its pictures; joint KF8 references MOBI 7's shared pool.
    std::uint32_t first_img = 0xFFFFFFFFU;
    std::uint32_t res_count = 0;
    if (!shared_pic_count.has_value()) {
        if (!own_pictures.empty()) {
            first_img = static_cast<std::uint32_t>(recs.size());
            recs.insert(recs.end(), own_pictures.begin(), own_pictures.end());
            res_count = static_cast<std::uint32_t>(own_pictures.size());
        }
    } else {
        res_count = *shared_pic_count;
    }

    // FDST record (Flow 0 = XHTML5, Flow 1 = CSS)
    const std::uint32_t fdst_rec = static_cast<std::uint32_t>(recs.size());
    const std::uint32_t flow0_len = static_cast<std::uint32_t>(kf8.flow0.size());
    const std::uint32_t total_stream_len = static_cast<std::uint32_t>(stream.size());
    recs.push_back(build_fdst({{0, flow0_len}, {flow0_len, total_stream_len}}));
    if (shared_pic_count.has_value()) {
        first_img = fdst_rec;
    }

    // FLIS and FCIS closing records
    const std::uint32_t flis_rec = static_cast<std::uint32_t>(recs.size());
    recs.push_back(make_flis_record());
    const std::uint32_t fcis_rec = static_cast<std::uint32_t>(recs.size());
    recs.push_back(make_fcis_record(total_stream_len));

    // Resolve openAt byte offset (EXTH 116)
    std::optional<std::uint32_t> open_at_off;
    if (!input.metadata.open_at_anchor_id.empty()) {
        if (auto it = kf8.anchors.find(input.metadata.open_at_anchor_id); it != kf8.anchors.end()) {
            open_at_off = it->second;
        }
    }

    const std::string& shelf_title =
        !input.metadata.updated_title.empty() ? input.metadata.updated_title : input.metadata.title;
    HeaderParams hp;
    hp.text_length = total_stream_len;
    hp.text_record_count = static_cast<std::uint16_t>(text_recs.size());
    hp.header_length = 264;
    hp.file_version = 8;
    hp.locale = lcid_from_bcp47(input.metadata.language);
    hp.first_non_book_index = first_non_book;
    hp.first_image_index = first_img;
    hp.first_content_or_fdst = fdst_rec;
    hp.last_content_or_fdst_cnt = 2;
    hp.fcis_record = fcis_rec;
    hp.flis_record = flis_rec;
    hp.indx_record = indx_rec;
    hp.frag_record = frag_rec;
    hp.skel_record = skel_rec;
    hp.guide_record = guide_rec;
    hp.full_name = shelf_title;
    hp.exth = build_export_exth(input.metadata, cover_off, thumb_off, open_at_off,
                                /*kf8_boundary_rec=*/std::nullopt, res_count,
                                /*is_kf8=*/true, mfbe_payload);
    recs[0] = build_mobi_header_record(hp);
    return recs;
}

// Pre-write structural self-check (contracts/rpc-api.md §2, FR-005): re-parses the assembled
// PalmDB container, verifies headers, encryption == 0, non-empty decompression, EXTH integrity,
// and closing EOF record before committing bytes to disk.
void self_check_mobi(std::string_view file_bytes, MobiExportFormat format) {
    const PalmDb pdb = read_palmdb(file_bytes);
    if (pdb.records.size() < 4) {
        throw MobiError("checkFailed", "assembled MOBI has too few records");
    }
    if (pdb.records.back() != make_eof_record()) {
        throw MobiError("checkFailed", "missing EOF closing record");
    }
    const std::string& r0 = pdb.records[0];
    if (r0.size() < 248 || r0.substr(16, 4) != "MOBI") {
        throw MobiError("checkFailed", "invalid MOBI header in Record 0");
    }
    if (read_u16_be(r0, 12) != 0U) {
        throw MobiError("checkFailed", "encryption must be 0");
    }
    const std::uint16_t text_cnt = read_u16_be(r0, 8);
    const std::uint32_t text_len = read_u32_be(r0, 4);
    const std::uint32_t extra = read_u32_be(r0, 240);
    if (text_cnt == 0 || static_cast<std::size_t>(1 + text_cnt) > pdb.records.size()) {
        throw MobiError("checkFailed", "text record count out of bounds");
    }
    std::vector<std::string_view> trecs;
    trecs.reserve(text_cnt);
    for (std::uint16_t i = 1; i <= text_cnt; ++i) {
        trecs.push_back(pdb.records[i]);
    }
    const std::string decoded = decompress_text_records(2, trecs, extra, text_len);
    if (decoded.size() != text_len) {
        throw MobiError("checkFailed", "decompressed text length mismatch");
    }
    const std::uint32_t hlen = read_u32_be(r0, 20);
    const auto exth = parse_exth(std::string_view(r0).substr(16 + hlen));
    for (const auto& e : exth) {
        if (e.type == 113U || e.type == 501U) {
            throw MobiError("checkFailed", "store-only EXTH 113/501 must not be written");
        }
    }
    if (format == MobiExportFormat::joint) {
        std::uint32_t kf8_idx = 0;
        for (const auto& e : exth) {
            if (e.type == 121U && e.data.size() == 4) {
                kf8_idx = read_u32_be(e.data, 0);
            }
        }
        if (kf8_idx < 2 || kf8_idx >= pdb.records.size() ||
            pdb.records[kf8_idx - 1] != kBoundaryRecord) {
            throw MobiError("checkFailed", "joint file missing valid BOUNDARY / EXTH 121");
        }
        if (pdb.records[kf8_idx].size() < 280 || read_u32_be(pdb.records[kf8_idx], 36) != 8U) {
            throw MobiError("checkFailed", "joint file KF8 header invalid");
        }
    }
}

}  // namespace

std::string format_to_string(MobiExportFormat fmt) {
    switch (fmt) {
        case MobiExportFormat::mobi7:
            return "mobi7";
        case MobiExportFormat::joint:
            return "joint";
        case MobiExportFormat::kf8:
            return "kf8";
    }
    return "mobi7";
}

std::optional<MobiExportFormat> format_from_string(std::string_view s) {
    if (s == "mobi7")
        return MobiExportFormat::mobi7;
    if (s == "joint")
        return MobiExportFormat::joint;
    if (s == "kf8")
        return MobiExportFormat::kf8;
    return std::nullopt;
}

MobiWriter::MobiWriter(std::filesystem::path target, MobiExportFormat format, bool zip)
    : target_(std::move(target)), format_(format), zip_(zip) {}

MobiAddedPicture MobiWriter::add_picture(std::string_view raw_bytes,
                                         const images::ConversionPolicy& policy, bool is_cover) {
    const NormalizedPicture prep = prepare_mobi_picture(raw_bytes, policy);
    const std::uint32_t zero_idx = static_cast<std::uint32_t>(pictures_.size());
    pictures_.push_back(prep.bytes);

    if (is_cover && !cover_rec_index_.has_value()) {
        cover_rec_index_ = zero_idx;
        const std::string thumb = make_cover_thumbnail(prep.bytes);
        if (!thumb.empty()) {
            thumbnail_rec_index_ = static_cast<std::uint32_t>(pictures_.size());
            pictures_.push_back(thumb);
        }
    }

    return MobiAddedPicture{
        zero_idx + 1U, prep.media_type, prep.width, prep.height, prep.converted, prep.downscaled,
    };
}

void MobiWriter::set_mobi7_html(std::string html) {
    mobi7_html_ = std::move(html);
}

void MobiWriter::set_kf8_html(std::string html) {
    kf8_html_ = std::move(html);
}

void MobiWriter::set_kf8_css(std::string css) {
    kf8_css_ = std::move(css);
}

void MobiWriter::set_mfbe_json(nlohmann::json mfbe) {
    mfbe_json_ = std::move(mfbe);
}

MobiWriteResult MobiWriter::commit(const MobiCommitInput& input, const ProgressFn& progress,
                                   const CancelFn& check_cancelled,
                                   const std::optional<std::string>& fbd_bytes) {
    auto report = [&](const std::string& phase, std::int64_t done, std::int64_t total) {
        if (check_cancelled) {
            check_cancelled();
        }
        if (progress) {
            progress(phase, done, total);
        }
    };

    if ((format_ == MobiExportFormat::mobi7 || format_ == MobiExportFormat::joint) &&
        (!mobi7_html_.has_value() || mobi7_html_->empty())) {
        throw MobiError("badPart", "missing mobi7-html upload");
    }
    if ((format_ == MobiExportFormat::kf8 || format_ == MobiExportFormat::joint) &&
        (!kf8_html_.has_value() || kf8_html_->empty())) {
        throw MobiError("badPart", "missing kf8-html upload");
    }

    report("build", 1, 4);

    // Patch HTMLs so we have the exact canonical HTML bytes before computing MFBE digests.
    std::optional<PatchedMobi7> patched7;
    std::optional<PreparedKf8> prepared8;
    if (format_ == MobiExportFormat::mobi7 || format_ == MobiExportFormat::joint) {
        patched7 = patch_mobi7_filepos(*mobi7_html_);
    }
    if (format_ == MobiExportFormat::kf8 || format_ == MobiExportFormat::joint) {
        prepared8 = prepare_kf8_document(*kf8_html_);
    }

    // Encode optional MFBE round-trip EXTH 59901 payload (canonical HTML = kf8 for kf8/joint,
    // mobi7 for mobi7 per contracts/mobi-file.md §5).
    std::optional<std::string> mfbe_payload;
    bool mfbe_skipped = false;
    if (mfbe_json_.has_value()) {
        const std::string_view canonical_html = prepared8.has_value()
                                                    ? std::string_view(prepared8->canonical_html)
                                                    : std::string_view(patched7->html);
        mfbe_payload = encode_mfbe_record(*mfbe_json_, canonical_html, input.metadata);
        if (!mfbe_payload.has_value()) {
            mfbe_skipped = true;
        }
    }

    const std::optional<std::string_view> mfbe_view =
        mfbe_payload.has_value() ? std::optional<std::string_view>(*mfbe_payload) : std::nullopt;
    const std::string& shelf_title =
        !input.metadata.updated_title.empty() ? input.metadata.updated_title : input.metadata.title;

    PalmDb pdb;
    pdb.name = safe_pdb_name(shelf_title);
    pdb.type = "BOOK";
    pdb.creator = "MOBI";
    pdb.created_at = current_palm_time();
    pdb.modified_at = pdb.created_at;

    if (format_ == MobiExportFormat::kf8) {
        pdb.records = build_kf8_block(*prepared8, kf8_css_, input, pictures_,
                                      /*shared_pic_count=*/std::nullopt, cover_rec_index_,
                                      thumbnail_rec_index_, mfbe_view);
        pdb.records.push_back(make_eof_record());
    } else {
        // MOBI 7 or Joint MOBI 7 + KF8
        const auto text7_recs = compress_text_chunks(patched7->html);
        pdb.records.emplace_back();  // placeholder for Record 0
        pdb.records.insert(pdb.records.end(), text7_recs.begin(), text7_recs.end());

        const std::uint32_t first_non_book = static_cast<std::uint32_t>(pdb.records.size());

        // Native MOBI 7 NCX navigation index (written whenever nav non-empty)
        const auto nav7 = resolve_nav_entries(input.nav, patched7->anchors,
                                              static_cast<std::uint32_t>(patched7->html.size()),
                                              /*compute_hierarchy=*/false);
        std::uint32_t indx7_rec = 0xFFFFFFFFU;
        if (!nav7.empty()) {
            indx7_rec = static_cast<std::uint32_t>(pdb.records.size());
            for (auto& r : build_mobi7_ncx(nav7)) {
                pdb.records.push_back(std::move(r));
            }
        }

        // Shared picture pool (written ONCE even for joint files!)
        const std::uint32_t first_img =
            pictures_.empty() ? 0xFFFFFFFFU : static_cast<std::uint32_t>(pdb.records.size());
        pdb.records.insert(pdb.records.end(), pictures_.begin(), pictures_.end());
        const std::uint32_t last_content =
            pictures_.empty() ? static_cast<std::uint32_t>(text7_recs.size())
                              : static_cast<std::uint32_t>(first_img + pictures_.size() - 1U);

        // MOBI 7 closing records
        const std::uint32_t flis7 = static_cast<std::uint32_t>(pdb.records.size());
        pdb.records.push_back(make_flis_record());
        const std::uint32_t fcis7 = static_cast<std::uint32_t>(pdb.records.size());
        pdb.records.push_back(make_fcis_record(static_cast<std::uint32_t>(patched7->html.size())));

        std::optional<std::uint32_t> kf8_boundary_rec;
        std::optional<std::uint32_t> shared_res_count;
        if (format_ == MobiExportFormat::joint) {
            pdb.records.emplace_back(kBoundaryRecord);
            kf8_boundary_rec = static_cast<std::uint32_t>(pdb.records.size());
            shared_res_count = static_cast<std::uint32_t>(pictures_.size());
            auto kf8_recs = build_kf8_block(*prepared8, kf8_css_, input, {}, shared_res_count,
                                            cover_rec_index_, thumbnail_rec_index_, mfbe_view);
            pdb.records.insert(pdb.records.end(), std::make_move_iterator(kf8_recs.begin()),
                               std::make_move_iterator(kf8_recs.end()));
        }
        pdb.records.push_back(make_eof_record());

        // Resolve MOBI 7 openAt offset (EXTH 116)
        std::optional<std::uint32_t> open_at_off;
        if (!input.metadata.open_at_anchor_id.empty()) {
            if (auto it = patched7->anchors.find(input.metadata.open_at_anchor_id);
                it != patched7->anchors.end()) {
                open_at_off = it->second;
            }
        }

        HeaderParams hp;
        hp.text_length = static_cast<std::uint32_t>(patched7->html.size());
        hp.text_record_count = static_cast<std::uint16_t>(text7_recs.size());
        hp.header_length = (format_ == MobiExportFormat::joint) ? 264U : 232U;
        hp.file_version = 6;
        hp.locale = lcid_from_bcp47(input.metadata.language);
        hp.first_non_book_index = first_non_book;
        hp.first_image_index = first_img;
        hp.first_content_or_fdst = 1;
        hp.last_content_or_fdst_cnt = last_content;
        hp.fcis_record = fcis7;
        hp.flis_record = flis7;
        hp.indx_record = indx7_rec;
        hp.full_name = shelf_title;
        hp.exth = build_export_exth(input.metadata, cover_rec_index_, thumbnail_rec_index_,
                                    open_at_off, kf8_boundary_rec, shared_res_count,
                                    /*is_kf8=*/false, mfbe_view);
        pdb.records[0] = build_mobi_header_record(hp);
    }

    const std::string mobi_bytes = write_palmdb(pdb);

    report("check", 2, 4);
    self_check_mobi(mobi_bytes, format_);

    std::string final_bytes;
    if (zip_) {
        report("pack", 3, 4);
        if (!fbd_bytes.has_value()) {
            throw MobiError("badPart", "ZIP export requires companion FBD content");
        }
        const std::string stem = platform::utf8_from_path(target_.stem());
        const std::string book_ext = (format_ == MobiExportFormat::kf8) ? ".azw3" : ".mobi";
        // Contract: MOBI/AZW3 stored uncompressed (`stored = true`), FBD compressed (`stored =
        // false`).
        final_bytes = archive::zip_entries({
            archive::ZipEntry{stem + book_ext, mobi_bytes, /*stored=*/true, /*utf8=*/false},
            archive::ZipEntry{stem + ".fbd", *fbd_bytes, /*stored=*/false, /*utf8=*/false},
        });
    } else {
        final_bytes = mobi_bytes;
    }

    report("write", 4, 4);
    try {
        atomic_file::write_atomic(target_, final_bytes);
    } catch (const std::exception& e) {
        throw MobiError("ioError", e.what());
    }

    return MobiWriteResult{
        platform::utf8_from_path(target_),
        final_bytes.size(),
        format_to_string(format_),
        zip_,
        mfbe_skipped,
    };
}

}  // namespace mfbe::mobi
