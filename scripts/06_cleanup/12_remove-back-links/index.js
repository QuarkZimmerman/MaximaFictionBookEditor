// Converted from 06_Чистка/12_Удаление возвратов.js (FictionBook Editor): "Удаление возвратных ссылок".
// Converters such as Word export leave "back links" in the notes body (links to _ftnref1 /
// _ednref1 anchors in the main text) and the matching ids on paragraphs. The script removes
// those links (with their text) from the notes body and the ids from the paragraphs of the
// other bodies, unless a regular link in the main text still points at the id. When a notes
// section has not exactly one back link the user is warned first.
//
// Deviations (see conversion-notes-b.md): the original removed every link that followed a
// back link inside the same notes section because of a counter that was never reset; only
// the links matching the patterns are removed here.

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const BACK_HREF = [/^_ftnref/i, /^_ednref/i];
/** Set to true to keep the text of the removed links (the legacy HrefToText switch). */
const HREF_TO_TEXT = false;

/** Legacy GetLocalHref: the part after "#", or "1" when the href is not local. */
function localHref(href) {
  const text = href ?? '';
  const hash = text.indexOf('#');
  if (hash < 0) return '1';
  const main = /main\.html#/i.exec(text);
  return main ? text.slice(main.index + 10) : text.slice(hash + 1);
}

function isBackHref(local) {
  return BACK_HREF.some((re) => re.test(local));
}

function textBlocks(node, out = []) {
  if (!node || node.type === 'text') return out;
  if (TEXT_BLOCK_TYPES.has(node.type)) {
    out.push(node);
    return out;
  }
  for (const child of node.content ?? []) textBlocks(child, out);
  return out;
}

/** Links of a block: consecutive runs sharing one link mark. */
function linksOf(block) {
  const links = [];
  let current = null;
  (block.content ?? []).forEach((run, index) => {
    const mark = run.type === 'text' ? (run.marks ?? []).find((m) => m.type === 'link') : null;
    if (!mark) {
      current = null;
      return;
    }
    const href = mark.attrs?.href ?? '';
    if (current && current.href === href) current.runs.push(index);
    else {
      current = { href, runs: [index] };
      links.push(current);
    }
  });
  return links;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const snapshot = await mfbe.doc.get();
  const bodies = snapshot.bodies ?? [];
  const notes = bodies.find((b) => b.attrs?.name === 'notes');
  const others = bodies.filter((b) => b.attrs?.name !== 'notes');
  if (!notes) {
    await mfbe.ui.message(ru ? 'Отсутствует body примечаний!' : 'There is no notes body!', { icon: 'warning' });
    return;
  }
  if (others.length === 0) {
    await mfbe.ui.message(ru ? 'Нет ни одного body, кроме body примечаний.' : 'There is no body besides the notes body.', { icon: 'warning' });
    return;
  }

  // Targets of the links in the regular bodies: an id that is still referenced is kept.
  const referenced = new Set();
  for (const body of others) {
    for (const block of textBlocks(body)) {
      for (const link of linksOf(block)) {
        const local = localHref(link.href);
        if (local !== '1') referenced.add(local);
      }
    }
  }

  // Pass 1: sections of the notes body with a back-link count other than one.
  const sections = (notes.content ?? []).filter((n) => n.type === 'section');
  const odd = [];
  sections.forEach((section, index) => {
    let count = 0;
    for (const block of textBlocks(section)) {
      for (const link of linksOf(block)) if (isBackHref(localHref(link.href))) count += 1;
    }
    if (count !== 1) odd.push(`${index + 1}:${count}`);
  });
  if (odd.length) {
    const question = ru
      ? 'В самом правильном случае в каждой секции body примечаний есть одна возвратная ссылка.\nНо в данном случае это не так.\nНиже перечислены пары "номер секции:количество возвратных ссылок" для тех секций,\nв которых количество обнаруженных возвратных ссылок отличается от единицы.\nПроконтролировать их размещение не представляется возможным.\n\n'
        + `${odd.join(', ')}\n\nВы все еще хотите произвести удаление возвратных ссылок и id абзацев?`
      : 'Ideally every section of the notes body contains exactly one back link.\nHere this is not the case.\nBelow are the pairs "section number:number of back links" for the sections\nwhose number of back links differs from one.\n\n'
        + `${odd.join(', ')}\n\nDo you still want to remove the back links and the paragraph ids?`;
    if ((await MsgBox(question, ctx.script.name, 4 + 32)) !== 6) return;
  }

  // Pass 2: remove the back links (and their text) from the notes body.
  let deletedLinks = 0;
  for (const section of sections) {
    for (const block of textBlocks(section)) {
      const links = linksOf(block).filter((link) => isBackHref(localHref(link.href)));
      if (!links.length) continue;
      const drop = new Set();
      for (const link of links) {
        deletedLinks += 1;
        for (const index of link.runs) drop.add(index);
      }
      const content = (block.content ?? []).flatMap((run, index) => {
        if (!drop.has(index)) return [run];
        if (!HREF_TO_TEXT) return [];
        const marks = (run.marks ?? []).filter((m) => m.type !== 'link');
        return [marks.length ? { ...run, marks } : { type: 'text', text: run.text }];
      });
      await mfbe.doc.replaceNode({ nodeId: block.attrs.nodeId, type: block.type }, { type: block.type, attrs: { ...block.attrs }, content });
    }
  }

  // Pass 3: ids of the regular bodies' paragraphs that look like back-link anchors.
  let deletedIds = 0;
  for (const body of others) {
    for (const block of textBlocks(body)) {
      const id = block.attrs?.id;
      if (!id || !isBackHref(id) || referenced.has(id)) continue;
      const attrs = { ...block.attrs };
      delete attrs.id;
      await mfbe.doc.replaceNode({ nodeId: block.attrs.nodeId, type: block.type }, { type: block.type, attrs, content: block.content ?? [] });
      deletedIds += 1;
    }
  }

  await mfbe.ui.message(
    ru
      ? ` "Удаление возвратных ссылок"\n\n Удалено\n\n         Возвратных ссылок: ${deletedLinks}\n                     ID абзацев: ${deletedIds}`
      : ` "Removal of back links"\n\n Removed\n\n         Back links: ${deletedLinks}\n         Paragraph ids: ${deletedIds}`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
