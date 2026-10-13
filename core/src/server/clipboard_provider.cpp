// Queued clipboard provider for tests (T092). See mfbe/clipboard_provider.hpp.
#include <mfbe/clipboard_provider.hpp>

namespace mfbe {

std::size_t QueuedClipboardProvider::enqueue(ClipboardImage image) {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.push_back(std::move(image));
    return queue_.size();
}

std::size_t QueuedClipboardProvider::pending() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.size();
}

void QueuedClipboardProvider::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.clear();
}

std::optional<ClipboardImage> QueuedClipboardProvider::read_image() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (queue_.empty()) {
        return std::nullopt;
    }
    ClipboardImage image = std::move(queue_.front());
    queue_.pop_front();
    return image;
}

}  // namespace mfbe
