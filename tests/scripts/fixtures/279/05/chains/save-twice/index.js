// Test driver of the conversions of group 05 (FictionBook Editor 2.7.9, 05_Иллюстрации), not a
// bundled script: it runs "Сохранить вложения на накопитель" twice into the same folder through
// mfbe.scripts.run by its FictionBook Editor path, so that the second run meets the files of the
// first: the editor asks about each (the harness answers), and the script reports what was saved.
const SAVE = '05_Иллюстрации\\04_Сохранить вложения на накопитель.js';

export default async function run() {
  await mfbe.scripts.run(SAVE);
  await mfbe.scripts.run(SAVE);
}
