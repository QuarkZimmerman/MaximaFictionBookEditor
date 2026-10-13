/**
 * Container operations of the Edit menu (T060): Clone container (Ctrl+Enter), Split container
 * (Shift+Enter), Merge containers (Alt+Delete) and Remove outer container (Ctrl+Alt+Space),
 * implemented by `editor/commands/structure.ts` and enabled only where the result stays
 * schema-valid.
 */

import type { CommandRegistry } from '@/app/commands';
import {
  cloneContainer,
  mergeContainers,
  removeOuterContainer,
  splitContainer,
} from '@/editor/commands/structure';

import { cmdKeys, pmCommand } from './editing/common';

export function registerStructureCommands(registry: CommandRegistry): void {
  const commands = [
    pmCommand({
      id: 'edit.clone',
      group: 'edit',
      keys: cmdKeys('edit.clone', 'menu.edit.clone'),
      command: cloneContainer,
    }),
    pmCommand({
      id: 'edit.split',
      group: 'edit',
      keys: cmdKeys('edit.split', 'menu.edit.split'),
      command: splitContainer,
    }),
    pmCommand({
      id: 'edit.merge',
      group: 'edit',
      keys: cmdKeys('edit.merge', 'menu.edit.merge'),
      command: mergeContainers,
    }),
    pmCommand({
      id: 'edit.removeOuter',
      group: 'edit',
      keys: cmdKeys('edit.removeOuter', 'menu.edit.removeOuter'),
      command: removeOuterContainer,
    }),
  ];
  for (const command of commands) registry.replace(command);
}

export { cloneContainer, mergeContainers, removeOuterContainer, splitContainer };
