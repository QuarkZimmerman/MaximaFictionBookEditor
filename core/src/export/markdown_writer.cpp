// Feature 011 (US5, US6): writing a Markdown export. See markdown_writer.hpp.
#include "export/markdown_writer.hpp"

#include <mfbe/archive.hpp>
#include <mfbe/atomic_file.hpp>
#include <mfbe/base64.hpp>
#include <mfbe/images.hpp>
#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <stdexcept>

namespace mfbe::exporting {
namespace {

// Composites the pixels over white (a JPEG has no transparency, D21).
void flatten_on_white(images::Bitmap& bitmap) {
    if (!bitmap.has_alpha) {
        return;
    }
    for (std::size_t i = 0; i < bitmap.pixel_count(); ++i) {
        std::uint8_t* px = bitmap.rgba.data() + i * 4;
        const unsigned alpha = px[3];
        for (int c = 0; c < 3; ++c) {
            px[c] = static_cast<std::uint8_t>((px[c] * alpha + 255u * (255u - alpha) + 127u) / 255u);
        }
        px[3] = 255;
    }
    bitmap.has_alpha = false;
}

std::string stem_md_name(const std::filesystem::path& path) {
    // "book.md.zip" -> "book.md"; any other name -> its own with ".md" (D23).
    std::string name = platform::utf8_from_path(path.filename());
    if (name.empty()) {
        name = "book";
    }
    std::string lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lower.size() > 4 && lower.ends_with(".zip")) {
        name.erase(name.size() - 4);
        lower.erase(lower.size() - 4);
    }
    if (!lower.ends_with(".md")) {
        name += ".md";
    }
    return name;
}

}  // namespace

std::string embeddable_jpeg(std::string_view bytes, const std::string& content_type,
                            int quality) {
    const bool jpeg = content_type == "image/jpeg" || content_type == "image/jpg";
    if (jpeg && bytes.size() <= kMaxEmbeddedPicture) {
        return std::string(bytes);
    }
    // A very large picture is decoded at a reduced size where the codec can (JPEG DCT scaling,
    // never below 4096 pixels on either side), so that a 100-megapixel picture never needs its
    // full bitmap (SC-011); smaller pictures decode as they are.
    images::Bitmap bitmap = images::decode_for_preview(bytes, 4096, 4096);
    flatten_on_white(bitmap);
    std::string out = images::encode_jpeg(bitmap, quality);
    double scale = 1.0;
    while (out.size() > kMaxEmbeddedPicture) {
        scale /= std::sqrt(2.0);
        const int width = std::max(1, static_cast<int>(bitmap.width * scale));
        const int height = std::max(1, static_cast<int>(bitmap.height * scale));
        if (width <= 1 && height <= 1) {
            break;  // a single pixel is as small as a picture gets
        }
        out = images::encode_jpeg(images::scale_to_fit(bitmap, width, height), quality);
    }
    return out;
}

std::string markdown_export_bytes(const MarkdownExport& job, const BinaryStore& store,
                                  const Progress& progress, std::vector<std::string>* skipped) {
    const std::size_t total = job.pictures.size();
    if (!job.zip) {
        std::string out = job.text;
        if (!out.empty() && out.back() != '\n') {
            out += '\n';
        }
        if (total > 0) {
            out += '\n';
        }
        for (std::size_t i = 0; i < total; ++i) {
            progress("pictures", i, total);
            const MarkdownPicture& picture = job.pictures[i];
            const auto meta = store.meta(picture.binary_id);
            const auto bytes = store.bytes(picture.binary_id);
            if (!meta || !bytes) {
                continue;
            }
            std::string jpeg;
            try {
                jpeg = embeddable_jpeg(*bytes, meta->contentType, job.jpeg_quality);
            } catch (const images::DecodeError&) {
                if (skipped != nullptr) {
                    skipped->push_back(picture.name);
                }
                continue;
            }
            out += "[" + picture.name + "]: data:image/jpeg;base64," + base64::encode(jpeg) + "\n";
        }
        progress("write", total, total);
        return out;
    }
    // The ZIP: the text, then the pictures byte for byte in images/ (D23).
    std::vector<std::string> kept;
    kept.reserve(total);
    std::vector<archive::ZipEntry> entries;
    entries.push_back({stem_md_name(job.path), job.text});
    std::vector<std::string> names;
    for (std::size_t i = 0; i < total; ++i) {
        progress("pictures", i, total);
        const MarkdownPicture& picture = job.pictures[i];
        if (auto bytes = store.bytes(picture.binary_id)) {
            kept.push_back(std::move(*bytes));
            names.push_back("images/" + picture.name);
        }
    }
    for (std::size_t i = 0; i < kept.size(); ++i) {
        entries.push_back({names[i], kept[i]});
    }
    progress("write", total, total);
    return archive::zip_entries(entries);
}

std::vector<std::string> write_markdown_export(const MarkdownExport& job,
                                               const BinaryStore& store,
                                               const Progress& progress) {
    std::vector<std::string> skipped;
    const std::string bytes = markdown_export_bytes(job, store, progress, &skipped);
    atomic_file::write_atomic(job.path, bytes);
    return skipped;
}

}  // namespace mfbe::exporting
