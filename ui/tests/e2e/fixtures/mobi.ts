/**
 * Cross-platform helpers for MOBI/KF8 Playwright journeys (feature 018):
 * - Windows/macOS/Linux safe Python 3 discovery (`python` vs `python3`).
 * - Optional Calibre (`ebook-meta`, `ebook-convert`) detection with pure-Node PalmDB/EXTH/PalmDOC
 *   fallback so every journey verifies real binary outputs on CI runners without Calibre too.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let cachedPython: string | null | undefined;
let cachedCalibre: boolean | undefined;

export function findPython(): string {
  if (cachedPython !== undefined) {
    if (!cachedPython) throw new Error('Python 3 not found on PATH');
    return cachedPython;
  }
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (res.status === 0 && /Python 3\./.test(`${res.stdout}${res.stderr}`)) {
      cachedPython = cmd;
      return cmd;
    }
  }
  cachedPython = null;
  throw new Error('Python 3 not found on PATH');
}

export function hasCalibre(): boolean {
  if (cachedCalibre !== undefined) return cachedCalibre;
  const meta = spawnSync('ebook-meta', ['--version'], { stdio: 'ignore' });
  const conv = spawnSync('ebook-convert', ['--version'], { stdio: 'ignore' });
  cachedCalibre = meta.status === 0 && conv.status === 0;
  return cachedCalibre;
}

export interface ParsedMobiBinary {
  fileVersion: number;
  isJoint: boolean;
  title: string;
  authors: string[];
  exth116: number | null;
  htmlText: string;
}

function palmdocDecompress(src: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const b = src[i++]!;
    if (b === 0) {
      out.push(0);
    } else if (b >= 1 && b <= 8) {
      for (let k = 0; k < b && i < src.length; k++) out.push(src[i++]!);
    } else if (b <= 0x7f) {
      out.push(b);
    } else if (b >= 0xc0) {
      out.push(0x20, b ^ 0x80);
    } else if (i < src.length) {
      const b2 = src[i++]!;
      const pair = ((b << 8) | b2) & 0x3fff;
      const dist = pair >> 3;
      const len = (pair & 7) + 3;
      if (dist > 0 && dist <= out.length) {
        for (let k = 0; k < len; k++) out.push(out[out.length - dist]!);
      }
    }
  }
  return Buffer.from(out);
}

function stripTrailing(rec: Buffer, flags: number): Buffer {
  let end = rec.length;
  for (let bit = 15; bit >= 1; bit--) {
    if ((flags & (1 << bit)) === 0) continue;
    let val = 0;
    let shift = 0;
    let p = end;
    while (p > 0) {
      const byte = rec[--p]!;
      val |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) !== 0) break;
    }
    if (val > 0 && val <= end) end -= val;
  }
  if ((flags & 1) !== 0 && end > 0) {
    const overlap = (rec[end - 1]! & 3) + 1;
    if (overlap <= end) end -= overlap;
  }
  return rec.subarray(0, end);
}

/** Pure-Node inspection of a MOBI 7 / joint / KF8 binary (header, EXTH, decompressed HTML). */
export function inspectMobiBinary(filePath: string): ParsedMobiBinary {
  const buf = readFileSync(filePath);
  const numRecs = buf.readUInt16BE(76);
  const offsets: number[] = [];
  for (let i = 0; i < numRecs; i++) offsets.push(buf.readUInt32BE(78 + i * 8));
  offsets.push(buf.length);
  const rec = (idx: number): Buffer => buf.subarray(offsets[idx]!, offsets[idx + 1]!);

  const r0 = rec(0);
  const compression = r0.readUInt16BE(0);
  const textLen = r0.readUInt32BE(4);
  const textRecCount = r0.readUInt16BE(8);
  const hlen = r0.readUInt32BE(20);
  const fileVersion = r0.readUInt32BE(36);
  const fullNameOff = r0.readUInt32BE(84);
  const fullNameLen = r0.readUInt32BE(88);
  const extraFlags = hlen >= 232 && r0.length >= 244 ? r0.readUInt32BE(240) : 0;

  let title =
    fullNameOff + fullNameLen <= r0.length
      ? r0.subarray(fullNameOff, fullNameOff + fullNameLen).toString('utf8')
      : '';
  const authors: string[] = [];
  let exth116: number | null = null;
  let isJoint = false;

  const exthOff = 16 + hlen;
  if (exthOff + 12 <= r0.length && r0.subarray(exthOff, exthOff + 4).toString('ascii') === 'EXTH') {
    const count = r0.readUInt32BE(exthOff + 8);
    let p = exthOff + 12;
    for (let i = 0; i < count && p + 8 <= r0.length; i++) {
      const type = r0.readUInt32BE(p);
      const len = r0.readUInt32BE(p + 4);
      if (len < 8 || p + len > r0.length) break;
      const data = r0.subarray(p + 8, p + len);
      if (type === 503) title = data.toString('utf8');
      else if (type === 100) authors.push(data.toString('utf8'));
      else if (type === 116 && data.length === 4) exth116 = data.readUInt32BE(0);
      else if (type === 121 && data.length === 4 && data.readUInt32BE(0) !== 0xffffffff) {
        isJoint = true;
      }
      p += len;
    }
  }

  const chunks: Buffer[] = [];
  for (let i = 1; i <= textRecCount && i < numRecs; i++) {
    const raw = stripTrailing(rec(i), extraFlags);
    chunks.push(compression === 2 ? palmdocDecompress(raw) : raw);
  }
  const htmlBuf = Buffer.concat(chunks).subarray(0, textLen);
  return {
    fileVersion,
    isJoint,
    title,
    authors,
    exth116,
    htmlText: htmlBuf.toString('utf8'),
  };
}

/** Runs Calibre `ebook-meta` when available, else returns EXTH title + authors in similar text form. */
export function mobiMetaSummary(filePath: string): string {
  if (hasCalibre()) {
    return execFileSync('ebook-meta', [filePath], { encoding: 'utf8', timeout: 30_000 });
  }
  const parsed = inspectMobiBinary(filePath);
  return `Title               : ${parsed.title}\nAuthor(s)           : ${parsed.authors.join(' & ')}\n`;
}

/** Runs Calibre `ebook-convert` to plain text when available, else returns stripped decompressed HTML. */
export function mobiPlainText(filePath: string, outDir: string): string {
  if (hasCalibre()) {
    const txtPath = path.join(outDir, `${path.basename(filePath)}.txt`);
    execFileSync('ebook-convert', [filePath, txtPath], {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: 'pipe',
    });
    return readFileSync(txtPath, 'utf8');
  }
  const parsed = inspectMobiBinary(filePath);
  return parsed.htmlText
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/** Parses ZIP Central Directory compression methods (`0` = store, `8` = deflate) in pure Node. */
export function inspectZipMethods(zipPath: string): Record<string, number> {
  const buf = readFileSync(zipPath);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`No ZIP EOCD in ${zipPath}`);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    out[name] = method;
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
