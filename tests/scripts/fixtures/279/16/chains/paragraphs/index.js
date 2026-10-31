// Test driver of the conversions of group 16 (FictionBook Editor 2.7.9, 16_Поиск форматирования),
// not a bundled script: it runs the converted scripts through mfbe.scripts.run by their
// FictionBook Editor paths - as the 2.7.9 combos run them, `ctx.startedBy` 'script' - and writes
// one line per call to the clipboard: the callee's run() value and the selection it left (UI ids
// of the description blocks' empty paragraphs shown as ui_block). The harness records the
// clipboard in the snapshot's outputs.json; the document must stay as it was.
const GROUP = '16_Поиск форматирования\\';
const SCENARIOS = [
  { script: '136_Выделить следующий целиком курсивный абзац.js', from: 'n3:0', calls: 7 },
  { script: '135_Выделить предыдущий целиком курсивный абзац.js', from: 'n35:0', calls: 7 },
  { script: '138_Выделить следующий целиком жирный абзац.js', from: 'n3:0', calls: 5 },
  { script: '137_Выделить предыдущий целиком жирный абзац.js', from: 'n34:0', calls: 4 },
  { script: '140_Выделить следующий целиком курсивный и жирный абзац.js', from: 'n3:0', calls: 2 },
  {
    script: '139_Выделить предыдущий целиком курсивный и жирный абзац.js',
    from: 'n35:0',
    calls: 2,
  },
  {
    script: '142_Выделить следующий целиком курсивный, но НЕ целиком жирный абзац.js',
    from: 'n3:0',
    calls: 6,
  },
  {
    script: '141_Выделить предыдущий целиком курсивный, но НЕ целиком жирный абзац.js',
    from: 'n35:0',
    calls: 6,
  },
  {
    script: '144_Выделить следующий целиком жирный, но НЕ целиком курсивный абзац.js',
    from: 'n3:0',
    calls: 4,
  },
  {
    script: '143_Выделить предыдущий целиком жирный, но НЕ целиком курсивный абзац.js',
    from: 'n35:0',
    calls: 3,
  },
  { script: '162_Выделить следующий подзаголовок (любой).js', from: 'n3:0', calls: 7 },
  { script: '161_Выделить предыдущий подзаголовок (любой).js', from: 'n35:0', calls: 7 },
  { script: '164_Выделить следующий подзаголовок (текст).js', from: 'n3:0', calls: 3 },
  { script: '163_Выделить предыдущий подзаголовок (текст).js', from: 'n35:0', calls: 3 },
  { script: '166_Выделить следующий подзаголовок (звездочки).js', from: 'n3:0', calls: 5 },
  { script: '165_Выделить предыдущий подзаголовок (звездочки).js', from: 'n35:0', calls: 5 },
  { script: '168_Выделить следующих авторов текста.js', from: 'n24:0', calls: 3 },
  { script: '167_Выделить предыдущих авторов текста.js', from: 'n35:0', calls: 3 },
  { script: '167_Выделить предыдущих авторов текста.js', from: 'n28:3', calls: 1 },
  { script: '145_Выделить предыдущую аннотацию.js', from: 'n7:0', calls: 2 },
  { script: '146_Выделить следующую аннотацию.js', from: null, calls: 1 },
  { script: '132_Выделить следующую пустую строку.js', from: 'desc:annotation', calls: 4 },
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
