/**
 * Feature 009, User Story 1 (T009): every way of saving asks the core for the backup of the
 * previous version, as Settings > Other says (FR-003, FR-006), and a backup that could not be
 * made is reported on the status line (FR-005, D4).
 */
import { describe, expect, it } from 'vitest';

import { registerFileCommands } from '@/features/file/fileCommands';
import { keepsBackup, savedMessage } from '@/features/file/saveOutcome';
import { actions } from '@/model/store';
import type { SaveResult } from '@/rpc/types';

import { defaultSettings } from '../settings/fixtures';

import {
  CLEAN_REPORT,
  createCommandRegistry,
  fakeDialogs,
  fakeDocument,
  fakeRpc,
  makeContext,
} from './testUtils';

const saved = (params: { path?: string; encoding?: string; backup?: boolean }) => ({
  path: params.path ?? '/books/alpha.fb2',
  encoding: params.encoding ?? 'utf-8',
  converted: [],
  validation: CLEAN_REPORT,
  ...(params.backup ? { backup: { kept: true } } : {}),
});

async function setup(options: { keepBackup?: boolean; customAnswers?: unknown[] } = {}) {
  const registry = createCommandRegistry();
  const feature = registerFileCommands(registry, { selfSaveGraceMs: 0 });
  const rpc = fakeRpc({
    'doc.watch': {},
    'doc.position': {},
    'doc.recent': [],
    'doc.save': saved,
    'dialog.saveFile': { path: '/books/copy.fb2', encoding: 'utf-8' },
  });
  const ctx = await makeContext({
    rpc: rpc.client,
    dialogs: fakeDialogs([], options.customAnswers ?? []),
  });
  actions.setConnection(ctx.store, 'connected');
  const settings = defaultSettings();
  if (options.keepBackup !== undefined) settings.other.keepBackup = options.keepBackup;
  actions.setSettings(ctx.store, settings);
  actions.setDocument(ctx.store, fakeDocument());
  actions.setModified(ctx.store, true);
  return { ctx, feature, rpc };
}

const saveParams = (rpc: ReturnType<typeof fakeRpc>) =>
  rpc.calls.filter((c) => c.method === 'doc.save').map((c) => c.params as { backup?: boolean });

describe('backups on save (feature 009, US1)', () => {
  it('keepsBackup: on by default, off only when Settings > Other turns it off', async () => {
    const { ctx } = await setup();
    expect(keepsBackup(ctx.store)).toBe(true);
    const off = defaultSettings();
    off.other.keepBackup = false;
    actions.setSettings(ctx.store, off);
    expect(keepsBackup(ctx.store)).toBe(false);
  });

  it('Save and Save As send backup: true with the default settings', async () => {
    const { ctx, feature, rpc } = await setup();
    expect(await feature.saveDocument(ctx, {})).toBe(true);
    expect(await feature.saveDocument(ctx, { saveAs: true })).toBe(true);
    expect(saveParams(rpc)).toEqual([
      expect.objectContaining({ backup: true }),
      expect.objectContaining({ backup: true }),
    ]);
  });

  it('Yes in the unsaved-changes question saves with the backup too', async () => {
    const { ctx, feature, rpc } = await setup({ customAnswers: ['yes'] });
    expect(await feature.confirmDiscardChanges(ctx)).toBe(true);
    expect(saveParams(rpc)).toEqual([expect.objectContaining({ backup: true })]);
  });

  it('switched off, every save sends backup: false', async () => {
    const { ctx, feature, rpc } = await setup({ keepBackup: false, customAnswers: ['yes'] });
    await feature.saveDocument(ctx, {});
    await feature.saveDocument(ctx, { saveAs: true });
    actions.setModified(ctx.store, true);
    await feature.confirmDiscardChanges(ctx);
    expect(saveParams(rpc).map((p) => p.backup)).toEqual([false, false, false]);
  });

  it('a backup that was wanted but not kept is reported on the status line', async () => {
    const { ctx } = await setup();
    const result: SaveResult = {
      path: '/books/alpha.fb2',
      encoding: 'utf-8',
      converted: [],
      validation: CLEAN_REPORT,
      backup: { kept: false, reason: 'Access is denied.' },
    };
    expect(savedMessage(ctx.t, result)).toBe(
      'Document saved - no backup copy of the previous version was kept: Access is denied.',
    );
    expect(savedMessage(ctx.t, { ...result, backup: { kept: true } })).toBe(
      'Document saved - No errors found.',
    );
    // A first save of a new file has nothing to back up: no reason, no warning.
    expect(savedMessage(ctx.t, { ...result, backup: { kept: false } })).toBe(
      'Document saved - No errors found.',
    );
  });
});
