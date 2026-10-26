/**
 * Toolbars row: the Commands toolbar (the buttons of the original `IDR_MAINFRAME TOOLBAR` with
 * their 24 px icons), the Scripts toolbar, the Links bar and the Table bar, each toggled from the
 * View menu (store `toolbars.*`). The Commands and Scripts toolbars show the user's layout
 * (toolbarLayouts.ts) and are customised as the original's: a right-click anywhere on them
 * offers "Customize toolbar...", a double-click on an empty part opens that dialog, and a button
 * dragged with Shift held moves to where it is dropped or leaves the toolbar when dropped off it.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  CustomizeToolbarDialog,
  type CustomizeToolbarDialogProps,
} from '@/dialogs/CustomizeToolbarDialog';
import { isRunLocked, useAppState } from '@/model/store';

import { useAppServices, useCommandContext, useAppRevision } from './services';
import { commandDescription, commandTooltip, unavailableTitle } from './commands';
import { LinksBar } from './LinksBar';
import { PopupMenu } from './PopupMenu';
import { TableBar } from './TableBar';
import { iconUrl } from './toolbarDefinitions';
import {
  LAST_SCRIPT,
  SEPARATOR,
  isHiddenItem,
  saveLayout,
  shownLayout,
  withHiddenItems,
  type CustomizableToolbar,
} from './toolbarLayouts';

/** The script buttons the Scripts toolbar can show (supplied by the scripting module). */
export interface ScriptToolbarButtons {
  /** Command ids of the menu scripts with an icon, in menu order. */
  commandIds: readonly string[];
  /** The button of one of them. */
  render: (commandId: string) => ReactNode;
}

const NO_SCRIPTS: readonly string[] = [];

/** Half the space between two toolbar items: a drop there lands on the nearer one (pixels). */
const HALF_ITEM_GAP = 2;

export interface ToolbarButtonProps {
  commandId: string;
  size?: 16 | 24;
}

/**
 * A command button with icon, tooltip (short name + hotkey), pressed and disabled states. A
 * disabled button whose command tells why (feature 006, FR-043; data-model §9.6) shows
 * "Command: reason" as its tooltip and adds it to its description, re-evaluated on every
 * revision as the states are.
 */
export function ToolbarButton({ commandId, size = 24 }: ToolbarButtonProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  const command = services.commands.get(commandId);
  // An unregistered command has no button; neither has an invisible one (the AI assistant's
  // `ai.toggle` while the assistant is disabled, feature 005 FR-096).
  if (!command || !services.commands.isVisible(commandId, ctx)) return null;
  const enabled = services.commands.isEnabled(commandId, ctx);
  const checked = services.commands.isChecked(commandId, ctx);
  const tooltip = commandTooltip(command, t);
  const hotkey = services.hotkeys.display(commandId);
  const reason = enabled ? null : services.commands.unavailableReason(commandId, ctx);
  const unavailable = reason ? unavailableTitle(command, reason, t) : null;
  const title = unavailable ?? (hotkey ? `${tooltip} (${hotkey})` : tooltip);
  const description = commandDescription(command, t);
  return (
    <button
      type="button"
      className={`mfbe-toolbar-button${checked ? ' mfbe-toolbar-button-pressed' : ''}`}
      data-testid={`toolbar-${commandId}`}
      data-command={commandId}
      title={title}
      aria-label={tooltip}
      aria-description={unavailable ? `${description}. ${unavailable}` : description}
      aria-pressed={command.checked ? checked : undefined}
      disabled={!enabled}
      onClick={() => void services.commands.execute(commandId, ctx)}
    >
      {command.icon ? (
        <img
          src={iconUrl(command.icon, size)}
          width={size}
          height={size}
          alt=""
          draggable={false}
        />
      ) : (
        <span className="mfbe-toolbar-button-text">{tooltip}</span>
      )}
    </button>
  );
}

function ToolbarSeparator() {
  return <span className="mfbe-toolbar-separator" role="separator" aria-orientation="vertical" />;
}

/**
 * The layout after a Shift+drag of item `from` released at (x, y), as the Windows toolbar the
 * original used: dropped off the toolbar the button is removed; on another item it takes that
 * item's place; on an empty part it goes first or last; on itself, its right half puts a
 * separator before it and its left half removes the separator before it. Null: no change.
 */
