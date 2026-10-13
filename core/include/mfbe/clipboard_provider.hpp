// Clipboard image provider (T092) - `binary.addFromClipboard` is shell-delegated: the CEF
// shell reads the OS clipboard image and hands the encoded bytes to the core, which stores
// them as a binary object (applying the paste-format policy). Headless runs have no provider
// (RPC error 1050 `dialog.unavailable`); tests attach a QueuedClipboardProvider fed through
// `test.enqueueClipboardImage`.
#pragma once

#include <deque>
#include <mutex>
#include <optional>
#include <string>

namespace mfbe {

struct ClipboardImage {
    std::string bytes;        // encoded image (PNG/BMP/JPEG ... as the OS provides it)
    std::string contentType;  // MIME type when known ("" = sniff)
};

class ClipboardProvider {
public:
    virtual ~ClipboardProvider() = default;
    // The image on the OS clipboard, or nullopt when there is none. Called on the core's
    // transport thread; must return promptly.
    virtual std::optional<ClipboardImage> read_image() = 0;
};

// FIFO of pre-recorded clipboard images for tests (thread-safe).
class QueuedClipboardProvider : public ClipboardProvider {
public:
    std::size_t enqueue(ClipboardImage image);
    std::size_t pending() const;
    void clear();
    std::optional<ClipboardImage> read_image() override;

private:
    mutable std::mutex mutex_;
    std::deque<ClipboardImage> queue_;
};

}  // namespace mfbe
