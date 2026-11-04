// What a file is, by its leading bytes (feature 009, research DP-1, D6, FR-020). See
// mfbe/archive.hpp.
#include <mfbe/archive.hpp>

#include <fstream>
#include <string>
#include <string_view>
#include <system_error>

namespace mfbe::archive {
namespace {

using namespace std::string_view_literals;

bool has(const std::string& head, std::string_view signature, std::size_t at = 0) {
    return head.size() >= at + signature.size() &&
           head.compare(at, signature.size(), signature) == 0;
}

}  // namespace

Kind detect_kind(const std::filesystem::path& path) {
    std::error_code ec;
    const auto status = std::filesystem::status(path, ec);
    if (ec || !std::filesystem::exists(status)) {
        return Kind::missing;
    }
    if (std::filesystem::is_directory(status)) {
        return Kind::folder;
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return Kind::file;  // unreadable: the open that follows reports why
    }
    std::string head(512, '\0');
    in.read(head.data(), static_cast<std::streamsize>(head.size()));
    head.resize(static_cast<std::size_t>(in.gcount()));
    // A ZIP starts with a local header, or is empty (an end-of-central-directory record only),
    // or is a spanned archive's first part (the "PK\7\8" marker, refused later as multi-volume).
    if (has(head, "PK\x03\x04"sv) || has(head, "PK\x05\x06"sv) || has(head, "PK\x07\x08"sv)) {
        return Kind::zip;
    }
    if (has(head, "Rar!\x1a\x07"sv)) {
        return Kind::rar;
    }
    if (has(head, "7z\xbc\xaf\x27\x1c"sv)) {
        return Kind::sevenz;
    }
    if (has(head, "\x1f\x8b"sv)) {
        return Kind::gzip;
    }
    if (has(head, "BZh"sv)) {
        return Kind::bzip2;
    }
    if (has(head,
            "\xfd"
            "7zXZ\x00"sv)) {
        return Kind::xz;
    }
    if (has(head, "\x28\xb5\x2f\xfd"sv)) {
        return Kind::zstd;
    }
    if (has(head, "MSCF"sv)) {
        return Kind::cab;
    }
    if (has(head, "ustar"sv, 257)) {
        return Kind::tar;
    }
    return Kind::file;
}

const char* kind_name(Kind kind) {
    switch (kind) {
        case Kind::missing:
            return "missing";
        case Kind::folder:
            return "folder";
        case Kind::file:
            return "file";
        case Kind::zip:
            return "zip";
        case Kind::rar:
            return "rar";
        case Kind::sevenz:
            return "7z";
        case Kind::gzip:
            return "gzip";
        case Kind::bzip2:
            return "bzip2";
        case Kind::xz:
            return "xz";
        case Kind::zstd:
            return "zstd";
        case Kind::cab:
            return "cab";
        case Kind::tar:
            return "tar";
    }
    return "file";
}

bool is_other_archive(Kind kind) {
    switch (kind) {
        case Kind::rar:
        case Kind::sevenz:
        case Kind::gzip:
        case Kind::bzip2:
        case Kind::xz:
        case Kind::zstd:
        case Kind::cab:
        case Kind::tar:
            return true;
        default:
            return false;
    }
}

const char* reason_name(Reason reason) {
    switch (reason) {
        case Reason::encrypted:
            return "encrypted";
        case Reason::method:
            return "method";
        case Reason::damaged:
            return "damaged";
        case Reason::too_large:
            return "tooLarge";
        case Reason::multi_volume:
            return "multiVolume";
        case Reason::missing:
            return "missing";
    }
    return "damaged";
}

}  // namespace mfbe::archive
