// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/62_Поиск (без замены) последовательностей 'буква пробел буква пробел...'.js
// Searches - without replacing anything - for sequences "letter space letter space letter..." of
// at least three single letters (letter-spaced words typed with spaces).
// Each run starts at the end of the selection (a caret: at the caret) and goes on to the end of the
// book; the first hit is selected and its description is shown in the status bar (the
// descriptions stay in Russian, as the expressions are about Russian text). The engine is
// regexp-set.js, a faithful port of the original's (see there).
// Differences: the hit is selected exactly where the expression matched (the original moved
// IE's selection by characters and was off after inline pictures and soft hyphens), and the view
// scrolls it into sight in place of the original's own scrolling; an inline picture selected as
// text is searched past like text (the original refused a clicked picture, a "Control"
// selection, but selected a hit on a picture as text, which the editor cannot tell apart).
// The original's notice, kept as written (FR-029):
// Скрипт «62_Поиск (без замены) последовательностей 'буква пробел буква пробел...'» для редактора Fiction Book Editor (FBE).
// Версия 5.1
// Автор Sclex
import { createRegExpSet, searchRegExpSet } from './regexp-set.js';

// The original's list of expressions, kept as written (with its instructions and comments).
function init({ addMacros, addRegExp, tagRegExp }) {
  // ТУТ НАДО НАСТРОИТЬ СПИСОК МАКРОСОВ
  // addMacros("<имя>","регэксп");
  // Допустимые символы в имени: от "a" до "я", от "a" до "z", и символы "/","?","-","_"
  // В регэкспе можно использовать макросы, определенные до этого.

  // ТУТ НАДО НАСТРОИТЬ СПИСОК РЕГЭКСПОВ
  // Каждый регэксп настраивается строкой такого формата:
  //  addRegExp("регэксп","ключи","описание","в каких тегах искать","лимит для просмотра назад");
  // Слеши \ в регэкспе надо удвоить
  // Если регэксп содержит прямые кавычки, перед ними надо поставить слеш: \"
  // (этот слеш перед кавычкой не надо удваивать)
  // "Ключ" (пока) поддерживается только один:
  //   i – поиск без учета регистра (case Insensitive)
  // По умолчанию поиск происходит с учетом регистра
  // "Описание" – это текст, который выведется в строке статуса, когда
  //  по регэкспу будет что-то найдено
  // "В каких тегах искать" – параметр должен содержать сочетания
  //  "плюс или минус, потом имя элемента", разделенные пробелом.
  //  К примеру, если этот параметр имеет значение "+poem -stanza +title",
  //  то скрипт будет искать по регэкспу только в абзацах P,
  //  вложенных в <poem> и в <title>, но при этом не вложенных в <stanza>.
  //  Указывать имена инлайн-тегов не разрешено.
  // "Лимит для просмотра назад" – устанавливает максимальную длину подстроки,
  //  которая может быть найдена конструкцией (?<= ...) или (?= ...) данного
  //  регэкспа. Чем меньше значение данного параметра, тем быстрее будет 
  //  выполняться поиск. Чтобы искать без ограничения длины (самый медленный поиск),
  //  можно прописать значение 0 или undefined, или вообще не задавать параметр.
  // Пример:
  //  addRegExp("\\d-\\d","","Найдено: две цифры с дефисом между ними.");
  //  addRegExp("\"","","Найдено: прямая кавычка.");
  //  tagRegExp("(?<![а-яё])пего(?![а-яё])","i","Найдено: слово \"пего\" (\"него\" с опечаткой).");
  // Если надо, чтобы найденный текст не выделялся, а просто курсор стал
  // в позицию перед этим найденным текстом, используйте конструкцию (?= ... )
  //  addRegExp("(?=\")","","Найдено: прямая кавычка.");
  // Конструкции look behind, т.е. (?<! ...) и (?<= ...) разрешены только
  //   только в начале регэкспа и проверяются независимо от остальной части
  //   регэкспа. То есть (?<=а)б|в найдет не "б, перед которым а" либо "в",
  //   а "{б или в}, перед которым а".
  //  addRegExp("","i","Задайте список регэкспов, отредактировав скрипт в текстовом редакторе (кодировка UTF-8). Инструкция – в скрипте.");

  // Когда будете задавать свои регэкспы, сотрите или закомментируйте предыдущую строку.
  //   tagRegExp("(?<=[а-яё])<strong>[а-яё]+?</strong>","i","Найдено: курсив в слове.");
  //   tagRegExp("<strong>[а-яё]+?</strong>(?=[а-яё])","i","Найдено: курсив в слове.");
  // Команда   tagRegExp с аналогичным форматом ищет текст с учетом тегов.
  // В регэкспах команды   tagRegExp можно использовать макросы (см. выше).
  // Например: можно определить макрос строкой
  //   addMacros("<открывающий-emphasis-или-strong>","<emphasis>|<strong>");
  // И потом использовать его:
  //  tagRegExp("а<открывающий-emphasis-или-strong>б","i","Найдено: аб.");
  // Работают предопределенные макросы <emphasis>, </emphasis>, <strong>, </strong>,
  //   <sup>, </sup>, <sub>, </sub>, <strikethrough>, </strikethrough>,
  //   <code>, </code>, <любые-теги>

   addRegExp("(?<![a-zа-яё])[a-zа-яё]([\\x20\\xA0]+[a-zа-яё]){2,}(?![a-zа-яё])","i",'Найдено: последовательность "буква пробел буква пробел буква...".');

 }

export default async function run(ctx) {
  const set = createRegExpSet();
  init(set);
  await searchRegExpSet(ctx, set, { image: '~~~', decodeShy: true });
}
