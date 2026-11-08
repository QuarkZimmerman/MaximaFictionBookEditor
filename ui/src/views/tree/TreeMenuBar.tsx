/**
 * Feature 011 (US2, US11; D34, D35, D41; contracts/tree.md §5): the Document tree's menu bar,
 * drawn like the main menu bar. *Elements* holds one check entry per kind of the original's list
 * (`elementKinds.ts`), named in the editor's words with the FB2 element in its tooltip; a change is
 * saved in `view.treeElements` and applied at once. *Scripts* lists the tree scripts and *Clean*
 * (its entries come from the tree-script feature).
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PopupMenu, type PopupMenuItem } from '@/app/PopupMenu';
import { useAppServices } from '@/app/services';

import { ELEMENT_ENTRIES, type ElementEntryId } from './elementKinds';

export interface TreeMenuBarProps {
  shown: ReadonlySet<ElementEntryId>;
  /** The *Scripts* menu's entries; null shows the menu's placeholder entry alone. */
  scripts?: readonly PopupMenuItem[] | null;
}

type MenuId = 'elements' | 'scripts';

export function TreeMenuBar({ shown, scripts = null }: TreeMenuBarProps) {
  const { t } = useTranslation();
  const { store, rpc } = useAppServices();
  const [open, setOpen] = useState<{ menu: MenuId; x: number; y: number } | null>(null);
  const buttons = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});

  const toggle = (id: ElementEntryId) => {
    const choices = { ...(store.getState().settings?.view.treeElements ?? {}) };
    choices[id] = !shown.has(id);
    void rpc
      ?.call('settings.set', { patch: { view: { treeElements: choices } } })
      .catch(() => undefined);
  };

  const elementItems: PopupMenuItem[] = ELEMENT_ENTRIES.map((entry) => ({
    id: entry.id,
    label: t(`tree.elements.${entry.id}`),
    tooltip: t('tree.elements.tooltip', { element: entry.fb2 }),
    checked: shown.has(entry.id),
    run: () => toggle(entry.id),
  }));
  const scriptItems: PopupMenuItem[] =
    scripts && scripts.length > 0
      ? [...scripts]
      : [{ id: 'none', label: t('tree.scripts.none'), enabled: false, run: () => undefined }];

  const openMenu = (menu: MenuId) => {
    const button = buttons.current[menu];
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setOpen((current) => (current?.menu === menu ? null : { menu, x: rect.left, y: rect.bottom }));
  };

  return (
    <div
      role="menubar"
      className="mfbe-menubar mfbe-tree-menubar"
      data-testid="tree-menubar"
      aria-label={t('tree.menubar.label')}
    >
      {(['elements', 'scripts'] as const).map((menu) => (
        <div key={menu} className="mfbe-menubar-entry">
          <button
            ref={(element) => {
              buttons.current[menu] = element;
            }}
            type="button"
            role="menuitem"
            // As the main menu bar's menus (feature 010, D13): no tooltip of their own.
            data-no-tooltip
            aria-haspopup="menu"
            aria-expanded={open?.menu === menu}
            className={`mfbe-menubar-button${open?.menu === menu ? ' mfbe-menubar-button-open' : ''}`}
            data-testid={`tree-menu-${menu}`}
            onClick={() => openMenu(menu)}
          >
            {t(`tree.menubar.${menu}`)}
          </button>
        </div>
      ))}
      {open ? (
        <PopupMenu
          items={open.menu === 'elements' ? elementItems : scriptItems}
          position={{ x: open.x, y: open.y }}
          onClose={() => setOpen(null)}
          testId={`tree-menu-${open.menu}-popup`}
          ariaLabel={t(`tree.menubar.${open.menu}`)}
        />
      ) : null}
    </div>
  );
}
