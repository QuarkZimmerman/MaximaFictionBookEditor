// EXTH TLV codec, Windows LCID mapping, and MFBE EXTH 59901 round-trip record (T008).
#include "mobi/exth.hpp"

#include "mobi/palmdb.hpp"
#include "util/sha256.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <zlib.h>

namespace mfbe::mobi {
namespace {

using json = nlohmann::json;

struct LcidPair {
    const char* tag;
    std::uint32_t lcid;
};

// Primary BCP-47 to Windows LCID table (spec D4; MOBI header offset 92).
constexpr std::array<LcidPair, 42> kLcidTable = {{
    {"en", 0x0409}, {"en-us", 0x0409}, {"en-gb", 0x0809}, {"ru", 0x0419},    {"uk", 0x0422},
    {"be", 0x0423}, {"de", 0x0407},    {"fr", 0x040C},    {"es", 0x0C0A},    {"it", 0x0410},
    {"pt", 0x0816}, {"pt-br", 0x0416}, {"pl", 0x0415},    {"cs", 0x0405},    {"sk", 0x041B},
    {"bg", 0x0402}, {"sr", 0x0C1A},    {"hr", 0x041A},    {"sl", 0x0424},    {"nl", 0x0413},
    {"sv", 0x041D}, {"da", 0x0406},    {"nb", 0x0414},    {"no", 0x0414},    {"fi", 0x040B},
    {"hu", 0x040E}, {"ro", 0x0418},    {"el", 0x0408},    {"tr", 0x041F},    {"ar", 0x0401},
    {"he", 0x040D}, {"ja", 0x0411},    {"zh", 0x0804},    {"zh-cn", 0x0804}, {"zh-tw", 0x0404},
    {"ko", 0x0412}, {"lt", 0x0427},    {"lv", 0x0426},    {"et", 0x0425},    {"ka", 0x0437},
    {"hy", 0x042B}, {"kk", 0x043F},
}};

std::string normalize_lang_lower(std::string_view lang) {
    std::string out;
    out.reserve(lang.size());
    for (char c : lang) {
        if (c == '_') {
            out.push_back('-');
        } else if (!std::isspace(static_cast<unsigned char>(c))) {
            out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
        }
    }
    return out;
}

bool is_valid_language_tag(std::string_view lang) {
    const std::string norm = normalize_lang_lower(lang);
    if (norm.empty() || norm == "und") {
        return false;
    }
    // Primary subtag must be 2..3 ASCII letters.
    const std::size_t dash = norm.find('-');
    const std::string_view primary = (dash == std::string::npos)
                                         ? std::string_view(norm)
                                         : std::string_view(norm).substr(0, dash);
    if (primary.size() < 2 || primary.size() > 3) {
        return false;
    }
    return std::all_of(primary.begin(), primary.end(),
                       [](unsigned char c) { return c >= 'a' && c <= 'z'; });
}

constexpr std::size_t kMaxMfbeDecompressedBytes = 8ULL * 1024 * 1024;  // 8 MB safety cap

std::optional<std::string> zlib_inflate_bounded(std::string_view compressed,
                                                std::size_t max_bytes) {
    z_stream strm{};
    if (inflateInit(&strm) != Z_OK) {
        return std::nullopt;
    }
    strm.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(compressed.data()));
    strm.avail_in = static_cast<uInt>(compressed.size());

    std::string out;
    std::array<char, 16384> buf{};
    int ret = Z_OK;
    while (ret == Z_OK) {
        strm.next_out = reinterpret_cast<Bytef*>(buf.data());
        strm.avail_out = static_cast<uInt>(buf.size());
        ret = inflate(&strm, Z_NO_FLUSH);
        if (ret != Z_OK && ret != Z_STREAM_END) {
            inflateEnd(&strm);
            return std::nullopt;
        }
        const std::size_t produced = buf.size() - strm.avail_out;
        if (out.size() + produced > max_bytes) {
            inflateEnd(&strm);
            return std::nullopt;
        }
        out.append(buf.data(), produced);
    }
    inflateEnd(&strm);
    if (ret != Z_STREAM_END) {
        return std::nullopt;
    }
    return out;
}

}  // namespace

