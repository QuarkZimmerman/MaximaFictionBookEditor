// Shared engine of stokber's "Превратить внешние ссылки в примечания" / "... в комментарии" of
// FictionBook Editor 2.7.9 (02_Примечания/38 and 03_Комментарии/38; each package carries its own
// byte-identical copy - the sandbox loads modules from the script's own folder only).
//
// The originals chained two of Sclex's scripts: General clean-up's expression that turns an
// external link (http:, https:, ftp:, file:, mailto:, without a type) into its text followed by
// its address between the temporary brackets 【♣★ and ★♣】 (every paragraph, the annotation and
// the history included), then "Примечания из скобок" with those brackets (the 2.7beta1 version
// of group 04): each bracketed address becomes a link [N] (a superscript {N} for comments) to a
// new section holding the address, inserted before the section of the next note link of the
// book (appended without one), and at the end the sections are renumbered with every link to
// them. Here the same is done in one pass on the document model; the brackets are not needed,
// but a book that already holds them is refused with the original's message, as it was.

import {
  bodyNamed,
  commentLinkText,
  commit,
  footnoteLinkText,
  linkGroups,
  loadBook,
  localHref,
  normalise,
  pageBlocks,
  plainText,
  renumber,
  t,
  titleNode,
  touch,
} from './notes-book.js';

const OPEN = '【♣★';
const CLOSE = '★♣】';
const EXTERNAL = /^(?:https?:|ftp:|file:|mailto:)./i;

export const FOOTNOTES = {
  bodyName: 'notes',
  bodyTitle: 'Примечания',
  prefix: 'n_',
  noteType: 'note',
  linkText: footnoteLinkText,
  // finalization gave the text [N] to the links of class "note" only
  textOf: (group) => group.type === 'note',
  // the next note link: class "note"
  isNoteLink: (group) => group.type === 'note',
  ru: {
    title: "'Превратить внешние ссылки в примечания' v1.3.",
    added: 'Добавлено примечаний',
    nested: 'В body примечаний есть разделы второго уровня вложения. Такие файлы не обрабатываются данным скриптом. Работа скрипта завершена.',
    outside: 'Ссылка сноски ссылается не внутрь раздела в теле примечаний.\nПозиция обзора установлена на неисправную ссылку.',
  },
  en: {
    title: "'Turn external links into footnotes' v1.3.",
    added: 'Footnotes added',
    nested: 'The notes body holds nested sections. Such books are not handled by this script. The script stops.',
    outside: 'A footnote link does not point to a section of the notes body.\nThe view is set to the faulty link.',
  },
};

export const COMMENTS = {
  bodyName: 'comments',
  bodyTitle: 'Комментарии',
  prefix: 'c_',
  noteType: null,
  linkText: commentLinkText,
  // finalization tested the address it had just written (#c_N): every link got the text {N}
  textOf: () => true,
  // the next note link: a local address starting with c_
  isNoteLink: (group) => (localHref(group.href) ?? '').search(/^c_/) >= 0,
  ru: {
    title: "'Превратить внешние ссылки в комментарии' v1.3.",
    added: 'Добавлено комментариев',
    nested: 'В body комментариев есть разделы второго уровня вложения. Такие файлы не обрабатываются данным скриптом. Работа скрипта завершена.',
    outside: 'Ссылка сноски ссылается не внутрь раздела в теле комментариев.\nПозиция обзора установлена на неисправную ссылку.',
  },
  en: {
    title: "'Turn external links into comments' v1.3.",
    added: 'Comments added',
    nested: 'The comments body holds nested sections. Such books are not handled by this script. The script stops.',
    outside: 'A comment link does not point to a section of the comments body.\nThe view is set to the faulty link.',
  },
};

/** getExitStr of the original. */
function exitTime(since) {
  const s = (Date.now() - since) / 1000;
  const min = Math.floor(s / 60);
  const sec = Math.ceil(s - min * 60);
  const s1 = Math.ceil(10 * (s - min * 60)) / 10;
  const s2 = Math.ceil(100 * (s - min * 60)) / 100;
  const s3 = Math.ceil(1000 * (s - min * 60)) / 1000;
  if (s2 < 1 && min < 1) return `${s3} с`;
  if (s1 < 10 && min < 1) return `${s2} с`;
  if (min < 1) return `${s1} с`;
  return `${min} мин ${sec} с`;
}

function isExternal(group) {
  return !group.type && EXTERNAL.test(group.href ?? '');
}

