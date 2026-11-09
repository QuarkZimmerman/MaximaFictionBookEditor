// Feature 011 (US5, US6; D21-D27; contracts/rpc-api.md `export.markdown`): writing a Markdown export.
// The interface writes the text, naming each picture; the core reads the pictures from the book's
// binary store - binaries never travel through JSON -, embeds them in the one-file form as JPEGs
// within kMaxEmbeddedPicture bytes or stores them byte for byte in the ZIP's images/ folder, and
// writes the file atomically.
#pragma once

#include <mfbe/binary_store.hpp>

#include <cstddef>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace mfbe::exporting {

// The largest picture the one-file form embeds (D21).
inline constexpr std::size_t kMaxEmbeddedPicture = 734003;

struct MarkdownPicture {
    std::string binary_id;
    std::string name;
};

struct MarkdownExport {
    std::filesystem::path path;
    bool zip = false;
    std::string text;
    std::vector<MarkdownPicture> pictures;
    int jpeg_quality = 90;
};

// Called before each picture and before the write: phase "pictures" (done, total) or "write";
// it may throw to cancel the export (nothing is written then).
using Progress = std::function<void(const std::string& phase, std::size_t done, std::size_t total)>;

// A picture as the one-file form embeds it: the stored bytes when they already are a JPEG within
// kMaxEmbeddedPicture bytes; else a JPEG at `quality` on white, its size reduced by steps of the
// square root of 2 until it fits. Throws images::DecodeError for a picture that cannot be read.
std::string embeddable_jpeg(std::string_view bytes, const std::string& content_type, int quality);

// The bytes of the export: the one file (the text, then a reference definition with a base64
// data URL per picture) or the ZIP (`<name>.md` and `images/<picture>`).
std::string markdown_export_bytes(const MarkdownExport& job, const BinaryStore& store,
                                  const Progress& progress);

// Writes markdown_export_bytes() to job.path atomically.
void write_markdown_export(const MarkdownExport& job, const BinaryStore& store,
                           const Progress& progress);

}  // namespace mfbe::exporting
