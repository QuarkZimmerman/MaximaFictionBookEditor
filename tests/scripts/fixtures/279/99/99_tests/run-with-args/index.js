// Test package of the script snapshot suite (tests/scripts/snapshots/99/suite.json) - never
// bundled. Its prompt takes {"ref": "<id or 2.7.9 path>", "args": {...}}: it runs that script
// through mfbe.scripts.run with those args (ctx.startedBy 'script') and reports, in a report
// window the harness records next to the snapshot, what the script's run() returned.
export default async function run() {
  const plan = await mfbe.ui.prompt('{"ref": "...", "args": {...}}');
  if (!plan) return;
  const { ref, args } = JSON.parse(plan);
  const value = await mfbe.scripts.run(ref, args ?? {});
  await mfbe.ui.report({ title: 'Returned', text: typeof value === 'string' ? value : JSON.stringify(value) });
}