function dropLayout(
  toolbar: HTMLElement,
  items: readonly string[],
  from: number,
  x: number,
  y: number,
): string[] | null {
  const moved = items[from]!;
  const others = items.filter((_, index) => index !== from);
  const bounds = toolbar.getBoundingClientRect();
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return others;
  const elements = [...toolbar.querySelectorAll<HTMLElement>('[data-toolbar-index]')];
  const hit = elements.find((element) => {
    const box = element.getBoundingClientRect();
    return (
      x >= box.left - HALF_ITEM_GAP &&
      x < box.right + HALF_ITEM_GAP &&
      y >= box.top &&
      y < box.bottom
    );
  });
  if (!hit) {
    const first = elements[0]?.getBoundingClientRect();
    const to = first && x < first.left ? 0 : items.length - 1;
    return to === from ? null : [...others.slice(0, to), moved, ...others.slice(to)];
  }
  const to = Number(hit.dataset.toolbarIndex);
  if (to !== from) return [...others.slice(0, to), moved, ...others.slice(to)];
  const box = hit.getBoundingClientRect();
  if (x >= box.left + box.width / 2) {
    return [...items.slice(0, from), SEPARATOR, ...items.slice(from)];
  }
  if (from > 0 && items[from - 1] === SEPARATOR) {
    return items.filter((_, index) => index !== from - 1);
  }
  return null;
}

/**
 * Shift+drag of a toolbar button (not a separator); the release decides (`dropLayout`). Not
 * while `blocked`.
 */
function useButtonDrag(
  items: readonly string[],
  save: (items: string[]) => void,
  blocked: boolean,
) {
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const latest = useRef({ items, save, blocked });
  useEffect(() => {
    latest.current = { items, save, blocked };
  });

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.shiftKey || latest.current.blocked) return;
    const toolbar = event.currentTarget;
    const element = (event.target as Element).closest<HTMLElement>('[data-toolbar-index]');
    if (!element || !toolbar.contains(element)) return;
    const from = Number(element.dataset.toolbarIndex);
    if (latest.current.items[from] === SEPARATOR) return;
    event.preventDefault();
    suppressClick.current = true;
    toolbar.setPointerCapture(event.pointerId);
    setDragging(true);
    const finish = (release: PointerEvent | null) => {
      toolbar.removeEventListener('pointerup', onUp);
      toolbar.removeEventListener('pointercancel', onCancel);
      setDragging(false);
      // The click that follows the release belongs to the drag.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (!release) return;
      const next = dropLayout(
        toolbar,
        latest.current.items,
        from,
        release.clientX,
        release.clientY,
      );
      if (next) latest.current.save(next);
    };
    const onUp = (release: PointerEvent) => finish(release);
    const onCancel = () => finish(null);
    toolbar.addEventListener('pointerup', onUp);
    toolbar.addEventListener('pointercancel', onCancel);
  }, []);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { dragging, onPointerDown, onClickCapture };
}