std::vector<ExthEntry> parse_exth(std::string_view bytes, std::size_t* consumed_bytes) {
    if (bytes.size() < 12 || bytes.substr(0, 4) != "EXTH") {
        throw MobiError("damaged", "missing EXTH magic");
    }
    const std::uint32_t header_len = read_u32_be(bytes, 4);
    const std::uint32_t count = read_u32_be(bytes, 8);
    if (header_len < 12 || header_len > bytes.size()) {
        throw MobiError("damaged", "EXTH header length out of bounds");
    }

    std::vector<ExthEntry> out;
    out.reserve(std::min<std::uint32_t>(count, 256));
    std::size_t pos = 12;
    for (std::uint32_t i = 0; i < count; ++i) {
        if (pos + 8 > header_len) {
            throw MobiError("damaged", "truncated EXTH record header");
        }
        const std::uint32_t type = read_u32_be(bytes, pos);
        const std::uint32_t rec_len = read_u32_be(bytes, pos + 4);
        if (rec_len < 8 || pos + rec_len > header_len) {
            throw MobiError("damaged", "EXTH record length out of bounds");
        }
        out.push_back(ExthEntry{type, std::string(bytes.substr(pos + 8, rec_len - 8))});
        pos += rec_len;
    }

    if (consumed_bytes != nullptr) {
        const std::size_t pad = (4U - (header_len % 4U)) % 4U;
        *consumed_bytes = std::min<std::size_t>(bytes.size(), header_len + pad);
    }
    return out;
}

std::string serialize_exth(const std::vector<ExthEntry>& entries) {
    std::string body;
    for (const auto& e : entries) {
        append_u32_be(body, e.type);
        append_u32_be(body, static_cast<std::uint32_t>(8U + e.data.size()));
        body.append(e.data);
    }
    const std::uint32_t total_len = static_cast<std::uint32_t>(12U + body.size());
    const std::size_t pad = (4U - (total_len % 4U)) % 4U;

    std::string out;
    out.reserve(total_len + pad);
    out.append("EXTH");
    append_u32_be(out, total_len);
    append_u32_be(out, static_cast<std::uint32_t>(entries.size()));
    out.append(body);
    out.append(pad, '\0');
    return out;
}

std::uint32_t lcid_from_bcp47(std::string_view lang) {
    const std::string norm = normalize_lang_lower(lang);
    if (norm.empty() || norm == "und") {
        return 0;
    }
    for (const auto& p : kLcidTable) {
        if (norm == p.tag) {
            return p.lcid;
        }
    }
    const std::size_t dash = norm.find('-');
    if (dash != std::string::npos) {
        const std::string_view primary = std::string_view(norm).substr(0, dash);
        for (const auto& p : kLcidTable) {
            if (primary == p.tag) {
                return p.lcid;
            }
        }
    }
    return 0;
}

std::string bcp47_from_lcid(std::uint32_t lcid) {
    if (lcid == 0) {
        return "";
    }
    const std::uint32_t low = lcid & 0xFFFFU;
    for (const auto& p : kLcidTable) {
        if (p.lcid == low) {
            return p.tag;
        }
    }
    // Primary language ID fallback (low 10 bits).
    const std::uint32_t primary = low & 0x03FFU;
    for (const auto& p : kLcidTable) {
        if ((p.lcid & 0x03FFU) == primary) {
            const std::string_view tag(p.tag);
            const std::size_t dash = tag.find('-');
            return std::string(dash == std::string_view::npos ? tag : tag.substr(0, dash));
        }
    }
    return "";
}

