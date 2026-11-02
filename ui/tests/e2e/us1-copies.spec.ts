/**
 * Feature 008, User Story 1 (T009): two copies share one data folder under D3 and clarify Q1.
 * Two `mfbe-core --copy-registry` processes stand for two copies; a third, started after both
 * ended, reads what they left.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, fixtureBook, NodeRpcClient, runJob, startCoreWith, test } from './fixtures/core';

interface Settings {
  view: { theme: string; spellExtraDictionaries: string[] };
  other: { openFromOutside: string };
}

function clientFor(url: string): NodeRpcClient {
  const parsed = new URL(url);
  return new NodeRpcClient(
    `ws://127.0.0.1:${parsed.port}/rpc?token=${parsed.searchParams.get('token') ?? ''}`,
  );
}

test.describe('US1: two books side by side', () => {
  test('two copies take their own slots and share the stored data', async () => {
    const binary = process.env.MFBE_CORE_BIN ?? '';
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
    const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-copies-'));
    const a = await startCoreWith(binary, dataDir, ['--copy-registry']);
    const b = await startCoreWith(binary, dataDir, ['--copy-registry']);
    const ra = clientFor(a.url);
    const rb = clientFor(b.url);
    try {
      await ra.connect();
      await rb.connect();
      const copies = await ra.call<{ records: { slot: number; live: boolean }[] }>('test.copies');
      expect(copies.records.map((r) => r.slot).sort()).toEqual([1, 2]);
      expect(copies.records.every((r) => r.live)).toBe(true);

      // Settings: a's change survives b's later save of another key; for a key changed in both
      // the last save wins; b never takes a's value while it runs (FR-003, clarify Q1).
      await ra.call('settings.set', { patch: { view: { spellExtraDictionaries: ['en_US'] } } });
      await rb.call('settings.set', { patch: { view: { theme: 'dark' } } });
      await ra.call('settings.set', { patch: { other: { openFromOutside: 'thisWindow' } } });
      await rb.call('settings.set', { patch: { other: { openFromOutside: 'newWindow' } } });
      const own = await rb.call<Settings>('settings.get');
      expect(own.view.spellExtraDictionaries).toEqual(['en_US', 'ru_RU']);

      // The lists the user builds up keep every copy's changes.
      await ra.call('spell.addWord', { word: 'Арагорн' });
      await rb.call('spell.addWord', { word: 'Гэндальф' });
      await runJob(ra, 'doc.open', { path: fixtureBook('notes-6.fb2') });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await runJob(rb, 'doc.open', { path: fixtureBook('notes-none.fb2') });
    } finally {
      ra.close();
      rb.close();
      await a.stop();
      await b.stop();
    }

    const c = await startCoreWith(binary, dataDir, ['--copy-registry']);
    const rc = clientFor(c.url);
    try {
      await rc.connect();
      const copies = await rc.call<{ records: { slot: number }[] }>('test.copies');
      expect(copies.records.map((r) => r.slot)).toEqual([1]); // both slots were freed
      const settings = await rc.call<Settings>('settings.get');
      expect(settings.view.spellExtraDictionaries).toEqual(['en_US']);
      expect(settings.view.theme).toBe('dark');
      expect(settings.other.openFromOutside).toBe('newWindow');
      const words = await rc.call<string[]>('spell.customWords');
      expect(words).toEqual(expect.arrayContaining(['Арагорн', 'Гэндальф']));
      const recent = await rc.call<{ path: string }[]>('doc.recent');
      expect(recent.map((r) => path.basename(r.path)).slice(0, 2)).toEqual([
        'notes-none.fb2',
        'notes-6.fb2',
      ]);
    } finally {
      rc.close();
      await c.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
