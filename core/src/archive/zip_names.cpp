// The legacy-name judge (feature 009, research DP-2). See mfbe/archive.hpp.
//
// A ZIP file does not record which code page its unflagged names use. One archiver wrote all
// of an archive's names, so the judge decides once per archive: names that are valid UTF-8
// everywhere are UTF-8; otherwise every candidate code page decodes all of them through the
// platform's converter, and the one giving the most plausible names wins - letters of one
// script with digits and punctuation, without box-drawing, control or unassigned characters.
// Ties go to the earlier candidate (the system's code pages, then CP866, then CP437).
#include <mfbe/archive.hpp>

#include <algorithm>
#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <iconv.h>
#include <langinfo.h>
#endif

namespace mfbe::archive {
namespace {

constexpr int kUtf8 = 65001;

// Decodes UTF-8 into code points; false on any malformed sequence.
bool decode_utf8(std::string_view s, std::vector<char32_t>& out) {
    out.clear();
    for (std::size_t i = 0; i < s.size();) {
        const auto c = static_cast<unsigned char>(s[i]);
        int extra = 0;
        char32_t cp = 0;
        if (c < 0x80) {
            cp = c;
        } else if ((c & 0xE0) == 0xC0) {
            extra = 1;
            cp = c & 0x1F;
        } else if ((c & 0xF0) == 0xE0) {
            extra = 2;
            cp = c & 0x0F;
        } else if ((c & 0xF8) == 0xF0) {
            extra = 3;
            cp = c & 0x07;
        } else {
            return false;
        }
        if (extra > 0 && i + static_cast<std::size_t>(extra) >= s.size()) {
            return false;
        }
        for (int k = 1; k <= extra; ++k) {
            const auto cc = static_cast<unsigned char>(s[i + static_cast<std::size_t>(k)]);
            if ((cc & 0xC0) != 0x80) {
                return false;
            }
            cp = (cp << 6) | (cc & 0x3F);
        }
        static constexpr std::array<char32_t, 4> kMin{0, 0x80, 0x800, 0x10000};
        if (cp < kMin[static_cast<std::size_t>(extra)] || cp > 0x10FFFF ||
            (cp >= 0xD800 && cp <= 0xDFFF)) {
            return false;
        }
        out.push_back(cp);
        i += static_cast<std::size_t>(extra) + 1;
    }
    return true;
}

// 0 = not a letter; otherwise a script number.
int script_of(char32_t c) {
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
        (c >= 0xC0 && c <= 0x24F && c != 0xD7 && c != 0xF7)) {
        return 1;  // Latin
    }
    if (c >= 0x400 && c <= 0x52F) {
        return 2;  // Cyrillic
    }
    if (c >= 0x386 && c <= 0x3FF) {
        return 3;  // Greek
    }
    if (c >= 0x5D0 && c <= 0x5EA) {
        return 4;  // Hebrew
    }
    if (c >= 0x620 && c <= 0x64A) {
        return 5;  // Arabic
    }
    return 0;
}

bool plausible_other(char32_t c) {
    if (c >= '0' && c <= '9') {
        return true;
    }
    static constexpr std::u32string_view kPunctuation = U" .,-_()[]{}'!&+@#~;=%$^/\u2013\u2014";
    return kPunctuation.find(c) != std::u32string_view::npos;
}

// Scores one word: the letters of its main script, minus twice the letters of any other
// script mixed into it (no real word mixes alphabets: "CafВ"). A Cyrillic word of four letters
// or more without any of а, е, и, о is no Russian word: it is what CP866 makes of Hebrew CP1255
// bytes (its р-я), so it earns nothing.
long word_score(const std::map<int, long>& letters, bool common_vowel) {
    long all = 0;
    long main = 0;
    int main_script = 0;
    for (const auto& [script, count] : letters) {
        all += count;
        if (count > main) {
            main = count;
            main_script = script;
        }
    }
    const long mixed = all - main;
    if (main_script == 2 && main >= 4 && !common_vowel) {
        main = 0;
    }
    return main - 2 * mixed;
}

// Higher is more plausible: the sum of the words' scores, minus five per character no name
// would hold (box drawing, controls, stray symbols).
long score(const std::vector<std::string>& names) {
    static constexpr std::u32string_view kVowels =
        U"\u0430\u0435\u0438\u043E\u0410\u0415\u0418\u041E";
    long total = 0;
    std::vector<char32_t> cps;
    for (const std::string& name : names) {
        if (!decode_utf8(name, cps)) {
            return -1000000;
        }
        std::map<int, long> letters;
        bool common_vowel = false;
        auto close_word = [&]() {
            total += word_score(letters, common_vowel);
            letters.clear();
            common_vowel = false;
        };
        for (const char32_t c : cps) {
            if (const int script = script_of(c); script != 0) {
                ++letters[script];
                common_vowel = common_vowel || kVowels.find(c) != std::u32string_view::npos;
                continue;
            }
            close_word();
            if (!plausible_other(c)) {
                total -= 5;
            }
        }
        close_word();
    }
    return total;
}

#ifndef _WIN32
std::string iconv_name(int codepage) {
    return "CP" + std::to_string(codepage);
}
#endif

}  // namespace

