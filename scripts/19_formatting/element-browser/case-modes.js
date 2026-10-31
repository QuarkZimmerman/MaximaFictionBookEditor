// Case changes of "Обзор и превращение элементов" (FictionBook Editor 2.7.9): the original's
// context menu of titles and subtitles, changeCaseInOneP of HTML/Обзор и превращение элементов -
// фрейм 2.html. The expressions below are the original's lines, copied as written. The original
// changed each text node of the element in document order (here: each text run of the element,
// the state carried from one run to the next as the original carried it from node to node) or,
// for the two "every word" modes, rewrote the element's innerHTML with its expressions (here the
// same notation through lib/legacy-html.js, so the expressions run verbatim and formatting stays).

import { serializeInline, parseInline } from './lib/legacy-html.js';

// window.external.GetNBSP() - the editor's non-breaking space.
var nbspChar = '\u00A0';

var letterRE=new RegExp(
  "[0-9а-яёa-zÀÁÂÃÄÅÆÇÈÉÊËÌÍÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæç"+
  "èéêëìíîïðñòóôõöøùúûüýþÿĀāăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚ"+
  "ěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋ"+
  "ŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻż"+
  "ŽžſƏƒƠơƯưƷǤǥǦǧǨǩǪǫǮǯǺǻǼǽǾǿȘșȚțȨȩəʒΆΈΉΊΌΎΐΑΒΓΔΕΖΗΘ"+
  "ΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊ"+
  "ϋόύώЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏѐђѓєѕіїјљњћќѝўџҐґҒғҖҗҚқҜҝҢңҮү"+
  "ҰұҲҳҸҹҺһӘәӨөḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤ"+
  "ḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕ"+
  "ṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆ"+
  "ẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẚẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻ"+
  "ẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬ"+
  "ửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧ"+
  "ἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠ"+
  "ὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓ"+
  "ᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼῂῃῄῆῇῈΈῊΉ"+
  "ῌῐῑῒΐῖῗῘῙῚΊῠῡῢΰῤῥῦῧῨῩῪΎῬῲῳῴῶῷῸΌῺΏῼ]","i");

