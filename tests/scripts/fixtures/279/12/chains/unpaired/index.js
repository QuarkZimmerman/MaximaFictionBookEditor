// Test driver of the conversions of group 12 (FictionBook Editor 2.7.9, 12_Обработка кавычек 020
// and 025), not a bundled script: it runs the searches through mfbe.scripts.run by their
// FictionBook Editor paths, from given carets and then again from the selection each call left,
// and writes one line per call to the clipboard: the callee's run() value and the selection it
// left. The harness records the clipboard in the snapshot's outputs.json; the book stays as it
// was. The messages "nothing found" are answered by the harness.
const GROUP = '12_Обработка кавычек\\';
const TRADITIONAL = '020_Поиск абзацев с непарными скобками и кавычками („традиционные“ лапки).js';
const ALTERNATIVE = '025_Поиск абзацев с непарными скобками и кавычками (“альтернативные” лапки).js';
const SCENARIOS = [
  { script: TRADITIONAL, from: 'n30:0', calls: 11 },
  { script: ALTERNATIVE, from: 'n30:0', calls: 11 },
  { script: TRADITIONAL, from: 'n8:5', calls: 1 }, // after the list marker's bracket
  { script: TRADITIONAL, from: 'n30:20', calls: 1 }, // at the end of the annotation's paragraph
  { script: ALTERNATIVE, from: 'n6:0-n6:20', calls: 1 }, // a selection: from its end
  { script: ALTERNATIVE, from: 'n28:21', calls: 1 }, // at the end of the book: nothing
];

function point(p) {
  return `${String(p.nodeId).replace(/^ui_block_\d+$/, 'ui_block')}:${p.offset}`;
}

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
    await start(scenario.from);
    for (let call = 1; call <= scenario.calls; call += 1) {
      const result = await mfbe.scripts.run(GROUP + scenario.script);
      const selection = await mfbe.selection.get();
      const text = selection.text.length > 30 ? `${selection.text.slice(0, 30)}…` : selection.text;
      lines.push(
        `${scenario.script.slice(0, 3)} from ${scenario.from} #${call}: ` +
          `${result === undefined ? '(nothing)' : result} ` +
          `${point(selection.anchor)}-${point(selection.head)} ${JSON.stringify(text)}`,
      );
    }
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
