// Scaled preview cache (T091) for GET /binary/{docId}/{id}/preview. See mfbe/images.hpp.
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>

#include <algorithm>
#include <new>

namespace mfbe::images {

PreviewCache::PreviewCache(std::size_t max_bytes) : max_bytes_(max_bytes) {}

std::optional<PreviewCache::Preview> PreviewCache::get(const std::string& key,
                                                       std::string_view source_bytes, int width,
                                                       int height, std::string* error) {
    if (width <= 0 && height <= 0) {
        width = kDefaultSize;
        height = kDefaultSize;
    }
    width = width <= 0 ? 0 : std::min(width, kMaxPreviewSize);
    height = height <= 0 ? 0 : std::min(height, kMaxPreviewSize);
    const std::string full_key = key + "#" + std::to_string(width) + "x" + std::to_string(height);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = index_.find(full_key);
        if (it != index_.end()) {
            lru_.splice(lru_.begin(), lru_, it->second);
            return it->second->preview;
        }
    }
    const Probe info = probe(source_bytes);
    if (!info.decodable) {
        if (error != nullptr) {
            *error = info.contentType.empty() ? "not a recognised image format"
                                              : "no decoder for " + info.contentType;
        }
        return std::nullopt;
    }
    Preview preview;
    const bool fits = info.width && info.height && (width <= 0 || *info.width <= width) &&
                      (height <= 0 || *info.height <= height);
    if (fits && is_jpeg_or_png(info.contentType)) {
        preview.bytes = std::string(source_bytes);
        preview.content_type = info.contentType;
        preview.width = *info.width;
        preview.height = *info.height;
        preview.original = true;
    } else {
        Bitmap bitmap;
        try {
            bitmap = decode_for_preview(source_bytes, width, height);
            const Bitmap scaled = scale_to_fit(bitmap, width, height);
            preview.width = scaled.width;
            preview.height = scaled.height;
            if (scaled.has_alpha) {
                preview.bytes = encode_png(scaled);
                preview.content_type = "image/png";
            } else {
                preview.bytes = encode_jpeg(scaled, kPreviewJpegQuality);
                preview.content_type = "image/jpeg";
            }
        } catch (const DecodeError& e) {
            if (error != nullptr) {
                *error = e.what();
            }
            return std::nullopt;
        } catch (const std::bad_alloc&) {
            if (error != nullptr) {
                *error = "tooLarge: out of memory";
            }
            return std::nullopt;
        }
    }
    insert(full_key, preview);
    return preview;
}

void PreviewCache::insert(const std::string& key, const Preview& preview) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (index_.count(key) > 0) {
        return;
    }
    if (preview.bytes.size() > max_bytes_) {
        return;  // never cache something bigger than the whole cache
    }
    lru_.push_front(Entry{key, preview});
    index_[key] = lru_.begin();
    bytes_ += preview.bytes.size();
    while (bytes_ > max_bytes_ && lru_.size() > 1) {
        bytes_ -= lru_.back().preview.bytes.size();
        index_.erase(lru_.back().key);
        lru_.pop_back();
    }
}

void PreviewCache::invalidate_prefix(const std::string& key_prefix) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto it = lru_.begin(); it != lru_.end();) {
        if (it->key.compare(0, key_prefix.size(), key_prefix) == 0) {
            bytes_ -= it->preview.bytes.size();
            index_.erase(it->key);
            it = lru_.erase(it);
        } else {
            ++it;
        }
    }
}

void PreviewCache::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    lru_.clear();
    index_.clear();
    bytes_ = 0;
}

std::size_t PreviewCache::size_bytes() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return bytes_;
}

std::size_t PreviewCache::entry_count() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return index_.size();
}

}  // namespace mfbe::images
