// Test package of the suite (not bundled): runs 22/edit-description-as-text with the settings below
// (the names of its section НАСТРОЙКИ) and the date taken as today.
export default async function run(ctx) {
  return mfbe.scripts.run('22/edit-description-as-text', { ShowEmpty: 0, FIO: 0, Delenie: 0, Sortirovka: 1, ShowSequenceTI: 0, ShowAuthorDI: 0, Pojasnenie: 0 });
}
