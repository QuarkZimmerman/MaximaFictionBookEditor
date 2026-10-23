/**
 * The script proposal's pure parts (feature 005 T077; ai-catalogue §3.4 `propose_script`, §7;
 * data-model §10; research review C9, E1; FR-082 to FR-084): what the catalogue checks before
 * any dialog is shown, what the dialog shows, and the FR-084 gate.
 *
 *  - the **pre-checks** (§7.2) mirror what `scripts.write` enforces (rpc-api §3.8, review E1) so
 *    that a proposal the core would refuse never reaches the user: the path rule per segment
 *    (relative, `/` separators, no `..`, no leading `/` or `\`, no control characters, none of
 *    `: * ? " < > |`, no NTFS reserved device name, ≤ 255 bytes), 1–64 files, ≤ 1 MiB each,
 *    ≤ 4 MiB in total, text without NUL, `script.json` present and parseable with the call's
 *    `id`, `manifestVersion` 1, `name.en`, the `entry` among the files; a bundled id →
 *    `scriptIdBundled`, an existing user package without `overwrite` → `scriptExists`;
 *  - the **forbidden-API scan** (§7.2, data-model §10.4): one warning per line that names
 *    something the fence forbids, found outside string literals and comments as far as a line
 *    scanner can tell - false positives are acceptable, a warning never blocks (FR-084);
 *  - the **author line** (resource-formats §D): proposed as `Written with the AI assistant of
 *    Maxima Fiction Book Editor, <date>` in the interface language, editable, inserted as the
 *    first comment line of the entry module;
 *  - the **target** `<Data>/scripts/<group>/<folder>/` with the default group `90_assistant`
 *    and the folder from the id's last segment;
 *  - the **FR-084 gate** (review C9): `run_script` on a script written in this conversation is
 *    allowed only after *Write and run* in the same request, or when the user's latest
 *    instruction was sent after the write.
 *
 * No UI, no RPC, no store: everything here is a pure function (`proposal.test.ts`). Part of the
 * lazy `ai-assistant` chunk.
 */

import type { TFunction } from 'i18next';

/* ------------------------------------------------------------------------ */
/* Limits and defaults (rpc-api §3.8; review E1)                              */
/* ------------------------------------------------------------------------ */

/** The assistant's own group folder under `<Data>/scripts/`. */
export const DEFAULT_GROUP = '90_assistant';

/** The id prefix of the default group's scripts (`assistant/<name>`). */
export const DEFAULT_ID_PREFIX = 'assistant/';

export const MIN_FILES = 1;
export const MAX_FILES = 64;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_SEGMENT_BYTES = 255;
export const MAX_SUMMARY_LENGTH = 500;
export const MANIFEST_FILE = 'script.json';
export const DEFAULT_ENTRY = 'index.js';

/* ------------------------------------------------------------------------ */
/* Shapes                                                                   */
/* ------------------------------------------------------------------------ */

/** One file of a proposal as the model sends it. */
export interface ProposalFile {
  path: string;
  content: string;
}

/** The arguments of `propose_script` (ai-catalogue §3.4). */
export interface ProposalArgs {
  id: string;
  group?: string;
  folder?: string;
  files: ProposalFile[];
  overwrite?: boolean;
  summary: string;
}

/** What the pre-checks need to know about the scripts that exist (from `scripts.list`). */
export interface ExistingScripts {
  /** Ids of the bundled layer's scripts - never written. */
  bundledIds: ReadonlySet<string>;
  /** Ids of the user, settings and portable layers' scripts (`existing` of the dialog). */
  userIds: ReadonlySet<string>;
}

/** The manifest members the checks and the dialog read (script-manifest.md §2). */
export interface ProposalManifest {
  manifestVersion: unknown;
  id?: string;
  name: Record<string, string>;
  description?: Record<string, string>;
  kind?: string;
  entry: string;
  needsSelection?: boolean;
}

/** A forbidden name found in the code (data-model §10.4). */
export interface ProposalWarning {
  path: string;
  /** 1-based. */
  line: number;
  name: string;
  /** The line's text, trimmed, for the dialog. */
  text: string;
}

