// MOBI/KF8 INDX/TAGX/IDXT/CNCX, FDST/SKEL/FRAG/GUIDE, and closing records (T008).
#include "mobi/indx.hpp"

#include "mobi/palmdb.hpp"

#include <algorithm>
#include <cstdio>
#include <map>
#include <optional>

namespace mfbe::mobi {
namespace {

constexpr std::size_t kIndxHeaderLen = 192;

struct TagDesc {
    std::uint8_t id = 0;
    std::uint8_t num_values = 0;
    std::uint8_t bitmask = 0;
    std::uint8_t eof = 0;
};

struct DecodedEntry {
    std::string key;
    std::map<std::uint8_t, std::vector<std::uint32_t>> tags;
};

struct DecodedIndx {
    std::vector<DecodedEntry> entries;
    std::string cncx;
};

unsigned count_trailing_zeros(std::uint8_t mask) {
    unsigned n = 0;
    while (mask != 0 && (mask & 1U) == 0) {
        mask >>= 1;
        ++n;
    }
    return n;
}

unsigned popcount8(std::uint8_t mask) {
    unsigned c = 0;
    while (mask != 0) {
        c += (mask & 1U);
        mask >>= 1;
    }
    return c;
}

std::string read_cncx_string(std::string_view cncx, std::uint32_t offset) {
    if (offset >= cncx.size()) {
        return {};
    }
    std::size_t pos = offset;
    std::uint32_t len = 0;
    if (!read_vwi_forward(cncx, pos, len)) {
        return {};
    }
    if (pos + len > cncx.size()) {
        return {};
    }
    return std::string(cncx.substr(pos, len));
}

std::uint32_t append_cncx_string(std::string& cncx, std::string_view text) {
    const std::uint32_t off = static_cast<std::uint32_t>(cncx.size());
    append_vwi_forward(cncx, static_cast<std::uint32_t>(text.size()));
    cncx.append(text);
    return off;
}

std::string format_hex_key(std::size_t idx, int width) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%0*zX", width, idx);
    return std::string(buf);
}

// Generic INDX table builder: produces [meta_record, entry_record(s)..., optional cncx_record(s)].
// Splits entries across multiple entry records if an entry record would exceed 48 KB so every
// PalmDB record stays comfortably under 64 KB.
std::vector<std::string> build_indx_table(const std::vector<TagDesc>& tagx_defs,
                                          std::uint32_t control_bytes,
                                          const std::vector<std::pair<std::string, std::string>>& raw_entries,
                                          std::string_view cncx_blob) {
    // Split CNCX into <= 60 KB chunks (usually 1 record).
    std::vector<std::string> cncx_recs;
    if (!cncx_blob.empty()) {
        constexpr std::size_t kMaxCncxChunk = 60000;
        for (std::size_t p = 0; p < cncx_blob.size(); p += kMaxCncxChunk) {
            cncx_recs.emplace_back(cncx_blob.substr(p, std::min(kMaxCncxChunk, cncx_blob.size() - p)));
        }
    }

    // Group entries into entry records (each <= 48 KB).
    struct BuiltEntryRec {
        std::string data;
        std::string last_key;
        std::uint16_t count = 0;
    };
    std::vector<BuiltEntryRec> entry_recs;

    auto flush_record = [&](std::string& buf, std::vector<std::uint16_t>& offs,
                            const std::string& last_key) {
        if (offs.empty()) {
            return;
        }
        if ((buf.size() & 1U) != 0) {
            buf.push_back(0);
        }
        const std::uint32_t idxt_off = static_cast<std::uint32_t>(buf.size());
        buf.append("IDXT", 4);
        for (std::uint16_t eo : offs) {
            append_u16_be(buf, eo);
        }
        while ((buf.size() % 4U) != 0) {
            buf.push_back(0);
        }
        buf.replace(0, 4, "INDX");
        write_u32_be(buf, 4, kIndxHeaderLen);
        write_u32_be(buf, 16, 2);  // entry record
        write_u32_be(buf, 20, idxt_off);
        write_u32_be(buf, 24, static_cast<std::uint32_t>(offs.size()));
        write_u32_be(buf, 28, 0xFFFFFFFFU);
        write_u32_be(buf, 32, 0xFFFFFFFFU);
        entry_recs.push_back(BuiltEntryRec{std::move(buf), last_key,
                                           static_cast<std::uint16_t>(offs.size())});
    };

    std::string cur(kIndxHeaderLen, '\0');
    std::vector<std::uint16_t> cur_offs;
    std::string last_key;
    for (const auto& [key, payload] : raw_entries) {
        const std::size_t entry_len = 1 + key.size() + payload.size();
        if (!cur_offs.empty() && cur.size() + entry_len + (cur_offs.size() + 1) * 2 + 16 > 48000) {
            flush_record(cur, cur_offs, last_key);
            cur.assign(kIndxHeaderLen, '\0');
            cur_offs.clear();
        }
        cur_offs.push_back(static_cast<std::uint16_t>(cur.size()));
        cur.push_back(static_cast<char>(std::min<std::size_t>(key.size(), 255)));
        cur.append(key.substr(0, 255));
        cur.append(payload);
        last_key = key.substr(0, 255);
    }
    flush_record(cur, cur_offs, last_key);

    // Build meta record (#0).
    std::string meta(kIndxHeaderLen, '\0');
    const std::uint32_t tagx_len = static_cast<std::uint32_t>(12U + tagx_defs.size() * 4U);
    meta.append("TAGX", 4);
    append_u32_be(meta, tagx_len);
    append_u32_be(meta, control_bytes);
    for (const auto& t : tagx_defs) {
        meta.push_back(static_cast<char>(t.id));
        meta.push_back(static_cast<char>(t.num_values));
        meta.push_back(static_cast<char>(t.bitmask));
        meta.push_back(static_cast<char>(t.eof));
    }

    std::vector<std::uint16_t> meta_offs;
    for (const auto& er : entry_recs) {
        meta_offs.push_back(static_cast<std::uint16_t>(meta.size()));
        meta.push_back(static_cast<char>(er.last_key.size()));
        meta.append(er.last_key);
        append_u16_be(meta, er.count);
    }
    if ((meta.size() & 1U) != 0) {
        meta.push_back(0);
    }
    const std::uint32_t meta_idxt_off = static_cast<std::uint32_t>(meta.size());
    meta.append("IDXT", 4);
    for (std::uint16_t mo : meta_offs) {
        append_u16_be(meta, mo);
    }
    while ((meta.size() % 4U) != 0) {
        meta.push_back(0);
    }

    meta.replace(0, 4, "INDX");
    write_u32_be(meta, 4, kIndxHeaderLen);
    write_u32_be(meta, 12, 0);  // normal
    write_u32_be(meta, 16, 0);  // meta
    write_u32_be(meta, 20, meta_idxt_off);
    write_u32_be(meta, 24, static_cast<std::uint32_t>(entry_recs.size()));
    write_u32_be(meta, 28, 65001U);
    write_u32_be(meta, 32, 0xFFFFFFFFU);
    write_u32_be(meta, 36, static_cast<std::uint32_t>(raw_entries.size()));
    write_u32_be(meta, 52, static_cast<std::uint32_t>(cncx_recs.size()));

    std::vector<std::string> out;
    out.reserve(1 + entry_recs.size() + cncx_recs.size());
    out.push_back(std::move(meta));
    for (auto& er : entry_recs) {
        out.push_back(std::move(er.data));
    }
    for (auto& cr : cncx_recs) {
        out.push_back(std::move(cr));
    }
    return out;
}

DecodedIndx decode_indx_table(const std::vector<std::string_view>& records, std::size_t start) {
    DecodedIndx result;
    if (start >= records.size()) {
        return result;
    }
    const std::string_view meta = records[start];
    if (meta.size() < kIndxHeaderLen || meta.substr(0, 4) != "INDX") {
        return result;
    }
    const std::uint32_t hdr_len = read_u32_be(meta, 4);
    const std::uint32_t entry_rec_count = read_u32_be(meta, 24);
    const std::uint32_t cncx_count = read_u32_be(meta, 52);
    if (hdr_len < 56 || hdr_len > meta.size()) {
        return result;
    }
    if (start + 1 + entry_rec_count > records.size()) {
        return result;
    }

    // Parse TAGX block in meta record.
    std::uint32_t num_ctrl_bytes = 0;
    std::vector<TagDesc> tags;
    if (hdr_len + 12 <= meta.size() && meta.substr(hdr_len, 4) == "TAGX") {
        const std::uint32_t tagx_len = read_u32_be(meta, hdr_len + 4);
        num_ctrl_bytes = read_u32_be(meta, hdr_len + 8);
        if (tagx_len >= 12 && hdr_len + tagx_len <= meta.size()) {
            for (std::size_t p = hdr_len + 12; p + 4 <= hdr_len + tagx_len; p += 4) {
                tags.push_back(TagDesc{
                    static_cast<std::uint8_t>(meta[p]),
                    static_cast<std::uint8_t>(meta[p + 1]),
                    static_cast<std::uint8_t>(meta[p + 2]),
                    static_cast<std::uint8_t>(meta[p + 3]),
                });
            }
        }
    }

    // Concatenate CNCX records if present.
    const std::size_t cncx_start = start + 1 + entry_rec_count;
    for (std::size_t c = 0; c < cncx_count && cncx_start + c < records.size(); ++c) {
        result.cncx.append(records[cncx_start + c]);
    }

    // Parse each entry record.
    for (std::size_t r = 0; r < entry_rec_count; ++r) {
        const std::string_view rec = records[start + 1 + r];
        if (rec.size() < kIndxHeaderLen || rec.substr(0, 4) != "INDX") {
            continue;
        }
        const std::uint32_t idxt_off = read_u32_be(rec, 20);
        const std::uint32_t count = read_u32_be(rec, 24);
        if (idxt_off + 4 + count * 2U > rec.size() || rec.substr(idxt_off, 4) != "IDXT") {
            continue;
        }
        for (std::uint32_t i = 0; i < count; ++i) {
            const std::uint16_t eoff = read_u16_be(rec, idxt_off + 4 + i * 2U);
            const std::size_t eend =
                (i + 1 < count) ? read_u16_be(rec, idxt_off + 4 + (i + 1) * 2U) : idxt_off;
            if (eoff >= rec.size() || eend > rec.size() || eoff >= eend) {
                continue;
            }
            std::size_t pos = eoff;
            const std::uint8_t key_len = static_cast<std::uint8_t>(rec[pos++]);
            if (pos + key_len > eend) {
                continue;
            }
            DecodedEntry de;
            de.key = std::string(rec.substr(pos, key_len));
            pos += key_len;

            if (num_ctrl_bytes == 0 || pos + num_ctrl_bytes > eend) {
                result.entries.push_back(std::move(de));
                continue;
            }
            const std::string_view ctrl = rec.substr(pos, num_ctrl_bytes);
            pos += num_ctrl_bytes;

            // Collect present tags and counts before reading their values sequentially.
            struct PendingTag {
                std::uint8_t id;
                std::uint32_t value_count;
                std::optional<std::uint32_t> byte_count;
            };
            std::vector<PendingTag> pending;
            std::size_t ctrl_idx = 0;
            for (const auto& t : tags) {
                if (t.eof == 1) {
                    ++ctrl_idx;
                    continue;
                }
                if (ctrl_idx >= ctrl.size()) {
                    break;
                }
                const std::uint8_t cb = static_cast<std::uint8_t>(ctrl[ctrl_idx]);
                const std::uint8_t masked = cb & t.bitmask;
                if (masked == 0) {
                    continue;
                }
                const unsigned shift = count_trailing_zeros(t.bitmask);
                const std::uint8_t shifted = masked >> shift;
                const std::uint8_t max_val = t.bitmask >> shift;
                if (popcount8(t.bitmask) > 1 && shifted == max_val) {
                    std::uint32_t v = 0;
                    if (!read_vwi_forward(rec.substr(0, eend), pos, v)) {
                        break;
                    }
                    pending.push_back(PendingTag{t.id, 0, v});
                } else {
                    pending.push_back(PendingTag{t.id, static_cast<std::uint32_t>(shifted) * t.num_values,
                                                 std::nullopt});
                }
            }

            for (const auto& pt : pending) {
                auto& vals = de.tags[pt.id];
                if (pt.byte_count) {
                    const std::size_t limit = std::min<std::size_t>(eend, pos + *pt.byte_count);
                    while (pos < limit) {
                        std::uint32_t v = 0;
                        if (!read_vwi_forward(rec.substr(0, limit), pos, v)) {
                            break;
                        }
                        vals.push_back(v);
                    }
                } else {
                    for (std::uint32_t k = 0; k < pt.value_count && pos < eend; ++k) {
                        std::uint32_t v = 0;
                        if (!read_vwi_forward(rec.substr(0, eend), pos, v)) {
                            break;
                        }
                        vals.push_back(v);
                    }
                }
            }
            result.entries.push_back(std::move(de));
        }
    }
    return result;
}

}  // namespace

