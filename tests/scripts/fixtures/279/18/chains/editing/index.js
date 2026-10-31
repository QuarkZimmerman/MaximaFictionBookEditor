// Test driver of the conversions of group 18 (FictionBook Editor 2.7.9, 18_Мелочи редактирования),
// not a bundled script: it runs the converted scripts through mfbe.scripts.run by their
// FictionBook Editor paths from given selections and writes one line per call to the clipboard:
// the callee's run() value and the selection it left. The harness records the clipboard in the
// snapshot's outputs.json; the snapshot shows the book after all the calls of the chain.
const GROUP = '18_Мелочи редактирования\\';
const POEM = '01_Вставить заголовок стиха.js';
const BODY = '02_Вставить заголовок body.js';
const UNDERSCORES = '20_Удалить все символы подчеркивания в выделении.js';
const MOJIBAKE = '39_Исправление крякозябров (кривые кодировки).js';
const SCENARIOS = [
  { script: POEM, from: 'n20:3' }, // a poem with a title: the caret goes to it
  { script: POEM, from: 'n14:5' }, // a poem without one: a title before its epigraph
  { script: POEM, from: 'n23:2' }, // the third poem: a title before its stanza
  { script: POEM, from: 'n24:4' }, // from its text author: its title (inserted just before)
  { script: POEM, from: 'n8:3' }, // outside a poem: nothing
  { script: POEM, from: 'n14:0-n14:5' }, // a selection: the message, nothing else
  { script: BODY, from: 'n8:2' }, // the main body (a picture first): its title after it
  { script: BODY, from: 'n4:1' }, // again, from the body's epigraph: the new title
  { script: BODY, from: 'n29:2' }, // the notes body
  { script: BODY, from: 'n31:2' }, // the annotation is no body: nothing
  { script: UNDERSCORES, from: 'n8:4-n9:30' },
  { script: MOJIBAKE, from: 'n25:0-n26:13' },
  { script: POEM, from: 'n34:2' }, // a poem of the book's annotation
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
    const text = selection.text.length > 40 ? `${selection.text.slice(0, 40)}…` : selection.text;
    lines.push(
      `${scenario.script.slice(0, 2)} from ${scenario.from}: ${result === undefined ? '(nothing)' : result} ` +
        `${point(selection.anchor)}-${point(selection.head)} ${JSON.stringify(text)}`,
    );
  }
  await mfbe.clipboard.writeText(`${lines.join('\n')}\n`);
}
