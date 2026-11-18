#!/usr/bin/env node
// Feature 017 (T022): the model JSON of the TXT export's golden books, as the core opens them, for the
// interface's unit tests (tests/unit/txt). Run after a change of the books or of the model:
//   node tests/fixtures/txt/make-model-json.mjs [--core build/linux-core-debug/bin/mfbe-core]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const BOOKS = ['reference-all-elements.fb2', 'modern-utf8.fb2', 'long-notes.fb2', 'german-book.fb2'];
const coreArg = process.argv.indexOf('--core');
const core = coreArg > 0 ? process.argv[coreArg + 1] : path.join(repo, 'build/linux-core-debug/bin/mfbe-core');
const data = mkdtempSync(path.join(tmpdir(), 'mfbe-model-json-'));
const child = spawn(core, ['serve', '--data-dir', data], { stdio: ['ignore', 'pipe', 'inherit'] });
const { port, token } = await new Promise((resolve) => {
  child.stdout.once('data', (chunk) => resolve(JSON.parse(String(chunk).split('\n')[0])));
});
const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${token}`);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
let next = 1;
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = next++;
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
for (const name of BOOKS) {
  const result = await call('doc.open', { path: path.join(repo, 'tests/fixtures/books', name) });
  const document = { ...result.document, docId: 'golden', path: undefined };
  writeFileSync(path.join(here, 'models', name.replace(/\.fb2$/, '.json')), `${JSON.stringify(document, null, 1)}\n`);
  console.log(`make-model-json: ${name}`);
}
ws.close();
child.kill();
rmSync(data, { recursive: true, force: true });