void append_vwi_forward(std::string& dst, std::uint32_t value) {
    unsigned char tmp[5];
    int n = 0;
    tmp[n++] = static_cast<unsigned char>(value & 0x7FU);
    value >>= 7;
    while (value != 0 && n < 5) {
        tmp[n++] = static_cast<unsigned char>(value & 0x7FU);
        value >>= 7;
    }
    for (int i = n - 1; i >= 0; --i) {
        unsigned char b = tmp[i];
        if (i == 0) {
            b |= 0x80U;
        }
        dst.push_back(static_cast<char>(b));
    }
}

bool read_vwi_forward(std::string_view src, std::size_t& pos, std::uint32_t& out) {
    std::uint32_t val = 0;
    for (int i = 0; i < 5 && pos < src.size(); ++i) {
        const unsigned char b = static_cast<unsigned char>(src[pos++]);
        val = (val << 7) | (b & 0x7FU);
        if ((b & 0x80U) != 0) {
            out = val;
            return true;
        }
    }
    return false;
}

std::vector<std::string> build_mobi7_ncx(const std::vector<MobiNavEntry>& entries) {
    const std::vector<TagDesc> defs = {
        {1, 1, 0x01, 0},  // offset
        {2, 1, 0x02, 0},  // length
        {3, 1, 0x04, 0},  // CNCX label
        {4, 1, 0x08, 0},  // depth
        {0, 0, 0x00, 1},  // end of control byte 0
    };
    std::string cncx;
    std::vector<std::pair<std::string, std::string>> rows;
    rows.reserve(entries.size());
    for (std::size_t i = 0; i < entries.size(); ++i) {
        const auto& e = entries[i];
        const std::uint32_t label_off = append_cncx_string(cncx, e.label);
        std::string payload;
        payload.push_back(static_cast<char>(0x0F));  // tags 1, 2, 3, 4 present
        append_vwi_forward(payload, e.offset);
        append_vwi_forward(payload, e.length);
        append_vwi_forward(payload, label_off);
        append_vwi_forward(payload, static_cast<std::uint32_t>(std::max(0, e.depth)));
        rows.emplace_back(format_hex_key(i, 4), std::move(payload));
    }
    return build_indx_table(defs, 1, rows, cncx);
}

