// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/06_Разметить заголовки разделов либо подзаголовки, найденные по регэкспу... (расширенная версия).js
// with its dialog HTML/Разметить заголовки разделов либо подзаголовки, найденные по регэкспу
// (расширенная версия) - задание параметров.htm, which held the whole logic.
// Marks up section titles or subtitles found by a regular expression. In every body except the
// notes and comments bodies, each paragraph of a section that matches the expression (and the
// dialog's conditions: entirely bold, entirely italic, right after a title or subtitle, between
// empty lines, the first non-empty paragraph of a section without a title, not longer than N
// characters) becomes, as chosen, the title of a new section that starts there (taking up to 3
// paragraphs before and after it into the title), or a subtitle (with up to 3 paragraphs before
// and after it). The engine that cuts the sections is in section-split.js (shared with 07,
// identical copies); this file holds the dialog's conditions, as written, on the legacy
// inline-HTML notation of lib/legacy-html.js.
//
// Differences from the original (docs/scripting/notes-279-drafts/13.md):
// - the modeless dialog, which stayed open for further runs, is a form; its two rows of buttons
//   ("Разметить заголовки" / "... и выйти", "Разметить подзаголовки" / "... и выйти") are the
//   choice "Разметить" and OK; its ready-made patterns are the presets of the pattern field,
//   whose validity check replaces the original's message about a pattern that does not compile;
// - a part of a section left with its title only, and a new section with nothing after its
//   title, get an <empty-line/>; the first new section keeps the section's id when nothing
//   precedes it (section-split.js);
// - an empty line (or a paragraph of spaces) chosen as a subtitle stays an empty line: 2.7.9
//   wrote an empty subtitle, which it saved as an <empty-line/>; it is counted as in 2.7.9;
// - the caret is left where it was (the original put it at the start of the book).
// The original's notice, kept as written (FR-029):
//Скрипт «Разметить заголовки разделов либо подзаголовки, найденные по регэкспу»
//Автор Sclex
 // Нижеследующая команда задает список необычных пробелов,
 // которые в заголовках и подзаголовках должны обрабатываться
 // наравне с обычными пробелами:
import { serializeInline } from './lib/legacy-html.js';
import { PRESETS } from './presets.js';
import { applyToBodies, className, isLineEmpty, isMarker, isP, markerItem, splitAtMarkers, testText } from './section-split.js';

const VERSION_NUM = '3.1';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// The unusual spaces the original treated as ordinary spaces.
const unusualSpaces =
  String.fromCharCode(8194) +
  String.fromCharCode(8195) +
  String.fromCharCode(8196) +
  String.fromCharCode(8197) +
  String.fromCharCode(8198) +
  String.fromCharCode(8239) +
  String.fromCharCode(8201) +
  String.fromCharCode(8202);
const unusualSpacesRegExp = new RegExp(`[${unusualSpaces}]`, 'g');

// FictionBook Editor showed the non-breaking space as a configurable character (GetNBSP); the
// document model holds the real U+00A0.
const nbspChar = ' ';
const char160 = String.fromCharCode(160);
const nbspRegExp = new RegExp(`&nbsp;|${nbspChar}`, 'ig');

// The dialog's checks (evalChecksOfBoldAndItalic), as written, on a paragraph's legacy HTML.
const emptyLineRegExp = new RegExp(`^( | |&nbsp;|${nbspChar})*?$`, 'i');
const removeLinksRE = new RegExp('<A( [^<>]*)?>.*?</A>', 'gi');
const re0 = new RegExp('<STRONG>(((?!</?STRONG>).)*)</STRONG>', 'ig');
const re1 = new RegExp('</?[^>]*>', 'ig');
const re2 = new RegExp(` |&nbsp;|${nbspChar}`, 'g');
const re5 = new RegExp('<EM>(((?!</?EM>).)*)</EM>', 'ig');
const re6 = new RegExp('</?[^>]*>', 'ig');

function isLineWithoutLinksEmpty(html) {
  return emptyLineRegExp.test(html.replace(removeLinksRE, ''));
}