/** The proposal as the dialog shows it (data-model §10.1 without the lifecycle members). */
export interface ScriptProposal {
  scriptId: string;
  /** The script's display name (the manifest's `name` in the UI language, `en` fallback). */
  name: string;
  summary: string;
  group: string;
  folder: string;
  files: { path: string; content: string; bytes: number }[];
  manifest: ProposalManifest;
  /** The target folder: `<Data>/scripts/<group>/<folder>/`. */
  target: string;
  /** A user script with this id exists: the dialog says "replaces". */
  existing: boolean;
  warnings: ProposalWarning[];
}

/** Why a proposal was refused before the dialog (ai-catalogue §3.4's codes). */
export type ProposalRefusalCode = 'invalidArguments' | 'scriptIdBundled' | 'scriptExists';

export interface ProposalRefusal {
  code: ProposalRefusalCode;
  message: string;
  hint?: string;
  /** The offending parameter (`files[2].path`, `summary`, `id`, ...). */
  field?: string;
}

export type ProposalCheck =
  { ok: true; proposal: ScriptProposal } | { ok: false; refusal: ProposalRefusal };

/* ------------------------------------------------------------------------ */
/* The path rule (review E1; rpc-api §3.8 "segment rule")                      */
/* ------------------------------------------------------------------------ */

const FORBIDDEN_CHARACTERS = /[:*?"<>|]/;
// eslint-disable-next-line no-control-regex -- the rule names the control characters themselves
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

const encoder = new TextEncoder();

/** UTF-8 length of a string. */
export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Why `segment` breaks the segment rule, or null: non-empty, not `.` or `..`, no `/` or `\`,
 * no control characters, none of `: * ? " < > |`, no NTFS reserved device name (with or
 * without an extension, ASCII case-insensitive), at most 255 bytes.
 */
export function segmentProblem(segment: string): string | null {
  if (segment === '') return 'empty segment';
  if (segment === '.' || segment === '..') return `"${segment}" is not allowed as a segment`;
  if (segment.includes('/') || segment.includes('\\')) return 'a segment cannot hold / or \\';
  if (CONTROL_CHARACTERS.test(segment)) return 'control characters are not allowed';
  if (FORBIDDEN_CHARACTERS.test(segment)) return 'none of : * ? " < > | is allowed';
  if (RESERVED_DEVICE_NAMES.test(segment)) {
    return `"${segment}" is a reserved device name on Windows`;
  }
  if (utf8Length(segment) > MAX_SEGMENT_BYTES) return 'a segment may hold at most 255 bytes';
  return null;
}

/**
 * Why `path` breaks the file path rule, or null: relative with `/` separators (a leading `/`
 * or `\` is refused, so is a backslash anywhere), every segment under the segment rule.
 */
export function pathProblem(path: string): string | null {
  if (path === '') return 'empty path';
  if (path.startsWith('/') || path.startsWith('\\')) return 'the path must be relative';
  if (path.includes('\\')) return 'use / as the separator';
  for (const segment of path.split('/')) {
    const problem = segmentProblem(segment);
    if (problem) return problem;
  }
  return null;
}

/** The loader's id rule (`scripts::is_valid_script_id`): slashes allowed as group separators. */
export function isValidScriptId(id: string): boolean {
  if (id === '') return false;
  if (CONTROL_CHARACTERS.test(id) || id.includes('\\')) return false;
  if (id.startsWith('/') || id.endsWith('/') || id.includes('//')) return false;
  return id.split('/').every((segment) => segment !== '.' && segment !== '..');
}

/** The normalised form under which two paths count as the same file. */
export function normalisePath(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}

/** The default package folder: the id's last segment with every forbidden character → `_`. */
export function folderOf(id: string): string {
  const last = id.split('/').filter(Boolean).pop() ?? id;
  // eslint-disable-next-line no-control-regex -- the rule names the control characters themselves
  const safe = last.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_');
  return safe === '' || safe === '.' || safe === '..' ? 'script' : safe;
}

