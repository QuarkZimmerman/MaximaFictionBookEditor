// Test driver of the conversions of group 18 (FictionBook Editor 2.7.9, 18_Мелочи редактирования),
// not a bundled script: as chains/editing, on a book whose body has a picture and then a title
// that starts with an empty line, and whose notes body and poem have titles.
const GROUP = '18_Мелочи редактирования\\';
const POEM = '01_Вставить заголовок стиха.js';
const BODY = '02_Вставить заголовок body.js';
const SCENARIOS = [
  { script: BODY, from: 'n7:3' }, // the title after the picture: the caret to its first paragraph
  { script: BODY, from: 'n17:2' }, // the notes body's title
  { script: POEM, from: 'n12:2' }, // the poem's title
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
    const result = await mfbe.scripts.run(GROUP + scenario.script);
    const selection = await mfbe.selection.get();
    lines.push(
      `${scenario.script.slice(0, 2)} from ${scenario.from}: ${result === undefined ? '(nothing)' : result} ` +
        `${point(selection.anchor)}-${point(selection.head)} ${JSON.stringify(selection.text)}`,
    );
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
