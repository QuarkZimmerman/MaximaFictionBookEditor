/**
 * Menu bar with the original File / Edit / View / Add / Style / Tools / Scripts / Help menus.
 * Mouse and keyboard operable: Alt+accelerator opens a menu, arrows navigate, Enter/Space
 * activate, Escape closes, item accelerators activate items, F10 focuses the bar. Toggle
 * commands show a checkmark, disabled commands are greyed, hotkeys are shown right-aligned.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { parseAccelerator } from '@/i18n';

import { commandLabelRaw, unavailableTitle, type CommandContext } from './commands';
import {
  MAIN_MENU,
  menuItemTestId,
  type DynamicMenuItems,
  type MenuItemSpec,
  type MenuSpec,
} from './menus';
import { fitPopupInViewport } from './popupFit';
import { useAppRevision, useAppServices, useCommandContext, type AppServices } from './services';

export interface MenuBarProps {
  menus?: readonly MenuSpec[];
  /** Run-time items for dynamic menus (`recent`, `scripts`, `import`, `export`). */
  dynamicItems?: DynamicMenuItems;
}

interface ResolvedItem {
  spec: MenuItemSpec;
  testId: string;
  label: string;
  accelerator: string | null;
  acceleratorIndex: number;
  enabled: boolean;
  checked: boolean;
  /** Command has a checked state (toggle). */
  toggle: boolean;
  hotkey: string | undefined;
  /**
   * "Command: reason" of a disabled command whose registry entry gives a reason (feature 006,
   * FR-043), set as `title` and `aria-description`.
   */
  title?: string;
  items?: ResolvedItem[];
}

interface ResolveDeps {
  services: AppServices;
  ctx: CommandContext;
  t: TFunction;
  dynamicItems: DynamicMenuItems;
}

/**
 * Drops the separators that invisible entries left meaningless: a separator at either end of
 * the list and the second of two adjacent ones (the first stays).
 */
function collapseSeparators(items: ResolvedItem[]): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  for (const item of items) {
    const separator = item.spec.kind === 'separator';
    if (separator && (out.length === 0 || out[out.length - 1]!.spec.kind === 'separator')) {
      continue;
    }
    out.push(item);
  }
  while (out.length > 0 && out[out.length - 1]!.spec.kind === 'separator') out.pop();
  return out;
}

/**
 * Resolves menu specs into labels, states and hotkeys (recursively for submenus). A registered
 * command whose `visible` predicate says no is left out altogether - not rendered as a disabled
 * entry as an unregistered command is - and a separator it leaves doubled or dangling goes
 * with it (feature 005: the AI assistant's entry while the assistant is disabled).
 */
function resolveItems(
  menuId: string,
  items: readonly MenuItemSpec[],
  dynamic: string | undefined,
  deps: ResolveDeps,
): ResolvedItem[] {
  const { services, ctx, t, dynamicItems } = deps;
  const source = dynamic && dynamicItems[dynamic]?.length ? dynamicItems[dynamic]! : items;
  const resolved: ResolvedItem[] = [];
  let hidden = false;
  source.forEach((spec, index) => {
    const testId = menuItemTestId(menuId, spec, index);
    if (spec.kind === 'separator') {
      resolved.push({
        spec,
        testId,
        label: '',
        accelerator: null,
        acceleratorIndex: -1,
        enabled: false,
        checked: false,
        toggle: false,
        hotkey: undefined,
      });
      return;
    }
    if (spec.kind === 'command') {
      const command = services.commands.get(spec.commandId);
      if (command && !services.commands.isVisible(spec.commandId, ctx)) {
        hidden = true;
        return;
      }
      const raw = command ? commandLabelRaw(command, t) : spec.commandId;
      const parsed = parseAccelerator(raw);
      const enabled = command ? services.commands.isEnabled(spec.commandId, ctx) : false;
      // A disabled command tells why, when it can (feature 006, FR-043; data-model §9.6).
      const reason =
        command && !enabled ? services.commands.unavailableReason(spec.commandId, ctx) : null;
      resolved.push({
        spec,
        testId,
        label: parsed.text,
        accelerator: parsed.key,
        acceleratorIndex: parsed.index,
        enabled,
        checked: command ? services.commands.isChecked(spec.commandId, ctx) : false,
        toggle: command?.checked !== undefined,
        hotkey: services.hotkeys.display(spec.commandId),
        title: command && reason ? unavailableTitle(command, reason, t) : undefined,
      });
      return;
    }
    const parsed = parseAccelerator(t(spec.labelKey));
    if (spec.kind === 'submenu') {
      resolved.push({
        spec,
        testId,
        label: parsed.text,
        accelerator: parsed.key,
        acceleratorIndex: parsed.index,
        enabled: true,
        checked: false,
        toggle: false,
        hotkey: undefined,
        items: resolveItems(`${menuId}-${spec.id}`, spec.items, spec.dynamic, deps),
      });
      return;
    }
    resolved.push({
      spec,
      testId,
      label: parsed.text,
      accelerator: parsed.key,
      acceleratorIndex: parsed.index,
      enabled: false,
      checked: false,
      toggle: false,
      hotkey: undefined,
    });
  });
  return hidden ? collapseSeparators(resolved) : resolved;
}