/** `<Data>/scripts/<group>/<folder>/` with the data folder's own separator. */
export function targetFolder(dataDir: string, group: string, folder: string): string {
  const separator = dataDir.includes('\\') && !dataDir.includes('/') ? '\\' : '/';
  const base = dataDir.replace(/[\\/]+$/, '');
  return `${base}${separator}scripts${separator}${group}${separator}${folder}${separator}`;
}

/* ------------------------------------------------------------------------ */
/* The manifest                                                             */
/* ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string') return null;
    out[key] = text;
  }
  return out;
}

/**
 * Parses a `script.json` text into the members the proposal reads; a failure names the reason
 * (the loader's own validation runs again in the core before anything is written).
 */
export function parseManifest(
  text: string,
): { ok: true; manifest: ProposalManifest } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `script.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isRecord(value)) return { ok: false, reason: 'script.json must hold a JSON object' };
  if (value.manifestVersion !== 1) {
    return { ok: false, reason: 'script.json: manifestVersion must be 1' };
  }
  const name = stringMap(value.name);
  if (!name || typeof name.en !== 'string' || name.en.trim() === '') {
    return { ok: false, reason: 'script.json: name.en is required' };
  }
  if (value.id !== undefined && typeof value.id !== 'string') {
    return { ok: false, reason: 'script.json: id must be a string' };
  }
  if (value.entry !== undefined && typeof value.entry !== 'string') {
    return { ok: false, reason: 'script.json: entry must be a string' };
  }
  if (value.kind !== undefined && value.kind !== 'menu' && value.kind !== 'tree') {
    return { ok: false, reason: 'script.json: kind must be "menu" or "tree"' };
  }
  const description = value.description === undefined ? undefined : stringMap(value.description);
  if (value.description !== undefined && !description) {
    return { ok: false, reason: 'script.json: description must map languages to strings' };
  }
  return {
    ok: true,
    manifest: {
      manifestVersion: 1,
      ...(typeof value.id === 'string' ? { id: value.id } : {}),
      name,
      ...(description ? { description } : {}),
      ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
      entry: typeof value.entry === 'string' && value.entry !== '' ? value.entry : DEFAULT_ENTRY,
      ...(typeof value.needsSelection === 'boolean'
        ? { needsSelection: value.needsSelection }
        : {}),
    },
  };
}

/* ------------------------------------------------------------------------ */
/* The forbidden-API scan (data-model §10.4)                                   */
/* ------------------------------------------------------------------------ */

/** The names the fence forbids, as the contract lists them (ai-catalogue §7.2). */
export const FORBIDDEN_NAMES = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'localStorage',
  'sessionStorage',
  'caches',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'eval',
  'navigator',
  'document',
  'window',
  'require',
  'process',
  'Deno',
  'Bun',
] as const;

const FORBIDDEN_NAME_RE = new RegExp(
  `(?<![\\w$.])(?:globalThis\\s*\\.\\s*)?(${FORBIDDEN_NAMES.join('|')})(?![\\w$])`,
  'g',
);
const NEW_FUNCTION_RE = /(?<![\w$.])new\s+Function(?![\w$])/g;
/** `import … from '<specifier>'`, `import '<specifier>'`, `import('<specifier>')`. */
const IMPORT_RE = /(?<![\w$.])import\s*(?:\(\s*|(?:[\w$*{},\s]+?\s+from\s+)?)(['"])([^'"\n]*)\1/g;
/** `export … from '<specifier>'`. */
const EXPORT_FROM_RE = /(?<![\w$.])export\s+[\w$*{},\s]+?\s+from\s+(['"])([^'"\n]*)\1/g;

const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts']);

/** True for a file the scan reads (JavaScript / TypeScript modules). */
export function isCodeFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot >= 0 && CODE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

interface ScanState {
  /** Inside a `/* … *\/` comment carried over from the previous line. */
  inBlockComment: boolean;
  /** Inside a template literal carried over from the previous line. */
  inTemplate: boolean;
}

/**
 * The code of one line with string literals and comments blanked (replaced by spaces of the
 * same length, so columns keep), as far as a line scanner can tell: `//` comments, `/* *\/`
 * comments (across lines), `'…'`, `"…"` and `` `…` `` literals (templates across lines; their
 * `${…}` holes are kept as code). A regex literal is not recognised - a false positive there is
 * acceptable (data-model §10.4).
 */
