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
