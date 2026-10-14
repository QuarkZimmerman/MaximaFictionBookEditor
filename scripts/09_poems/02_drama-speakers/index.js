// Converted from 09_Стихи/02_Драма....js (FictionBook Editor): "Разметка имен говорящих в пьесах".
// For every paragraph placed directly in a section (subtitles excluded) the speaker name at the
// start of the paragraph - the text up to the first dot or opening parenthesis, at most
// `limit` characters, no ! ? … inside - is wrapped in <strong>; optionally the letter-spacing
// of the name ("Г а м л е т") is removed. The paragraph is processed in the legacy inline-HTML
// notation so the original tag bookkeeping could be kept almost verbatim.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// Скрипт "Разметка имен говорящих в пьесах"
// v.1.2 от 20.03.2010
//                                                 Автор Sclex
//
//обрабатывать ли history
import { collectTextBlocks, rewriteBlockHtml } from './lib/legacy-html.js';

const NBSP = '\u00A0';
const BIG_LETTER = /[А-ЯЁA-Z(]/;
const STRONG_TAGS = /<STRONG>|<\/STRONG>/gi;

/** Returns the rewritten paragraph HTML or null when the paragraph has no speaker name. */
function markSpeaker(s, limit, deleteSpacing) {
  let i = 0;
  let accumStr = '';
  let prevCh = '';
  let chCnt = 0;
  let level = 0;
  let tagCnt = 0;
  let accumTags = '';
  const coll = {};
  while (i < s.length) {
    let ch = s.substring(i, i + 1);
    if (ch === '<') {
      // A tag: read it whole, remember open tags per nesting level.
      let closing = false;
      i += 1;
      let myTagName = '';
      let wholeTag = '<';
      ch = s.substring(i, i + 1);
      if (ch === '/') {
        closing = true;
        wholeTag += ch;
        i += 1;
        ch = s.substring(i, i + 1);
      }
      while (i < s.length && ch !== '>' && ch !== ' ') {
        myTagName += ch;
        i += 1;
        ch = s.substring(i, i + 1);
      }
      wholeTag += myTagName;
      while (i < s.length && ch !== '>') {
        wholeTag += ch;
        i += 1;
        ch = s.substring(i, i + 1);
      }
      wholeTag += '>';
      i += 1;
      accumTags += wholeTag;
      if (closing) level -= 1;
      else {
        level += 1;
        coll[`tagName_${level}`] = myTagName;
        coll[`wholeTag_${level}`] = wholeTag;
      }
      if (myTagName.toUpperCase() !== 'STRONG' && !closing) tagCnt += 1;
      continue;
    }
    // An ordinary character.
    if (ch === '!' || ch === '?' || ch === '…') return null;
    if (deleteSpacing && BIG_LETTER.test(ch) && (prevCh === ' ' || prevCh === NBSP)) accumStr += prevCh;
    accumStr += accumTags;
    accumTags = '';
    if ((prevCh === '.' || ch === '(') && chCnt > 0) {
      if (ch === '(' && chCnt > limit) return null;
      // Strip the tags opened right before this character from the name, close the tags still
      // open inside it and reopen all of them in front of the rest of the paragraph.
      const tagsOnEnd = new RegExp(`(<[^>]*?>){${tagCnt}}$`, 'i');
      let s2 = accumStr.replace(tagsOnEnd, '');
      let s3 = '';
      for (let lev = level - tagCnt; lev > 0; lev -= 1) s2 += `</${coll[`tagName_${lev}`]}>`;
      for (let lev = level; lev > 0; lev -= 1) s3 = coll[`wholeTag_${lev}`] + s3;
      s2 = s2.replace(STRONG_TAGS, '');
      s2 = `<STRONG>${s2}</STRONG>`;
      return s2 + s3 + s.substr(i);
    }
    if (ch !== ' ' && ch !== NBSP) {
      accumStr += ch;
      chCnt += 1;
    } else if (!deleteSpacing) accumStr += ch;
    prevCh = ch;
    i += 1;
    if (chCnt > limit + 1) return null;
    tagCnt = 0;
  }
  return null;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const answer = await mfbe.ui.prompt(
    ru ? 'Сколько символов может быть до точки или скобки?' : 'How many characters may precede the dot or parenthesis?',
    { caption: ctx.script.name, defaultValue: '10' },
  );
  const deleteSpacing = (await MsgBox(ru ? 'Удалять разрядку?' : 'Remove letter-spacing?', ctx.script.name, 4 + 32)) === 6;
  if (!answer) return;
  const limit = Number(answer);
  if (!Number.isFinite(limit)) return;

  const snapshot = await mfbe.doc.get();
  const blocks = collectTextBlocks(snapshot).filter(
    (b) => b.ancestors[0]?.type === 'section' && b.node.type !== 'subtitle',
  );
  let count = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const changed = await rewriteBlockHtml(blocks[i], (html) => {
      // The legacy code compared single characters with the nbsp, so keep it as a character.
      const plain = html.replace(/&nbsp;/g, NBSP);
      const result = markSpeaker(plain, limit, deleteSpacing);
      return result === null ? html : result;
    });
    if (changed) count += 1;
    if (i % 50 === 0) await mfbe.ui.progress(i, blocks.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.message(
    ru
      ? `–= Sclex Script =–\n«Действующие лица в пьесах»\nv.1.2\n\nОбработка завершена.\nРазмечено абзацев: ${count}.`
      : `–= Sclex Script =–\n"Speakers in plays"\nv.1.2\n\nDone.\nParagraphs marked: ${count}.`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
