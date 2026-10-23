/**
 * The script proposal's pure parts (feature 005 T074; ai-catalogue §3.4, §7, §9.2
 * `proposal.test.ts`; data-model §10; review C9, E1): the E1 confinement mirrored in the
 * pre-checks, the manifest checks, the summary limit, the forbidden-API scan, the author line,
 * the default group and target, the FR-084 gate as a pure function.
 */

import { describe, expect, it } from 'vitest';

import {
  blankStringsAndComments,
  checkProposal,
  DEFAULT_GROUP,
  defaultAuthorLine,
  filesToWrite,
  folderOf,
  FORBIDDEN_NAMES,
  isValidScriptId,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_SUMMARY_LENGTH,
  MAX_TOTAL_BYTES,
  parseManifest,
  pathProblem,
  runAllowed,
  scanFile,
  scanProposal,
  segmentProblem,
  targetFolder,
  withAuthorLine,
  type ProposalArgs,
  type ProposalFile,
} from '@/ai/proposal';

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    manifestVersion: 1,
    id: 'assistant/nbsp-prepositions',
    name: { en: 'Non-breaking space after prepositions', ru: 'Неразрывный пробел' },
    description: { en: 'Inserts a non-breaking space' },
    kind: 'menu',
    entry: 'index.js',
    needsSelection: true,
    ...over,
  });

const entry = `/* global mfbe */
// Inserts a non-breaking space after one-letter prepositions.
export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection) return;
  await mfbe.selection.replaceText(selection.text.replace(/ (в|к|с) /g, ' $1\\u00A0'));
}
`;

const files = (over: Partial<Record<string, string>> = {}): ProposalFile[] => {
  const map: Record<string, string> = { 'script.json': manifest(), 'index.js': entry, ...over };
  return Object.entries(map)
    .filter(([, content]) => content !== undefined)
    .map(([path, content]) => ({ path, content: content! }));
};

const args = (over: Partial<ProposalArgs> = {}): ProposalArgs => ({
  id: 'assistant/nbsp-prepositions',
  files: files(),
  summary: 'Inserts a non-breaking space after one-letter prepositions in the selection',
  ...over,
});

const options = {
  dataDir: '/home/u/.local/share/maxfbeditor',
  uiLanguage: 'en',
  existing: {
    bundledIds: new Set(['18/remove-spaces', '18/empty-line-before-poem-or-cite']),
    userIds: new Set(['test.dialogs.form', 'assistant/already-there']),
  },
};

const t = ((key: string, params?: Record<string, unknown>) =>
  key === 'ai.proposal.authorDefault'
    ? `Written with the AI assistant of Maxima Fiction Book Editor, ${String(params?.date)}`
    : key) as unknown as Parameters<typeof defaultAuthorLine>[0];

/* ------------------------------------------------------------------------ */