function isParagraphEntirelyBold(html) {
  if (isLineWithoutLinksEmpty(html)) return false;
  let myHtml = html.replace(removeLinksRE, '');
  let searchResult = re0.test(myHtml);
  while (searchResult) {
    myHtml = myHtml.replace(re0, '');
    searchResult = re0.test(myHtml);
  }
  myHtml = myHtml.replace(re1, '');
  return myHtml === '' || myHtml.replace(re2, '') === '';
}

function isParagraphEntirelyItalic(html) {
  if (isLineWithoutLinksEmpty(html)) return false;
  let myHtml = html.replace(removeLinksRE, '');
  let searchResult = re5.test(myHtml);
  while (searchResult) {
    myHtml = myHtml.replace(re5, '');
    searchResult = re5.test(myHtml);
  }
  myHtml = myHtml.replace(re6, '');
  return myHtml === '' || myHtml.replace(re2, '') === '';
}

/** innerHTML of a paragraph; an empty one got a non-breaking space first, as in the original. */
function innerHTML(item) {
  const html = item.type === 'empty-line' ? '' : serializeInline(item.content ?? [], []);
  return html === '' ? '&nbsp;' : html;
}

/** The original's test of a paragraph against the conditions of the dialog. */
function fits(item, prev, next, wereOnlyEmptyLines, o, mode) {
  if (!isP(item) || isMarker(item)) return false;
  const cls = className(item);
  if (mode === 'titles' ? cls === 'subtitle' : cls !== '') return false;
  if (o.inEmptyLines && !(prev && next && isP(prev) && isP(next) && isLineEmpty(prev) && isLineEmpty(next))) return false;
  if (o.afterTitle && !(prev && /^(sub)?title$/i.test(className(prev)))) return false;
  const html = innerHTML(item);
  if (o.bold && !isParagraphEntirelyBold(html)) return false;
  if (o.italic && !isParagraphEntirelyItalic(html)) return false;
  if (o.inUntitledSection && !wereOnlyEmptyLines) return false;
  const text = testText(html).replace(nbspRegExp, char160).replace(unusualSpacesRegExp, ' ');
  return text.length <= o.maxLength && text.search(o.regExp) >= 0;
}

/** A paragraph turned into a subtitle; an empty line stays one (2.7.9 saved it as one). */
function toSubtitle(item) {
  if (item.type !== 'p' || isLineEmpty(item)) return item;
  return { ...item, type: 'subtitle' };
}

/**
 * processSectionAndSubsections of the original: the sub-sections first, then the section's own
 * children. Returns the sections that replace `section` ([section] when nothing changed).
 */
function processSection(section, o, stats) {
  const content = section.content ?? [];
  if (content.some((c) => c.type === 'section')) {
    let changed = false;
    const next = [];
    for (const child of content) {
      if (child.type !== 'section') {
        next.push(child);
        continue;
      }
      const pieces = processSection(child, o, stats);
      if (pieces.length !== 1 || pieces[0] !== child) changed = true;
      next.push(...pieces);
    }
    return changed ? [{ ...section, content: next }] : [section];
  }
  const items = [...content];
  let changed = false;
  let wereOnlyEmptyLines = true;
  let i = 0;
  while (i < items.length) {
    const ptr = items[i];
    if (!fits(ptr, items[i - 1], items[i + 1], wereOnlyEmptyLines, o, o.mode)) {
      if (!isLineEmpty(ptr)) wereOnlyEmptyLines = false;
      i += 1;
      continue;
    }
    changed = true;
    // The empty paragraphs and elements in front of the first paragraph of a section without a
    // title are removed.
    while (o.inUntitledSection && i > 0 && isLineEmpty(items[i - 1])) {
      items.splice(i - 1, 1);
      i -= 1;
    }
    if (o.mode === 'titles') {
      let begin = i;
      let end = i;
      if (o.captureBefore > 0) {
        let k = 1;
        let whileFlag = true;
        while (whileFlag) {
          const prev = items[begin - 1];
          if (prev && isP(prev) && !isMarker(prev)) {
            if (className(prev) === 'subtitle') break;
            begin -= 1;
          } else whileFlag = false;
          k += 1;
          if (k > o.captureBefore) whileFlag = false;
        }
      }
      stats.count += 1;
      items.splice(begin, 0, markerItem('begin', stats.count));
      end += 1;
      if (o.captureAfter > 0) {
        let k = 1;
        let whileFlag = true;
        while (whileFlag) {
          const after = items[end + 1];
          if (after && isP(after)) {
            if (className(after) === 'subtitle') break;
            end += 1;
          } else whileFlag = false;
          k += 1;
          if (k > o.captureAfter) whileFlag = false;
        }
      }
      items.splice(end + 1, 0, markerItem('end', stats.count));
      i = end + 2;
    } else {
      items[i] = toSubtitle(ptr);
      stats.count += 1;
      // Up to N paragraphs before and after become subtitles too; a subtitle is passed over, any
      // other element stops the walk.
      let j = i - 1;
      for (let k = 0; k < o.captureBefore; k += 1) {
        const el = items[j];
        if (el && isP(el) && !['', 'subtitle'].includes(className(el))) break;
        if (el && !isP(el)) break;
        if (el && className(el) === '') items[j] = toSubtitle(el);
        if (el) j -= 1;
      }
      j = i + 1;
      for (let k = 0; k < o.captureAfter; k += 1) {
        const el = items[j];
        if (el && isP(el) && !['', 'subtitle'].includes(className(el))) break;
        if (el && !isP(el)) break;
        if (el && className(el) === '') items[j] = toSubtitle(el);
        if (el) j += 1;
      }
      i += 1;
    }
    wereOnlyEmptyLines = false;
  }
  if (!changed) return [section];
  return o.mode === 'titles' ? splitAtMarkers(section, items) : [{ ...section, content: items }];
}

