// @vitest-environment node
/**
 * Feature 007, User Story 9 (T113; data-model §10, contracts/ai-catalogue.md, catalogue 2 → 3):
 * the assistant's script tools over the catalogue with a fake scripts surface.
 *
 *  - `list_scripts` narrows by `group` (an id or a group name) and by `query` - every word in
 *    the id, the names and descriptions in Russian and English or the legacy path, case and ё
 *    folded - and pages with `offset` and `limit` (default 50, at most 200); every entry names
 *    its `origin`, and `overrides: true` when it replaces another script;
 *  - `read_script` adds the descriptions in English and Russian, `legacy`, `origin` and
 *    `overrides`;
 *  - `run_script` asks for a run started by the assistant; a script that reads the clipboard
 *    fails with `clipboard.readNotAllowed`, reported as the outcome;
 *  - `propose_script` with `mode: 'modify'` proposes the changed files of a script in effect
 *    against its files, for the assistant's folder, and the result names the backup;
 *  - `list_script_backups` and `restore_script_backup` (the user's confirmation, or `declined`);
 *  - `catalogueVersion` is 3.
 */

import {
  CATALOGUE_VERSION,
  TOOL_NAMES,
  type CatalogueScript,
  type ScriptsDeps,
} from '@/ai/catalogue';
import { CATALOGUE_VERSION as CONTEXT_CATALOGUE_VERSION } from '@/ai/context';
import type { ScriptProposal } from '@/ai/proposal';
import { RpcError } from '@/rpc/client';
import type { ScriptBackupInfo } from '@/rpc/types';

import { harness, inlineSelection, type Harness } from './catalogueHarness';

/* ------------------------------------------------------------------------ */
/* The fake scripts surface                                                  */
/* ------------------------------------------------------------------------ */

const script = (over: Partial<CatalogueScript> & { id: string }): CatalogueScript => ({
  name: over.names?.en ?? over.id,
  names: { en: over.id },
  descriptions: {},
  kind: 'menu',
  needsSelection: false,
  group: '18_editing',
  groupNames: { en: 'Editing', ru: 'Редактирование' },
  source: 'bundled',
  origin: 'bundled',
  folder: `/app/scripts/${over.id}`,
  ...over,
});

const CHAPTERS = script({
  id: '13/chapter-titles',
  names: {
    en: "Bring chapter titles to the form 'Глава 1'",
    ru: "Привести заголовки глав к виду 'Глава 1'",
  },
  descriptions: {
    en: 'Rewrites chapter titles such as "XII" or "Глава двенадцатая" as "Глава 12".',
    ru: 'Переписывает заголовки глав в виде «Глава 12».',
  },
  group: '13_subtitles',
  groupNames: {
    en: 'Titles, subtitles, empty lines',
    ru: 'Заголовки, подзаголовки, пустые строки',
  },
  legacy: {
    source:
      "13_Заголовки, подзаголовки, пустые строки/30_Привести заголовки глав к виду 'Глава 1'.js",
    fbeVersion: '2.7.9',
  },
});
const PARTS = script({
  id: '13/part-titles',
  names: {
    en: "Bring part titles to the form 'Часть I'",
    ru: "Привести заголовки частей к виду 'Часть I'",
  },
  descriptions: { en: 'Rewrites part titles.', ru: 'Переписывает заголовки частей.' },
  group: '13_subtitles',
  groupNames: CHAPTERS.groupNames!,
  legacy: {
    source:
      "13_Заголовки, подзаголовки, пустые строки/40_Привести заголовки частей к виду 'Часть I'.js",
  },
});
const YO = script({
  id: '18/yo',
  names: { en: 'Replace ё', ru: 'Заменить Ё на Е' },
  descriptions: { en: 'Replaces the letter yo.', ru: 'Заменяет букву ё.' },
});
const SPACES = script({
  id: '18/remove-spaces',
  names: { en: 'Remove spaces', ru: 'Удалить пробелы' },
  descriptions: { en: 'Removes spaces from the selection' },
  needsSelection: true,
});
const CHANGED = script({
  id: '18/empty-line-before-poem-or-cite',
  names: { en: 'Empty line before a poem or a cite (changed)', ru: 'Пустая строка перед стихом' },
  origin: 'assistant',
  source: 'user',
  overrides: { origin: 'bundled' },
  folder: '/data/scripts/90_assistant/empty-line-before-poem-or-cite',
  legacy: {
    source: '18_Редактирование/04_Пустая строка перед стихом или цитатой.js',
    fbeVersion: '2.7',
  },
});
const TREE = script({
  id: 'test.tree.mark',
  kind: 'tree',
  group: 'tree',
  source: 'user',
  origin: 'user',
});
const CLIP = script({
  id: 'user.clipboard',
  names: { en: 'Paste from the clipboard' },
  group: '50_mine',
  groupNames: { en: 'Mine' },
  source: 'user',
  origin: 'user',
  folder: '/data/scripts/50_mine/clipboard',
});
/** 60 more scripts of one group, for the paging. */
const FILLER = Array.from({ length: 60 }, (_, i) =>
  script({
    id: `99/filler-${String(i + 1).padStart(2, '0')}`,
    group: '99_misc',
    groupNames: { en: 'Miscellaneous' },
  }),
);
const ALL = [CHAPTERS, PARTS, YO, SPACES, CHANGED, TREE, CLIP, ...FILLER];

