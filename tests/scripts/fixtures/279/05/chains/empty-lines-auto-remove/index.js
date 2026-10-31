// Test driver of the conversions of group 05 (FictionBook Editor 2.7.9, 05_Иллюстрации), not a
// bundled script: runs "Пустые строки рядом с иллюстрациями" through mfbe.scripts.run by its
// FictionBook Editor path with the original's settings set as a user sets them in the script
// (Posle_illjustratsii, Pered_illjustratsiej, Mezhdu_illjustratsijami: 0, 0, 0) and a fixed
// date for the line it writes into the history, so that the snapshot does not depend on the day.
export default async function run() {
  return mfbe.scripts.run('05_Иллюстрации\\13_Пустые строки рядом с иллюстрациями.js', {
    Posle_illjustratsii: 0,
    Pered_illjustratsiej: 0,
    Mezhdu_illjustratsijami: 0,
    today: '2026-11-10',
  });
}
