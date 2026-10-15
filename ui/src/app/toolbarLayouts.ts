/**
 * Toolbar layouts (feature 002 FR-062, FR-063; data-model §4): the buttons of the Commands and
 * Scripts toolbars in order, kept per user in `session.toolbarLayouts` as lists of item ids with
 * "-" for a separator. The original layouts are the defaults and what Reset restores: the
 * Commands toolbar's original buttons and separators, and "Last script" alone on the Scripts
 * toolbar. A script button is stored by its script id, so scripts added or removed later never
 * re-target it; a button whose script is gone is not shown.
 */

import type { Settings } from '@/rpc/types';
import { actions, type AppStore } from '@/model/store';

import type { CommandContext } from './commands';
import { COMMANDS_TOOLBAR } from './toolbarDefinitions';

export type CustomizableToolbar = 'commands' | 'scripts';

/** A separator in a stored layout. */
export const SEPARATOR = '-';

/** The Scripts toolbar's "Last script" button (its command id). */
export const LAST_SCRIPT = 'scripts.last';

/** The Commands toolbar's buttons (its original layout without the separators). */
const COMMAND_BUTTONS: readonly string[] = COMMANDS_TOOLBAR.filter(
  (id): id is string => id !== null,
);

/** The original layout of a toolbar, which Reset restores. */
export function originalLayout(toolbar: CustomizableToolbar): string[] {
  return toolbar === 'commands' ? COMMANDS_TOOLBAR.map((id) => id ?? SEPARATOR) : [LAST_SCRIPT];
}

/**
 * The buttons a toolbar offers besides separators: the Commands toolbar's original buttons;
 * "Last script" and the given scripts (command ids of the menu scripts with an icon).
 */
export function availableButtons(
  toolbar: CustomizableToolbar,
  scriptCommandIds: readonly string[] = [],
): string[] {
  return toolbar === 'commands' ? [...COMMAND_BUTTONS] : [LAST_SCRIPT, ...scriptCommandIds];
}

/**
 * The buttons a toolbar shows: the stored layout (else the original one) without the items the
 * toolbar does not offer - among them the buttons of scripts that are gone - and without a
 * button's second appearance.
 */
export function shownLayout(
  settings: Settings | null,
  toolbar: CustomizableToolbar,
  scriptCommandIds: readonly string[] = [],
): string[] {
  const offered = new Set(availableButtons(toolbar, scriptCommandIds));
  const shown = new Set<string>();
  const stored = settings?.session.toolbarLayouts?.[toolbar] ?? originalLayout(toolbar);
  return stored.filter((item) => {
    if (item === SEPARATOR) return true;
    if (!offered.has(item) || shown.has(item)) return false;
    shown.add(item);
    return true;
  });
}

/** Stores a toolbar's layout (null: back to the original), at once and for the next start. */
export async function saveLayout(
  ctx: Pick<CommandContext, 'store' | 'rpc'>,
  toolbar: CustomizableToolbar,
  items: string[] | null,
): Promise<void> {
  applyLocally(ctx.store, toolbar, items);
  if (!ctx.rpc) return;
  actions.countLayoutSave(ctx.store, 1);
  try {
    await ctx.rpc.call('settings.set', {
      patch: { session: { toolbarLayouts: { [toolbar]: items } } },
    });
  } catch {
    // The layout still applies for this session.
  } finally {
    actions.countLayoutSave(ctx.store, -1);
  }
}

function applyLocally(store: AppStore, toolbar: CustomizableToolbar, items: string[] | null): void {
  const settings = store.getState().settings;
  if (!settings) return;
  const layouts = { ...settings.session.toolbarLayouts };
  if (items) layouts[toolbar] = items;
  else delete layouts[toolbar];
  store.setState({
    settings: { ...settings, session: { ...settings.session, toolbarLayouts: layouts } },
  });
}