std::vector<std::string> build_kf8_ncx(const std::vector<MobiNavEntry>& entries) {
    const std::vector<TagDesc> defs = {
        {1, 1, 0x01, 0},   // offset
        {2, 1, 0x02, 0},   // length
        {3, 1, 0x04, 0},   // CNCX label
        {4, 1, 0x08, 0},   // depth
        {21, 1, 0x10, 0},  // parent index
        {22, 1, 0x20, 0},  // first child
        {23, 1, 0x40, 0},  // last child
        {6, 2, 0x80, 0},   // pos_fid (fid, fid_offset)
        {0, 0, 0x00, 1},   // end of control byte 0
    };
    std::string cncx;
    std::vector<std::pair<std::string, std::string>> rows;
    rows.reserve(entries.size());
    for (std::size_t i = 0; i < entries.size(); ++i) {
        const auto& e = entries[i];
        const std::uint32_t label_off = append_cncx_string(cncx, e.label);
        std::uint8_t ctrl = 0x0F | 0x80U;  // tags 1,2,3,4,6 always present
        if (e.parent >= 0) {
            ctrl |= 0x10U;
        }
        if (e.first_child >= 0) {
            ctrl |= 0x20U;
        }
        if (e.last_child >= 0) {
            ctrl |= 0x40U;
        }
        std::string payload;
        payload.push_back(static_cast<char>(ctrl));
        append_vwi_forward(payload, e.offset);
        append_vwi_forward(payload, e.length);
        append_vwi_forward(payload, label_off);
        append_vwi_forward(payload, static_cast<std::uint32_t>(std::max(0, e.depth)));
        if (e.parent >= 0) {
            append_vwi_forward(payload, static_cast<std::uint32_t>(e.parent));
        }
        if (e.first_child >= 0) {
            append_vwi_forward(payload, static_cast<std::uint32_t>(e.first_child));
        }
        if (e.last_child >= 0) {
            append_vwi_forward(payload, static_cast<std::uint32_t>(e.last_child));
        }
        append_vwi_forward(payload, e.fid);
        append_vwi_forward(payload, e.fid_offset);
        rows.emplace_back(format_hex_key(i, 4), std::move(payload));
    }
    return build_indx_table(defs, 1, rows, cncx);
}

