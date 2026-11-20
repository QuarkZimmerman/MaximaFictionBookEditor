// PalmDB container reader/writer and magic sniffing (T006, contracts/mobi-file.md §1).
#include "mobi/palmdb.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>

namespace mfbe::mobi {
namespace {

constexpr std::size_t kPalmDbHeaderSize = 78;

bool starts_with_icase(std::string_view s, std::string_view prefix) {
    if (s.size() < prefix.size()) {
        return false;
    }
    for (std::size_t i = 0; i < prefix.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(s[i])) !=
            std::tolower(static_cast<unsigned char>(prefix[i]))) {
            return false;
        }
    }
    return true;
}

bool looks_like_fictionbook_xml(std::string_view data) {
    // Skip optional UTF-8 BOM and leading ASCII whitespace.
    if (data.size() >= 3 && static_cast<unsigned char>(data[0]) == 0xEFU &&
        static_cast<unsigned char>(data[1]) == 0xBBU &&
        static_cast<unsigned char>(data[2]) == 0xBFU) {
        data.remove_prefix(3);
    }
    while (!data.empty() && std::isspace(static_cast<unsigned char>(data.front()))) {
        data.remove_prefix(1);
    }
    if (data.empty() || data.front() != '<') {
        return false;
    }
    // Inspect first 512 bytes for <FictionBook or <FBD root tag (after optional <?xml ...?>).
    const std::string_view head = data.substr(0, std::min<std::size_t>(data.size(), 512));
    if (starts_with_icase(head, "<FictionBook") || starts_with_icase(head, "<FBD")) {
        return true;
    }
    if (starts_with_icase(head, "<?xml")) {
        if (head.find("FictionBook") != std::string_view::npos ||
            head.find("<FBD") != std::string_view::npos) {
            return true;
        }
    }
    return false;
}

}  // namespace

bool is_mobi_extension(std::string_view path_or_name) {
    const std::size_t slash = path_or_name.find_last_of("/\\");
    const std::string_view base =
        (slash == std::string_view::npos) ? path_or_name : path_or_name.substr(slash + 1);
    const std::size_t dot = base.find_last_of('.');
    if (dot == std::string_view::npos) {
        return false;
    }
    std::string ext(base.substr(dot));
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return ext == ".mobi" || ext == ".azw3" || ext == ".azw" || ext == ".prc";
}

SniffResult sniff_bytes(std::string_view prefix) {
    SniffResult res;
    if (prefix.size() >= 7 && static_cast<unsigned char>(prefix[0]) == 0xEAU &&
        prefix.substr(1, 6) == "DRMION") {
        res.kind = ContainerKind::kfx;
        return res;
    }
    if (prefix.size() >= 4 && (prefix.substr(0, 4) == "CONT" || prefix.substr(0, 4) == "KFX ")) {
        res.kind = ContainerKind::kfx;
        return res;
    }
    if (looks_like_fictionbook_xml(prefix)) {
        res.kind = ContainerKind::fictionBook;
        return res;
    }
    if (prefix.size() >= kPalmDbHeaderSize) {
        res.type_code = std::string(prefix.substr(60, 4));
        res.creator_code = std::string(prefix.substr(64, 4));
        if (res.type_code == "BOOK" && res.creator_code == "MOBI") {
            res.kind = ContainerKind::mobi7;
        } else if (res.type_code == "TEXt" && res.creator_code == "REAd") {
            res.kind = ContainerKind::palmdoc;
        }
    }
    return res;
}