std::string convert_codepage(std::string_view raw, int codepage) {
    if (codepage == kUtf8) {
        std::vector<char32_t> cps;
        return decode_utf8(raw, cps) ? std::string(raw) : std::string();
    }
    if (raw.empty()) {
        return "";
    }
#ifdef _WIN32
    const int wide = MultiByteToWideChar(static_cast<UINT>(codepage), MB_ERR_INVALID_CHARS,
                                         raw.data(), static_cast<int>(raw.size()), nullptr, 0);
    if (wide <= 0) {
        return "";
    }
    std::wstring w(static_cast<std::size_t>(wide), L'\0');
    MultiByteToWideChar(static_cast<UINT>(codepage), MB_ERR_INVALID_CHARS, raw.data(),
                        static_cast<int>(raw.size()), w.data(), wide);
    const int bytes = WideCharToMultiByte(CP_UTF8, 0, w.data(), wide, nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<std::size_t>(bytes), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), wide, out.data(), bytes, nullptr, nullptr);
    return out;
#else
    iconv_t cd = iconv_open("UTF-8", iconv_name(codepage).c_str());
    if (cd == reinterpret_cast<iconv_t>(-1)) {
        return "";
    }
    std::string in(raw);
    std::string out(in.size() * 4 + 4, '\0');
    char* src = in.data();
    std::size_t src_left = in.size();
    char* dst = out.data();
    std::size_t dst_left = out.size();
    const std::size_t r = iconv(cd, &src, &src_left, &dst, &dst_left);
    iconv_close(cd);
    if (r == static_cast<std::size_t>(-1) || src_left != 0) {
        return "";
    }
    out.resize(out.size() - dst_left);
    return out;
#endif
}

std::vector<int> default_candidates() {
    std::vector<int> result;
    auto add = [&](int cp) {
        if (cp > 0 && cp != kUtf8 && std::find(result.begin(), result.end(), cp) == result.end()) {
            result.push_back(cp);
        }
    };
#ifdef _WIN32
    add(static_cast<int>(GetOEMCP()));
    add(static_cast<int>(GetACP()));
#else
    // The locale's code page when it is a Windows or DOS one ("CP1251", "IBM866").
    const std::string codeset = nl_langinfo(CODESET);
    for (const char* prefix : {"CP", "WINDOWS-", "IBM"}) {
        const std::string p = prefix;
        if (codeset.rfind(p, 0) == 0 && codeset.size() > p.size() &&
            codeset.find_first_not_of("0123456789", p.size()) == std::string::npos) {
            add(std::stoi(codeset.substr(p.size())));
        }
    }
#endif
    for (const int cp : {866, 1251, 862, 1255, 437}) {
        add(cp);
    }
    return result;
}

Decoded decode_names(const std::vector<std::string>& raw, const std::vector<int>& candidates) {
    std::vector<char32_t> cps;
    if (std::all_of(raw.begin(), raw.end(),
                    [&](const std::string& n) { return decode_utf8(n, cps); })) {
        return {kUtf8, raw};
    }
    Decoded best;
    long best_score = 0;
    bool found = false;
    for (const int cp : candidates) {
        std::vector<std::string> names;
        names.reserve(raw.size());
        bool all = true;
        for (const std::string& n : raw) {
            std::string decoded = convert_codepage(n, cp);
            if (decoded.empty() && !n.empty()) {
                all = false;
                break;
            }
            names.push_back(std::move(decoded));
        }
        if (!all) {
            continue;
        }
        const long s = score(names);
        if (!found || s > best_score) {
            best = {cp, std::move(names)};
            best_score = s;
            found = true;
        }
    }
    if (found) {
        return best;
    }
    // No converter took them all: every byte as the Latin-1 character of that value.
    Decoded latin1{28591, {}};
    for (const std::string& n : raw) {
        std::string out;
        for (const char ch : n) {
            const auto b = static_cast<unsigned char>(ch);
            if (b < 0x80) {
                out.push_back(ch);
            } else {
                out.push_back(static_cast<char>(0xC0 | (b >> 6)));
                out.push_back(static_cast<char>(0x80 | (b & 0x3F)));
            }
        }
        latin1.names.push_back(std::move(out));
    }
    return latin1;
}

}  // namespace mfbe::archive