function versionStr(ctx) {
  return t(
    ctx,
    `Скрипт «Разметить заголовки разделов либо подзаголовки, найденные по регэкспу» v${VERSION_NUM}.\nАвтор Sclex.`,
    `The script "Mark up section titles or subtitles found by a regular expression" v${VERSION_NUM}.\nAuthor: Sclex.`,
  );
}

export default async function run(ctx) {
  const captureOptions = ['0', '1', '2', '3'].map((v) => ({ value: v, label: v }));
  const ru = ctx.uiLanguage === 'ru';
  const answer = await mfbe.ui.form({
    title: t(
      ctx,
      `Разметить заголовки разделов либо подзаголовки, найденные по регэкспу (расширенная версия) v${VERSION_NUM}. Автор Sclex.`,
      `Mark up section titles or subtitles found by a regular expression (extended version) v${VERSION_NUM}. Author: Sclex.`,
    ),
    width: 700,
    fields: [
      {
        kind: 'regexp',
        id: 'regexp',
        presetsLabel: t(
          ctx,
          'Можете выбрать один из готовых вариантов типичных разновидностей (под)заголовков:',
          'You may choose one of the ready-made patterns of typical (sub)titles:',
        ),
        presets: PRESETS.map((p) => ({ value: p.value, label: ru ? p.ru : p.en })),
        label: t(
          ctx,
          'Регэксп для поиска абзацев, которые следует превратить в заголовки либо подзаголовки. Можете задать свой регэксп (например: «^Глава \\d+$»), а можете использовать готовый, воспользовавшись выпадающим списком выше.',
          'Regular expression of the paragraphs to turn into titles or subtitles. Enter your own (for example "^Глава \\d+$") or take a ready-made one from the list above.',
        ),
        value: '[^ \\xA0]',
      },
      { kind: 'checkbox', id: 'caseSensitive', value: false, label: t(ctx, 'учитывать регистр при поиске по регэкспу', 'case-sensitive search') },
      { kind: 'checkbox', id: 'bold', value: false, label: t(ctx, 'абзац должен быть полностью жирным (кроме, разве что, ссылок и пробелов)', 'the paragraph must be entirely bold (links and spaces aside)') },
      { kind: 'checkbox', id: 'italic', value: false, label: t(ctx, 'абзац должен быть полностью курсивным (кроме, разве что, ссылок и пробелов)', 'the paragraph must be entirely italic (links and spaces aside)') },
      { kind: 'checkbox', id: 'afterTitle', value: false, label: t(ctx, 'абзац должен находиться сразу после уже размеченного (под)заголовка', 'the paragraph must follow a title or subtitle that is already marked up') },
      { kind: 'checkbox', id: 'inEmptyLines', value: false, label: t(ctx, 'абзац должен быть обрамлен пустыми строками', 'the paragraph must stand between empty lines') },
      { kind: 'checkbox', id: 'inUntitledSection', value: false, label: t(ctx, 'абзац должен быть первым непустым абзацем от начала безымянного раздела', 'the paragraph must be the first non-empty paragraph of a section without a title') },
      { kind: 'number', id: 'maxLength', value: 60, min: 0, label: t(ctx, 'Длина абзаца должна быть не больше, чем столько символов:', 'The paragraph must not be longer than this many characters:') },
      {
        kind: 'select',
        id: 'captureBefore',
        value: '0',
        options: captureOptions,
        label: t(ctx, 'сколько захватывать в создаваемый заголовок либо подзаголовок абзацев, находящихся перед абзацем, найденным по регэкспу', 'paragraphs before the matching one to take into the new title or subtitle'),
      },
      {
        kind: 'select',
        id: 'captureAfter',
        value: '0',
        options: captureOptions,
        label: t(ctx, 'сколько захватывать в создаваемый заголовок либо подзаголовок абзацев, находящихся после абзаца, найденного по регэкспу', 'paragraphs after the matching one to take into the new title or subtitle'),
      },
      {
        kind: 'radio',
        id: 'action',
        value: 'titles',
        label: t(ctx, 'Разметить', 'Mark up'),
        options: [
          { value: 'titles', label: t(ctx, 'Разметить заголовки', 'Mark up titles') },
          { value: 'subtitles', label: t(ctx, 'Разметить подзаголовки', 'Mark up subtitles') },
        ],
      },
    ],
    okLabel: t(ctx, 'Разметить', 'Mark up'),
  });
  if (!answer) return;
  const mode = answer.action === 'subtitles' ? 'subtitles' : 'titles';
  const source = String(answer.regexp ?? '');
  if (mode === 'subtitles' && source === '') {
    await mfbe.ui.message(
      t(
        ctx,
        'Вы не ввели никакой регэксп. Пожалуйста, введите регэксп для поиска заголовков в предназначенное для него (регэкспа) поле ввода.',
        'You have entered no regular expression. Please enter one in its field.',
      ),
    );
    return;
  }
  const maxLength = Number(answer.maxLength);
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    await mfbe.ui.message(t(ctx, 'Ошибка. Задано неверное значение максимальной длины абзаца.', 'Error: the maximum length of a paragraph is not valid.'));
    return;
  }
  let regExp;
  try {
    regExp = new RegExp(source.replace(nbspRegExp, char160), answer.caseSensitive ? '' : 'i');
  } catch {
    await mfbe.ui.message(
      `${versionStr(ctx)}\n\n${t(ctx, 'Не удалось скомпилировать регэксп.\nПожалуйста, проверьте корректность регэкспа, который вы вводите.', 'The regular expression does not compile.\nPlease check the expression you enter.')}`,
    );
    return;
  }
  const options = {
    mode,
    regExp,
    maxLength,
    bold: Boolean(answer.bold),
    italic: Boolean(answer.italic),
    afterTitle: Boolean(answer.afterTitle),
    inEmptyLines: Boolean(answer.inEmptyLines),
    inUntitledSection: Boolean(answer.inUntitledSection),
    captureBefore: Number(answer.captureBefore) || 0,
    captureAfter: Number(answer.captureAfter) || 0,
  };
  const stats = { count: 0 };
  const doc = await mfbe.doc.get();
  const bodies = (doc.bodies ?? []).filter((b) => b.attrs?.name !== 'notes' && b.attrs?.name !== 'comments');
  const done = await applyToBodies(bodies, (section) => processSection(section, options, stats), ctx);
  if (!done) return;
  await mfbe.ui.message(
    `${versionStr(ctx)}\n\n${
      mode === 'titles'
        ? t(ctx, `Обработка завершена.\nРазмечено заголовков: ${stats.count}.`, `Finished.\nTitles marked up: ${stats.count}.`)
        : t(ctx, `Обработка завершена.\nРазмечено подзаголовков: ${stats.count}.`, `Finished.\nSubtitles marked up: ${stats.count}.`)
    }`,
  );
}
