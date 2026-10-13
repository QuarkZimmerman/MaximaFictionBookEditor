// Converted from 06_Чистка/02_Генеральная уборка.js (FictionBook Editor) - "General clean-up".
// Runs the 79 typographic regular expressions of the original over every text block of the
// book (and of the title-info annotation / document-info history, which the original also
// processed): spaces around punctuation, hyphens vs. dashes, ellipses, abbreviations, units,
// date ranges, leading/trailing spaces, soft hyphens, final dots in titles, junk ids.
// Each block is rendered in the legacy inline-HTML notation (lib/legacy-html.js) so the
// expressions that mention <EM>/<STRONG>/&nbsp; keep working and inline formatting survives.
//
// The rule "градус Цельсия" (re67) was dead code in the original (its RegExp was assigned to
// the wrong variable) and is therefore not applied here either.
import { collectTextBlocks, legacyTimeString, parseInline, rewriteBlockHtml, serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';
import { COUNTER_LABELS, JUNK_ID, RULES, TITLE_DOT_EXCEPTION } from './rules.js';

const VERSION = '2.3';

/** Applies the rule pipeline to one block's HTML; `parentType` drives the conditional rules. */
function cleanHtml(html, parentType, counters) {
  let s = html;
  for (const rule of RULES) {
    if (rule.cond === 'inStanza' && parentType !== 'stanza') continue;
    if (rule.cond === 'notStanza' && parentType === 'stanza') continue;
    if (rule.cond === 'titleDot' && (parentType !== 'title' || s.search(TITLE_DOT_EXCEPTION) !== -1)) continue;
    if (s.search(rule.re) === -1) continue;
    s = s.replace(rule.re, rule.repl);
    if (rule.counter) counters[rule.counter] = (counters[rule.counter] ?? 0) + 1;
  }
  return s;
}

/** The title-info annotation and the document-info history live in the description. */
function descriptionBlocks(description) {
  const out = [];
  const visit = (node, ancestors) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type)) {
      out.push({ node, parentType: ancestors[0]?.type });
      return;
    }
    for (const child of node.content ?? []) visit(child, [node, ...ancestors]);
  };
  visit(description.titleInfo?.annotation, []);
  visit(description.documentInfo?.history, []);
  return out;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const counters = {};
  const snapshot = await mfbe.doc.get();
  const blocks = collectTextBlocks(snapshot);

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const parentType = block.ancestors[0]?.type;
    // Junk ids left by converters: the attribute goes away together with the text clean-up.
    const id = block.node.attrs?.id;
    const dropId = typeof id === 'string' && id.search(JUNK_ID) >= 0;
    if (dropId) counters['90'] = (counters['90'] ?? 0) + 1;
    await rewriteBlockHtml(block, (html) => cleanHtml(html, parentType, counters));
    if (dropId) {
      // rewriteBlockHtml refreshed block.node, so the cleaned content is kept.
      const attrs = { ...block.node.attrs };
      delete attrs.id;
      await mfbe.doc.replaceNode(block.ref, { type: block.node.type, attrs, content: block.node.content ?? [] });
    }
    if (i % 25 === 0) await mfbe.ui.progress(i, blocks.length, ru ? 'Генеральная уборка' : 'General clean-up');
    if (ctx.cancelled) return;
  }

  // Description blocks cannot be addressed by node operations: edit the JSON and write it back.
  const description = snapshot.description;
  let descriptionChanged = false;
  for (const { node, parentType } of descriptionBlocks(description)) {
    const extras = [];
    const before = serializeInline(node.content, extras);
    const after = cleanHtml(before, parentType, counters);
    if (after !== before) {
      node.content = parseInline(after, extras);
      descriptionChanged = true;
    }
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);

  const stats = Object.keys(counters)
    .sort()
    .map((key) => `\n• ${(COUNTER_LABELS[key] ?? { ru: key, en: key })[ru ? 'ru' : 'en']}:\t${counters[key]}`)
    .join('');
  const header = ru ? `«Генеральная уборка» v.${VERSION}\n\n Время: ${legacyTimeString(started)}.` : `"General clean-up" v.${VERSION}\n\n Time: ${legacyTimeString(started)}.`;
  await mfbe.ui.message(stats ? `${header}\n\n ${ru ? 'Статистика' : 'Statistics'}${stats}` : header, { caption: ctx.script.name, icon: 'info' });
}
