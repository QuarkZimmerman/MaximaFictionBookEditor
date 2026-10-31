// Test package of the suite (not bundled): sets a selection, runs a script of group 30 through
// mfbe.scripts.run - one after another on the same book, each on a part the others leave alone -
// and reports what each returned and the selection it left (the originals re-selected the
// selection between their two markers, which moved with the text). The harness records the
// report next to the snapshot.
const STEPS = [
  { ref: '30/number-with-dot', from: ['n10', 5], to: ['n30', 8] },
  { ref: '30/remove-numbering-layer', from: ['n34', 2], to: ['n36', 0] },
  { ref: '30/remove-dot-numbering-layer', from: ['n36', 6], to: ['n37', 3] },
  { ref: '30/number-with-parenthesis', from: ['n59', 3], to: ['n6', 5] },
  { ref: '30/remove-all-numbering', from: ['n41', 1], to: ['n43', 5] },
];

export default async function run() {
  const steps = [];
  for (const step of STEPS) {
    await mfbe.selection.set({ nodeId: step.from[0], offset: step.from[1] }, { nodeId: step.to[0], offset: step.to[1] });
    const value = await mfbe.scripts.run(step.ref);
    const selection = await mfbe.selection.get();
    steps.push({
      ref: step.ref,
      selected: `${step.from.join(':')}-${step.to.join(':')}`,
      returned: value ?? null,
      anchor: selection ? `${selection.anchor.nodeId}:${selection.anchor.offset}` : null,
      head: selection ? `${selection.head.nodeId}:${selection.head.offset}` : null,
      text: selection ? selection.text : null,
    });
  }
  await mfbe.ui.report({ title: 'Selections', text: JSON.stringify(steps, null, 2) });
}