std::vector<std::string> build_kf8_skel(const std::vector<SkelEntry>& skels) {
    const std::vector<TagDesc> defs = {
        {1, 1, 0x03, 0},  // chunk count (2-bit mask, value 1 -> 1 VWI)
        {6, 2, 0x0C, 0},  // start_pos, length (2 values)
        {0, 0, 0x00, 1},
    };
    std::vector<std::pair<std::string, std::string>> rows;
    rows.reserve(skels.size());
    for (std::size_t i = 0; i < skels.size(); ++i) {
        const auto& s = skels[i];
        std::string payload;
        // ctrl: tag 1 count = 1 (0x01), tag 6 count = 1 (0x04) -> 0x05
        payload.push_back(static_cast<char>(0x05));
        append_vwi_forward(payload, s.chunk_count);
        append_vwi_forward(payload, s.start_pos);
        append_vwi_forward(payload, s.length);
        rows.emplace_back(s.key.empty() ? ("SKEL" + format_hex_key(i, 10)) : s.key,
                          std::move(payload));
    }
    return build_indx_table(defs, 1, rows, {});
}

std::vector<std::string> build_kf8_frag(const std::vector<FragEntry>& frags) {
    const std::vector<TagDesc> defs = {
        {2, 1, 0x01, 0},  // CNCX selector
        {3, 1, 0x02, 0},  // skeleton index
        {4, 1, 0x04, 0},  // chunk insert position
        {6, 2, 0x08, 0},  // start_pos, length
        {0, 0, 0x00, 1},
    };
    std::string cncx;
    std::vector<std::pair<std::string, std::string>> rows;
    rows.reserve(frags.size());
    for (std::size_t i = 0; i < frags.size(); ++i) {
        const auto& f = frags[i];
        const std::uint32_t sel_off = append_cncx_string(cncx, f.selector);
        std::string payload;
        payload.push_back(static_cast<char>(0x0F));  // tags 2, 3, 4, 6
        append_vwi_forward(payload, sel_off);
        append_vwi_forward(payload, f.skeleton_index);
        append_vwi_forward(payload, f.insert_pos);
        append_vwi_forward(payload, f.start_pos);
        append_vwi_forward(payload, f.length);
        rows.emplace_back(f.aid.empty() ? format_hex_key(i, 10) : f.aid, std::move(payload));
    }
    return build_indx_table(defs, 1, rows, cncx);
}

