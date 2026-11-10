/**
 * Feature 011 (US7; FR-081; D29): the corpus sample exported as Markdown and imported again. For each
 * book of a list, the real core opens it, the interface's serializer writes it as one Markdown file
 * (without pictures), the Markdown import reads it back into an FB2 text, and the core validates the
 * result. Prints one line per failure and the totals; exits 1 when a book fails.
 *
 *   cd ui && MFBE_CORPUS_LIST=LIST MFBE_CORE_BIN=PATH [MFBE_CORPUS_LIMIT=N] \
 *     npx vitest run --config vitest.corpus.config.ts
 *
 * tests/corpus/run.sh runs it with --markdown; without the two variables it is skipped.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

import { convertMarkdown } from '@/features/markdown/convert';
import { buildBook } from '@/features/markdown/describe';
import { serializeMarkdown } from '@/features/markdown/export/serialize';
import type { Document } from '@/model/document';

// The import builds its FB2 text with the DOM, which Node has not.
const dom = new JSDOM('');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

class Rpc {
  private next = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly jobs = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly finished = new Map<string, { ok: boolean; value: unknown }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: { jobId?: string; result?: unknown; error?: unknown };
        result?: unknown;
        error?: { message?: string };
      };
      if (message.method === 'job.done' || message.method === 'job.failed') {
        const id = message.params?.jobId ?? '';
        const ok = message.method === 'job.done';
        const value = ok ? message.params?.result : message.params?.error;
        const waiter = this.jobs.get(id);
        if (waiter) {
          this.jobs.delete(id);
          if (ok) waiter.resolve(value);
          else waiter.reject(new Error(JSON.stringify(value)));
        } else this.finished.set(id, { ok, value });
        return;
      }
      if (message.id === undefined) return;
      const entry = this.waiting.get(message.id);
      if (!entry) return;
      this.waiting.delete(message.id);
      if (message.error)
        entry.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
  }

  call<T>(method: string, params: unknown = {}): Promise<T> {
    const id = this.next++;
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
  }

  /** A method that may answer with a job: its `job.done` result. */
  async run<T>(method: string, params: unknown = {}): Promise<T> {
    const first = await this.call<{ jobId?: string }>(method, params);
    if (!first || typeof first.jobId !== 'string') return first as T;
    const done = this.finished.get(first.jobId);
    if (done) {
      this.finished.delete(first.jobId);
      if (!done.ok) throw new Error(JSON.stringify(done.value));
      return done.value as T;
    }
    return new Promise<T>((resolve, reject) => {
      this.jobs.set(first.jobId!, { resolve: resolve as (v: unknown) => void, reject });
    });
  }
}

const LIST = process.env.MFBE_CORPUS_LIST;
const CORE = process.env.MFBE_CORE_BIN;

async function main(args: { list: string; core: string; limit: number }): Promise<string[]> {
  const books = readFileSync(args.list, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, args.limit);
  const work = mkdtempSync(path.join(tmpdir(), 'mfbe-md-corpus-'));
  const core = spawn(args.core, ['serve', '--test-hooks', '--data-dir', path.join(work, 'data')], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    let buffer = '';
    core.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const line = buffer.split('\n').find((one) => one.trim().startsWith('{'));
      if (line) resolve(JSON.parse(line) as { port: number; token: string });
    });
    core.on('exit', (code) => reject(new Error(`the core exited (${code})`)));
  });
  const socket = new WebSocket(`ws://127.0.0.1:${ready.port}/rpc?token=${ready.token}`);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const rpc = new Rpc(socket);
  const { xml: template } = await rpc.call<{ xml: string }>('template.xml');
  let passed = 0;
  const failures: string[] = [];
  for (const book of books) {
    try {
      const opened = await rpc.run<{ document: Document }>('doc.open', { path: book });
      const document = opened.document;
      const exported = serializeMarkdown(document, { form: 'md', includePictures: false });
      const result = convertMarkdown(exported.text, {
        fileName: path.basename(book).replace(/\.fb2$/i, ''),
        baseDir: work,
        notesTitle: 'Notes',
      });
      const target = path.join(work, 'reimported.fb2');
      writeFileSync(target, buildBook(template, result), 'utf8');
      // A book that was valid stays valid; one that was not gains no error of a new kind (SC-013).
      const errors = (file: string) =>
        new Set(
          [
            ...spawnSync(args.core, ['validate', file], { encoding: 'utf8' }).stdout.matchAll(
              /error: (\S+)/g,
            ),
          ].map((match) => match[1]!),
        );
      const before = errors(book);
      const added = [...errors(target)].filter((code) => !before.has(code));
      await rpc.call('doc.close', { docId: document.docId }).catch(() => undefined);
      if (added.length > 0) {
        // The validator's own lines of the new kinds say where and why.
        const report = spawnSync(args.core, ['validate', target], { encoding: 'utf8' }).stdout;
        const lines = report
          .split('\n')
          .filter((line) => added.some((code) => line.includes(`error: ${code}`)))
          .slice(0, 3);
        failures.push(`${book}: the re-imported book has new errors:\n  ${lines.join('\n  ')}`);
        continue;
      }
      passed += 1;
    } catch (error) {
      failures.push(`${book}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  socket.close();
  core.kill();
  rmSync(work, { recursive: true, force: true });
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(
    `  markdown round trip (FR-081): ${passed} / ${books.length} valid after export and import`,
  );
  return failures;
}

it.skipIf(!LIST || !CORE)(
  'the corpus sample comes back valid after export and import (FR-081)',
  async () => {
    const failures = await main({
      list: LIST!,
      core: CORE!,
      limit: Number(process.env.MFBE_CORPUS_LIMIT ?? Infinity),
    });
    expect(failures).toEqual([]);
  },
);
