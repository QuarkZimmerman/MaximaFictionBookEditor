// UTF-8 text <-> filesystem path conversions independent of the process code page (feature 002,
// research R1). See mfbe/utf8_paths.hpp. Built as mfbe_paths (core/CMakeLists.txt).
#include <mfbe/utf8_paths.hpp>

#include <cstddef>
#include <string>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN  // also a compile definition of mfbe::options (MSVC C4005 otherwise)
#define WIN32_LEAN_AND_MEAN
#endif
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

/* ----------------------------------------------------------------------------------------- */
/* The platform's file-name comparison (feature 004 US8)                                     */
/* ----------------------------------------------------------------------------------------- */

namespace {

// Simple case fold of one code point for the letters the file names of this project's
// languages use: ASCII, Latin-1 Supplement, Latin Extended-A, Greek and Cyrillic (the
// macOS rule; APFS and HFS+ ignore letter case). Other code points fold to themselves.
// (Windows compares with the system's own table; the helpers are then unreferenced.)
[[maybe_unused]] char32_t fold_code_point(char32_t c) {
    if (c >= U'A' && c <= U'Z') {
        return c + 32;
    }
    if (c < 0x80) {
        return c;
    }
    if ((c >= 0x00C0 && c <= 0x00DE && c != 0x00D7)) {
        return c + 32;  // Latin-1: À..Þ except ×
    }
    if (c >= 0x0100 && c <= 0x017F) {  // Latin Extended-A: upper/lower pairs
        if (c == 0x0130) {
            return U'i';  // İ
        }
        if (c == 0x0178) {
            return 0x00FF;  // Ÿ
        }
        if ((c >= 0x0100 && c <= 0x0137) || (c >= 0x014A && c <= 0x0177)) {
            return (c % 2 == 0) ? c + 1 : c;
        }
        if ((c >= 0x0139 && c <= 0x0148) || (c >= 0x0179 && c <= 0x017E)) {
            return (c % 2 == 1) ? c + 1 : c;
        }
        return c;
    }
    if (c >= 0x0391 && c <= 0x03A9 && c != 0x03A2) {
        return c + 32;  // Greek capitals
    }
    if (c >= 0x0400 && c <= 0x040F) {
        return c + 80;  // Cyrillic Ѐ..Џ (Ukrainian Є, І, Ї among them)
    }
    if (c >= 0x0410 && c <= 0x042F) {
        return c + 32;  // Cyrillic А..Я
    }
    if ((c >= 0x0460 && c <= 0x0481) || (c >= 0x048A && c <= 0x04BF) ||
        (c >= 0x04D0 && c <= 0x052F)) {
        return (c % 2 == 0) ? c + 1 : c;  // Cyrillic pairs (Ґ/ґ at U+0490/U+0491 among them)
    }
    if (c == 0x04C0) {
        return 0x04CF;
    }
    if (c >= 0x04C1 && c <= 0x04CE) {
        return (c % 2 == 1) ? c + 1 : c;
    }
    return c;
}

// Decodes the next UTF-8 sequence of `text` at `i` (advanced past it); an invalid byte is
// returned as itself so that malformed names still compare byte for byte.
[[maybe_unused]] char32_t next_code_point(std::string_view text, std::size_t& i) {
    const auto byte = static_cast<unsigned char>(text[i]);
    std::size_t length = 1;
    char32_t value = byte;
    if (byte >= 0xF0 && byte <= 0xF4) {
        length = 4;
        value = byte & 0x07u;
    } else if (byte >= 0xE0) {
        length = 3;
        value = byte & 0x0Fu;
    } else if (byte >= 0xC2 && byte <= 0xDF) {
        length = 2;
        value = byte & 0x1Fu;
    }
    if (length == 1 || i + length > text.size()) {
        ++i;
        return byte;
    }
    for (std::size_t k = 1; k < length; ++k) {
        const auto continuation = static_cast<unsigned char>(text[i + k]);
        if ((continuation & 0xC0u) != 0x80u) {
            ++i;
            return byte;
        }
        value = (value << 6) | (continuation & 0x3Fu);
    }
    i += length;
    return value;
}

// Code-point-wise comparison of two UTF-8 strings under fold_code_point.
[[maybe_unused]] bool equal_folded(std::string_view a, std::string_view b) {
    std::size_t i = 0;
    std::size_t j = 0;
    while (i < a.size() && j < b.size()) {
        if (fold_code_point(next_code_point(a, i)) != fold_code_point(next_code_point(b, j))) {
            return false;
        }
    }
    return i == a.size() && j == b.size();
}

#ifdef __APPLE__
[[maybe_unused]] constexpr bool kFoldsFileNames = true;
#else
[[maybe_unused]] constexpr bool kFoldsFileNames = false;
#endif

}  // namespace

bool same_file_path(std::string_view a, std::string_view b) {
#ifdef _WIN32
    // The system's own rule for file names: an ordinal comparison ignoring letter case with
    // its uppercasing table, on the lexically normalised paths.
    const std::wstring left = path_from_utf8(a).lexically_normal().wstring();
    const std::wstring right = path_from_utf8(b).lexically_normal().wstring();
    return CompareStringOrdinal(left.c_str(), static_cast<int>(left.size()), right.c_str(),
                                static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
#else
    if (kFoldsFileNames) {
        const std::string left = utf8_from_path(path_from_utf8(a).lexically_normal());
        const std::string right = utf8_from_path(path_from_utf8(b).lexically_normal());
        return equal_folded(left, right);
    }
    return a == b;  // Linux: the bytes as they are
#endif
}

}  // namespace mfbe::platform