describe('the segment and path rule (review E1)', () => {
  it('accepts plain segments and relative paths with / separators', () => {
    for (const segment of ['index.js', 'lib', 'strip-lib.js', 'README', 'données.js', 'a.b.c']) {
      expect(segmentProblem(segment), segment).toBeNull();
    }
    for (const path of ['index.js', 'lib/helpers.js', 'deep/er/file.json']) {
      expect(pathProblem(path), path).toBeNull();
    }
  });

  it('refuses empty, dot, control, forbidden-character and reserved-name segments and over-long ones', () => {
    expect(segmentProblem('')).toMatch(/empty/);
    expect(segmentProblem('.')).toMatch(/not allowed/);
    expect(segmentProblem('..')).toMatch(/not allowed/);
    expect(segmentProblem('a\u0000b')).toMatch(/control/i);
    expect(segmentProblem('a\u001fb')).toMatch(/control/i);
    expect(segmentProblem('a\u007fb')).toMatch(/control/i);
    for (const ch of [':', '*', '?', '"', '<', '>', '|']) {
      expect(segmentProblem(`a${ch}b`), ch).toMatch(/: \* \? " < > \|/);
    }
    for (const name of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
      expect(segmentProblem(name), name).toMatch(/reserved device name/);
      expect(segmentProblem(`${name}.js`), `${name}.js`).toMatch(/reserved device name/);
    }
    // COM0 / LPT0 and names that merely start the same way are not reserved.
    expect(segmentProblem('COM0')).toBeNull();
    expect(segmentProblem('LPT0')).toBeNull();
    expect(segmentProblem('console.js')).toBeNull();
    expect(segmentProblem('nullable.js')).toBeNull();
    expect(segmentProblem('a'.repeat(255))).toBeNull();
    expect(segmentProblem('a'.repeat(256))).toMatch(/255 bytes/);
    // Bytes, not characters: 128 Cyrillic letters are 256 bytes.
    expect(segmentProblem('я'.repeat(128))).toMatch(/255 bytes/);
  });

  it('refuses .. segments, leading / and \\ and backslashes anywhere in a path', () => {
    expect(pathProblem('../x.js')).toMatch(/not allowed/);
    expect(pathProblem('lib/../x.js')).toMatch(/not allowed/);
    expect(pathProblem('/index.js')).toMatch(/relative/);
    expect(pathProblem('\\index.js')).toMatch(/relative/);
    expect(pathProblem('lib\\x.js')).toMatch(/separator/);
    expect(pathProblem('lib//x.js')).toMatch(/empty/);
    expect(pathProblem('')).toMatch(/empty/);
    expect(pathProblem('lib/CON.js')).toMatch(/reserved/);
  });

  it('applies the loader id rule: slashes as separators, no dot segments, no leading / trailing / doubled slash', () => {
    for (const id of ['assistant/nbsp', '18/remove-spaces', 'test.dialogs.form', 'a/b/c']) {
      expect(isValidScriptId(id), id).toBe(true);
    }
    for (const id of ['', '/a', 'a/', 'a//b', 'a/../b', '.', 'a\\b', 'a\u0001b']) {
      expect(isValidScriptId(id), JSON.stringify(id)).toBe(false);
    }
  });

  it('derives the folder from the last id segment with forbidden characters replaced, and the target under <Data>/scripts/90_assistant', () => {
    expect(folderOf('assistant/nbsp-prepositions')).toBe('nbsp-prepositions');
    expect(folderOf('plain')).toBe('plain');
    expect(folderOf('a/b:c*d')).toBe('b_c_d');
    expect(DEFAULT_GROUP).toBe('90_assistant');
    expect(targetFolder('/home/u/.local/share/maxfbeditor', '90_assistant', 'nbsp')).toBe(
      '/home/u/.local/share/maxfbeditor/scripts/90_assistant/nbsp/',
    );
    expect(targetFolder('/data/', '90_assistant', 'nbsp')).toBe('/data/scripts/90_assistant/nbsp/');
    expect(targetFolder('C:\\Users\\u\\AppData\\Roaming\\MFBE', '90_assistant', 'nbsp')).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\MFBE\\scripts\\90_assistant\\nbsp\\',
    );
  });
});

describe('the manifest checks', () => {
  it('parses a valid manifest with the defaults (entry index.js)', () => {
    const parsed = parseManifest(manifest({ entry: undefined }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.entry).toBe('index.js');
      expect(parsed.manifest.name.en).toBe('Non-breaking space after prepositions');
      expect(parsed.manifest.needsSelection).toBe(true);
    }
  });

  it('refuses invalid JSON, a non-object, another manifestVersion, a missing name.en and bad member types', () => {
    expect(parseManifest('{')).toMatchObject({ ok: false, reason: expect.stringMatching(/JSON/) });
    expect(parseManifest('[]')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/object/),
    });
    expect(parseManifest(manifest({ manifestVersion: 2 }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/manifestVersion must be 1/),
    });
    expect(parseManifest(manifest({ name: { ru: 'Имя' } }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/name\.en/),
    });
    expect(parseManifest(manifest({ name: 'Flat' }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/name\.en/),
    });
    expect(parseManifest(manifest({ kind: 'toolbar' }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/kind/),
    });
    expect(parseManifest(manifest({ entry: 5 }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/entry/),
    });
  });
});

