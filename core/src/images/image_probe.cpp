// Header-only image probing (T042). See mfbe/image_probe.hpp.
#include <mfbe/image_probe.hpp>

#include <algorithm>
#include <cctype>
#include <cstdint>

namespace mfbe::images {
namespace {

std::uint32_t u8(std::string_view s, std::size_t i) {
    return static_cast<unsigned char>(s[i]);
}
std::uint32_t be16(std::string_view s, std::size_t i) {
    return (u8(s, i) << 8) | u8(s, i + 1);
}
std::uint32_t le16(std::string_view s, std::size_t i) {
    return u8(s, i) | (u8(s, i + 1) << 8);
}
std::uint32_t be32(std::string_view s, std::size_t i) {
    return (be16(s, i) << 16) | be16(s, i + 2);
}
std::uint32_t le32(std::string_view s, std::size_t i) {
    return le16(s, i) | (le16(s, i + 2) << 16);
}
std::uint32_t le24(std::string_view s, std::size_t i) {
    return le16(s, i) | (u8(s, i + 2) << 16);
}

bool starts_with(std::string_view s, std::string_view prefix) {
    return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

std::optional<int> dim(std::uint32_t v) {
    if (v == 0 || v > 1000000) {
        return std::nullopt;
    }
    return static_cast<int>(v);
}

void probe_jpeg(std::string_view s, Probe& p) {
    // Walk the marker segments until a start-of-frame marker.
    std::size_t pos = 2;
    while (pos + 9 < s.size()) {
        if (u8(s, pos) != 0xFF) {
            ++pos;  // tolerate garbage between segments
            continue;
        }
        const std::uint32_t marker = u8(s, pos + 1);
        if (marker == 0xFF) {
            ++pos;  // fill byte
            continue;
        }
        if (marker == 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker == 0x01) {
            pos += 2;  // standalone markers
            continue;
        }
        if (marker == 0xD9 || marker == 0xDA) {
            return;  // end of image / start of scan: no frame header found
        }
        const bool sof = (marker >= 0xC0 && marker <= 0xCF) && marker != 0xC4 && marker != 0xC8 &&
                         marker != 0xCC;
        const std::uint32_t length = be16(s, pos + 2);
        if (sof) {
            if (pos + 9 <= s.size()) {
                p.height = dim(be16(s, pos + 5));
                p.width = dim(be16(s, pos + 7));
            }
            return;
        }
        if (length < 2) {
            return;
        }
        pos += 2 + length;
    }
}

void probe_tiff(std::string_view s, Probe& p) {
    const bool little = starts_with(s, "II");
    const auto r16 = [&](std::size_t i) { return little ? le16(s, i) : be16(s, i); };
    const auto r32 = [&](std::size_t i) { return little ? le32(s, i) : be32(s, i); };
    if (s.size() < 8) {
        return;
    }
    const std::uint32_t ifd = r32(4);
    if (ifd + 2 > s.size()) {
        return;
    }
    const std::uint32_t count = r16(ifd);
    for (std::uint32_t i = 0; i < count && i < 512; ++i) {
        const std::size_t entry = ifd + 2 + static_cast<std::size_t>(i) * 12;
        if (entry + 12 > s.size()) {
            return;
        }
        const std::uint32_t tag = r16(entry);
        const std::uint32_t type = r16(entry + 2);
        std::uint32_t value = 0;
        if (type == 3) {
            value = r16(entry + 8);
        } else if (type == 4) {
            value = r32(entry + 8);
        } else {
            continue;
        }
        if (tag == 256) {
            p.width = dim(value);
        } else if (tag == 257) {
            p.height = dim(value);
        }
    }
}

void probe_webp(std::string_view s, Probe& p) {
    if (s.size() < 30) {
        return;
    }
    const std::string_view chunk = s.substr(12, 4);
    if (chunk == "VP8 " && u8(s, 23) == 0x9D && u8(s, 24) == 0x01 && u8(s, 25) == 0x2A) {
        p.width = dim(le16(s, 26) & 0x3FFF);
        p.height = dim(le16(s, 28) & 0x3FFF);
    } else if (chunk == "VP8L" && u8(s, 20) == 0x2F) {
        const std::uint32_t bits = le32(s, 21);
        p.width = dim((bits & 0x3FFF) + 1);
        p.height = dim(((bits >> 14) & 0x3FFF) + 1);
    } else if (chunk == "VP8X") {
        p.width = dim(le24(s, 24) + 1);
        p.height = dim(le24(s, 27) + 1);
    }
}

}  // namespace

std::string sniff_content_type(std::string_view s) {
    if (starts_with(s, "\xFF\xD8\xFF")) {
        return "image/jpeg";
    }
    if (starts_with(s, "\x89PNG\r\n\x1A\n")) {
        return "image/png";
    }
    if (starts_with(s, "GIF87a") || starts_with(s, "GIF89a")) {
        return "image/gif";
    }
    if (starts_with(s, "BM") && s.size() >= 26) {
        return "image/bmp";
    }
    if (starts_with(s, "RIFF") && s.size() >= 12 && s.substr(8, 4) == "WEBP") {
        return "image/webp";
    }
    if (starts_with(s, "II*\0") || starts_with(s, "MM\0*")) {
        return "image/tiff";
    }
    if (starts_with(s, "<svg") ||
        (starts_with(s, "<?xml") && s.find("<svg") != std::string_view::npos)) {
        return "image/svg+xml";
    }
    return "";
}

Probe probe(std::string_view s) {
    Probe p;
    p.contentType = sniff_content_type(s);
    if (p.contentType == "image/jpeg") {
        p.decodable = true;
        probe_jpeg(s, p);
    } else if (p.contentType == "image/png") {
        p.decodable = true;
        if (s.size() >= 24 && s.substr(12, 4) == "IHDR") {
            p.width = dim(be32(s, 16));
            p.height = dim(be32(s, 20));
        }
    } else if (p.contentType == "image/gif") {
        p.decodable = true;
        if (s.size() >= 10) {
            p.width = dim(le16(s, 6));
            p.height = dim(le16(s, 8));
        }
    } else if (p.contentType == "image/bmp") {
        p.decodable = true;
        const std::uint32_t header_size = le32(s, 14);
        if (header_size == 12 && s.size() >= 22) {  // BITMAPCOREHEADER
            p.width = dim(le16(s, 18));
            p.height = dim(le16(s, 20));
        } else if (s.size() >= 26) {
            p.width = dim(le32(s, 18));
            const auto h = static_cast<std::int32_t>(le32(s, 22));
            p.height = dim(static_cast<std::uint32_t>(h < 0 ? -h : h));
        }
    } else if (p.contentType == "image/webp") {
        p.decodable = true;
        probe_webp(s, p);
    } else if (p.contentType == "image/tiff") {
        p.decodable = true;
        probe_tiff(s, p);
    }
    return p;
}

bool is_jpeg_or_png(std::string_view content_type) {
    std::string t(content_type);
    std::transform(t.begin(), t.end(), t.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return t == "image/jpeg" || t == "image/jpg" || t == "image/pjpeg" || t == "image/png";
}

std::string effective_content_type(std::string_view declared, std::string_view sniffed) {
    if (!sniffed.empty()) {
        return std::string(sniffed);
    }
    std::string t(declared);
    t.erase(t.begin(),
            std::find_if(t.begin(), t.end(), [](unsigned char c) { return !std::isspace(c); }));
    t.erase(
        std::find_if(t.rbegin(), t.rend(), [](unsigned char c) { return !std::isspace(c); }).base(),
        t.end());
    std::transform(t.begin(), t.end(), t.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (t.empty() || t.find('/') == std::string::npos) {
        return "application/octet-stream";
    }
    return t;
}

std::string extension_for(std::string_view content_type) {
    std::string t(content_type);
    std::transform(t.begin(), t.end(), t.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (t == "image/jpeg" || t == "image/jpg" || t == "image/pjpeg") {
        return "jpg";
    }
    if (t == "image/png") {
        return "png";
    }
    if (t == "image/gif") {
        return "gif";
    }
    if (t == "image/bmp" || t == "image/x-ms-bmp") {
        return "bmp";
    }
    if (t == "image/webp") {
        return "webp";
    }
    if (t == "image/tiff") {
        return "tif";
    }
    if (t == "image/svg+xml") {
        return "svg";
    }
    return "bin";
}

}  // namespace mfbe::images
