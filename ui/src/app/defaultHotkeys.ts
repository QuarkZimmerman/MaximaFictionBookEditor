/**
 * Default keyboard shortcuts of the original editor (FictionBook Editor 2.7,
 * `FBE/Settings.cpp` `CSettings::InitHotkeyGroups()`), transcribed command by command into the
 * chord grammar of resource-formats.md §7 and mapped onto the command ids of `commands.ts`
 * (T131). This table is the reference the Hotkeys settings page documents; the engine in
 * `hotkeys.ts` (`DEFAULT_HOTKEYS`) must agree with it - `diffDefaultTables()` lists every
 * divergence so a unit test (and the coordinator) can see them.
 *
 * Transcription rules:
 *  - `FCONTROL` becomes `Mod` (Ctrl on Windows/Linux, Cmd on macOS); `FALT` -> `Alt`,
 *    `FSHIFT` -> `Shift`. Modifiers are exact (an accelerator with `FALT` only does not fire
 *    with Shift held), so `U::StringToKeycode(L":")` = `VK_OEM_1` is the physical `;` key:
 *    FBE's "Alt+:" display was the key-cap name of that key, the chord is `Alt+;`.
 *  - `VK_OEM_3` is the backquote key, `VK_BACK` Backspace, `VK_RETURN` Enter, `VK_PRIOR` /
 *    `VK_NEXT` PageUp / PageDown.
 *  - `mac` holds the platform adaptation of chords that macOS reserves (Cmd+H hides the
 *    application, Cmd+M minimises, Cmd+Tab switches applications) - FR-092 "adapted to
 *    platform conventions".
 *  - Entries whose FBE default is `NULL` (Subscript, Superscript, Collapse/Expand 1-9,
 *    SelectID, SelectTableID, Add to dictionary, Ignore) have no default and are listed with
 *    `keys: ''` so the Hotkeys page knows the command belongs to the group.
 *  - The Plugins group (`LastPlugin`, Alt+`) is dropped: the editor has no plug-in system.
 *  - Symbols (`symN` from `symbols.ini`) get their defaults at run time from
 *    `resources.symbols()` (`features/symbols.ts`), so they are not part of this table.
 *  - Commands this editor added have no original counterpart; they are listed with an empty
 *    `fbeName` so the Hotkeys page shows them in their group (`edit.completeTag`, feature 003).
 */

import type { CommandGroup } from './commands';
import { DEFAULT_HOTKEYS, normalizeChord, type DefaultHotkey } from './hotkeys';
import type { Platform } from './hotkeys';

export interface FbeDefaultHotkey extends DefaultHotkey {
  /** FBE's hotkey group (`CHotkeysGroup` name). */
  group: CommandGroup;
  /** FBE's registry name of the hotkey (`CHotkey::m_reg_name`); empty for an addition. */
  fbeName: string;
}

