// Test package of the suite (not bundled): 22/edit-description-as-text with Pause = 0 (the lists
// are not shown, so they are cleaned where they are), sorted names, a repeated source language
// removed (DelLang = 0) and no history line.
export default async function run(ctx) {
  return mfbe.scripts.run('22/edit-description-as-text', { Pause: 0, Sortirovka: 1, DelLang: 0, Version_on_off: 0 });
}