describe('checkProposal (ai-catalogue §7.2)', () => {
  it('accepts a complete package: files normalised with sizes, the target under 90_assistant, no warnings, not existing', () => {
    const result = checkProposal(args(), options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { proposal } = result;
    expect(proposal.scriptId).toBe('assistant/nbsp-prepositions');
    expect(proposal.name).toBe('Non-breaking space after prepositions');
    expect(proposal.group).toBe('90_assistant');
    expect(proposal.folder).toBe('nbsp-prepositions');
    expect(proposal.target).toBe(
      '/home/u/.local/share/maxfbeditor/scripts/90_assistant/nbsp-prepositions/',
    );
    expect(proposal.existing).toBe(false);
    expect(proposal.warnings).toEqual([]);
    expect(proposal.files.map((f) => f.path)).toEqual(['script.json', 'index.js']);
    expect(proposal.files[1]!.bytes).toBe(new TextEncoder().encode(entry).length);
    expect(proposal.manifest.entry).toBe('index.js');
  });

  it('uses the manifest name of the interface language and honours group / folder', () => {
    const result = checkProposal(args({ group: 'my_tools', folder: 'nbsp' }), {
      ...options,
      uiLanguage: 'ru',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.name).toBe('Неразрывный пробел');
    expect(result.proposal.target).toBe('/home/u/.local/share/maxfbeditor/scripts/my_tools/nbsp/');
  });

  it('refuses a bad id, a missing or over-long summary and bad group / folder segments', () => {
    expect(checkProposal(args({ id: '/bad' }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', field: 'id' },
    });
    expect(checkProposal(args({ summary: '  ' }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', field: 'summary' },
    });
    expect(checkProposal(args({ summary: 'x'.repeat(MAX_SUMMARY_LENGTH) }), options).ok).toBe(true);
    expect(
      checkProposal(args({ summary: 'x'.repeat(MAX_SUMMARY_LENGTH + 1) }), options),
    ).toMatchObject({ ok: false, refusal: { code: 'invalidArguments', field: 'summary' } });
    expect(checkProposal(args({ group: '../up' }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', field: 'group' },
    });
    expect(checkProposal(args({ folder: 'CON' }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', field: 'folder' },
    });
  });

  it('refuses the path rule breaches per file, naming the file', () => {
    for (const path of ['../x.js', '/abs.js', 'lib\\x.js', 'a:b.js', 'NUL', 'lib/../x.js']) {
      const result = checkProposal(args({ files: files({ [path]: 'export {};' }) }), options);
      expect(result.ok, path).toBe(false);
      if (result.ok) continue;
      expect(result.refusal.code).toBe('invalidArguments');
      expect(result.refusal.field).toBe('files[2].path');
      expect(result.refusal.message).toContain(path);
    }
    // The same path twice (a trailing slash is an empty segment, refused before).
    expect(
      checkProposal(args({ files: [...files(), { path: 'index.js/', content: 'x' }] }), options),
    ).toMatchObject({ ok: false, refusal: { message: expect.stringMatching(/empty segment/) } });
    const twice = checkProposal(
      args({ files: [...files(), { path: 'index.js', content: 'x' }] }),
      options,
    );
    expect(twice).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', message: expect.stringMatching(/twice/) },
    });
  });

  it('enforces 1–64 files, ≤ 1 MiB each, ≤ 4 MiB in total and text without NUL', () => {
    expect(checkProposal(args({ files: [] }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', field: 'files' },
    });
    const many = [
      ...files(),
      ...Array.from({ length: MAX_FILES - 1 }, (_, i) => ({ path: `m${i}.js`, content: '' })),
    ];
    expect(many).toHaveLength(MAX_FILES + 1);
    expect(checkProposal(args({ files: many }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', message: expect.stringMatching(/at most 64/) },
    });
    expect(checkProposal(args({ files: many.slice(0, MAX_FILES) }), options).ok).toBe(true);
    const big = 'a'.repeat(MAX_FILE_BYTES + 1);
    expect(checkProposal(args({ files: files({ 'big.txt': big }) }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', field: 'files[2].content' },
    });
    expect(
      checkProposal(args({ files: files({ 'big.txt': 'a'.repeat(MAX_FILE_BYTES) }) }), options).ok,
    ).toBe(true);
    // Five files just under 1 MiB each exceed the 4 MiB total.
    const chunk = 'b'.repeat(MAX_FILE_BYTES - 10);
    const total = checkProposal(
      args({
        files: files({
          'a.txt': chunk,
          'b.txt': chunk,
          'c.txt': chunk,
          'd.txt': chunk,
          'e.txt': chunk,
        }),
      }),
      options,
    );
    expect(total).toMatchObject({
      ok: false,
      refusal: {
        code: 'invalidArguments',
        field: 'files',
        message: expect.stringMatching(/4 MiB/),
      },
    });
    expect(MAX_TOTAL_BYTES).toBe(4 * 1024 * 1024);
    expect(checkProposal(args({ files: files({ 'bin.txt': 'a\u0000b' }) }), options)).toMatchObject(
      { ok: false, refusal: { code: 'invalidArguments', message: expect.stringMatching(/NUL/) } },
    );
    // Sizes are bytes: 600k Cyrillic letters are 1.2 MB.
    expect(
      checkProposal(args({ files: files({ 'ru.txt': 'я'.repeat(600_000) }) }), options),
    ).toMatchObject({ ok: false, refusal: { field: 'files[2].content' } });
  });

  it('requires script.json, manifestVersion 1, the same id, name.en and the entry among the files', () => {
    expect(
      checkProposal(args({ files: [{ path: 'index.js', content: entry }] }), options),
    ).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', message: expect.stringMatching(/script\.json/) },
    });
    expect(
      checkProposal(
        args({ files: files({ 'script.json': manifest({ manifestVersion: 2 }) }) }),
        options,
      ),
    ).toMatchObject({ ok: false, refusal: { field: 'files.script.json' } });
    expect(
      checkProposal(
        args({ files: files({ 'script.json': manifest({ id: 'assistant/other' }) }) }),
        options,
      ),
    ).toMatchObject({
      ok: false,
      refusal: {
        field: 'files.script.json.id',
        message: expect.stringMatching(/assistant\/other/),
      },
    });
    expect(
      checkProposal(
        args({ files: files({ 'script.json': manifest({ id: undefined }) }) }),
        options,
      ),
    ).toMatchObject({ ok: false, refusal: { field: 'files.script.json.id' } });
    expect(
      checkProposal(
        args({ files: files({ 'script.json': manifest({ name: { ru: 'Имя' } }) }) }),
        options,
      ),
    ).toMatchObject({ ok: false, refusal: { message: expect.stringMatching(/name\.en/) } });
    expect(
      checkProposal(
        args({ files: files({ 'script.json': manifest({ entry: 'main.js' }) }) }),
        options,
      ),
    ).toMatchObject({ ok: false, refusal: { message: expect.stringMatching(/main\.js/) } });
    expect(checkProposal(args({ files: files({ 'script.json': '{' }) }), options)).toMatchObject({
      ok: false,
      refusal: { code: 'invalidArguments', message: expect.stringMatching(/JSON/) },
    });
  });

  it('refuses a bundled id before any dialog, and an existing user id unless overwrite', () => {
    const bundled = checkProposal(
      args({
        id: '18/remove-spaces',
        files: files({ 'script.json': manifest({ id: '18/remove-spaces' }) }),
      }),
      options,
    );
    expect(bundled).toMatchObject({
      ok: false,
      refusal: { code: 'scriptIdBundled', hint: expect.stringMatching(/new id/) },
    });
    const existingArgs = args({
      id: 'assistant/already-there',
      files: files({ 'script.json': manifest({ id: 'assistant/already-there' }) }),
    });
    expect(checkProposal(existingArgs, options)).toMatchObject({
      ok: false,
      refusal: { code: 'scriptExists', hint: expect.stringMatching(/overwrite/) },
    });
    const replaced = checkProposal({ ...existingArgs, overwrite: true }, options);
    expect(replaced.ok).toBe(true);
    if (replaced.ok) expect(replaced.proposal.existing).toBe(true);
  });
});

describe('the forbidden-API scan (data-model §10.4)', () => {
  it('finds every name of the list with its file and line, also behind globalThis.', () => {
    for (const name of FORBIDDEN_NAMES) {
      const code = `export default async function run() {\n  const x = ${name};\n  return x;\n}\n`;
      const hits = scanFile('index.js', code);
      expect(hits, name).toEqual([{ path: 'index.js', line: 2, name, text: `const x = ${name};` }]);
      const viaGlobal = scanFile('lib.js', `const y = globalThis.${name}.call;\n`);
      expect(
        viaGlobal.map((w) => w.name),
        `globalThis.${name}`,
      ).toEqual([name]);
    }
    expect(scanFile('a.js', 'const f = new Function("return 1");')).toEqual([
      { path: 'a.js', line: 1, name: 'new Function', text: 'const f = new Function("return 1");' },
    ]);
    expect(scanFile('a.js', 'const f = new  Function("x");').map((w) => w.name)).toEqual([
      'new Function',
    ]);
  });

  it("flags fetch( and require('fs') in the fixture-like code with the right lines", () => {
    const code = [
      'async function loadExtraWords() {',
      '  const response = await fetch(EXTRA_WORDS_URL);',
      '  const text = await response.text();',
      "  const fs = require('fs');",
      "  fs.writeFileSync('one-letter-words.txt', text);",
      '  return text;',
      '}',
    ].join('\n');
    expect(scanFile('index.js', code)).toEqual([
      {
        path: 'index.js',
        line: 2,
        name: 'fetch',
        text: 'const response = await fetch(EXTRA_WORDS_URL);',
      },
      { path: 'index.js', line: 4, name: 'require', text: "const fs = require('fs');" },
    ]);
  });

  it('does not count a property of another object, a longer identifier or the mfbe API', () => {
    const code = [
      'const doc = await mfbe.doc.get();',
      'const node = ctx.document;',
      'const fetched = 1; const windowed = 2; const processes = 3;',
      'obj.fetch(); self.window; x.require("y");',
      'const $window = 1;',
    ].join('\n');
    expect(scanFile('a.js', code)).toEqual([]);
  });

  it('tolerates names inside string literals, template literals and comments (not scanned)', () => {
    const code = [
      "const s = 'call fetch() here';",
      'const d = "window.document";',
      '// fetch is forbidden',
      '/* window',
      '   document */ const ok = 1;',
      'const tpl = `no fetch ${mfbe.x} here`;',
      "const esc = 'it\\'s fetch';",
    ].join('\n');
    expect(scanFile('a.js', code)).toEqual([]);
    // A hole of a template literal is code.
    expect(scanFile('b.js', 'const t = `x ${fetch(u)} y`;').map((w) => w.name)).toEqual(['fetch']);
    // Blanking keeps the columns and the code outside the literals.
    const state = { inBlockComment: false, inTemplate: false };
    expect(blankStringsAndComments("a('b') + c // d", state)).toBe('a(   ) + c     ');
    expect(blankStringsAndComments('x /* y', state)).toBe('x     ');
    expect(state.inBlockComment).toBe(true);
    expect(blankStringsAndComments('z */ w', state)).toBe('     w');
    expect(state.inBlockComment).toBe(false);
  });

  it('allows relative imports and warns about bare ones (static, dynamic and re-exports)', () => {
    const code = [
      "import { strip } from './strip-lib.js';",
      "import helpers from '../lib/helpers.js';",
      "import fs from 'fs';",
      'import "node:path";',
      "const m = await import('lodash');",
      "const ok = await import('./dyn.js');",
      "export { x } from 'pkg';",
      "export * from './local.js';",
    ].join('\n');
    expect(scanFile('index.js', code)).toEqual([
      { path: 'index.js', line: 3, name: 'import "fs"', text: "import fs from 'fs';" },
      { path: 'index.js', line: 4, name: 'import "node:path"', text: 'import "node:path";' },
      {
        path: 'index.js',
        line: 5,
        name: 'import "lodash"',
        text: "const m = await import('lodash');",
      },
      { path: 'index.js', line: 7, name: 'import "pkg"', text: "export { x } from 'pkg';" },
    ]);
  });

  it('scans the code files of a proposal only (not the manifest or text files)', () => {
    const warnings = scanProposal([
      { path: 'script.json', content: '{"fetch": "window"}' },
      { path: 'README.txt', content: 'uses fetch' },
      { path: 'index.js', content: 'fetch(1);' },
      { path: 'lib/x.mjs', content: 'process.exit();' },
    ]);
    expect(warnings.map((w) => `${w.path}:${w.line}:${w.name}`)).toEqual([
      'index.js:1:fetch',
      'lib/x.mjs:1:process',
    ]);
    const checked = checkProposal(
      args({ files: files({ 'index.js': 'fetch(1);\nconst fs = require("fs");' }) }),
      options,
    );
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.proposal.warnings.map((w) => [w.line, w.name])).toEqual([
        [1, 'fetch'],
        [2, 'require'],
      ]);
    }
  });
});

describe('the author line (resource-formats §D)', () => {
  it('proposes the localised default with the date', () => {
    expect(defaultAuthorLine(t, new Date(2026, 9, 23))).toBe(
      'Written with the AI assistant of Maxima Fiction Book Editor, 2026-10-23',
    );
    expect(defaultAuthorLine(t, new Date(2026, 0, 5))).toContain('2026-01-05');
  });

  it('inserts the line as the first comment line of the entry module; a cleared line inserts nothing', () => {
    const line = 'Written with the AI assistant of Maxima Fiction Book Editor, 2026-10-23 (Quark)';
    const out = withAuthorLine(entry, line);
    expect(out.split('\n')[0]).toBe(`// ${line}`);
    expect(out.endsWith(entry)).toBe(true);
    expect(withAuthorLine(entry, '   ')).toBe(entry);
    expect(withAuthorLine(entry, '')).toBe(entry);
    expect(withAuthorLine('a\r\nb', 'x\ny').split('\r\n').slice(0, 2)).toEqual(['// x', '// y']);
  });

  it('filesToWrite puts the author line into the entry module alone', () => {
    const checked = checkProposal(args(), options);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const written = filesToWrite(checked.proposal, 'By me');
    expect(written.map((f) => f.path)).toEqual(['script.json', 'index.js']);
    expect(written[0]!.content).toBe(manifest());
    expect(written[1]!.content.startsWith('// By me\n/* global mfbe */')).toBe(true);
  });
});

describe('the FR-084 gate (review C9)', () => {
  const written = { id: 'assistant/nbsp', requestId: 'r1', writtenAt: 10, runRequested: false };

  it('lets a script not written in this conversation run as any user script', () => {
    expect(runAllowed(undefined, { id: 'r1', instructionAt: 1 })).toBe(true);
  });

  it('refuses the same request after Write, allows it after Write and run', () => {
    expect(runAllowed(written, { id: 'r1', instructionAt: 5 })).toBe(false);
    expect(runAllowed({ ...written, runRequested: true }, { id: 'r1', instructionAt: 5 })).toBe(
      true,
    );
    // Write and run of another request does not open this one.
    expect(runAllowed({ ...written, runRequested: true }, { id: 'r2', instructionAt: 5 })).toBe(
      false,
    );
  });

  it('allows a later instruction sent after the write', () => {
    expect(runAllowed(written, { id: 'r2', instructionAt: 11 })).toBe(true);
    expect(runAllowed(written, { id: 'r2', instructionAt: 10 })).toBe(false);
  });
});