/** Renders `Save &As...` with the accelerator underlined. */
export function AcceleratedLabel({ text, index }: { text: string; index: number }) {
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <u>{text[index]}</u>
      {text.slice(index + 1)}
    </>
  );
}

export function MenuBar({ menus = MAIN_MENU, dynamicItems = {} }: MenuBarProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number>(-1);
  const [openSubmenu, setOpenSubmenu] = useState<number>(-1);
  const [subHighlight, setSubHighlight] = useState<number>(-1);
  /** Keyboard-opened menus start with the first item highlighted. */
  const barRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const openMenu = menus.find((m) => m.id === openMenuId) ?? null;
  const resolveDeps: ResolveDeps = { services, ctx, t, dynamicItems };
  const openItems = openMenu
    ? resolveItems(openMenu.id, openMenu.items, openMenu.dynamic, resolveDeps)
    : [];
  const submenuItems = openSubmenu >= 0 ? (openItems[openSubmenu]?.items ?? []) : [];

  const close = useCallback(() => {
    setOpenMenuId(null);
    setHighlight(-1);
    setOpenSubmenu(-1);
    setSubHighlight(-1);
  }, []);

  const open = useCallback((menuId: string, viaKeyboard: boolean) => {
    setOpenMenuId(menuId);
    setOpenSubmenu(-1);
    setSubHighlight(-1);
    setHighlight(viaKeyboard ? 0 : -1);
  }, []);

  // Focus the popup when opened so keyboard events land on it; close on outside clicks.
  useEffect(() => {
    if (!openMenuId) return;
    popupRef.current?.focus();
    const onMouseDown = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openMenuId, close]);

  // Alt+accelerator opens a menu from anywhere; F10 focuses the menu bar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A modal dialog blocks the menus; a modeless one keeps its own Alt+letter keys.
      if (services.dialogs.service.isModalOpen) return;
      if (event.target instanceof Element && event.target.closest('.mfbe-dialog-modeless')) return;
      if (event.key === 'F10' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const first = barRef.current?.querySelector<HTMLElement>('[data-menu-id]');
        first?.focus();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
      const pressed = event.key.toLowerCase();
      const menu = menus.find((m) => parseAccelerator(t(m.labelKey)).key === pressed);
      if (menu) {
        event.preventDefault();
        event.stopPropagation();
        open(menu.id, true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menus, open, services.dialogs.service, t]);

  const activate = useCallback(
    (item: ResolvedItem, index: number, inSubmenu: boolean) => {
      if (item.spec.kind === 'separator' || item.spec.kind === 'placeholder') return;
      if (item.spec.kind === 'submenu') {
        if (inSubmenu) return; // nested submenus are not used
        setOpenSubmenu(index);
        setSubHighlight(0);
        return;
      }
      if (!item.enabled) return;
      close();
      void services.commands.execute(item.spec.commandId, ctx);
    },
    [close, ctx, services.commands],
  );

  const moveHighlight = (
    items: ResolvedItem[],
    current: number,
    delta: 1 | -1,
    set: (index: number) => void,
  ) => {
    if (items.length === 0) return;
    let index = current;
    for (let step = 0; step < items.length; step += 1) {
      index = (index + delta + items.length) % items.length;
      if (items[index]!.spec.kind !== 'separator') break;
    }
    set(index);
  };

  const onPopupKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!openMenu) return;
    const inSubmenu = openSubmenu >= 0;
    const items = inSubmenu ? submenuItems : openItems;
    const current = inSubmenu ? subHighlight : highlight;
    const setCurrent = inSubmenu ? setSubHighlight : setHighlight;
    const menuIndex = menus.findIndex((m) => m.id === openMenu.id);

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (inSubmenu) {
          setOpenSubmenu(-1);
          setSubHighlight(-1);
        } else {
          close();
          barRef.current?.querySelector<HTMLElement>(`[data-menu-id="${openMenu.id}"]`)?.focus();
        }
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveHighlight(items, current, 1, setCurrent);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveHighlight(items, current, -1, setCurrent);
        return;
      case 'ArrowRight': {
        event.preventDefault();
        const highlighted = openItems[highlight];
        if (!inSubmenu && highlighted?.spec.kind === 'submenu') {
          setOpenSubmenu(highlight);
          setSubHighlight(0);
          return;
        }
        open(menus[(menuIndex + 1) % menus.length]!.id, true);
        return;
      }
      case 'ArrowLeft':
        event.preventDefault();
        if (inSubmenu) {
          setOpenSubmenu(-1);
          setSubHighlight(-1);
          return;
        }
        open(menus[(menuIndex - 1 + menus.length) % menus.length]!.id, true);
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[current];
        if (item) activate(item, current, inSubmenu);
        return;
      }
      case 'Home':
        event.preventDefault();
        moveHighlight(items, -1, 1, setCurrent);
        return;
      case 'End':
        event.preventDefault();
        moveHighlight(items, 0, -1, setCurrent);
        return;
      default:
        break;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const pressed = event.key.toLowerCase();
      const matches = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.accelerator === pressed);
      if (matches.length === 1) {
        event.preventDefault();
        activate(matches[0]!.item, matches[0]!.index, inSubmenu);
      } else if (matches.length > 1) {
        event.preventDefault();
        const next = matches.find(({ index }) => index > current) ?? matches[0]!;
        setCurrent(next.index);
      }
    }
  };

  const onTopKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, menu: MenuSpec) => {
    const menuIndex = menus.findIndex((m) => m.id === menu.id);
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(menu.id, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      barRef.current
        ?.querySelector<HTMLElement>(
          `[data-menu-id="${menus[(menuIndex + 1) % menus.length]!.id}"]`,
        )
        ?.focus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      barRef.current
        ?.querySelector<HTMLElement>(
          `[data-menu-id="${menus[(menuIndex - 1 + menus.length) % menus.length]!.id}"]`,
        )
        ?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      (event.currentTarget as HTMLElement).blur();
    }
  };

  const onTopClick = (event: ReactMouseEvent, menu: MenuSpec) => {
    event.preventDefault();
    // Only the left button opens a menu: a right-click on the menu bar shows nothing.
    if (event.button !== 0) return;
    if (openMenuId === menu.id) close();
    else open(menu.id, false);
  };

  const onTopHover = (menu: MenuSpec) => {
    if (openMenuId && openMenuId !== menu.id) open(menu.id, false);
  };

  const renderItems = (items: ResolvedItem[], inSubmenu: boolean, current: number) =>
    items.map((item, index) => {
      if (item.spec.kind === 'separator') {
        return (
          <div
            key={item.testId}
            role="separator"
            className="mfbe-menu-separator"
            data-testid={item.testId}
          />
        );
      }
      const isSubmenu = item.spec.kind === 'submenu';
      const isHighlighted = index === current;
      return (
        <div
          key={item.testId}
          role={item.toggle ? 'menuitemcheckbox' : 'menuitem'}
          aria-checked={item.toggle ? item.checked : undefined}
          aria-disabled={!item.enabled || undefined}
          title={item.title}
          aria-description={item.title}
          aria-haspopup={isSubmenu || undefined}
          aria-expanded={isSubmenu ? openSubmenu === index : undefined}
          className={[
            'mfbe-menu-item',
            isHighlighted ? 'mfbe-menu-item-highlighted' : '',
            item.enabled ? '' : 'mfbe-menu-item-disabled',
            item.checked ? 'mfbe-menu-item-checked' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-testid={item.testId}
          data-checked={item.checked || undefined}
          onMouseEnter={() => {
            if (inSubmenu) {
              setSubHighlight(index);
            } else {
              setHighlight(index);
              if (isSubmenu) {
                setOpenSubmenu(index);
                setSubHighlight(-1);
              } else if (openSubmenu >= 0) {
                setOpenSubmenu(-1);
              }
            }
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            activate(item, index, inSubmenu);
          }}
        >
          <span className="mfbe-menu-check" aria-hidden="true">
            {item.checked ? '\u2713' : ''}
          </span>
          <span className="mfbe-menu-label">
            <AcceleratedLabel text={item.label} index={item.acceleratorIndex} />
          </span>
          <span className="mfbe-menu-hotkey">{item.hotkey ?? ''}</span>
          <span className="mfbe-menu-arrow" aria-hidden="true">
            {isSubmenu ? '\u25B8' : ''}
          </span>
          {isSubmenu && openSubmenu === index && item.items ? (
            <div
              ref={fitPopupInViewport}
              role="menu"
              className="mfbe-menu-popup mfbe-menu-submenu"
              data-testid={`${item.testId}-popup`}
              onMouseLeave={() => setSubHighlight(-1)}
            >
              {renderItems(item.items, true, subHighlight)}
            </div>
          ) : null}
        </div>
      );
    });

  return (
    <div
      ref={barRef}
      role="menubar"
      className="mfbe-menubar"
      data-testid="menubar"
      aria-label={t('app.name')}
    >
      {menus.map((menu) => {
        const parsed = parseAccelerator(t(menu.labelKey));
        const isOpen = openMenuId === menu.id;
        return (
          <div key={menu.id} className="mfbe-menubar-entry">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className={`mfbe-menubar-button${isOpen ? ' mfbe-menubar-button-open' : ''}`}
              data-testid={`menu-${menu.id}`}
              data-menu-id={menu.id}
              onMouseDown={(event) => onTopClick(event, menu)}
              onMouseEnter={() => onTopHover(menu)}
              onKeyDown={(event) => onTopKeyDown(event, menu)}
            >
              <AcceleratedLabel text={parsed.text} index={parsed.index} />
            </button>
            {isOpen ? (
              <div
                ref={(element) => {
                  popupRef.current = element;
                  fitPopupInViewport(element);
                }}
                role="menu"
                tabIndex={-1}
                className="mfbe-menu-popup"
                data-testid={`menu-${menu.id}-popup`}
                onKeyDown={onPopupKeyDown}
                onMouseLeave={() => {
                  if (openSubmenu < 0) setHighlight(-1);
                }}
              >
                {renderItems(openItems, false, highlight)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
