#include "native_actions.h"

#include <mfbe/utf8_paths.hpp>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <system_error>

#if defined(_WIN32)
// clang-format off: windows.h first, the shell headers depend on it
#include <windows.h>

#include <shellapi.h>
#include <shlobj.h>
// clang-format on
#else
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

extern "C" char** environ;
#endif

#if defined(__linux__)
#include <dlfcn.h>
#endif

namespace mfbe::shell {

namespace {

bool hasAllowedScheme(const std::string& url) {
    return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0 ||
           url.rfind("mailto:", 0) == 0;
}

#if defined(_WIN32)
std::wstring toWide(const std::string& utf8) {
    if (utf8.empty()) {
        return {};
    }
    const int length =
        ::MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), nullptr, 0);
    if (length <= 0) {
        return {};
    }
    std::wstring wide(static_cast<size_t>(length), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), wide.data(),
                          length);
    return wide;
}

bool shellOpen(const std::wstring& target) {
    const auto result = reinterpret_cast<INT_PTR>(
        ::ShellExecuteW(nullptr, L"open", target.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
    return result > 32;
}
#else
// Runs `program argument` detached: /bin/sh backgrounds the launcher and exits at once, so
// the shell reaps only the short-lived sh and never blocks on the launched application.
bool spawnDetached(const char* program, const std::string& argument) {
    const char* script = "\"$0\" \"$1\" >/dev/null 2>&1 &";
    const char* argv[] = {"/bin/sh", "-c", script, program, argument.c_str(), nullptr};
    pid_t pid = 0;
    const int rc =
        ::posix_spawn(&pid, "/bin/sh", nullptr, nullptr, const_cast<char* const*>(argv), environ);
    if (rc != 0) {
        return false;
    }
    int status = 0;
    ::waitpid(pid, &status, 0);
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

const char* folderOpener() {
#if defined(__APPLE__)
    return "open";
#else
    return "xdg-open";
#endif
}
#endif

}  // namespace

bool openExternalUrl(const std::string& url) {
    if (!hasAllowedScheme(url)) {
        return false;
    }
#if defined(_WIN32)
    const std::wstring wide = toWide(url);
    return !wide.empty() && shellOpen(wide);
#else
    return spawnDetached(folderOpener(), url);
#endif
}

bool openFolderInFileManager(const std::string& path) {
    std::error_code ec;
    if (path.empty() || !std::filesystem::is_directory(mfbe::platform::path_from_utf8(path), ec)) {
        return false;
    }
#if defined(_WIN32)
    const std::wstring wide = toWide(path);
    return !wide.empty() && shellOpen(wide);
#else
    return spawnDetached(folderOpener(), path);
#endif
}

void notifyFileAssociationsChanged() {
#if defined(_WIN32)
    ::SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
#endif
}

bool isDocumentPath(const std::string& path) {
    std::string ext =
        mfbe::platform::utf8_from_path(mfbe::platform::path_from_utf8(path).extension());
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return ext == ".fb2" || ext == ".fbd" || ext == ".xml";
}

// --- clipboard ----------------------------------------------------------------------------

#if defined(_WIN32)

namespace {

std::string copyGlobal(HANDLE handle) {
    std::string bytes;
    const SIZE_T size = ::GlobalSize(handle);
    const void* data = ::GlobalLock(handle);
    if (data != nullptr && size > 0) {
        bytes.assign(static_cast<const char*>(data), size);
    }
    if (data != nullptr) {
        ::GlobalUnlock(handle);
    }
    return bytes;
}

// Wraps a packed DIB (BITMAPINFOHEADER/V4/V5 + optional masks/palette + pixels) into a
// .bmp file image that any BMP decoder accepts.
std::string dibToBmpFile(const std::string& dib) {
    if (dib.size() < sizeof(BITMAPINFOHEADER)) {
        return {};
    }
    BITMAPINFOHEADER header = {};
    std::memcpy(&header, dib.data(), sizeof(header));
    if (header.biSize < sizeof(BITMAPINFOHEADER) || header.biSize > dib.size()) {
        return {};
    }
    DWORD offset = header.biSize;
    if (header.biCompression == BI_BITFIELDS && header.biSize == sizeof(BITMAPINFOHEADER)) {
        offset += 3 * sizeof(DWORD);  // colour masks follow the classic header
    }
    DWORD colours = header.biClrUsed;
    if (colours == 0 && header.biBitCount <= 8) {
        colours = 1u << header.biBitCount;
    }
    offset += colours * sizeof(RGBQUAD);

    BITMAPFILEHEADER file = {};
    file.bfType = 0x4D42;  // "BM"
    file.bfSize = static_cast<DWORD>(sizeof(BITMAPFILEHEADER) + dib.size());
    file.bfOffBits = static_cast<DWORD>(sizeof(BITMAPFILEHEADER) + offset);

    std::string bmp(reinterpret_cast<const char*>(&file), sizeof(file));
    bmp += dib;
    return bmp;
}

}  // namespace

std::optional<ClipboardImageData> readClipboardImage() {
    if (!::OpenClipboard(nullptr)) {
        return std::nullopt;
    }
    struct Closer {
        ~Closer() { ::CloseClipboard(); }
    } closer;

    static const UINT png_format = ::RegisterClipboardFormatW(L"PNG");
    if (png_format != 0 && ::IsClipboardFormatAvailable(png_format)) {
        if (HANDLE handle = ::GetClipboardData(png_format)) {
            std::string bytes = copyGlobal(handle);
            if (!bytes.empty()) {
                return ClipboardImageData{std::move(bytes), "image/png"};
            }
        }
    }
    for (const UINT format : {static_cast<UINT>(CF_DIBV5), static_cast<UINT>(CF_DIB)}) {
        if (!::IsClipboardFormatAvailable(format)) {
            continue;
        }
        if (HANDLE handle = ::GetClipboardData(format)) {
            std::string bmp = dibToBmpFile(copyGlobal(handle));
            if (!bmp.empty()) {
                return ClipboardImageData{std::move(bmp), "image/bmp"};
            }
        }
    }
    return std::nullopt;
}

#elif defined(__linux__)

namespace {

// Minimal GTK 3 / GdkPixbuf surface resolved at run time. Types are opaque pointers; the
// signatures mirror the C headers (GdkAtom is pointer-sized, gboolean is int, gsize is
// size_t).
struct GtkApi {
    void* handle = nullptr;
    int (*gtk_init_check)(int*, char***) = nullptr;
    void* (*gdk_atom_intern)(const char*, int) = nullptr;
    void* (*gtk_clipboard_get)(void*) = nullptr;
    void* (*gtk_clipboard_wait_for_contents)(void*, void*) = nullptr;
    const unsigned char* (*gtk_selection_data_get_data_with_length)(void*, int*) = nullptr;
    void (*gtk_selection_data_free)(void*) = nullptr;
    void* (*gtk_clipboard_wait_for_image)(void*) = nullptr;
    int (*gdk_pixbuf_save_to_buffer)(void*, char**, size_t*, const char*, void**, ...) = nullptr;
    void (*g_object_unref)(void*) = nullptr;
    void (*g_free)(void*) = nullptr;
    void (*g_error_free)(void*) = nullptr;

    bool complete() const {
        return gtk_init_check && gdk_atom_intern && gtk_clipboard_get &&
               gtk_clipboard_wait_for_contents && gtk_selection_data_get_data_with_length &&
               gtk_selection_data_free && gtk_clipboard_wait_for_image &&
               gdk_pixbuf_save_to_buffer && g_object_unref && g_free && g_error_free;
    }
};

template <typename Fn>
void resolve(void* handle, const char* name, Fn* out) {
    *out = reinterpret_cast<Fn>(::dlsym(handle, name));
}

const GtkApi* gtkApi() {
    static GtkApi api;
    static bool attempted = false;
    if (attempted) {
        return api.complete() ? &api : nullptr;
    }
    attempted = true;
    // RTLD_NOLOAD first: only use a GTK that Chromium already loaded and initialised in this
    // process; otherwise load it (the display connection is opened by gtk_init_check).
    api.handle = ::dlopen("libgtk-3.so.0", RTLD_NOW | RTLD_NOLOAD);
    if (api.handle == nullptr) {
        api.handle = ::dlopen("libgtk-3.so.0", RTLD_NOW | RTLD_GLOBAL);
    }
    if (api.handle == nullptr) {
        return nullptr;
    }
    resolve(api.handle, "gtk_init_check", &api.gtk_init_check);
    resolve(api.handle, "gdk_atom_intern", &api.gdk_atom_intern);
    resolve(api.handle, "gtk_clipboard_get", &api.gtk_clipboard_get);
    resolve(api.handle, "gtk_clipboard_wait_for_contents", &api.gtk_clipboard_wait_for_contents);
    resolve(api.handle, "gtk_selection_data_get_data_with_length",
            &api.gtk_selection_data_get_data_with_length);
    resolve(api.handle, "gtk_selection_data_free", &api.gtk_selection_data_free);
    resolve(api.handle, "gtk_clipboard_wait_for_image", &api.gtk_clipboard_wait_for_image);
    resolve(api.handle, "gdk_pixbuf_save_to_buffer", &api.gdk_pixbuf_save_to_buffer);
    resolve(api.handle, "g_object_unref", &api.g_object_unref);
    resolve(api.handle, "g_free", &api.g_free);
    resolve(api.handle, "g_error_free", &api.g_error_free);
    if (!api.complete()) {
        return nullptr;
    }
    int argc = 0;
    if (!api.gtk_init_check(&argc, nullptr)) {
        return nullptr;  // no display
    }
    return &api;
}

// Raw bytes of one selection target ("image/png", "image/jpeg"), empty when absent.
std::string waitForTarget(const GtkApi& api, void* clipboard, const char* target) {
    void* data = api.gtk_clipboard_wait_for_contents(clipboard, api.gdk_atom_intern(target, 0));
    if (data == nullptr) {
        return {};
    }
    int length = 0;
    const unsigned char* bytes = api.gtk_selection_data_get_data_with_length(data, &length);
    std::string result;
    if (bytes != nullptr && length > 0) {
        result.assign(reinterpret_cast<const char*>(bytes), static_cast<size_t>(length));
    }
    api.gtk_selection_data_free(data);
    return result;
}

}  // namespace

std::optional<ClipboardImageData> readClipboardImage() {
    const GtkApi* api = gtkApi();
    if (api == nullptr) {
        return std::nullopt;
    }
    void* clipboard = api->gtk_clipboard_get(api->gdk_atom_intern("CLIPBOARD", 0));
    if (clipboard == nullptr) {
        return std::nullopt;
    }
    for (const char* target : {"image/png", "image/jpeg"}) {
        std::string bytes = waitForTarget(*api, clipboard, target);
        if (!bytes.empty()) {
            return ClipboardImageData{std::move(bytes), target};
        }
    }
    void* pixbuf = api->gtk_clipboard_wait_for_image(clipboard);
    if (pixbuf == nullptr) {
        return std::nullopt;
    }
    char* buffer = nullptr;
    size_t size = 0;
    void* error = nullptr;
    std::optional<ClipboardImageData> result;
    if (api->gdk_pixbuf_save_to_buffer(pixbuf, &buffer, &size, "png", &error, nullptr) &&
        buffer != nullptr && size > 0) {
        result = ClipboardImageData{std::string(buffer, size), "image/png"};
    }
    if (buffer != nullptr) {
        api->g_free(buffer);
    }
    if (error != nullptr) {
        api->g_error_free(error);
    }
    api->g_object_unref(pixbuf);
    return result;
}

#elif !defined(__APPLE__)

std::optional<ClipboardImageData> readClipboardImage() {
    return std::nullopt;
}

#endif  // platform clipboard (macOS: native_actions_mac.mm)

}  // namespace mfbe::shell