interface FakeScripts extends ScriptsDeps {
  runs: { id: string; startedBy: string; treeNode?: { nodeId: string; type: string } }[];
  proposals: ScriptProposal[];
  restores: { id: string; backupId: string; name: string }[];
  backupsOf: Record<string, ScriptBackupInfo[]>;
  nextRun: Awaited<ReturnType<ScriptsDeps['run']>>;
  decision: Awaited<ReturnType<ScriptsDeps['propose']>> | Error;
  restoreDecision: Awaited<ReturnType<ScriptsDeps['restore']>> | Error;
}

function fakeScripts(): FakeScripts {
  const fake: FakeScripts = {
    runs: [],
    proposals: [],
    restores: [],
    backupsOf: {
      '18/empty-line-before-poem-or-cite': [
        { backupId: '20261031T101500Z', origin: 'assistant', createdAt: '2026-10-31T10:15:00Z' },
        { backupId: '20261031T100000Z', origin: 'bundled', createdAt: '2026-10-31T10:00:00Z' },
      ],
    },
    nextRun: { status: 'done', document: null, durationMs: 5 },
    decision: { written: false, declined: true },
    restoreDecision: { restored: true, backupId: '20261031T120000Z' },
    list: () => Promise.resolve({ scripts: ALL, issues: [] }),
    files: (id) =>
      Promise.resolve({
        folder: ALL.find((s) => s.id === id)?.folder ?? `/data/${id}`,
        entry: 'index.js',
        files: ['icon.png', 'index.js', 'script.json'],
      }),
    readFile: (id, file) => {
      if (file.endsWith('.png')) return Promise.resolve({ binary: true, bytes: 153 });
      if (file === 'script.json') {
        return Promise.resolve({
          content: JSON.stringify({ manifestVersion: 1, id, name: { en: 'x' }, kind: 'menu' }),
        });
      }
      return Promise.resolve({ content: `// ${id}\nconst a = 1;\nconst b = 2;\n` });
    },
    reload: () => Promise.resolve({ count: ALL.length, issues: [] }),
    bodyView: () => true,
    dataDir: () => Promise.resolve('/data'),
    uiLanguage: () => 'en',
    run: (target, options) => {
      fake.runs.push({ id: target.id, ...options });
      return Promise.resolve(fake.nextRun);
    },
    runAllowed: () => true,
    propose: (proposal) => {
      fake.proposals.push(proposal);
      return fake.decision instanceof Error
        ? Promise.reject(fake.decision)
        : Promise.resolve(fake.decision);
    },
    backups: (id) => Promise.resolve(fake.backupsOf[id] ?? []),
    restore: (request) => {
      fake.restores.push({
        id: request.script.id,
        backupId: request.backup.backupId,
        name: request.script.name,
      });
      return fake.restoreDecision instanceof Error
        ? Promise.reject(fake.restoreDecision)
        : Promise.resolve(fake.restoreDecision);
    },
  };
  return fake;
}

let h: Harness;
let fake: FakeScripts;