export async function runExternalLinks(ctx, o) {
  const started = Date.now();
  const say = (key) => t(ctx, o.ru[key], o.en[key]);
  const exit = (n) => t(ctx, `${o.ru.added}: ${n}.\nЗатрачено времени: ${exitTime(started)}`, `${o.en.added}: ${n}.\nTime taken: ${exitTime(started)}`);
  const book = await loadBook();
  const blocks = pageBlocks(book);

  // The temporary brackets must not be in the book already.
  if (blocks.some((entry) => /【♣★|★♣】/.test(plainText(entry.node.content ?? [])))) {
    await mfbe.clipboard.writeText(`${OPEN}|${CLOSE}`);
    await mfbe.ui.message(
      t(
        ctx,
        "Это невероятно, но в вашем документе обнаружились, невесть как туда попавшие, редкие сочетания трех редких символов '【♣★' и(ли) '★♣】', которые используются скриптом как временные метки будущих сносок. Найти в документе их можно вставив регексп из буфера обмена в строку 'Что искать:' окна 'Поиск' (Ctrl+F). Не забудьте включить проверку регулярных выражений.\nДля корректной работы сценария рекомендуем на время работы скрипта заменить эти случайные символы какими-нибудь другими или вставьте между этих трёх символов какие-либо другие символы, например так: '【+♣+★'.",
        "Unbelievable as it is, your document holds the rare combinations of three rare characters '【♣★' and/or '★♣】' that the script uses as temporary marks of the future notes. You can find them by pasting the regular expression on the clipboard into the Find dialog (Ctrl+F) with regular expressions turned on.\nFor the script to work, replace these characters with others while it runs, or put other characters between them, for example '【+♣+★'.",
      ),
      { icon: 'warning' },
    );
    return;
  }

  // The external links, in the order of the page.
  const found = [];
  for (const entry of blocks) {
    const content = entry.node.content ?? [];
    for (const group of linkGroups(content)) if (isExternal(group)) found.push({ entry, group });
  }
  let body = bodyNamed(book, o.bodyName);
  if (found.length && body && body.content.some((s) => s.type === 'section' && (s.content ?? []).some((c) => c.type === 'section'))) {
    await mfbe.ui.message(say('nested'), { icon: 'warning' });
    return;
  }

  // Where each note goes: before the section of the next note link after it.
  const allIds = new Set();
  const collect = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.attrs?.id) allIds.add(node.attrs.id);
    for (const child of node.content ?? []) collect(child);
  };
  book.bodies.forEach(collect);
  const sectionById = new Map((body ? body.content : []).filter((n) => n.type === 'section' && n.attrs?.id).map((n) => [n.attrs.id, n]));
  const plan = [];
  for (const entry of blocks) {
    const content = entry.node.content ?? [];
    for (const group of linkGroups(content)) {
      if (isExternal(group)) {
        plan.push({ entry, group, before: null, pending: true });
        continue;
      }
      if (!o.isNoteLink(group)) continue;
      // the next note link of every external link still waiting
      const waiting = plan.filter((step) => step.pending);
      if (!waiting.length) continue;
      const id = localHref(group.href);
      const target = id === null ? null : (sectionById.get(id) ?? null);
      if (!target) {
        const message = id !== null && allIds.has(id) ? say('outside') : t(ctx, 'Ссылка сноски ссылается на несуществующий раздел.\nПозиция обзора установлена на неисправную ссылку.', 'A footnote link points to a section that does not exist.\nThe view is set to the faulty link.');
        await mfbe.selection.set({ nodeId: entry.node.attrs.nodeId, offset: group.start });
        await mfbe.ui.message(`${say('title')}\n\n${message}\n\n${exit(0)}`, { icon: 'error' });
        return;
      }
      for (const step of waiting) {
        step.before = target;
        step.pending = false;
      }
    }
  }

  if (!plan.length) {
    await mfbe.ui.message(`${say('title')}\n\n${exit(0)}`);
    return;
  }

  // The notes body: created at the end of the book, or titled when it has no title.
  if (!body) {
    body = { type: 'body', attrs: { name: o.bodyName }, content: [titleNode(o.bodyTitle)] };
    book.bodies.push(body);
    book.created.add(body);
  } else {
    const first = body.content.find((node) => node.type === 'section' || node.type === 'epigraph' || node.type === 'title');
    if (first && first.type !== 'title') body.content.splice(body.content.indexOf(first), 0, titleNode(o.bodyTitle));
    else if (!first && body.content[body.content.length - 1]?.type !== 'title') body.content.push(titleNode(o.bodyTitle));
    book.changed.add(body);
  }

  // Each external link: its text, then a note link; the address goes into a new section.
  const prefix = `tmp_${Math.floor(Math.random() * 1e9)}_`;
  const byEntry = new Map();
  plan.forEach((step, i) => {
    step.k = i + 1;
    if (!byEntry.has(step.entry)) byEntry.set(step.entry, []);
    byEntry.get(step.entry).push(step);
  });
  for (const [entry, steps] of byEntry) {
    const content = [...(entry.node.content ?? [])];
    for (const step of [...steps].reverse()) {
      const { group } = step;
      const kept = content
        .slice(group.first, group.last + 1)
        .map((item) => ({ ...item, marks: (item.marks ?? []).filter((mark, i) => i !== group.outer.length) }));
      const mark = { type: 'link', attrs: o.noteType ? { href: `#${prefix}${step.k}`, type: o.noteType } : { href: `#${prefix}${step.k}` } };
      const link = o.linkText('*').map((item) => ({ ...item, marks: [...group.outer, mark, ...(item.marks ?? [])] }));
      content.splice(group.first, group.last - group.first + 1, ...kept, ...link);
    }
    entry.node.content = normalise(content);
    touch(book, entry.root);
  }
  for (const step of plan) {
    const section = {
      type: 'section',
      attrs: { id: `${prefix}${step.k}` },
      content: [titleNode('***'), { type: 'p', attrs: {}, content: [{ type: 'text', text: step.group.href }] }],
    };
    const at = step.before ? body.content.indexOf(step.before) : body.content.length;
    body.content.splice(at, 0, section);
  }
  renumber(book, body, o.prefix, (n, group) => (o.textOf(group) ? o.linkText(n) : null));
  await commit(book);
  await mfbe.ui.message(`${say('title')}\n\n${exit(plan.length)}`);
}
