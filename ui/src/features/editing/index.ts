/**
 * Body editing feature registrar (US2, T057-T070). Called once by `createAppServices()`:
 *
 *  - creates the persistent Body controller (`views/body/bodyEditor.ts`) and keeps it fed with
 *    the store's document; registers its undo adapter (`body` view of the UndoCoordinator) and
 *    caret provider;
 *  - replaces the editing stubs of the command registry: Add menu (`insert.*`), Style menu
 *    (`style.*`), container operations (`edit.clone|split|merge|removeOuter`), links and
 *    footnotes, clipboard (`edit.cut|copy|paste`), Find / Replace / Find Next / incremental
 *    search, non-breaking space and symbols, the navigation focus commands.
 */

import type { Command } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { getSpellPlugin } from '@/features/spell';
import { isRunLocked } from '@/model/store';
import {
  BODY_MODEL_UNDO_VIEW,
  getBodyController,
  type BodyEditorController,
} from '@/views/body/bodyEditor';

import { registerClipboardCommands } from '../clipboard';
import { registerFootnoteCommands } from '../footnotes';
import { BodySearchTarget } from '../search/bodyTarget';
import { IncrementalSearch, registerIncrementalSearch } from '../search/incremental';
import { getSearchSession, registerSearchCommands } from '../search/search';
import { registerStructureCommands } from '../structure';
import { registerSymbolCommands, SymbolsFeature } from '../symbols';

import { canFocusBarField, focusBarField, type BarField } from './barFocus';
import { registerBodyCommands } from './bodyCommands';
import { bodyActive, cmdKeys } from './common';

export { bodyActive, bodyEditable } from './common';

const symbolFeatures = new WeakMap<FeatureContext['store'], SymbolsFeature>();

/** The symbols loader of a store (used by the Body view once the core is connected). */
export function getSymbolsFeature(store: FeatureContext['store']): SymbolsFeature | undefined {
  return symbolFeatures.get(store);
}

/** Creates the controller, wires it to the store and the undo coordinator. */
export function installBodyEditor(ctx: FeatureContext): BodyEditorController {
  const { store, undo, carets } = ctx;
  const controller = getBodyController(store, undo, {
    editable: true,
    plugins: [getSpellPlugin(store)],
  });

  undo.registerView('body', {
    undo: () => controller.undoStep(),
    redo: () => controller.redoStep(),
    get canUndo() {
      return controller.canUndo;
    },
    get canRedo() {
      return controller.canRedo;
    },
  });
  undo.registerView(BODY_MODEL_UNDO_VIEW, {
    undo: () => controller.undoModelStep(),
    redo: () => controller.redoModelStep(),
    get canUndo() {
      return controller.canUndoModelStep;
    },
    get canRedo() {
      return controller.canRedoModelStep;
    },
  });
  carets.register('body', {
    get: () => controller.getCaret(),
    set: (caret) => controller.setCaret(caret),
  });

  const initial = store.getState();
  controller.setModel(initial.document, initial.docId);
  controller.setLocked(isRunLocked(initial));
  store.subscribe((state, previous) => {
    if (state.document !== previous.document || state.docId !== previous.docId) {
      controller.setModel(state.document, state.docId);
    }
    // The run lock (a script run or an AI request): locked while it is held, whoever holds it.
    const locked = isRunLocked(state);
    if (locked !== isRunLocked(previous)) controller.setLocked(locked);
  });
  return controller;
}

function navCommand(id: string, field: BarField): Command {
  return {
    id,
    group: 'navigation',
    ...cmdKeys(id),
    enabled: (ctx) => bodyActive(ctx) && canFocusBarField(field),
    run: () => {
      focusBarField(field);
    },
  };
}

export function registerEditingFeature(ctx: FeatureContext): void {
  const { commands, store, undo, hotkeys } = ctx;
  const controller = installBodyEditor(ctx);

  registerBodyCommands(commands, controller);
  registerStructureCommands(commands);
  registerFootnoteCommands(commands);
  registerClipboardCommands(commands);
  registerSymbolCommands(commands, hotkeys);
  symbolFeatures.set(store, new SymbolsFeature(commands, hotkeys, store));

  const search = getSearchSession(store, undo);
  search.setBeep(() => {
    if (ctx.rpc && store.getState().connection === 'connected') {
      ctx.rpc.call('app.beep', { kind: 'searchWrap' }).catch(() => {
        // an older core has no beep; the search itself went on
      });
    }
  });
  search.registerTarget(new BodySearchTarget(controller));
  registerSearchCommands(commands, search);
  const incremental = new IncrementalSearch(store, search);
  registerIncrementalSearch(commands, incremental, search);

  // Links / Table bar focus hotkeys. `nav.selectText` (Escape) stays a stub: a global Escape
  // binding would swallow the key before menus and the incremental search see it.
  commands.replace(navCommand('nav.selectId', 'id'));
  commands.replace(navCommand('nav.selectHref', 'href'));
  commands.replace(navCommand('nav.selectTableId', 'tableId'));
}
