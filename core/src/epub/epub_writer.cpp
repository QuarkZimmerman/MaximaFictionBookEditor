// EPUB container services: writing an EPUB for the export (feature 012, T011; D3, D4, D13,
// contracts/rpc-api.md §3, research R3). The files are kept until commit(), which builds the ZIP
// with the archive module's writer (mimetype first, stored, no time stamp and no owner, so no extra
// field; JPEG and PNG pictures stored as they are, the rest deflated) and replaces the target with
// the atomic writer of every save.
#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/epub.hpp>

#include <algorithm>
#include <stdexcept>

namespace mfbe::epub {

namespace {

// Decodes one UTF-8 code point at `i`; -1 for invalid UTF-8.
long decode(std::string_view s, std::size_t& i) {
    const auto b = static_cast<unsigned char>(s[i]);
    const int extra = b < 0x80             ? 0
                      : (b & 0xE0) == 0xC0 ? 1
                      : (b & 0xF0) == 0xE0 ? 2
                      : (b & 0xF8) == 0xF0 ? 3
                                           : -1;
    if (extra < 0 || s.size() - i <= static_cast<std::size_t>(extra)) {
        return -1;
    }
    long c = extra == 0 ? b : static_cast<long>(b & (0x3F >> extra));
    for (int k = 1; k <= extra; ++k) {
        const auto cb = static_cast<unsigned char>(s[i + static_cast<std::size_t>(k)]);
        if ((cb & 0xC0) != 0x80) {
            return -1;
        }
        c = (c << 6) | (cb & 0x3F);
    }
    i += static_cast<std::size_t>(extra) + 1;
    return c;
}

void encode(long c, std::string& out) {
    if (c < 0x80) {
        out += static_cast<char>(c);
    } else if (c < 0x800) {
        out += static_cast<char>(0xC0 | (c >> 6));
        out += static_cast<char>(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
        out += static_cast<char>(0xE0 | (c >> 12));
        out += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (c & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (c >> 18));
        out += static_cast<char>(0x80 | ((c >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (c & 0x3F));
    }
}

// The characters EPUB 3.3 §6.1.5 does not allow in a file name.
bool forbidden(long c) {
    if (c < 0x20 || c == 0x7F || (c >= 0x80 && c <= 0x9F)) {
        return true;
    }
    switch (c) {
        case '"':
        case '*':
        case ':':
        case '<':
        case '>':
        case '?':
        case '\\':
        case '|':
            return true;
        default:
            break;
    }
    return (c >= 0xE000 && c <= 0xF8FF) || (c >= 0xFDD0 && c <= 0xFDEF) ||
           (c >= 0xFFF0 && c <= 0xFFFF) || (c >= 0xE0000 && c <= 0xE007F) || c >= 0xF0000;
}

}  // namespace

bool valid_name(std::string_view name) {
    if (name.empty() || name.size() > 65535 || name.front() == '/') {
        return false;
    }
    std::size_t start = 0;
    while (start <= name.size()) {
        std::size_t end = name.find('/', start);
        if (end == std::string_view::npos) {
            end = name.size();
        }
        const std::string_view segment = name.substr(start, end - start);
        if (segment.empty() || segment == "." || segment == ".." || segment.size() > 255 ||
            segment.back() == '.') {
            return false;
        }
        start = end + 1;
    }
    for (std::size_t i = 0; i < name.size();) {
        const long c = decode(name, i);
        if (c < 0 || forbidden(c)) {
            return false;
        }
    }
    return true;
}

std::string folded_name(std::string_view name) {
    std::string out;
    out.reserve(name.size());
    for (std::size_t i = 0; i < name.size();) {
        long c = decode(name, i);
        if (c < 0) {
            out += '?';
            continue;
        }
        if ((c >= 'A' && c <= 'Z') || (c >= 0xC0 && c <= 0xDE && c != 0xD7) ||
            (c >= 0x410 && c <= 0x42F)) {
            c += 0x20;
        } else if (c >= 0x400 && c <= 0x40F) {
            c += 0x50;
        }
        encode(c, out);
    }
    return out;
}

Writer::Writer(std::filesystem::path target) : target_(std::move(target)) {}

void Writer::add(const std::string& name, std::string bytes) {
    if (name == "mimetype" || !valid_name(name)) {
        throw std::invalid_argument("not a valid EPUB file name: " + name);
    }
    std::string folded = folded_name(name);
    if (std::find(folded_.begin(), folded_.end(), folded) != folded_.end()) {
        throw std::invalid_argument("a file of this name is already in the EPUB: " + name);
    }
    folded_.push_back(std::move(folded));
    files_.emplace_back(name, std::move(bytes));
}

std::uint64_t Writer::commit() {
    static const std::string kMimetype = "application/epub+zip";
    std::vector<archive::ZipEntry> entries;
    entries.reserve(files_.size() + 1);
    entries.push_back({"mimetype", kMimetype, true, true});
    for (const auto& [name, bytes] : files_) {
        // JPEG and PNG pictures are compressed already: stored as they are (feature 012, SC-010).
        const bool compressed = bytes.rfind("\xFF\xD8\xFF", 0) == 0 ||
                                bytes.rfind(std::string("\x89PNG\r\n\x1A\n", 8), 0) == 0;
        entries.push_back({name, bytes, compressed});
    }
    const std::string zip = archive::zip_entries(entries);
    atomic_file::write_atomic(target_, zip);
    return zip.size();
}

}  // namespace mfbe::epub