/** The newest value of a component's prop, readable outside the component's own render. */
interface LatestValue<T> {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Hands `value` to a dialog the component opens: the dialog host renders a dialog from the
 * closure given when it opened, which keeps the props of that moment; the dialog reads this
 * instead and follows every later value.
 */
function useLatestValue<T>(value: T): LatestValue<T> {
  const [latest] = useState(() => {
    let current = value;
    const listeners = new Set<() => void>();
    return {
      get: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      set: (next: T) => {
        if (Object.is(next, current)) return;
        current = next;
        for (const listener of [...listeners]) listener();
      },
    };
  });
  useEffect(() => latest.set(value), [latest, value]);
  return latest;
}

/**
 * The Customize dialog on the script buttons the toolbar offers now, not on those of the
 * moment it opened (FR-063: a script added later becomes available in the dialog). The page
 * learns of a reload from the core's `resources.changed` and fetches the list afterwards, so
 * the new catalogue can arrive while the dialog is already open.
 */
function LiveCustomizeToolbarDialog({
  scriptButtons,
  ...props
}: Omit<CustomizeToolbarDialogProps, 'scriptButtons'> & {
  scriptButtons: LatestValue<readonly string[]>;
}) {
  const current = useSyncExternalStore(scriptButtons.subscribe, scriptButtons.get);
  return <CustomizeToolbarDialog {...props} scriptButtons={current} />;
}

interface CustomizableToolbarViewProps {
  toolbar: CustomizableToolbar;
  /** Command ids of the scripts the Scripts toolbar can show. */
  scriptButtons: readonly string[];
  renderButton: (item: string) => ReactNode;
}

function CustomizableToolbarView({
  toolbar,
  scriptButtons,
  renderButton,
}: CustomizableToolbarViewProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const settings = useAppState((s) => s.settings, services.store);
  useAppRevision(); // the hidden items follow the command registry (feature 005 FR-096)
  // A running script (or AI request) blocks the whole window, as in the original.
  const runLocked = useAppState(isRunLocked, services.store);
  // A hidden item (toolbarLayouts.ts: the AI assistant's button while the assistant is
  // disabled) has no element at all - not even an empty wrapper - and a drag keeps it stored.
  const stored = shownLayout(settings, toolbar, scriptButtons);
  const hidden = (item: string) => isHiddenItem(item, services.commands, ctx);
  const items = stored.filter((item) => !hidden(item));
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const label = t(toolbar === 'commands' ? 'toolbar.commands' : 'toolbar.scripts');
  const drag = useButtonDrag(
    items,
    (next) => void saveLayout(ctx, toolbar, withHiddenItems(stored, next, hidden)),
    runLocked,
  );
  const latestScriptButtons = useLatestValue(scriptButtons);

  const customize = () => {
    if (runLocked) return;
    void services.dialogs.openCustom((close) => (
      <LiveCustomizeToolbarDialog
        ctx={ctx}
        toolbar={toolbar}
        scriptButtons={latestScriptButtons}
        onClose={() => close(undefined)}
      />
    ));
  };

  return (
    <>
      <div
        className={`mfbe-toolbar mfbe-toolbar-${toolbar}${drag.dragging ? ' mfbe-toolbar-dragging' : ''}`}
        role="toolbar"
        aria-label={label}
        data-testid={`toolbar-${toolbar}`}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
        onDoubleClick={(event) => {
          // A double-click on a button presses it twice; elsewhere it opens the dialog.
          if (!(event.target as Element).closest('button')) customize();
        }}
        onPointerDown={drag.onPointerDown}
        onClickCapture={drag.onClickCapture}
      >
        {items.map((item, index) => (
          <span
            key={item === SEPARATOR ? `separator-${index}` : item}
            className="mfbe-toolbar-item"
            data-toolbar-index={index}
            data-toolbar-item={item}
          >
            {item === SEPARATOR ? <ToolbarSeparator /> : renderButton(item)}
          </span>
        ))}
      </div>
      {menuAt ? (
        <PopupMenu
          items={[
            {
              id: 'customize',
              label: t('toolbarMenu.customize'),
              enabled: !runLocked,
              run: customize,
            },
          ]}
          position={menuAt}
          onClose={() => setMenuAt(null)}
          testId="toolbar-menu"
          ariaLabel={label}
        />
      ) : null}
    </>
  );
}

export function CommandsToolbar() {
  return (
    <CustomizableToolbarView
      toolbar="commands"
      scriptButtons={NO_SCRIPTS}
      renderButton={(id) => <ToolbarButton commandId={id} />}
    />
  );
}

/** Scripts toolbar: "Last script" and the scripts the user put on it. */
export function ScriptsToolbar({ scripts }: { scripts?: ScriptToolbarButtons }) {
  return (
    <CustomizableToolbarView
      toolbar="scripts"
      scriptButtons={scripts?.commandIds ?? NO_SCRIPTS}
      renderButton={(id) =>
        id === LAST_SCRIPT ? <ToolbarButton commandId={id} size={16} /> : scripts?.render(id)
      }
    />
  );
}

/** All toolbars, each shown according to the View menu toggles. */
export function Toolbars({ scripts }: { scripts?: ScriptToolbarButtons }) {
  const services = useAppServices();
  const toolbars = useAppState((s) => s.toolbars, services.store);
  if (!toolbars.commands && !toolbars.scripts && !toolbars.links && !toolbars.table) return null;
  return (
    <div className="mfbe-toolbars" data-testid="toolbars">
      {toolbars.commands ? <CommandsToolbar /> : null}
      {toolbars.scripts ? <ScriptsToolbar scripts={scripts} /> : null}
      {toolbars.links ? <LinksBar /> : null}
      {toolbars.table ? <TableBar /> : null}
    </div>
  );
}
