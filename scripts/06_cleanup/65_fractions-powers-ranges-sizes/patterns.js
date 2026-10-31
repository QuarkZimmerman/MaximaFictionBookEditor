// The expressions of 06_Чистка/65_Дроби, степени, интервалы, габариты.js (FictionBook Editor 2.7.9),
// lines 61-234 of the original as written; only "new RegExp(" reads "jscriptRegExp(" (the meaning
// JScript gave \s, \S and ., lib/jscript-regexp.js). nbspEntity is "&nbsp;": the editor's
// non-breaking space is U+00A0, written &nbsp; in the HTML notation of lib/legacy-html.js.
// For each pattern reN1 is the place as found, reN4 the proposed form, reN2 / reN3 the text before
// and after it.
import { jscriptRegExp } from './lib/jscript-regexp.js';

var nbspEntity = "&nbsp;";

 // меры площади и объёма:
 var re50 = jscriptRegExp("^(.*?(?:"+nbspEntity+"| ))??([ксм]?м)([23])(.*?){0,1}$","gi");
 var re51 = "$2$3";                              // прежний вариант
 var re52 = "$1";                                                                      // с начала абзаца до искомого места
 var re53 = "$4";                                                                    // до конца параграфа
 var re54 = "$2<sup>$3</sup>";                                            // предлагаемый вариант в запросе

  // габариты-объём:
 var re40a = jscriptRegExp("^(.*?)??(\\\d+)((?:"+nbspEntity+"| ){0,1}[xх](?:"+nbspEntity+"| ){0,1})(\\\d+)((?:"+nbspEntity+"| ){0,1}[xх](?:"+nbspEntity+"| ){0,1})(\\\d+)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re41a = "$2$3$4$5$6";
 var re42a = "$1";
 var re43a = "$7";
 var re44a = "$2×$4×$6";
 
 // габариты-площадь:
 var re40 = jscriptRegExp("^(.*?[^\\\d])??(\\\d+)((?:"+nbspEntity+"| ){0,1}[xх](?:"+nbspEntity+"| ){0,1})(\\\d+)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re41 = "$2$3$4";
 var re42 = "$1";
 var re43 = "$5";
 var re44 = "$2×$4";

 // дроби на символы дробей:
 var re30 = jscriptRegExp("^(.*?[^\\\d])??(1/4)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31 = "$2";
 var re32 = "$1";
 var re33 = "$3";
 var re34 = "¼";

 var re30a = jscriptRegExp("^(.*?[^\\\d])??(1/2)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31a = "$2";
 var re32a = "$1";
 var re33a = "$3";
 var re34a = "½";

 var re30b = jscriptRegExp("^(.*?[^\\\d])??(3/4)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31b = "$2";
 var re32b = "$1";
 var re33b = "$3";
 var re34b = "¾";

 var re30c = jscriptRegExp("^(.*?[^\\\d])??(1/3)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31c = "$2";
 var re32c = "$1";
 var re33c = "$3";
 var re34c = "⅓";
 
 var re30d = jscriptRegExp("^(.*?[^\\\d])??(2/3)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31d = "$2";
 var re32d = "$1";
 var re33d = "$3";
 var re34d = "⅔";

 var re30e = jscriptRegExp("^(.*?[^\\\d])??(1/5)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31e = "$2";
 var re32e = "$1";
 var re33e = "$3";
 var re34e = "⅕";

 var re30f = jscriptRegExp("^(.*?[^\\\d])??(2/5)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31f = "$2";
 var re32f = "$1";
 var re33f = "$3";
 var re34f = "⅖";

 var re30g = jscriptRegExp("^(.*?[^\\\d])??(3/5)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31g = "$2";
 var re32g = "$1";
 var re33g = "$3";
 var re34g = "⅗";

 var re30h = jscriptRegExp("^(.*?[^\\\d])??(4/5)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31h = "$2";
 var re32h = "$1";
 var re33h = "$3";
 var re34h = "⅘";
 
  var re30i = jscriptRegExp("^(.*?[^\\\d])??(1/6)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31i = "$2";
 var re32i = "$1";
 var re33i = "$3";
 var re34i = "⅙";

 var re30j = jscriptRegExp("^(.*?[^\\\d])??(5/6)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31j = "$2";
 var re32j = "$1";
 var re33j = "$3";
 var re34j = "⅚";

 var re30k = jscriptRegExp("^(.*?[^\\\d])??(1/8)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31k = "$2";
 var re32k = "$1";
 var re33k = "$3";
 var re34k = "⅛";

  var re30l = jscriptRegExp("^(.*?[^\\\d])??(3/8)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31l = "$2";
 var re32l = "$1";
 var re33l = "$3";
 var re34l = "⅜";

 var re30m = jscriptRegExp("^(.*?[^\\\d])??(5/8)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31m = "$2";
 var re32m = "$1";
 var re33m = "$3";
 var re34m = "⅝";
 
 var re30n = jscriptRegExp("^(.*?[^\\\d])??(7/8)(?![^<>]*>)([^\\\d].*?){0,1}$","gi");
 var re31n = "$2";
 var re32n = "$1";
 var re33n = "$3";
 var re34n = "⅞";
 
 // поправил, так как не учитывались пробелы окружающие дефис:
 var re70 = jscriptRegExp("^(.*?)??(\\\d+)((?:"+nbspEntity+"| )?-(?:"+nbspEntity+"| )?)(\\\d+)(?![^<>]*>)(.*?){0,1}$","gi");
 var re71 = "$2$3$4";
 var re72 = "$1";
 var re73 = "$5";
 var re74 = "$2–$4";

 var re80 = jscriptRegExp("^(.*?)??(\\\d+)((?:"+nbspEntity+"| )?—(?:"+nbspEntity+"| )?)(\\\d+)(?![^<>]*>)(.*?){0,1}$","gi");
 var re81 = "$2$3$4";
 var re82 = "$1";
 var re83 = "$5";
 var re84 = "$2–$4";

 var re90 = jscriptRegExp("^(.*?)??(\\\d+)((?:"+nbspEntity+"| )–|–(?:"+nbspEntity+"| )|(?:"+nbspEntity+"| )–(?:"+nbspEntity+"| ))(\\\d+)(?![^<>]*>)(.*?){0,1}$","gi");
 var re91 = "$2$3$4";
 var re92 = "$1";
 var re93 = "$5";
 var re94 = "$2–$4";
 
 var stepen = "<sup>\\\-?\\\d+</sup>";

//-----------------------------------------------------------------------------------------------------------------------------------------------------------------
 // вариант с выделением в подсветке всех\й строк\и(?) в интервалах чисел со степенями, если в строке их несколько:
 
/*  var re70s = jscriptRegExp("^(.*?[^\\\d]){0,1}(\\\d+)("+stepen+")((?:"+nbspEntity+"| )?-(?:"+nbspEntity+"| )?)(\\\d+)([^\\\d].*?){0,1}$","gi");
 var re71s = "$3$4$5";
 var re72s = "$1$2";
 var re73s = "$6";
 var re74s = "$3–$5"; 
 
 var re80s = jscriptRegExp("^(.*?[^\\\d]){0,1}(\\\d+"+stepen+")((?:"+nbspEntity+"| )?—(?:"+nbspEntity+"| )?)(\\\d+)([^\\\d].*?){0,1}$","gi");
 var re81s = "$2$3$4";
 var re82s = "$1";
 var re83s = "$5";
 var re84s = "$2–$4";
 
 var re90s = jscriptRegExp("^(.*?[^\\\d]){0,1}(\\\d+" +stepen+ ")((?:"+nbspEntity+"| )–|–(?:"+nbspEntity+"| )|(?:"+nbspEntity+"| )–(?:"+nbspEntity+"| ))(\\\d+)([^\\\d].*?){0,1}$","gi");
 var re91s = "$2$3$4";
 var re92s = "$1";
 var re93s = "$5";
 var re94s = "$2–$4"; */
 // ================================================================================
 //-----------------------------------------------------------------------------------------------------------------------------------------------------------------
 // вариант выделения в подсветке только одного тире-дефиса вместе с пробелами в интервалах чисел со степенями:
 
 var re70s = jscriptRegExp("^(.*?[^\\\d])??(\\\d+)("+stepen+")((?:"+nbspEntity+"| )?-(?:"+nbspEntity+"| )?)(\\\d+)([^\\\d].*?){0,1}$","gi");
 var re71s = "$4";
 var re72s = "$1$2$3";
 var re73s = "$5$6";
 var re74s = "–";

 var re80s = jscriptRegExp("^(.*?[^\\\d])??(\\\d+)("+stepen+")((?:"+nbspEntity+"| )?—(?:"+nbspEntity+"| )?)(\\\d+)([^\\\d].*?){0,1}$","gi");
 var re81s = "$4";
 var re82s = "$1$2$3";
 var re83s = "$5$6";
 var re84s = "–";

    var re90s = jscriptRegExp("^(.*?[^\\\d])??(\\\d+)(" +stepen+ ")((?:"+nbspEntity+"| )–|–(?:"+nbspEntity+"| )|(?:"+nbspEntity+"| )–(?:"+nbspEntity+"| ))(\\\d+)([^\\\d].*?){0,1}$","gi");
 var re91s = "$4";
 var re92s = "$1$2$3";
 var re93s = "$5$6";
 var re94s = "–";

/** The patterns in the original's order of application, with the captions of its InputBox. */
export const PATTERNS = [
  { re: re50, display: re51, suggestion: re54, prefix: re52, suffix: re53, caption: ['Единицы площади и объёма', 'Units of area and volume'], label: ['Замена:   ', 'Replacement:   '] },
  { re: re40a, display: re41a, suggestion: re44a, prefix: re42a, suffix: re43a, caption: ['Габариты', 'Dimensions'], label: ['Замена:   ', 'Replacement:   '] },
  { re: re40, display: re41, suggestion: re44, prefix: re42, suffix: re43, caption: ['Габариты', 'Dimensions'], label: ['Замена:   ', 'Replacement:   '] },
  { re: re30, display: re31, suggestion: re34, prefix: re32, suffix: re33, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30a, display: re31a, suggestion: re34a, prefix: re32a, suffix: re33a, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30b, display: re31b, suggestion: re34b, prefix: re32b, suffix: re33b, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30c, display: re31c, suggestion: re34c, prefix: re32c, suffix: re33c, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30d, display: re31d, suggestion: re34d, prefix: re32d, suffix: re33d, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30e, display: re31e, suggestion: re34e, prefix: re32e, suffix: re33e, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30f, display: re31f, suggestion: re34f, prefix: re32f, suffix: re33f, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30g, display: re31g, suggestion: re34g, prefix: re32g, suffix: re33g, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30h, display: re31h, suggestion: re34h, prefix: re32h, suffix: re33h, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30i, display: re31i, suggestion: re34i, prefix: re32i, suffix: re33i, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30j, display: re31j, suggestion: re34j, prefix: re32j, suffix: re33j, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30k, display: re31k, suggestion: re34k, prefix: re32k, suffix: re33k, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30l, display: re31l, suggestion: re34l, prefix: re32l, suffix: re33l, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30m, display: re31m, suggestion: re34m, prefix: re32m, suffix: re33m, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re30n, display: re31n, suggestion: re34n, prefix: re32n, suffix: re33n, caption: ['Числа через слэш', 'Numbers with a slash'], label: ['Предлагается замена:      ', 'Proposed replacement:      '] },
  { re: re70, display: re71, suggestion: re74, prefix: re72, suffix: re73, caption: ['Дефис', 'Hyphen'], label: ['Предлагается замена:                     ', 'Proposed replacement:                     '] },
  { re: re80, display: re81, suggestion: re84, prefix: re82, suffix: re83, caption: ['Тире', 'Dash'], label: ['Предлагается замена:                     ', 'Proposed replacement:                     '] },
  { re: re90, display: re91, suggestion: re94, prefix: re92, suffix: re93, caption: ['Пробел', 'Space'], label: ['Предлагается замена:                     ', 'Proposed replacement:                     '] },
  { re: re70s, display: re71s, suggestion: re74s, prefix: re72s, suffix: re73s, caption: ['Дефис между числами', 'Hyphen between numbers'], label: ['Предлагается замена:                     ', 'Proposed replacement:                     '] },
  { re: re80s, display: re81s, suggestion: re84s, prefix: re82s, suffix: re83s, caption: ['Тире между числами', 'Dash between numbers'], label: ['Предлагается замена:                     ', 'Proposed replacement:                     '] },
  { re: re90s, display: re91s, suggestion: re94s, prefix: re92s, suffix: re93s, caption: ['Короткое тире с пробелами между чисел', 'En dash with spaces between numbers'], label: ['Предлагается замена:                     ', 'Proposed replacement:                     '] },
];
