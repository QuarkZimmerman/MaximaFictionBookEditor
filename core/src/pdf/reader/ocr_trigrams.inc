// Feature 020 (T017, research.md R3): compact static language profiles for the 10 bundled
// starter languages (eng, rus, ukr, deu, fra, spa, ita, por, pol, bel).
// Each profile carries top lowercase UTF-8 character 3-grams, high-frequency stopwords,
// characteristic unique/diacritic letters, and letters that strongly contradict that language.
#pragma once

#include <array>
#include <string_view>

namespace mfbe::pdf_reader::ocr_detail {

struct LanguageProfile {
    std::string_view code;
    std::string_view fb2_lang;
    std::string_view script;
    const std::string_view* trigrams;
    std::size_t trigram_count;
    const std::string_view* stopwords;
    std::size_t stopword_count;
    const char32_t* characteristic_chars;
    std::size_t characteristic_count;
    const char32_t* forbidden_chars;
    std::size_t forbidden_count;
};

inline constexpr std::string_view kEngTrigrams[] = {
    " th", "the", "he ", " an", "and", "nd ", "ing", "ng ", " to", "to ", " in", "in ",
    " of", "of ", "ion", "on ", "ed ", "er ", "re ", "es ", "is ", "is",  "en ", "at ",
    "ent", "ti",  "for", "or ", "as ", "ha",  "hat", "tha", "her", "his", "was", "ter",
    "ver", "all", "wit", "ith", "th ", "ou ", "you", "not", "ot ", "are", "but", "fro",
    "rom", "om ", "hav", "ave", "ve ", "thi", "whe", "whi", "eve", "one", "out", "igh",
    "ght", "st ", "le ", "se ", "al ", "ly ", "ea ", "ch ", "sh ", "ck ", "ll ", "ow ",
};
inline constexpr std::string_view kEngStopwords[] = {
    "the",  "and",  "that", "have", "for",  "not",  "with", "you",  "this", "but",
    "from", "they", "were", "been", "their", "which", "there", "would", "about", "into",
    "while", "where", "before", "every", "after", "under", "through", "between",
};

inline constexpr std::string_view kDeuTrigrams[] = {
    " de", "der", "er ", "en ", "ch ", "ich", "sch", "ein", "die", "ie ", "und", "nd ",
    "che", "den", "in ", "ine", "te ", "ung", "ng ", "ge ", " ge", "ver", " be", "ber",
    "das", "as ", "ist", "st ", "mit", "it ", "von", "on ", "auf", "uf ", "aus", "nic",
    "cht", "ht ", "ach", "uch", "au ", "ei ", "sie", "zu ", " zu", "dem", "des", "es ",
    "für", "ür ", "übe", "war", "ann", "ter", "ren", "gen", "ten", "hen", "sen", "men",
    "len", "nen", "ige", "lic", "kei", "eit", "ste", "tra", "str", "ß",   "äu",  "öf",
};
inline constexpr std::string_view kDeuStopwords[] = {
    "der",   "die",   "das",   "und",   "nicht", "ein",   "eine",  "einen", "einem", "einer",
    "mit",   "von",   "auf",   "für",   "den",   "dem",   "des",   "ist",   "sind",  "war",
    "auch",  "über",  "aus",   "bei",   "nach",  "noch",  "wenn",  "wird",  "sich",  "als",
};
inline constexpr char32_t kDeuChars[] = {U'ß', U'ä', U'ö', U'ü'};

inline constexpr std::string_view kFraTrigrams[] = {
    " de", "de ", " le", "le ", " la", "la ", "les", "es ", "ent", "nt ", "ion", "on ",
    "des", " un", "une", "ne ", "que", "ue ", " qu", "est", "st ", "et ", " et", "dan",
    "ans", "ns ", "pou", "our", "ur ", "par", "ar ", "sur", "pas", "as ", "ave", "vec",
    "ec ", "qui", "ui ", "mai", "ais", "is ", "tou", "ous", "us ", "vou", "nou", "men",
    "eme", "ait", "it ", "ant", "tre", "re ", "eur", "aux", "ux ", "ces", "ses", "son",
    "ont", "ait", "é ",  "ée ", "és ", "ç",   "à ",  "où ", "êtr", "été",
};
inline constexpr std::string_view kFraStopwords[] = {
    "le",   "la",   "les",  "des",  "une",  "dans", "pour", "avec", "sur",  "est",
    "pas",  "que",  "qui",  "mais", "vous", "nous", "par",  "plus", "sont", "tout",
    "cette", "comme", "sans", "être", "avoir", "aux", "elle", "leur",
};
inline constexpr char32_t kFraChars[] = {U'ç', U'œ', U'é', U'è', U'ê', U'à', U'ù', U'î', U'ô'};

inline constexpr std::string_view kSpaTrigrams[] = {
    " de", "de ", " la", "la ", " el", "el ", " en", "en ", "os ", "as ", "es ", "que",
    "ue ", " qu", "los", "las", "del", "por", "or ", "con", "on ", "par", "ara", "ra ",
    "una", "na ", "ent", "nte", "te ", "ado", "do ", "ido", "ió",  "ión", "ón ", "est",
    "sta", "ta ", "com", "omo", "mo ", "per", "ero", "ro ", "más", "ás ", "son", "sus",
    "ste", "tre", "re ", "and", "ndo", "cia", "ia ", "ier", "tra", "aba", "ían", "hab",
    "año", "ñ",   "muy", "sin", "sob", "bre", "tod", "odo", "des", "fue",
};
inline constexpr std::string_view kSpaStopwords[] = {
    "el",    "la",    "los",   "las",   "del",   "una",   "por",   "con",   "para",  "como",
    "pero",  "más",   "son",   "este",  "esta",  "entre", "todo",  "todos", "sobre", "sin",
    "cuando", "donde", "desde", "hasta", "porque", "también", "había", "muy",
};
inline constexpr char32_t kSpaChars[] = {U'ñ', U'¿', U'¡', U'á', U'é', U'í', U'ó', U'ú'};

inline constexpr std::string_view kItaTrigrams[] = {
    " di", "di ", " la", "la ", " il", "il ", "che", "he ", " ch", "per", "er ", " de",
    "del", "ell", "lla", "la ", "con", "on ", " un", "una", "na ", "in ", " in", "no ",
    "to ", "te ", "ti ", "ta ", "re ", "le ", "li ", "si ", "al ", "nel", "gli", "gli",
    "one", "ne ", "ion", "zio", "ent", "nto", "ato", "ito", "uto", "sta", "sto", "tra",
    "anc", "nch", "com", "ome", "son", "ono", "non", "all", "dal", "sul", "que", "ues",
    "est", "era", "ano", "ava", "tti", "tte", "tto", "ità", "à ",  "è ",
};
inline constexpr std::string_view kItaStopwords[] = {
    "il",    "lo",    "la",    "gli",   "del",   "della", "delle", "degli", "che",   "per",
    "con",   "una",   "sono",  "come",  "anche", "dalla", "nel",   "nella", "questo", "questa",
    "non",   "più",   "tutti", "sulla", "essere", "aveva", "dopo",  "sempre",
};
inline constexpr char32_t kItaChars[] = {U'à', U'è', U'é', U'ì', U'ò', U'ù'};

inline constexpr std::string_view kPorTrigrams[] = {
    " de", "de ", " do", "do ", " da", "da ", " os", "os ", " as", "as ", "que", "ue ",
    " qu", "com", "om ", " em", "em ", "par", "ara", "ra ", "por", "or ", "uma", "ma ",
    "dos", "das", "não", "ão ", "ção", "ões", "es ", "ent", "nte", "te ", "ado", "ido",
    "est", "sta", "mai", "ais", "is ", "com", "omo", "mo ", "pel", "elo", "ela", "um ",
    " um", "nos", "nas", "seu", "sua", "foi", "era", "são", "ser", "ter", "mas", "sem",
    "sob", "bre", "ent", "tre", "and", "ndo", "ava", "iam", "inh", "nha",
};
inline constexpr std::string_view kPorStopwords[] = {
    "os",    "as",    "um",    "uma",   "dos",   "das",   "com",   "para",  "por",   "não",
    "mais",  "como",  "pelo",  "pela",  "entre", "sobre", "mas",   "foi",   "são",   "muito",
    "também", "ainda", "sem",  "onde",  "quando", "depois", "apenas", "todos",
};
inline constexpr char32_t kPorChars[] = {U'ã', U'õ', U'ç', U'á', U'â', U'é', U'ê', U'í', U'ó', U'ô', U'ú'};

inline constexpr std::string_view kPolTrigrams[] = {
    " ni", "nie", "ie ", " pr", "prz", "rze", "ze ", " po", " na", "na ", " do", "do ",
    " się", "się", "ię ", "je ", "jes", "est", "st ", "sze", "cze", "czy", "zy ", "ych",
    "ch ", "ego", "go ", "owi", "wi ", "ani", "nia", "ia ", "owa", "wać", "ać ", "ość",
    "ści", "ci ", "trz", "rz ", "dzi", "zie", "kt",  "któ", "tór", "óry", "ora", "raz",
    "jak", "ako", "ko ", "tyl", "ylk", "lko", "był", "yła", "dla", "la ", "teg", "przy",
    "wsz", "szk", "czn", "ny ", "ne ", "ym ", "mi ", "ów ", "ąć ", "ęż",
};
inline constexpr std::string_view kPolStopwords[] = {
    "nie",   "się",   "jest",  "oraz",  "przez", "jako",  "tylko", "który", "która", "które",
    "był",   "była",  "było",  "dla",   "tego",  "przy",  "ale",   "tak",   "już",   "czy",
    "może",  "bardzo", "wszystkie", "przed", "gdzie", "kiedy", "jego", "jej",
};
inline constexpr char32_t kPolChars[] = {U'ą', U'ć', U'ę', U'ł', U'ń', U'ó', U'ś', U'ź', U'ż'};

inline constexpr std::string_view kRusTrigrams[] = {
    " по", " на", " не", "не ", " в ", " и ", " с ", "то ", "ого", "го ", "его", "ени",
    "ния", "ия ", "ова", "про", "при", "что", "как", "для", "или", "ний", "ств", "тво",
    "ать", "ить", "ть ", "ост", "сти", "ти ", "ный", "ной", "ных", "ную", "ное", "ая ",
    "ые ", "ых ", "ым ", "ыми", "ами", "его", "ему", "ом ", "ем ", "ов ", "ев ", "ей ",
    "ой ", "ий ", "ся ", "сь ", "тал", "ста", "раз", "пер", "под", "над", "без", "ере",
    "оро", "оло", "ель", "тел", "ный", "нно", "все", "был", "бы",  "это", "эту", "эты",
};
inline constexpr std::string_view kRusStopwords[] = {
    "что",   "как",   "для",   "или",   "его",   "она",   "они",   "был",   "была",  "были",
    "было",  "это",   "этот",  "этой",  "при",   "под",   "над",   "без",   "все",   "всё",
    "где",   "когда", "после", "перед", "между", "через", "чтобы", "только", "очень", "уже",
};
inline constexpr char32_t kRusChars[] = {U'ы', U'э', U'ъ', U'ё'};
inline constexpr char32_t kRusForbidden[] = {U'ї', U'є', U'і', U'ґ', U'ў'};

inline constexpr std::string_view kUkrTrigrams[] = {
    " по", " на", " не", "не ", " у ", " і ", " в ", " з ", "від", "ід ", "для", "ля ",
    "при", "про", "що ", " що", "які", "ого", "го ", "ння", "ня ", "ськ", "ьки", "кий",
    "ати", "ити", "ти ", "іст", "сть", "ть ", "ний", "ної", "них", "ним", "ною", "ною",
    "ого", "ому", "ими", "ами", "іх ", "ій ", "ої ", "єї ", "ся ", "сь ", "був", "бул",
    "ула", "ули", "уло", "цей", "цьо", "цій", "цих", "але", "або", "так", "вже", "ще ",
    "під", "над", "без", "між", "їх ", "її ", "є ",  "киї", "укр", "кра", "раї", "аїн",
};
inline constexpr std::string_view kUkrStopwords[] = {
    "що",    "які",   "який",  "яка",   "від",   "для",   "при",   "про",   "але",   "або",
    "вже",   "був",   "була",  "були",  "було",  "цей",   "цього", "цієї",  "під",   "між",
    "через", "після", "перед", "коли",  "тільки", "дуже", "можна", "також", "свої",  "його",
};
inline constexpr char32_t kUkrChars[] = {U'ї', U'є', U'і', U'ґ'};
inline constexpr char32_t kUkrForbidden[] = {U'ы', U'ъ', U'ё', U'э', U'ў'};

inline constexpr std::string_view kBelTrigrams[] = {
    " па", " на", " не", "не ", " ў ", " і ", " з ", "пра", "пры", "для", "што", "які",
    "ага", "га ", "ння", "ня ", "скі", "аць", "іць", "ць ", "асц", "сць", "ны ", "най",
    "ных", "ным", "най", "аму", "ымі", "амі", "ся ", "сь ", "быў", "был", "ыла", "ылі",
    "ыло", "гэт", "эта", "тай", "тых", "але", "або", "так", "ужо", "яшч", "пад", "над",
    "без", "між", "пра", "раз", "пера", "дзя", "ця ", "дз ", "ў ",  "оў ", "аў ", "еў ",
};
inline constexpr std::string_view kBelStopwords[] = {
    "што",   "які",   "якая",  "якія",  "для",   "пра",   "пры",   "але",   "або",   "ужо",
    "быў",   "была",  "былі",  "было",  "гэта",  "гэты",  "гэтай", "пад",   "між",   "праз",
    "пасля", "перад", "калі",  "толькі", "вельмі", "можна", "таксама", "яго", "яе",   "яны",
};
inline constexpr char32_t kBelChars[] = {U'ў', U'і'};
inline constexpr char32_t kBelForbidden[] = {U'ї', U'є', U'ґ', U'ъ'};

#define MFBE_ARR(a) a, std::size(a)
#define MFBE_NONE nullptr, 0

inline constexpr std::array<LanguageProfile, 10> kBundledProfiles = {{
    {"eng", "en", "latin", MFBE_ARR(kEngTrigrams), MFBE_ARR(kEngStopwords), MFBE_NONE, MFBE_NONE},
    {"deu", "de", "latin", MFBE_ARR(kDeuTrigrams), MFBE_ARR(kDeuStopwords), MFBE_ARR(kDeuChars),
     MFBE_NONE},
    {"fra", "fr", "latin", MFBE_ARR(kFraTrigrams), MFBE_ARR(kFraStopwords), MFBE_ARR(kFraChars),
     MFBE_NONE},
    {"spa", "es", "latin", MFBE_ARR(kSpaTrigrams), MFBE_ARR(kSpaStopwords), MFBE_ARR(kSpaChars),
     MFBE_NONE},
    {"ita", "it", "latin", MFBE_ARR(kItaTrigrams), MFBE_ARR(kItaStopwords), MFBE_ARR(kItaChars),
     MFBE_NONE},
    {"por", "pt", "latin", MFBE_ARR(kPorTrigrams), MFBE_ARR(kPorStopwords), MFBE_ARR(kPorChars),
     MFBE_NONE},
    {"pol", "pl", "latin", MFBE_ARR(kPolTrigrams), MFBE_ARR(kPolStopwords), MFBE_ARR(kPolChars),
     MFBE_NONE},
    {"rus", "ru", "cyrillic", MFBE_ARR(kRusTrigrams), MFBE_ARR(kRusStopwords), MFBE_ARR(kRusChars),
     MFBE_ARR(kRusForbidden)},
    {"ukr", "uk", "cyrillic", MFBE_ARR(kUkrTrigrams), MFBE_ARR(kUkrStopwords), MFBE_ARR(kUkrChars),
     MFBE_ARR(kUkrForbidden)},
    {"bel", "be", "cyrillic", MFBE_ARR(kBelTrigrams), MFBE_ARR(kBelStopwords), MFBE_ARR(kBelChars),
     MFBE_ARR(kBelForbidden)},
}};

#undef MFBE_ARR
#undef MFBE_NONE

}  // namespace mfbe::pdf_reader::ocr_detail
