import { createCommandRegistry, type CommandContext } from '@/app/commands';
import { FBE_DEFAULT_HOTKEYS } from '@/app/defaultHotkeys';
import {
  DEFAULT_HOTKEYS,
  defaultKeysFor,
  HotkeyMap,
  captureHotkey,
  chordFromKeyboardEvent,
  detectPlatform,
  formatChord,
  formatChordForDisplay,
  isReservedChord,
  isTypingChord,
  normalizeChord,
  normalizeKeyName,
  parseChord,
  validateChord,
  type Chord,
} from '@/app/hotkeys';
import { createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';

function key(
  overrides: Partial<KeyboardEvent> & { key: string },
): Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> {
  return {
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('hotkeys: chord grammar', () => {
  it('normalises key tokens', () => {
    expect(normalizeKeyName('b')).toBe('B');
    expect(normalizeKeyName('7')).toBe('7');
    expect(normalizeKeyName('f3')).toBe('F3');
    expect(normalizeKeyName('F12')).toBe('F12');
    expect(normalizeKeyName('F13')).toBeNull();
    expect(normalizeKeyName('esc')).toBe('Escape');
    expect(normalizeKeyName('Return')).toBe('Enter');
    expect(normalizeKeyName('pageup')).toBe('PageUp');
    expect(normalizeKeyName('Up')).toBe('ArrowUp');
    expect(normalizeKeyName(' ')).toBe('Space');
    expect(normalizeKeyName(';')).toBe(';');
    expect(normalizeKeyName('`')).toBe('`');
    expect(normalizeKeyName('unicode:a0')).toBe('Unicode:00A0');
    expect(normalizeKeyName('Unicode:1F600')).toBe('Unicode:1F600');
    expect(normalizeKeyName('ё')).toBe('Unicode:0451');
    expect(normalizeKeyName('Ctrl')).toBeNull();
    expect(normalizeKeyName('')).toBeNull();
    expect(normalizeKeyName('Bogus')).toBeNull();
  });

  it('parses chords in canonical modifier order and resolves Mod per platform', () => {
    expect(normalizeChord('Mod+B', 'linux')).toBe('Ctrl+B');
    expect(normalizeChord('Mod+B', 'windows')).toBe('Ctrl+B');
    expect(normalizeChord('Mod+B', 'mac')).toBe('Meta+B');
    expect(normalizeChord('shift+ctrl+f', 'linux')).toBe('Ctrl+Shift+F');
    expect(normalizeChord('Cmd+Option+K', 'mac')).toBe('Alt+Meta+K');
    expect(normalizeChord('Control+Alt+Delete', 'linux')).toBe('Ctrl+Alt+Delete');
    expect(normalizeChord('Mod+Shift+;', 'linux')).toBe('Ctrl+Shift+;');
    expect(normalizeChord('Mod+`', 'linux')).toBe('Ctrl+`');
    expect(normalizeChord('Ctrl++', 'linux')).toBe('Ctrl++');
    expect(normalizeChord('F2', 'linux')).toBe('F2');
    expect(normalizeChord('Alt+Unicode:00A0', 'linux')).toBe('Alt+Unicode:00A0');
  });

  it('rejects invalid chords', () => {
    expect(parseChord('', 'linux')).toBeNull();
    expect(parseChord('Ctrl+', 'linux')).toBeNull();
    expect(parseChord('Ctrl', 'linux')).toBeNull();
    expect(parseChord('Ctrl+Ctrl+B', 'linux')).toBeNull();
    expect(parseChord('Hyper+B', 'linux')).toBeNull();
    expect(parseChord('Ctrl+Bogus', 'linux')).toBeNull();
    expect(parseChord('B+Ctrl', 'linux')).toBeNull();
  });

  it('formats chords for display per platform', () => {
    const chord = parseChord('Mod+Alt+Shift+K', 'mac')!;
    expect(formatChord(chord)).toBe('Alt+Shift+Meta+K');
    expect(formatChordForDisplay(chord, 'mac')).toBe('Option+Shift+Cmd+K');
    expect(formatChordForDisplay(parseChord('Meta+K', 'linux')!, 'linux')).toBe('Win+K');
  });

  it('detects the platform from navigator-like data', () => {
    expect(detectPlatform({ platform: 'MacIntel', userAgent: '' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32', userAgent: '' })).toBe('windows');
    expect(detectPlatform({ platform: 'Linux x86_64', userAgent: 'X11' })).toBe('linux');
    // No platform information at all (not the host's jsdom navigator) falls back to Linux.
    expect(detectPlatform({})).toBe('linux');
  });
});

describe('hotkeys: KeyboardEvent translation', () => {
  it('uses the physical key code so layouts do not matter', () => {
    const chord = chordFromKeyboardEvent(key({ key: 'и', code: 'KeyB', ctrlKey: true }));
    expect(chord && formatChord(chord)).toBe('Ctrl+B');
    expect(
      formatChord(chordFromKeyboardEvent(key({ key: '!', code: 'Digit1', shiftKey: true }))!),
    ).toBe('Shift+1');
    expect(
      formatChord(
        chordFromKeyboardEvent(key({ key: ':', code: 'Semicolon', altKey: true, shiftKey: true }))!,
      ),
    ).toBe('Alt+Shift+;');
    expect(
      formatChord(chordFromKeyboardEvent(key({ key: '~', code: 'Backquote', ctrlKey: true }))!),
    ).toBe('Ctrl+`');
    expect(
      formatChord(
        chordFromKeyboardEvent(key({ key: 'Enter', code: 'NumpadEnter', ctrlKey: true }))!,
      ),
    ).toBe('Ctrl+Enter');
    expect(
      formatChord(chordFromKeyboardEvent(key({ key: '5', code: 'Numpad5', altKey: true }))!),
    ).toBe('Alt+5');
    expect(formatChord(chordFromKeyboardEvent(key({ key: 'F5', code: 'F5' }))!)).toBe('F5');
    expect(
      formatChord(
        chordFromKeyboardEvent(key({ key: ' ', code: 'Space', ctrlKey: true, altKey: true }))!,
      ),
    ).toBe('Ctrl+Alt+Space');
  });

  it('falls back to the key value when no code is available', () => {
    expect(formatChord(chordFromKeyboardEvent(key({ key: 'b', ctrlKey: true }))!)).toBe('Ctrl+B');
    expect(formatChord(chordFromKeyboardEvent(key({ key: 'Escape' }))!)).toBe('Escape');
    expect(formatChord(chordFromKeyboardEvent(key({ key: 'ArrowDown', altKey: true }))!)).toBe(
      'Alt+ArrowDown',
    );
    expect(formatChord(chordFromKeyboardEvent(key({ key: 'ё', altKey: true }))!)).toBe(
      'Alt+Unicode:0451',
    );
  });

  it('returns null for modifier-only and dead keys', () => {
    expect(
      chordFromKeyboardEvent(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true })),
    ).toBeNull();
    expect(
      chordFromKeyboardEvent(key({ key: 'Shift', code: 'ShiftRight', shiftKey: true })),
    ).toBeNull();
    expect(
      chordFromKeyboardEvent(key({ key: 'Meta', code: 'MetaLeft', metaKey: true })),
    ).toBeNull();
    expect(chordFromKeyboardEvent(key({ key: 'Dead', code: 'Quote' }))).toEqual(
      expect.objectContaining({ key: "'" }),
    );
    expect(chordFromKeyboardEvent(key({ key: 'Dead' }))).toBeNull();
  });
});

describe('hotkeys: validation', () => {
  const c = (text: string, platform: 'linux' | 'windows' | 'mac' = 'linux'): Chord =>
    parseChord(text, platform)!;

  it('rejects platform-reserved chords with "Wrong shortcut!"', () => {
    expect(isReservedChord(c('Alt+F4', 'windows'), 'windows')).toBe(true);
    expect(isReservedChord(c('Alt+F4', 'linux'), 'linux')).toBe(true);
    expect(isReservedChord(c('Alt+F4', 'mac'), 'mac')).toBe(false);
    expect(isReservedChord(c('Meta+Q', 'mac'), 'mac')).toBe(true);
    expect(isReservedChord(c('Cmd+H', 'mac'), 'mac')).toBe(true);
    expect(isReservedChord(c('Cmd+M', 'mac'), 'mac')).toBe(true);
    expect(isReservedChord(c('Cmd+Shift+S', 'mac'), 'mac')).toBe(false);
    expect(isReservedChord(c('Win+E', 'windows'), 'windows')).toBe(true);
    expect(isReservedChord(c('Ctrl+Alt+Delete', 'linux'), 'linux')).toBe(true);
    expect(validateChord(c('Alt+F4'), 'linux')).toEqual({ ok: false, problem: 'reserved' });
    expect(validateChord(c('Mod+Q', 'mac'), 'mac')).toEqual({ ok: false, problem: 'reserved' });
  });

  it('rejects chords that would break typing', () => {
    expect(isTypingChord(c('B'))).toBe(true);
    expect(isTypingChord(c('Shift+B'))).toBe(true);
    expect(isTypingChord(c('Enter'))).toBe(true);
    expect(isTypingChord(c('Shift+Tab'))).toBe(true);
    expect(isTypingChord(c('Space'))).toBe(true);
    expect(isTypingChord(c('ArrowLeft'))).toBe(true);
    expect(isTypingChord(c('Unicode:0451'))).toBe(true);
    // FBE defaults that must stay legal
    expect(isTypingChord(c('Shift+Enter'))).toBe(false);
    expect(isTypingChord(c('Shift+Insert'))).toBe(false);
    expect(isTypingChord(c('Escape'))).toBe(false);
    expect(isTypingChord(c('F2'))).toBe(false);
    expect(isTypingChord(c('Ctrl+Enter'))).toBe(false);
    expect(isTypingChord(c('Alt+Delete'))).toBe(false);
    expect(validateChord(c('B'), 'linux')).toEqual({ ok: false, problem: 'typing' });
    expect(validateChord(null, 'linux')).toEqual({ ok: false, problem: 'invalid' });
    expect(validateChord(c('Ctrl+Shift+B'), 'linux')).toEqual({ ok: true });
  });

  it('every default chord is valid on every platform', () => {
    for (const platform of ['linux', 'windows', 'mac'] as const) {
      for (const entry of DEFAULT_HOTKEYS) {
        const keys = defaultKeysFor(entry, platform);
        const chord = parseChord(keys, platform);
        expect(chord, `${entry.commandId} ${keys} on ${platform}`).not.toBeNull();
        expect(validateChord(chord, platform), `${entry.commandId} ${keys} on ${platform}`).toEqual(
          { ok: true },
        );
      }
    }
    // macOS replacements exist exactly for the chords the OS owns.
    expect(new HotkeyMap('mac').get('edit.replace')).toBe('Alt+Meta+F');
    expect(new HotkeyMap('mac').get('insert.image')).toBe('Ctrl+M');
    expect(new HotkeyMap('windows').get('edit.replace')).toBe('Ctrl+H');
  });

  it('defaults do not collide with each other', () => {
    for (const platform of ['linux', 'mac'] as const) {
      const map = new HotkeyMap(platform);
      expect(map.collisions()).toEqual([]);
    }
  });

  it('binds the AI assistant defaults: Mod+Shift+A toggles the panel, Mod+K asks (feature 005)', () => {
    expect(DEFAULT_HOTKEYS).toContainEqual({ commandId: 'ai.toggle', keys: 'Mod+Shift+A' });
    expect(DEFAULT_HOTKEYS).toContainEqual({ commandId: 'ai.ask', keys: 'Mod+K' });
    const linux = new HotkeyMap('linux');
    expect(linux.get('ai.toggle')).toBe('Ctrl+Shift+A');
    expect(linux.get('ai.ask')).toBe('Ctrl+K');
    const mac = new HotkeyMap('mac');
    expect(mac.get('ai.toggle')).toBe('Shift+Meta+A');
    expect(mac.display('ai.ask')).toBe('Cmd+K');
    // Neither chord is reserved on any platform, and neither is a menu mnemonic (Alt+letter).
    for (const platform of ['linux', 'windows', 'mac'] as const) {
      for (const keys of ['Mod+Shift+A', 'Mod+K']) {
        const chord = parseChord(keys, platform)!;
        expect(chord.alt).toBe(false);
        expect(isReservedChord(chord, platform)).toBe(false);
      }
    }
  });
});

describe('HotkeyMap', () => {
  it('exposes FBE defaults with Mod resolved per platform', () => {
    const linux = new HotkeyMap('linux');
    const mac = new HotkeyMap('mac');
    expect(linux.get('style.strong')).toBe('Ctrl+B');
    expect(mac.get('style.strong')).toBe('Meta+B');
    expect(linux.get('file.save')).toBe('F2');
    expect(linux.get('file.saveAs')).toBe('Shift+F2');
    expect(linux.get('edit.findNext')).toBe('F3');
    expect(linux.get('edit.replace')).toBe('Ctrl+H');
    expect(linux.get('view.body')).toBe('Alt+F2');
    expect(linux.get('file.new')).toBeUndefined();
    expect(linux.display('style.strong')).toBe('Ctrl+B');
    expect(mac.display('style.strong')).toBe('Cmd+B');
    expect(linux.bindings().find((b) => b.commandId === 'edit.undo')).toEqual({
      commandId: 'edit.undo',
      keys: 'Ctrl+Z',
      source: 'default',
    });
  });

  it('looks up commands by chord and from keyboard events', () => {
    const map = new HotkeyMap('linux');
    expect(map.lookup('Ctrl+Z')).toEqual(['edit.undo']);
    expect(map.lookup('Mod+Z')).toEqual(['edit.undo']);
    expect(map.lookup(parseChord('Shift+F2', 'linux')!)).toEqual(['file.saveAs']);
    expect(map.lookup('Ctrl+Shift+Alt+F9')).toEqual([]);

    const dispatched: string[] = [];
    const event = {
      ...key({ key: 'z', code: 'KeyZ', ctrlKey: true }),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    expect(map.handleKeyDown(event, (id) => (dispatched.push(id), true))).toBe(true);
    expect(dispatched).toEqual(['edit.undo']);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();

    // A disabled command leaves the event alone.
    const untouched = { ...event, preventDefault: vi.fn() };
    expect(map.handleKeyDown(untouched, () => false)).toBe(false);
    expect(untouched.preventDefault).not.toHaveBeenCalled();
    expect(map.handleKeyDown(key({ key: 'Control', ctrlKey: true }), () => true)).toBe(false);
  });

  it('assigns, detects collisions, displaces, unassigns and resets', () => {
    const map = new HotkeyMap('linux');
    const changes = vi.fn();
    map.subscribe(changes);

    expect(map.findCollision('Ctrl+B', 'file.new')).toBe('style.strong');
    expect(map.findCollision('Ctrl+B', 'style.strong')).toBeUndefined();
    expect(map.findCollision('Ctrl+Shift+F9')).toBeUndefined();

    const result = map.assign('file.new', 'Mod+B');
    expect(result).toEqual({ ok: true, keys: 'Ctrl+B', displaced: ['style.strong'] });
    expect(map.get('file.new')).toBe('Ctrl+B');
    expect(map.get('style.strong')).toBeUndefined();
    expect(map.lookup('Ctrl+B')).toEqual(['file.new']);
    expect(map.collisions()).toEqual([]);
    expect(map.userBindings()).toEqual(
      expect.arrayContaining([
        { commandId: 'file.new', keys: 'Ctrl+B', source: 'user' },
        { commandId: 'style.strong', keys: '', source: 'user' },
      ]),
    );
    expect(changes).toHaveBeenCalled();

    expect(map.assign('file.new', 'Alt+F4')).toEqual({ ok: false, problem: 'reserved' });
    expect(map.assign('file.new', 'K')).toEqual({ ok: false, problem: 'typing' });
    expect(map.assign('file.new', 'Nope')).toEqual({ ok: false, problem: 'invalid' });
    expect(map.get('file.new')).toBe('Ctrl+B'); // unchanged after rejections

    // Default restore asks for confirmation when another command holds the default chord.
    expect(map.resetToDefault('style.strong')).toEqual({ ok: false, collision: 'file.new' });
    expect(map.get('style.strong')).toBeUndefined();
    expect(map.resetToDefault('style.strong', { force: true })).toEqual({ ok: true });
    expect(map.get('style.strong')).toBe('Ctrl+B');
    expect(map.get('file.new')).toBeUndefined();
    expect(map.userBindings()).toEqual([{ commandId: 'file.new', keys: '', source: 'user' }]);

    map.unassign('edit.undo');
    expect(map.get('edit.undo')).toBeUndefined();
    expect(map.resetToDefault('edit.undo')).toEqual({ ok: true });
    expect(map.get('edit.undo')).toBe('Ctrl+Z');
    expect(map.userBindings().find((b) => b.commandId === 'edit.undo')).toBeUndefined();
  });

  it('loads user bindings from the core and reports stale collisions', () => {
    const map = new HotkeyMap('linux');
    map.setUserBindings([
      { commandId: 'file.new', keys: 'Mod+Z' }, // collides with edit.undo default
      { commandId: 'file.save', keys: '' }, // default removed
      { commandId: 'file.open', keys: 'garbage' }, // dropped
    ]);
    expect(map.get('file.new')).toBe('Ctrl+Z');
    expect(map.get('file.save')).toBeUndefined();
    expect(map.get('file.open')).toBe('Ctrl+O');
    expect(map.collisions()).toEqual([{ keys: 'Ctrl+Z', commandIds: ['edit.undo', 'file.new'] }]);
    expect(map.lookup('Ctrl+Z')).toEqual(['edit.undo', 'file.new']);
  });

  it('accepts dynamic defaults (symbols, scripts)', () => {
    const map = new HotkeyMap('linux', { defaults: [] });
    expect(map.bindings()).toEqual([]);
    map.addDefaults([{ commandId: 'symbol.1', keys: 'Alt+Shift+Space' }]);
    expect(map.get('symbol.1')).toBe('Alt+Shift+Space');
    expect(map.defaultFor('symbol.1')).toBe('Alt+Shift+Space');
  });
});

describe('captureHotkey (shortcut capture control)', () => {
  it('shows partial modifiers while incomplete and validates complete chords', () => {
    const partial = captureHotkey(
      key({ key: 'Control', code: 'ControlLeft', ctrlKey: true, shiftKey: true }),
      'linux',
    );
    expect(partial).toEqual({
      chord: null,
      text: 'Ctrl+Shift+',
      complete: false,
      validation: { ok: false, problem: 'invalid' },
    });

    const complete = captureHotkey(
      key({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true }),
      'linux',
    );
    expect(complete.complete).toBe(true);
    expect(complete.text).toBe('Ctrl+Shift+K');
    expect(complete.validation).toEqual({ ok: true });
    expect(complete.chord && formatChord(complete.chord)).toBe('Ctrl+Shift+K');

    const wrong = captureHotkey(key({ key: 'F4', code: 'F4', altKey: true }), 'windows');
    expect(wrong.validation).toEqual({ ok: false, problem: 'reserved' });

    const mac = captureHotkey(key({ key: 'q', code: 'KeyQ', metaKey: true }), 'mac');
    expect(mac.text).toBe('Cmd+Q');
    expect(mac.validation).toEqual({ ok: false, problem: 'reserved' });
  });
});

describe('the table commands (feature 006: decision 15, C6; resource-formats.md §7)', () => {
  const TABLE_IDS = createCommandRegistry()
    .byGroup('table')
    .map((command) => command.id);

  it('no table.* id has a default chord, on any platform', () => {
    expect(TABLE_IDS).toHaveLength(24);
    expect(DEFAULT_HOTKEYS.filter((entry) => entry.commandId.startsWith('table.'))).toEqual([]);
    expect(FBE_DEFAULT_HOTKEYS.filter((entry) => entry.commandId.startsWith('table.'))).toEqual([]);
    for (const platform of ['windows', 'linux', 'mac'] as const) {
      const map = new HotkeyMap(platform);
      for (const id of TABLE_IDS) {
        expect(map.get(id), `${platform} ${id}`).toBeUndefined();
        expect(map.defaultFor(id), `${platform} ${id}`).toBeUndefined();
      }
    }
    // Table... keeps its original Alt+T.
    expect(new HotkeyMap('linux').get('insert.table')).toBe('Alt+T');
  });

  it('each of the 24 accepts a chord of the user, and Reset removes it (no default to restore)', () => {
    const map = new HotkeyMap('linux');
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    TABLE_IDS.forEach((id, index) => {
      const keys = `Ctrl+Alt+Shift+${letters[index]}`;
      expect(map.assign(id, keys), id).toEqual({ ok: true, keys, displaced: [] });
      expect(map.get(id), id).toBe(keys);
      expect(map.lookup(keys), id).toEqual([id]);
    });
    expect(map.userBindings()).toHaveLength(24);
    for (const id of TABLE_IDS) {
      expect(map.resetToDefault(id), id).toEqual({ ok: true });
      expect(map.get(id), id).toBeUndefined();
    }
    expect(map.userBindings()).toEqual([]);
    // The usual rules hold: a reserved or a typing chord is refused.
    expect(map.assign('table.mergeCells', 'Alt+F4')).toEqual({ ok: false, problem: 'reserved' });
    expect(map.assign('table.mergeCells', 'M')).toEqual({ ok: false, problem: 'typing' });
  });

  it('with allowsHotkey as the dispatch filter, a chord of a scoped table command is consumed only for a target inside the scope element', () => {
    const registry = createCommandRegistry();
    const run = vi.fn();
    registry.replace({ id: 'table.mergeCells', group: 'table', hotkeyScope: 'tableTarget', run });
    const undo = vi.fn();
    registry.replace({ id: 'edit.undo', group: 'edit', run: undo });
    const map = new HotkeyMap('linux');
    expect(map.assign('table.mergeCells', 'Ctrl+Alt+M').ok).toBe(true);
    const ctx = {
      store: createAppStore(),
      rpc: null,
      undo: new UndoCoordinator(),
      dialogs: {} as CommandContext['dialogs'],
      hotkeys: map,
      t: ((text: string) => text) as unknown as CommandContext['t'],
      version: 'test',
    } satisfies CommandContext;
    const scope = document.createElement('div');
    const inside = document.createElement('p');
    scope.appendChild(inside);
    const outside = document.createElement('input');
    document.body.append(scope, outside);
    // As App.tsx dispatches: the scope filter first, then the registry.
    const press = (overrides: Partial<KeyboardEvent> & { key: string }, target: EventTarget) => {
      const event = {
        ...key(overrides),
        target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      const consumed = map.handleKeyDown(
        event,
        (id) => registry.allowsHotkey(id, event.target) && registry.dispatch(id, ctx),
      );
      return { consumed, prevented: event.preventDefault.mock.calls.length > 0 };
    };
    const chord = { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true };
    try {
      // No resolver yet: never consumed.
      expect(press(chord, inside)).toEqual({ consumed: false, prevented: false });
      const off = registry.setHotkeyScope('tableTarget', () => scope);
      expect(press(chord, inside)).toEqual({ consumed: true, prevented: true });
      expect(run).toHaveBeenCalledTimes(1);
      expect(press(chord, scope)).toEqual({ consumed: true, prevented: true });
      expect(press(chord, outside)).toEqual({ consumed: false, prevented: false });
      expect(press(chord, document.body)).toEqual({ consumed: false, prevented: false });
      expect(run).toHaveBeenCalledTimes(2);
      // An unscoped command keeps its chord everywhere.
      expect(press({ key: 'z', code: 'KeyZ', ctrlKey: true }, outside)).toEqual({
        consumed: true,
        prevented: true,
      });
      expect(undo).toHaveBeenCalledTimes(1);
      off();
      expect(press(chord, inside)).toEqual({ consumed: false, prevented: false });
    } finally {
      scope.remove();
      outside.remove();
    }
  });
});
