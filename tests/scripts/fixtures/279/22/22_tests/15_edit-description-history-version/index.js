// Test package of the suite (not bundled): runs 22/edit-description-as-text with the settings below
// (the names of its section НАСТРОЙКИ) and the date taken as today.
export default async function run(ctx) {
  return mfbe.scripts.run('22/edit-description-as-text', { Pause: 0, Vsegda_on_off: 1, today: '2026-10-31' });
}