export const FBE_DEFAULT_HOTKEYS: readonly FbeDefaultHotkey[] = [
  // ---- File ------------------------------------------------------------
  { group: 'file', fbeName: 'Open', commandId: 'file.open', keys: 'Mod+O' },
  { group: 'file', fbeName: 'Save', commandId: 'file.save', keys: 'F2' },
  { group: 'file', fbeName: 'SaveAs', commandId: 'file.saveAs', keys: 'Shift+F2' },
  { group: 'file', fbeName: 'Validate', commandId: 'file.validate', keys: 'F8' },

  // ---- Edit ------------------------------------------------------------
  { group: 'edit', fbeName: 'AddAnnotation', commandId: 'insert.annotation', keys: 'Mod+J' },
  { group: 'edit', fbeName: 'AddBody', commandId: 'insert.body', keys: 'Alt+Shift+B' },
  { group: 'edit', fbeName: 'AddEpigraph', commandId: 'insert.epigraph', keys: 'Mod+N' },
  { group: 'edit', fbeName: 'AddSectionImage', commandId: 'insert.sectionImage', keys: 'Mod+G' },
  { group: 'edit', fbeName: 'AddTextAuthor', commandId: 'insert.textAuthor', keys: 'Mod+D' },
  { group: 'edit', fbeName: 'AddTitle', commandId: 'insert.title', keys: 'Mod+T' },
  { group: 'edit', fbeName: 'Bold', commandId: 'style.strong', keys: 'Mod+B' },
  { group: 'edit', fbeName: 'Clone', commandId: 'edit.clone', keys: 'Mod+Enter' },
  { group: 'edit', fbeName: 'Copy', commandId: 'edit.copy', keys: 'Mod+C' },
  { group: 'edit', fbeName: 'Cut', commandId: 'edit.cut', keys: 'Mod+X' },
  { group: 'edit', fbeName: 'Find', commandId: 'edit.find', keys: 'Mod+F' },
  { group: 'edit', fbeName: 'FindNext', commandId: 'edit.findNext', keys: 'F3' },
  {
    group: 'edit',
    fbeName: 'IncrementalSearch',
    commandId: 'edit.incrementalSearch',
    keys: 'Alt+I',
  },
  { group: 'edit', fbeName: 'InsertCite', commandId: 'insert.cite', keys: 'Alt+C' },
  {
    group: 'edit',
    fbeName: 'InsertImage',
    commandId: 'insert.image',
    keys: 'Mod+M',
    mac: 'Ctrl+M',
  },
  { group: 'edit', fbeName: 'InsertInlineImage', commandId: 'insert.inlineImage', keys: 'Alt+M' },
  { group: 'edit', fbeName: 'InsertPoem', commandId: 'insert.poem', keys: 'Mod+P' },
  { group: 'edit', fbeName: 'Italic', commandId: 'style.emphasis', keys: 'Mod+I' },
  { group: 'edit', fbeName: 'Merge', commandId: 'edit.merge', keys: 'Alt+Delete' },
  { group: 'edit', fbeName: 'Subscript', commandId: 'style.sub', keys: '' },
  { group: 'edit', fbeName: 'Superscript', commandId: 'style.sup', keys: '' },
  { group: 'edit', fbeName: 'Paste', commandId: 'edit.paste', keys: 'Shift+Insert' },
  { group: 'edit', fbeName: 'Redo', commandId: 'edit.redo', keys: 'Mod+Y' },
  { group: 'edit', fbeName: 'Replace', commandId: 'edit.replace', keys: 'Mod+H', mac: 'Alt+Mod+F' },
  { group: 'edit', fbeName: 'Split', commandId: 'edit.split', keys: 'Shift+Enter' },
  { group: 'edit', fbeName: 'Undo', commandId: 'edit.undo', keys: 'Mod+Z' },
  { group: 'edit', fbeName: 'InsertTable', commandId: 'insert.table', keys: 'Alt+T' },
  {
    group: 'edit',
    fbeName: 'RemoveOuterSection',
    commandId: 'edit.removeOuter',
    keys: 'Mod+Alt+Space',
  },
  // Source view tag completion (feature 003 US8): Ctrl+Space on every platform, the usual
  // completion chord (Cmd+Space is Spotlight on macOS).
  { group: 'edit', fbeName: '', commandId: 'edit.completeTag', keys: 'Ctrl+Space' },

  // ---- Navigation ------------------------------------------------------
  {
    group: 'navigation',
    fbeName: 'GotoFootnote',
    commandId: 'edit.gotoFootnote',
    keys: 'Mod+Backspace',
  },
  {
    group: 'navigation',
    fbeName: 'GotoMatchingTag',
    commandId: 'edit.gotoMatchTag',
    keys: 'Alt+;',
  },
  { group: 'navigation', fbeName: 'GotoWrongTag', commandId: 'edit.gotoWrongTag', keys: 'Mod+;' },
  {
    group: 'navigation',
    fbeName: 'NextItem',
    commandId: 'nav.nextItem',
    keys: 'Mod+Tab',
    mac: 'Ctrl+Tab',
  },
  ...collapseExpandDefaults(),
  { group: 'navigation', fbeName: 'SelectHref', commandId: 'nav.selectHref', keys: 'Alt+H' },
  { group: 'navigation', fbeName: 'SelectID', commandId: 'nav.selectId', keys: '' },
  { group: 'navigation', fbeName: 'SelectTableID', commandId: 'nav.selectTableId', keys: '' },
  { group: 'navigation', fbeName: 'SelectText', commandId: 'nav.selectText', keys: 'Escape' },
  { group: 'navigation', fbeName: 'SelectTree', commandId: 'nav.selectTree', keys: 'Alt+Q' },

  // ---- Style -----------------------------------------------------------
  { group: 'style', fbeName: 'Link', commandId: 'style.link', keys: 'Mod+L' },
  { group: 'style', fbeName: 'NoLink', commandId: 'style.removeLink', keys: 'Mod+U' },
  { group: 'style', fbeName: 'Normal', commandId: 'style.normal', keys: 'Alt+N' },
  { group: 'style', fbeName: 'Note', commandId: 'style.footnote', keys: 'Mod+W' },
  { group: 'style', fbeName: 'Subtitle', commandId: 'style.subtitle', keys: 'Alt+S' },
  { group: 'style', fbeName: 'TextAuthor', commandId: 'style.textAuthor', keys: 'Alt+A' },

  // ---- View ------------------------------------------------------------
  { group: 'view', fbeName: 'Body', commandId: 'view.body', keys: 'Alt+F2' },
  { group: 'view', fbeName: 'Description', commandId: 'view.description', keys: 'Alt+F1' },
  { group: 'view', fbeName: 'Source', commandId: 'view.source', keys: 'Alt+F3' },
  { group: 'view', fbeName: 'Fast mode', commandId: 'view.fastMode', keys: 'F5' },
  { group: 'view', fbeName: 'Toggle Tree View', commandId: 'view.tree', keys: 'Mod+F5' },
  // The AI assistant panel (feature 005 US3; research R8.5): an addition of this editor.
  { group: 'view', fbeName: '', commandId: 'ai.toggle', keys: 'Mod+Shift+A' },

  // ---- Scripts ---------------------------------------------------------
  { group: 'scripts', fbeName: 'LastScript', commandId: 'scripts.last', keys: 'Mod+`' },

  // ---- Tools -----------------------------------------------------------
  { group: 'tools', fbeName: 'Words', commandId: 'tools.words', keys: 'Alt+W' },
  { group: 'tools', fbeName: 'Spell check', commandId: 'tools.spellcheck', keys: 'F7' },
  {
    group: 'tools',
    fbeName: 'Toggle highlight',
    commandId: 'tools.spellHighlight',
    keys: 'Shift+F7',
  },
  // "Ask AI..." on the selection (feature 005 US2): an addition of this editor.
  { group: 'tools', fbeName: '', commandId: 'ai.ask', keys: 'Mod+K' },
];

