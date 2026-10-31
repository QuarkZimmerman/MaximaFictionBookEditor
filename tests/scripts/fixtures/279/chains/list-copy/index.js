// Test package of the script snapshot suite (tests/scripts/snapshots/chains/suite.json), never
// bundled: a copy of scripts/31_automation/30_run-scripts-by-list with a list of its own, written
// as the template's guidance says - a command with a whole path of the original's installation
// (runScript), one with a path the editor does not have (the original's message; the list goes
// on), and a loop over the titles with the scripts named by their ids. lib/run-list.js is the
// templates' copy, unchanged.
import { listCommands } from './lib/run-list.js';

export default async function run(ctx) {
  const { runScriptInFolder, runScript } = listCommands(ctx);
  // ======================
  // Тут сами пользовательские команды поиска и обработки (the commands of the list):

  await runScript("C:\\Program Files (x86)\\FictionBook Editor\\Scripts\\19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
  await runScriptInFolder("31_Автоматизация\\99_Такого скрипта нет.js");
  await runScriptInFolder("34/caret-to-document-start");
  while ((await runScriptInFolder("16/next-title")) === "Found") {
    await runScriptInFolder("19/paragraphs-to-bold");
  }

  // Конец пользовательских строк с командами (the end of the list)
  // ======================
}