var letterRegExp=new RegExp("[abcdefghijklmnopqrstuvwxyzßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿāăąćĉċčďđē"+
 "ĕėęěĝğġģĥħĩīĭįıĵķĸĺļľŀłńņňŉŋōŏőŕŗřśŝşšţťŧũūŭůűųŵŷźżžſƀƃƅƈƌƍƒƕƙƚƛƞơƣƥƨƫƭ"+
 "ưƴƶƹƺƽǅǆǈǉǋǌǎǐǒǔǖǘǚǜǝǟǡǣǥǧǩǫǭǯǰǲǳǵǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟȡȣȥȧȩȫȭȯȱȳȴȵȶȷȸȹȼȿ"+
 "ɀɂɇɉɋɍɏɐɑɒɓɔɕɖɗɘəɚɛɜɝɞɟɠɡɣɤɥɦɧɨɩɫɬɭɮɯɰɱɲɳɵɷɸɹɺɻɼɽɾɿʂʃʄʅʆʇʈʉʊʋʌʍʎʐʑʒʓʚʝʞ"+
 "ʠʣʤʥʦʧʨʩʪʫʮʯͣͤͥͦͧͨͩͪͫͬͭͮͯͱͳͷΐάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώϙϛϝϟϡϣϥϧϩϫϭϯϸϻабвгдеж"+
 "зийклмнопрстуфхцчшщъыьэюяѐёђѓєѕіїјљњћќѝўџѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҧ"+
 "ҩҫҭүұҳҷҹһҽҿӂӄӆӈӊӌӎӏӑӓӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթ"+
 "ժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆᏸᏹᏺᏻᏼᏽᤰᤱᤲᤳᤴᤵᤶᤷᤸᲀᲁᲂᲃᲄᲅᲆᲇᲈᴂᴈᴉᴑᴒᴓᴔᴖᴗᴝᴞᴟᵢᵣᵤᵥᵦᵧᵨᵩᵪᵫᵬᵭᵮᵯᵰᵱᵲᵳᵴᵵᵶᵷ"+
 "ᵹᵺᵼᵽᵿᶀᶁᶂᶃᶄᶅᶆᶇᶈᶉᶊᶋᶌᶍᶎᶏᶐᶑᶒᶓᶔᶕᶖᶗᶘᶙᶚ᷊ᷓᷔᷕᷖᷗᷘᷙᷚᷜᷝᷠᷣᷤᷥᷦᷧᷨᷩᷪᷫᷬᷭᷮᷯᷰᷱᷲᷳᷴḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡ"+
 "ḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕẖẗẘẙẚẛẜẝẟạảấầẩẫậắằẳẵặẹ"+
 "ẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὐὑὒὓὔὕὖὗὠὡ"+
 "ὢὣὤὥὦὧὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾐᾑᾒᾓᾔᾕᾖᾗᾠᾡᾢᾣᾤᾥᾦᾧᾰᾱᾲᾳᾴᾶᾷῂῃῄῆῇῐῑῒΐῖῗῠῡῢΰῤῥῦῧῲῳῴῶῷⁱⁿₐₑₒ"+
 "ₓₔₕₖₗₘₙₚₛₜ℩ↄ⒜⒝⒞⒟⒠⒡⒢⒣⒤⒥⒦⒧⒨⒩⒪⒫⒬⒭⒮⒯⒰⒱⒲⒳⒴⒵ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⰰⰱⰲⰳⰴⰵⰶⰷⰸⰹⰺⰻⰼⰽⰾⰿ"+
 "ⱀⱁⱂⱃⱄⱅⱆⱇⱈⱉⱊⱋⱌⱍⱎⱏⱐⱑⱒⱓⱔⱕⱖⱗⱘⱙⱚⱛⱜⱝⱞⱡⱥⱦⱨⱪⱬⱱⱳⱴⱶⱷⱸⱹⱺⱼⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃ"+
 "ⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳬⳮⳳⴀⴁⴂⴃⴄⴅⴆⴇⴈⴉⴊⴋⴌⴍⴎⴏⴐⴑⴒⴓⴔⴕⴖⴗⴘⴙⴚⴛⴜⴝⴞⴟⴠⴡⴢⴣⴤⴥⴧⴭꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩ"+
 "ꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛꜣꜥꜧꜩꜫꜭꜯꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝱꝲꝳꝴꝵꝷꝸꝺꝼꝿꞁꞃꞅꞇꞌꞎꞑꞓꞔꞕꞗꞙꞛꞝꞟꞡ"+
 "ꞣꞥꞧꞩꞵꞷꬰꬱꬲꬳꬴꬵꬶꬷꬸꬹꬺꬻꬼꬽꬾꬿꭀꭁꭂꭃꭄꭅꭇꭈꭉꭊꭋꭌꭍꭎꭏꭐꭑꭒꭓꭔꭕꭖꭗꭘꭙꭚꭠꭡꭢꭣꭤꭰꭱꭲꭳꭴꭵꭶꭷꭸꭹꭺꭻꭼꭽꭾꭿꮀꮁꮂꮃꮄꮅꮆꮇꮈꮉꮊ"+
 "ꮋꮌꮍꮎꮏꮐꮑꮒꮓꮔꮕꮖꮗꮘꮙꮚꮛꮜꮝꮞꮟꮠꮡꮢꮣꮤꮥꮦꮧꮨꮩꮪꮫꮬꮭꮮꮯꮰꮱꮲꮳꮴꮵꮶꮷꮸꮹꮺꮻꮼꮽꮾꮿａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ"+
 "ШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяӘәӚӛӜӝӞӟӠӡӢӣӤӥӦӧӨөӪӫӬӭӮӯӰӱӲӳӴӵӶӷӸӹӺӻೀುೂೃೄ೅ೆೇೈ೉ೊೋೌ್೎೏"+
 "೐೑೒೓೔ೕೖ೗೘೙೚೛೜ೝೞ೟ೠೡೢೣ೤೥೦೧೨೩೪೫೬೭೮೯೰ೱೲᣀᣁᣂᣃᣄᣅᣆᣇᣈᣉᣊᣋᣌᣍᣎᣏᣐᣑᣒᣓᣔᣕᣖᣗᣘᣙᣚᣛᣜᣝᣞᣟ"+
 "abcdefghijklmnopqrstuvwxyz]","i");

