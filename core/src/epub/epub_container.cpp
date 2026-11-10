// EPUB container services: opening an EPUB for the import (feature 012, T010; D17, D29,
// contracts/rpc-api.md §1-§2, research DP-14, DP-15). The ZIP's listing and data come from the
// archive module (feature 009); the three small XML files read here (encryption.xml,
// container.xml, the package's root element) go through the hardened libxml2 parser.
#include "../xml/xml_security.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/epub.hpp>

#include <libxml/tree.h>

#include <algorithm>
#include <cctype>
#include <memory>
#include <system_error>

namespace mfbe::epub {
namespace fs = std::filesystem;

namespace {

// Font obfuscation, which D17 does not count as DRM (EPUB 3.3 §4.4; Adobe's older algorithm).
constexpr std::string_view kObfuscationIdpf = "http://www.idpf.org/2008/embedding";
constexpr std::string_view kObfuscationAdobe = "http://ns.adobe.com/pdf/enc#RC";
// The files of DRM schemes (research DP-14): Adobe ADEPT, Apple FairPlay, Readium LCP.
constexpr std::string_view kDrmFiles[] = {"META-INF/rights.xml", "META-INF/sinf.xml",
                                          "META-INF/license.lcpl"};

struct DocDeleter {
    void operator()(xmlDocPtr doc) const { xmlFreeDoc(doc); }
};
using Doc = std::unique_ptr<xmlDoc, DocDeleter>;

Doc parse(const std::string& bytes) {
    std::vector<xml::CollectedError> errors;
    return Doc(xml::parse_memory(bytes, nullptr, nullptr, errors));
}

std::string attribute(xmlNodePtr node, const char* name) {
    xmlChar* value = xmlGetProp(node, reinterpret_cast<const xmlChar*>(name));
    std::string out = value != nullptr ? reinterpret_cast<const char*>(value) : "";
    xmlFree(value);
    return out;
}

// Calls `f` for every element whose local name is `local`, in document order, any namespace.
template <class F>
void each_element(xmlNodePtr node, const char* local, F&& f) {
    for (xmlNodePtr n = node; n != nullptr; n = n->next) {
        if (n->type == XML_ELEMENT_NODE) {
            if (xmlStrcmp(n->name, reinterpret_cast<const xmlChar*>(local)) == 0) {
                f(n);
            }
            each_element(n->children, local, f);
        }
    }
}

// A name that reaches outside the container: absolute, with a drive letter or a backslash, or with
// a ".." segment (the hostile-file cases of D29).
bool leads_outside(const std::string& name) {
    if (name.empty() || name[0] == '/' || name.find('\\') != std::string::npos ||
        (name.size() >= 2 && name[1] == ':')) {
        return true;
    }
    std::size_t start = 0;
    while (start <= name.size()) {
        std::size_t end = name.find('/', start);
        if (end == std::string::npos) {
            end = name.size();
        }
        if (name.compare(start, end - start, "..") == 0 && end - start == 2) {
            return true;
        }
        start = end + 1;
    }
    return false;
}

const Entry* find_entry(const Source& source, const std::string& name) {
    const auto it = source.index.find(name);
    return it == source.index.end() ? nullptr : &source.entries[it->second];
}

std::string lower_ascii(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

}  // namespace

const char* refusal_name(Refusal reason) {
    switch (reason) {
        case Refusal::not_zip:
            return "epub.notZip";
        case Refusal::no_package:
            return "epub.noPackage";
        case Refusal::drm:
            return "epub.protected";
        case Refusal::too_large:
            return "epub.tooLarge";
        case Refusal::zip_bomb:
            return "epub.zipBomb";
        case Refusal::too_many_entries:
            return "epub.tooManyEntries";
        case Refusal::encrypted_zip:
            return "epub.encryptedZip";
    }
    return "epub.notZip";
}

const char* protection_name(Protection protection) {
    switch (protection) {
        case Protection::none:
            return "none";
        case Protection::font_obfuscation:
            return "fontObfuscation";
        case Protection::drm:
            return "drm";
    }
    return "none";
}

Source open(const fs::path& path, const Limits& limits) {
    std::error_code ec;
    const std::uintmax_t file_bytes = fs::file_size(path, ec);
    if (ec || archive::detect_kind(path) != archive::Kind::zip) {
        throw Refused(Refusal::not_zip, "the file is not a ZIP archive");
    }
    if (file_bytes > limits.max_file_bytes) {
        throw Refused(Refusal::too_large, "the file is larger than the import's limit");
    }
    archive::Listing listing;
    try {
        listing = archive::list(path);
    } catch (const archive::ArchiveError& e) {
        throw Refused(Refusal::not_zip, e.what());
    }
    if (listing.entries.size() > limits.max_entries) {
        throw Refused(Refusal::too_many_entries, "the archive holds too many entries");
    }

    Source source;
    source.path = path;
    std::uint64_t unpacked = 0;
    for (const archive::Entry& e : listing.entries) {
        if (e.directory) {
            continue;
        }
        if ((e.flags & 0x1) != 0) {
            throw Refused(Refusal::encrypted_zip, "a password-protected entry: " + e.name);
        }
        unpacked += e.size;
        if (e.size > limits.ratio_floor_bytes &&
            e.size / std::max<std::uint64_t>(e.compressed, 1) > limits.max_ratio) {
            throw Refused(Refusal::zip_bomb, "an entry unpacks beyond the ratio limit: " + e.name);
        }
        if (leads_outside(e.name)) {
            source.outside.push_back(e.name);
            continue;
        }
        source.index.emplace(e.name, source.entries.size());
        source.entries.push_back({e.name, e.size, e.compressed, e.method});
        source.records.push_back(e);
    }
    if (unpacked > limits.max_unpacked_bytes) {
        throw Refused(Refusal::zip_bomb, "the archive unpacks beyond the size limit");
    }
    source.mimetype_first = !listing.entries.empty() && listing.entries.front().name == "mimetype";

    for (const std::string_view drm_file : kDrmFiles) {
        if (find_entry(source, std::string(drm_file)) != nullptr) {
            throw Refused(Refusal::drm, "the book is protected by DRM");
        }
    }
    if (find_entry(source, "META-INF/encryption.xml") != nullptr) {
        const Doc doc = parse(read(source, "META-INF/encryption.xml", limits));
        bool obfuscation = false;
        bool other = doc == nullptr;  // an unreadable encryption.xml is not taken lightly
        if (doc) {
            each_element(xmlDocGetRootElement(doc.get()), "EncryptionMethod", [&](xmlNodePtr n) {
                const std::string algorithm = attribute(n, "Algorithm");
                if (algorithm == kObfuscationIdpf || algorithm == kObfuscationAdobe) {
                    obfuscation = true;
                } else {
                    other = true;
                }
            });
        }
        if (other) {
            throw Refused(Refusal::drm, "the book is protected by DRM");
        }
        if (obfuscation) {
            source.protection = Protection::font_obfuscation;
        }
    }

    if (find_entry(source, "META-INF/container.xml") == nullptr) {
        throw Refused(Refusal::no_package, "the archive has no META-INF/container.xml");
    }
    const Doc container = parse(read(source, "META-INF/container.xml", limits));
    std::string package_path;
    if (container) {
        each_element(xmlDocGetRootElement(container.get()), "rootfile", [&](xmlNodePtr n) {
            if (package_path.empty()) {
                package_path = attribute(n, "full-path");
            }
        });
    }
    if (package_path.empty() || find_entry(source, package_path) == nullptr) {
        throw Refused(Refusal::no_package, "the container names no package the archive holds");
    }
    source.package_path = package_path;
    if (const Doc package = parse(read(source, package_path, limits))) {
        if (xmlNodePtr root = xmlDocGetRootElement(package.get())) {
            source.version = attribute(root, "version");
        }
    }
    return source;
}

std::string read(const Source& source, const std::string& entry, const Limits& limits) {
    (void)limits;
    const auto it = source.index.find(entry);
    if (it == source.index.end()) {
        throw std::out_of_range("the EPUB offers no entry " + entry);
    }
    try {
        // Read at its own offset: an import reads every page, and a read by name walks the
        // archive each time (a 10,000-page book took minutes).
        return archive::read_entry_at(source.path, source.records[it->second]);
    } catch (const archive::ArchiveError& e) {
        if (e.reason == archive::Reason::too_large) {
            throw Refused(Refusal::zip_bomb, "an entry unpacks beyond its declared size: " + entry);
        }
        throw;
    }
}

bool is_epub(const fs::path& path) {
    try {
        if (archive::detect_kind(path) != archive::Kind::zip) {
            return false;
        }
        const archive::Listing listing = archive::list(path);
        if (!listing.entries.empty() && listing.entries.front().name == "mimetype" &&
            listing.entries.front().size < 64) {
            std::string bytes = archive::read_entry(path, "mimetype");
            while (!bytes.empty() && std::isspace(static_cast<unsigned char>(bytes.back()))) {
                bytes.pop_back();
            }
            if (bytes == "application/epub+zip") {
                return true;
            }
        }
        if (lower_ascii(path.extension().string()) == ".epub") {
            return std::any_of(
                listing.entries.begin(), listing.entries.end(),
                [](const archive::Entry& e) { return e.name == "META-INF/container.xml"; });
        }
    } catch (const std::exception&) {
        return false;
    }
    return false;
}

}  // namespace mfbe::epub
