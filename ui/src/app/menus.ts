/**
 * Main menu model: the eight top-level menus of the original `IDR_MAINFRAME MENU` with the same
 * items, separators and submenus. Labels come from `menu.*` i18n keys (with `&` accelerators);
 * command items take their label from the command's `labelKey`.
 */

export type MenuItemSpec =
  | { kind: 'command'; commandId: string }
  | { kind: 'separator' }
  | { kind: 'submenu'; id: string; labelKey: string; items: MenuItemSpec[]; dynamic?: string }
  /** Informational disabled entry such as "No scripts found". */
  | { kind: 'placeholder'; id: string; labelKey: string };

export interface MenuSpec {
  id: string;
  labelKey: string;
  items: MenuItemSpec[];
  /** Items provided at run time (recent files, scripts); replaces `items` when non-empty. */
  dynamic?: string;
}

const sep: MenuItemSpec = { kind: 'separator' };
const cmd = (commandId: string): MenuItemSpec => ({ kind: 'command', commandId });

export const MAIN_MENU: readonly MenuSpec[] = [
  {
    id: 'file',
    labelKey: 'menu.file.caption',
    items: [
      cmd('file.new'),
      cmd('file.open'),
      cmd('file.save'),
      cmd('file.saveAs'),
      cmd('file.validate'),
      sep,
      {
        kind: 'submenu',
        id: 'import',
        labelKey: 'menu.file.import',
        dynamic: 'import',
        items: [{ kind: 'placeholder', id: 'none', labelKey: 'menu.file.noImportPlugins' }],
      },
      {
        kind: 'submenu',
        id: 'export',
        labelKey: 'menu.file.export',
        dynamic: 'export',
        items: [{ kind: 'placeholder', id: 'none', labelKey: 'menu.file.noExportPlugins' }],
      },
      sep,
      {
        kind: 'submenu',
        id: 'recent',
        labelKey: 'menu.file.recent',
        dynamic: 'recent',
        items: [{ kind: 'placeholder', id: 'none', labelKey: 'menu.file.noRecent' }],
      },
      sep,
      cmd('file.exit'),
    ],
  },
  {
    id: 'edit',
    labelKey: 'menu.edit.caption',
    items: [
      cmd('edit.undo'),
      cmd('edit.redo'),
      sep,
      cmd('edit.cut'),
      cmd('edit.copy'),
      cmd('edit.paste'),
      sep,
      cmd('edit.find'),
      cmd('edit.findNext'),
      cmd('edit.replace'),
      sep,
      cmd('edit.gotoFootnote'),
      cmd('edit.gotoMatchTag'),
      cmd('edit.gotoWrongTag'),
      sep,
      cmd('edit.clone'),
      cmd('edit.split'),
      cmd('edit.merge'),
      cmd('edit.removeOuter'),
    ],
  },
  {
    id: 'view',
    labelKey: 'menu.view.caption',
    items: [
      cmd('view.toolbarCommands'),
      cmd('view.toolbarScripts'),
      cmd('view.linksBar'),
      cmd('view.tableBar'),
      cmd('view.statusBar'),
      cmd('view.tree'),
      sep,
      cmd('view.description'),
      cmd('view.body'),
      cmd('view.source'),
      sep,
      cmd('view.fastMode'),
    ],
  },
  {
    id: 'add',
    labelKey: 'menu.add.caption',
    items: [
      cmd('insert.body'),
      cmd('insert.title'),
      cmd('insert.epigraph'),
      cmd('insert.annotation'),
      sep,
      cmd('insert.textAuthor'),
      cmd('insert.image'),
      cmd('insert.inlineImage'),
      cmd('insert.poem'),
      cmd('insert.cite'),
      cmd('insert.table'),
      cmd('insert.sectionImage'),
      sep,
      cmd('insert.binary'),
    ],
  },
  {
    id: 'style',
    labelKey: 'menu.style.caption',
    items: [
      cmd('style.normal'),
      cmd('style.textAuthor'),
      cmd('style.subtitle'),
      sep,
      cmd('style.link'),
      cmd('style.footnote'),
      cmd('style.removeLink'),
    ],
  },
  {
    id: 'tools',
    labelKey: 'menu.tools.caption',
    items: [cmd('tools.words'), cmd('tools.settings'), sep, cmd('tools.spellcheck')],
  },
  {
    id: 'scripts',
    labelKey: 'menu.scripts.caption',
    dynamic: 'scripts',
    items: [{ kind: 'placeholder', id: 'none', labelKey: 'menu.scripts.none' }],
  },
  {
    id: 'help',
    labelKey: 'menu.help.caption',
    items: [cmd('help.checkVersion'), cmd('help.about')],
  },
];

/** `data-testid` of a menu item: `menu-file-new`, `menu-add-body`, `menu-file-recent`... */
export function menuItemTestId(menuId: string, item: MenuItemSpec, index: number): string {
  switch (item.kind) {
    case 'command':
      return `menu-${menuId}-${item.commandId.slice(item.commandId.indexOf('.') + 1)}`;
    case 'submenu':
      return `menu-${menuId}-${item.id}`;
    case 'placeholder':
      return `menu-${menuId}-${item.id}`;
    case 'separator':
      return `menu-${menuId}-separator-${index}`;
  }
}

/** Items supplied at run time for `dynamic` menus/submenus (recent files, scripts, plugins). */
export type DynamicMenuItems = Partial<Record<string, MenuItemSpec[]>>;
