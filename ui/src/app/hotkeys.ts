/**
 * Hotkey engine: chord grammar (resource-formats.md §7), platform `Mod` mapping, KeyboardEvent
 * translation, binding table with FBE's defaults, collision detection, per-platform reserved
 * chords ("Wrong shortcut!") and the capture-control helper used by the Hotkeys settings page.
 *
 * Chord grammar: `[Ctrl+][Alt+][Shift+][Meta+]Key`, `Mod` = Ctrl on Windows/Linux, Cmd (Meta) on
 * macOS. `Key` = `A`-`Z`, `0`-`9`, `F1`-`F12`, a named key (`Enter`, `Space`, `Tab`, `Escape`,
 * `Delete`, `Backspace`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `ArrowUp`, ...), a
 * single ASCII punctuation character (`;`, `` ` ``, `,` ...) or `Unicode:<hex>`.
 *
 * Keys are matched by physical position (`KeyboardEvent.code`) so that `Ctrl+B` works on a
 * Russian keyboard layout as it did in the original editor (virtual-key codes).
 */

import type { HotkeyBinding, HotkeyCollision, Platform } from '@/rpc/types';

export type { HotkeyBinding, HotkeyCollision, Platform } from '@/rpc/types';

export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Normalised key name, see `normalizeKeyName()`. */
  key: string;
}

/* ------------------------------------------------------------------------ */
/* Platform                                                                 */
/* ------------------------------------------------------------------------ */

