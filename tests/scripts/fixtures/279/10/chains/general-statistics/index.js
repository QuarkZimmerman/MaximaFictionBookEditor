// Test driver of "Общая статистика" (FictionBook Editor 2.7.9, 10_Статистика\07), not a bundled
// script: it runs the conversion through mfbe.scripts.run by its 2.7.9 path - the harness
// answers its pages and its two questions - and then reads what it put on the clipboard and
// writes it back with the run's time and the current date and time replaced by placeholders,
// so that the harness records a text that does not depend on the moment of the run.
const SCRIPT = '10_Статистика\\07_Общая статистика.js';

export default async function run() {
  const result = await mfbe.scripts.run(SCRIPT);
  const text = await mfbe.clipboard.readText();
  const stable = text
    .replace(/^(• (?:Время выполнения|Time)[ .]*\t).*$/m, '$1<время>')
    .replace(/^• \d{1,2}\.\d\d\.\d\d • \d{1,2}:\d\d:\d\d •$/m, '• <дата> • <время> •');
  await mfbe.clipboard.writeText(`run() returned ${JSON.stringify(result)}\n${stable}`);
}
