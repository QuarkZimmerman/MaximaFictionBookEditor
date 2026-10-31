// Test driver of the conversions of group 02 (FictionBook Editor 2.7.9, 02_Примечания), not a
// bundled script: it runs the three searches through mfbe.scripts.run by their FictionBook Editor
// paths, from the given caret, again and again as a user presses the button, and writes one line
// per call to the clipboard: the callee's run() value (null: the originals return nothing) and
// the selection it left. The harness records the clipboard in the snapshot's outputs.json; the
// document must stay as it was.
const GROUP = '02_Примечания\\';
const SCENARIOS = [
  { script: '31_Расширенный поиск возможных сносок.js', from: 'n5:0', calls: 11 },
  { script: '31_Расширенный поиск возможных сносок.js', from: 'n8:5', calls: 1 },
  { script: '32_Поиск возможных сносок (без скобок).js', from: 'n5:0', calls: 11 },
  { script: '35_Поиск возможных маркеров сносок.js', from: 'n5:0', calls: 14 },
  { script: '35_Поиск возможных маркеров сносок.js', from: 'n8:5', calls: 1 },
];

function point(p) {
  return `${p.nodeId}:${p.offset}`;
}

async function start(from) {
  const [nodeId, offset] = from.split(':');
  await mfbe.selection.set({ nodeId, offset: Number(offset) });
}

export default async function run() {
  const lines = [];
  for (const scenario of SCENARIOS) {
    await start(scenario.from);
    for (let call = 1; call <= scenario.calls; call += 1) {
      const result = await mfbe.scripts.run(GROUP + scenario.script);
      const selection = await mfbe.selection.get();
      lines.push(
        `${scenario.script.slice(0, 2)} from ${scenario.from} #${call}: ${result === undefined ? '(nothing)' : result} ` +
          `${point(selection.anchor)}-${point(selection.head)} ${JSON.stringify(selection.text)}`,
      );
    }
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