beforeEach(async () => {
  fake = fakeScripts();
  h = await harness({ scripts: fake });
});

afterEach(async () => {
  await h.catalogue.close();
});

const call = (name: string, args?: Record<string, unknown> | string) =>
  h.catalogue.call(name, args);

interface Entry {
  id: string;
  group: string;
  name: Record<string, string>;
  description?: string;
  kind: string;
  runnable: boolean;
  reason?: string;
  origin: string;
  overrides?: true;
}
interface Listing {
  total: number;
  offset: number;
  entries: Entry[];
}

async function list(args: Record<string, unknown> = {}): Promise<Listing> {
  const out = await call('list_scripts', args);
  expect(out.isError, JSON.stringify(out.result)).toBe(false);
  return out.result as unknown as Listing;
}

/* ------------------------------------------------------------------------ */
/* list_scripts                                                             */
/* ------------------------------------------------------------------------ */

describe('list_scripts (feature 007: group, query, offset, limit; origin and overrides)', () => {
  it('pages through every script: limit defaults to 50 and is at most 200', async () => {
    const first = await list();
    expect(first.total).toBe(ALL.length);
    expect(first.offset).toBe(0);
    expect(first.entries).toHaveLength(50);
    expect(first.entries.map((e) => e.id)).toEqual(ALL.slice(0, 50).map((s) => s.id));
    const rest = await list({ offset: 50 });
    expect(rest.offset).toBe(50);
    expect(rest.entries.map((e) => e.id)).toEqual(ALL.slice(50).map((s) => s.id));
    expect((await list({ limit: 200 })).entries).toHaveLength(ALL.length);
    expect((await list({ offset: '5', limit: '3' })).entries.map((e) => e.id)).toEqual(
      ALL.slice(5, 8).map((s) => s.id),
    );
    expect((await list({ offset: 500 })).entries).toEqual([]);
    for (const limit of [0, 201, -1]) {
      const out = await call('list_scripts', { limit });
      expect(out.error?.code, String(limit)).toBe('invalidArguments');
    }
    expect((await call('list_scripts', { offset: -1 })).error?.code).toBe('invalidArguments');
  });

  it('narrows by group: the group id or one of its names', async () => {
    const byId = await list({ group: '13_subtitles' });
    expect(byId.total).toBe(2);
    expect(byId.entries.map((e) => e.id)).toEqual(['13/chapter-titles', '13/part-titles']);
    const byName = await list({ group: 'заголовки, подзаголовки, пустые строки' });
    expect(byName.entries.map((e) => e.id)).toEqual(['13/chapter-titles', '13/part-titles']);
    expect((await list({ group: 'Miscellaneous', limit: 200 })).total).toBe(60);
    expect((await list({ group: 'no-such-group' })).total).toBe(0);
  });

  it('narrows by query: every word in the id, the names and descriptions (ru, en) or the legacy path, case and ё folded', async () => {
    const glava = await list({ query: 'глава' });
    expect(glava.entries.map((e) => e.id)).toEqual(['13/chapter-titles']);
    // Russian and English words, several of them (all must occur), any letter case.
    expect((await list({ query: 'ЗАГОЛОВКИ частей' })).entries.map((e) => e.id)).toEqual([
      '13/part-titles',
    ]);
    expect((await list({ query: 'chapter titles' })).entries.map((e) => e.id)).toEqual([
      '13/chapter-titles',
    ]);
    // The id and the legacy path.
    expect((await list({ query: 'remove-spaces' })).entries.map((e) => e.id)).toEqual([
      '18/remove-spaces',
    ]);
    expect((await list({ query: '30_Привести' })).entries.map((e) => e.id)).toEqual([
      '13/chapter-titles',
    ]);
    // ё and е are one letter for the search.
    expect((await list({ query: 'заменить е' })).entries.map((e) => e.id)).toEqual(['18/yo']);
    expect((await list({ query: 'букву Е' })).entries.map((e) => e.id)).toEqual(['18/yo']);
    // Together with the group, then paged.
    expect((await list({ group: '13_subtitles', query: 'часть' })).total).toBe(1);
    expect(
      (await list({ query: 'filler', offset: 10, limit: 5 })).entries.map((e) => e.id),
    ).toEqual(FILLER.slice(10, 15).map((s) => s.id));
    expect((await list({ query: 'filler' })).total).toBe(60);
    expect((await list({ query: '   ' })).total).toBe(ALL.length);
  });

  it('gives each entry its id, group, names in English and Russian, the English description, kind, runnable, origin and overrides', async () => {
    const { entries } = await list({ limit: 10 });
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get('13/chapter-titles')).toEqual({
      id: '13/chapter-titles',
      group: '13_subtitles',
      name: {
        en: "Bring chapter titles to the form 'Глава 1'",
        ru: "Привести заголовки глав к виду 'Глава 1'",
      },
      description: 'Rewrites chapter titles such as "XII" or "Глава двенадцатая" as "Глава 12".',
      kind: 'menu',
      runnable: true,
      origin: 'bundled',
    });
    expect(byId.get('18/remove-spaces')).toMatchObject({
      runnable: false,
      reason: 'needsSelection',
      origin: 'bundled',
    });
    expect(byId.get('18/empty-line-before-poem-or-cite')).toMatchObject({
      origin: 'assistant',
      overrides: true,
    });
    expect(byId.get('test.tree.mark')).toMatchObject({
      runnable: false,
      reason: 'treeOnly',
      origin: 'user',
    });
    expect(byId.get('user.clipboard')).not.toHaveProperty('description');
    expect(byId.get('user.clipboard')!.name).toEqual({ en: 'Paste from the clipboard' });
    // A selection makes the selection script runnable.
    h.setSelection(inlineSelection('n13', 0, 5));
    const withSelection = await list({ query: 'remove-spaces' });
    expect(withSelection.entries[0]).toMatchObject({ runnable: true });
    expect(withSelection.entries[0]).not.toHaveProperty('reason');
  });

  it('tells the model to narrow by group or query rather than page through everything', () => {
    const tool = h.catalogue.listed().find((t) => t.name === 'list_scripts')!;
    expect(tool.description).toMatch(/group/);
    expect(tool.description).toMatch(/query/);
    expect(tool.description).toMatch(/narrow/i);
    expect(Object.keys(tool.inputSchema.properties as object).sort()).toEqual([
      'group',
      'limit',
      'offset',
      'query',
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* read_script                                                              */
/* ------------------------------------------------------------------------ */

describe('read_script (feature 007: descriptions, legacy, origin, overrides)', () => {
  it('adds the descriptions in English and Russian, the legacy source, the origin and what it overrides', async () => {
    const out = await call('read_script', { id: '13/chapter-titles' });
    expect(out.isError).toBe(false);
    expect(out.result).toMatchObject({
      id: '13/chapter-titles',
      origin: 'bundled',
      description: {
        en: 'Rewrites chapter titles such as "XII" or "Глава двенадцатая" as "Глава 12".',
        ru: 'Переписывает заголовки глав в виде «Глава 12».',
      },
      legacy: {
        source:
          "13_Заголовки, подзаголовки, пустые строки/30_Привести заголовки глав к виду 'Глава 1'.js",
        fbeVersion: '2.7.9',
      },
    });
    expect(out.result).not.toHaveProperty('overrides');
    const files = out.result.files as { path: string; content?: string; binary?: boolean }[];
    expect(files.map((f) => f.path)).toEqual(['icon.png', 'index.js', 'script.json']);
    expect(files[0]).toEqual({ path: 'icon.png', binary: true, bytes: 153 });
    const changed = await call('read_script', { id: '18/empty-line-before-poem-or-cite' });
    expect(changed.result).toMatchObject({ origin: 'assistant', overrides: { origin: 'bundled' } });
  });
});

/* ------------------------------------------------------------------------ */
/* run_script                                                               */
/* ------------------------------------------------------------------------ */

describe('run_script (feature 007: started by the assistant)', () => {
  it('asks for a run started by the assistant', async () => {
    const out = await call('run_script', { id: '13/chapter-titles' });
    expect(out.isError).toBe(false);
    expect(fake.runs).toEqual([{ id: '13/chapter-titles', startedBy: 'assistant' }]);
    await call('run_script', { id: 'test.tree.mark', treeNode: 'body[1]/section[1]' });
    expect(fake.runs.at(-1)).toEqual({
      id: 'test.tree.mark',
      startedBy: 'assistant',
      treeNode: { nodeId: 'n10', type: 'section' },
    });
  });

  it('reports a clipboard read refused in its run as the outcome: clipboard.readNotAllowed', async () => {
    fake.nextRun = {
      status: 'failed',
      message: 'Script error: A script reads the clipboard only in a run you started yourself.',
      code: 'clipboard.readNotAllowed',
      durationMs: 4,
    };
    const out = await call('run_script', { id: 'user.clipboard' });
    expect(out.error?.code).toBe('scriptFailed');
    expect(out.error?.scriptError).toBe('clipboard.readNotAllowed');
    expect(out.error?.hint).toMatch(/clipboard/);
    expect(out.error?.hint).toMatch(/Scripts menu/);
  });
});

/* ------------------------------------------------------------------------ */
/* propose_script, mode: 'modify'                                            */
/* ------------------------------------------------------------------------ */

const manifestOf = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ manifestVersion: 1, id, name: { en: 'Changed' }, kind: 'menu', ...extra });
const changedFiles = (id: string) => [
  { path: 'script.json', content: manifestOf(id) },
  { path: 'index.js', content: `// ${id}\nconst a = 1;\nconst b = 3;\n` },
];
const SUMMARY = "Writes chapter titles as 'Глава I' instead of 'Глава 1'";

describe("propose_script (feature 007: mode 'modify')", () => {
  it('proposes the changed files of a bundled script against its files, for the assistant’s folder', async () => {
    fake.decision = {
      written: true,
      id: '13/chapter-titles',
      path: '/data/scripts/90_assistant/chapter-titles',
      warnings: [],
      runRequested: false,
      backupId: '20261031T110000Z',
    };
    const out = await call('propose_script', {
      id: '13/chapter-titles',
      mode: 'modify',
      files: changedFiles('13/chapter-titles'),
      summary: SUMMARY,
    });
    expect(out.isError, JSON.stringify(out.result)).toBe(false);
    // The result names the backup.
    expect(out.result).toEqual(fake.decision);
    expect(fake.proposals).toHaveLength(1);
    const proposal = fake.proposals[0]!;
    expect(proposal).toMatchObject({
      mode: 'modify',
      scriptId: '13/chapter-titles',
      group: '90_assistant',
      folder: 'chapter-titles',
      target: '/data/scripts/90_assistant/chapter-titles/',
      existing: false,
      summary: SUMMARY,
    });
    expect(proposal.modifies).toMatchObject({
      id: '13/chapter-titles',
      name: "Bring chapter titles to the form 'Глава 1'",
      origin: 'bundled',
    });
    expect(proposal.modifies!.files).toEqual([
      { path: 'icon.png', binary: true, bytes: 153 },
      { path: 'index.js', content: '// 13/chapter-titles\nconst a = 1;\nconst b = 2;\n' },
      {
        path: 'script.json',
        content: manifestOf('13/chapter-titles', { name: { en: 'x' } }),
      },
    ]);
  });

  it("changes an assistant's copy in its own folder, replacing it whole", async () => {
    const out = await call('propose_script', {
      id: '18/empty-line-before-poem-or-cite',
      mode: 'modify',
      files: changedFiles('18/empty-line-before-poem-or-cite'),
      summary: 'Adds the line before epigraphs too',
    });
    expect(out.result).toEqual({ written: false, declined: true });
    expect(fake.proposals[0]).toMatchObject({
      mode: 'modify',
      folder: 'empty-line-before-poem-or-cite',
      existing: true,
      modifies: { origin: 'assistant' },
    });
  });

  it('refuses a modify of no script in effect, outside the assistant’s folder or with another id in script.json', async () => {
    const unknown = await call('propose_script', {
      id: 'assistant/nothing',
      mode: 'modify',
      files: changedFiles('assistant/nothing'),
      summary: SUMMARY,
    });
    expect(unknown.error?.code).toBe('invalidArguments');
    expect(unknown.error?.hint).toMatch(/list_scripts/);
    const elsewhere = await call('propose_script', {
      id: '13/chapter-titles',
      mode: 'modify',
      group: '50_mine',
      files: changedFiles('13/chapter-titles'),
      summary: SUMMARY,
    });
    expect(elsewhere.error?.code).toBe('invalidArguments');
    expect(elsewhere.error?.field).toBe('group');
    const otherId = await call('propose_script', {
      id: '13/chapter-titles',
      mode: 'modify',
      files: changedFiles('13/part-titles'),
      summary: SUMMARY,
    });
    expect(otherId.error?.code).toBe('invalidArguments');
    expect(fake.proposals).toEqual([]);
  });

  it("keeps mode 'new' as before: a bundled id is refused with a hint to modify instead", async () => {
    const out = await call('propose_script', {
      id: '13/chapter-titles',
      files: changedFiles('13/chapter-titles'),
      summary: SUMMARY,
    });
    expect(out.error?.code).toBe('scriptIdBundled');
    expect(out.error?.hint).toMatch(/new id/);
    expect(out.error?.hint).toMatch(/modify/);
    const tool = h.catalogue.listed().find((t) => t.name === 'propose_script')!;
    const mode = (tool.inputSchema.properties as Record<string, { enum?: string[] }>).mode!;
    expect(mode.enum).toEqual(['new', 'modify']);
  });
});

/* ------------------------------------------------------------------------ */
/* list_script_backups, restore_script_backup                               */
/* ------------------------------------------------------------------------ */

describe('list_script_backups and restore_script_backup (feature 007)', () => {
  it('lists the backups of a script, newest first', async () => {
    const out = await call('list_script_backups', { id: '18/empty-line-before-poem-or-cite' });
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({
      backups: fake.backupsOf['18/empty-line-before-poem-or-cite'],
    });
    expect((await call('list_script_backups', { id: '13/chapter-titles' })).result).toEqual({
      backups: [],
    });
  });

  it('restores a backup once the user confirmed it, with the backup of the version it replaced', async () => {
    const out = await call('restore_script_backup', {
      id: '18/empty-line-before-poem-or-cite',
      backupId: '20261031T100000Z',
    });
    expect(out.isError, JSON.stringify(out.result)).toBe(false);
    expect(out.result).toEqual({ restored: true, backupId: '20261031T120000Z' });
    expect(fake.restores).toEqual([
      {
        id: '18/empty-line-before-poem-or-cite',
        backupId: '20261031T100000Z',
        name: 'Empty line before a poem or a cite (changed)',
      },
    ]);
  });

  it('answers declined when the user said no, and refuses an unknown backup before any dialog', async () => {
    fake.restoreDecision = { restored: false, declined: true };
    const declined = await call('restore_script_backup', {
      id: '18/empty-line-before-poem-or-cite',
      backupId: '20261031T101500Z',
    });
    expect(declined.isError).toBe(false);
    expect(declined.result).toEqual({ restored: false, declined: true });
    const unknown = await call('restore_script_backup', {
      id: '18/empty-line-before-poem-or-cite',
      backupId: '20000101T000000Z',
    });
    expect(unknown.error?.code).toBe('invalidArguments');
    expect(unknown.error?.hint).toMatch(/list_script_backups/);
    expect(fake.restores).toHaveLength(1);
    // The core's 1204 (gone meanwhile) as the same envelope.
    fake.restoreDecision = new RpcError(1204, 'script.backupNotFound', {
      id: '18/empty-line-before-poem-or-cite',
      backupId: '20261031T101500Z',
    });
    const gone = await call('restore_script_backup', {
      id: '18/empty-line-before-poem-or-cite',
      backupId: '20261031T101500Z',
    });
    expect(gone.error?.code).toBe('invalidArguments');
    // Never a hook call: restoring a script is no document change.
    expect(h.hookCalls).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* The catalogue's version                                                  */
/* ------------------------------------------------------------------------ */

describe('the catalogue version', () => {
  it('is 3, in the catalogue, the working context and get_context', async () => {
    expect(CATALOGUE_VERSION).toBe(3);
    expect(CONTEXT_CATALOGUE_VERSION).toBe(3);
    const out = await call('get_context', {});
    expect(out.result.catalogueVersion).toBe(3);
    expect(TOOL_NAMES).toContain('list_script_backups');
    expect(TOOL_NAMES).toContain('restore_script_backup');
  });
});