var stEm="(?:</?(?:strong|em|strike)>)*";

var re3=new RegExp("<[^>]*>|&(gt|lt|amp);"
             +"|"+
             "(\\d"+stEm+"(( |"+nbspChar+"|&nbsp;)"+stEm+")+(г"+stEm+"(г"+stEm+")?"+
             "|"+
             "в"+stEm+"(в"+stEm+")?)\\.)"+
             "|"+
             "(([IVXLCDM]"+stEm+")+[-–—]"+stEm+")?(([IVXLCDM]"+stEm+")+(( |"+nbspChar+"|&nbsp;)"+stEm+")+в("+stEm+"в)?"+stEm+"\\.)"+
             "|"+
             "&nbsp;"+
             "|"+
             ".(?=[^<]*(<|$))","gi"); //ошибка в этой строке

var re4=new RegExp("^\\d"+stEm+"(( |"+nbspChar+"|&nbsp;)"+stEm+")+(г"+stEm+"(г"+stEm+")?|в"+stEm+"(в"+stEm+")?)\\.$","i");

var re5=new RegExp("^(([IVXLCDM]"+stEm+")+[-–—]"+stEm+")?([IVXLCDM]"+stEm+")+(( |"+nbspChar+"|&nbsp;)"+stEm+")+в("+stEm+"в)?"+stEm+"\\.$","i");

function replaceWithUpperCase(full_match) {
  return full_match.toUpperCase();
}

// The two lists the original's .js handed to its dialog, as written there:
// «Cписок коротких слов, которые будут делаться маленькими буквами, когда будет запущен пункт
// меню "Первую букву каждого слова (кроме исключений) сделать большой, остальные – маленькими"»
// (the short words made lower case by that mode) and «Cписок аббревиатур, которые будут делаться
// большими буквами...» (the abbreviations made upper case by it).
export const SHORT_WORDS =
  'им.|без|в|вне|во|для|до|за|из|из-за|из-под|к|ко|на|над|о|об|обо|от|по|под|при|про|с|со|у|а|да|и|или|не|ни|но|б|бы|ж|же|ли|a|an|and|at|but|by|for|from|in|nor|of|on|or|the|to';

