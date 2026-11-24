// Feature 020 (T009, data-model.md §2.1): Tesseract language pack code <-> FB2 ISO language code
// and script family mapping.
#include <mfbe/ocr.hpp>

#include <algorithm>
#include <cctype>
#include <string>
#include <unordered_map>

namespace mfbe::ocr {
namespace {

std::string to_lower_ascii(std::string_view s) {
    std::string out(s);
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

const std::unordered_map<std::string, LanguageInfo>& known_packs() {
    static const std::unordered_map<std::string, LanguageInfo> table = {
        // 10 bundled European / Slavic starter packs
        {"eng", {"en", "latin"}},
        {"rus", {"ru", "cyrillic"}},
        {"ukr", {"uk", "cyrillic"}},
        {"deu", {"de", "latin"}},
        {"fra", {"fr", "latin"}},
        {"spa", {"es", "latin"}},
        {"ita", {"it", "latin"}},
        {"por", {"pt", "latin"}},
        {"pol", {"pl", "latin"}},
        {"bel", {"be", "cyrillic"}},
        // Common additional Tesseract tessdata / tessdata_best / tessdata_fast packs
        {"afr", {"af", "latin"}},
        {"amh", {"am", "other"}},
        {"ara", {"ar", "arabic"}},
        {"asm", {"as", "indic"}},
        {"aze", {"az", "latin"}},
        {"aze_cyrl", {"az", "cyrillic"}},
        {"ben", {"bn", "indic"}},
        {"bod", {"bo", "other"}},
        {"bos", {"bs", "latin"}},
        {"bre", {"br", "latin"}},
        {"bul", {"bg", "cyrillic"}},
        {"cat", {"ca", "latin"}},
        {"ceb", {"ceb", "latin"}},
        {"ces", {"cs", "latin"}},
        {"chi_sim", {"zh", "cjk"}},
        {"chi_sim_vert", {"zh", "cjk"}},
        {"chi_tra", {"zh", "cjk"}},
        {"chi_tra_vert", {"zh", "cjk"}},
        {"chr", {"chr", "other"}},
        {"cos", {"co", "latin"}},
        {"cym", {"cy", "latin"}},
        {"dan", {"da", "latin"}},
        {"dan_frak", {"da", "latin"}},
        {"deu_frak", {"de", "latin"}},
        {"deu_latf", {"de", "latin"}},
        {"div", {"dv", "other"}},
        {"dzo", {"dz", "other"}},
        {"ell", {"el", "greek"}},
        {"enm", {"enm", "latin"}},
        {"epo", {"eo", "latin"}},
        {"est", {"et", "latin"}},
        {"eus", {"eu", "latin"}},
        {"fao", {"fo", "latin"}},
        {"fas", {"fa", "arabic"}},
        {"fil", {"fil", "latin"}},
        {"fin", {"fi", "latin"}},
        {"frk", {"de", "latin"}},
        {"frm", {"frm", "latin"}},
        {"fry", {"fy", "latin"}},
        {"gla", {"gd", "latin"}},
        {"gle", {"ga", "latin"}},
        {"glg", {"gl", "latin"}},
        {"grc", {"grc", "greek"}},
        {"guj", {"gu", "indic"}},
        {"hat", {"ht", "latin"}},
        {"heb", {"he", "hebrew"}},
        {"hin", {"hi", "indic"}},
        {"hrv", {"hr", "latin"}},
        {"hun", {"hu", "latin"}},
        {"hye", {"hy", "armenian"}},
        {"iku", {"iu", "other"}},
        {"ind", {"id", "latin"}},
        {"isl", {"is", "latin"}},
        {"ita_old", {"it", "latin"}},
        {"jav", {"jv", "latin"}},
        {"jpn", {"ja", "cjk"}},
        {"jpn_vert", {"ja", "cjk"}},
        {"kan", {"kn", "indic"}},
        {"kat", {"ka", "georgian"}},
        {"kat_old", {"ka", "georgian"}},
        {"kaz", {"kk", "cyrillic"}},
        {"khm", {"km", "other"}},
        {"kir", {"ky", "cyrillic"}},
        {"kmr", {"kmr", "latin"}},
        {"kor", {"ko", "cjk"}},
        {"kor_vert", {"ko", "cjk"}},
        {"lao", {"lo", "other"}},
        {"lat", {"la", "latin"}},
        {"lav", {"lv", "latin"}},
        {"lit", {"lt", "latin"}},
        {"ltz", {"lb", "latin"}},
        {"mal", {"ml", "indic"}},
        {"mar", {"mr", "indic"}},
        {"mkd", {"mk", "cyrillic"}},
        {"mlt", {"mt", "latin"}},
        {"mon", {"mn", "cyrillic"}},
        {"mri", {"mi", "latin"}},
        {"msa", {"ms", "latin"}},
        {"mya", {"my", "other"}},
        {"nep", {"ne", "indic"}},
        {"nld", {"nl", "latin"}},
        {"nor", {"no", "latin"}},
        {"oci", {"oc", "latin"}},
        {"ori", {"or", "indic"}},
        {"pan", {"pa", "indic"}},
        {"pus", {"ps", "arabic"}},
        {"que", {"qu", "latin"}},
        {"ron", {"ro", "latin"}},
        {"san", {"sa", "indic"}},
        {"sin", {"si", "indic"}},
        {"slk", {"sk", "latin"}},
        {"slk_frak", {"sk", "latin"}},
        {"slv", {"sl", "latin"}},
        {"snd", {"sd", "arabic"}},
        {"spa_old", {"es", "latin"}},
        {"sqi", {"sq", "latin"}},
        {"srp", {"sr", "cyrillic"}},
        {"srp_latn", {"sr", "latin"}},
        {"sun", {"su", "latin"}},
        {"swa", {"sw", "latin"}},
        {"swe", {"sv", "latin"}},
        {"syr", {"syr", "other"}},
        {"tam", {"ta", "indic"}},
        {"tat", {"tt", "cyrillic"}},
        {"tel", {"te", "indic"}},
        {"tgk", {"tg", "cyrillic"}},
        {"tgl", {"tl", "latin"}},
        {"tha", {"th", "other"}},
        {"tir", {"ti", "other"}},
        {"ton", {"to", "latin"}},
        {"tur", {"tr", "latin"}},
        {"uig", {"ug", "arabic"}},
        {"urd", {"ur", "arabic"}},
        {"uzb", {"uz", "latin"}},
        {"uzb_cyrl", {"uz", "cyrillic"}},
        {"vie", {"vi", "latin"}},
        {"yid", {"yi", "hebrew"}},
        {"yor", {"yo", "latin"}},
    };
    return table;
}

}  // namespace

bool is_valid_traineddata_stem(std::string_view stem) {
    if (stem.size() < 2 || stem.size() > 32) {
        return false;
    }
    if (stem.front() == '.' || stem.back() == '.') {
        return false;
    }
    for (std::size_t i = 0; i < stem.size(); ++i) {
        const unsigned char c = static_cast<unsigned char>(stem[i]);
        const bool ok =
            std::isalnum(c) != 0 || c == '_' || c == '.' || c == '-';
        if (!ok) {
            return false;
        }
        if (c == '.' && i + 1 < stem.size() && stem[i + 1] == '.') {
            return false;
        }
    }
    return true;
}

bool is_valid_pack_code(std::string_view code) {
    if (!is_valid_traineddata_stem(code)) {
        return false;
    }
    return to_lower_ascii(code) != "osd";
}

LanguageInfo language_info_for_code(std::string_view code) {
    const std::string lower = to_lower_ascii(code);
    const auto& table = known_packs();
    if (const auto it = table.find(lower); it != table.end()) {
        return it->second;
    }
    // Custom variant suffixes such as "rus_old", "eng-best", "deu.custom" inherit base info.
    const std::size_t sep = lower.find_first_of("_.-");
    if (sep != std::string::npos && sep >= 2) {
        const std::string base = lower.substr(0, sep);
        if (const auto it = table.find(base); it != table.end()) {
            return it->second;
        }
        return {base, "other"};
    }
    return {lower, "other"};
}

std::string normalize_osd_script(std::string_view osd_script) {
    const std::string s = to_lower_ascii(osd_script);
    if (s == "latin" || s == "fraktur") {
        return "latin";
    }
    if (s == "cyrillic") {
        return "cyrillic";
    }
    if (s == "greek") {
        return "greek";
    }
    if (s == "hebrew") {
        return "hebrew";
    }
    if (s == "arabic" || s == "syriac") {
        return "arabic";
    }
    if (s == "han" || s == "hans" || s == "hant" || s == "japanese" || s == "hangul" ||
        s == "katakana" || s == "hiragana" || s == "bopomofo") {
        return "cjk";
    }
    if (s == "devanagari" || s == "bengali" || s == "gurmukhi" || s == "gujarati" ||
        s == "oriya" || s == "tamil" || s == "telugu" || s == "kannada" || s == "malayalam" ||
        s == "sinhala") {
        return "indic";
    }
    if (s == "armenian") {
        return "armenian";
    }
    if (s == "georgian") {
        return "georgian";
    }
    return "other";
}

}  // namespace mfbe::ocr
