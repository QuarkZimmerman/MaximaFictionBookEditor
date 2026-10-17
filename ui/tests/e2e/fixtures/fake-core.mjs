#!/usr/bin/env node
/**
 * Stand-in for `mfbe-core serve` used to exercise the Playwright harness's core mode before the
 * real binary exists (and to debug the UI without a C++ build):
 *
 *   MFBE_CORE_BIN=tests/e2e/fixtures/fake-core.mjs npm run test:e2e
 *
 * Implements just enough of contracts/rpc-api.md: the ready line, static serving of `--ui`,
 * `GET /health`, `GET /binary/{docId}/{id}[/preview]`, the `/rpc` WebSocket with JSON-RPC 2.0
 * (`app.info`, `settings.get`, `settings.set`, `hotkeys.*`, the `doc.*` family from
 * `fake-doc.mjs` - open/openSource/toXml/fromXml/save/validate/recent/caret/watch/close/new -,
 * `test.enqueueDialog`, `test.injectFault`, `dialog.*` answered from the queue or
 * `dialog.unavailable`), token checks. No dependencies. Never shipped.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDocService } from './fake-doc.mjs';

const args = process.argv.slice(2);
if (args[0] !== 'serve') {
  console.error('fake-core: only "serve" is supported');
  process.exit(2);
}
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const uiDir = option('--ui') ?? path.resolve('dist');
const dataDir = option('--data-dir') ?? process.cwd();
const resourcesDir =
  option('--resources') ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../resources');
const token = option('--token') ?? randomBytes(16).toString('hex');
const requestedPort = Number(option('--port') ?? 0);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const defaultSettings = {
  schemaVersion: 1,
  view: {
    uiLanguage: 'system',
    bodyFont: '',
    bodyFontSize: 14,
    bodyTextColor: '#000000',
    bodyBackground: '#ffffff',
    sourceFont: '',
    sourceWrap: true,
    sourceSyntaxHighlight: true,
    sourceShowEol: false,
    sourceShowWhitespace: false,
    sourceLineNumbers: true,
    sourceMatchTags: true,
    sourceTagCompletion: true,
    spellEnabled: true,
    spellHighlight: true,
    customDictionaryPath: '',
    fastMode: false,
  },
  other: {
    defaultEncoding: 'utf-8',
    keepEncoding: false,
    restorePosition: true,
    scriptsFolder: '',
    genresFolder: '',
    dictionariesFolder: '',
    templateFolder: '',
    askOnNonClearImage: true,
    insertClearImages: false,
    pasteImageFormat: 'jpeg',
    jpegQuality: 90,
    nbspDisplayChar: '\u00A0',
    versionCheck: 'monthly',
  },
  words: { showExclusionsInWordsDialog: false },
  session: {
    windowGeometry: null,
    toolbars: { commands: true, scripts: true, links: true, table: true, status: true },
    treeVisible: true,
    findHistory: [],
    replaceHistory: [],
    toolbarLayouts: {},
    lastFileDialogFolder: '',
  },
};

let settings = structuredClone(defaultSettings);
const dialogQueue = [];

const FALLBACK_BLANK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info>
\t\t\t<genre>prose_contemporary</genre>
\t\t\t<author><first-name>First</first-name><last-name>Last</last-name></author>
\t\t\t<book-title></book-title>
\t\t\t<lang>en</lang>
\t\t</title-info>
\t\t<document-info>
\t\t\t<author><nickname>Your Name</nickname></author>
\t\t\t<program-used>Maxima Fiction Book Editor</program-used>
\t\t\t<date value="2026-10-12">2026-10-12</date>
\t\t\t<id>{uuid}</id>
\t\t\t<version>1.0</version>
\t\t</document-info>
\t</description>
\t<body>
\t\t<section>
\t\t\t<p></p>
\t\t</section>
\t</body>
</FictionBook>
`;

function readBlankTemplate() {
  const candidate = path.join(resourcesDir, 'blank.fb2');
  try {
    return readFileSync(candidate, 'utf8');
  } catch {
    return FALLBACK_BLANK;
  }
}

const docs = createDocService({ dataDir, broadcast, blankTemplate: readBlankTemplate() });

const methods = {
  'app.info': () => ({
    version: '0.0.0-fake',
    build: 'fake-core',
    platform:
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux',
    uiLanguage: 'en',
    dataDir,
    logDir: path.join(dataDir, 'logs'),
    resourceLayers: [],
    apiVersion: 1,
  }),
  'app.quit': () => {
    setTimeout(() => process.exit(0), 50);
    return {};
  },
  'settings.get': () => settings,
  'settings.set': ({ patch }) => {
    settings = merge(settings, patch ?? {});
    broadcast('settings.changed', { settings });
    return { settings, restartRequired: false };
  },
  'hotkeys.defaults': () => [],
  'hotkeys.get': () => [],
  'hotkeys.set': () => ({ collisions: [] }),
  ...docs.methods,
  'resources.layers': () => [],
  'resources.genres': () => ({ entries: [], userFiles: [] }),
  'resources.languages': () => [],
  'resources.symbols': () => [],
  'scripts.list': () => [],
  'spell.dictionaries': () => [],
  'log.error': () => ({}),
  'test.enqueueDialog': ({ method, result }) => {
    dialogQueue.push({ method, result });
    return {};
  },
  'test.metrics': () => ({ memoryBytes: process.memoryUsage().rss, openDurations: [] }),
};

function dialogMethod(method) {
  const index = dialogQueue.findIndex((entry) => entry.method === method);
  if (index < 0) {
    throw { code: 1050, message: `dialog.unavailable: no queued answer for ${method}` };
  }
  return dialogQueue.splice(index, 1)[0].result;
}

function merge(target, patch) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object'
        ? merge(out[key], value)
        : value;
  }
  return out;
}

function dispatch(method, params) {
  if (method.startsWith('dialog.')) return dialogMethod(method);
  const handler = methods[method];
  if (!handler) throw { code: -32601, message: `Method not found: ${method}` };
  return handler(params ?? {});
}

/* ----------------------------- WebSocket -------------------------------- */

