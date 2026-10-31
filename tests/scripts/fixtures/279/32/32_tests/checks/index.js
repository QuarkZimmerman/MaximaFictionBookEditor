// Test package of the suite (not bundled): runs the scripts its prompt names (ids, separated by
// "|") one after another, each from the start of the Body view, and reports what each returned
// and the selection it left (a description block's empty paragraph, which has a UI id of its own,
// shown as ui_block). The harness answers the scripts' dialogs and records the report next to the
// snapshot.
function point(p) {
  return `${String(p.nodeId).replace(/^ui_block_\d+$/, 'ui_block')}:${p.offset}`;
}

export default async function run() {
  const plan = await mfbe.ui.prompt('Scripts to run, separated by "|":');
  if (!plan) return;
  const steps = [];
  for (const ref of plan
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)) {
    await mfbe.selection.selectNode('desc:annotation');
    const value = await mfbe.scripts.run(ref);
    const selection = await mfbe.selection.get();
    steps.push({
      ref,
      returned: value ?? null,
      selection: selection ? `${point(selection.anchor)}-${point(selection.head)}` : null,
      text: selection ? selection.text : null,
    });
  }
  await mfbe.ui.report({ title: 'Footnote marker scripts', text: JSON.stringify(steps, null, 2) });
}
