// Conversion policy, scaling and BinaryStore conversion (T091). See mfbe/images.hpp.
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>
#include <mfbe/log.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>

namespace mfbe::images {

const char* to_string(Format format) {
    return format == Format::png ? "png" : "jpeg";
}

const char* mime_type(Format format) {
    return format == Format::png ? "image/png" : "image/jpeg";
}

std::optional<Format> format_from_string(std::string_view text) {
    std::string t(text);
    std::transform(t.begin(), t.end(), t.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (t == "jpeg" || t == "jpg") {
        return Format::jpeg;
    }
    if (t == "png") {
        return Format::png;
    }
    return std::nullopt;
}

std::optional<Format> format_from_mime(std::string_view mime) {
    std::string t(mime);
    std::transform(t.begin(), t.end(), t.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (t == "image/jpeg" || t == "image/jpg" || t == "image/pjpeg") {
        return Format::jpeg;
    }
    if (t == "image/png") {
        return Format::png;
    }
    return std::nullopt;
}

std::optional<Conversion> convert(std::string_view bytes, const ConversionPolicy& policy,
                                  std::string* error, bool force) {
    const Probe probe_result = probe(bytes);
    if (!probe_result.decodable) {
        if (error != nullptr) {
            *error = probe_result.contentType.empty() ? "unsupported: not a recognised image"
                                                      : "unsupported: " + probe_result.contentType;
        }
        return std::nullopt;
    }
    Conversion result;
    result.from_type = probe_result.contentType;
    if (!force && is_jpeg_or_png(probe_result.contentType)) {
        result.bytes = std::string(bytes);
        result.content_type = probe_result.contentType;
        result.width = probe_result.width.value_or(0);
        result.height = probe_result.height.value_or(0);
        result.changed = false;
        return result;
    }
    std::optional<Bitmap> bitmap = try_decode(bytes, error);
    if (!bitmap) {
        return std::nullopt;
    }
    Format target = policy.preferred;
    if (policy.png_when_alpha && bitmap->has_alpha) {
        target = Format::png;
    }
    if (force && is_jpeg_or_png(probe_result.contentType) &&
        format_from_mime(probe_result.contentType) == target) {
        // Already in the requested format: never re-encode JPEG/PNG bytes.
        result.bytes = std::string(bytes);
        result.content_type = probe_result.contentType;
        result.width = bitmap->width;
        result.height = bitmap->height;
        result.changed = false;
        return result;
    }
    try {
        result.bytes =
            target == Format::png ? encode_png(*bitmap) : encode_jpeg(*bitmap, policy.jpeg_quality);
    } catch (const DecodeError& e) {
        if (error != nullptr) {
            *error = e.what();
        }
        return std::nullopt;
    }
    result.content_type = mime_type(target);
    result.width = bitmap->width;
    result.height = bitmap->height;
    result.changed = true;
    return result;
}

/* ----------------------------------------------------------------------------------------- */
/* Scaling                                                                                    */
/* ----------------------------------------------------------------------------------------- */

namespace {

// Separable area-averaging resampler (exact box filter with fractional coverage), one axis.
// `in` has `count` pixels of 4 channels with `in_stride` bytes between consecutive pixels;
// the output has `out_count` pixels written with `out_stride`.
void resample_axis(const std::uint8_t* in, std::size_t count, std::size_t in_stride,
                   std::uint8_t* out, std::size_t out_count, std::size_t out_stride) {
    const double scale = static_cast<double>(count) / static_cast<double>(out_count);
    for (std::size_t o = 0; o < out_count; ++o) {
        const double start = static_cast<double>(o) * scale;
        const double end = std::min(start + scale, static_cast<double>(count));
        double acc[4] = {0, 0, 0, 0};
        double weight_sum = 0;
        std::size_t first = static_cast<std::size_t>(std::floor(start));
        std::size_t last = static_cast<std::size_t>(std::ceil(end));
        last = std::min(last, count);
        for (std::size_t i = first; i < last; ++i) {
            const double lo = std::max(start, static_cast<double>(i));
            const double hi = std::min(end, static_cast<double>(i + 1));
            const double w = hi - lo;
            if (w <= 0) {
                continue;
            }
            const std::uint8_t* p = in + i * in_stride;
            // Alpha-weighted colour so transparent pixels do not darken edges.
            const double a = p[3] / 255.0;
            acc[0] += p[0] * a * w;
            acc[1] += p[1] * a * w;
            acc[2] += p[2] * a * w;
            acc[3] += a * w;
            weight_sum += w;
        }
        std::uint8_t* q = out + o * out_stride;
        if (weight_sum <= 0) {
            q[0] = q[1] = q[2] = q[3] = 0;
            continue;
        }
        const double alpha = acc[3] / weight_sum;  // 0..1
        if (alpha <= 0) {
            q[0] = q[1] = q[2] = q[3] = 0;
            continue;
        }
        for (int c = 0; c < 3; ++c) {
            const double v = acc[c] / acc[3];  // un-premultiply
            q[c] = static_cast<std::uint8_t>(std::clamp(std::lround(v), 0L, 255L));
        }
        q[3] = static_cast<std::uint8_t>(std::clamp(std::lround(alpha * 255.0), 0L, 255L));
    }
}

}  // namespace

Bitmap scale_to_fit(const Bitmap& source, int max_width, int max_height) {
    if (source.width <= 0 || source.height <= 0) {
        return source;
    }
    double factor = 1.0;
    if (max_width > 0) {
        factor = std::min(factor, static_cast<double>(max_width) / source.width);
    }
    if (max_height > 0) {
        factor = std::min(factor, static_cast<double>(max_height) / source.height);
    }
    if (factor >= 1.0) {
        return source;
    }
    const int out_w = std::max(1, static_cast<int>(std::lround(source.width * factor)));
    const int out_h = std::max(1, static_cast<int>(std::lround(source.height * factor)));
    const auto sw = static_cast<std::size_t>(source.width);
    const auto sh = static_cast<std::size_t>(source.height);
    const auto ow = static_cast<std::size_t>(out_w);
    const auto oh = static_cast<std::size_t>(out_h);
    // Horizontal pass: sw x sh -> ow x sh.
    std::vector<std::uint8_t> tmp(ow * sh * 4);
    for (std::size_t y = 0; y < sh; ++y) {
        resample_axis(source.rgba.data() + y * sw * 4, sw, 4, tmp.data() + y * ow * 4, ow, 4);
    }
    // Vertical pass: ow x sh -> ow x oh (pixels of one column are ow*4 bytes apart).
    Bitmap out;
    out.width = out_w;
    out.height = out_h;
    out.source_type = source.source_type;
    out.rgba.resize(ow * oh * 4);
    for (std::size_t x = 0; x < ow; ++x) {
        resample_axis(tmp.data() + x * 4, sh, ow * 4, out.rgba.data() + x * 4, oh, ow * 4);
    }
    out.update_alpha_flag();
    return out;
}

/* ----------------------------------------------------------------------------------------- */
/* BinaryStore conversion                                                                     */
/* ----------------------------------------------------------------------------------------- */

ConvertStoreResult convert_store(BinaryStore& store, const ConversionPolicy& policy,
                                 const std::function<void(std::size_t, std::size_t)>& progress) {
    ConvertStoreResult result;
    std::vector<std::string> candidates;
    for (const model::BinaryMeta& meta : store.list()) {
        if (meta.decodable && meta.willConvert && !store.is_raw_text(meta.id)) {
            candidates.push_back(meta.id);
        }
    }
    std::size_t done = 0;
    for (const std::string& id : candidates) {
        const auto bytes = store.bytes(id);
        const auto before = store.meta(id);
        if (!bytes || !before) {
            continue;
        }
        std::string error;
        const std::optional<Conversion> converted = convert(*bytes, policy, &error);
        if (!converted) {
            // Not decodable after all: keep the bytes, report, never convert (FR-111).
            model::BinaryMeta meta = *before;
            meta.decodable = false;
            meta.willConvert = false;
            store.update_meta(meta);
            result.failed.push_back(id);
            log::warning("core", "image.convertFailed", "binary image could not be decoded",
                         log::extras({{"id", id}, {"reason", error}}));
        } else if (converted->changed) {
            Converted entry;
            entry.id = id;
            entry.from = before->contentType;
            entry.to = converted->content_type;
            entry.meta = store.put(id, converted->content_type, converted->bytes);
            result.converted.push_back(std::move(entry));
        }
        ++done;
        if (progress) {
            progress(done, candidates.size());
        }
    }
    return result;
}

}  // namespace mfbe::images