const sockets = new Set();

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function send(socket, message) {
  if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(message)));
}

function broadcast(method, params) {
  for (const socket of sockets) send(socket, { jsonrpc: '2.0', method, params });
}

function handleFrames(socket, state) {
  for (;;) {
    const buf = state.buffer;
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) return;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return;
      length = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (buf.length < offset + maskLength + length) return;
    const mask = masked ? buf.subarray(offset, offset + 4) : null;
    const payload = Buffer.from(buf.subarray(offset + maskLength, offset + maskLength + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    state.buffer = buf.subarray(offset + maskLength + length);

    if (opcode === 0x8) {
      socket.end(Buffer.from([0x88, 0x00]));
      return;
    }
    if (opcode === 0x9) {
      socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      continue;
    }
    if (opcode !== 0x1) continue;

    let request;
    try {
      request = JSON.parse(payload.toString('utf8'));
    } catch {
      send(socket, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    const { id, method, params } = request;
    try {
      const result = dispatch(method, params);
      if (id !== undefined) send(socket, { jsonrpc: '2.0', id, result });
    } catch (error) {
      const code = typeof error?.code === 'number' ? error.code : -32603;
      const message = error?.message ?? String(error);
      const data = error?.data;
      if (id !== undefined) {
        send(socket, {
          jsonrpc: '2.0',
          id,
          error: { code, message, ...(data !== undefined ? { data } : {}) },
        });
      }
    }
  }
}

/* -------------------------------- HTTP ---------------------------------- */

function hasToken(url, req) {
  return url.searchParams.get('token') === token || req.headers['x-mfbe-token'] === token;
}

function cookieToken(req) {
  return (req.headers.cookie ?? '').split(/;\s*/).includes(`mfbe_token=${token}`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    if (!hasToken(url, req)) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '0.0.0-fake', pid: process.pid, uptime: process.uptime() }));
    return;
  }
  if (url.pathname === '/' && !hasToken(url, req)) {
    res.writeHead(401, { 'content-type': 'text/plain' }).end('token required');
    return;
  }
  const binaryMatch = /^\/binary\/([^/]+)\/([^/]+)(\/preview)?$/.exec(url.pathname);
  if (binaryMatch) {
    if (!hasToken(url, req) && !cookieToken(req)) {
      res.writeHead(401).end();
      return;
    }
    const stored = docs.binary(
      decodeURIComponent(binaryMatch[1]),
      decodeURIComponent(binaryMatch[2]),
    );
    if (!stored) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': stored.contentType,
      'content-length': stored.bytes.length,
    });
    res.end(stored.bytes);
    return;
  }
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(uiDir, relative);
  if (!file.startsWith(uiDir) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const headers = {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'content-security-policy':
      "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:",
  };
  if (relative === 'index.html')
    headers['set-cookie'] = `mfbe_token=${token}; Path=/; SameSite=Strict`;
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const origin = req.headers.origin;
  const ownOrigin = `http://${req.headers.host}`;
  if (url.pathname !== '/rpc' || !hasToken(url, req) || (origin && origin !== ownOrigin)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const state = { buffer: Buffer.alloc(0) };
  sockets.add(socket);
  socket.on('data', (chunk) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    handleFrames(socket, state);
  });
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
});

server.listen(requestedPort, '127.0.0.1', () => {
  const { port } = server.address();
  process.stdout.write(`${JSON.stringify({ port, token, pid: process.pid })}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