PalmDb read_palmdb(std::string_view bytes) {
    if (bytes.size() > kMaxFileBytes) {
        throw MobiError("tooLarge", "file exceeds 150 MB limit");
    }
    const SniffResult sniff = sniff_bytes(bytes);
    if (sniff.kind == ContainerKind::kfx) {
        throw MobiError("kfx", "Amazon KFX container is not supported");
    }
    if (sniff.kind == ContainerKind::fictionBook) {
        throw MobiError("fictionBook", "file is a FictionBook XML document");
    }
    if (sniff.kind != ContainerKind::mobi7 && sniff.kind != ContainerKind::palmdoc) {
        throw MobiError("notMobi", "missing PalmDB BOOK/MOBI or TEXt/REAd header");
    }

    PalmDb db;
    // Database name: NUL-terminated within bytes 0..31.
    const std::string_view raw_name = bytes.substr(0, 32);
    const std::size_t nul = raw_name.find('\0');
    db.name = std::string(nul == std::string_view::npos ? raw_name : raw_name.substr(0, nul));
    db.created_at = read_u32_be(bytes, 36);
    db.modified_at = read_u32_be(bytes, 40);
    db.type = sniff.type_code;
    db.creator = sniff.creator_code;

    const std::uint16_t num_records = read_u16_be(bytes, 76);
    if (num_records < 2) {
        throw MobiError("damaged", "PalmDB has fewer than 2 records");
    }
    const std::size_t table_end = kPalmDbHeaderSize + static_cast<std::size_t>(num_records) * 8U;
    if (table_end > bytes.size()) {
        throw MobiError("damaged", "PalmDB record table extends past end of file");
    }

    std::vector<std::uint32_t> offsets(num_records);
    for (std::size_t i = 0; i < num_records; ++i) {
        const std::uint32_t off = read_u32_be(bytes, kPalmDbHeaderSize + i * 8U);
        if (off < table_end || off > bytes.size()) {
            throw MobiError("damaged", "PalmDB record offset out of bounds");
        }
        if (i > 0 && off < offsets[i - 1]) {
            throw MobiError("damaged", "PalmDB record offsets are not monotonic");
        }
        offsets[i] = off;
    }

    db.records.reserve(num_records);
    for (std::size_t i = 0; i < num_records; ++i) {
        const std::size_t start = offsets[i];
        const std::size_t end = (i + 1 < num_records) ? offsets[i + 1] : bytes.size();
        db.records.emplace_back(bytes.substr(start, end - start));
    }
    return db;
}

std::string write_palmdb(const PalmDb& db) {
    if (db.records.size() > kMaxRecords) {
        throw MobiError("checkFailed", "PalmDB record count exceeds 65535");
    }
    const std::size_t num_records = db.records.size();
    const std::size_t header_and_table = kPalmDbHeaderSize + num_records * 8U + 2U;

    std::size_t payload_size = 0;
    for (const auto& rec : db.records) {
        payload_size += rec.size();
    }
    if (header_and_table + payload_size > 0xFFFFFFFFULL) {
        throw MobiError("checkFailed", "PalmDB file exceeds 32-bit offset space");
    }

    std::string out(kPalmDbHeaderSize, '\0');
    const std::size_t name_len = std::min<std::size_t>(db.name.size(), 31);
    std::memcpy(out.data(), db.name.data(), name_len);
    write_u32_be(out, 36, db.created_at);
    write_u32_be(out, 40, db.modified_at);
    if (db.type.size() == 4) {
        std::memcpy(out.data() + 60, db.type.data(), 4);
    }
    if (db.creator.size() == 4) {
        std::memcpy(out.data() + 64, db.creator.data(), 4);
    }
    write_u16_be(out, 76, static_cast<std::uint16_t>(num_records));

    out.reserve(header_and_table + payload_size);
    std::uint32_t offset = static_cast<std::uint32_t>(header_and_table);
    for (std::size_t i = 0; i < num_records; ++i) {
        append_u32_be(out, offset);
        // attr (1 byte = 0) + unique_id (3 bytes = i)
        out.push_back(0);
        out.push_back(static_cast<char>((i >> 16) & 0xFFU));
        out.push_back(static_cast<char>((i >> 8) & 0xFFU));
        out.push_back(static_cast<char>(i & 0xFFU));
        offset += static_cast<std::uint32_t>(db.records[i].size());
    }
    // 2-byte zero gap after record info list.
    out.push_back(0);
    out.push_back(0);

    for (const auto& rec : db.records) {
        out.append(rec);
    }
    return out;
}

}  // namespace mfbe::mobi
