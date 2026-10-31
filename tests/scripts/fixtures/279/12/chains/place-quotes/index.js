// Test driver of the recheck of group 12 (feature 007, T082: 12_Обработка кавычек 001 and
// 004-007 against FictionBook Editor 2.7.9), not a bundled script. It runs the quote-placing
// scripts through mfbe.scripts.run by their 2.7.9 paths, each from a given caret or selection on
// the unchanged book, and writes one line per run to the clipboard: the selection the script left
// and the text of every paragraph it changed. After each run the book is put back (the bodies'
// paragraphs with doc.replaceNode, the description with doc.setDescription), so the book ends as
// it began. The scripts' messages are answered by the harness (OK).
const GROUP = '12_Обработка кавычек\\';
const FROM_START = '001_Проставить елочки и лапки (от начала документа).js';
const FROM_CARET = '004_Проставить елочки и лапки (от позиции курсора).js';
const LEVEL1 = '005_Проставить елочки и лапки (от позиции курсора; как будто перед курсором 1 незакрытая кавычка).js';
const LEVEL2 = '006_Проставить елочки и лапки (от позиции курсора; как будто перед курсором 2 незакрытые кавычки).js';
const ONLY = '007_Проставить только елочки (во всем документе).js';
const SCENARIOS = [
  { script: FROM_START, from: 'n7:0' }, // the whole book: stops at the ellipsis on both sides
  { script: FROM_START, from: 'n28:0-n28:31' }, // a quote left open at the end of the selection
  { script: FROM_START, from: 'n20:0-n23:13' }, // the level changes inside a cite
  { script: FROM_CARET, from: 'n15:0' }, // a section ends with an open quote
  { script: FROM_CARET, from: 'n20:0' }, // the cite again, from the caret
  { script: FROM_CARET, from: 'n27:0-n27:28' }, // a selection: the selection only
  { script: FROM_CARET, from: 'n10:0-n10:35' }, // the ellipsis on both sides alone
  { script: FROM_CARET, from: 'n31:35' }, // the end of the annotation: no start rule in 004
  { script: LEVEL1, from: 'n33:16' }, // the end of the history's first paragraph: start rule
  { script: LEVEL1, from: 'n31:0' }, // the annotation ends with a quote open
  { script: LEVEL1, from: 'n28:1' }, // inside an open quote, closed in the next paragraph
  { script: LEVEL2, from: 'n31:35' }, // the end of the annotation: start rule, the history fails
  { script: ONLY, from: 'n7:0' }, // the whole book, guillemets only
];

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);

/** The text blocks of the book, by node id: the description's and the bodies'. */
function blocks(doc) {
  const out = new Map();
  const visit = (node, where) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      out.set(node.attrs.nodeId, { node, where });
      return;
    }
    for (const child of node.content ?? []) visit(child, where);
  };
  visit(doc.description?.titleInfo?.annotation, 'description');
  visit(doc.description?.documentInfo?.history, 'description');
  for (const body of doc.bodies ?? []) visit(body, 'body');
  return out;
}

const textOf = (node) => (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '￼')).join('');

async function start(from) {
  const parse = (text) => {
    const [nodeId, offset] = text.split(':');
    return { nodeId, offset: Number(offset) };
  };
  const [anchor, head] = from.split('-');
  await mfbe.selection.set(parse(anchor), head ? parse(head) : undefined);
}

export default async function run() {
  const lines = [];
  for (const scenario of SCENARIOS) {
    const before = await mfbe.doc.get();
    await start(scenario.from);
    await mfbe.scripts.run(GROUP + scenario.script);
    const selection = await mfbe.selection.get();
    const after = blocks(await mfbe.doc.get());
    const changed = [];
    let description = false;
    for (const [nodeId, { node, where }] of blocks(before)) {
      const now = after.get(nodeId);
      if (now && JSON.stringify(now.node) !== JSON.stringify(node)) {
        changed.push(`  ${nodeId}: ${textOf(now.node)}`);
        if (where === 'body') await mfbe.doc.replaceNode({ nodeId, type: node.type }, node);
        else description = true;
      }
    }
    if (description) await mfbe.doc.setDescription(before.description);
    lines.push(
      `${scenario.script.slice(0, 3)} from ${scenario.from}: ` +
        `${selection.anchor.nodeId}:${selection.anchor.offset}-${selection.head.nodeId}:${selection.head.offset} ` +
        `${JSON.stringify(selection.text)}`,
      ...changed,
    );
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
