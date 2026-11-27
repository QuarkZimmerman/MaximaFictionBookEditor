/**
 * Mode-selecting toolbar split button for `file.new` / `file.newPackage` (feature 022, FR-001, FR-002).
 *
 * Replaces the toolbar's primary New button icon and click action with whichever mode the user
 * chose from its dropdown (initialized at startup from `settings.other.startupMode`). Preserves
 * `data-testid="toolbar-file.new"` on the primary button and participates in Customize Toolbar and
 * Shift+drag as the single `'file.new'` slot.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { actions, useAppState } from '@/model/store';

import { commandDescription, commandTooltip, unavailableTitle } from './commands';
import { PopupMenu } from './PopupMenu';
import { useAppRevision, useAppServices, useCommandContext } from './services';
import { iconUrl } from './toolbarIcons';
import { tip } from './tooltips';

export function NewSplitButton({ size = 24 }: { size?: 16 | 24 }) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();

  const toolbarNewAction = useAppState((s) => s.toolbarNewAction, services.store);
  const splitRef = useRef<HTMLSpanElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const activeCommandId = toolbarNewAction === 'package' ? 'file.newPackage' : 'file.new';
  const activeCommand = services.commands.get(activeCommandId) ?? services.commands.get('file.new');
  if (!activeCommand) return null;

  const primaryEnabled = services.commands.isEnabled(activeCommandId, ctx);
  const fb2Enabled = services.commands.isEnabled('file.new', ctx);
  const packageEnabled = services.commands.isEnabled('file.newPackage', ctx);
  const dropdownEnabled = fb2Enabled || packageEnabled;

  const tooltip = commandTooltip(activeCommand, t);
  const hotkey = services.hotkeys.displayAll(activeCommandId);
  const reason = primaryEnabled ? null : services.commands.unavailableReason(activeCommandId, ctx);
  const unavailable = reason ? unavailableTitle(activeCommand, reason, t) : null;
  const description = commandDescription(activeCommand, t);
  const named = hotkey ? `${tooltip} (${hotkey})` : tooltip;
  const title =
    unavailable ??
    (description && description !== tooltip ? `${named} \u2014 ${description}` : named);

  const openDropdown = () => {
    if (!dropdownEnabled) return;
    if (menuAt) {
      setMenuAt(null);
      return;
    }
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuAt({ x: Math.round(rect.left), y: Math.round(rect.bottom + 1) });
  };

  const iconName =
    toolbarNewAction === 'package' ? 'id_file_new_package' : (activeCommand.icon ?? 'id_file_new');

  return (
    <span ref={splitRef} className="mfbe-toolbar-split" data-testid="toolbar-file.new-split">
      <button
        type="button"
        className="mfbe-toolbar-button mfbe-toolbar-split-main"
        data-testid="toolbar-file.new"
        data-command="file.new"
        data-active-action={toolbarNewAction}
        title={title}
        aria-label={tooltip}
        aria-description={unavailable ? `${description}. ${unavailable}` : description}
        disabled={!primaryEnabled}
        onClick={() => void services.commands.execute(activeCommandId, ctx)}
      >
        <img src={iconUrl(iconName, size)} width={size} height={size} alt="" draggable={false} />
      </button>
      <button
        type="button"
        className={`mfbe-toolbar-button mfbe-toolbar-split-caret${menuAt ? ' mfbe-toolbar-button-pressed' : ''}`}
        data-testid="toolbar-file.new-dropdown"
        aria-label={t('tip.package.newDropdown')}
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        disabled={!dropdownEnabled}
        {...tip(t('tip.package.newDropdown'))}
        onClick={openDropdown}
      >
        <span className="mfbe-toolbar-split-arrow" aria-hidden="true">
          {'\u25BE'}
        </span>
      </button>
      {menuAt ? (
        <PopupMenu
          testId="toolbar-file.new-menu"
          ariaLabel={t('tip.package.newDropdown')}
          position={menuAt}
          onClose={() => setMenuAt(null)}
          items={[
            {
              id: 'fb2',
              label: t('menu.file.new'),
              icon: { url: iconUrl('id_file_new', 16) },
              hotkey: services.hotkeys.display('file.new'),
              enabled: fb2Enabled,
              run: () => {
                actions.setToolbarNewAction(services.store, 'fb2');
                void services.commands.execute('file.new', ctx);
              },
            },
            {
              id: 'package',
              label: t('menu.file.newPackage'),
              icon: { url: iconUrl('id_file_new_package', 16) },
              hotkey: services.hotkeys.display('file.newPackage'),
              enabled: packageEnabled,
              run: () => {
                actions.setToolbarNewAction(services.store, 'package');
                void services.commands.execute('file.newPackage', ctx);
              },
            },
          ]}
        />
      ) : null}
    </span>
  );
}