std::vector<ExthEntry> build_export_exth(const MobiMetadata& meta,
                                         std::optional<std::uint32_t> cover_offset,
                                         std::optional<std::uint32_t> thumb_offset,
                                         std::optional<std::uint32_t> open_at_offset,
                                         std::optional<std::uint32_t> kf8_boundary_rec,
                                         std::optional<std::uint32_t> resource_count, bool is_kf8,
                                         std::optional<std::string_view> mfbe_payload) {
    std::vector<ExthEntry> entries;
    for (const auto& a : meta.authors) {
        if (!a.empty()) {
            entries.push_back({100, a});
        }
    }
    if (!meta.publisher.empty()) {
        entries.push_back({101, meta.publisher});
    }
    if (!meta.description.empty()) {
        entries.push_back({103, meta.description});
    }
    if (!meta.isbn.empty()) {
        entries.push_back({104, meta.isbn});
    }
    for (const auto& s : meta.subjects) {
        if (!s.empty()) {
            entries.push_back({105, s});
        }
    }
    if (!meta.date.empty()) {
        entries.push_back({106, meta.date});
    }
    for (const auto& c : meta.contributors) {
        if (!c.empty()) {
            entries.push_back({108, c});
        }
    }
    if (!meta.identifier.empty()) {
        entries.push_back({112, meta.identifier});
    }
    if (open_at_offset) {
        entries.push_back({116, encode_u32_be(*open_at_offset)});
    }
    if (kf8_boundary_rec) {
        entries.push_back({121, encode_u32_be(*kf8_boundary_rec)});
    }
    if (resource_count) {
        entries.push_back({125, encode_u32_be(*resource_count)});
    }
    if (is_kf8) {
        entries.push_back({131, encode_u32_be(0)});
    }
    if (cover_offset) {
        entries.push_back({201, encode_u32_be(*cover_offset)});
        if (thumb_offset) {
            entries.push_back({202, encode_u32_be(*thumb_offset)});
        }
        entries.push_back({203, encode_u32_be(0)});
    }
    // Creator software metadata (204..207).
    entries.push_back({204, encode_u32_be(202)});
    entries.push_back({205, encode_u32_be(0)});
    entries.push_back({206, encode_u32_be(0)});
    entries.push_back({207, encode_u32_be(13)});

    // NOTE: Store-only EXTH 113 (ASIN) and 501 (CDE type) are intentionally omitted per spec D5.
    const std::string& shelf_title = !meta.updated_title.empty() ? meta.updated_title : meta.title;
    if (!shelf_title.empty()) {
        entries.push_back({503, shelf_title});
    }
    if (is_valid_language_tag(meta.language)) {
        entries.push_back({524, meta.language});
    }
    if (mfbe_payload && !mfbe_payload->empty()) {
        entries.push_back({kExthMfbeType, std::string(*mfbe_payload)});
    }
    return entries;
}

MobiMetadata metadata_from_exth(const std::vector<ExthEntry>& entries,
                                std::string_view header_title, std::uint32_t header_locale) {
    MobiMetadata meta;
    meta.title = std::string(header_title);
    for (const auto& e : entries) {
        switch (e.type) {
            case 100:
                meta.authors.push_back(e.data);
                break;
            case 101:
                meta.publisher = e.data;
                break;
            case 103:
                meta.description = e.data;
                break;
            case 104:
                meta.isbn = e.data;
                break;
            case 105:
                meta.subjects.push_back(e.data);
                break;
            case 106:
                meta.date = e.data;
                break;
            case 108:
                meta.contributors.push_back(e.data);
                break;
            case 109:
                meta.rights = e.data;
                break;
            case 112:
                meta.identifier = e.data;
                break;
            case 503:
                meta.updated_title = e.data;
                meta.title = e.data;
                break;
            case 524:
                meta.language = e.data;
                break;
            default:
                break;
        }
    }
    if (meta.language.empty() && header_locale != 0) {
        meta.language = bcp47_from_lcid(header_locale);
    }
    return meta;
}

std::string compute_html_sha256(std::string_view canonical_html) {
    return mfbe::util::sha256_hex(canonical_html);
}

