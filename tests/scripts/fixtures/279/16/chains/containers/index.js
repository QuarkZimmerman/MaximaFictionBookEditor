// Test driver of the conversions of group 16 (FictionBook Editor 2.7.9, 16_Поиск форматирования),
// not a bundled script: it runs the converted scripts through mfbe.scripts.run by their
// FictionBook Editor paths - as the 2.7.9 combos run them, `ctx.startedBy` 'script' - and writes
// one line per call to the clipboard: the callee's run() value and the selection it left (UI ids
// of the description blocks' empty paragraphs shown as ui_block). The harness records the
// clipboard in the snapshot's outputs.json; the document must stay as it was.
const GROUP = '16_Поиск форматирования\\';
const SCENARIOS = [
  { script: '146_Выделить следующую аннотацию.js', from: 'n3:0', calls: 3 },
  { script: '145_Выделить предыдущую аннотацию.js', from: 'n78:0', calls: 4 },
  { script: '148_Выделить следующий заголовок.js', from: 'n80:0', calls: 10 },
  { script: '147_Выделить предыдущий заголовок.js', from: 'n78:0', calls: 10 },
  { script: '150_Выделить следующий эпиграф.js', from: 'n3:0', calls: 6 },
  { script: '149_Выделить предыдущий эпиграф.js', from: 'n78:0', calls: 6 },
  { script: '152_Выделить следующую цитату.js', from: 'n16:0', calls: 4 },
  { script: '152_Выделить следующую цитату.js', from: 'n63:0', calls: 3 },
  { script: '151_Выделить предыдущую цитату.js', from: 'n71:0', calls: 3 },
  { script: '151_Выделить предыдущую цитату.js', from: 'n37:0', calls: 3 },
  { script: '154_Выделить следующий стих (poem).js', from: 'n22:0', calls: 5 },
  { script: '153_Выделить предыдущий стих (poem).js', from: 'n53:0', calls: 4 },
  { script: '156_Выделить следующий заголовок стиха.js', from: 'n3:0', calls: 3 },
  { script: '155_Выделить предыдущий заголовок стиха.js', from: 'n78:0', calls: 3 },
  { script: '158_Выделить следующую строфу (stanza).js', from: 'n27:0', calls: 6 },
  { script: '157_Выделить предыдущую строфу (stanza).js', from: 'n37:0', calls: 3 },
  { script: '160_Выделить следующую таблицу.js', from: 'n3:0', calls: 2 },
  { script: '159_Выделить предыдущую таблицу.js', from: 'n78:0', calls: 2 },
  { script: '201_Найти следующие подряд идущие однотипные элементы.js', from: 'n3:0', calls: 5 },
  { script: '200_Найти предыдущие подряд идущие однотипные элементы.js', from: 'n78:0', calls: 5 },
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
