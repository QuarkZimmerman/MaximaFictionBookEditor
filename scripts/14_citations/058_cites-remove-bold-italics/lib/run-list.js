// The runner of FictionBook Editor 2.7.9's "Запуск скриптов по списку" (Sclex) and of the scripts
// built on it - the combos and templates of groups 05, 09, 13, 14, 31 and 37. Their
// runScriptInFolder(path) and runScript(path) loaded another script of the Scripts folder into the
// editor's page and called its Run(), giving back what that Run() returned; a script that could
// not be loaded showed "Скрипт ... не был запущен ...", gave back nothing, and the list went on
// with its next line.
//
// Here both commands run the script through mfbe.scripts.run in the same run: the script whose
// manifest names that path in legacy.source (backslashes or slashes, letter case, a leading
// backslash and everything up to a "Scripts" folder do not count, so a whole path of the original's
// installation works too) or the script with that id. They resolve with what its run() returned
// (nothing: null). The whole list is one run - one undo step under this script's name, one Cancel
// that stops every script of it and leaves the book as it was - and a chain is at most 8 scripts
// deep. A script that is not found shows the original's message and gives back nothing; one that
// needs a selection when there is none shows the editor's message and gives back nothing, as such a
// script refused to work in 2.7.9; any other error of a script ends the whole run.
// Each package carries its own copy of this file (the sandbox loads modules from the script's own
// folder only); the copies are identical.

/** The text of the interface language: Russian in the Russian interface, English otherwise. */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/**
 * The commands of a list, bound to the run: `runScriptInFolder(ref)` and `runScript(ref)` (the
 * same command here: the editor knows its scripts' folders) resolve with the run() value of the
 * script `ref` names - a FictionBook Editor path or an id.
 */
export function listCommands(ctx) {
  async function runScriptInFolder(ref) {
    try {
      return await mfbe.scripts.run(ref);
    } catch (error) {
      if (error?.code === 'scripts.notFound') {
        await mfbe.ui.message(
          t(
            ctx,
            `Скрипт\n\n${ref}\n\nне был запущен, т.к. не удалось его успешно загрузить.\n\n` +
              'Возможная причина – файл скрипта отсутствует по тому пути, где он должен находиться.',
            `The script\n\n${ref}\n\nwas not run, since it could not be loaded.\n\n` +
              'A possible reason: the script file is not at the path where it should be.',
          ),
          { icon: 'warning' },
        );
        return undefined;
      }
      if (error?.code === 'scripts.needsSelection') {
        await mfbe.ui.message(error.message, { icon: 'warning' });
        return undefined;
      }
      throw error;
    }
  }
  return { runScriptInFolder, runScript: runScriptInFolder };
}
