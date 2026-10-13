/**
 * Shared helpers of the editing feature modules: the Body controller of a command context,
 * the "Body view is active and editable" predicate, and a factory turning a ProseMirror
 * command into a registry `Command` (enable state = dry run of the ProseMirror command).
 */

import type { Command as PMCommand } from 'prosemirror-state';

import type { Command, CommandContext, CommandGroup } from '@/app/commands';
import type { AppStore } from '@/model/store';
import {
  getBodyController,
  hasBodyController,
  type BodyEditorController,
} from '@/views/body/bodyEditor';

export interface CommandKeys {
  labelKey?: string;
  tooltipKey: string;
  descriptionKey: string;
}

/** `cmd.<id>.tooltip` / `cmd.<id>.description` keys (plus the menu label key). */
export function cmdKeys(id: string, labelKey?: string): CommandKeys {
  return { labelKey, tooltipKey: `cmd.${id}.tooltip`, descriptionKey: `cmd.${id}.description` };
}

/** Keys of commands added by this story, kept in the `editing` i18n namespace. */
export function editingKeys(name: string, labelKey?: string): CommandKeys {
  return {
    labelKey,
    tooltipKey: `editing.cmd.${name}.tooltip`,
    descriptionKey: `editing.cmd.${name}.description`,
  };
}

export function bodyController(store: AppStore): BodyEditorController | null {
  return hasBodyController(store) ? getBodyController(store) : null;
}

/** The Body view shows an editable document (not Source-only, not another view). */
export function bodyActive(ctx: Pick<CommandContext, 'store'>): boolean {
  const state = ctx.store.getState();
  return state.activeView === 'body' && state.document !== null && !state.sourceOnly;
}

export function bodyEditable(ctx: Pick<CommandContext, 'store'>): boolean {
  const controller = bodyController(ctx.store);
  return bodyActive(ctx) && !!controller && controller.isEditable && !!controller.editorState;
}

export interface PmCommandSpec {
  id: string;
  group: CommandGroup;
  keys: CommandKeys;
  icon?: string;
  command: PMCommand;
  /** Toggle state (menu check mark, pressed toolbar button). */
  checked?: (ctx: CommandContext) => boolean;
  /** Extra enable condition on top of the dry run. */
  enabled?: (ctx: CommandContext) => boolean;
}

/** A registry command backed by a ProseMirror command run on the Body controller. */
export function pmCommand(spec: PmCommandSpec): Command {
  return {
    id: spec.id,
    group: spec.group,
    ...spec.keys,
    icon: spec.icon,
    checked: spec.checked,
    enabled: (ctx) => {
      if (!bodyEditable(ctx)) return false;
      if (spec.enabled && !spec.enabled(ctx)) return false;
      return bodyController(ctx.store)!.canExecute(spec.command);
    },
    run: (ctx) => {
      bodyController(ctx.store)?.execute(spec.command);
    },
  };
}
