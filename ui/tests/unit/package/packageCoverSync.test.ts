import { describe, expect, it, vi } from 'vitest';

import {
  applyPackageCoverToDocument,
  canonicalCoverId,
  clearPackageCoverFromDocument,
  removePackageCover,
  setPackageCoverFromFile,
} from '@/features/package/packageCoverSync';
import type { BinaryMeta, Document } from '@/model/document';
import { createAppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';

function makeDoc(): Document {
  return {
    modelVersion: 1,
    docId: 'doc_1',
    fileKind: 'fbd',
    sourceEncoding: 'utf-8',
    schemaHint: '2.1',
    description: {
      titleInfo: {
        genres: [],
        authors: [],
        bookTitle: 'Test',
        coverpage: [],
        lang: 'en',
        translators: [],
        sequences: [],
      },
      srcTitleInfo: {
        genres: [],
        authors: [],
        bookTitle: '',
        coverpage: [{ href: '#old.jpg' }],
        lang: '',
        translators: [],
        sequences: [],
      },
      documentInfo: {
        authors: [],
        date: { text: '', value: '' },
        srcUrls: [],
        id: 'ID',
        version: '1.0',
        publishers: [],
      },
      customInfo: [],
      outputs: [],
    },
    stylesheets: [],
    bodies: [],
    binaries: [],
    extras: [],
  };
}

function makeMeta(id: string, contentType: string): BinaryMeta {
  return {
    id,
    contentType,
    size: 100,
    width: 10,
    height: 10,
    decodable: true,
    willConvert: false,
    referenceCount: 1,
  };
}

describe('packageCoverSync', () => {
  it('chooses canonical cover.jpg / cover.png from contentType', () => {
    expect(canonicalCoverId('image/png')).toBe('cover.png');
    expect(canonicalCoverId('image/jpeg')).toBe('cover.jpg');
    expect(canonicalCoverId('image/webp')).toBe('cover.jpg');
  });

  it('keeps titleInfo.coverpage and binaries strictly synchronized with zero orphans', () => {
    const doc = makeDoc();
    const withPng = applyPackageCoverToDocument(doc, makeMeta('cover.png', 'image/png'));
    expect(withPng.binaries).toHaveLength(1);
    expect(withPng.binaries[0]!.id).toBe('cover.png');
    expect(withPng.description.titleInfo.coverpage).toEqual([{ href: '#cover.png' }]);
    expect(withPng.description.srcTitleInfo?.coverpage).toEqual([]);

    const cleared = clearPackageCoverFromDocument(withPng);
    expect(cleared.binaries).toEqual([]);
    expect(cleared.description.titleInfo.coverpage).toEqual([]);
  });

  it('replaces existing cover via binary.add(convertNow:true), removes old cover, renames to canonical id, and removes cleanly', async () => {
    const store = createAppStore();
    const initial = applyPackageCoverToDocument(makeDoc(), makeMeta('cover.jpg', 'image/jpeg'));
    store.setState({ docId: 'doc_1', document: initial });

    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'binary.add') {
        expect(params.convertNow).toBe(true);
        expect(params.imagesOnly).toBe(true);
        return makeMeta('__pkg_cover_tmp', 'image/png');
      }
      if (method === 'binary.remove') {
        return {};
      }
      if (method === 'binary.rename') {
        return makeMeta(String(params.newId), 'image/png');
      }
      throw new Error(`unexpected ${method}`);
    });
    const rpc = { call } as unknown as RpcClient;

    const meta = await setPackageCoverFromFile(rpc, store, 'doc_1', '/tmp/new.webp');
    expect(meta?.id).toBe('cover.png');
    expect(call).toHaveBeenCalledWith('binary.remove', {
      docId: 'doc_1',
      id: 'cover.jpg',
      force: true,
    });
    expect(call).toHaveBeenCalledWith('binary.rename', {
      docId: 'doc_1',
      id: '__pkg_cover_tmp',
      newId: 'cover.png',
    });

    const afterAdd = store.getState().document!;
    expect(afterAdd.binaries).toHaveLength(1);
    expect(afterAdd.binaries[0]!.id).toBe('cover.png');
    expect(afterAdd.description.titleInfo.coverpage).toEqual([{ href: '#cover.png' }]);

    await removePackageCover(rpc, store, 'doc_1');
    const afterRemove = store.getState().document!;
    expect(afterRemove.binaries).toEqual([]);
    expect(afterRemove.description.titleInfo.coverpage).toEqual([]);
  });
});
