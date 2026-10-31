// Test package of the script snapshot suite (tests/scripts/snapshots/19/suite.json and
// 34/suite.json) - never bundled. It does what the "combo" scripts of FictionBook Editor 2.7.9
// do with runScriptInFolder: it runs the scripts its prompt names (ids or 2.7.9 paths, separated
// by "|") one after another through mfbe.scripts.run, in one run, each started by a script
// (ctx.startedBy 'script'), and reports in a report window - which the harness records next to
// the snapshot - what each run() returned (null for nothing) and the selection it left.
export default async function run() {
  const plan = await mfbe.ui.prompt('Scripts to run, separated by "|":');
  if (!plan) return;
  const steps = [];
  for (const ref of plan
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const value = await mfbe.scripts.run(ref);
    const selection = await mfbe.selection.get();
    steps.push({
      ref,
      returned: value ?? null,
      anchor: selection ? selection.anchor : null,
      head: selection ? selection.head : null,
      text: selection ? selection.text : null,
    });
  }
  await mfbe.ui.report({ title: 'Script chain', text: JSON.stringify(steps, null, 2) });
}
