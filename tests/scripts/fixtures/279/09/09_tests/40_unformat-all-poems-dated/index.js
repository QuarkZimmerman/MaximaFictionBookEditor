// Test runner of the snapshot suite (tests/scripts/snapshots/09/suite.json), not a bundled script:
// runs 09/unformat-all-poems (09_Стихи/40_Расформатировать все стихи.js of FictionBook Editor
// 2.7.9) with the date its history entry carries fixed, so that the snapshot does not depend on
// the day of the run.
export default async function run() {
  await mfbe.scripts.run('09/unformat-all-poems', { today: '2025-05-10' });
}
