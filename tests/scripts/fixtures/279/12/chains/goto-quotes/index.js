// Test driver of the recheck of group 12 (feature 007, T082: 12_Обработка кавычек 008-015
// against FictionBook Editor 2.7.9), not a bundled script. It runs the "Перейти на ..." scripts
// through mfbe.scripts.run by their 2.7.9 paths, from given carets or selections and then again
// from the selection each call left, and writes one line per call to the clipboard: the callee's
// run() value and the selection it left. The book stays as it was. The harness answers the
// questions and messages: the first question with Cancel (--answer cancel), every later one OK.
const GROUP = '12_Обработка кавычек\\';
const SCENARIOS = [
  { script: '009_Перейти на следующие елочки.js', from: 'n29:29', calls: 1 }, // Cancel at the question
  { script: '009_Перейти на следующие елочки.js', from: 'n31:0', calls: 8 },
  { script: '008_Перейти на предыдущие елочки.js', from: 'n29:29', calls: 8 },
  { script: '011_Перейти на следующие лапки.js', from: 'n31:0', calls: 3 },
  { script: '010_Перейти на предыдущие лапки.js', from: 'n29:29', calls: 3 },
  { script: '013_Перейти на следующие прямые кавычки.js', from: 'n9:0', calls: 4 },
  { script: '012_Перейти на предыдущие прямые кавычки.js', from: 'n15:0', calls: 4 },
  { script: '015_Перейти на следующие прямые кавычки, елочки или лапки.js', from: 'n33:0', calls: 4 },
  { script: '014_Перейти на предыдущие прямые кавычки, елочки или лапки.js', from: 'n7:0', calls: 4 },
  { script: '009_Перейти на следующие елочки.js', from: 'n31:0-n29:29', calls: 1 }, // all selected
  { script: '008_Перейти на предыдущие елочки.js', from: 'n31:0-n29:29', calls: 1 },
  { script: '014_Перейти на предыдущие прямые кавычки, елочки или лапки.js', from: 'n8:30-n8:45', calls: 1 },
  { script: '015_Перейти на следующие прямые кавычки, елочки или лапки.js', from: 'n8:30-n8:45', calls: 1 },
];

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
          `${selection.anchor.nodeId}:${selection.anchor.offset}-${selection.head.nodeId}:${selection.head.offset} ${JSON.stringify(text)}`,
      );
    }
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
