/**
 * Shared helpers for Feature 019 Batch Converter Playwright journeys.
 * Uses pure-Node stored ZIP creation so tests stay cross-platform (@platform) with zero OS tool dependencies.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page } from '@playwright/test';

const UI_DIR = fileURLToPath(new URL('../../..', import.meta.url));
export const REPO_ROOT = path.resolve(UI_DIR, '..');

export function repoFixture(...segments: string[]): string {
  return path.join(REPO_ROOT, 'tests', 'fixtures', ...segments);
}

export function makeTempDir(prefix: string): string {
  const dir = path.join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function openBatchDialog(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-batchConverter').click();
  await expect(page.getByTestId('dialog-batch-converter')).toBeVisible();
}

/** Removes persisted `<dataDir>/batch-converter.json` so a test starts from fresh-install state. */
export function resetBatchSettings(dataDir: string | undefined): void {
  if (!dataDir) return;
  rmSync(path.join(dataDir, 'batch-converter.json'), { force: true });
  rmSync(path.join(dataDir, 'batch-converter.json.lock'), { force: true });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntrySpec {
  name: string;
  content: Buffer | string;
}

/** Writes a valid UTF-8 (flag bit 11) uncompressed ZIP archive at `zipPath`. */
export function writeStoredZip(zipPath: string, entries: readonly ZipEntrySpec[]): void {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf =
      typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : entry.content;
    const crc = crc32(dataBuf);
    const size = dataBuf.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(0, 8); // store (method 0)
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    central.writeUInt16LE(0, 10); // store
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, dataBuf);
    centrals.push(central);
    offset += local.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  mkdirSync(path.dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, Buffer.concat([...locals, centralDir, eocd]));
}

/** Valid 1x1 red PNG image bytes for picture embedding tests. */
export const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