std::vector<std::string> build_kf8_guide(const std::vector<MobiGuideEntry>& guides) {
    const std::vector<TagDesc> defs = {
        {1, 1, 0x01, 0},  // CNCX title
        {6, 2, 0x02, 0},  // pos_fid (fid, fid_offset)
        {0, 0, 0x00, 1},
    };
    std::string cncx;
    std::vector<std::pair<std::string, std::string>> rows;
    rows.reserve(guides.size());
    for (const auto& g : guides) {
        const std::uint32_t title_off = append_cncx_string(cncx, g.title);
        std::string payload;
        payload.push_back(static_cast<char>(0x03));  // tags 1 and 6
        append_vwi_forward(payload, title_off);
        append_vwi_forward(payload, g.fid);
        append_vwi_forward(payload, g.fid_offset);
        rows.emplace_back(g.type, std::move(payload));
    }
    return build_indx_table(defs, 1, rows, cncx);
}

std::string build_fdst(const std::vector<std::pair<std::uint32_t, std::uint32_t>>& flows) {
    std::string out;
    out.reserve(12 + flows.size() * 8U);
    out.append("FDST", 4);
    append_u32_be(out, 12);
    append_u32_be(out, static_cast<std::uint32_t>(flows.size()));
    for (const auto& [start, end] : flows) {
        append_u32_be(out, start);
        append_u32_be(out, end);
    }
    return out;
}

