/**
 * A toolbar button tells why it is disabled (feature 006, T044; FR-043, U40; data-model §9.6,
 * vR2 missing 8): a disabled button whose command gives a reason shows "Command: reason" as its
 * title in place of "tooltip (hotkey)" and adds it to its description after ". "; one without a
 * reason, and an enabled one, keep "tooltip (hotkey)" and the description alone; the title
 * follows the state on every revision.
 */

import { act, render, screen } from '@testing-library/react';

import { AppProvider } from '@/app/AppContext';
import { createAppServices } from '@/app/services';
import { ToolbarButton } from '@/app/Toolbars';
import { changeLanguage, initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';

async function setup() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const services = createAppServices({ store, platform: 'linux' });
  let enabled = false;
  let reason: string | null = 'the table has only one row; use Delete table';
  services.commands.replace({
    id: 'table.deleteRow',
    group: 'table',
    tooltipKey: 'tables.cmd.deleteRow.tooltip',
    descriptionKey: 'tables.cmd.deleteRow.description',
    icon: 'table-delete-row',
    hotkeyScope: 'tableTarget',
    enabled: () => enabled,
    unavailableReason: () => reason,
    run: () => {},
  });
  services.hotkeys.assign('table.deleteRow', 'Ctrl+Alt+D');
  render(
    <AppProvider services={services}>
      <ToolbarButton commandId="table.deleteRow" />
      <ToolbarButton commandId="file.save" />
    </AppProvider>,
  );
  return {
    store,
    services,
    setEnabled: (value: boolean) => {
      enabled = value;
      act(() => services.commands.refresh());
    },
    setReason: (value: string | null) => {
      reason = value;
      act(() => services.commands.refresh());
    },
  };
}

const DESCRIPTION = "Delete the caret's row or the rows of the selected block";

describe('ToolbarButton reasons (feature 006)', () => {
  it('a disabled button with a reason carries "command: reason" as title and in its description', async () => {
    await setup();
    const button = screen.getByTestId('toolbar-table.deleteRow');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'Delete row: the table has only one row; use Delete table',
    );
    expect(button).toHaveAttribute(
      'aria-description',
      `${DESCRIPTION}. Delete row: the table has only one row; use Delete table`,
    );
    expect(button).toHaveAttribute('aria-label', 'Delete row');
    expect(button.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('icons/toolbar24/table-delete-row.png'),
    );
  });

  it('an enabled button, and a disabled one without a reason, keep "tooltip (hotkey)" and the description alone', async () => {
    const { setEnabled, setReason } = await setup();
    const button = screen.getByTestId('toolbar-table.deleteRow');
    setEnabled(true);
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('title', 'Delete row (Ctrl+Alt+D)');
    expect(button).toHaveAttribute('aria-description', DESCRIPTION);

    setEnabled(false);
    setReason(null);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Delete row (Ctrl+Alt+D)');
    expect(button).toHaveAttribute('aria-description', DESCRIPTION);

    // A command that defines no reason keeps today's tooltip (an opt-in): Save, no core.
    const save = screen.getByTestId('toolbar-file.save');
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', 'Save (F2)');
    expect(save).toHaveAttribute('aria-description', 'Save the active document');
  });

  it('while the run lock blocks the command, the title gives the lock text', async () => {
    const { store, setEnabled } = await setup();
    setEnabled(true);
    act(() => {
      actions.setRunLock(store, { kind: 'script', label: 'Script', startedAt: Date.now() });
    });
    const button = screen.getByTestId('toolbar-table.deleteRow');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Delete row: a script is running; wait until it ends');
    act(() => {
      actions.setRunLock(store, null);
    });
    expect(button).toHaveAttribute('title', 'Delete row (Ctrl+Alt+D)');
  });
});
