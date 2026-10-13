// Compiled in mfbe_app_bridge (exceptions enabled); see clipboard_bridge.h.

#include "clipboard_bridge.h"

#include "include/base/cef_callback.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include "native_actions.h"

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <optional>
#include <utility>

#if __has_include(<mfbe/clipboard_provider.hpp>)
#include <mfbe/clipboard_provider.hpp>
#define MFBE_SHELL_HAS_CORE_CLIPBOARD 1
#endif

namespace mfbe::shell {

#if defined(MFBE_SHELL_HAS_CORE_CLIPBOARD)

namespace {

constexpr auto kClipboardTimeout = std::chrono::seconds(5);

// Shared between the waiting transport thread and the UI task; the task may outlive the
// wait (timeout), hence the shared_ptr.
struct ReadState {
    std::mutex mutex;
    std::condition_variable cv;
    bool done = false;
    std::optional<ClipboardImageData> image;
};

void readOnUiThread(std::shared_ptr<ReadState> state) {
    std::optional<ClipboardImageData> image = readClipboardImage();
    {
        std::lock_guard<std::mutex> lock(state->mutex);
        state->image = std::move(image);
        state->done = true;
    }
    state->cv.notify_all();
}

mfbe::ClipboardImage toCore(ClipboardImageData data) {
    mfbe::ClipboardImage image;
    image.bytes = std::move(data.bytes);
    image.contentType = std::move(data.content_type);
    return image;
}

class ShellClipboardProvider final : public mfbe::ClipboardProvider {
public:
    std::optional<mfbe::ClipboardImage> read_image() override {
#if defined(OS_LINUX)
        // GTK clipboard access belongs to the main thread (CEF UI thread on Linux).
        if (CefCurrentlyOn(TID_UI)) {
            return convert(readClipboardImage());
        }
        auto state = std::make_shared<ReadState>();
        if (!CefPostTask(TID_UI, base::BindOnce(&readOnUiThread, state))) {
            return std::nullopt;  // message loop not running
        }
        std::unique_lock<std::mutex> lock(state->mutex);
        if (!state->cv.wait_for(lock, kClipboardTimeout, [&] { return state->done; })) {
            return std::nullopt;  // UI thread busy: report "no image" rather than hang
        }
        return convert(std::move(state->image));
#else
        return convert(readClipboardImage());
#endif
    }

private:
    static std::optional<mfbe::ClipboardImage> convert(std::optional<ClipboardImageData> data) {
        if (!data || data->bytes.empty()) {
            return std::nullopt;
        }
        return toCore(std::move(*data));
    }
};

}  // namespace

std::shared_ptr<mfbe::ClipboardProvider> makeCoreClipboardProvider() {
    return std::make_shared<ShellClipboardProvider>();
}

bool readClipboardImageForTest(std::string* content_type, std::size_t* size) {
    ShellClipboardProvider provider;
    const std::optional<mfbe::ClipboardImage> image = provider.read_image();
    if (!image) {
        return false;
    }
    if (content_type != nullptr) {
        *content_type = image->contentType;
    }
    if (size != nullptr) {
        *size = image->bytes.size();
    }
    return true;
}

#else  // !MFBE_SHELL_HAS_CORE_CLIPBOARD

std::shared_ptr<mfbe::ClipboardProvider> makeCoreClipboardProvider() {
    return nullptr;
}

bool readClipboardImageForTest(std::string* /*content_type*/, std::size_t* /*size*/) {
    return false;
}

#endif  // MFBE_SHELL_HAS_CORE_CLIPBOARD

}  // namespace mfbe::shell
