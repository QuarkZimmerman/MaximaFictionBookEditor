// Test driver of the conversions of group 16 (FictionBook Editor 2.7.9, 16_Поиск форматирования),
// not a bundled script: it runs the converted scripts through mfbe.scripts.run by their
// FictionBook Editor paths - as the 2.7.9 combos run them, `ctx.startedBy` 'script' - and writes
// one line per call to the clipboard: the callee's run() value and the selection it left (UI ids
// of the description blocks' empty paragraphs shown as ui_block). The harness records the
// clipboard in the snapshot's outputs.json; the document must stay as it was.
const GROUP = '16_Поиск форматирования\\';
const SCENARIOS = [
  { script: '026_Перейти на следующее совмещение курсива с жирностью.js', from: 'n5:0', calls: 9 },
  { script: '026_Перейти на следующее совмещение курсива с жирностью.js', from: 'n10:5', calls: 1 },
  {
    script: '025_Перейти на предыдущее совмещение курсива с жирностью.js',
    from: 'n10:20',
    calls: 8,
  },
];

function point(p) {
  return `${String(p.nodeId).replace(/^ui_block_\d+$/, 'ui_block')}:${p.offset}`;
}

async function start(from) {
  if (from.startsWith('desc:')) {
    await mfbe.selection.selectNode(from);
    return;
  }
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
    if (scenario.from) await start(scenario.from);
    for (let call = 1; call <= scenario.calls; call += 1) {
      const result = await mfbe.scripts.run(GROUP + scenario.script);
      const selection = await mfbe.selection.get();
      const text = selection.text.length > 30 ? `${selection.text.slice(0, 30)}…` : selection.text;
      lines.push(
        `${scenario.script.slice(0, 3)} from ${scenario.from ?? 'here'} #${call}: ` +
          `${result === undefined ? '(nothing)' : result} ` +
          `${point(selection.anchor)}-${point(selection.head)} ${JSON.stringify(text)}`,
      );
    }
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
