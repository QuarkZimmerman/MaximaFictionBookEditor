// Converted from 08_Структура разделов/02_Разбить документ на разделы....js (FictionBook Editor
// 2.7), Tier 3: the dialog "Разбиение на секции - задание параметров.htm" becomes a form. Every
// paragraph (or subtitle) of a section whose text matches the regular expression becomes a title:
// the section is cut before it and a new sibling section starts with that title, optionally taking
// the N paragraphs before and M paragraphs after the match into the title. Sections are processed
// depth first, like the original, and the number of titles found is reported.
//
// Differences from the original (see docs/scripting/conversion-notes-a.md): the leading part of a
// section that keeps only its title/epigraph, and a new section whose title is followed by nothing,
// get an <empty-line/> so that the schema stays satisfied; an empty regular expression is refused.

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const CAPTURABLE = new Set(['p', 'subtitle', 'empty-line']);
const HEADER = new Set(['title', 'epigraph', 'image', 'annotation']);

function plain(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
}

/** A captured paragraph loses its class (subtitle -> p), as in the original. */
function asTitleParagraph(node) {
  if (node.type === 'empty-line') return node;
  return { ...node, type: 'p' };
}

function ensureBlocks(section) {
  const hasBody = section.content.some((c) => !HEADER.has(c.type));
  return hasBody ? section : { ...section, content: [...section.content, { type: 'empty-line', attrs: {} }] };
}

/**
 * Splits one section (after its subsections); returns the list of sections replacing it and
 * counts the titles in `stats`.
 */
function splitSection(section, options, stats) {
  const children = [];
  for (const child of section.content ?? []) {
    if (child.type === 'section') children.push(...splitSection(child, options, stats));
    else children.push(child);
  }
  // Find the titles: [begin, end] index ranges over `children`.
  const ranges = [];
  let consumedUpTo = -1;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type !== 'p' && child.type !== 'subtitle') continue;
    if (!options.regexp.test(plain(child).replace(/\u00A0/g, ' '))) continue;
    let begin = i;
    for (let k = 0; k < options.before; k += 1) {
      const prev = children[begin - 1];
      if (begin - 1 > consumedUpTo && prev && CAPTURABLE.has(prev.type)) begin -= 1;
      else break;
    }
    let end = i;
    for (let k = 0; k < options.after; k += 1) {
      const next = children[end + 1];
      if (next && CAPTURABLE.has(next.type)) end += 1;
      else break;
    }
    ranges.push([begin, end]);
    consumedUpTo = end;
    i = end;
  }
  if (ranges.length === 0) return [{ ...section, content: children }];
  stats.titles += ranges.length;

  const result = [];
  const leading = children.slice(0, ranges[0][0]);
  const first = { ...section, content: leading };
  if (leading.length > 0) result.push(ensureBlocks(first));
  for (let r = 0; r < ranges.length; r += 1) {
    const [begin, end] = ranges[r];
    const stop = r + 1 < ranges.length ? ranges[r + 1][0] : children.length;
    const title = { type: 'title', attrs: {}, content: children.slice(begin, end + 1).map(asTitleParagraph) };
    const body = children.slice(end + 1, stop);
    // The section keeps its own attributes when its leading part disappeared (the original kept
    // the opening <section> tag with its id for the first chunk).
    const attrs = r === 0 && leading.length === 0 ? { ...section.attrs } : {};
    result.push(ensureBlocks({ type: 'section', attrs, content: [title, ...body] }));
  }
  return result;
}

export default async function run(ctx) {
  const captureOptions = ['0', '1', '2', '3'].map((v) => ({ value: v, label: v }));
  const form = await mfbe.ui.form({
    title: t(ctx, 'Разбиение на секции', 'Splitting into sections'),
    width: 640,
    fields: [
      {
        kind: 'text', id: 'regexp', value: '',
        label: t(ctx, 'Регэксп для поиска строки, которую следует превратить в заголовок, а перед ней сделать разрыв секции:',
          'Regular expression of the line to turn into a title (the section is cut before it):'),
      },
      { kind: 'checkbox', id: 'caseSensitive', value: false, label: t(ctx, 'учитывать регистр при поиске по регэкспу', 'case-sensitive search') },
      {
        kind: 'select', id: 'before', value: '0', options: captureOptions,
        label: t(ctx, 'сколько строк захватывать в заголовок перед строкой, найденной по регэкспу', 'lines to take into the title before the matching line'),
      },
      {
        kind: 'select', id: 'after', value: '0', options: captureOptions,
        label: t(ctx, 'сколько строк захватывать в заголовок после строки, найденной по регэкспу', 'lines to take into the title after the matching line'),
      },
    ],
    okLabel: t(ctx, 'Обработать', 'Process'),
  });
  if (!form) return;
  const source = String(form.regexp ?? '');
  if (!source) {
    await mfbe.ui.message(t(ctx, 'Регэксп не задан.', 'The regular expression is empty.'), { icon: 'warning' });
    return;
  }
  let regexp;
  try {
    regexp = new RegExp(source, form.caseSensitive ? '' : 'i');
  } catch {
    await mfbe.ui.message(
      t(ctx, 'Разбиение на секции.\n\nОшибка при компиляции регэкспа.\nПожалуйста, проверьте, верный ли регэксп вы ввели.',
        'Splitting into sections.\n\nThe regular expression does not compile.\nPlease check what you entered.'),
      { icon: 'error' },
    );
    return;
  }
  const options = { regexp, before: Number(form.before) || 0, after: Number(form.after) || 0 };
  const stats = { titles: 0 };

  const doc = await mfbe.doc.get();
  for (const body of doc.bodies) {
    for (const child of body.content) {
      if (child.type !== 'section') continue;
      const before = stats.titles;
      const chunks = splitSection(child, options, stats);
      if (stats.titles === before) continue;
      // The first chunk takes the place of the section (same nodeId), the others follow it.
      let ref = await mfbe.doc.replaceNode(child.attrs.nodeId, chunks[0]);
      for (const chunk of chunks.slice(1)) ref = await mfbe.doc.insertNode('after', ref, chunk);
      if (ctx.cancelled) return;
    }
  }
  await mfbe.ui.message(
    t(ctx, `Разбиение на секции.\n\nОбработка завершена.\nЗаголовков обнаружено: ${stats.titles}.`,
      `Splitting into sections.\n\nFinished.\nTitles found: ${stats.titles}.`),
  );
}
