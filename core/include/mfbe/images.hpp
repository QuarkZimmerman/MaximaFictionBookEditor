// Image codecs, conversion policy and previews (T091, FR-110/FR-111, research D8).
//
//   decode()        JPEG (libjpeg-turbo), PNG (libpng), GIF first frame (giflib), BMP
//                   (stb_image), WebP (libwebp), TIFF (libtiff) -> RGBA8 bitmap. Images above
//                   kMaxPixels (100 MP) are refused with DecodeError{"tooLarge"} before any
//                   pixel memory is allocated; corrupt data -> DecodeError{"corrupt"}.
//   encode_jpeg()   baseline JPEG at a quality 1..100 (alpha composited over white),
//   encode_png()    PNG, RGBA when the bitmap has transparent pixels, RGB otherwise.
//   convert()       the save/paste policy: JPEG/PNG inputs are returned byte-for-byte
//                   (never re-encoded) unless `force`; everything else is decoded and encoded
//                   as `policy.preferred` (settings other.pasteImageFormat / jpegQuality),
//                   PNG whenever the decoded image has a transparent pixel.
//   convert_store() converts every `willConvert` object of a BinaryStore in place (same id,
//                   new bytes + content type) - used by doc.save, roundtrip and the CLI.
//   scale_to_fit()  area-averaging (box) downscale; never upscales.
//   PreviewCache    scaled JPEG/PNG previews for GET /binary/{docId}/{id}/preview?w=&h=,
//                   keyed by (key, size), LRU-bounded by a memory cap.
#pragma once

#include <mfbe/binary_store.hpp>

#include <cstdint>
#include <functional>
#include <list>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace mfbe::images {

inline constexpr std::int64_t kMaxPixels = 100LL * 1000 * 1000;  // 100 megapixels
inline constexpr int kMaxDimension = 65535;

struct Bitmap {
    int width = 0;
    int height = 0;
    std::vector<std::uint8_t> rgba;  // width * height * 4, row-major, non-premultiplied
    bool has_alpha = false;          // at least one pixel with alpha < 255
    std::string source_type;         // sniffed MIME type of the decoded input

    std::size_t pixel_count() const {
        return static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    }
    // Recomputes `has_alpha` from the pixels.
    void update_alpha_flag();
};

struct DecodeError : std::runtime_error {
    DecodeError(std::string code_, std::string detail_)
        : std::runtime_error(code_ + ": " + detail_),
          code(std::move(code_)),
          detail(std::move(detail_)) {}
    std::string code;  // "unsupported" | "tooLarge" | "corrupt"
    std::string detail;
};

// Full decode (throws DecodeError).
Bitmap decode(std::string_view bytes);
// Decode producing an image no smaller than max(min_width, min_height) on each axis when the
// codec can downscale cheaply (JPEG DCT scaling); otherwise identical to decode().
Bitmap decode_for_preview(std::string_view bytes, int min_width, int min_height);
std::optional<Bitmap> try_decode(std::string_view bytes, std::string* error = nullptr);

std::string encode_jpeg(const Bitmap& bitmap, int quality);
std::string encode_png(const Bitmap& bitmap);

enum class Format { jpeg, png };
const char* to_string(Format format);                             // "jpeg" | "png"
const char* mime_type(Format format);                             // "image/jpeg" | "image/png"
std::optional<Format> format_from_string(std::string_view text);  // "jpeg"/"jpg"/"png"
std::optional<Format> format_from_mime(std::string_view mime);

struct ConversionPolicy {
    Format preferred = Format::jpeg;  // settings other.pasteImageFormat
    int jpeg_quality = 90;            // settings other.jpegQuality (1..100)
    bool png_when_alpha = true;       // transparent pixels force PNG
};

struct Conversion {
    std::string bytes;
    std::string content_type;  // "image/jpeg" | "image/png"
    std::string from_type;     // sniffed type of the input
    int width = 0;
    int height = 0;
    bool changed = false;  // false when the input was returned as is (JPEG/PNG pass-through)
};

// Applies the policy to `bytes`. Returns nullopt (with `error`) when the data is not a
// decodable image. `force` re-encodes JPEG/PNG inputs too (binary.convert).
std::optional<Conversion> convert(std::string_view bytes, const ConversionPolicy& policy,
                                  std::string* error = nullptr, bool force = false);

// Downscales so that width <= max_width and height <= max_height (aspect ratio kept); a
// non-positive limit means "unbounded". Returns a copy when no scaling is needed.
Bitmap scale_to_fit(const Bitmap& source, int max_width, int max_height);

struct Converted {
    std::string id;
    std::string from;  // content type before
    std::string to;    // content type after
    model::BinaryMeta meta;
};

struct ConvertStoreResult {
    std::vector<Converted> converted;
    std::vector<std::string> failed;  // ids whose decode failed (now marked decodable=false)
};

// Converts the `willConvert` objects (decodable, not JPEG/PNG, not raw text). `progress`
// (done, total) is called per object when given.
ConvertStoreResult convert_store(
    BinaryStore& store, const ConversionPolicy& policy,
    const std::function<void(std::size_t, std::size_t)>& progress = {});

class PreviewCache {
public:
    static constexpr std::size_t kDefaultMaxBytes = 64ULL * 1024 * 1024;
    static constexpr int kDefaultSize = 512;
    static constexpr int kMaxPreviewSize = 4096;
    static constexpr int kPreviewJpegQuality = 85;

    struct Preview {
        std::string bytes;
        std::string content_type;
        int width = 0;
        int height = 0;
        bool original = false;  // the source bytes were served unchanged
    };

    explicit PreviewCache(std::size_t max_bytes = kDefaultMaxBytes);

    // A preview fitting `width` x `height` (<= 0 -> kDefaultSize for both; clamped to
    // kMaxPreviewSize). `key` identifies the content (docId/id plus the ETag, so a changed
    // binary never hits a stale entry). JPEG/PNG sources that already fit are returned
    // unchanged; undecodable data -> nullopt with `error`.
    std::optional<Preview> get(const std::string& key, std::string_view source_bytes, int width,
                               int height, std::string* error = nullptr);
    void invalidate_prefix(const std::string& key_prefix);
    void clear();
    std::size_t size_bytes() const;
    std::size_t entry_count() const;

private:
    struct Entry {
        std::string key;
        Preview preview;
    };
    void insert(const std::string& key, const Preview& preview);

    mutable std::mutex mutex_;
    std::size_t max_bytes_;
    std::size_t bytes_ = 0;
    std::list<Entry> lru_;  // front = most recent
    std::unordered_map<std::string, std::list<Entry>::iterator> index_;
};

}  // namespace mfbe::images