std::string make_flis_record() {
    std::string out;
    out.reserve(36);
    out.append("FLIS", 4);
    append_u32_be(out, 8);
    append_u16_be(out, 65);
    append_u16_be(out, 0);
    append_u32_be(out, 0);
    append_u32_be(out, 0xFFFFFFFFU);
    append_u16_be(out, 1);
    append_u16_be(out, 3);
    append_u32_be(out, 3);
    append_u32_be(out, 1);
    append_u32_be(out, 0xFFFFFFFFU);
    return out;
}

std::string make_fcis_record(std::uint32_t text_length) {
    std::string out;
    out.reserve(44);
    out.append("FCIS", 4);
    append_u32_be(out, 20);
    append_u32_be(out, 16);
    append_u32_be(out, 1);
    append_u32_be(out, 0);
    append_u32_be(out, text_length);
    append_u32_be(out, 0);
    append_u32_be(out, 32);
    append_u32_be(out, 8);
    append_u32_be(out, 1);
    append_u32_be(out, 1);
    append_u32_be(out, 0);
    return out;
}

std::string make_eof_record() {
    return std::string("\xE9\x8E\x0D\x0A", 4);
}

std::vector<std::pair<std::uint32_t, std::uint32_t>> parse_fdst(std::string_view record,
                                                                std::size_t stream_len) {
    std::vector<std::pair<std::uint32_t, std::uint32_t>> flows;
    if (record.size() < 12 || record.substr(0, 4) != "FDST") {
        return flows;
    }
    const std::uint32_t sec_start = read_u32_be(record, 4);
    const std::uint32_t num_entries = read_u32_be(record, 8);
    if (sec_start < 12 || static_cast<std::size_t>(sec_start) + num_entries * 8ULL > record.size()) {
        return flows;
    }
    flows.reserve(num_entries);
    for (std::uint32_t i = 0; i < num_entries; ++i) {
        const std::uint32_t start = read_u32_be(record, sec_start + i * 8U);
        const std::uint32_t end = read_u32_be(record, sec_start + i * 8U + 4U);
        if (start <= end && end <= stream_len) {
            flows.emplace_back(start, end);
        }
    }
    return flows;
}

