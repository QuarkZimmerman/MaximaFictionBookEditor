// UTF-8 text <-> filesystem path conversions independent of the process code page (feature 002,
// research R1). See mfbe/utf8_paths.hpp. Built as mfbe_paths (core/CMakeLists.txt).
#include <mfbe/utf8_paths.hpp>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

namespace mfbe::platform {

#ifdef _WIN32

namespace {

std::wstring wide_from_utf8(std::string_view utf8) {
    if (utf8.empty()) {
        return {};
    }
    // No MB_ERR_INVALID_CHARS: invalid sequences become U+FFFD instead of failing.
    const int length =
        MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    std::wstring wide(static_cast<std::size_t>(length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(),
                        length);
    return wide;
}

std::string utf8_from_wide(const std::wstring& wide) {
    if (wide.empty()) {
        return {};
    }
    // No WC_ERR_INVALID_CHARS: an unpaired surrogate becomes U+FFFD instead of failing.
    const int length = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
                                           nullptr, 0, nullptr, nullptr);
    std::string utf8(static_cast<std::size_t>(length), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), utf8.data(), length,
                        nullptr, nullptr);
    return utf8;
}

}  // namespace

std::filesystem::path path_from_utf8(std::string_view utf8) {
    return std::filesystem::path(wide_from_utf8(utf8));
}

std::string utf8_from_path(const std::filesystem::path& path) {
    return utf8_from_wide(path.wstring());
}

std::string utf8_from_path_generic(const std::filesystem::path& path) {
    return utf8_from_wide(path.generic_wstring());
}

std::string utf8_error_message(const std::error_code& ec) {
    if (ec.category() != std::system_category()) {
        return ec.message();  // generic (errno) messages of the C runtime are ASCII
    }
    wchar_t* buffer = nullptr;
    const DWORD length = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, static_cast<DWORD>(ec.value()), 0, reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
    std::wstring text = (length != 0 && buffer != nullptr) ? std::wstring(buffer, length) : L"";
    if (buffer != nullptr) {
        LocalFree(buffer);
    }
    while (!text.empty() && (text.back() == L'\r' || text.back() == L'\n')) {
        text.pop_back();
    }
    return text.empty() ? "system error " + std::to_string(ec.value()) : utf8_from_wide(text);
}

#else  // POSIX: paths are byte strings, UTF-8 by convention.

std::filesystem::path path_from_utf8(std::string_view utf8) {
    return std::filesystem::path(std::string(utf8));  // path-text: POSIX bytes are the UTF-8 text
}

std::string utf8_from_path(const std::filesystem::path& path) {
    return path.string();  // path-text: POSIX bytes are the UTF-8 text
}

std::string utf8_from_path_generic(const std::filesystem::path& path) {
    return path.generic_string();  // path-text: POSIX bytes are the UTF-8 text
}

std::string utf8_error_message(const std::error_code& ec) {
    return ec.message();
}

#endif

}  // namespace mfbe::platform
