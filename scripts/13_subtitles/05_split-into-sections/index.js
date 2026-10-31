// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/05_Разметить заголовки разделов либо подзаголовки, найденные по регэкспу....js
// with its dialog HTML/Разметить заголовки разделов либо подзаголовки, найденные по регэкспу -
// задание параметров.htm, which held the whole logic (version 4.7). The package was first
// converted from 2.7beta1's 08_Структура разделов/02_Разбить документ на разделы....js
// (version 1.4; its notice is kept below as well); 2.7.9 moved the script to its group 13, and
// the package keeps its folder and its id 08/split-into-sections.
// Marks up section titles or subtitles found by a regular expression. In every body except the
// notes and comments bodies, each paragraph of a section that matches the expression becomes, as
// chosen, the title of a new section that starts there (taking up to 3 paragraphs before and
// after it into the title; a subtitle stops that) or a subtitle (with up to 3 paragraphs before
// and after it; a subtitle is passed over, any other element stops). Subtitles are no candidates
// for titles. The text tested is the paragraph's HTML without its tags (pictures go), with the
// entities decoded, non-breaking spaces kept and the unusual spaces made plain spaces. The
// engine that cuts the sections is section-split.js (an identical copy of the one of 13/06 and
// 13/07); this file holds the dialog's tests, as written, on the legacy inline-HTML notation of
// lib/legacy-html.js. Its conditions are those of 13/06 (the extended version) without the extra
// ones (bold, italic, position, empty lines around, length).
//
// Differences from the original (docs/scripting/notes-279-drafts/13-recheck.md):
// - the modeless dialog, which stayed open for further runs, is a form; its two rows of buttons
//   ("Разметить заголовки" / "... и выйти", "Разметить подзаголовки" / "... и выйти") are the
//   choice "Разметить" and OK; its ready-made patterns are the presets of the pattern field,
//   whose validity check replaces the original's message about a pattern that does not compile;
// - a part of a section left with its title only, and a new section with nothing after its
//   title, get an <empty-line/>; the first new section keeps the section's id when nothing
//   precedes it (section-split.js);
// - an empty line (or a paragraph of spaces) chosen as a subtitle stays an empty line: 2.7.9
//   wrote an empty subtitle, which it saved as an <empty-line/>; it is counted as in 2.7.9;
// - fix: an empty pattern is refused for titles too, with the message 2.7.9 shows for subtitles
//   (2.7.9 turned every paragraph and empty line of the book into the title of a section).
// The original's notice, kept as written (FR-029):
//Скрипт «Разметить заголовки разделов либо подзаголовки, найденные по регэкспу»
//Автор Sclex
 // Нижеследующая команда задает список необычных пробелов,
 // которые в заголовках и подзаголовках должны обрабатываться
 // наравне с обычными пробелами:
// The notice of its 2.7beta1 version (08_Структура разделов/02_Разбить документ на разделы....js),
// kept as written:
//Скрипт «разбиение на секции»
//Автор Sclex
//http://www.fictionbook.org/forum/viewtopic.php?t=4412
import { serializeInline } from './lib/legacy-html.js';
import { PRESETS } from './presets.js';
import { applyToBodies, className, isLineEmpty, isMarker, isP, markerItem, splitAtMarkers, testText } from './section-split.js';

const VERSION_NUM = '4.7';

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

/** innerHTML of a paragraph; an empty one got a non-breaking space first, as in the original. */
function innerHTML(item) {
  const html = item.type === 'empty-line' ? '' : serializeInline(item.content ?? [], []);
  return html === '' ? '&nbsp;' : html;
}

/**
 * The empty lines made subtitles in this run: they stay empty lines in the book (2.7.9 saved
 * its empty subtitle as one) but, like 2.7.9's subtitle, are no candidates any more.
 */
const emptySubtitles = new WeakSet();

/** className of the original's element. */
function classOf(item) {
  return emptySubtitles.has(item) ? 'subtitle' : className(item);
}

/** The original's test of a paragraph: its class, then the expression on its text. */
function fits(item, o) {
  if (!isP(item) || isMarker(item)) return false;
  const cls = classOf(item);
  if (o.mode === 'titles' ? cls === 'subtitle' : cls !== '') return false;
  const text = testText(innerHTML(item)).replace(nbspRegExp, char160).replace(unusualSpacesRegExp, ' ');
  return text.search(o.regExp) >= 0;
}

/** A paragraph turned into a subtitle; an empty line stays one (2.7.9 saved it as one). */
function toSubtitle(item) {
  if (item.type !== 'p' || isLineEmpty(item)) {
    emptySubtitles.add(item);
    return item;
  }
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
  let i = 0;
  while (i < items.length) {
    const ptr = items[i];
    if (!fits(ptr, o)) {
      i += 1;
      continue;
    }
    changed = true;
    if (o.mode === 'titles') {
      let begin = i;
      let end = i;
      if (o.captureBefore > 0) {
        let k = 1;
        let whileFlag = true;
        while (whileFlag) {
          const prev = items[begin - 1];
          if (prev && isP(prev) && !isMarker(prev)) {
            if (classOf(prev) === 'subtitle') break;
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
            if (classOf(after) === 'subtitle') break;
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
        if (el && isP(el) && !['', 'subtitle'].includes(classOf(el))) break;
        if (el && !isP(el)) break;
        if (el && classOf(el) === '') items[j] = toSubtitle(el);
        if (el) j -= 1;
      }
      j = i + 1;
      for (let k = 0; k < o.captureAfter; k += 1) {
        const el = items[j];
        if (el && isP(el) && !['', 'subtitle'].includes(classOf(el))) break;
        if (el && !isP(el)) break;
        if (el && classOf(el) === '') items[j] = toSubtitle(el);
        if (el) j += 1;
      }
      i += 1;
    }
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
  // The field ids regexp, caseSensitive, before and after are those of the 2.7beta1 conversion.
  const answer = await mfbe.ui.form({
    title: t(
      ctx,
      `Разметить заголовки разделов либо подзаголовки, найденные по регэкспу v${VERSION_NUM}. Автор Sclex.`,
      `Mark up section titles or subtitles found by a regular expression v${VERSION_NUM}. Author: Sclex.`,
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
        value: '',
      },
      { kind: 'checkbox', id: 'caseSensitive', value: false, label: t(ctx, 'учитывать регистр при поиске по регэкспу', 'case-sensitive search') },
      {
        kind: 'select',
        id: 'before',
        value: '0',
        options: captureOptions,
        label: t(ctx, 'сколько захватывать в создаваемый заголовок либо подзаголовок абзацев, находящихся перед абзацем, найденным по регэкспу', 'paragraphs before the matching one to take into the new title or subtitle'),
      },
      {
        kind: 'select',
        id: 'after',
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
  // 2.7.9 refused an empty pattern for subtitles only; for titles it turned every paragraph and
  // empty line into a title (fix: refused for both, with the message of the subtitles button).
  if (source === '') {
    await mfbe.ui.message(
      t(
        ctx,
        'Вы не ввели никакой регэксп. Пожалуйста, введите регэксп для поиска заголовков в предназначенное для него (регэкспа) поле ввода.',
        'You have not entered any regular expression. Please enter the regular expression to find the titles by in the field meant for it.',
      ),
    );
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
    captureBefore: Number(answer.before) || 0,
    captureAfter: Number(answer.after) || 0,
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