std::string compute_meta_sha256(const MobiMetadata& meta) {
    const std::string& effective_title =
        !meta.updated_title.empty() ? meta.updated_title : meta.title;
    // nlohmann::json object iterates keys in sorted order, giving deterministic serialization.
    const json canonical = {
        {"authors", meta.authors},
        {"date", meta.date},
        {"description", meta.description},
        {"isbn", meta.isbn},
        {"language", is_valid_language_tag(meta.language) ? meta.language : std::string()},
        {"publisher", meta.publisher},
        {"subjects", meta.subjects},
        {"title", effective_title},
    };
    return mfbe::util::sha256_hex(canonical.dump());
}

std::optional<std::string> encode_mfbe_record(json mfbe_json, std::string_view canonical_html,
                                              const MobiMetadata& exported_meta) {
    if (!mfbe_json.is_object()) {
        return std::nullopt;
    }
    mfbe_json["v"] = 1;
    mfbe_json["digests"] = {
        {"htmlSha256", compute_html_sha256(canonical_html)},
        {"metaSha256", compute_meta_sha256(exported_meta)},
    };
    const std::string serialized = mfbe_json.dump();

    uLongf dest_len = compressBound(static_cast<uLong>(serialized.size()));
    std::string compressed(dest_len, '\0');
    const int rc = compress2(reinterpret_cast<Bytef*>(compressed.data()), &dest_len,
                             reinterpret_cast<const Bytef*>(serialized.data()),
                             static_cast<uLong>(serialized.size()), 6);
    if (rc != Z_OK) {
        return std::nullopt;
    }
    compressed.resize(dest_len);

    std::string envelope;
    envelope.reserve(6 + compressed.size());
    envelope.append("MFBE", 4);
    envelope.push_back(1);  // format_version = 1
    envelope.push_back(0);  // reserved flags = 0
    envelope.append(compressed);
    if (envelope.size() > kMaxMfbeCompressedBytes) {
        return std::nullopt;
    }
    return envelope;
}

MfbeDecodeResult decode_and_verify_mfbe(std::string_view raw_exth_payload,
                                        std::string_view actual_html,
                                        const MobiMetadata& actual_meta) {
    MfbeDecodeResult res;
    if (raw_exth_payload.size() < 7 || raw_exth_payload.substr(0, 4) != "MFBE") {
        res.status = MfbeStatus::corrupt;
        return res;
    }
    const unsigned char version = static_cast<unsigned char>(raw_exth_payload[4]);
    if (version != 1) {
        res.status = MfbeStatus::corrupt;
        return res;
    }
    const auto inflated =
        zlib_inflate_bounded(raw_exth_payload.substr(6), kMaxMfbeDecompressedBytes);
    if (!inflated) {
        res.status = MfbeStatus::corrupt;
        return res;
    }
    json parsed = json::parse(*inflated, nullptr, false);
    if (parsed.is_discarded() || !parsed.is_object() || parsed.value("v", 0) != 1 ||
        !parsed.contains("digests") || !parsed["digests"].is_object()) {
        res.status = MfbeStatus::corrupt;
        return res;
    }
    const auto& digests = parsed["digests"];
    if (!digests.contains("htmlSha256") || !digests["htmlSha256"].is_string() ||
        !digests.contains("metaSha256") || !digests["metaSha256"].is_string()) {
        res.status = MfbeStatus::corrupt;
        return res;
    }

    const std::string expected_html = digests["htmlSha256"].get<std::string>();
    const std::string expected_meta = digests["metaSha256"].get<std::string>();
    res.html_matches = (compute_html_sha256(actual_html) == expected_html);
    res.meta_matches = (compute_meta_sha256(actual_meta) == expected_meta);
    res.json = std::move(parsed);
    res.status = (res.html_matches && res.meta_matches) ? MfbeStatus::valid
                                                        : MfbeStatus::externally_modified;
    return res;
}

}  // namespace mfbe::mobi
