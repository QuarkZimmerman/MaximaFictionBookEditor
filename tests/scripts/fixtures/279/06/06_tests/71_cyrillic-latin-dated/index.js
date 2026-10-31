// Test runner of the snapshot suite (tests/scripts/snapshots/06/suite.json), not a bundled script:
// runs 06/cyrillic-latin (06_Чистка/71_Кириллица-латиница.js of FictionBook Editor 2.7.9) with the
// date its history entry carries fixed, so that the snapshot does not depend on the day of the run.
export default async function run() {
  await mfbe.scripts.run('06/cyrillic-latin', { today: '2025-05-10' });
}