export function blankStringsAndComments(line: string, state: ScanState): string {
  let out = '';
  let i = 0;
  const blank = (count: number) => {
    out += ' '.repeat(count);
    i += count;
  };
  while (i < line.length) {
    if (state.inBlockComment) {
      const end = line.indexOf('*/', i);
      if (end < 0) {
        blank(line.length - i);
        break;
      }
      blank(end + 2 - i);
      state.inBlockComment = false;
      continue;
    }
    if (state.inTemplate) {
      const ch = line[i]!;
      if (ch === '\\') {
        blank(Math.min(2, line.length - i));
        continue;
      }
      if (ch === '`') {
        blank(1);
        state.inTemplate = false;
        continue;
      }
      if (ch === '$' && line[i + 1] === '{') {
        // A hole: its code counts, up to the matching brace (nesting kept simple).
        let depth = 0;
        let j = i;
        for (; j < line.length; j += 1) {
          if (line[j] === '{') depth += 1;
          else if (line[j] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const end = j < line.length ? j + 1 : line.length;
        out += line.slice(i, end);
        i = end;
        continue;
      }
      blank(1);
      continue;
    }
    const ch = line[i]!;
    const next = line[i + 1];
    if (ch === '/' && next === '/') {
      blank(line.length - i);
      break;
    }
    if (ch === '/' && next === '*') {
      state.inBlockComment = true;
      blank(2);
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === '\\') j += 1;
        j += 1;
      }
      blank(Math.min(j + 1, line.length) - i);
      continue;
    }
    if (ch === '`') {
      state.inTemplate = true;
      blank(1);
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** True for a relative module specifier (`./x.js`, `../lib/y.js`). */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * Scans one code file: a warning per line and name - every forbidden name of the list (also
 * behind `globalThis.`), `new Function`, and a bare `import` / `export … from` of anything but
 * a relative path. Strings and comments are blanked first (`blankStringsAndComments`).
 */
export function scanFile(path: string, content: string): ProposalWarning[] {
  const warnings: ProposalWarning[] = [];
  const state: ScanState = { inBlockComment: false, inTemplate: false };
  const lines = content.split(/\r\n|\r|\n/);
  lines.forEach((raw, index) => {
    const code = blankStringsAndComments(raw, state);
    const found = new Set<string>();
    for (const match of code.matchAll(FORBIDDEN_NAME_RE)) found.add(match[1]!);
    if (NEW_FUNCTION_RE.test(code)) found.add('new Function');
    NEW_FUNCTION_RE.lastIndex = 0;
    // Imports are read from the raw line: the specifier is a string literal.
    for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
      for (const match of raw.matchAll(re)) {
        const specifier = match[2]!;
        if (!isRelativeSpecifier(specifier)) found.add(`import "${specifier}"`);
      }
    }
    for (const name of found) {
      warnings.push({ path, line: index + 1, name, text: raw.trim() });
    }
  });
  return warnings;
}

/** The scan of every code file of the proposal, in file order. */
export function scanProposal(files: readonly ProposalFile[]): ProposalWarning[] {
  return files.filter((file) => isCodeFile(file.path)).flatMap((f) => scanFile(f.path, f.content));
}

/* ------------------------------------------------------------------------ */
/* The author line (resource-formats §D)                                      */
/* ------------------------------------------------------------------------ */

/** The proposed author line in the interface language, with today's date (ISO, local). */
export function defaultAuthorLine(t: TFunction, now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return t('ai.proposal.authorDefault', { date }) as string;
}

/**
 * The entry module with `authorLine` as its first comment line (`// <line>`) - the very first
 * line of the file, ahead of any pragma or code; a line that is empty after trimming inserts
 * nothing (the user cleared it); a text of several lines becomes one comment line each.
 */
export function withAuthorLine(content: string, authorLine: string): string {
  const lines = authorLine
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const comment = lines.map((line) => `// ${line}`).join(newline);
  return `${comment}${newline}${content}`;
}

/* ------------------------------------------------------------------------ */
/* The pre-checks (ai-catalogue §7.2)                                          */
/* ------------------------------------------------------------------------ */

export interface CheckProposalOptions {
  /** `app.info().dataDir` - the target folder is shown in full. */
  dataDir: string;
  /** The interface language (the script's display name). */
  uiLanguage: string;
  existing: ExistingScripts;
}

const refuse = (
  code: ProposalRefusalCode,
  message: string,
  extra: { hint?: string; field?: string } = {},
): ProposalCheck => ({ ok: false, refusal: { code, message, ...extra } });

/**
 * The pre-checks before any dialog (ai-catalogue §7.2; data-model §10.3 mirrored): the
 * arguments, the path rule per file, the sizes, the manifest, the conflicts. A failure answers
 * the model with the failing file and reason; success yields the proposal the dialog shows
 * (warnings scanned, target computed, `existing` decided).
 */
export function checkProposal(args: ProposalArgs, options: CheckProposalOptions): ProposalCheck {
  if (typeof args.id !== 'string' || !isValidScriptId(args.id)) {
    return refuse(
      'invalidArguments',
      'id must be a script id: non-empty, no control characters, no backslash, no "." or ".." segment, no leading, trailing or doubled slash',
      { field: 'id', hint: 'Use assistant/<kebab-name>.' },
    );
  }
  if (typeof args.summary !== 'string' || args.summary.trim() === '') {
    return refuse('invalidArguments', 'summary is required: what the script does, for the user', {
      field: 'summary',
    });
  }
  if (args.summary.length > MAX_SUMMARY_LENGTH) {
    return refuse(
      'invalidArguments',
      `summary may hold at most ${MAX_SUMMARY_LENGTH} characters (${args.summary.length} given)`,
      { field: 'summary' },
    );
  }
  for (const [name, value] of [
    ['group', args.group],
    ['folder', args.folder],
  ] as const) {
    if (value === undefined) continue;
    const problem = typeof value === 'string' ? segmentProblem(value) : 'must be a string';
    if (problem) {
      return refuse('invalidArguments', `${name}: ${problem}`, { field: name });
    }
  }
  if (!Array.isArray(args.files) || args.files.length < MIN_FILES) {
    return refuse('invalidArguments', 'files must hold at least one file', { field: 'files' });
  }
  if (args.files.length > MAX_FILES) {
    return refuse(
      'invalidArguments',
      `files may hold at most ${MAX_FILES} files (${args.files.length} given)`,
      { field: 'files' },
    );
  }
  const seen = new Set<string>();
  let total = 0;
  const files: ScriptProposal['files'] = [];
  for (let i = 0; i < args.files.length; i += 1) {
    const file = args.files[i]!;
    const field = `files[${i}].path`;
    if (!isRecord(file) || typeof file.path !== 'string') {
      return refuse('invalidArguments', `${field}: every file needs a path`, { field });
    }
    const problem = pathProblem(file.path);
    if (problem) {
      return refuse('invalidArguments', `${field} "${file.path}": ${problem}`, {
        field,
        hint: 'Paths are relative to the package folder, with / as the separator.',
      });
    }
    const normalised = normalisePath(file.path);
    if (seen.has(normalised)) {
      return refuse('invalidArguments', `${field} "${file.path}": the path is given twice`, {
        field,
      });
    }
    seen.add(normalised);
    if (typeof file.content !== 'string') {
      return refuse('invalidArguments', `files[${i}].content must be a string`, {
        field: `files[${i}].content`,
      });
    }
    if (file.content.includes('\u0000')) {
      return refuse(
        'invalidArguments',
        `files[${i}].content "${file.path}": text only - a NUL character was found`,
        { field: `files[${i}].content` },
      );
    }
    const bytes = utf8Length(file.content);
    if (bytes > MAX_FILE_BYTES) {
      return refuse(
        'invalidArguments',
        `files[${i}].content "${file.path}": ${bytes} bytes exceed the 1 MiB limit per file`,
        { field: `files[${i}].content` },
      );
    }
    total += bytes;
    files.push({ path: normalised, content: file.content, bytes });
  }
  if (total > MAX_TOTAL_BYTES) {
    return refuse(
      'invalidArguments',
      `the files hold ${total} bytes together, more than the 4 MiB limit`,
      { field: 'files' },
    );
  }
  const manifestFile = files.find((file) => file.path === MANIFEST_FILE);
  if (!manifestFile) {
    return refuse('invalidArguments', `the files must include ${MANIFEST_FILE}`, {
      field: 'files',
      hint: 'See mfbe://script-manifest.md for the manifest and mfbe://example-script for a complete package.',
    });
  }
  const parsed = parseManifest(manifestFile.content);
  if (!parsed.ok) {
    return refuse('invalidArguments', parsed.reason, {
      field: `files.${MANIFEST_FILE}`,
      hint: 'See mfbe://script-manifest.md for the manifest.',
    });
  }
  const { manifest } = parsed;
  if (manifest.id !== args.id) {
    return refuse(
      'invalidArguments',
      manifest.id === undefined
        ? `${MANIFEST_FILE} must carry "id": "${args.id}"`
        : `${MANIFEST_FILE} says id "${manifest.id}" but the call says "${args.id}"`,
      { field: `files.${MANIFEST_FILE}.id` },
    );
  }
  const entry = normalisePath(manifest.entry);
  if (!files.some((file) => file.path === entry)) {
    return refuse(
      'invalidArguments',
      `the entry module "${manifest.entry}" named by ${MANIFEST_FILE} is not among the files`,
      { field: 'files' },
    );
  }
  if (options.existing.bundledIds.has(args.id)) {
    return refuse('scriptIdBundled', `"${args.id}" is a bundled script, which is never modified`, {
      hint: 'Propose the changed script under a new id such as assistant/<name>.',
    });
  }
  const existing = options.existing.userIds.has(args.id);
  if (existing && !args.overwrite) {
    return refuse('scriptExists', `a user script with the id "${args.id}" exists`, {
      hint: 'Pass overwrite: true to replace it whole (read_script first), or choose another id.',
    });
  }
  const group = args.group ?? DEFAULT_GROUP;
  const folder = args.folder ?? folderOf(args.id);
  return {
    ok: true,
    proposal: {
      scriptId: args.id,
      name: manifest.name[options.uiLanguage] ?? manifest.name.en ?? args.id,
      summary: args.summary,
      group,
      folder,
      files,
      manifest: { ...manifest, entry },
      target: targetFolder(options.dataDir, group, folder),
      existing,
      warnings: scanProposal(files),
    },
  };
}

/** The files as `scripts.write` receives them: the author line inserted into the entry module. */
export function filesToWrite(
  proposal: Pick<ScriptProposal, 'files' | 'manifest'>,
  authorLine: string,
): ProposalFile[] {
  return proposal.files.map((file) => ({
    path: file.path,
    content:
      file.path === proposal.manifest.entry
        ? withAuthorLine(file.content, authorLine)
        : file.content,
  }));
}

/* ------------------------------------------------------------------------ */
/* The FR-084 gate (review C9)                                                 */
/* ------------------------------------------------------------------------ */

/** A script written in this conversation (data-model §10.2). */
export interface WrittenScript {
  id: string;
  /** The request whose proposal wrote it. */
  requestId: string;
  /** When it was written, on the conversation's clock (a monotonic sequence or a timestamp). */
  writtenAt: number;
  /** The user chose *Write and run*: the run is allowed in `requestId`. */
  runRequested: boolean;
}

/** The request asking for the run: its id and when its instruction was sent (same clock). */
export interface RunningRequest {
  id: string;
  instructionAt: number;
}

/**
 * The FR-084 gate (ai-catalogue §7.6): a script not written in this conversation runs as any
 * user script; one written here runs only (a) after *Write and run* in the same request or (b)
 * when the request's instruction was sent after the write.
 */
export function runAllowed(written: WrittenScript | undefined, request: RunningRequest): boolean {
  if (!written) return true;
  if (written.runRequested && written.requestId === request.id) return true;
  return request.instructionAt > written.writtenAt;
}

/** The hint of the `runNotConfirmed` envelope (ai-catalogue §3.4, §7.6). */
export const RUN_NOT_CONFIRMED_HINT =
  'the user has not asked to run this script; ask the user, who may run it from the Scripts menu or tell you to run it';