const ABBREVIATION_WORDS =
  'АБС|АЗЛК|АЗС|АКБ|АКМ|АНБ|АССР|АСТ|АЭС|БАД|БАМ|ББК|БИК|БМП|БПЛА|БССР|БТР' +
  '|ВАЗ|ВАСХНИЛ|ВАСХНИЛ|ВВП|ВВС|ВГИК|ВДВ|ВДНХ|ВИЧ' /* +|ВКП(б) */ + '|ВЛКСМ|ВМС|ВМФ|ВНД' +
  '|ВОЗ|ВПК|ВУЗ|ВЦИК|ВЦСПС|ГАЗ|ГАИ|ГДР|ГИБДД|ГК|ГОСТ|ГТО|ГУЛАГ|ГЭС|ГЭС|ДВС' +
  '|ДНК|ДОСААФ|ДЮСШ|ЕГЭ|ЕС|ЕЭС|ЖБИ|ЖЭК|ЗАГС|ЗАО|ЗИЛ|ЗКС|ЗРК|ИБП|ИНН|ИП|КАСКО' +
  '|КГБ|КНДР|КНР|КоАП|КПД|КПРФ|КПСС|ЛГБТ|ЛДПР|ЛЭП|МАГАТЭ|МАЗ|МБР|МВД|МВФ|МГИМО' +
  '|МГУ|МДФ|МИД|МИСИ|МИФИ|МКАД|МКС|ММВБ|МТС|МФЦ|МЧС|НАТО|НДФЛ|НИИ|НИОКР|НКВД' +
  '|НКО|НЭП|ОБСЕ|ОБСЕ|ОБХСС|ОБЭП|ОКАТО|ОКВЭД|ОКД|ОКП|ОКПО|ОМОН|ООН|ООО|ОПГ' +
  '|ОСАГО|ОТК|ПВО|ПВХ|ПДД|ПНД|ППС|ПТС|ПТУ|ПУЭ|РАМН|РАН|РБК|РВСН|РГБ|РЖД|РККА' +
  '|РНК|РПГ|РПЦ|РСДРП' /* +|РСДРП(б) */ + '|РУВД|РФ|РЭБ|РЭР|СВ|СВР|СВЧ|СЗ|СИЗ|СИЗО|СКА' +
  '|СМЕРШ|СМИ|СНГ|СНиП|СНТ|СПбГУ|СС|ССР|СССР|СТС|США|СЭВ|СЭС|ТАСС|ТВД|ТТН' +
  '|ТТХ|ТЭЦ|УАЗ|УВД|УДК|УЗО|УПК|УССР|ФБР|ФМС|ФРГ|ФСБ|ФСБ|ФСИН|ФССП|ЦК|ЦНС' +
  '|ЦРУ|ЦСКА|ЧК|ЧМ|ЧП|ЭВМ|ЭКГ|ЮАР|ЮВ|ЮЗ|ЮНЕСКО';

/** I, II, … MMMMM: the original listed the Roman numerals 1 to 5000 after the words, written out. */
function romanNumerals(last) {
  const steps = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  const out = [];
  for (let n = 1; n <= last; n += 1) {
    let rest = n;
    let s = '';
    for (const [value, letters] of steps) {
      while (rest >= value) {
        s += letters;
        rest -= value;
      }
    }
    out.push(s);
  }
  return out;
}

export const ABBREVIATURES = `${ABBREVIATION_WORDS}|${romanNumerals(5000).join('|')}`;

// The original built these two in changeCaseInOneP for every element; here once.
let exclusionExpressions = null;
function exclusions() {
  if (exclusionExpressions) return exclusionExpressions;
  var shortWords = SHORT_WORDS;
  var abbreviatures = ABBREVIATURES;
 var shortWords2=shortWords.replace(/([^-|а-яёa-z])/,"\\$1").replace(/(\\.|[^\|\\])(?=[^\|])/gi,"$1"+stEm);
 var re6=new RegExp("^(?:(?: |"+nbspChar+"|&nbsp;)"+stEm+")*(?:(?:\\d"+stEm+")+\\."+stEm+"(?: |"+nbspChar+"|&nbsp;)*)?(?:(?:(?: |"+nbspChar+"|&nbsp;)"+stEm+")*(?:…|\\."+stEm+"\\."+stEm+"\\.)?"+stEm+"(?:\"|«)?"+stEm+"("+shortWords2+")"+stEm+"(?=($|\\.|,|!|\\?|;| |"+nbspChar+"|&nbsp;)))"+
                    "|"+
                    "(( |"+nbspChar+"|&nbsp;)"+stEm+"("+shortWords2+")"+stEm+"(?=($|\\.|,|!|\\?|;| |"+nbspChar+"|&nbsp;)))","ig");
 var abbreviatures2=abbreviatures.replace(/([^-|а-яёa-z])/,"\\$1").replace(/(\\.|[^\|\\])(?=[^\|])/gi,"$1"+stEm);
 var re7=new RegExp("((^|( |"+nbspChar+"|&nbsp;))"+stEm+"("+abbreviatures2+")"+stEm+"(?=($|\\.|,|!|\\?|;| |"+nbspChar+"|&nbsp;)))","ig");
  exclusionExpressions = { re6, re7 };
  return exclusionExpressions;
}

