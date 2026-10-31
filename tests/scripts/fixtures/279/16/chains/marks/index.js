// Test driver of the recheck of group 16's packages 01-24 (FictionBook Editor 2.7.9,
// 16_Поиск форматирования 001-024: "Перейти на предыдущий / следующий ..."), not a bundled script:
// it runs the packages through mfbe.scripts.run by their FictionBook Editor 2.7.9 paths - as the
// 2.7.9 combos run them, `ctx.startedBy` 'script' - from given selections, and writes one line per
// call to the clipboard: the callee's run() value and the selection it left, or the error code of a
// reference that does not resolve. The harness records the clipboard in the snapshot's
// outputs.json; the document must stay as it was.
// Book tests/scripts/fixtures/279/16/marks.fb2; the suite answers the first two questions (the
// first two scenarios) with Cancel, every other message box with OK.
const SCENARIOS = [
  { script: '002_Перейти на следующий курсив.js', from: 'n23:26', calls: 1 },
  { script: '023_Перейти на предыдущий абзац, содержащий код.js', from: 'n28:0', calls: 1 },
  { script: '002_Перейти на следующий курсив.js', from: 'n28:0', calls: 10 },
  { script: '001_Перейти на предыдущий курсив.js', from: 'n26:36', calls: 10 },
  { script: '004_Перейти на следующий абзац с курсивом.js', from: 'n28:0', calls: 6 },
  { script: '003_Перейти на предыдущий абзац с курсивом.js', from: 'n26:36', calls: 7 },
  { script: '002_Перейти на следующий курсив.js', from: 'n7:15-n7:23', calls: 1 },
  { script: '001_Перейти на предыдущий курсив.js', from: 'n7:15-n7:23', calls: 1 },
  { script: '002_Перейти на следующий курсив.js', from: 'n9:12-n9:13', calls: 1 },
  { script: '001_Перейти на предыдущий курсив.js', from: 'n9:12-n9:13', calls: 1 },
  { script: '006_Перейти на следующую жирность.js', from: 'n28:0', calls: 5 },
  { script: '005_Перейти на предыдущую жирность.js', from: 'n26:36', calls: 5 },
  { script: '008_Перейти на следующий абзац с жирностью.js', from: 'n28:0', calls: 5 },
  { script: '007_Перейти на предыдущий абзац с жирностью.js', from: 'n26:36', calls: 5 },
  { script: '010_Перейти на следующий верхний индекс.js', from: 'n28:0', calls: 2 },
  { script: '009_Перейти на предыдущий верхний индекс.js', from: 'n26:36', calls: 2 },
  { script: '012_Перейти на следующий абзац с верхним индексом.js', from: 'n28:0', calls: 2 },
  { script: '012_Перейти на следующий абзац с верхним индексом.js', from: 'n13:49', calls: 1 },
  { script: '011_Перейти на предыдущий абзац с верхним индексом.js', from: 'n26:36', calls: 2 },
  { script: '011_Перейти на предыдущий абзац с верхним индексом.js', from: 'n13:0', calls: 1 },
  { script: '009_Перейти на предыдущий верхний индекс.js', from: 'n13:20', calls: 1 },
  { script: '010_Перейти на следующий верхний индекс.js', from: 'n13:20', calls: 1 },
  { script: '014_Перейти на следующий нижний индекс.js', from: 'n28:0', calls: 4 },
  { script: '013_Перейти на предыдущий нижний индекс.js', from: 'n26:36', calls: 4 },
  { script: '016_Перейти на следующий абзац с нижним индексом.js', from: 'n28:0', calls: 4 },
  { script: '015_Перейти на предыдущий абзац с нижним индексом.js', from: 'n26:36', calls: 4 },
  { script: '018_Перейти на следующее зачеркивание.js', from: 'n28:0', calls: 4 },
  { script: '017_Перейти на предыдущее зачеркивание.js', from: 'n26:36', calls: 4 },
  { script: '020_Перейти на следующий абзац, содержащий зачеркивание.js', from: 'n28:0', calls: 4 },
  {
    script: '019_Перейти на предыдущий абзац, содержащий зачеркивание.js',
    from: 'n26:36',
    calls: 4,
  },
  { script: '022_Перейти на следующий код.js', from: 'n28:0', calls: 4 },
  { script: '021_Перейти на предыдущий код.js', from: 'n26:36', calls: 4 },
  { script: '024_Перейти на следующий абзац, содержащий код.js', from: 'n28:0', calls: 4 },
  { script: '023_Перейти на предыдущий абзац, содержащий код.js', from: 'n26:36', calls: 4 },
  {
    label: 'ref 12_Перейти',
    ref: '16_Поиск форматирования\\12_Перейти на следующий абзац с верхним индексом.js',
    from: 'n28:0',
    calls: 1,
  },
  {
    label: 'ref 24_Перейти',
    ref: '16_Поиск форматирования\\24_Перейти на следующий абзац, содержащий код.js',
    from: 'n28:0',
    calls: 1,
  },
  {
    label: 'ref 12_Переход',
    ref: '16_Поиск форматирования\\12_Переход на следующий абзац с верхним индексом.js',
    from: 'n28:0',
    calls: 1,
  },
  {
    label: 'ref \\012_Перейти',
    ref: '\\16_Поиск форматирования\\012_Перейти на следующий абзац с верхним индексом.js',
    from: 'n28:0',
    calls: 1,
  },
  {
    label: 'ref 16/next-paragraph-with-code',
    ref: '16/next-paragraph-with-code',
    from: 'n28:0',
    calls: 1,
  },
];
const GROUP = '16_Поиск форматирования\\';

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
    if (scenario.from) await start(scenario.from);
    const ref = scenario.ref ?? GROUP + scenario.script;
    const label = scenario.label ?? scenario.script.slice(0, 3);
    for (let call = 1; call <= scenario.calls; call += 1) {
      let result;
      try {
        const value = await mfbe.scripts.run(ref);
        result = value == null ? '(nothing)' : value;
      } catch (error) {
        result = `error ${error.code ?? error.message}`;
      }
      const selection = await mfbe.selection.get();
      const text = selection.text.length > 30 ? `${selection.text.slice(0, 30)}…` : selection.text;
      lines.push(
        `${label} from ${scenario.from ?? 'here'} #${call}: ${result} ` +
          `${point(selection.anchor)}-${point(selection.head)} ${JSON.stringify(text)}`,
      );
    }
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
