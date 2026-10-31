// Test driver of the conversions of group 05 (FictionBook Editor 2.7.9, 05_Иллюстрации), not a
// bundled script: it runs the four picture navigation scripts through mfbe.scripts.run by their
// FictionBook Editor paths - `ctx.startedBy` 'script', as a combo runs them - from given
// selections, and writes one line per call to the clipboard: the callee's run() value and the
// selection it left. The harness records the clipboard in the snapshot's outputs.json; the
// document must stay as it was.
const GROUP = '05_Иллюстрации\\';
const PREVIOUS_BLOCK = "11_Перейти на предыдущую 'блочную' иллюстрацию.js";
const NEXT_BLOCK = "12_Перейти на следующую 'блочную' иллюстрацию.js";
const PREVIOUS_INLINE = '18_Перейти на предыдущую инлайн-иллюстрацию.js';
const NEXT_INLINE = '19_Перейти на следующую инлайн-иллюстрацию.js';
const SCENARIOS = [
  { script: NEXT_BLOCK, from: 'n48:0', calls: 10 },
  { script: PREVIOUS_BLOCK, from: 'n44:13', calls: 9 },
  { script: NEXT_BLOCK, from: 'n13:0-n14:0', calls: 1 },
  { script: PREVIOUS_BLOCK, from: 'n13:0-n14:0', calls: 1 },
  { script: NEXT_INLINE, from: 'n48:0', calls: 9 },
  { script: PREVIOUS_INLINE, from: 'n44:13', calls: 9 },
  { script: NEXT_INLINE, from: 'select:n11', calls: 1 },
  { script: PREVIOUS_INLINE, from: 'select:n11', calls: 1 },
  { script: NEXT_INLINE, from: 'n9:10-n9:20', calls: 1 },
  { script: PREVIOUS_INLINE, from: 'n9:10-n9:20', calls: 1 },
];

function point(p) {
  return `${String(p.nodeId).replace(/^ui_block_\d+$/, 'ui_block')}:${p.offset}`;
}

async function start(from) {
  if (from.startsWith('select:')) {
    await mfbe.selection.selectNode(from.slice('select:'.length));
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
    await start(scenario.from);
    for (let call = 1; call <= scenario.calls; call += 1) {
      const result = await mfbe.scripts.run(GROUP + scenario.script);
      const selection = await mfbe.selection.get();
      lines.push(
        `${scenario.script.slice(0, 2)} from ${scenario.from} #${call}: ` +
          `${result === undefined || result === null ? '(nothing)' : result} ` +
          `${point(selection.anchor)}-${point(selection.head)} ${JSON.stringify(selection.text)}`,
      );
    }
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