/** The case modes of the original's context menu, in its order. */
export const CASE_MODES = [
  'onlyFirstBig',
  'firstBigAndAfterFirstDotBig',
  'firstLetterBigAndAfterEveryDotBigToo',
  'firstLetterBigAndAfterSymbolsBigToo',
  'secondWordBigLetters',
  'nthWordBigLetters',
  'allBig',
  'allSmall',
  'wordFirstLetterBig',
  'wordFirstLetterBigWithExclusions',
];

/**
 * The inline content of one element (a title line or a subtitle) with its case changed by
 * `caseFlag` (one of CASE_MODES); `numberOfWordToProcess` for 'nthWordBigLetters'.
 */
export function changeCaseOfContent(content, caseFlag, numberOfWordToProcess) {
  if (caseFlag === 'wordFirstLetterBig' || caseFlag === 'wordFirstLetterBigWithExclusions') {
    var needsToMakingBig = true;
    function wordFirstLetterBigFunction(full_match) {
      if (full_match.charAt(0)=="<") return full_match;
      if (full_match.search(/&(gt|lt|amp);/)==0) return full_match;
      if (full_match.search(/&nbsp;/)==0) {
        needsToMakingBig=true;
        return full_match;
      }
      if (full_match.search(re4)==0) return full_match.toLowerCase();
      if (full_match.search(re5)==0) return full_match.toUpperCase().replace(/в((<\/?strong>|<\/?em>)*)\.$/i,"в$1.").replace(/в((<\/?strong>|<\/?em>)*)в((<\/?strong>|<\/?em>)*)\.$/i,"в$1в$3.").replace(/&NBSP;/ig,"&nbsp;");
      if (needsToMakingBig && full_match.search(letterRegExp)>=0) {
        needsToMakingBig=false;
        return full_match.toUpperCase();
      }
      if (full_match.search(letterRegExp)==-1) needsToMakingBig=true;
      if (full_match=="-") needsToMakingBig=false;
      return full_match.toLowerCase();
    }
    function wordFirstLetterBigExclusionsFunction(full_match,group1) {
      if (group1) return full_match;
      return full_match.toLowerCase();
    }
    function wordFirstLetterBigAbbrFunction(full_match) {
      return full_match.toUpperCase().replace(/&NBSP;/ig,"&nbsp;");
    }
    const extras = [];
    let html = serializeInline(content, extras).replace(re3, wordFirstLetterBigFunction);
    if (caseFlag === 'wordFirstLetterBigWithExclusions') {
      const { re6, re7 } = exclusions();
      html = html.replace(re6, wordFirstLetterBigExclusionsFunction).replace(re7, wordFirstLetterBigAbbrFunction);
    }
    return parseInline(html, extras);
  }

  var alreadyMadeFirstLetterBig=false;
  var alreadyMetLetterAfterFirstDot=false;
  var alreadyMetDotButNotMetLetter=false;
  var alreadyMetLetterAfterDot=false;
  var xState=1;
  var currWordNum=0;
  var i;
  if (caseFlag=="secondWordBigLetters") numberOfWordToProcess=2;
  return (content ?? []).map((item) => {
    if (item.type !== 'text') return item;
    var s1 = item.text ?? '';
    var s2;
    if (caseFlag=="allSmall") s2=s1.toLowerCase();
    if (caseFlag=="allBig") s2=s1.toUpperCase();
    if (caseFlag=="onlyFirstBig") s2=s1.toLowerCase();
    if (caseFlag=="onlyFirstBig" && !alreadyMadeFirstLetterBig) {
      if (s1.charAt(0)!="«" && s1.charAt(0)!='"')
        s2=s1.charAt(0).toUpperCase()+s1.substring(1).toLowerCase();
      else
        s2=s1.substring(0,1)+s1.charAt(1).toUpperCase()+s1.substring(2).toLowerCase();
      alreadyMadeFirstLetterBig=true;
    }
    if (caseFlag=="firstBigAndAfterFirstDotBig") {
      s2=s1.toLowerCase();
      for (i=0; i<s1.length; i++) {
        if (!alreadyMadeFirstLetterBig && s2.charAt(i)!="«" && s2.charAt(i)!='"') {
          s2=s2.substring(0,i)+s2.charAt(i).toUpperCase()+s2.substring(i+1);
          alreadyMadeFirstLetterBig=true;
        }
        else {
          if (alreadyMetDotButNotMetLetter && !alreadyMetLetterAfterFirstDot && s2.charAt(i).search(letterRE)>=0) {
            s2=s2.substring(0,i)+s2.charAt(i).replace(letterRE,replaceWithUpperCase)+s2.substring(i+1);
            alreadyMetLetterAfterFirstDot=true;
          }
          if (!alreadyMetDotButNotMetLetter && s2.charAt(i)==".") {
            alreadyMetDotButNotMetLetter=true;
            alreadyMetLetterAfterDot=false;
          }
        }
      }
    }
    if (caseFlag=="firstLetterBigAndAfterEveryDotBigToo") {
      s2=s1.toLowerCase();
      for (i=0; i<s1.length; i++) {
        if (xState==1 && s2.charAt(i).search(letterRE)>=0) {
          s2=s2.substring(0,i)+s2.charAt(i).toUpperCase()+s2.substring(i+1);
          xState=2;
        }
        else {
          if (s2.charAt(i)==".") xState=1
          else if (s2.charAt(i)==" " || s2.charAt(i)==nbspChar)
           {
            if (xState==1 && s2.charAt(i).search(letterRE)>=0) {
              s2=s2.substring(0,i)+s2.charAt(i).toUpperCase()+s2.substring(i+1);
            }
           }
        }
      }
    }
    if (caseFlag=="firstLetterBigAndAfterSymbolsBigToo") {
      s2=s1.toLowerCase();
      for (i=0; i<s1.length; i++) {
        if (xState==1 && s2.charAt(i).search(letterRE)>=0) {
          s2=s2.substring(0,i)+s2.charAt(i).toUpperCase()+s2.substring(i+1);
          xState=2;
        }
        else {
          if (s2.charAt(i)=="." || s2.charAt(i)=="?" || s2.charAt(i)=="!") xState=1
          else if (s2.charAt(i)==" " || s2.charAt(i)==nbspChar)
           {
            if (xState==1 && s2.charAt(i).search(letterRE)>=0) {
              s2=s2.substring(0,i)+s2.charAt(i).toUpperCase()+s2.substring(i+1);
            }
           }
        }
      }
    }
    if (caseFlag=="secondWordBigLetters" || caseFlag=="nthWordBigLetters") {
      s2=s1;
      for (i=0; i<s1.length; i++) {
        // xState 1: no word yet, or not a letter after a word; 2: inside a word; 3: inside the
        // word to put in upper case; 4: after it
        if (xState==3 && s2.charAt(i).search(letterRE)<0) xState=4;
        else if (xState==1 && s2.charAt(i).search(letterRE)>=0) {
          currWordNum++;
          if (currWordNum<numberOfWordToProcess) xState=2;
          else xState=3;
        }
        else if (xState==2 && s2.charAt(i).search(letterRE)<0) xState=1;
        if (xState==3) s2=s2.substring(0,i)+s2.charAt(i).replace(letterRE,replaceWithUpperCase)+s2.substring(i+1);
      }
    }
    return s2 !== undefined && s2 !== s1 ? { ...item, text: s2 } : item;
  });
}
