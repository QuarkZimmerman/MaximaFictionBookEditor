// Automatic cover image extraction/generation for FBD ZIP Package mode (Feature 022).
#include "package/fbd_package_cover_extractor.hpp"

#include "mobi/mobi_reader.hpp"
#include "pdf/import/reader_process.hpp"
#include "xml/xml_security.hpp"

#include <mfbe/epub.hpp>
#include <mfbe/log.hpp>
#include <mfbe/utf8_paths.hpp>

#include <libxml/tree.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace mfbe::package {
namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kMaxCoverEntryBytes = 32ULL * 1024 * 1024;
constexpr std::uint64_t kMaxCoverXhtmlBytes = 2ULL * 1024 * 1024;
constexpr int kPdfCoverTargetWidthPx = 1024;

struct XmlDocDeleter {
    void operator()(xmlDocPtr doc) const { xmlFreeDoc(doc); }
};
using XmlDocPtr = std::unique_ptr<xmlDoc, XmlDocDeleter>;

XmlDocPtr parse_xml_safe(const std::string& bytes) {
    std::vector<xml::CollectedError> errors;
    return XmlDocPtr(xml::parse_memory(bytes, nullptr, nullptr, errors));
}

std::string lower_ascii(std::string_view text) {
    std::string out(text);
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

std::string xml_attr(xmlNodePtr node, const char* name) {
    xmlChar* value = xmlGetProp(node, reinterpret_cast<const xmlChar*>(name));
    std::string out = value != nullptr ? reinterpret_cast<const char*>(value) : "";
    xmlFree(value);
    return out;
}

std::string xml_attr_local(xmlNodePtr node, const char* local_name) {
    for (xmlAttrPtr attr = node->properties; attr != nullptr; attr = attr->next) {
        if (attr->name != nullptr &&
            xmlStrcmp(attr->name, reinterpret_cast<const xmlChar*>(local_name)) == 0) {
            xmlChar* val = xmlNodeListGetString(node->doc, attr->children, 1);
            std::string out = val != nullptr ? reinterpret_cast<const char*>(val) : "";
            xmlFree(val);
            return out;
        }
    }
    return {};
}

template <class F>
void each_xml_element(xmlNodePtr node, const char* local, F&& fn) {
    for (xmlNodePtr n = node; n != nullptr; n = n->next) {
        if (n->type == XML_ELEMENT_NODE) {
            if (xmlStrcmp(n->name, reinterpret_cast<const xmlChar*>(local)) == 0) {
                fn(n);
            }
            each_xml_element(n->children, local, fn);
        }
    }
}

bool has_whitespace_token(std::string_view list, std::string_view token) {
    std::size_t i = 0;
    while (i < list.size()) {
        while (i < list.size() && std::isspace(static_cast<unsigned char>(list[i])) != 0) {
            ++i;
        }
        const std::size_t start = i;
        while (i < list.size() && std::isspace(static_cast<unsigned char>(list[i])) == 0) {
            ++i;
        }
        if (i > start && list.substr(start, i - start) == token) {
            return true;
        }
    }
    return false;
}

bool is_raster_image_mime(std::string_view media_type) {
    const std::string lower = lower_ascii(media_type);
    return lower.rfind("image/", 0) == 0 && lower != "image/svg+xml";
}

bool is_xhtml_mime(std::string_view media_type) {
    const std::string lower = lower_ascii(media_type);
    return lower == "application/xhtml+xml" || lower == "text/html" || lower == "application/xml";
}

std::string percent_decode(std::string_view input) {
    auto hex_value = [](char c) -> int {
        if (c >= '0' && c <= '9')
            return c - '0';
        if (c >= 'a' && c <= 'f')
            return 10 + (c - 'a');
        if (c >= 'A' && c <= 'F')
            return 10 + (c - 'A');
        return -1;
    };
    std::string out;
    out.reserve(input.size());
    for (std::size_t i = 0; i < input.size(); ++i) {
        if (input[i] == '%' && i + 2 < input.size()) {
            const int hi = hex_value(input[i + 1]);
            const int lo = hex_value(input[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.push_back(static_cast<char>((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        out.push_back(input[i]);
    }
    return out;
}

// Resolves a relative href inside an EPUB ZIP against `base_entry` (e.g. "OEBPS/content.opf"),
// rejecting path traversal above the container root.
std::string resolve_epub_entry_path(std::string_view base_entry, std::string_view raw_href) {
    std::string_view trimmed = raw_href;
    if (const std::size_t hash = trimmed.find('#'); hash != std::string_view::npos) {
        trimmed = trimmed.substr(0, hash);
    }
    if (const std::size_t q = trimmed.find('?'); q != std::string_view::npos) {
        trimmed = trimmed.substr(0, q);
    }
    if (trimmed.empty()) {
        return {};
    }
    std::string decoded = percent_decode(trimmed);
    std::replace(decoded.begin(), decoded.end(), '\\', '/');

    std::string combined;
    if (!decoded.empty() && decoded[0] == '/') {
        combined = decoded.substr(1);
    } else {
        const std::size_t slash = base_entry.rfind('/');
        if (slash != std::string_view::npos) {
            combined.assign(base_entry.substr(0, slash + 1));
        }
        combined += decoded;
    }

    std::vector<std::string> parts;
    std::size_t pos = 0;
    while (pos <= combined.size()) {
        std::size_t next = combined.find('/', pos);
        if (next == std::string::npos) {
            next = combined.size();
        }
        const std::string seg = combined.substr(pos, next - pos);
        if (seg.empty() || seg == ".") {
            // Skip redundant separators and current-dir markers.
        } else if (seg == "..") {
            if (parts.empty()) {
                return {};
            }
            parts.pop_back();
        } else {
            parts.push_back(seg);
        }
        pos = next + 1;
    }

    std::string resolved;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) {
            resolved.push_back('/');
        }
        resolved += parts[i];
    }
    return resolved;
}

std::optional<std::string> find_epub_entry_name(const epub::Source& source,
                                                const std::string& candidate) {
    if (candidate.empty()) {
        return std::nullopt;
    }
    if (source.index.find(candidate) != source.index.end()) {
        return candidate;
    }
    const std::string lower_cand = lower_ascii(candidate);
    for (const epub::Entry& e : source.entries) {
        if (lower_ascii(e.name) == lower_cand) {
            return e.name;
        }
    }
    return std::nullopt;
}

std::optional<std::string> extract_image_href_from_cover_xhtml(const epub::Source& source,
                                                               const std::string& xhtml_entry) {
    const auto entry_it = source.index.find(xhtml_entry);
    if (entry_it == source.index.end()) {
        return std::nullopt;
    }
    if (source.entries[entry_it->second].size > kMaxCoverXhtmlBytes) {
        return std::nullopt;
    }
    const std::string xhtml_bytes = epub::read(source, xhtml_entry);
    const XmlDocPtr doc = parse_xml_safe(xhtml_bytes);
    if (!doc) {
        return std::nullopt;
    }
    xmlNodePtr root = xmlDocGetRootElement(doc.get());
    if (root == nullptr) {
        return std::nullopt;
    }
    std::string found_href;
    each_xml_element(root, "img", [&](xmlNodePtr node) {
        if (found_href.empty()) {
            const std::string src = xml_attr(node, "src");
            if (!src.empty()) {
                found_href = src;
            }
        }
    });
    if (found_href.empty()) {
        each_xml_element(root, "image", [&](xmlNodePtr node) {
            if (found_href.empty()) {
                std::string href = xml_attr_local(node, "href");
                if (href.empty()) {
                    href = xml_attr(node, "href");
                }
                if (!href.empty()) {
                    found_href = std::move(href);
                }
            }
        });
    }
    if (found_href.empty()) {
        return std::nullopt;
    }
    const std::string resolved = resolve_epub_entry_path(xhtml_entry, found_href);
    return find_epub_entry_name(source, resolved);
}

std::optional<std::string> extract_epub_cover_bytes(const fs::path& path) {
    try {
        const epub::Source source = epub::open(path);
        const std::string opf_bytes = epub::read(source, source.package_path);
        const XmlDocPtr doc = parse_xml_safe(opf_bytes);
        if (!doc) {
            return std::nullopt;
        }
        xmlNodePtr root = xmlDocGetRootElement(doc.get());
        if (root == nullptr) {
            return std::nullopt;
        }

        struct ManifestItem {
            std::string id;
            std::string href;
            std::string media_type;
            std::string properties;
        };
        std::vector<ManifestItem> items;
        std::map<std::string, std::size_t> by_id;

        each_xml_element(root, "manifest", [&](xmlNodePtr manifest) {
            each_xml_element(manifest->children, "item", [&](xmlNodePtr item) {
                ManifestItem mi;
                mi.id = xml_attr(item, "id");
                mi.href = xml_attr(item, "href");
                mi.media_type = xml_attr(item, "media-type");
                mi.properties = xml_attr(item, "properties");
                if (!mi.href.empty()) {
                    if (!mi.id.empty()) {
                        by_id.emplace(mi.id, items.size());
                    }
                    items.push_back(std::move(mi));
                }
            });
        });

        std::optional<std::string> cover_image_entry;
        std::optional<std::string> cover_xhtml_entry;

        // 1. EPUB 3: <item properties="... cover-image ..." media-type="image/...">
        for (const ManifestItem& mi : items) {
            if (has_whitespace_token(mi.properties, "cover-image") &&
                is_raster_image_mime(mi.media_type)) {
                cover_image_entry = find_epub_entry_name(
                    source, resolve_epub_entry_path(source.package_path, mi.href));
                if (cover_image_entry) {
                    break;
                }
            }
        }

        // 2. EPUB 2: <meta name="cover" content="<manifest-id or href>"/>
        if (!cover_image_entry) {
            std::string meta_cover_content;
            each_xml_element(root, "metadata", [&](xmlNodePtr metadata) {
                each_xml_element(metadata->children, "meta", [&](xmlNodePtr meta) {
                    if (!meta_cover_content.empty()) {
                        return;
                    }
                    if (lower_ascii(xml_attr(meta, "name")) == "cover") {
                        meta_cover_content = xml_attr(meta, "content");
                    }
                });
            });
            if (!meta_cover_content.empty()) {
                const auto id_it = by_id.find(meta_cover_content);
                if (id_it != by_id.end()) {
                    const ManifestItem& mi = items[id_it->second];
                    const auto resolved = find_epub_entry_name(
                        source, resolve_epub_entry_path(source.package_path, mi.href));
                    if (resolved) {
                        if (is_raster_image_mime(mi.media_type)) {
                            cover_image_entry = resolved;
                        } else if (is_xhtml_mime(mi.media_type)) {
                            cover_xhtml_entry = resolved;
                        }
                    }
                } else {
                    // Some legacy EPUBs store an href directly in <meta name="cover" content="...">.
                    const auto resolved = find_epub_entry_name(
                        source, resolve_epub_entry_path(source.package_path, meta_cover_content));
                    if (resolved) {
                        cover_image_entry = resolved;
                    }
                }
            }
        }

        // 3. Fallback: <guide><reference type="cover" href="..."/> or manifest id "cover"/"cover-image".
        if (!cover_image_entry && !cover_xhtml_entry) {
            each_xml_element(root, "guide", [&](xmlNodePtr guide) {
                each_xml_element(guide->children, "reference", [&](xmlNodePtr ref) {
                    if (cover_xhtml_entry || cover_image_entry) {
                        return;
                    }
                    if (lower_ascii(xml_attr(ref, "type")) == "cover") {
                        const std::string href = xml_attr(ref, "href");
                        if (!href.empty()) {
                            const auto resolved = find_epub_entry_name(
                                source, resolve_epub_entry_path(source.package_path, href));
                            if (resolved) {
                                cover_xhtml_entry = resolved;
                            }
                        }
                    }
                });
            });
        }
        if (!cover_image_entry && !cover_xhtml_entry) {
            for (const ManifestItem& mi : items) {
                const std::string lid = lower_ascii(mi.id);
                if (lid == "cover" || lid == "cover-image" || lid == "coverimage") {
                    const auto resolved = find_epub_entry_name(
                        source, resolve_epub_entry_path(source.package_path, mi.href));
                    if (resolved) {
                        if (is_raster_image_mime(mi.media_type)) {
                            cover_image_entry = resolved;
                            break;
                        }
                        if (is_xhtml_mime(mi.media_type)) {
                            cover_xhtml_entry = resolved;
                            break;
                        }
                    }
                }
            }
        }

        if (!cover_image_entry && cover_xhtml_entry) {
            cover_image_entry = extract_image_href_from_cover_xhtml(source, *cover_xhtml_entry);
        }

        if (!cover_image_entry) {
            return std::nullopt;
        }
        const auto idx_it = source.index.find(*cover_image_entry);
        if (idx_it == source.index.end()) {
            return std::nullopt;
        }
        const std::uint64_t entry_size = source.entries[idx_it->second].size;
        if (entry_size == 0 || entry_size > kMaxCoverEntryBytes) {
            return std::nullopt;
        }
        return epub::read(source, *cover_image_entry);
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

struct TempDirCleanup {
    fs::path dir;
    ~TempDirCleanup() {
        if (!dir.empty()) {
            std::error_code ec;
            fs::remove_all(dir, ec);
        }
    }
};

std::optional<std::string> generate_pdf_cover_bytes(const fs::path& pdf_path,
                                                    const FbdPackageCoverAutoOptions& options) {
    try {
        const fs::path reader_exe = pdf_import::find_reader();
        if (reader_exe.empty()) {
            return std::nullopt;
        }
        std::error_code ec;
        const fs::path tmp_root = fs::temp_directory_path(ec);
        if (ec || tmp_root.empty()) {
            return std::nullopt;
        }
        static std::atomic<std::uint64_t> counter{0};
        const auto now_ns = std::chrono::steady_clock::now().time_since_epoch().count();
        const std::string folder_name = "mfbe-pkg-cover-" + std::to_string(now_ns) + "-" +
                                        std::to_string(++counter);
        TempDirCleanup cleanup{tmp_root / platform::path_from_utf8(folder_name)};
        if (!fs::create_directories(cleanup.dir, ec) && ec) {
            return std::nullopt;
        }

        const fs::path out_file = cleanup.dir / platform::path_from_utf8("cover.jpg");
        pdf_import::ReaderOptions reader_opts;
        reader_opts.reader = reader_exe;
        reader_opts.pdf = pdf_path;
        reader_opts.folder = out_file;
        reader_opts.fonts = options.fonts_dir;
        reader_opts.quality = std::clamp(options.conversion_policy.jpeg_quality, 1, 100);
        reader_opts.max_memory_mb = 512;
        reader_opts.silence_timeout = std::chrono::seconds(15);
        reader_opts.extra_args = {"--render-cover", std::to_string(kPdfCoverTargetWidthPx)};

        std::string start_error;
        auto proc = pdf_import::ReaderProcess::start(reader_opts, start_error);
        if (!proc) {
            log::warning("package", "package.autoCover.pdfStartFailed",
                         "failed to start mfbe-pdf-reader for PDF cover generation",
                         log::extras({{"error", start_error}}));
            return std::nullopt;
        }

        bool rendered = false;
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(15);
        while (std::chrono::steady_clock::now() < deadline) {
            const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
                deadline - std::chrono::steady_clock::now());
            if (remaining.count() <= 0) {
                break;
            }
            std::string line;
            if (!proc->next_event(line, std::min(remaining, std::chrono::milliseconds(500)))) {
                if (proc->end() != pdf_import::ReaderEnd::running) {
                    break;
                }
                continue;
            }
            const auto ev = nlohmann::json::parse(line, nullptr, false);
            if (!ev.is_object()) {
                continue;
            }
            const std::string kind = ev.value("event", "");
            if (kind == "rendered") {
                rendered = true;
                break;
            }
            if (kind == "failed") {
                break;
            }
        }
        proc->kill();

        if (!rendered || !fs::is_regular_file(out_file, ec)) {
            return std::nullopt;
        }
        const std::uintmax_t sz = fs::file_size(out_file, ec);
        if (ec || sz == 0 || sz > kMaxCoverEntryBytes) {
            return std::nullopt;
        }
        std::ifstream in(out_file, std::ios::binary);
        if (!in) {
            return std::nullopt;
        }
        std::string bytes(static_cast<std::size_t>(sz), '\0');
        if (!in.read(bytes.data(), static_cast<std::streamsize>(sz))) {
            return std::nullopt;
        }
        return bytes;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::optional<FbdPackageExtractedCover> normalize_cover_bytes(
    std::string_view raw_bytes, const images::ConversionPolicy& policy) {
    if (raw_bytes.empty()) {
        return std::nullopt;
    }
    const auto converted = images::convert(raw_bytes, policy);
    if (!converted || converted->bytes.empty()) {
        return std::nullopt;
    }
    if (converted->content_type != "image/jpeg" && converted->content_type != "image/png") {
        return std::nullopt;
    }
    FbdPackageExtractedCover out;
    out.bytes = converted->bytes;
    out.content_type = converted->content_type;
    out.binary_id = (out.content_type == "image/png") ? "cover.png" : "cover.jpg";
    return out;
}

}  // namespace

std::optional<FbdPackageExtractedCover> extract_package_entry_cover(
    const fs::path& path, std::string_view lower_extension,
    const FbdPackageCoverAutoOptions& options) {
    const std::string ext = lower_ascii(lower_extension);
    std::optional<std::string> raw_bytes;
    if (ext == "pdf") {
        if (!options.auto_cover_pdf) {
            return std::nullopt;
        }
        raw_bytes = generate_pdf_cover_bytes(path, options);
    } else if (ext == "epub") {
        if (!options.auto_cover_epub) {
            return std::nullopt;
        }
        raw_bytes = extract_epub_cover_bytes(path);
    } else if (ext == "mobi" || ext == "azw" || ext == "azw3" || ext == "prc") {
        if (!options.auto_cover_mobi) {
            return std::nullopt;
        }
        raw_bytes = mobi::extract_cover_bytes(path);
    } else {
        return std::nullopt;
    }

    if (!raw_bytes) {
        return std::nullopt;
    }
    return normalize_cover_bytes(*raw_bytes, options.conversion_policy);
}

}  // namespace mfbe::package
