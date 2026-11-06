/**
 * Feature 009, User Story 9 (T081): the outcome of adding several binaries (data-model §12) -
 * `{added, toConvert, failed}`, the summary only when more than one file was chosen and some
 * failed or will be converted, otherwise the status line; every success in the model at once.
 */
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import { showsSummary, summarize, summaryText } from '@/features/images/addSummary';
import { addBinariesFromFiles, addBinariesToModel } from '@/features/images/binaries';
import { initI18n } from '@/i18n';
import type { BinaryMeta } from '@/model/document';
import { createAppStore, actions } from '@/model/store';
import type { RpcClient } from '@/rpc/client';

import { fakeDocument } from '../testUtils';

const meta = (id: string, willConvert = false): BinaryMeta => ({
  id,
  contentType: willConvert ? 'image/gif' : 'image/png',
  size: 8,
  width: 8,
  height: 6,
  decodable: true,
  willConvert,
  referenceCount: 0,
});

/** An RPC client whose binary.add fails for the paths in `failing`. */
function rpcFor(paths: string[], failing: string[]): RpcClient {
  return {
    call: async (method: string, params: { path?: string }) => {
      if (method === 'dialog.openFile') return { paths };
      if (method === 'binary.add') {
        if (failing.includes(params.path!)) throw new Error('the file cannot be read');
        const name = params.path!.split('/').pop()!;
        return meta(name, name.endsWith('.gif'));
      }
      throw new Error(`unexpected ${method}`);
    },
  } as unknown as RpcClient;
}

describe('adding several binaries (data-model §12)', () => {
  it('each file on its own: the others are added when one fails', async () => {
    const rpc = rpcFor(['/p/a.png', '/p/b.txt', '/p/c.gif'], ['/p/b.txt']);
    const outcome = await addBinariesFromFiles(rpc, 'd1', {
      title: '',
      filters: [],
      selectedFilter: 0,
      multiple: true,
    });
    expect(outcome.added.map((m) => m.id)).toEqual(['a.png', 'c.gif']);
    expect(outcome.failed.map((f) => [f.file, f.reason])).toEqual([
      ['b.txt', 'the file cannot be read'],
    ]);
    const summary = summarize(outcome);
    expect(summary.toConvert.map((m) => m.id)).toEqual(['c.gif']);
    expect(showsSummary(summary)).toBe(true);
  });

  it('every success is in the model at once', () => {
    const store = createAppStore();
    actions.setDocument(store, fakeDocument());
    addBinariesToModel(store, [meta('a.png'), meta('b.png')]);
    expect(store.getState().document!.binaries.map((b) => b.id)).toEqual(['a.png', 'b.png']);
  });

  it('the summary shows only for several files with a failure or a conversion', () => {
    expect(showsSummary({ added: [meta('a'), meta('b')], toConvert: [], failed: [] })).toBe(false);
    expect(
      showsSummary({ added: [meta('a', true)], toConvert: [meta('a', true)], failed: [] }),
    ).toBe(false);
    const failed = [{ file: 'x.txt', reason: 'bad', error: null }];
    expect(showsSummary({ added: [], toConvert: [], failed })).toBe(false);
    expect(showsSummary({ added: [], toConvert: [], failed: [...failed, ...failed] })).toBe(true);
  });

  it('lists the added, the converted and the failed files with their reasons', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const text = summaryText(i18n.t, {
      added: [meta('a.png'), meta('c.gif', true)],
      toConvert: [meta('c.gif', true)],
      failed: [{ file: 'b.txt', reason: 'the file cannot be read', error: null }],
    });
    expect(text.split('\n')).toEqual([
      'Added 2 files: a.png, c.gif',
      'Will be converted to JPEG or PNG when the book is saved: c.gif',
      'Not added (1 file):',
      'b.txt \u2014 the file cannot be read',
    ]);
    const none = summaryText(i18n.t, {
      added: [],
      toConvert: [],
      failed: [
        { file: 'x', reason: 'r1', error: null },
        { file: 'y', reason: 'r2', error: null },
      ],
    });
    expect(none.split('\n')[0]).toBe('Nothing was added.');
  });
});
