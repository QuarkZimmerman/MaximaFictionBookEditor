// Feature 010, US9 (T071; D33, D34, DP-12): the names of the undo steps - the command that made a
// step names it, and Edit > Undo / Redo, the toolbar's tooltips and the context menus show it.

import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { commandLabel, commandTooltip, undoNameOf, type Command } from '@/app/commands';
import { createAppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import { createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';

import { fakeRpc } from '../features/testUtils';

beforeAll(async () => {
  await initI18n({ language: 'en' });
});

const t = (key: string, params?: Record<string, unknown>) => i18next.t(key, params ?? {});

describe('undo step names', () => {
  it('a running command names the steps it records, until it has finished', async () => {
    const undo = new UndoCoordinator();
    expect(undo.commandName).toBeUndefined();
    undo.runNamed('Strong', () => expect(undo.commandName).toBe('Strong'));
    expect(undo.commandName).toBeUndefined();
    let finish = () => {};
    const running = undo.runNamed(
      'Change Picture',
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    expect(undo.commandName).toBe('Change Picture');
    finish();
    await running;
    expect(undo.commandName).toBeUndefined();
    expect(() =>
      undo.runNamed('Failing', () => {
        throw new Error('no');
      }),
    ).toThrow('no');
    expect(undo.commandName).toBeUndefined();
  });

  it("a command's name is its menu label without & and dots; an Add entry says Add", () => {
    const subtitle = { id: 'style.subtitle', labelKey: 'menu.style.subtitle' } as Command;
    const link = { id: 'style.link', labelKey: 'menu.style.link' } as Command;
    const title = { id: 'insert.title', labelKey: 'menu.add.title' } as Command;
    const dots = { id: 'x.pick', label: 'Change Picture\u2026' } as Command;
    expect(undoNameOf(subtitle, t)).toBe('Subtitle');
    expect(undoNameOf(link, t)).toBe('Link');
    expect(undoNameOf(title, t)).toBe('Add Title');
    expect(undoNameOf(dots, t)).toBe('Change Picture');
  });

  it('Undo and Redo name the step they would undo or redo; plain with nothing to do', () => {
    const store = createAppStore();
    const services = createAppServices({ store, rpc: fakeRpc({}).client, platform: 'linux' });
    const undoCommand = services.commands.get('edit.undo')!;
    const redoCommand = services.commands.get('edit.redo')!;
    expect(commandLabel(undoCommand, t)).toBe('Undo');
    expect(commandTooltip(undoCommand, t)).toBe('Undo');
    services.undo.recordSnapshot('description', 'Merge Sections', {
      before: null,
      after: null,
      apply: () => {},
    } as never);
    expect(commandLabel(undoCommand, t)).toBe('Undo Merge Sections');
    expect(commandTooltip(undoCommand, t)).toBe('Undo Merge Sections');
    expect(commandLabel(redoCommand, t)).toBe('Redo');
  });
});