function collapseExpandDefaults(): FbeDefaultHotkey[] {
  const out: FbeDefaultHotkey[] = [];
  for (let level = 1; level <= 9; level += 1) {
    out.push({
      group: 'navigation',
      fbeName: `Collapse${level}`,
      commandId: `source.collapse${level}`,
      keys: '',
    });
  }
  for (let level = 1; level <= 9; level += 1) {
    out.push({
      group: 'navigation',
      fbeName: `Expand${level}`,
      commandId: `source.expand${level}`,
      keys: '',
    });
  }
  return out;
}

/** The FBE defaults that actually bind a key (the `DefaultHotkey` subset for a `HotkeyMap`). */
export function fbeBoundDefaults(): DefaultHotkey[] {
  return FBE_DEFAULT_HOTKEYS.filter((entry) => entry.keys !== '').map(({ commandId, keys, mac }) =>
    mac ? { commandId, keys, mac } : { commandId, keys },
  );
}

export interface DefaultTableDifference {
  commandId: string;
  /** Canonical chord in the FBE table (undefined = no default). */
  fbe: string | undefined;
  /** Canonical chord in `hotkeys.ts` (undefined = no default). */
  engine: string | undefined;
}

/**
 * Compares this table with the engine defaults of `hotkeys.ts` for `platform` (canonical
 * chords). Commands without a key in both tables are not reported.
 */
export function diffDefaultTables(
  platform: Platform = 'linux',
  engine: readonly DefaultHotkey[] = DEFAULT_HOTKEYS,
): DefaultTableDifference[] {
  const canonical = (entry: DefaultHotkey | undefined): string | undefined => {
    if (!entry) return undefined;
    const keys = platform === 'mac' && entry.mac ? entry.mac : entry.keys;
    return keys ? (normalizeChord(keys, platform) ?? keys) : undefined;
  };
  const engineById = new Map(engine.map((entry) => [entry.commandId, entry]));
  const fbeById = new Map(FBE_DEFAULT_HOTKEYS.map((entry) => [entry.commandId, entry]));
  const ids = new Set([...fbeById.keys(), ...engineById.keys()]);
  const differences: DefaultTableDifference[] = [];
  for (const commandId of ids) {
    const fbe = canonical(fbeById.get(commandId));
    const eng = canonical(engineById.get(commandId));
    if (fbe !== eng) differences.push({ commandId, fbe, engine: eng });
  }
  return differences.sort((a, b) => a.commandId.localeCompare(b.commandId));
}