std::vector<MobiNavEntry> parse_ncx_indx(const std::vector<std::string_view>& records,
                                         std::size_t indx_start) {
    const DecodedIndx decoded = decode_indx_table(records, indx_start);
    std::vector<MobiNavEntry> out;
    out.reserve(decoded.entries.size());
    for (const auto& de : decoded.entries) {
        MobiNavEntry nav;
        if (auto it = de.tags.find(1); it != de.tags.end() && !it->second.empty()) {
            nav.offset = it->second[0];
        }
        if (auto it = de.tags.find(2); it != de.tags.end() && !it->second.empty()) {
            nav.length = it->second[0];
        }
        if (auto it = de.tags.find(3); it != de.tags.end() && !it->second.empty()) {
            nav.label = read_cncx_string(decoded.cncx, it->second[0]);
        }
        if (auto it = de.tags.find(4); it != de.tags.end() && !it->second.empty()) {
            nav.depth = static_cast<int>(it->second[0]);
        }
        if (auto it = de.tags.find(21); it != de.tags.end() && !it->second.empty()) {
            nav.parent = static_cast<int>(it->second[0]);
        }
        if (auto it = de.tags.find(22); it != de.tags.end() && !it->second.empty()) {
            nav.first_child = static_cast<int>(it->second[0]);
        }
        if (auto it = de.tags.find(23); it != de.tags.end() && !it->second.empty()) {
            nav.last_child = static_cast<int>(it->second[0]);
        }
        if (auto it = de.tags.find(6); it != de.tags.end() && it->second.size() >= 2) {
            nav.fid = it->second[0];
            nav.fid_offset = it->second[1];
        }
        out.push_back(std::move(nav));
    }
    return out;
}

Kf8SkelFragData parse_kf8_skel_frag(const std::vector<std::string_view>& records,
                                    std::size_t skel_start, std::size_t frag_start) {
    Kf8SkelFragData data;
    const DecodedIndx skel_dec = decode_indx_table(records, skel_start);
    for (const auto& de : skel_dec.entries) {
        SkelEntry s;
        s.key = de.key;
        if (auto it = de.tags.find(1); it != de.tags.end() && !it->second.empty()) {
            s.chunk_count = it->second[0];
        }
        if (auto it = de.tags.find(6); it != de.tags.end() && it->second.size() >= 2) {
            s.start_pos = it->second[0];
            s.length = it->second[1];
        }
        data.skels.push_back(std::move(s));
    }

    const DecodedIndx frag_dec = decode_indx_table(records, frag_start);
    for (const auto& de : frag_dec.entries) {
        FragEntry f;
        f.aid = de.key;
        if (auto it = de.tags.find(2); it != de.tags.end() && !it->second.empty()) {
            f.selector = read_cncx_string(frag_dec.cncx, it->second[0]);
        }
        if (auto it = de.tags.find(3); it != de.tags.end() && !it->second.empty()) {
            f.skeleton_index = it->second[0];
        }
        if (auto it = de.tags.find(4); it != de.tags.end() && !it->second.empty()) {
            f.insert_pos = it->second[0];
        }
        if (auto it = de.tags.find(6); it != de.tags.end() && it->second.size() >= 2) {
            f.start_pos = it->second[0];
            f.length = it->second[1];
        }
        data.frags.push_back(std::move(f));
    }
    return data;
}

std::vector<MobiGuideEntry> parse_kf8_guide(const std::vector<std::string_view>& records,
                                            std::size_t guide_start) {
    const DecodedIndx decoded = decode_indx_table(records, guide_start);
    std::vector<MobiGuideEntry> out;
    out.reserve(decoded.entries.size());
    for (const auto& de : decoded.entries) {
        MobiGuideEntry g;
        g.type = de.key;
        if (auto it = de.tags.find(1); it != de.tags.end() && !it->second.empty()) {
            g.title = read_cncx_string(decoded.cncx, it->second[0]);
        }
        if (auto it = de.tags.find(6); it != de.tags.end() && it->second.size() >= 2) {
            g.fid = it->second[0];
            g.fid_offset = it->second[1];
        }
        out.push_back(std::move(g));
    }
    return out;
}

}  // namespace mfbe::mobi