export function detectPlatform(
  nav: { platform?: string; userAgent?: string } | undefined = typeof navigator !== 'undefined'
    ? navigator
    : undefined,
): Platform {
  const text = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`.toLowerCase();
  if (/mac|iphone|ipad|darwin/.test(text)) return 'mac';
  if (/win/.test(text)) return 'windows';
  return 'linux';
}

/** The modifier `Mod` stands for on this platform. */
export function modModifier(platform: Platform): 'ctrl' | 'meta' {
  return platform === 'mac' ? 'meta' : 'ctrl';
}

/* ------------------------------------------------------------------------ */
/* Key names                                                                */
/* ------------------------------------------------------------------------ */

const NAMED_KEYS = [
  'Enter',
  'Space',
  'Tab',
  'Escape',
  'Delete',
  'Backspace',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Pause',
  'PrintScreen',
  'ScrollLock',
  'NumLock',
  'CapsLock',
  'ContextMenu',
] as const;

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  return: 'Enter',
  del: 'Delete',
  ins: 'Insert',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  pgdown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  spacebar: 'Space',
  ' ': 'Space',
  backspace: 'Backspace',
  prtsc: 'PrintScreen',
};

const NAMED_LOOKUP = new Map<string, string>(NAMED_KEYS.map((name) => [name.toLowerCase(), name]));

/** `KeyboardEvent.code` -> key name for keys whose `code` differs from the chord grammar. */
const CODE_TO_KEY: Record<string, string> = {
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  IntlBackslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  NumpadEnter: 'Enter',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadDecimal: '.',
};

const PUNCTUATION = /^[!-/:-@[-`{-~]$/;

/**
 * Normalises a key token of the chord grammar. Returns null for tokens that are not valid keys
 * (modifier names, empty strings, unknown names).
 */
export function normalizeKeyName(raw: string): string | null {
  if (raw === ' ') return 'Space';
  const token = raw.trim();
  if (!token) return null;
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  const fkey = /^f([1-9]|1[0-2])$/i.exec(token);
  if (fkey) return `F${fkey[1]}`;
  const unicode = /^unicode:([0-9a-f]{1,6})$/i.exec(token);
  if (unicode) return `Unicode:${unicode[1]!.toUpperCase().padStart(4, '0')}`;
  const lower = token.toLowerCase();
  const alias = KEY_ALIASES[lower];
  if (alias) return alias;
  const named = NAMED_LOOKUP.get(lower);
  if (named) return named;
  if (token.length === 1) {
    if (PUNCTUATION.test(token)) return token;
    const codePoint = token.codePointAt(0)!;
    if (codePoint > 0x7f) return `Unicode:${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Parsing / formatting                                                     */
/* ------------------------------------------------------------------------ */

const MODIFIER_ALIASES: Record<string, keyof Omit<Chord, 'key'> | 'mod'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  ctl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
  mod: 'mod',
};

/**
 * Parses a chord string. `Mod` is resolved by platform. Returns null for an invalid chord
 * (unknown modifier or key, duplicate modifier, missing key).
 */
export function parseChord(text: string, platform: Platform): Chord | null {
  if (!text) return null;
  // Split on '+' but keep a trailing '+' key ("Ctrl++" or "Ctrl+Shift+=").
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '+' && current !== '' && i < text.length - 1) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);

  const chord: Chord = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!.trim();
    const isLast = i === parts.length - 1;
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier && !isLast) {
      const name = modifier === 'mod' ? modModifier(platform) : modifier;
      if (chord[name]) return null; // duplicate
      chord[name] = true;
      continue;
    }
    if (!isLast) return null;
    const key = normalizeKeyName(part);
    if (!key) return null;
    chord.key = key;
  }
  return chord.key ? chord : null;
}

/** Canonical form `Ctrl+Alt+Shift+Meta+Key`. */
export function formatChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  if (chord.meta) parts.push('Meta');
  parts.push(chord.key);
  return parts.join('+');
}

/** Human-readable form: `Cmd` on macOS, `Win` elsewhere for the Meta modifier. */
export function formatChordForDisplay(chord: Chord, platform: Platform): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push(platform === 'mac' ? 'Option' : 'Alt');
  if (chord.shift) parts.push('Shift');
  if (chord.meta) parts.push(platform === 'mac' ? 'Cmd' : 'Win');
  parts.push(chord.key === 'Space' ? 'Space' : chord.key);
  return parts.join('+');
}

/** Parses and re-formats; null when invalid. `Mod` becomes `Ctrl` or `Meta`. */
export function normalizeChord(text: string, platform: Platform): string | null {
  const chord = parseChord(text, platform);
  return chord ? formatChord(chord) : null;
}

export function chordsEqual(a: Chord, b: Chord): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta &&
    a.key === b.key
  );
}

/* ------------------------------------------------------------------------ */
/* KeyboardEvent translation                                                */
/* ------------------------------------------------------------------------ */

const MODIFIER_KEY_VALUES = new Set([
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'AltGraph',
  'OS',
  'Hyper',
  'Super',
  'Fn',
  'FnLock',
  'Symbol',
  'SymbolLock',
]);

export type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

/** Key name derived from the physical key (`code`), falling back to the produced `key`. */
export function keyNameFromEvent(event: KeyEventLike): string | null {
  const code = event.code ?? '';
  if (code) {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1]!;
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (digit) return digit[1]!;
    const mapped = CODE_TO_KEY[code];
    if (mapped) return mapped;
    const fkey = /^F([1-9]|1[0-2])$/.exec(code);
    if (fkey) return `F${fkey[1]}`;
    const named = NAMED_LOOKUP.get(code.toLowerCase());
    if (named) return named;
  }
  const key = event.key ?? '';
  if (!key || MODIFIER_KEY_VALUES.has(key) || key === 'Dead' || key === 'Unidentified') return null;
  return normalizeKeyName(key);
}

/** Chord for a keydown event; null while only modifiers are pressed. */
export function chordFromKeyboardEvent(event: KeyEventLike): Chord | null {
  const key = keyNameFromEvent(event);
  if (!key) return null;
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key,
  };
}

/* ------------------------------------------------------------------------ */
/* Validation: reserved and typing chords                                    */
/* ------------------------------------------------------------------------ */

/** Chords the operating system or the browser engine owns; never bindable. */
export const RESERVED_CHORDS: Record<Platform, readonly string[]> = {
  windows: [
    'Alt+F4',
    'Alt+Tab',
    'Alt+Escape',
    'Ctrl+Escape',
    'Ctrl+Alt+Delete',
    'Ctrl+Shift+Escape',
  ],
  linux: ['Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete', 'Ctrl+Alt+Backspace'],
  mac: [
    'Meta+Q',
    'Meta+H',
    'Meta+M',
    'Meta+Alt+H',
    'Meta+Tab',
    'Meta+Space',
    'Meta+Alt+Escape',
    'Meta+Shift+Q',
  ],
};

/** Keys that type text or move the caret; bare (or Shift-only) they would break editing. */
const TYPING_KEYS = new Set([
  'Enter',
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export type ChordProblem = 'reserved' | 'typing' | 'invalid';

export interface ChordValidation {
  ok: boolean;
  /** Set when `ok` is false; every problem is reported to the user as "Wrong shortcut!". */
  problem?: ChordProblem;
}

export function isReservedChord(chord: Chord, platform: Platform): boolean {
  const canonical = formatChord(chord);
  if (RESERVED_CHORDS[platform].includes(canonical)) return true;
  // The Windows/Super key is the OS launcher on Windows and Linux desktops.
  if (platform !== 'mac' && chord.meta) return true;
  return false;
}

function isPrintableKey(key: string): boolean {
  return (
    /^[A-Z0-9]$/.test(key) || PUNCTUATION.test(key) || key.startsWith('Unicode:') || key === 'Space'
  );
}

/** A chord that would conflict with ordinary typing (bare letter, Shift+letter, bare Enter...). */
export function isTypingChord(chord: Chord): boolean {
  const hasCommandModifier = chord.ctrl || chord.alt || chord.meta;
  if (hasCommandModifier) return false;
  if (TYPING_KEYS.has(chord.key)) return !chord.shift || chord.key === 'Tab';
  if (isPrintableKey(chord.key)) return true;
  return false;
}

export function validateChord(chord: Chord | null, platform: Platform): ChordValidation {
  if (!chord) return { ok: false, problem: 'invalid' };
  if (isReservedChord(chord, platform)) return { ok: false, problem: 'reserved' };
  if (isTypingChord(chord)) return { ok: false, problem: 'typing' };
  return { ok: true };
}

/* ------------------------------------------------------------------------ */
/* Defaults (FictionBook Editor 2.7, Settings.cpp InitHotkeyGroups)          */
/* ------------------------------------------------------------------------ */

export interface DefaultHotkey {
  commandId: string;
  /** Chord in the grammar; `Mod` for the original `FCONTROL` modifier. */
  keys: string;
  /** macOS replacement when the `Mod` form would be a reserved chord (Cmd+H, Cmd+M, Cmd+Tab). */
  mac?: string;
}

/** The chord of a default entry on the given platform. */
export function defaultKeysFor(entry: DefaultHotkey, platform: Platform): string {
  return platform === 'mac' && entry.mac ? entry.mac : entry.keys;
}

/**
 * The original editor's defaults. `Mod` replaces Ctrl so macOS users get Cmd. T131 (Hotkeys
 * settings page) refines this table; the core's `hotkeys.defaults()` must agree with it.
 */
export const DEFAULT_HOTKEYS: readonly DefaultHotkey[] = [
  // File
  { commandId: 'file.open', keys: 'Mod+O' },
  { commandId: 'file.save', keys: 'F2' },
  { commandId: 'file.saveAs', keys: 'Shift+F2' },
  { commandId: 'file.validate', keys: 'F8' },
  // Edit
  { commandId: 'edit.undo', keys: 'Mod+Z' },
  { commandId: 'edit.redo', keys: 'Mod+Y' },
  { commandId: 'edit.cut', keys: 'Mod+X' },
  { commandId: 'edit.copy', keys: 'Mod+C' },
  { commandId: 'edit.paste', keys: 'Shift+Insert' },
  { commandId: 'edit.find', keys: 'Mod+F' },
  { commandId: 'edit.findNext', keys: 'F3' },
  { commandId: 'edit.replace', keys: 'Mod+H', mac: 'Alt+Mod+F' },
  { commandId: 'edit.incrementalSearch', keys: 'Alt+I' },
  { commandId: 'edit.clone', keys: 'Mod+Enter' },
  { commandId: 'edit.split', keys: 'Shift+Enter' },
  { commandId: 'edit.merge', keys: 'Alt+Delete' },
  { commandId: 'edit.removeOuter', keys: 'Mod+Alt+Space' },
  // Addition of this editor (feature 003 US8): Ctrl on every platform - Cmd+Space is Spotlight.
  { commandId: 'edit.completeTag', keys: 'Ctrl+Space' },
  { commandId: 'insert.annotation', keys: 'Mod+J' },
  { commandId: 'insert.body', keys: 'Alt+Shift+B' },
  { commandId: 'insert.epigraph', keys: 'Mod+N' },
  { commandId: 'insert.sectionImage', keys: 'Mod+G' },
  { commandId: 'insert.textAuthor', keys: 'Mod+D' },
  { commandId: 'insert.title', keys: 'Mod+T' },
  { commandId: 'insert.cite', keys: 'Alt+C' },
  { commandId: 'insert.image', keys: 'Mod+M', mac: 'Ctrl+M' },
  { commandId: 'insert.inlineImage', keys: 'Alt+M' },
  { commandId: 'insert.poem', keys: 'Mod+P' },
  { commandId: 'insert.table', keys: 'Alt+T' },
  { commandId: 'style.strong', keys: 'Mod+B' },
  { commandId: 'style.emphasis', keys: 'Mod+I' },
  // Navigation
  { commandId: 'edit.gotoFootnote', keys: 'Mod+Backspace' },
  { commandId: 'edit.gotoMatchTag', keys: 'Alt+Shift+;' },
  { commandId: 'edit.gotoWrongTag', keys: 'Mod+Shift+;' },
  { commandId: 'nav.nextItem', keys: 'Mod+Tab', mac: 'Ctrl+Tab' },
  { commandId: 'nav.selectHref', keys: 'Alt+H' },
  { commandId: 'nav.selectText', keys: 'Escape' },
  { commandId: 'nav.selectTree', keys: 'Alt+Q' },
  // Style
  { commandId: 'style.link', keys: 'Mod+L' },
  { commandId: 'style.removeLink', keys: 'Mod+U' },
  { commandId: 'style.normal', keys: 'Alt+N' },
  { commandId: 'style.footnote', keys: 'Mod+W' },
  { commandId: 'style.subtitle', keys: 'Alt+S' },
  { commandId: 'style.textAuthor', keys: 'Alt+A' },
  // View
  { commandId: 'view.body', keys: 'Alt+F2' },
  { commandId: 'view.description', keys: 'Alt+F1' },
  { commandId: 'view.source', keys: 'Alt+F3' },
  { commandId: 'view.fastMode', keys: 'F5' },
  { commandId: 'view.tree', keys: 'Mod+F5' },
  // Additions of this editor (feature 005): the AI assistant panel and "Ask AI..." - inert
  // while the assistant is disabled (the commands are invisible stubs then).
  { commandId: 'ai.toggle', keys: 'Mod+Shift+A' },
  // Tools
  { commandId: 'tools.words', keys: 'Alt+W' },
  { commandId: 'tools.spellcheck', keys: 'F7' },
  { commandId: 'tools.spellHighlight', keys: 'Shift+F7' },
  { commandId: 'ai.ask', keys: 'Mod+K' },
  // Scripts
  { commandId: 'scripts.last', keys: 'Mod+`' },
];

/* ------------------------------------------------------------------------ */
/* Binding table                                                            */
/* ------------------------------------------------------------------------ */

export type AssignResult =
  { ok: true; keys: string; displaced: string[] } | { ok: false; problem: ChordProblem };

export interface HotkeyMapOptions {
  defaults?: readonly DefaultHotkey[];
}

/**
 * Effective bindings = defaults overridden by user bindings. One chord per command (as in the
 * original editor); a chord may be shared by several commands only through stale user data,
 * which `collisions()` reports.
 */
export class HotkeyMap {
  readonly platform: Platform;
  private readonly defaults = new Map<string, string>(); // commandId -> canonical chord
  private readonly overrides = new Map<string, string>(); // commandId -> canonical chord or ''
  private readonly listeners = new Set<() => void>();

  constructor(platform: Platform, options: HotkeyMapOptions = {}) {
    this.platform = platform;
    for (const entry of options.defaults ?? DEFAULT_HOTKEYS) {
      const canonical = normalizeChord(defaultKeysFor(entry, platform), platform);
      if (canonical) this.defaults.set(entry.commandId, canonical);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Default chord of a command (canonical), if any. */
  defaultFor(commandId: string): string | undefined {
    return this.defaults.get(commandId);
  }

  /** Effective chord of a command (canonical), if any. */
  get(commandId: string): string | undefined {
    if (this.overrides.has(commandId)) return this.overrides.get(commandId) || undefined;
    return this.defaults.get(commandId);
  }

  /** Effective chord formatted for menus and tooltips. */
  display(commandId: string): string | undefined {
    const keys = this.get(commandId);
    if (!keys) return undefined;
    const chord = parseChord(keys, this.platform);
    return chord ? formatChordForDisplay(chord, this.platform) : keys;
  }

  /** All effective bindings with their source. */
  bindings(): HotkeyBinding[] {
    const ids = new Set([...this.defaults.keys(), ...this.overrides.keys()]);
    const result: HotkeyBinding[] = [];
    for (const commandId of ids) {
      const keys = this.get(commandId);
      if (!keys) continue;
      result.push({
        commandId,
        keys,
        source: this.overrides.has(commandId) ? 'user' : 'default',
      });
    }
    return result;
  }

  /** User overrides only (what gets persisted); `keys: ''` records a removed default. */
  userBindings(): HotkeyBinding[] {
    return [...this.overrides].map(([commandId, keys]) => ({ commandId, keys, source: 'user' }));
  }

  /** Replaces all user overrides (from `hotkeys.get()`); invalid chords are dropped. */
  setUserBindings(bindings: readonly Pick<HotkeyBinding, 'commandId' | 'keys'>[]): void {
    this.overrides.clear();
    for (const { commandId, keys } of bindings) {
      if (keys === '') {
        this.overrides.set(commandId, '');
        continue;
      }
      const canonical = normalizeChord(keys, this.platform);
      if (canonical) this.overrides.set(commandId, canonical);
    }
    this.emit();
  }

  /** Adds or replaces default bindings (dynamic commands: symbols, scripts). */
  addDefaults(defaults: readonly DefaultHotkey[]): void {
    for (const entry of defaults) {
      const canonical = normalizeChord(defaultKeysFor(entry, this.platform), this.platform);
      if (canonical) this.defaults.set(entry.commandId, canonical);
    }
    this.emit();
  }

  /** Command ids currently bound to the chord. */
  lookup(chord: Chord | string): string[] {
    const canonical =
      typeof chord === 'string' ? normalizeChord(chord, this.platform) : formatChord(chord);
    if (!canonical) return [];
    const ids: string[] = [];
    for (const binding of this.bindings()) {
      if (binding.keys === canonical) ids.push(binding.commandId);
    }
    return ids;
  }

  /** The other command holding the chord ("Assigned to ..."), if any. */
  findCollision(chord: Chord | string, exceptCommandId?: string): string | undefined {
    return this.lookup(chord).find((id) => id !== exceptCommandId);
  }

  /** Chords shared by several commands. */
  collisions(): HotkeyCollision[] {
    const byChord = new Map<string, string[]>();
    for (const binding of this.bindings()) {
      const ids = byChord.get(binding.keys) ?? [];
      ids.push(binding.commandId);
      byChord.set(binding.keys, ids);
    }
    return [...byChord]
      .filter(([, ids]) => ids.length > 1)
      .map(([keys, commandIds]) => ({ keys, commandIds }));
  }

  /**
   * Assigns a chord to a command. Reserved/typing/invalid chords are rejected ("Wrong
   * shortcut!"). Other commands holding the chord lose it; their ids are returned as `displaced`.
   */
  assign(commandId: string, keys: string | Chord): AssignResult {
    const chord = typeof keys === 'string' ? parseChord(keys, this.platform) : keys;
    const validation = validateChord(chord, this.platform);
    if (!validation.ok || !chord) return { ok: false, problem: validation.problem ?? 'invalid' };
    const canonical = formatChord(chord);
    const displaced = this.lookup(canonical).filter((id) => id !== commandId);
    for (const id of displaced) this.setOverride(id, '');
    this.setOverride(commandId, canonical);
    this.emit();
    return { ok: true, keys: canonical, displaced };
  }

  /** Removes the binding of a command. */
  unassign(commandId: string): void {
    this.setOverride(commandId, '');
    this.emit();
  }

  /**
   * Restores the default chord. When another command holds that chord the caller must confirm
   * ("Default hotkey for this command was assigned to X! Replace?") and pass `force`.
   */
  resetToDefault(
    commandId: string,
    options: { force?: boolean } = {},
  ): { ok: boolean; collision?: string } {
    const keys = this.defaults.get(commandId);
    if (!keys) {
      this.overrides.delete(commandId);
      this.emit();
      return { ok: true };
    }
    const collision = this.findCollision(keys, commandId);
    if (collision && !options.force) return { ok: false, collision };
    if (collision) this.setOverride(collision, '');
    this.overrides.delete(commandId);
    this.emit();
    return { ok: true };
  }

  /**
   * Dispatches a keydown: tries every command bound to the chord until `dispatch` returns true.
   * On success the event is consumed (preventDefault + stopPropagation).
   */
  handleKeyDown(
    event: KeyEventLike & Partial<Pick<KeyboardEvent, 'preventDefault' | 'stopPropagation'>>,
    dispatch: (commandId: string) => boolean,
  ): boolean {
    const chord = chordFromKeyboardEvent(event);
    if (!chord) return false;
    for (const commandId of this.lookup(chord)) {
      if (dispatch(commandId)) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return true;
      }
    }
    return false;
  }

  private setOverride(commandId: string, canonical: string): void {
    if (this.defaults.get(commandId) === canonical) {
      this.overrides.delete(commandId); // back to the default: no override needed
    } else {
      this.overrides.set(commandId, canonical);
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/* ------------------------------------------------------------------------ */
/* Capture control helper (Hotkeys settings page "Shortcut:" field)          */
/* ------------------------------------------------------------------------ */

export interface CapturedHotkey {
  /** Complete chord, or null while only modifiers are held. */
  chord: Chord | null;
  /** Text to show in the capture field, e.g. "Ctrl+Shift+" while incomplete. */
  text: string;
  complete: boolean;
  validation: ChordValidation;
}

/** Interprets a keydown inside the shortcut capture control. */
export function captureHotkey(event: KeyEventLike, platform: Platform): CapturedHotkey {
  const chord = chordFromKeyboardEvent(event);
  if (!chord) {
    const partial: Chord = {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      key: '',
    };
    const text = formatChordForDisplay(partial, platform); // ends with '+'
    return { chord: null, text, complete: false, validation: { ok: false, problem: 'invalid' } };
  }
  return {
    chord,
    text: formatChordForDisplay(chord, platform),
    complete: true,
    validation: validateChord(chord, platform),
  };
}
