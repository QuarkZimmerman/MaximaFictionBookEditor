// Feature 020 (T019): Tesseract pack code mapping, script grouping, and trigram/confidence
// language scoring across all 10 bundled European/Slavic languages plus custom packs.
#include "pdf/reader/ocr_lang.hpp"

#include <mfbe/ocr.hpp>

#include <catch2/catch_test_macros.hpp>
#include <vector>

using namespace mfbe;
using namespace mfbe::pdf_reader;

TEST_CASE("ocr languages: pack code <-> FB2 ISO code and script mapping", "[ocr][lang][020]") {
    CHECK(ocr::language_info_for_code("eng").fb2_lang == "en");
    CHECK(ocr::language_info_for_code("eng").script == "latin");
    CHECK(ocr::language_info_for_code("rus").fb2_lang == "ru");
    CHECK(ocr::language_info_for_code("rus").script == "cyrillic");
    CHECK(ocr::language_info_for_code("ukr").fb2_lang == "uk");
    CHECK(ocr::language_info_for_code("deu").fb2_lang == "de");
    CHECK(ocr::language_info_for_code("fra").fb2_lang == "fr");
    CHECK(ocr::language_info_for_code("spa").fb2_lang == "es");
    CHECK(ocr::language_info_for_code("ita").fb2_lang == "it");
    CHECK(ocr::language_info_for_code("por").fb2_lang == "pt");
    CHECK(ocr::language_info_for_code("pol").fb2_lang == "pl");
    CHECK(ocr::language_info_for_code("bel").fb2_lang == "be");

    // Additional and custom-variant packs
    CHECK(ocr::language_info_for_code("ces").fb2_lang == "cs");
    CHECK(ocr::language_info_for_code("jpn").fb2_lang == "ja");
    CHECK(ocr::language_info_for_code("jpn").script == "cjk");
    CHECK(ocr::language_info_for_code("heb").fb2_lang == "he");
    CHECK(ocr::language_info_for_code("heb").script == "hebrew");
    CHECK(ocr::language_info_for_code("rus_old").fb2_lang == "ru");
    CHECK(ocr::language_info_for_code("rus_old").script == "cyrillic");
    CHECK(ocr::language_info_for_code("deu_frak").fb2_lang == "de");
    CHECK(ocr::language_info_for_code("kat").fb2_lang == "ka");
    CHECK(ocr::language_info_for_code("kat").script == "georgian");

    // Validation rules
    CHECK(ocr::is_valid_pack_code("eng"));
    CHECK(ocr::is_valid_pack_code("rus_old"));
    CHECK_FALSE(ocr::is_valid_pack_code("osd"));
    CHECK_FALSE(ocr::is_valid_pack_code("a"));
    CHECK_FALSE(ocr::is_valid_pack_code("../eng"));
    CHECK_FALSE(ocr::is_valid_pack_code(".hidden"));
    CHECK(ocr::is_valid_traineddata_stem("osd"));

    // OSD script normalization
    CHECK(ocr::normalize_osd_script("Latin") == "latin");
    CHECK(ocr::normalize_osd_script("Cyrillic") == "cyrillic");
    CHECK(ocr::normalize_osd_script("Han") == "cjk");
    CHECK(ocr::normalize_osd_script("Georgian") == "georgian");
}

TEST_CASE("ocr lang scorer: discriminates all 10 bundled Latin and Cyrillic languages",
          "[ocr][lang][020]") {
    const std::vector<std::string> latin = {"eng", "deu", "fra", "spa", "ita", "por", "pol"};
    const std::vector<std::string> cyrillic = {"rus", "ukr", "bel"};

    CHECK(detect_same_script_pack(
              "Every morning before sunrise the lantern keeper walked down the stone pier to "
              "inspect the brass beacon and trim the linen wick.",
              latin) == "eng");

    CHECK(detect_same_script_pack(
              "Jeden Morgen öffnete der Buchhändler die schwere Holztür an der schmalen Straße "
              "und stellte frische Bücher über Geschichte und Natur ins Fenster.",
              latin) == "deu");

    CHECK(detect_same_script_pack(
              "Dans la petite bibliothèque près de la rivière, les lecteurs ouvraient de vieux "
              "livres avec soin pour découvrir les histoires de cette ville.",
              latin) == "fra");

    CHECK(detect_same_script_pack(
              "Por la mañana los pescadores regresaban al puerto con las redes llenas mientras "
              "las campanas de la plaza sonaban sobre la ciudad.",
              latin) == "spa");

    CHECK(detect_same_script_pack(
              "Nella piccola libreria della piazza gli studenti cercavano vecchi romanzi per "
              "leggere le storie della città e della costa settentrionale.",
              latin) == "ita");

    CHECK(detect_same_script_pack(
              "Na pequena livraria perto do porto os leitores procuravam livros antigos sobre "
              "viagens marítimas e histórias das ilhas do sul.",
              latin) == "por");

    CHECK(detect_same_script_pack(
              "Każdego ranka księgarz otwierał ciężkie drewniane drzwi przy wąskiej ulicy i "
              "układał nowe książki oraz mapy na półkach w sklepie.",
              latin) == "pol");

    CHECK(detect_same_script_pack(
              "Каждое утро до рассвета смотритель спускался по каменной лестнице к гавани, "
              "чтобы проверить медный фонарь и записать погоду в журнал.",
              cyrillic) == "rus");

    CHECK(detect_same_script_pack(
              "Щоранку сонячні промені освітлювали дніпровські схили, а у старій міській "
              "бібліотеці зберігалися рідкісні українські книжки та карти України.",
              cyrillic) == "ukr");

    CHECK(detect_same_script_pack(
              "Кожную раніцу над ціхай ракой узнімаўся туман, а ў старой бібліятэцы "
              "захоўваліся рэдкія беларускія кніжкі пра гісторыю і падарожжы.",
              cyrillic) == "bel");
}

TEST_CASE("ocr lang scorer: script grouping and custom-pack fallback", "[ocr][lang][020]") {
    const auto groups = group_packs_by_script({"eng", "rus", "deu", "ukr"});
    REQUIRE(groups.size() == 2);
    CHECK(groups.at("latin") == std::vector<std::string>{"eng", "deu"});
    CHECK(groups.at("cyrillic") == std::vector<std::string>{"rus", "ukr"});

    CHECK(dominant_text_script("Каждое утро в гавани") == "cyrillic");
    CHECK(dominant_text_script("Harbour lantern keeper") == "latin");

    // Custom pack without static trigram profile wins when Tesseract confidence is much higher
    const auto czech = evaluate_ocr_candidate(
        "Příliš žluťoučký kůň úpěl ďábelské ódy u starého mostu", "ces", 95.0, 0.95, 9);
    const auto wrong_eng = evaluate_ocr_candidate(
        "Prilis zlutoucky kun upel dabelske ody u stareho mostu", "eng", 52.0, 0.60, 9);
    CHECK(pick_best_candidate({wrong_eng, czech}) == "ces");
}
